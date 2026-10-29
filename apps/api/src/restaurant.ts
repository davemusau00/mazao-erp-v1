import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { inReadSnapshot } from './db.js';
import { DomainError, ROLE_PERMISSIONS, type ApiSession, type CommandEnvelope } from './contracts.js';
import { requireCommandAuthority } from './commandAuthorization.js';
import { lockCatalogOutlet } from './catalogMaintenance.js';
import { readHistoryPage, type HistoryQuery } from './historyPagination.js';
import { RESTAURANT_AVAILABILITY, RESTAURANT_LIMITS } from './restaurantContracts.js';

function view(session:ApiSession) {
  if(!ROLE_PERMISSIONS[session.role].includes('restaurant.view'))throw new DomainError('FORBIDDEN','Your role cannot view restaurant setup.',403);
  if(!session.capabilities.includes('restaurant')||!session.capabilities.includes('commerce'))throw new DomainError('CAPABILITY_DISABLED','Restaurant setup requires restaurant and commerce capabilities.',403);
}
function canManage(session:ApiSession) { return ROLE_PERMISSIONS[session.role].includes('restaurant.manage'); }
function expected(envelope:CommandEnvelope,key:string):number {
  const value=envelope.expectedVersions[key];
  if(!Number.isSafeInteger(value)||value<1)throw new DomainError('VALIDATION_FAILED',`Expected ${key} version is required.`);
  return value;
}
function matchVersion(value:unknown,envelope:CommandEnvelope,key:string) {
  const version=expected(envelope,key);
  if(Number(value)!==version)throw new DomainError('VERSION_CONFLICT','Restaurant setup changed. Refresh and review the current record.',409,{currentVersion:Number(value)});
}
function text(value:unknown,label:string,max=100,empty=false):string {
  if(typeof value!=='string'||(!empty&&!value.trim())||value.trim().length>max||/[\u0000-\u001f\u007f]/.test(value))throw new DomainError('VALIDATION_FAILED',`${label} must contain ${empty?'0':'1'} to ${max} characters without control characters.`);
  return value.trim();
}
async function evidence(client:PoolClient,session:ApiSession,envelope:CommandEnvelope,before:unknown,after:unknown) {
  const payload=JSON.stringify({before,after,deviceId:session.deviceId,configurationOnly:true});
  await client.query('INSERT INTO system.audit_events(id,tenant_id,outlet_id,actor_id,command_id,event_type,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[randomUUID(),session.tenantId,session.outletId,session.userId,envelope.commandId,envelope.type,payload]);
  await client.query('INSERT INTO system.transactional_outbox(id,tenant_id,command_id,event_type,payload) VALUES($1,$2,$3,$4,$5::jsonb)',[randomUUID(),session.tenantId,envelope.commandId,envelope.type,payload]);
}
async function lockSetup(client:PoolClient,session:ApiSession) {
  // Always precedes station/section/product locks. This domain never changes
  // stock or catalog membership; shared catalog admission protects menu quotes.
  await lockCatalogOutlet(client,session,'shared');
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('restaurant:'||$1::text||':'||$2::text,0))",[session.tenantId,session.outletId]);
}
const directoryTables={section:'restaurant.sections',table:'restaurant.tables',station:'restaurant.stations'} as const;
async function capacity(client:PoolClient,session:ApiSession,table:string,limit:number) {
  const result=await client.query(`SELECT count(*)::int total FROM ${table} WHERE tenant_id=$1 AND outlet_id=$2`,[session.tenantId,session.outletId]);
  if(result.rows[0].total>=limit)throw new DomainError('RESTAURANT_CAPACITY_EXCEEDED','This restaurant directory has reached its supported capacity. Reuse or restore an existing identity.',409,{limit});
}
async function activeStations(client:PoolClient,session:ApiSession,stationIds:string[],allowInactive=false) {
  if(!stationIds.length)return;
  const result=await client.query('SELECT id FROM restaurant.stations WHERE tenant_id=$1 AND outlet_id=$2 AND id=ANY($3::uuid[]) AND (active OR $4::boolean) ORDER BY id FOR SHARE',[session.tenantId,session.outletId,stationIds,allowInactive]);
  if(result.rowCount!==stationIds.length)throw new DomainError('NOT_FOUND','Choose active preparation stations from this outlet.',404);
}

async function saveDirectory(client:PoolClient,session:ApiSession,envelope:CommandEnvelope,kind:keyof typeof directoryTables) {
  const p=envelope.payload,table=directoryTables[kind],key=`${kind}Id`,recordId=typeof p[key]==='string'?p[key] as string:randomUUID();
  const name=text(p.name,'Name'),active=p.active as boolean;
  let before:Record<string,unknown>|null=null;
  if(p[key]!==undefined) {
    const found=await client.query(`SELECT * FROM ${table} WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3 FOR UPDATE`,[session.tenantId,session.outletId,recordId]);
    if(!found.rowCount)throw new DomainError('NOT_FOUND','Restaurant record was not found at this outlet.',404);
    before=found.rows[0];matchVersion(before!.version,envelope,`${kind}:${recordId}`);
  } else await capacity(client,session,table,RESTAURANT_LIMITS[kind==='section'?'sections':kind==='table'?'tables':'stations']);
  if(kind==='section'&&!active) {
    const used=await client.query('SELECT id FROM restaurant.tables WHERE tenant_id=$1 AND outlet_id=$2 AND section_id=$3 AND active LIMIT 1',[session.tenantId,session.outletId,recordId]);
    if(used.rowCount)throw new DomainError('RESTAURANT_RESOURCE_IN_USE','Move or deactivate the active tables before deactivating their section.',409);
  }
  if(kind==='station'&&!active) {
    const used=await client.query(`SELECT EXISTS(SELECT 1 FROM restaurant.menu_route_stations l JOIN restaurant.menu_routes m USING(tenant_id,outlet_id,product_id)
      WHERE l.tenant_id=$1 AND l.outlet_id=$2 AND l.station_id=$3 AND m.available)
      OR EXISTS(SELECT 1 FROM restaurant.station_assignment_links l JOIN identity.devices d ON d.tenant_id=l.tenant_id AND d.outlet_id=l.outlet_id AND d.id=l.device_id
      WHERE l.tenant_id=$1 AND l.outlet_id=$2 AND l.station_id=$3 AND d.active) in_use`,[session.tenantId,session.outletId,recordId]);
    if(used.rows[0].in_use)throw new DomainError('RESTAURANT_RESOURCE_IN_USE','Withdraw available menu routes and active logical station assignments before deactivating this station.',409);
  }
  if(kind==='table'&&p.sectionId!==null) {
    const canRetainInactive=!active&&before!==null&&before.section_id===p.sectionId;
    const section=await client.query('SELECT id FROM restaurant.sections WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3 AND (active OR $4::boolean) FOR SHARE',[session.tenantId,session.outletId,p.sectionId,canRetainInactive]);
    if(!section.rowCount)throw new DomainError('NOT_FOUND','Choose an active section from this outlet.',404);
  }
  const version=before?Number(before.version)+1:1;
  if(kind==='section') {
    if(before)await client.query('UPDATE restaurant.sections SET name=$4,active=$5,version=version+1 WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3',[session.tenantId,session.outletId,recordId,name,active]);
    else await client.query('INSERT INTO restaurant.sections(id,tenant_id,outlet_id,name,active) VALUES($1,$2,$3,$4,$5)',[recordId,session.tenantId,session.outletId,name,active]);
  } else if(kind==='table') {
    if(before)await client.query('UPDATE restaurant.tables SET name=$4,section_id=$5,seats=$6,active=$7,version=version+1 WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3',[session.tenantId,session.outletId,recordId,name,p.sectionId,p.seats,active]);
    else await client.query('INSERT INTO restaurant.tables(id,tenant_id,outlet_id,name,section_id,seats,active) VALUES($1,$2,$3,$4,$5,$6,$7)',[recordId,session.tenantId,session.outletId,name,p.sectionId,p.seats,active]);
  } else {
    if(before)await client.query('UPDATE restaurant.stations SET name=$4,kind=$5,characters_per_line=$6,active=$7,version=version+1 WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3',[session.tenantId,session.outletId,recordId,name,p.kind,p.charactersPerLine,active]);
    else await client.query('INSERT INTO restaurant.stations(id,tenant_id,outlet_id,name,kind,characters_per_line,active) VALUES($1,$2,$3,$4,$5,$6,$7)',[recordId,session.tenantId,session.outletId,name,p.kind,p.charactersPerLine,active]);
  }
  const result={[key]:recordId,version,active};
  await evidence(client,session,envelope,before,{...p,name,...result});
  return result;
}

async function saveMenu(client:PoolClient,session:ApiSession,envelope:CommandEnvelope) {
  const p=envelope.payload,productId=p.productId as string,stationIds=[...(p.stationIds as string[])].sort();
  const product=await client.query('SELECT id,name,sku,item_kind,version,active,currency,selling_price_minor,tax_rate_bps FROM catalog.products WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3 FOR SHARE',[session.tenantId,session.outletId,productId]);
  if(!product.rowCount)throw new DomainError('NOT_FOUND','Menu item was not found at this outlet.',404);
  matchVersion(product.rows[0].version,envelope,`product:${productId}`);
  const found=await client.query(`SELECT m.*,ARRAY(SELECT station_id FROM restaurant.menu_route_stations l WHERE l.tenant_id=m.tenant_id AND l.outlet_id=m.outlet_id AND l.product_id=m.product_id ORDER BY station_id) station_ids
    FROM restaurant.menu_routes m WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3 FOR UPDATE OF m`,[session.tenantId,session.outletId,productId]);
  const before=found.rows[0]??null;
  const retainInactive=p.available===false&&before!==null&&JSON.stringify(stationIds)===JSON.stringify(before.station_ids);
  await activeStations(client,session,stationIds,retainInactive);
  // Archived catalog identities can only withdraw an existing route. This is
  // cleanup of configuration, never permission to sell an unavailable item.
  if(!product.rows[0].active&&(!before||p.available!==false))throw new DomainError('NOT_FOUND','Choose an active menu item from this outlet.',404);
  if(before)matchVersion(before.version,envelope,`menu:${productId}`);
  else {
    if(Object.hasOwn(envelope.expectedVersions,`menu:${productId}`))throw new DomainError('VERSION_CONFLICT','This menu route no longer matches the reviewed version.',409);
    await capacity(client,session,'restaurant.menu_routes',RESTAURANT_LIMITS.menuRoutes);
  }
  const preparationLabel=text(p.preparationLabel,'Preparation label'),instructions=text(p.instructions,'Instructions',500,true);
  if(before)await client.query('UPDATE restaurant.menu_routes SET preparation_label=$4,instructions=$5,available=$6,version=version+1 WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3',[session.tenantId,session.outletId,productId,preparationLabel,instructions,p.available]);
  else await client.query('INSERT INTO restaurant.menu_routes(tenant_id,outlet_id,product_id,preparation_label,instructions,available) VALUES($1,$2,$3,$4,$5,$6)',[session.tenantId,session.outletId,productId,preparationLabel,instructions,p.available]);
  await client.query('DELETE FROM restaurant.menu_route_stations WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3',[session.tenantId,session.outletId,productId]);
  for(const stationId of stationIds)await client.query('INSERT INTO restaurant.menu_route_stations(tenant_id,outlet_id,product_id,station_id) VALUES($1,$2,$3,$4)',[session.tenantId,session.outletId,productId,stationId]);
  const result={productId,version:before?Number(before.version)+1:1};
  await evidence(client,session,envelope,before,{...p,preparationLabel,instructions,stationIds,...result,reviewedProduct:product.rows[0]});
  return result;
}

async function assignStations(client:PoolClient,session:ApiSession,envelope:CommandEnvelope) {
  const deviceId=envelope.payload.deviceId as string,stationIds=[...(envelope.payload.stationIds as string[])].sort();
  const device=await client.query(`SELECT d.id,d.version,d.active,m.active member_active,u.active user_active FROM identity.devices d JOIN identity.memberships m ON m.tenant_id=d.tenant_id AND m.user_id=d.assigned_user_id
    JOIN identity.users u ON u.id=m.user_id WHERE d.tenant_id=$1 AND d.outlet_id=$2 AND d.id=$3 FOR SHARE OF d,m,u`,[session.tenantId,session.outletId,deviceId]);
  if(!device.rowCount)throw new DomainError('NOT_FOUND','Choose an active logical workspace assignment from this outlet.',404);
  if(stationIds.length&&(!device.rows[0].active||!device.rows[0].member_active||!device.rows[0].user_active))throw new DomainError('NOT_FOUND','Choose an active logical workspace assignment from this outlet.',404);
  matchVersion(device.rows[0].version,envelope,`device:${deviceId}`);
  await activeStations(client,session,stationIds);
  const found=await client.query(`SELECT a.*,ARRAY(SELECT station_id FROM restaurant.station_assignment_links l WHERE l.tenant_id=a.tenant_id AND l.outlet_id=a.outlet_id AND l.device_id=a.device_id ORDER BY station_id) station_ids
    FROM restaurant.station_assignments a WHERE tenant_id=$1 AND outlet_id=$2 AND device_id=$3 FOR UPDATE OF a`,[session.tenantId,session.outletId,deviceId]);
  const before=found.rows[0]??null;
  if(!before&&(!device.rows[0].active||!device.rows[0].member_active||!device.rows[0].user_active))throw new DomainError('NOT_FOUND','An inactive workspace can only have an existing station assignment removed.',404);
  if(before)matchVersion(before.version,envelope,`stationAssignment:${deviceId}`);
  else if(Object.hasOwn(envelope.expectedVersions,`stationAssignment:${deviceId}`))throw new DomainError('VERSION_CONFLICT','This logical station assignment no longer matches the reviewed version.',409);
  if(before)await client.query('UPDATE restaurant.station_assignments SET version=version+1,device_version=$4 WHERE tenant_id=$1 AND outlet_id=$2 AND device_id=$3',[session.tenantId,session.outletId,deviceId,device.rows[0].version]);
  else await client.query('INSERT INTO restaurant.station_assignments(tenant_id,outlet_id,device_id,device_version) VALUES($1,$2,$3,$4)',[session.tenantId,session.outletId,deviceId,device.rows[0].version]);
  await client.query('DELETE FROM restaurant.station_assignment_links WHERE tenant_id=$1 AND outlet_id=$2 AND device_id=$3',[session.tenantId,session.outletId,deviceId]);
  for(const stationId of stationIds)await client.query('INSERT INTO restaurant.station_assignment_links(tenant_id,outlet_id,device_id,station_id) VALUES($1,$2,$3,$4)',[session.tenantId,session.outletId,deviceId,stationId]);
  const result={deviceId,version:before?Number(before.version)+1:1};
  await evidence(client,session,envelope,before,{...result,stationIds,deviceVersion:Number(device.rows[0].version),physicalEnrollment:false});
  return result;
}

export async function executeRestaurantCommand(client:PoolClient,session:ApiSession,envelope:CommandEnvelope) {
  requireCommandAuthority(session,envelope.type);
  await lockSetup(client,session);
  try {
    if(envelope.type==='restaurant.section.save')return await saveDirectory(client,session,envelope,'section');
    if(envelope.type==='restaurant.table.save')return await saveDirectory(client,session,envelope,'table');
    if(envelope.type==='restaurant.station.save')return await saveDirectory(client,session,envelope,'station');
    if(envelope.type==='restaurant.menu.save')return await saveMenu(client,session,envelope);
    if(envelope.type==='restaurant.station.assign')return await assignStations(client,session,envelope);
    throw new DomainError('VALIDATION_FAILED','Unsupported restaurant setup command.');
  } catch(error) {
    if((error as {code?:string}).code==='23505')throw new DomainError('RESTAURANT_IDENTITY_CONFLICT','This name already belongs to a restaurant record at this outlet. Edit or restore that identity.',409);
    throw error;
  }
}

async function productPage(client:PoolClient,session:ApiSession,query:HistoryQuery) {
  const result=await readHistoryPage(client,session,'restaurant-products',query,`SELECT p.id,p.sku,p.name,p.item_kind,p.version,p.active,p.currency,p.selling_price_minor,p.tax_rate_bps,p.created_at sort_at,
    p.name||' '||p.sku search_text FROM catalog.products p WHERE p.tenant_id=$1 AND p.outlet_id=$2 AND p.active`,[session.tenantId,session.outletId]);
  return {products:result.rows.map(row=>({id:row.id,sku:row.sku,name:row.name,itemKind:row.item_kind,version:Number(row.version),active:row.active,currency:row.currency,sellingPriceMinor:Number(row.selling_price_minor),taxRateBps:row.tax_rate_bps})),page:result.page};
}
export async function listRestaurantProducts(session:ApiSession,query:HistoryQuery={}) {
  view(session);
  if(!canManage(session))throw new DomainError('FORBIDDEN','Your role cannot configure menu routing.',403);
  return inReadSnapshot(client=>productPage(client,session,query));
}
export async function getRestaurantConfiguration(session:ApiSession) {
  view(session);
  return inReadSnapshot(async client=>{
    const scope=[session.tenantId,session.outletId],manage=canManage(session),assignDevices=manage&&ROLE_PERMISSIONS[session.role].includes('devices.manage');
    const sections=await client.query('SELECT id,name,active,version FROM restaurant.sections WHERE tenant_id=$1 AND outlet_id=$2 ORDER BY lower(name),id',scope);
    const tables=await client.query('SELECT id,name,section_id,seats,active,version FROM restaurant.tables WHERE tenant_id=$1 AND outlet_id=$2 ORDER BY lower(name),id',scope);
    const stations=await client.query('SELECT id,name,kind,characters_per_line,active,version FROM restaurant.stations WHERE tenant_id=$1 AND outlet_id=$2 ORDER BY lower(name),id',scope);
    const menus=await client.query(`SELECT m.*,p.name product_name,p.sku,p.item_kind,p.version product_version,p.active product_active,p.currency,p.selling_price_minor,p.tax_rate_bps,
      NOT EXISTS(SELECT 1 FROM restaurant.menu_route_stations l JOIN restaurant.stations s ON s.tenant_id=l.tenant_id AND s.outlet_id=l.outlet_id AND s.id=l.station_id
        WHERE l.tenant_id=m.tenant_id AND l.outlet_id=m.outlet_id AND l.product_id=m.product_id AND NOT s.active) stations_active,
      ARRAY(SELECT station_id FROM restaurant.menu_route_stations l WHERE l.tenant_id=m.tenant_id AND l.outlet_id=m.outlet_id AND l.product_id=m.product_id ORDER BY station_id) station_ids
      FROM restaurant.menu_routes m JOIN catalog.products p ON p.tenant_id=m.tenant_id AND p.outlet_id=m.outlet_id AND p.id=m.product_id
      WHERE m.tenant_id=$1 AND m.outlet_id=$2 ORDER BY lower(p.name),m.product_id`,scope);
    const assignments=manage?await client.query(`SELECT a.device_id,a.version,a.device_version,
      d.active AND m.active AND u.active AND d.version=a.device_version
        AND EXISTS(SELECT 1 FROM restaurant.station_assignment_links l WHERE l.tenant_id=a.tenant_id AND l.outlet_id=a.outlet_id AND l.device_id=a.device_id)
        AND NOT EXISTS(SELECT 1 FROM restaurant.station_assignment_links l JOIN restaurant.stations s ON s.tenant_id=l.tenant_id AND s.outlet_id=l.outlet_id AND s.id=l.station_id
          WHERE l.tenant_id=a.tenant_id AND l.outlet_id=a.outlet_id AND l.device_id=a.device_id AND NOT s.active) effective_active,
      ARRAY(SELECT station_id FROM restaurant.station_assignment_links l WHERE l.tenant_id=a.tenant_id AND l.outlet_id=a.outlet_id AND l.device_id=a.device_id ORDER BY station_id) station_ids
      FROM restaurant.station_assignments a JOIN identity.devices d ON d.tenant_id=a.tenant_id AND d.outlet_id=a.outlet_id AND d.id=a.device_id
      JOIN identity.memberships m ON m.tenant_id=d.tenant_id AND m.user_id=d.assigned_user_id JOIN identity.users u ON u.id=m.user_id
      WHERE a.tenant_id=$1 AND a.outlet_id=$2 ORDER BY a.device_id`,scope):{rows:[]};
    const devices=assignDevices?await client.query('SELECT id,label,active,version FROM identity.devices WHERE tenant_id=$1 AND outlet_id=$2 ORDER BY lower(label),id',scope):{rows:[]};
    const candidates=manage?await productPage(client,session,{}):null;
    return {configuration:{
      sections:sections.rows.map(row=>({...row,version:Number(row.version)})),
      tables:tables.rows.map(row=>({id:row.id,name:row.name,sectionId:row.section_id,seats:row.seats,active:row.active,version:Number(row.version)})),
      stations:stations.rows.map(row=>({id:row.id,name:row.name,kind:row.kind,charactersPerLine:row.characters_per_line,active:row.active,version:Number(row.version)})),
      menuRoutes:menus.rows.map(row=>({productId:row.product_id,stationIds:row.station_ids,preparationLabel:row.preparation_label,instructions:row.instructions,available:row.available,effectiveAvailable:row.available&&row.product_active&&row.stations_active,version:Number(row.version),productName:row.product_name,sku:row.sku,itemKind:row.item_kind,productVersion:Number(row.product_version),productActive:row.product_active,currency:row.currency,sellingPriceMinor:Number(row.selling_price_minor),taxRateBps:row.tax_rate_bps})),
      stationAssignments:assignments.rows.map(row=>({deviceId:row.device_id,stationIds:row.station_ids,version:Number(row.version),deviceVersion:Number(row.device_version),effectiveActive:row.effective_active})),
      devices:devices.rows.map(row=>({id:row.id,label:row.label,active:row.active,version:Number(row.version)})),
      products:candidates?.products??[],productPage:candidates?.page??null,
      permissions:{manage,assignDevices},limits:RESTAURANT_LIMITS,availability:RESTAURANT_AVAILABILITY,
    }};
  });
}
