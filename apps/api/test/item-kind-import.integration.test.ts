import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { CommandEnvelope } from '../src/contracts.js';
import { stableStringify } from '../src/security.js';

const databaseUrl=process.env.TEST_DATABASE_URL;
if(!databaseUrl)test('item-kind CSV write and historical-read acceptance',{skip:'Requires disposable TEST_DATABASE_URL.'},()=>{});
else{
  process.env.DATABASE_URL=databaseUrl;process.env.APP_ORIGINS??='http://localhost:3000';
  const [{buildApp},{hashPassword},db]=await Promise.all([import('../src/app.js'),import('../src/security.js'),import('../src/db.js')]);
  const password=`Disposable-kind-import-${randomUUID()}`,passwordHash=await hashPassword(password);
  type Actor={tenantId:string;outletId:string;userId:string;deviceId:string;headers:Record<string,string>};
  const columns=['sku','name','unit','kind','price','cost','opening','openingCost'];
  const mapping={sku:'sku',name:'name',baseUnit:'unit',itemKind:'kind',sellingPrice:'price',costPrice:'cost',openingQuantity:'opening',openingUnitCost:'openingCost'};
  const csv=(rows:string[][])=>[columns,...rows].map(cells=>cells.map(value=>`"${value.replaceAll('"','""')}"`).join(',')).join('\n');
  let loginAddress=0;

  test('CSV kinds preserve stock authority, reviewed state, legacy reports and historical read scopes',{timeout:180_000},async t=>{
    const app=buildApp({logger:{level:'error'}});await app.ready();t.after(async()=>{await app.close();await db.pool.end();});
    async function actor(capabilities=['commerce'],scope?:{tenantId:string;outletId:string}):Promise<Actor>{
      const tenantId=scope?.tenantId??randomUUID(),outletId=scope?.outletId??randomUUID(),userId=randomUUID(),deviceId=randomUUID(),email=`kind-import-${userId}@example.invalid`;
      if(!scope){
        await db.pool.query("INSERT INTO core.tenants(id,name,currency,time_zone,business_profile) VALUES($1,'Disposable kind import','KES','Africa/Nairobi',$2::jsonb)",[tenantId,JSON.stringify({taxPolicy:{calculation:'exclusive',defaultRateBps:0,label:'Tax',reviewed:true}})]);
        await db.pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Kind import outlet','Africa/Nairobi')",[outletId,tenantId]);
        for(const capability of capabilities)await db.pool.query('INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,$2)',[tenantId,capability]);
      }
      await db.pool.query("INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,'Kind import operator')",[userId,email,passwordHash]);
      await db.pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",[tenantId,userId]);
      await db.pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Disposable kind import assignment')",[deviceId,tenantId,outletId,userId]);
      const login=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:`198.51.107.${++loginAddress}`,payload:{email,password,deviceId}});assert.equal(login.statusCode,200,login.body);
      const cookies=login.headers['set-cookie'],cookie=(Array.isArray(cookies)?cookies:[cookies]).filter((value):value is string=>typeof value==='string').map(value=>value.split(';',1)[0]).join('; ');
      return {tenantId,outletId,userId,deviceId,headers:{cookie,origin:process.env.APP_ORIGINS!.split(',')[0],'x-csrf-token':login.json().csrfToken}};
    }
    const envelope=(owner:Actor,type:string,payload:Record<string,unknown>,expectedVersions:Record<string,number>={}):CommandEnvelope=>({protocolVersion:1,commandId:randomUUID(),tenantId:owner.tenantId,deviceId:owner.deviceId,type,occurredAt:new Date().toISOString(),expectedVersions,payload});
    const send=async(owner:Actor,command:CommandEnvelope)=>(await app.inject({method:'POST',url:'/api/v1/commands',headers:owner.headers,payload:command})).json();
    const submit=(owner:Actor,type:string,payload:Record<string,unknown>,versions:Record<string,number>={})=>send(owner,envelope(owner,type,payload,versions));
    async function confirmed(owner:Actor,type:string,payload:Record<string,unknown>,versions:Record<string,number>={}){const result=await submit(owner,type,payload,versions);assert.equal(result.status,'CONFIRMED',JSON.stringify(result));return result.value;}
    const denied=(result:any,code:string)=>{assert.ok(result.status==='REJECTED'||result.status==='CONFLICT'||result.error,JSON.stringify(result));assert.equal(result.code??result.error?.code,code,JSON.stringify(result));};
    async function read(owner:Actor,path:string){const response=await app.inject({url:'/api/v1'+path,headers:owner.headers});assert.equal(response.statusCode,200,response.body);return response.json();}
    async function stage(owner:Actor,source:string,mode='CREATE_ONLY',customMapping:Record<string,string>=mapping,fileName='kinds.csv'){
      const result=await confirmed(owner,'catalog.import.validate',{fileName,csv:source,mapping:customMapping,mode});
      return (await read(owner,'/catalog/imports/'+result.batchId)).batch;
    }
    const applyCommand=(owner:Actor,batch:any)=>envelope(owner,'catalog.import.apply',{batchId:batch.id,reviewed:true,acknowledgedWarnings:true},{['import:'+batch.id]:batch.version});
    async function evidence(owner:Actor){
      const result:Record<string,unknown>={};
      for(const table of ['inventory.balances','inventory.movements','finance.journal_entries','finance.journal_lines'])result[table]=(await db.pool.query(`SELECT to_jsonb(evidence_row) evidence FROM ${table} evidence_row WHERE tenant_id=$1 ORDER BY to_jsonb(evidence_row)::text`,[owner.tenantId])).rows;
      return result;
    }
    async function makeLegacy(owner:Actor,batchId:string){
      const report=(await db.pool.query('SELECT validation_report FROM catalog.product_import_batches WHERE tenant_id=$1 AND id=$2',[owner.tenantId,batchId])).rows[0].validation_report;
      for(const row of report.rows)if(row.normalized)delete row.normalized.itemKind;
      const digest=createHash('sha256').update(stableStringify(report)).digest('hex');
      await db.pool.query('UPDATE catalog.product_import_batches SET validation_report=$3::jsonb,validation_sha256=$4 WHERE tenant_id=$1 AND id=$2',[owner.tenantId,batchId,JSON.stringify(report),digest]);
      return {report,digest};
    }

    await t.test('commerce-only service and prepared apply creates no stock records or journals and replays once',async()=>{
      const owner=await actor(),before=await evidence(owner);
      const batch=await stage(owner,csv([['CONSULT','Consultation','hour','SERVICE','2500','0','0',''],['MEAL','Prepared meal','each','PREPARED','500','0','0','']]));
      assert.equal(batch.status,'READY');assert.deepEqual(batch.warnings,[]);
      const command=applyCommand(owner,batch),result=await send(owner,command);assert.equal(result.status,'CONFIRMED',JSON.stringify(result));
      assert.equal(result.value.createdCount,2);assert.deepEqual(await send(owner,command),result);
      const products=(await db.pool.query('SELECT sku,item_kind FROM catalog.products WHERE tenant_id=$1 ORDER BY sku',[owner.tenantId])).rows;
      assert.deepEqual(products,[{sku:'CONSULT',item_kind:'SERVICE'},{sku:'MEAL',item_kind:'PREPARED'}]);
      assert.deepEqual(await evidence(owner),before);
      const stored=(await db.pool.query('SELECT required_capabilities FROM system.commands WHERE tenant_id=$1 AND command_id=$2',[owner.tenantId,command.commandId])).rows[0];
      assert.deepEqual(stored.required_capabilities,['commerce']);
    });

    await t.test('nonstock explicit opening cost, including zero, and positive opening quantity cannot apply',async()=>{
      const owner=await actor(),before=await evidence(owner);
      for(const kind of ['SERVICE','PREPARED'])for(const [quantity,cost] of [['0','0'],['1','']]){
        const batch=await stage(owner,csv([['INVALID-'+randomUUID().slice(0,8),'Nonstock opening','each',kind,'50','0',quantity,cost]]));
        assert.equal(batch.status,'INVALID');assert.ok(batch.errors.some((error:any)=>error.code==='NON_STOCK_OPENING_INVENTORY'));
        denied(await send(owner,applyCommand(owner,batch)),'IMPORT_INVALID');
      }
      assert.equal((await db.pool.query('SELECT count(*)::int n FROM catalog.products WHERE tenant_id=$1',[owner.tenantId])).rows[0].n,0);
      assert.deepEqual(await evidence(owner),before);
      const legacySource='sku,name,unit,price,cost\nDEFAULT-GOOD,Default goods,each,5,2';
      denied(await submit(owner,'catalog.import.validate',{fileName:'default-goods.csv',csv:legacySource,mapping:{sku:'sku',name:'name',baseUnit:'unit',sellingPrice:'price',costPrice:'cost'},mode:'CREATE_ONLY'}),'CAPABILITY_DISABLED');
    });

    await t.test('legacy READY reports without itemKind apply as stocked and preserve report bytes/hash',async()=>{
      const owner=await actor(['commerce','inventory']);
      const source='sku,name,unit,price,cost,opening,openingCost\nLEGACY-GOOD,Legacy goods,each,5,2,2,2';
      const legacyMapping={sku:'sku',name:'name',baseUnit:'unit',sellingPrice:'price',costPrice:'cost',openingQuantity:'opening',openingUnitCost:'openingCost'};
      const batch=await stage(owner,source,'CREATE_ONLY',legacyMapping),legacy=await makeLegacy(owner,batch.id);
      const result=await send(owner,applyCommand(owner,batch));assert.equal(result.status,'CONFIRMED',JSON.stringify(result));
      assert.equal(result.value.openingValueMinor,'400');
      const row=(await db.pool.query('SELECT p.item_kind,b.quantity::text,b.inventory_value_minor::text FROM catalog.products p JOIN inventory.balances b ON b.product_id=p.id AND b.tenant_id=p.tenant_id AND b.outlet_id=p.outlet_id WHERE p.tenant_id=$1',[owner.tenantId])).rows[0];
      assert.deepEqual(row,{item_kind:'STOCKED_GOOD',quantity:'2.000000',inventory_value_minor:'400'});
      const stored=(await db.pool.query('SELECT validation_report,validation_sha256 FROM catalog.product_import_batches WHERE tenant_id=$1 AND id=$2',[owner.tenantId,batch.id])).rows[0];
      assert.deepEqual(stored.validation_report,legacy.report);assert.equal(stored.validation_sha256,legacy.digest);
    });

    await t.test('upsert retains service kind and explicit kind changes require review',async()=>{
      const owner=await actor(['commerce','inventory']);
      const created=await stage(owner,csv([['KEEP-SERVICE','Original service','hour','SERVICE','25','0','0','']]));
      assert.equal((await send(owner,applyCommand(owner,created))).status,'CONFIRMED');
      const before=await evidence(owner);
      const preserve=await stage(owner,'sku,name\nKEEP-SERVICE,Reviewed service','UPSERT',{sku:'sku',name:'name'});
      assert.equal(preserve.rows[0].normalized.itemKind,'SERVICE');assert.equal((await send(owner,applyCommand(owner,preserve))).status,'CONFIRMED');
      const changed=await stage(owner,'sku,kind\nKEEP-SERVICE,STOCKED_GOOD','UPSERT',{sku:'sku',itemKind:'kind'});
      assert.equal(changed.status,'INVALID');assert.ok(changed.errors.some((error:any)=>error.code==='ITEM_KIND_CHANGE_REQUIRES_REVIEW'));
      denied(await send(owner,applyCommand(owner,changed)),'IMPORT_INVALID');
      assert.deepEqual(await evidence(owner),before);
      assert.equal((await db.pool.query('SELECT item_kind FROM catalog.products WHERE tenant_id=$1',[owner.tenantId])).rows[0].item_kind,'SERVICE');
    });

    await t.test('reclassification after review makes an old metadata batch stale without changing its product',async()=>{
      const owner=await actor(['commerce','inventory']);
      const product=await confirmed(owner,'catalog.product.create',{sku:'RECLASSIFIED',name:'Original service',baseUnit:'hour',currency:'KES',sellingPriceMinor:2500,costPriceMinor:0,taxRateBps:0,itemKind:'SERVICE'});
      const batch=await stage(owner,'sku,name\nRECLASSIFIED,Old reviewed name','UPSERT',{sku:'sku',name:'name'});
      await confirmed(owner,'catalog.product.change_kind',{productId:product.productId,itemKind:'STOCKED_GOOD',reason:'Reviewed zero-stock goods classification'},{['product:'+product.productId]:1});
      const before=await evidence(owner);
      denied(await send(owner,applyCommand(owner,batch)),'IMPORT_STALE');
      assert.deepEqual(await evidence(owner),before);
      assert.equal((await db.pool.query('SELECT name FROM catalog.products WHERE tenant_id=$1 AND id=$2',[owner.tenantId,product.productId])).rows[0].name,'Original service');
    });

    await t.test('history totals, details and errors use original report kinds and enforce tenant/outlet scope',async()=>{
      const owner=await actor(['commerce','inventory']);
      const service=await stage(owner,csv([['HIST-SERVICE','Historical service','hour','SERVICE','25','0','0','']]),'CREATE_ONLY',mapping,'service-history.csv');
      const prepared=await stage(owner,csv([['HIST-PREP','Historical prepared','each','PREPARED','5','0','0','']]),'CREATE_ONLY',mapping,'prepared-history.csv');
      const goods=await stage(owner,'sku,name,unit,price,cost\nHIST-GOOD,Historical goods,each,5,2','CREATE_ONLY',{sku:'sku',name:'name',baseUnit:'unit',sellingPrice:'price',costPrice:'cost'},'legacy-goods-history.csv');
      await makeLegacy(owner,goods.id);
      const mixed=await stage(owner,csv([['MIX-SERVICE','Mixed service','hour','SERVICE','25','0','0',''],['MIX-GOOD','Mixed goods','each','STOCKED_GOOD','5','2','0','']]),'CREATE_ONLY',mapping,'mixed-history.csv');
      assert.equal((await send(owner,applyCommand(owner,service))).status,'CONFIRMED');
      const serviceProduct=(await db.pool.query("SELECT id FROM catalog.products WHERE tenant_id=$1 AND sku='HIST-SERVICE'",[owner.tenantId])).rows[0];
      await confirmed(owner,'catalog.product.change_kind',{productId:serviceProduct.id,itemKind:'STOCKED_GOOD',reason:'Reviewed reclassification after historical service import'},{['product:'+serviceProduct.id]:1});
      await db.pool.query("DELETE FROM core.tenant_capabilities WHERE tenant_id=$1 AND capability='inventory'",[owner.tenantId]);
      const first=await read(owner,'/catalog/imports?limit=1');assert.equal(first.page.totalCount,2);assert.equal(first.batches.length,1);assert.equal(first.page.hasMore,true);
      const second=await read(owner,'/catalog/imports?limit=1&after='+encodeURIComponent(first.page.nextCursor));assert.equal(second.page.totalCount,2);
      assert.deepEqual([...first.batches,...second.batches].map((batch:any)=>batch.id).sort(),[service.id,prepared.id].sort());
      assert.equal((await read(owner,'/catalog/imports?q=legacy-goods')).page.totalCount,0);
      for(const id of [service.id,prepared.id]){
        assert.equal((await read(owner,'/catalog/imports/'+id)).batch.id,id);
        assert.equal((await app.inject({url:'/api/v1/catalog/imports/'+id+'/errors.csv',headers:owner.headers})).statusCode,200);
      }
      for(const id of [goods.id,mixed.id])for(const suffix of ['','/errors.csv'])assert.equal((await app.inject({url:'/api/v1/catalog/imports/'+id+suffix,headers:owner.headers})).statusCode,403);
      const foreign=await actor();assert.equal((await app.inject({url:'/api/v1/catalog/imports/'+service.id,headers:foreign.headers})).statusCode,404);
      const otherOutlet=randomUUID();await db.pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Other history outlet','Africa/Nairobi')",[otherOutlet,owner.tenantId]);
      const otherOutletActor=await actor([],{tenantId:owner.tenantId,outletId:otherOutlet});
      assert.equal((await app.inject({url:'/api/v1/catalog/imports/'+service.id,headers:otherOutletActor.headers})).statusCode,404);
      await db.pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'inventory')",[owner.tenantId]);
      await db.pool.query("DELETE FROM core.tenant_capabilities WHERE tenant_id=$1 AND capability='commerce'",[owner.tenantId]);
      assert.equal((await read(owner,'/catalog/imports')).page.totalCount,1);
      assert.equal((await read(owner,'/catalog/imports/'+goods.id)).batch.id,goods.id);
      assert.equal((await app.inject({url:'/api/v1/catalog/imports/'+service.id,headers:owner.headers})).statusCode,403,'current stocked classification cannot relabel historical service source authority');
    });
  });
}
