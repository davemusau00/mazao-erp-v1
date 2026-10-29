import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { inReadSnapshot } from './db.js';
import { DomainError, ROLE_PERMISSIONS, type ApiPermission, type ApiSession, type CommandEnvelope } from './contracts.js';
import { requireCommandAuthority } from './commandAuthorization.js';
import { lockCatalogOutlet } from './catalogMaintenance.js';
import { stableStringify } from './security.js';
import { readHistoryPage, type HistoryQuery } from './historyPagination.js';
import { normalizeRestaurantModifiers, RESTAURANT_ORDER_LIMITS } from './restaurantOrderContracts.js';

type Row=Record<string,any>;
type Station={id:string;name:string;kind:'KITCHEN'|'BAR'|'EXPO';version:number;charactersPerLine:number};
const scale=1_000_000n;
const maxMinor=BigInt(Number.MAX_SAFE_INTEGER);
function minor(value:bigint|number|string):number {
  const result=BigInt(value);
  if(result<0n||result>maxMinor)throw new DomainError('VALIDATION_FAILED','Restaurant quoted amount exceeds the supported safe money range.');
  return Number(result);
}
function quantity(value:unknown):bigint {
  if(typeof value!=='string'||!/^\d{1,14}(?:\.\d{1,6})?$/.test(value))throw new DomainError('VALIDATION_FAILED','Quantity must be a positive decimal with up to six decimal places.');
  const [whole,fraction='']=value.split('.'),result=BigInt(whole)*scale+BigInt(fraction.padEnd(6,'0'));
  if(result<=0n)throw new DomainError('VALIDATION_FAILED','Quantity must be greater than zero.');
  return result;
}
function quantityText(value:bigint):string {
  const fraction=(value%scale).toString().padStart(6,'0').replace(/0+$/,'');
  return `${value/scale}${fraction?'.'+fraction:''}`;
}
function text(value:unknown,max:number,required=false):string {
  if(typeof value!=='string'||(required&&!value.trim())||value.trim().length>max||/[\u0000-\u001f\u007f]/.test(value))throw new DomainError('VALIDATION_FAILED','Preparation text is invalid or exceeds its supported length.');
  return value.trim();
}
function access(session:ApiSession,permission:ApiPermission) {
  if(!ROLE_PERMISSIONS[session.role].includes(permission))throw new DomainError('FORBIDDEN','Your role cannot access this restaurant operation.',403);
  if(!session.capabilities.includes('restaurant')||!session.capabilities.includes('commerce'))throw new DomainError('CAPABILITY_DISABLED','Restaurant operations require restaurant and commerce capabilities.',403);
  if(session.onboardingStatus==='SETUP')throw new DomainError('ONBOARDING_REQUIRED','Complete the owner-reviewed setup before opening restaurant orders.',403);
}
function expected(envelope:CommandEnvelope,key:string):number {
  const value=envelope.expectedVersions[key];
  if(!Number.isSafeInteger(value)||value<1)throw new DomainError('VALIDATION_FAILED',`Expected ${key} version is required.`);
  return value;
}
function matchVersion(value:unknown,envelope:CommandEnvelope,key:string) {
  if(Number(value)!==expected(envelope,key))throw new DomainError('VERSION_CONFLICT','The order or menu changed. Review its current server version before submitting again.',409,{key,currentVersion:Number(value)});
}
function asIso(value:any):string { return value instanceof Date?value.toISOString():String(value); }
async function lockOrders(client:PoolClient,session:ApiSession) {
  await lockCatalogOutlet(client,session,'shared');
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('restaurant:'||$1::text||':'||$2::text,0))",[session.tenantId,session.outletId]);
}
async function evidence(client:PoolClient,session:ApiSession,envelope:CommandEnvelope,before:unknown,after:unknown) {
  const payload=JSON.stringify({before,after,actorId:session.userId,deviceId:session.deviceId,stockConsumption:false,payment:false});
  await client.query('INSERT INTO system.audit_events(id,tenant_id,outlet_id,actor_id,command_id,event_type,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[randomUUID(),session.tenantId,session.outletId,session.userId,envelope.commandId,envelope.type,payload]);
  await client.query('INSERT INTO system.transactional_outbox(id,tenant_id,command_id,event_type,payload) VALUES($1,$2,$3,$4,$5::jsonb)',[randomUUID(),session.tenantId,envelope.commandId,envelope.type,payload]);
}
function result(order:Row) { return {orderId:order.id,version:Number(order.version),status:order.status,held:order.held,fireRevision:Number(order.fire_revision)}; }
async function lockedOrder(client:PoolClient,session:ApiSession,envelope:CommandEnvelope) {
  const found=await client.query('SELECT * FROM restaurant.orders WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3 FOR UPDATE',[session.tenantId,session.outletId,envelope.payload.orderId]);
  if(!found.rowCount)throw new DomainError('NOT_FOUND','Restaurant order was not found at this outlet.',404);
  const order=found.rows[0];matchVersion(order.version,envelope,`order:${order.id}`);
  if(order.status==='CANCELLED')throw new DomainError('RESTAURANT_ORDER_CANCELLED','This draft order was cancelled and cannot be changed.',409);
  return order;
}
const quoteSql=`SELECT m.product_id id,m.preparation_label,m.instructions,m.available,m.version menu_version,m.created_at,
  p.name,p.sku,p.item_kind,p.base_unit,p.currency,p.selling_price_minor,p.tax_rate_bps,p.version product_version,p.active product_active,
  coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'kind',s.kind,'version',s.version,'charactersPerLine',s.characters_per_line) ORDER BY s.id)
    FROM restaurant.menu_route_stations l JOIN restaurant.stations s ON s.tenant_id=l.tenant_id AND s.outlet_id=l.outlet_id AND s.id=l.station_id
    WHERE l.tenant_id=m.tenant_id AND l.outlet_id=m.outlet_id AND l.product_id=m.product_id),'[]'::jsonb) stations,
  NOT EXISTS(SELECT 1 FROM restaurant.menu_route_stations l JOIN restaurant.stations s ON s.tenant_id=l.tenant_id AND s.outlet_id=l.outlet_id AND s.id=l.station_id
    WHERE l.tenant_id=m.tenant_id AND l.outlet_id=m.outlet_id AND l.product_id=m.product_id AND NOT s.active) stations_active
  FROM restaurant.menu_routes m JOIN catalog.products p ON p.tenant_id=m.tenant_id AND p.outlet_id=m.outlet_id AND p.id=m.product_id
  WHERE m.tenant_id=$1 AND m.outlet_id=$2`;
function quote(row:Row) {
  const stations=(row.stations as Station[]).map(station=>({...station,version:Number(station.version)}));
  return {productId:row.id,productName:row.name,sku:row.sku,itemKind:row.item_kind,baseUnit:row.base_unit,currency:row.currency,sellingPriceMinor:minor(row.selling_price_minor),taxRateBps:row.tax_rate_bps,
    productVersion:Number(row.product_version),menuVersion:Number(row.menu_version),preparationLabel:row.preparation_label,instructions:row.instructions,stationIds:stations.map(station=>station.id),stations,
    effectiveAvailable:Boolean(row.available&&row.product_active&&row.stations_active&&stations.length)};
}
async function currentQuotes(client:PoolClient,session:ApiSession,productIds:string[]) {
  if(!productIds.length)return [];
  const rows=await client.query(`${quoteSql} AND m.product_id=ANY($3::uuid[]) ORDER BY m.product_id`,[session.tenantId,session.outletId,productIds]);
  return rows.rows.map(quote);
}
function checkQuote(value:ReturnType<typeof quote>,envelope:CommandEnvelope,currency:string) {
  if(!value.effectiveAvailable)throw new DomainError('RESTAURANT_MENU_UNAVAILABLE','A menu item or preparation station is unavailable. Review the order before sending it.',409,{productId:value.productId});
  if(value.currency!==currency)throw new DomainError('VALIDATION_FAILED','The menu price currency differs from this order.');
  matchVersion(value.productVersion,envelope,`product:${value.productId}`);
  matchVersion(value.menuVersion,envelope,`menu:${value.productId}`);
  for(const station of value.stations)matchVersion(station.version,envelope,`station:${station.id}`);
}
function lineDto(row:Row) {
  return {id:row.id,productId:row.product_id,sku:row.sku_snapshot,name:row.name_snapshot,itemKind:row.item_kind_snapshot,baseUnit:row.base_unit_snapshot,currency:row.currency,quantity:quantityText(quantity(row.quantity)),
    unitPriceMinor:minor(row.unit_price_minor),taxRateBps:row.tax_rate_bps,lineSubtotalMinor:minor(row.line_subtotal_minor),lineTaxMinor:minor(row.line_tax_minor),productVersion:Number(row.product_version),menuVersion:Number(row.menu_version),
    preparationLabel:row.preparation_label,preparationInstructions:row.preparation_instructions,modifiers:row.modifiers as string[],instructions:row.instructions,stations:row.station_snapshots as Station[],fireRevision:row.fire_revision===null?null:Number(row.fire_revision),createdAt:asIso(row.created_at)};
}
async function liveLines(client:PoolClient,session:ApiSession,orderId:string) {
  return (await client.query('SELECT * FROM restaurant.order_lines WHERE tenant_id=$1 AND outlet_id=$2 AND order_id=$3 AND removed_at IS NULL ORDER BY created_at,id',[session.tenantId,session.outletId,orderId])).rows;
}
async function createOrder(client:PoolClient,session:ApiSession,envelope:CommandEnvelope) {
  const label=text(envelope.payload.serviceLabel,100,true),tableId=envelope.payload.tableId as string|null;
  const capacity=await client.query("SELECT count(*)::int total FROM restaurant.orders WHERE tenant_id=$1 AND outlet_id=$2 AND status<>'CANCELLED'",[session.tenantId,session.outletId]);
  if(capacity.rows[0].total>=RESTAURANT_ORDER_LIMITS.openOrders)throw new DomainError('RESTAURANT_ORDER_CAPACITY_EXCEEDED','This outlet has reached its supported open-tab capacity. Cancel unused unfired drafts before opening another tab.',409,RESTAURANT_ORDER_LIMITS);
  let tableName:string|null=null;
  if(tableId) {
    const table=await client.query(`SELECT t.name,t.version FROM restaurant.tables t LEFT JOIN restaurant.sections s ON s.tenant_id=t.tenant_id AND s.outlet_id=t.outlet_id AND s.id=t.section_id
      WHERE t.tenant_id=$1 AND t.outlet_id=$2 AND t.id=$3 AND t.active AND (t.section_id IS NULL OR s.active) FOR SHARE OF t`,[session.tenantId,session.outletId,tableId]);
    if(!table.rowCount)throw new DomainError('NOT_FOUND','Choose an active table at this outlet.',404);
    matchVersion(table.rows[0].version,envelope,`table:${tableId}`);tableName=table.rows[0].name;
  }
  const currency=(await client.query('SELECT currency FROM core.tenants WHERE id=$1',[session.tenantId])).rows[0].currency;
  const id=randomUUID();
  const inserted=await client.query(`INSERT INTO restaurant.orders(id,tenant_id,outlet_id,table_id,table_name_snapshot,service_label,owner_id,owner_name_snapshot,created_by_device_id,currency)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[id,session.tenantId,session.outletId,tableId,tableName,label,session.userId,session.fullName,session.deviceId,currency]);
  const value=result(inserted.rows[0]);await evidence(client,session,envelope,null,{...inserted.rows[0],...value});return value;
}
async function saveOrder(client:PoolClient,session:ApiSession,envelope:CommandEnvelope) {
  const order=await lockedOrder(client,session,envelope),before=await liveLines(client,session,order.id),drafts=before.filter(line=>line.fire_revision===null),fired=before.filter(line=>line.fire_revision!==null),rawLines=envelope.payload.lines as Row[];
  if(fired.length+rawLines.length>RESTAURANT_ORDER_LIMITS.linesPerOrder)throw new DomainError('RESTAURANT_ORDER_CAPACITY_EXCEEDED','An order supports at most 100 current lines. Fired lines remain part of this order.',409);
  const ids=rawLines.filter(line=>line.lineId!==undefined).map(line=>line.lineId as string);
  if(new Set(ids).size!==ids.length)throw new DomainError('VALIDATION_FAILED','An unfired line can appear only once in a draft save.');
  const quotes=await currentQuotes(client,session,[...new Set(rawLines.map(line=>line.productId as string))]),byProduct=new Map(quotes.map(value=>[value.productId,value]));
  const nextLines:Row[]=[];
  for(const raw of rawLines) {
    const existing=raw.lineId?before.find(line=>line.id===raw.lineId):null;
    if(raw.lineId&&!existing)throw new DomainError('NOT_FOUND','A draft line was not found in this order.',404);
    if(existing&&existing.fire_revision!==null)throw new DomainError('RESTAURANT_FIRED_LINES_IMMUTABLE','Sent lines cannot be edited or removed. Add a new unsent line instead.',409);
    if(existing&&existing.product_id!==raw.productId)throw new DomainError('VALIDATION_FAILED','An existing draft line cannot change its item identity. Remove it and add a new line.');
    const reviewed=byProduct.get(raw.productId);
    if(!reviewed)throw new DomainError('NOT_FOUND','A menu item was not found at this outlet.',404);
    checkQuote(reviewed,envelope,order.currency);
    const micros=quantity(raw.quantity),subtotal=(BigInt(reviewed.sellingPriceMinor)*micros+scale/2n)/scale,tax=(subtotal*BigInt(reviewed.taxRateBps)+5_000n)/10_000n;
    nextLines.push({id:existing?.id??randomUUID(),productId:reviewed.productId,sku:reviewed.sku,name:reviewed.productName,itemKind:reviewed.itemKind,baseUnit:reviewed.baseUnit,currency:reviewed.currency,
      quantity:quantityText(micros),unitPriceMinor:reviewed.sellingPriceMinor,taxRateBps:reviewed.taxRateBps,lineSubtotalMinor:minor(subtotal),lineTaxMinor:minor(tax),productVersion:reviewed.productVersion,menuVersion:reviewed.menuVersion,
      preparationLabel:reviewed.preparationLabel,preparationInstructions:reviewed.instructions,modifiers:normalizeRestaurantModifiers(raw.modifiers),instructions:text(raw.instructions,500),stations:reviewed.stations,existing:Boolean(existing)});
  }
  minor([...fired.map(line=>BigInt(line.line_subtotal_minor)+BigInt(line.line_tax_minor)),...nextLines.map(line=>BigInt(line.lineSubtotalMinor)+BigInt(line.lineTaxMinor))].reduce((sum,value)=>sum+value,0n));
  const historical=Number((await client.query('SELECT count(*)::int total FROM restaurant.order_lines WHERE tenant_id=$1 AND outlet_id=$2 AND order_id=$3',[session.tenantId,session.outletId,order.id])).rows[0].total);
  if(historical+nextLines.filter(line=>!line.existing).length>RESTAURANT_ORDER_LIMITS.historicalLinesPerOrder)throw new DomainError('RESTAURANT_ORDER_CAPACITY_EXCEEDED','This order has reached its retained draft-line history capacity. Create a separately identified tab.',409);
  const retained=new Set(ids);
  for(const old of drafts)if(!retained.has(old.id))await client.query('UPDATE restaurant.order_lines SET removed_at=clock_timestamp() WHERE tenant_id=$1 AND outlet_id=$2 AND order_id=$3 AND id=$4',[session.tenantId,session.outletId,order.id,old.id]);
  for(const line of nextLines) {
    const values=[line.id,session.tenantId,session.outletId,order.id,line.productId,line.sku,line.name,line.itemKind,line.baseUnit,line.currency,line.quantity,line.unitPriceMinor,line.taxRateBps,line.lineSubtotalMinor,line.lineTaxMinor,line.productVersion,line.menuVersion,line.preparationLabel,line.preparationInstructions,JSON.stringify(line.modifiers),line.instructions,JSON.stringify(line.stations)];
    if(line.existing)await client.query(`UPDATE restaurant.order_lines SET sku_snapshot=$6,name_snapshot=$7,item_kind_snapshot=$8,base_unit_snapshot=$9,currency=$10,quantity=$11::numeric,unit_price_minor=$12,tax_rate_bps=$13,line_subtotal_minor=$14,line_tax_minor=$15,
      product_version=$16,menu_version=$17,preparation_label=$18,preparation_instructions=$19,modifiers=$20::jsonb,instructions=$21,station_snapshots=$22::jsonb WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND order_id=$4 AND product_id=$5 AND fire_revision IS NULL`,values);
    else await client.query(`INSERT INTO restaurant.order_lines(id,tenant_id,outlet_id,order_id,product_id,sku_snapshot,name_snapshot,item_kind_snapshot,base_unit_snapshot,currency,quantity,unit_price_minor,tax_rate_bps,line_subtotal_minor,line_tax_minor,product_version,menu_version,preparation_label,preparation_instructions,modifiers,instructions,station_snapshots)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::numeric,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21,$22::jsonb)`,values);
  }
  const instructions=text(envelope.payload.instructions,500);
  const updated=await client.query('UPDATE restaurant.orders SET instructions=$4,version=version+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3 RETURNING *',[session.tenantId,session.outletId,order.id,instructions]);
  const value=result(updated.rows[0]);await evidence(client,session,envelope,{order,lines:before.map(lineDto)},{...value,instructions,lines:nextLines});return value;
}
async function holdOrCancel(client:PoolClient,session:ApiSession,envelope:CommandEnvelope) {
  const order=await lockedOrder(client,session,envelope),reason=text(envelope.payload.reason,500,true),cancel=envelope.type==='restaurant.order.cancel';
  if(cancel&&Number(order.fire_revision)>0)throw new DomainError('RESTAURANT_FIRED_LINES_IMMUTABLE','A fired order needs an accepted kitchen cancellation workflow. It cannot be cancelled here.',409);
  const updated=await client.query(`UPDATE restaurant.orders SET held=$4,status=$5,version=version+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3 RETURNING *`,[session.tenantId,session.outletId,order.id,cancel?false:envelope.payload.held,cancel?'CANCELLED':order.status]);
  const value=result(updated.rows[0]);await evidence(client,session,envelope,order,{...value,reason,scope:'UNSENT_LINES_ONLY'});return value;
}
async function fireOrder(client:PoolClient,session:ApiSession,envelope:CommandEnvelope) {
  const order=await lockedOrder(client,session,envelope);
  if(order.held)throw new DomainError('RESTAURANT_ORDER_HELD','Resume the held unsent lines before sending them to preparation.',409);
  const drafts=(await liveLines(client,session,order.id)).filter(line=>line.fire_revision===null);
  if(!drafts.length)throw new DomainError('RESTAURANT_NO_UNFIRED_LINES','There are no unsent lines to fire. Existing tickets remain unchanged.',409);
  if(order.table_id) {
    const table=await client.query('SELECT id FROM restaurant.tables WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3 AND active FOR SHARE',[session.tenantId,session.outletId,order.table_id]);
    if(!table.rowCount)throw new DomainError('NOT_FOUND','The source table is no longer available.',404);
  }
  const quotes=await currentQuotes(client,session,[...new Set(drafts.map(line=>line.product_id as string))]),byProduct=new Map(quotes.map(value=>[value.productId,value]));
  for(const line of drafts) {
    const reviewed=byProduct.get(line.product_id);
    if(!reviewed)throw new DomainError('RESTAURANT_MENU_UNAVAILABLE','A saved item no longer has a menu route.',409);
    checkQuote(reviewed,envelope,order.currency);
    if(reviewed.productVersion!==Number(line.product_version)||reviewed.menuVersion!==Number(line.menu_version)||stableStringify(reviewed.stations)!==stableStringify(line.station_snapshots))throw new DomainError('VERSION_CONFLICT','A saved menu quote or station changed. Explicitly review and save the unsent lines before firing. Prices are never changed by fire.',409,{productId:line.product_id});
  }
  const batchId=randomUUID(),revision=Number(order.fire_revision)+1,type=revision===1?'NEW':'ADD_ON';
  const original=revision===1?null:(await client.query('SELECT id FROM restaurant.fire_batches WHERE tenant_id=$1 AND outlet_id=$2 AND order_id=$3 AND fire_revision=1',[session.tenantId,session.outletId,order.id])).rows[0]?.id;
  if(revision>1&&!original)throw new DomainError('INTERNAL_ERROR','The original ticket batch is unavailable.',500);
  const firedAt=(await client.query('SELECT clock_timestamp() at')).rows[0].at.toISOString();
  await client.query('INSERT INTO restaurant.fire_batches(id,tenant_id,outlet_id,order_id,fire_revision,ticket_type,original_batch_id,command_id,actor_id,device_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[batchId,session.tenantId,session.outletId,order.id,revision,type,original,envelope.commandId,session.userId,session.deviceId]);
  const stations=new Map<string,Station>();
  for(const line of drafts)for(const station of line.station_snapshots as Station[])stations.set(station.id,station);
  const ticketIds:string[]=[];
  for(const station of [...stations.values()].sort((a,b)=>a.id.localeCompare(b.id))) {
    const ticketId=randomUUID(),routed=drafts.filter(line=>(line.station_snapshots as Station[]).some(value=>value.id===station.id));
    const snapshot={schemaVersion:1,ticketId,batchId,originalBatchId:original,orderId:order.id,fireRevision:revision,type,station,tableId:order.table_id,tableName:order.table_name_snapshot,serviceLabel:order.service_label,
      orderInstructions:order.instructions,waiter:{id:order.owner_id,name:order.owner_name_snapshot},firedBy:{id:session.userId,name:session.fullName},deviceId:session.deviceId,firedAt,
      lines:routed.map(line=>({lineId:line.id,productId:line.product_id,sku:line.sku_snapshot,name:line.name_snapshot,itemKind:line.item_kind_snapshot,baseUnit:line.base_unit_snapshot,quantity:quantityText(quantity(line.quantity)),preparationLabel:line.preparation_label,preparationInstructions:line.preparation_instructions,modifiers:line.modifiers,instructions:line.instructions}))};
    const documentHash=createHash('sha256').update(stableStringify(snapshot)).digest('hex');
    await client.query('INSERT INTO restaurant.tickets(id,tenant_id,outlet_id,order_id,batch_id,station_id,station_name_snapshot,station_kind_snapshot,document_hash,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)',[ticketId,session.tenantId,session.outletId,order.id,batchId,station.id,station.name,station.kind,documentHash,JSON.stringify(snapshot)]);
    for(const line of routed)await client.query('INSERT INTO restaurant.ticket_lines(tenant_id,outlet_id,order_id,ticket_id,order_line_id,station_id) VALUES($1,$2,$3,$4,$5,$6)',[session.tenantId,session.outletId,order.id,ticketId,line.id,station.id]);
    ticketIds.push(ticketId);
  }
  await client.query('UPDATE restaurant.order_lines SET fire_revision=$4 WHERE tenant_id=$1 AND outlet_id=$2 AND order_id=$3 AND removed_at IS NULL AND fire_revision IS NULL',[session.tenantId,session.outletId,order.id,revision]);
  const updated=await client.query("UPDATE restaurant.orders SET status='FIRED',fire_revision=$4,version=version+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3 RETURNING *",[session.tenantId,session.outletId,order.id,revision]);
  const value={...result(updated.rows[0]),batchId,ticketIds,ticketType:type};
  await evidence(client,session,envelope,order,{...value,lineIds:drafts.map(line=>line.id),originalBatchId:original,firedAt});return value;
}
export async function executeRestaurantOrderCommand(client:PoolClient,session:ApiSession,envelope:CommandEnvelope) {
  requireCommandAuthority(session,envelope.type);access(session,'restaurant.order');await lockOrders(client,session);
  try {
    if(envelope.type==='restaurant.order.create')return await createOrder(client,session,envelope);
    if(envelope.type==='restaurant.order.save')return await saveOrder(client,session,envelope);
    if(envelope.type==='restaurant.order.hold'||envelope.type==='restaurant.order.cancel')return await holdOrCancel(client,session,envelope);
    if(envelope.type==='restaurant.order.fire')return await fireOrder(client,session,envelope);
    throw new DomainError('VALIDATION_FAILED','Unsupported restaurant order command.');
  } catch(error) {
    if((error as {code?:string;constraint?:string}).code==='23505'&&(error as {constraint?:string}).constraint==='restaurant_active_tab_label_idx')throw new DomainError('RESTAURANT_TAB_LABEL_EXISTS','This table or takeaway already has a tab with that label. Open the existing tab or choose a distinct label.',409);
    throw error;
  }
}

const orderSource=`SELECT o.*,coalesce(l.line_count,0) line_count,coalesce(l.draft_line_count,0) draft_line_count,coalesce(l.subtotal,0)::text subtotal,coalesce(l.tax,0)::text tax,
  o.created_at sort_at,concat_ws(' ',o.service_label,o.table_name_snapshot,o.owner_name_snapshot,o.status,l.search_lines) search_text
  FROM restaurant.orders o LEFT JOIN LATERAL (SELECT count(*)::int line_count,count(*) FILTER (WHERE fire_revision IS NULL)::int draft_line_count,sum(line_subtotal_minor) subtotal,sum(line_tax_minor) tax,string_agg(name_snapshot||' '||sku_snapshot,' ') search_lines
    FROM restaurant.order_lines WHERE tenant_id=o.tenant_id AND outlet_id=o.outlet_id AND order_id=o.id AND removed_at IS NULL) l ON true
  WHERE o.tenant_id=$1 AND o.outlet_id=$2`;
function summary(row:Row) {
  return {id:row.id,tableId:row.table_id,tableName:row.table_name_snapshot,serviceLabel:row.service_label,ownerId:row.owner_id,ownerName:row.owner_name_snapshot,currency:row.currency,status:row.status,held:row.held,version:Number(row.version),fireRevision:Number(row.fire_revision),lineCount:Number(row.line_count),draftLineCount:Number(row.draft_line_count),subtotalMinor:minor(row.subtotal),taxMinor:minor(row.tax),totalMinor:minor(BigInt(row.subtotal)+BigInt(row.tax)),createdAt:asIso(row.created_at),updatedAt:asIso(row.updated_at)};
}
export async function listRestaurantOrders(session:ApiSession,query:HistoryQuery={}) {
  access(session,'restaurant.order.view');
  return inReadSnapshot(async client=>{
    const result=await readHistoryPage(client,session,'restaurant-orders',query,orderSource,[session.tenantId,session.outletId]);
    return {orders:result.rows.map(summary),page:result.page,limits:RESTAURANT_ORDER_LIMITS};
  });
}
const ticketSource=`SELECT t.*,b.fire_revision,b.ticket_type,t.created_at sort_at,t.snapshot::text search_text FROM restaurant.tickets t JOIN restaurant.fire_batches b ON b.tenant_id=t.tenant_id AND b.outlet_id=t.outlet_id AND b.order_id=t.order_id AND b.id=t.batch_id WHERE t.tenant_id=$1 AND t.outlet_id=$2`;
function ticket(row:Row) { return {id:row.id,orderId:row.order_id,batchId:row.batch_id,fireRevision:Number(row.fire_revision),type:row.ticket_type,stationId:row.station_id,stationName:row.station_name_snapshot,stationKind:row.station_kind_snapshot,createdAt:asIso(row.created_at),documentHash:row.document_hash,snapshot:row.snapshot}; }
async function orderTickets(client:PoolClient,session:ApiSession,orderId:string,query:HistoryQuery={}) {
  const result=await readHistoryPage(client,session,`restaurant-order-tickets:${orderId}`,query,`${ticketSource} AND t.order_id=$3`,[session.tenantId,session.outletId,orderId]);
  return {tickets:result.rows.map(ticket),page:result.page};
}
async function readableOrder(client:PoolClient,session:ApiSession,orderId:string) {
  const found=await client.query(`${orderSource} AND o.id=$3`,[session.tenantId,session.outletId,orderId]);
  if(!found.rowCount)throw new DomainError('NOT_FOUND','Restaurant order was not found at this outlet.',404);
  return found.rows[0];
}
export async function getRestaurantOrder(session:ApiSession,orderId:string) {
  access(session,'restaurant.order.view');
  return inReadSnapshot(async client=>{
    const row=await readableOrder(client,session,orderId),lines=await liveLines(client,session,orderId),history=await orderTickets(client,session,orderId);
    const quotes=await currentQuotes(client,session,[...new Set(lines.filter(line=>line.fire_revision===null).map(line=>line.product_id as string))]);
    return {order:{...summary(row),instructions:row.instructions,lines:lines.map(lineDto)},currentQuotes:quotes,tickets:history.tickets,ticketPage:history.page};
  });
}
export async function listRestaurantOrderTickets(session:ApiSession,orderId:string,query:HistoryQuery={}) {
  access(session,'restaurant.order.view');
  return inReadSnapshot(async client=>{await readableOrder(client,session,orderId);return orderTickets(client,session,orderId,query);});
}
export async function listRestaurantMenu(session:ApiSession,query:HistoryQuery={}) {
  access(session,'restaurant.order.view');
  return inReadSnapshot(async client=>{
    const source=`SELECT q.*,q.created_at sort_at,q.name||' '||q.sku||' '||q.preparation_label search_text FROM (${quoteSql}) q WHERE q.available AND q.product_active AND q.stations_active AND jsonb_array_length(q.stations)>0`;
    const result=await readHistoryPage(client,session,'restaurant-order-menu',query,source,[session.tenantId,session.outletId]);
    return {menu:result.rows.map(quote),page:result.page};
  });
}
async function authorizedStations(client:PoolClient,session:ApiSession) {
  const manager=ROLE_PERMISSIONS[session.role].includes('restaurant.manage');
  // Recheck current identity and device revision in this read snapshot. A
  // browser station ID and historical assignment never grant feed authority.
  const found=await client.query(`SELECT st.id,st.name,st.kind,st.version,st.characters_per_line FROM restaurant.stations st
    WHERE st.tenant_id=$1 AND st.outlet_id=$2 AND st.active
      AND EXISTS(SELECT 1 FROM core.tenant_capabilities WHERE tenant_id=st.tenant_id AND capability='restaurant')
      AND EXISTS(SELECT 1 FROM core.tenant_capabilities WHERE tenant_id=st.tenant_id AND capability='commerce') AND EXISTS(
      SELECT 1 FROM identity.sessions se JOIN identity.devices d ON d.tenant_id=se.tenant_id AND d.outlet_id=se.outlet_id AND d.id=se.device_id
      JOIN identity.memberships m ON m.tenant_id=se.tenant_id AND m.user_id=se.user_id JOIN identity.users u ON u.id=se.user_id
      WHERE se.id=$3 AND se.tenant_id=st.tenant_id AND se.outlet_id=st.outlet_id AND se.user_id=$4 AND se.device_id=$5 AND se.revoked_at IS NULL AND se.expires_at>now()
        AND d.active AND m.active AND u.active AND d.assigned_user_id=se.user_id AND m.role=$6
        AND ($7::boolean OR EXISTS(SELECT 1 FROM restaurant.station_assignments a JOIN restaurant.station_assignment_links l USING(tenant_id,outlet_id,device_id)
          WHERE a.tenant_id=d.tenant_id AND a.outlet_id=d.outlet_id AND a.device_id=d.id AND a.device_version=d.version AND l.station_id=st.id))) ORDER BY lower(st.name),st.id`,[session.tenantId,session.outletId,session.sessionId,session.userId,session.deviceId,session.role,manager]);
  return {stations:found.rows.map(row=>({id:row.id,name:row.name,kind:row.kind,version:Number(row.version),charactersPerLine:row.characters_per_line})),authority:manager?'MANAGER' as const:'LOGICAL_ASSIGNMENT' as const};
}
export async function listRestaurantTicketStations(session:ApiSession) {
  access(session,'restaurant.ticket.view');return inReadSnapshot(client=>authorizedStations(client,session));
}
export async function listRestaurantStationTickets(session:ApiSession,stationId:string,query:HistoryQuery={}) {
  access(session,'restaurant.ticket.view');
  return inReadSnapshot(async client=>{
    const authority=await authorizedStations(client,session);
    if(!authority.stations.some(station=>station.id===stationId))throw new DomainError('FORBIDDEN','This logical workspace does not currently have access to the requested station.',403);
    const result=await readHistoryPage(client,session,`restaurant-station-tickets:${stationId}`,query,`${ticketSource} AND t.station_id=$3`,[session.tenantId,session.outletId,stationId]);
    return {tickets:result.rows.map(ticket),page:result.page,authority:authority.authority};
  });
}
