import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { inReadSnapshot } from './db.js';
import { DomainError, ROLE_PERMISSIONS, type ApiSession, type CommandEnvelope } from './contracts.js';
import { normalizeCatalogCategoryName, normalizeCatalogProductUpdate, normalizeCatalogReason } from './catalogValidation.js';
import { isStockTracked, normalizeItemKind, requireCatalogCapability, requireItemKindCapability, type ItemKind } from './itemKinds.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function id(value:unknown,label:string):string {
  if(typeof value!=='string'||!uuid.test(value))throw new DomainError('VALIDATION_FAILED',`Choose a valid ${label}.`);
  return value;
}
function expected(envelope:CommandEnvelope,key:string):number {
  const value=envelope.expectedVersions[key];
  if(!Number.isSafeInteger(value)||value<1)throw new DomainError('VALIDATION_FAILED',`Expected ${key} version is required.`);
  return value;
}
function matchVersion(current:unknown,value:number) {
  if(Number(current)!==value)throw new DomainError('VERSION_CONFLICT','The catalog record changed. Refresh and review the current version.',409,{currentVersion:Number(current)});
}
function manage(session:ApiSession) {
  if(!ROLE_PERMISSIONS[session.role].includes('catalog.manage'))throw new DomainError('FORBIDDEN','Your role cannot manage catalog records.',403);
  requireCatalogCapability(session);
}
export async function catalogAudit(client:PoolClient,session:ApiSession,commandId:string,type:string,value:unknown) {
  const payload=JSON.stringify(value);
  await client.query('INSERT INTO system.audit_events(id,tenant_id,outlet_id,actor_id,command_id,event_type,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[randomUUID(),session.tenantId,session.outletId,session.userId,commandId,type,payload]);
}
export async function catalogOutbox(client:PoolClient,session:ApiSession,commandId:string,type:string,value:unknown) {
  const payload=JSON.stringify(value);
  await client.query('INSERT INTO system.transactional_outbox(id,tenant_id,command_id,event_type,payload) VALUES($1,$2,$3,$4,$5::jsonb)',[randomUUID(),session.tenantId,commandId,type,payload]);
}
export async function catalogEvidence(client:PoolClient,session:ApiSession,commandId:string,type:string,value:unknown) {
  await catalogAudit(client,session,commandId,type,value);
  await catalogOutbox(client,session,commandId,type,value);
}

export interface CreatedCatalogCategory {categoryId:string;name:string;version:1;source:'PRODUCT_METADATA'}
export interface ResolveCatalogCategoryOptions {onCreated?:(category:CreatedCatalogCategory)=>void}

/** Catalog membership and count snapshots serialize on the same outlet key.
 * Lock ordering: revalidated authority -> outlet -> category/product -> balance.
 * No user interaction or external side effect happens while this lock is held.
 */
export async function lockCatalogOutlet(client:PoolClient,session:ApiSession,mode:'shared'|'exclusive'='exclusive') {
  const row=await client.query('SELECT id FROM core.outlets WHERE tenant_id=$1 AND id=$2 AND active FOR SHARE',[session.tenantId,session.outletId]);
  if(!row.rowCount)throw new DomainError('NOT_FOUND','Active outlet was not found.',404);
  // Authority already takes a shared outlet lock. An advisory admission lock
  // avoids competing shared-to-exclusive upgrades while serializing this domain.
  const lock=mode==='shared'?'pg_advisory_xact_lock_shared':'pg_advisory_xact_lock';
  await client.query(`SELECT ${lock}(hashtextextended('catalog:'||$1::text||':'||$2::text,0))`,[session.tenantId,session.outletId]);
}
export async function assertNoOpenCatalogCount(client:PoolClient,session:ApiSession,allowNewItemOutsideSelectedCount=false) {
  const count=await client.query("SELECT id,count_mode FROM inventory.stock_counts WHERE tenant_id=$1 AND outlet_id=$2 AND status='OPEN' LIMIT 1",[session.tenantId,session.outletId]);
  if(count.rowCount&&!(allowNewItemOutsideSelectedCount&&count.rows[0].count_mode==='SELECTED'))throw new DomainError('OPEN_COUNT_CONFLICT','Finish or cancel the open outlet count before changing count membership or reference cost.',409,{countId:count.rows[0].id});
}

/** Text is retained for preceding clients and CSV reviews; the scoped FK is
 * canonical. Exact label case remains significant until an explicit merge.
 */
export async function resolveCatalogCategory(client:PoolClient,session:ApiSession,name:string,commandId?:string,allowInactiveId?:string|null,options:ResolveCatalogCategoryOptions={}):Promise<string|null> {
  const label=normalizeCatalogCategoryName(name,true);
  if(!label)return null;
  const found=await client.query('SELECT id,active,merged_into FROM catalog.categories WHERE tenant_id=$1 AND outlet_id=$2 AND name=$3 FOR UPDATE',[session.tenantId,session.outletId,label]);
  if(found.rowCount) {
    const category=found.rows[0];
    if(!category.active&&category.id!==allowInactiveId)throw new DomainError(category.merged_into?'CATEGORY_MERGED':'CATEGORY_ARCHIVED','Choose an active category or restore its existing identity before assigning it.',409,{categoryId:category.id,mergedInto:category.merged_into});
    return category.id;
  }
  const categoryId=randomUUID();
  await client.query('INSERT INTO catalog.categories(id,tenant_id,outlet_id,name) VALUES($1,$2,$3,$4)',[categoryId,session.tenantId,session.outletId,label]);
  if(commandId){
    const created={categoryId,name:label,version:1 as const,source:'PRODUCT_METADATA' as const};
    if(options.onCreated){await catalogAudit(client,session,commandId,'catalog.category.created',created);options.onCreated(created);}
    else await catalogEvidence(client,session,commandId,'catalog.category.created',created);
  }
  return categoryId;
}

export function catalogIdentityError(error:unknown):never {
  if((error as {code?:string}).code==='23505')throw new DomainError('CATALOG_IDENTITY_CONFLICT','A SKU, barcode or category name already belongs to an existing record at this outlet. Review the existing identity.',409);
  throw error;
}

async function updateProduct(client:PoolClient,session:ApiSession,envelope:CommandEnvelope) {
  const productId=id(envelope.payload.productId,'product'),version=expected(envelope,`product:${productId}`);
  const metadata=normalizeCatalogProductUpdate(envelope.payload),reason=normalizeCatalogReason(envelope.payload.reason);
  const found=await client.query('SELECT id,name,selling_price_minor::text,cost_price_minor::text,tax_rate_bps,category,category_id,barcode,reorder_level::text,version,active,item_kind FROM catalog.products WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3 FOR UPDATE',[session.tenantId,session.outletId,productId]);
  if(!found.rowCount)throw new DomainError('NOT_FOUND','Product was not found at this outlet.',404);
  const before=found.rows[0];matchVersion(before.version,version);
  requireItemKindCapability(session,before.item_kind);
  if(isStockTracked(before.item_kind)&&BigInt(before.cost_price_minor)!==BigInt(metadata.costPriceMinor))await assertNoOpenCatalogCount(client,session);
  const categoryId=await resolveCatalogCategory(client,session,metadata.category,envelope.commandId,!before.active&&metadata.category===before.category?before.category_id:null);
  await client.query(`UPDATE catalog.products SET name=$4,selling_price_minor=$5,cost_price_minor=$6,tax_rate_bps=$7,category=$8,barcode=$9,reorder_level=$10::numeric,category_id=$11,version=version+1
    WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3`,[session.tenantId,session.outletId,productId,metadata.name,metadata.sellingPriceMinor,metadata.costPriceMinor,metadata.taxRateBps,metadata.category,metadata.barcode,metadata.reorderLevel,categoryId]);
  const value={productId,version:version+1,active:Boolean(before.active)};
  await catalogEvidence(client,session,envelope.commandId,envelope.type,{...value,reason,before,after:{...metadata,categoryId}});
  return value;
}

async function setProductActive(client:PoolClient,session:ApiSession,envelope:CommandEnvelope) {
  const productId=id(envelope.payload.productId,'product'),version=expected(envelope,`product:${productId}`),active=envelope.payload.active;
  const reason=normalizeCatalogReason(envelope.payload.reason);
  if(typeof active!=='boolean')throw new DomainError('VALIDATION_FAILED','Choose archive or restore explicitly.');
  const found=await client.query(`SELECT id,version,active,category_id,item_kind FROM catalog.products
    WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3 FOR UPDATE`,[session.tenantId,session.outletId,productId]);
  if(!found.rowCount)throw new DomainError('NOT_FOUND','Product was not found at this outlet.',404);
  const before=found.rows[0];matchVersion(before.version,version);
  requireItemKindCapability(session,before.item_kind);
  if(isStockTracked(before.item_kind))await assertNoOpenCatalogCount(client,session);
  const balances=await client.query('SELECT quantity::text,inventory_value_minor::text FROM inventory.balances WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3 FOR UPDATE',[session.tenantId,session.outletId,productId]);
  if(isStockTracked(before.item_kind)&&!balances.rowCount)throw new DomainError('INVENTORY_STATE_INVALID','The stocked item has no inventory balance. Ask an administrator to review its inventory evidence.',409);
  const balance=balances.rows[0];
  if(!active) {
    if(balance&&(!/^0(?:\.0+)?$/.test(balance.quantity)||BigInt(balance.inventory_value_minor)!==0n))throw new DomainError('PRODUCT_ARCHIVE_STOCK_REMAINING','Archive requires zero recorded quantity and zero inventory value. Review stock through supported inventory commands first.',409,{quantity:balance.quantity,inventoryValueMinor:balance.inventory_value_minor});
    const open=await client.query('SELECT id FROM inventory.sale_shortfalls WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3 AND resolved_quantity<quantity LIMIT 1',[session.tenantId,session.outletId,productId]);
    if(open.rowCount)throw new DomainError('PRODUCT_ARCHIVE_UNRESOLVED_SHORTFALL','Resolve the recorded stock exception before archiving this product.',409,{shortfallId:open.rows[0].id});
  } else if(before.category_id) {
    const category=await client.query('SELECT active,merged_into FROM catalog.categories WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3',[session.tenantId,session.outletId,before.category_id]);
    if(!category.rows[0]?.active)throw new DomainError('CATEGORY_ARCHIVED','Choose an active category or restore it before restoring this product.',409);
  }
  const changed=Boolean(before.active)!==active,newVersion=changed?version+1:version;
  if(changed)await client.query('UPDATE catalog.products SET active=$4,version=version+1 WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3',[session.tenantId,session.outletId,productId,active]);
  const value={productId,version:newVersion,active};
  await catalogEvidence(client,session,envelope.commandId,envelope.type,{...value,reason,beforeActive:before.active,changed});
  return value;
}

async function changeProductKind(client:PoolClient,session:ApiSession,envelope:CommandEnvelope) {
  const productId=id(envelope.payload.productId,'product'),version=expected(envelope,`product:${productId}`);
  const itemKind=normalizeItemKind(envelope.payload.itemKind),reason=normalizeCatalogReason(envelope.payload.reason);
  const found=await client.query<{item_kind:ItemKind;version:string}>('SELECT item_kind,version FROM catalog.products WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3 FOR UPDATE',[session.tenantId,session.outletId,productId]);
  if(!found.rowCount)throw new DomainError('NOT_FOUND','Item was not found at this outlet.',404);
  const before=found.rows[0];matchVersion(before.version,version);
  requireItemKindCapability(session,before.item_kind);requireItemKindCapability(session,itemKind);
  if(itemKind===before.item_kind)throw new DomainError('VALIDATION_FAILED','Choose a different item type for this reviewed change.');
  await assertNoOpenCatalogCount(client,session);
  const balances=await client.query('SELECT quantity::text,inventory_value_minor::text,version FROM inventory.balances WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3 FOR UPDATE',[session.tenantId,session.outletId,productId]);
  const balance=balances.rows[0];
  if(balance) {
    matchVersion(balance.version,expected(envelope,`balance:${productId}`));
    if(!/^0(?:\.0+)?$/.test(balance.quantity)||BigInt(balance.inventory_value_minor)!==0n)throw new DomainError('ITEM_KIND_STOCK_REMAINING','Review and correct the recorded quantity and carrying value through inventory before changing this item type.',409,{quantity:balance.quantity,inventoryValueMinor:balance.inventory_value_minor});
  } else if(isStockTracked(before.item_kind))throw new DomainError('INVENTORY_STATE_INVALID','The stocked item has no inventory balance. Review its inventory evidence before reclassification.',409);
  else if(Object.hasOwn(envelope.expectedVersions,`balance:${productId}`))throw new DomainError('VERSION_CONFLICT','The inventory balance does not match the reviewed state. Refresh this item.',409,{currentBalanceVersion:null});
  const shortfall=await client.query('SELECT id FROM inventory.sale_shortfalls WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3 AND resolved_quantity<quantity LIMIT 1',[session.tenantId,session.outletId,productId]);
  if(shortfall.rowCount)throw new DomainError('ITEM_KIND_UNRESOLVED_SHORTFALL','Resolve this item\'s stock exceptions before changing its type.',409,{shortfallId:shortfall.rows[0].id});
  await client.query('UPDATE catalog.products SET item_kind=$4,version=version+1 WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3',[session.tenantId,session.outletId,productId,itemKind]);
  if(isStockTracked(itemKind)&&!balance)await client.query('INSERT INTO inventory.balances(tenant_id,outlet_id,product_id,quantity,inventory_value_minor) VALUES($1,$2,$3,0,0)',[session.tenantId,session.outletId,productId]);
  const value={productId,itemKind,version:version+1,stockTracked:isStockTracked(itemKind)};
  await catalogEvidence(client,session,envelope.commandId,envelope.type,{...value,reason,beforeKind:before.item_kind,reviewedBalanceVersion:balance?Number(balance.version):null,reviewedQuantity:balance?.quantity??null,reviewedInventoryValueMinor:balance?.inventory_value_minor??null});
  return value;
}

async function category(client:PoolClient,session:ApiSession,categoryId:string) {
  const result=await client.query('SELECT * FROM catalog.categories WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3 FOR UPDATE',[session.tenantId,session.outletId,categoryId]);
  if(!result.rowCount)throw new DomainError('NOT_FOUND','Category was not found at this outlet.',404);
  return result.rows[0];
}
async function categoryCommand(client:PoolClient,session:ApiSession,envelope:CommandEnvelope) {
  const p=envelope.payload;
  if(envelope.type==='catalog.category.create') {
    const name=normalizeCatalogCategoryName(p.name),categoryId=randomUUID();
    const duplicate=await client.query('SELECT id FROM catalog.categories WHERE tenant_id=$1 AND outlet_id=$2 AND name=$3',[session.tenantId,session.outletId,name]);
    if(duplicate.rowCount)throw new DomainError('CATEGORY_NAME_CONFLICT','This exact category name is already reserved. Review or restore the existing category.',409,{categoryId:duplicate.rows[0].id});
    await client.query('INSERT INTO catalog.categories(id,tenant_id,outlet_id,name) VALUES($1,$2,$3,$4)',[categoryId,session.tenantId,session.outletId,name]);
    const value={categoryId,version:1,active:true};await catalogEvidence(client,session,envelope.commandId,envelope.type,{...value,name});return value;
  }
  const categoryId=id(p.categoryId??p.sourceCategoryId,'category'),version=expected(envelope,`category:${categoryId}`),reason=normalizeCatalogReason(p.reason);
  const before=await category(client,session,categoryId);matchVersion(before.version,version);
  const affected=[categoryId];
  if(envelope.type==='catalog.category.merge')affected.push(id(p.targetCategoryId,'target category'));
  const kinds=await client.query('SELECT DISTINCT item_kind FROM catalog.products WHERE tenant_id=$1 AND outlet_id=$2 AND category_id=ANY($3::uuid[])',[session.tenantId,session.outletId,affected]);
  for(const row of kinds.rows)requireItemKindCapability(session,row.item_kind);
  if(envelope.type==='catalog.category.update') {
    if(before.merged_into)throw new DomainError('CATEGORY_MERGED','A merged category retains its historical identity. Edit the target category instead.',409);
    const name=normalizeCatalogCategoryName(p.name);
    const duplicate=await client.query('SELECT id FROM catalog.categories WHERE tenant_id=$1 AND outlet_id=$2 AND name=$3 AND id<>$4',[session.tenantId,session.outletId,name,categoryId]);
    if(duplicate.rowCount)throw new DomainError('CATEGORY_NAME_CONFLICT','This category name is already reserved. Use the reviewed merge workflow instead.',409,{categoryId:duplicate.rows[0].id});
    const products=await client.query('SELECT id FROM catalog.products WHERE tenant_id=$1 AND outlet_id=$2 AND category_id=$3 ORDER BY id FOR UPDATE',[session.tenantId,session.outletId,categoryId]);
    // The scoped FK cascades only the live category label; versions and audit
    // explicitly record that metadata change in the same transaction.
    await client.query('UPDATE catalog.categories SET name=$4,version=version+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3',[session.tenantId,session.outletId,categoryId,name]);
    await client.query('UPDATE catalog.products SET version=version+1 WHERE tenant_id=$1 AND outlet_id=$2 AND category_id=$3',[session.tenantId,session.outletId,categoryId]);
    const value={categoryId,version:version+1,active:Boolean(before.active)};
    await catalogEvidence(client,session,envelope.commandId,envelope.type,{...value,reason,beforeName:before.name,name,productIds:products.rows.map(row=>row.id)});return value;
  }
  if(envelope.type==='catalog.category.set_active') {
    if(typeof p.active!=='boolean')throw new DomainError('VALIDATION_FAILED','Choose category archive or restore explicitly.');
    if(p.active&&before.merged_into)throw new DomainError('CATEGORY_MERGED','A merged category cannot be restored. Use its target category.',409,{mergedInto:before.merged_into});
    if(!p.active) {
      const used=await client.query('SELECT id FROM catalog.products WHERE tenant_id=$1 AND outlet_id=$2 AND category_id=$3 AND active LIMIT 1',[session.tenantId,session.outletId,categoryId]);
      if(used.rowCount)throw new DomainError('CATEGORY_IN_USE','Move or archive the active products before archiving their category.',409,{productId:used.rows[0].id});
    }
    const changed=Boolean(before.active)!==p.active,newVersion=changed?version+1:version;
    if(changed)await client.query('UPDATE catalog.categories SET active=$4,version=version+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3',[session.tenantId,session.outletId,categoryId,p.active]);
    const value={categoryId,version:newVersion,active:p.active};await catalogEvidence(client,session,envelope.commandId,envelope.type,{...value,reason,changed});return value;
  }
  if(envelope.type==='catalog.category.merge') {
    const targetId=id(p.targetCategoryId,'target category');
    if(targetId===categoryId)throw new DomainError('VALIDATION_FAILED','Choose two different categories for a merge.');
    const targetVersion=expected(envelope,`category:${targetId}`),target=await category(client,session,targetId);matchVersion(target.version,targetVersion);
    if(!before.active||!target.active||before.merged_into||target.merged_into)throw new DomainError('CATEGORY_ARCHIVED','A merge requires two active, unmerged categories.',409);
    const products=await client.query('SELECT id FROM catalog.products WHERE tenant_id=$1 AND outlet_id=$2 AND category_id=$3 ORDER BY id FOR UPDATE',[session.tenantId,session.outletId,categoryId]);
    await client.query('UPDATE catalog.products SET category_id=$4,category=$5,version=version+1 WHERE tenant_id=$1 AND outlet_id=$2 AND category_id=$3',[session.tenantId,session.outletId,categoryId,targetId,target.name]);
    await client.query('UPDATE catalog.categories SET active=false,merged_into=$4,version=version+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3',[session.tenantId,session.outletId,categoryId,targetId]);
    await client.query('UPDATE catalog.categories SET version=version+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3',[session.tenantId,session.outletId,targetId]);
    const value={sourceCategoryId:categoryId,targetCategoryId:targetId,sourceVersion:version+1,targetVersion:targetVersion+1,updatedProducts:products.rowCount??0};
    await catalogEvidence(client,session,envelope.commandId,envelope.type,{...value,reason,productIds:products.rows.map(row=>row.id)});return value;
  }
  throw new DomainError('VALIDATION_FAILED','Unsupported category operation.');
}

export async function executeCatalogMaintenanceCommand(client:PoolClient,session:ApiSession,envelope:CommandEnvelope) {
  manage(session);await lockCatalogOutlet(client,session);
  try {
    if(envelope.type==='catalog.product.update')return await updateProduct(client,session,envelope);
    if(envelope.type==='catalog.product.set_active')return await setProductActive(client,session,envelope);
    if(envelope.type==='catalog.product.change_kind')return await changeProductKind(client,session,envelope);
    return await categoryCommand(client,session,envelope);
  }catch(error){catalogIdentityError(error);}
}

export function readIncludeArchived(query:Record<string,unknown>,session:ApiSession) {
  if(Object.keys(query).some(key=>key!=='includeArchived')||(query.includeArchived!==undefined&&!['true','false'].includes(String(query.includeArchived))))throw new DomainError('VALIDATION_FAILED','Choose includeArchived as true or false.');
  const included=query.includeArchived==='true';
  if(included&&!ROLE_PERMISSIONS[session.role].includes('catalog.manage'))throw new DomainError('FORBIDDEN','Your role cannot read archived catalog records.',403);
  return included;
}
export async function listCatalogCategories(session:ApiSession,query:Record<string,unknown>={}) {
  manage(session);const includeArchived=readIncludeArchived(query,session);
  return inReadSnapshot(async client=>{
    const result=await client.query(`SELECT c.id,c.name,c.active,c.version,c.merged_into,count(p.id)::int product_count,count(p.id) FILTER(WHERE p.active)::int active_product_count
      FROM catalog.categories c LEFT JOIN catalog.products p ON p.tenant_id=c.tenant_id AND p.outlet_id=c.outlet_id AND p.category_id=c.id
      WHERE c.tenant_id=$1 AND c.outlet_id=$2 AND (c.active OR $3::boolean) GROUP BY c.id ORDER BY c.name,c.id`,[session.tenantId,session.outletId,includeArchived]);
    return {categories:result.rows.map(row=>({id:row.id,name:row.name,active:row.active,version:Number(row.version),mergedInto:row.merged_into,productCount:row.product_count,activeProductCount:row.active_product_count}))};
  });
}
