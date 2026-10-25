import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { ApiRole, CommandEnvelope } from '../src/contracts.js';
import { COMMAND_CATALOGUE } from '../src/commandCatalogue.js';
import { assertContract } from '../src/contractValidation.js';
import { apiErrorMessage } from '../../../src/services/apiMessages.js';

const databaseUrl=process.env.TEST_DATABASE_URL;
if(!databaseUrl){test('versioned catalog maintenance acceptance',{skip:'Requires disposable TEST_DATABASE_URL.'},()=>{});}
else{
  process.env.DATABASE_URL=databaseUrl;process.env.APP_ORIGINS??='http://localhost:3000';
  const [{buildApp},{hashPassword},db]=await Promise.all([import('../src/app.js'),import('../src/security.js'),import('../src/db.js')]);
  const password=`Disposable-catalog-${randomUUID()}`,passwordHash=await hashPassword(password);
  type Scope={tenantId:string;outletId:string};
  type Actor=Scope&{userId:string;deviceId:string;headers:Record<string,string>};
  let terminal=0;
  test('catalog edits, category lifecycle and archive boundaries preserve committed business evidence',{timeout:180_000},async t=>{
    const app=buildApp({logger:{level:'error'}});await app.ready();t.after(async()=>{await app.close();await db.pool.end();});
    async function scope(tenantId:string=randomUUID()):Promise<Scope>{
      const outletId=randomUUID();
      await db.pool.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Disposable catalog business','KES','Africa/Nairobi') ON CONFLICT DO NOTHING",[tenantId]);
      await db.pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Catalog outlet','Africa/Nairobi')",[outletId,tenantId]);
      await db.pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'inventory'),($1,'commerce') ON CONFLICT DO NOTHING",[tenantId]);
      return {tenantId,outletId};
    }
    async function actor(context:Scope,role:ApiRole='owner'):Promise<Actor>{
      const userId=randomUUID(),deviceId=randomUUID(),email=`catalog-${userId}@example.invalid`;
      await db.pool.query("INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,'Catalog operator')",[userId,email,passwordHash]);
      await db.pool.query('INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[context.tenantId,userId,role]);
      await db.pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Disposable catalog assignment')",[deviceId,context.tenantId,context.outletId,userId]);
      const login=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:`198.51.100.${++terminal}`,payload:{email,password,deviceId}});assert.equal(login.statusCode,200,login.body);
      const cookies=login.headers['set-cookie'];const cookie=(Array.isArray(cookies)?cookies:[cookies]).filter((value):value is string=>typeof value==='string').map(value=>value.split(';',1)[0]).join('; ');
      return {...context,userId,deviceId,headers:{cookie,origin:process.env.APP_ORIGINS!.split(',')[0],'x-csrf-token':login.json().csrfToken}};
    }
    const fixture=async()=>actor(await scope());
    const command=(owner:Actor,type:string,payload:Record<string,unknown>,expectedVersions:Record<string,number>={}):CommandEnvelope=>({protocolVersion:1,commandId:randomUUID(),tenantId:owner.tenantId,deviceId:owner.deviceId,type,occurredAt:new Date().toISOString(),expectedVersions,payload});
    const send=(owner:Actor,envelope:CommandEnvelope)=>app.inject({method:'POST',url:'/api/v1/commands',headers:owner.headers,payload:envelope});
    const submit=async(owner:Actor,type:string,payload:Record<string,unknown>,versions:Record<string,number>={})=>(await send(owner,command(owner,type,payload,versions))).json();
    async function confirmed(owner:Actor,type:string,payload:Record<string,unknown>,versions:Record<string,number>={}){const outcome=await submit(owner,type,payload,versions);assert.equal(outcome.status,'CONFIRMED',JSON.stringify(outcome));if(type.startsWith('catalog.product.')||type.startsWith('catalog.category.'))assertContract(outcome.value,COMMAND_CATALOGUE[type].outputSchema,'Acceptance result');return outcome.value;}
    function denied(outcome:any,code?:string){assert.ok(outcome.status==='REJECTED'||outcome.status==='CONFLICT'||outcome.error,JSON.stringify(outcome));assert.notEqual(outcome.error?.code,'INTERNAL_ERROR',JSON.stringify(outcome));if(code)assert.equal(outcome.error?.code??outcome.code,code,JSON.stringify(outcome));}
    async function read(owner:Actor,path:string){const response=await app.inject({url:'/api/v1'+path,headers:owner.headers});assert.equal(response.statusCode,200,response.body);return response.json();}
    const product=async(owner:Actor,id:string)=>(await db.pool.query('SELECT * FROM catalog.products WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3',[owner.tenantId,owner.outletId,id])).rows[0];
    const metadata=(row:any,patch:Record<string,unknown>={})=>({productId:row.id,name:row.name,sellingPriceMinor:Number(row.selling_price_minor),costPriceMinor:Number(row.cost_price_minor),taxRateBps:row.tax_rate_bps,category:row.category,barcode:row.barcode,reorderLevel:String(row.reorder_level),reason:'Reviewed catalog metadata',...patch});
    async function create(owner:Actor,patch:Record<string,unknown>={}){const result=await confirmed(owner,'catalog.product.create',{sku:'ITEM-'+randomUUID().slice(0,8),name:'Original item',baseUnit:'each',currency:'KES',sellingPriceMinor:500,costPriceMinor:400,taxRateBps:0,...patch});return product(owner,result.productId);}
    const update=async(owner:Actor,row:any,patch:Record<string,unknown>={})=>submit(owner,'catalog.product.update',metadata(row,patch),{['product:'+row.id]:Number(row.version)});
    const activate=async(owner:Actor,row:any,active:boolean)=>submit(owner,'catalog.product.set_active',{productId:row.id,active,reason:'Reviewed catalog lifecycle'},{['product:'+row.id]:Number(row.version)});
    async function evidence(owner:Actor){
      const tables=['inventory.balances','inventory.movements','commerce.shifts','commerce.orders','commerce.order_lines','commerce.payments','commerce.refunds','commerce.refund_lines','finance.journal_entries','finance.journal_lines'];
      const values=await Promise.all(tables.map(async table=>[table,(await db.pool.query(`SELECT to_jsonb(x) evidence FROM ${table} x WHERE tenant_id=$1 ORDER BY to_jsonb(x)::text`,[owner.tenantId])).rows]));return Object.fromEntries(values);
    }
    const receive=(owner:Actor,rows:any[])=>confirmed(owner,'inventory.receive',{lines:rows.map(row=>({productId:row.id,quantity:'1',unitCostMinor:400}))});
    async function openShift(owner:Actor){return confirmed(owner,'shift.open',{openingFloatMinor:10000});}
    async function sale(owner:Actor,rows:any[],extra:Record<string,unknown>={}){
      const current=(await read(owner,'/shifts/current')).shift;
      return confirmed(owner,'sales.order.settle',{shiftId:current.id,lines:rows.map(row=>({productId:row.id,quantity:'1'})),tenders:[{method:'CASH',amountMinor:10000,currency:'KES'}],...extra},{['shift:'+current.id]:current.version,...Object.fromEntries(rows.map(row=>['product:'+row.id,Number(row.version)]))});
    }

    await t.test('direct metadata edits enforce versions, original-ID replay, audit once and concurrent winner',async()=>{
      const owner=await fixture(),row=await create(owner,{category:'Dairy'}),before=await evidence(owner);
      const envelope=command(owner,'catalog.product.update',metadata(row,{name:'Changed milk',sellingPriceMinor:625,costPriceMinor:450,taxRateBps:1600,barcode:'000012345678',reorderLevel:'2.125'}),{['product:'+row.id]:1});
      const first=(await send(owner,envelope)).json();assert.equal(first.status,'CONFIRMED',JSON.stringify(first));assert.equal(first.value.version,2);
      assert.deepEqual((await send(owner,envelope)).json(),first);denied((await send(owner,{...envelope,payload:{...envelope.payload,name:'Another body'}})).json(),'IDEMPOTENCY_MISMATCH');
      denied(await update(owner,row,{name:'Stale edit'}),'VERSION_CONFLICT');
      const current=await product(owner,row.id);const races=await Promise.all([update(owner,current,{name:'Concurrent A'}),update(owner,current,{name:'Concurrent B'})]);
      assert.equal(races.filter(result=>result.status==='CONFIRMED').length,1,JSON.stringify(races));assert.equal(races.filter(result=>result.code==='VERSION_CONFLICT').length,1,JSON.stringify(races));
      assert.equal(Number((await product(owner,row.id)).version),3);assert.deepEqual(await evidence(owner),before,'metadata never alters stock or posted financial records');
      assert.equal((await db.pool.query('SELECT count(*)::int n FROM system.audit_events WHERE tenant_id=$1 AND command_id=$2 AND event_type=$3',[owner.tenantId,envelope.commandId,envelope.type])).rows[0].n,1);
      denied(await update(owner,current,{sku:'IMMUTABLE'}),'VALIDATION_FAILED');
    });
    await t.test('tenant, outlet, permission and archived-read boundaries retain identities',async()=>{
      const owner=await fixture(),row=await create(owner),cashier=await actor(owner,'cashier'),otherOutlet=await actor(await scope(owner.tenantId)),foreign=await fixture();
      for(const outsider of [otherOutlet,foreign])denied(await update(outsider,row),'NOT_FOUND');
      denied(await update(cashier,row),'FORBIDDEN');
      const category=await confirmed(owner,'catalog.category.create',{name:'Restricted source'}),target=await confirmed(owner,'catalog.category.create',{name:'Restricted target'});
      for(const [type,payload,versions] of [
        ['catalog.product.set_active',{productId:row.id,active:false,reason:'Unauthorized archive'},{['product:'+row.id]:1}],
        ['catalog.category.create',{name:'Unauthorized category'},{}],
        ['catalog.category.update',{categoryId:category.categoryId,name:'Unauthorized rename',reason:'Permission boundary'},{['category:'+category.categoryId]:1}],
        ['catalog.category.set_active',{categoryId:category.categoryId,active:false,reason:'Permission boundary'},{['category:'+category.categoryId]:1}],
        ['catalog.category.merge',{sourceCategoryId:category.categoryId,targetCategoryId:target.categoryId,reason:'Permission boundary'},{['category:'+category.categoryId]:1,['category:'+target.categoryId]:1}],
      ] as Array<[string,Record<string,unknown>,Record<string,number>]>)denied(await submit(cashier,type,payload,versions),'FORBIDDEN');
      const publicRow=(await read(cashier,'/catalog/items')).items.find((entry:any)=>entry.id===row.id);assert.ok(!Object.hasOwn(publicRow,'costPriceMinor')&&!Object.hasOwn(publicRow,'inventoryValueMinor'));
      const archived=await activate(owner,row,false);assert.equal(archived.status,'CONFIRMED',JSON.stringify(archived));assert.equal(archived.value.active,false);
      assert.equal((await read(owner,'/catalog/items')).items.some((entry:any)=>entry.id===row.id),false);
      assert.equal((await read(owner,'/catalog/items?includeArchived=true')).items.find((entry:any)=>entry.id===row.id).active,false);
      assert.equal((await app.inject({url:'/api/v1/catalog/items?includeArchived=true',headers:cashier.headers})).statusCode,403);
      denied(await submit(owner,'catalog.product.create',{sku:row.sku.toLowerCase(),name:'Identity reuse',baseUnit:'each',currency:'KES',sellingPriceMinor:500,costPriceMinor:400,taxRateBps:0}),'CATALOG_IDENTITY_CONFLICT');
      assert.equal((await activate(owner,await product(owner,row.id),true)).status,'CONFIRMED');
    });
    await t.test('mixed-case concurrent creation and barcode conflicts cannot duplicate catalog identity',async()=>{
      const owner=await fixture(),sku='Mixed-'+randomUUID().slice(0,8),base={sku,name:'Case identity',baseUnit:'each',currency:'KES',sellingPriceMinor:500,costPriceMinor:400,taxRateBps:0};
      const races=await Promise.all([submit(owner,'catalog.product.create',base),submit(owner,'catalog.product.create',{...base,sku:sku.toUpperCase()})]);
      assert.equal(races.filter(value=>value.status==='CONFIRMED').length,1,JSON.stringify(races));assert.equal(races.filter(value=>value.code==='CATALOG_IDENTITY_CONFLICT').length,1,JSON.stringify(races));
      const first=await create(owner,{barcode:'BARCODE-'+randomUUID().slice(0,8)}),second=await create(owner),before=await evidence(owner);
      denied(await update(owner,second,{barcode:first.barcode}),'CATALOG_IDENTITY_CONFLICT');assert.equal(Number((await product(owner,second.id)).version),1);assert.deepEqual(await evidence(owner),before);
    });
    await t.test('archive rejects either nonzero quantity or nonzero value, and unresolved stock exceptions',async()=>{
      const owner=await fixture(),row=await create(owner);await receive(owner,[row]);
      denied(await activate(owner,row,false),'PRODUCT_ARCHIVE_STOCK_REMAINING');
      await db.pool.query('UPDATE inventory.balances SET quantity=0 WHERE tenant_id=$1 AND product_id=$2',[owner.tenantId,row.id]);
      const withValue=await evidence(owner);denied(await activate(owner,row,false),'PRODUCT_ARCHIVE_STOCK_REMAINING');assert.deepEqual(await evidence(owner),withValue);
      const short=await create(owner);await openShift(owner);
      await confirmed(owner,'configuration.stock_exception_policy.update',{enabled:true,allowZeroReferenceCost:false},{['stock-sale-policy:'+owner.outletId]:1});
      await sale(owner,[short],{stockException:{physicallyConfirmed:true,lines:[{productId:short.id,maxConfirmedShortfall:'1',reasonCode:'SUSPECTED_UNRECORDED_DELIVERY'}]}});
      const before=await evidence(owner);denied(await activate(owner,short,false),'PRODUCT_ARCHIVE_UNRESOLVED_SHORTFALL');assert.deepEqual(await evidence(owner),before);
    });
    await t.test('open count admits metadata but fences catalog membership and valuation fallback; archive race is atomic',async()=>{
      const owner=await fixture(),row=await create(owner,{category:'Count source'}),restorable=await create(owner);assert.equal((await activate(owner,restorable,false)).status,'CONFIRMED');
      const batch=await confirmed(owner,'catalog.import.validate',{fileName:'count.csv',csv:'sku,name,unit,price,cost\nCOUNT-NEW,Count new,each,5.00,4.00',mapping:{sku:'sku',name:'name',baseUnit:'unit',sellingPrice:'price',costPrice:'cost'},mode:'CREATE_ONLY'});
      const count=await confirmed(owner,'inventory.count.open',{areaLabel:'Controlled membership'});
      const baseline=(await db.pool.query('SELECT * FROM inventory.stock_count_lines WHERE tenant_id=$1 AND count_id=$2',[owner.tenantId,count.countId])).rows;
      denied(await activate(owner,row,false),'OPEN_COUNT_CONFLICT');denied(await activate(owner,await product(owner,restorable.id),true),'OPEN_COUNT_CONFLICT');
      denied(await update(owner,row,{costPriceMinor:401}),'OPEN_COUNT_CONFLICT');
      denied(await submit(owner,'catalog.product.create',{sku:'COUNT-CREATE',name:'Blocked membership',baseUnit:'each',currency:'KES',sellingPriceMinor:500,costPriceMinor:400}),'OPEN_COUNT_CONFLICT');
      denied(await submit(owner,'catalog.import.apply',{batchId:batch.batchId,reviewed:true,acknowledgedWarnings:true},{['import:'+batch.batchId]:1}),'OPEN_COUNT_CONFLICT');
      assert.equal((await update(owner,row,{name:'Display changed during count',sellingPriceMinor:600})).status,'CONFIRMED');
      const category=(await read(owner,'/catalog/categories')).categories.find((entry:any)=>entry.id===row.category_id);
      await confirmed(owner,'catalog.category.update',{categoryId:category.id,name:'Count renamed',reason:'Reviewed label'},{['category:'+category.id]:category.version});
      const target=await confirmed(owner,'catalog.category.create',{name:'Count target'});
      await confirmed(owner,'catalog.category.merge',{sourceCategoryId:category.id,targetCategoryId:target.categoryId,reason:'Reviewed count-time metadata merge'},{['category:'+category.id]:category.version+1,['category:'+target.categoryId]:1});
      assert.deepEqual((await db.pool.query('SELECT * FROM inventory.stock_count_lines WHERE tenant_id=$1 AND count_id=$2',[owner.tenantId,count.countId])).rows,baseline);
      const racing=await fixture(),candidate=await create(racing);await create(racing);
      const [opened,archived]=await Promise.all([submit(racing,'inventory.count.open',{areaLabel:'Race'}),activate(racing,candidate,false)]);
      assert.equal(opened.status,'CONFIRMED',JSON.stringify(opened));assert.ok(archived.status==='CONFIRMED'||archived.code==='OPEN_COUNT_CONFLICT',JSON.stringify(archived));
      const included=(await db.pool.query('SELECT 1 FROM inventory.stock_count_lines WHERE tenant_id=$1 AND count_id=$2 AND product_id=$3',[racing.tenantId,opened.value.countId,candidate.id])).rowCount;
      assert.equal(Boolean(included),Boolean((await product(racing,candidate.id)).active),'a count snapshot never includes a concurrently archived product');
    });
    await t.test('paid snapshots and journals stay immutable; stale quotes and archived receiving/restock fail atomically',async()=>{
      const owner=await fixture(),row=await create(owner);await receive(owner,[row]);await openShift(owner);const paid=await sale(owner,[row]);
      const receiptBefore=await read(owner,`/sales/orders/${paid.saleId}/receipt`),before=await evidence(owner);
      assert.equal((await update(owner,row,{name:'New description',sellingPriceMinor:700,costPriceMinor:450,taxRateBps:1600})).status,'CONFIRMED');
      assert.deepEqual(await evidence(owner),before);assert.deepEqual(await read(owner,`/sales/orders/${paid.saleId}/receipt`),receiptBefore);
      const shift=(await read(owner,'/shifts/current')).shift;
      denied(await submit(owner,'sales.order.settle',{shiftId:shift.id,lines:[{productId:row.id,quantity:'1'}],tenders:[{method:'CASH',amountMinor:10000,currency:'KES'}]},{['shift:'+shift.id]:shift.version,['product:'+row.id]:1}),'VERSION_CONFLICT');
      const current=await product(owner,row.id);assert.equal((await activate(owner,current,false)).status,'CONFIRMED');
      const healthy=await create(owner),archivedEvidence=await evidence(owner);
      denied(await submit(owner,'inventory.receive',{lines:[{productId:healthy.id,quantity:'1',unitCostMinor:400},{productId:row.id,quantity:'1',unitCostMinor:400}]}),'NOT_FOUND');assert.deepEqual(await evidence(owner),archivedEvidence);
      const line=(await db.pool.query('SELECT id FROM commerce.order_lines WHERE tenant_id=$1 AND order_id=$2',[owner.tenantId,paid.saleId])).rows[0];
      denied(await submit(owner,'sales.order.refund',{shiftId:shift.id,orderId:paid.saleId,reason:'Reviewed return of archived item',lines:[{orderLineId:line.id,quantity:'1',restock:true}]},{['shift:'+shift.id]:shift.version}),'PRODUCT_ARCHIVED');
      assert.deepEqual(await evidence(owner),archivedEvidence,'rejected archived return cannot post cash, tax, refund rows or stock');
      assert.deepEqual(await read(owner,`/sales/orders/${paid.saleId}/receipt`),receiptBefore);
    });
    await t.test('category rename/merge/version/archive and outlet references are explicit without stock effects',async()=>{
      const owner=await fixture(),source=await confirmed(owner,'catalog.category.create',{name:'Beverages'}),target=await confirmed(owner,'catalog.category.create',{name:'Drinks'});
      await confirmed(owner,'catalog.category.create',{name:'beverages'});
      const active=await create(owner,{category:'Beverages'}),archived=await create(owner,{category:'Beverages'});assert.equal((await activate(owner,archived,false)).status,'CONFIRMED');
      const before=await evidence(owner);
      denied(await submit(owner,'catalog.category.set_active',{categoryId:source.categoryId,active:false,reason:'Must retain active products'},{['category:'+source.categoryId]:1}),'CATEGORY_IN_USE');
      await confirmed(owner,'catalog.category.update',{categoryId:source.categoryId,name:'Cold drinks',reason:'Rename reviewed'},{['category:'+source.categoryId]:1});
      denied(await submit(owner,'catalog.category.update',{categoryId:source.categoryId,name:'Stale name',reason:'Stale review'},{['category:'+source.categoryId]:1}),'VERSION_CONFLICT');
      denied(await submit(owner,'catalog.category.update',{categoryId:source.categoryId,name:'Drinks',reason:'Use an explicit merge'},{['category:'+source.categoryId]:2}),'CATEGORY_NAME_CONFLICT');
      denied(await submit(owner,'catalog.category.merge',{sourceCategoryId:source.categoryId,targetCategoryId:target.categoryId,reason:'Stale target review'},{['category:'+source.categoryId]:2,['category:'+target.categoryId]:99}),'VERSION_CONFLICT');
      const merged=await confirmed(owner,'catalog.category.merge',{sourceCategoryId:source.categoryId,targetCategoryId:target.categoryId,reason:'Reviewed duplicate category'},{['category:'+source.categoryId]:2,['category:'+target.categoryId]:1});assert.equal(merged.updatedProducts,2);
      for(const item of [active,archived]){const current=await product(owner,item.id);assert.equal(current.category,'Drinks');assert.equal(current.category_id,target.categoryId);assert.equal(Number(current.version),Number(item.version)+2+(item.id===archived.id?1:0));}
      const categories=(await read(owner,'/catalog/categories?includeArchived=true')).categories;assert.equal(categories.find((entry:any)=>entry.id===source.categoryId).mergedInto,target.categoryId);
      const other=await actor(await scope(owner.tenantId));denied(await submit(other,'catalog.category.update',{categoryId:target.categoryId,name:'Wrong outlet',reason:'Scope boundary'},{['category:'+target.categoryId]:2}),'NOT_FOUND');
      await activate(owner,await product(owner,active.id),false);
      await confirmed(owner,'catalog.category.set_active',{categoryId:target.categoryId,active:false,reason:'Archive empty category'},{['category:'+target.categoryId]:2});
      const retained=await product(owner,archived.id);assert.equal((await update(owner,retained,{name:'Archived description fixed'})).status,'CONFIRMED','an archived product may retain its existing archived category');
      denied(await activate(owner,await product(owner,archived.id),true),'CATEGORY_ARCHIVED');
      assert.deepEqual(await evidence(owner),before);
    });
    await t.test('CSV review of an archived category rejects at apply without partial category, product or stock effects',async()=>{
      const owner=await fixture(),category=await confirmed(owner,'catalog.category.create',{name:'Archived CSV group'});
      await confirmed(owner,'catalog.category.set_active',{categoryId:category.categoryId,active:false,reason:'Retired category'},{['category:'+category.categoryId]:1});
      const preview=await confirmed(owner,'catalog.import.validate',{fileName:'archived-category.csv',csv:'sku,name,unit,price,cost,category\nARCHIVED-CATEGORY-CSV,New item,each,5.00,4.00,Archived CSV group',mapping:{sku:'sku',name:'name',baseUnit:'unit',sellingPrice:'price',costPrice:'cost',category:'category'},mode:'CREATE_ONLY'});assert.equal(preview.status,'READY','preview is format/catalog-row review; category master authority is checked at apply');
      const snapshot=async()=>({financial:await evidence(owner),products:(await db.pool.query('SELECT * FROM catalog.products WHERE tenant_id=$1 ORDER BY id',[owner.tenantId])).rows,categories:(await db.pool.query('SELECT * FROM catalog.categories WHERE tenant_id=$1 ORDER BY id',[owner.tenantId])).rows,audit:(await db.pool.query('SELECT * FROM system.audit_events WHERE tenant_id=$1 ORDER BY id',[owner.tenantId])).rows,outbox:(await db.pool.query('SELECT * FROM system.transactional_outbox WHERE tenant_id=$1 ORDER BY id',[owner.tenantId])).rows});
      const before=await snapshot();denied(await submit(owner,'catalog.import.apply',{batchId:preview.batchId,reviewed:true,acknowledgedWarnings:true},{['import:'+preview.batchId]:1}),'CATEGORY_ARCHIVED');assert.deepEqual(await snapshot(),before);
      assert.match(apiErrorMessage('CATEGORY_ARCHIVED'),/category/i);assert.match(apiErrorMessage('CATEGORY_ARCHIVED'),/active|restore/i);
    });
    await t.test('CSV and direct metadata share rejection/normalization, and stale import review cannot overwrite edits',async()=>{
      const owner=await fixture();
      const mapping={sku:'sku',name:'name',baseUnit:'unit',sellingPrice:'price',costPrice:'cost',taxRatePercent:'tax',category:'category',barcode:'barcode',reorderLevel:'reorder'};
      const csv=(value:Record<string,unknown>)=>'sku,name,unit,price,cost,tax,category,barcode,reorder\n'+['sku','name','baseUnit','sellingPrice','costPrice','tax','category','barcode','reorderLevel'].map(key=>'"'+String(value[key]??'').replaceAll('"','""')+'"').join(',');
      const valid={sku:'PARITY-'+randomUUID().slice(0,8),name:'Parity item',baseUnit:'each',sellingPrice:'5.00',costPrice:'4.00',tax:'16',category:'Case label',barcode:'000000123',reorderLevel:'2.125000'};
      for(const patch of [{sku:'1e10'},{name:'Bad\u0001name'},{baseUnit:'bad\u0001unit'},{barcode:'2E10'},{reorderLevel:'1e3'},{reorderLevel:'0.0000001'},{category:'Bad\u0001category'}]){
        const input={...valid,...patch};
        denied(await submit(owner,'catalog.product.create',{sku:input.sku,name:input.name,baseUnit:input.baseUnit,currency:'KES',sellingPriceMinor:500,costPriceMinor:400,taxRateBps:1600,category:input.category,barcode:input.barcode,reorderLevel:input.reorderLevel}),'VALIDATION_FAILED');
        const preview=await submit(owner,'catalog.import.validate',{fileName:'invalid-parity.csv',csv:csv(input),mapping,mode:'CREATE_ONLY'});
        assert.ok(preview.status!=='CONFIRMED'||preview.value.status!=='READY',JSON.stringify(preview));
      }
      const row=await create(owner,{sku:valid.sku,name:valid.name,category:valid.category,barcode:valid.barcode,reorderLevel:valid.reorderLevel,taxRateBps:1600});
      const review=await confirmed(owner,'catalog.import.validate',{fileName:'review.csv',csv:csv({...valid,name:'Reviewed import name',sellingPrice:'6.00'}),mapping,mode:'UPSERT'});assert.equal(review.status,'READY');
      assert.equal((await update(owner,row,{name:'Concurrent direct name'})).status,'CONFIRMED');const before=await evidence(owner);
      denied(await submit(owner,'catalog.import.apply',{batchId:review.batchId,reviewed:true,acknowledgedWarnings:true},{['import:'+review.batchId]:1}),'IMPORT_STALE');
      assert.equal((await product(owner,row.id)).name,'Concurrent direct name');assert.deepEqual(await evidence(owner),before);
      const staged=await confirmed(owner,'catalog.import.validate',{fileName:'normalized.csv',csv:csv({...valid,sku:'  CSV-'+randomUUID().slice(0,8)+' ',name:'  CSV normalized  ',category:' Case label ',barcode:'000000999',reorderLevel:'2.125000'}),mapping,mode:'CREATE_ONLY'});
      const applied=await confirmed(owner,'catalog.import.apply',{batchId:staged.batchId,reviewed:true,acknowledgedWarnings:true},{['import:'+staged.batchId]:1});assert.equal(applied.createdCount,1);
      const imported=(await db.pool.query("SELECT * FROM catalog.products WHERE tenant_id=$1 AND name='CSV normalized'",[owner.tenantId])).rows[0];assert.equal(imported.category,'Case label');assert.equal(imported.reorder_level,'2.125000');assert.equal(imported.barcode,'000000999');
    });
  });
}
