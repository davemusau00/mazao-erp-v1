import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { CommandEnvelope } from '../src/contracts.js';

if(!process.env.TEST_DATABASE_URL){test('stocked goods and nonstock service acceptance',{skip:'Requires disposable TEST_DATABASE_URL.'},()=>{});}
else{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;process.env.APP_ORIGINS??='http://localhost:3000';
  const [{buildApp},{hashPassword},db]=await Promise.all([import('../src/app.js'),import('../src/security.js'),import('../src/db.js')]);
  const password='Disposable-kind-'+randomUUID(),passwordHash=await hashPassword(password);
  type Actor={tenantId:string;outletId:string;userId:string;deviceId:string;headers:Record<string,string>};let sequence=0;
  test('item types conserve physical stock and original sale evidence across service trading and reviewed corrections',{timeout:180_000},async t=>{
    const app=buildApp({logger:{level:'error'}});await app.ready();t.after(async()=>{await app.close();await db.pool.end();});
    async function fixture(caps=['commerce','inventory'],role='owner'):Promise<Actor>{
      const tenantId=randomUUID(),outletId=randomUUID(),userId=randomUUID(),deviceId=randomUUID(),email=userId+'@example.invalid';
      await db.pool.query("INSERT INTO core.tenants(id,name,currency,time_zone,business_profile) VALUES($1,'Disposable kinds business','KES','Africa/Nairobi',$2::jsonb)",[tenantId,JSON.stringify({taxPolicy:{calculation:'exclusive',defaultRateBps:0,label:'Tax',reviewed:true}})]);
      await db.pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Kinds outlet','Africa/Nairobi')",[outletId,tenantId]);
      for(const cap of caps)await db.pool.query('INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,$2)',[tenantId,cap]);
      await db.pool.query("INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,'Kinds operator')",[userId,email,passwordHash]);
      await db.pool.query('INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenantId,userId,role]);
      await db.pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Disposable kinds assignment')",[deviceId,tenantId,outletId,userId]);
      const login=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:`198.51.100.${++sequence}`,payload:{email,password,deviceId}});assert.equal(login.statusCode,200,login.body);
      const setCookies=login.headers['set-cookie'],cookies=(Array.isArray(setCookies)?setCookies:[setCookies]).filter((value):value is string=>typeof value==='string').map(value=>value.split(';',1)[0]).join('; ');
      return {tenantId,outletId,userId,deviceId,headers:{cookie:cookies,origin:process.env.APP_ORIGINS!.split(',')[0],'x-csrf-token':login.json().csrfToken}};
    }
    const envelope=(a:Actor,type:string,payload:Record<string,unknown>,expectedVersions:Record<string,number>={}):CommandEnvelope=>({protocolVersion:1,commandId:randomUUID(),tenantId:a.tenantId,deviceId:a.deviceId,type,occurredAt:new Date().toISOString(),expectedVersions,payload});
    const send=async(a:Actor,c:CommandEnvelope)=>(await app.inject({method:'POST',url:'/api/v1/commands',headers:a.headers,payload:c})).json();
    async function confirm(a:Actor,type:string,payload:Record<string,unknown>,versions:Record<string,number>={}){const result=await send(a,envelope(a,type,payload,versions));assert.equal(result.status,'CONFIRMED',JSON.stringify(result));return result.value;}
    function denied(result:any,code:string){assert.ok(['REJECTED','CONFLICT'].includes(result.status)||result.error,JSON.stringify(result));assert.equal(result.code??result.error?.code,code,JSON.stringify(result));}
    async function read(a:Actor,path:string){const r=await app.inject({url:'/api/v1'+path,headers:a.headers});assert.equal(r.statusCode,200,r.body);return r.json();}
    const create=(a:Actor,itemKind='STOCKED_GOOD',patch:Record<string,unknown>={})=>confirm(a,'catalog.product.create',{sku:'KIND-'+randomUUID().slice(0,8),name:'Kind '+itemKind,baseUnit:'each',currency:'KES',sellingPriceMinor:1000,costPriceMinor:400,taxRateBps:0,itemKind,...patch});
    const row=async(a:Actor,id:string)=>(await db.pool.query('SELECT * FROM catalog.products WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3',[a.tenantId,a.outletId,id])).rows[0];
    const balance=async(a:Actor,id:string)=>(await db.pool.query('SELECT quantity::text,inventory_value_minor::text,version::text FROM inventory.balances WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3',[a.tenantId,a.outletId,id])).rows[0];
    async function businessEvidence(a:Actor){const result:Record<string,unknown>={};for(const table of ['inventory.balances','inventory.movements','inventory.sale_shortfalls','commerce.orders','commerce.order_lines','commerce.payments','commerce.refunds','commerce.refund_lines','commerce.shifts','finance.journal_entries','finance.journal_lines'])result[table]=(await db.pool.query(`SELECT to_jsonb(x) evidence FROM ${table} x WHERE tenant_id=$1 ORDER BY to_jsonb(x)::text`,[a.tenantId])).rows;return result;}
    const receive=(a:Actor,id:string,quantity='2')=>confirm(a,'inventory.receive',{lines:[{productId:id,quantity,unitCostMinor:400}]});
    const change=(a:Actor,id:string,itemKind:string,version:number,balanceVersion?:number)=>send(a,envelope(a,'catalog.product.change_kind',{productId:id,itemKind,reason:'Reviewed classification correction'},{['product:'+id]:version,...(balanceVersion===undefined?{}:{['balance:'+id]:balanceVersion})}));
    async function sale(a:Actor,id:string,shiftId:string,shiftVersion:number,quantity='1',taxRateBps=0){const price=1000*Number(quantity),amount=price+price*taxRateBps/10000;return confirm(a,'sales.order.settle',{shiftId,lines:[{productId:id,quantity}],tenders:[{method:'CASH',amountMinor:amount,currency:'KES'}]},{['shift:'+shiftId]:shiftVersion,['product:'+id]:Number((await row(a,id)).version)});}

    await t.test('commerce-only service trades taxed decimal quantities, replays once, refunds without inventory and closes the till',async()=>{
      const a=await fixture(['commerce']),service=await create(a,'SERVICE',{taxRateBps:1600,costPriceMinor:999});
      const catalog=await read(a,'/catalog/items'),item=catalog.items[0];assert.equal(item.itemKind,'SERVICE');assert.equal(item.stockTracked,false);for(const key of ['quantity','version','inventoryValueMinor','balanceVersion'])assert.equal(item[key],null,key);assert.equal(await balance(a,service.productId),undefined);
      assert.equal((await read(a,'/configuration')).configuration.readiness.readyForFirstSale,true);
      const shift=await confirm(a,'shift.open',{openingFloatMinor:1000});
      const command=envelope(a,'sales.order.settle',{shiftId:shift.shiftId,lines:[{productId:service.productId,quantity:'1.5'}],tenders:[{method:'CASH',amountMinor:2000,currency:'KES'}]},{['shift:'+shift.shiftId]:1,['product:'+service.productId]:1});
      const paid=await send(a,command);assert.equal(paid.status,'CONFIRMED',JSON.stringify(paid));assert.equal(paid.value.totalMinor,1740);assert.equal(paid.value.changeMinor,260);assert.deepEqual(await send(a,command),paid);
      const line=(await db.pool.query('SELECT * FROM commerce.order_lines WHERE order_id=$1',[paid.value.saleId])).rows[0];assert.equal(line.item_kind_snapshot,'SERVICE');for(const key of ['cogs_minor','cost_price_minor','provisional_cogs_minor'])assert.equal(String(line[key]),'0');
      const receipt=await read(a,'/sales/orders/'+paid.value.saleId+'/receipt');assert.equal(receipt.lines[0].itemKind,'SERVICE');
      const before=await businessEvidence(a);denied(await send(a,envelope(a,'sales.order.refund',{orderId:paid.value.saleId,shiftId:shift.shiftId,reason:'Invalid physical service return',lines:[{orderLineId:line.id,quantity:'0.5',restock:true}]},{['shift:'+shift.shiftId]:2})),'NONSTOCK_RESTOCK_UNAVAILABLE');assert.deepEqual(await businessEvidence(a),before);
      const partial=await confirm(a,'sales.order.refund',{orderId:paid.value.saleId,shiftId:shift.shiftId,reason:'Partial service credit',lines:[{orderLineId:line.id,quantity:'0.5',restock:false}]},{['shift:'+shift.shiftId]:2});assert.equal(partial.totalMinor,580);
      const final=await confirm(a,'sales.order.refund',{orderId:paid.value.saleId,shiftId:shift.shiftId,reason:'Remaining service credit',lines:[{orderLineId:line.id,quantity:'1',restock:false}]},{['shift:'+shift.shiftId]:3});assert.equal(final.totalMinor,1160);
      await confirm(a,'shift.close',{shiftId:shift.shiftId,countedCashMinor:1000},{['shift:'+shift.shiftId]:4});
      const inventory=await db.pool.query('SELECT (SELECT count(*) FROM inventory.balances WHERE tenant_id=$1)::int balances,(SELECT count(*) FROM inventory.movements WHERE tenant_id=$1)::int movements,(SELECT count(*) FROM inventory.sale_shortfalls WHERE tenant_id=$1)::int shortfalls,(SELECT count(*) FROM finance.journal_lines WHERE tenant_id=$1 AND account_code IN (\'INVENTORY\',\'COST_OF_GOODS_SOLD\',\'UNRECORDED_STOCK_CLEARING\'))::int cost_lines',[a.tenantId]);assert.deepEqual(inventory.rows[0],{balances:0,movements:0,shortfalls:0,cost_lines:0});
      const totals=await db.pool.query('SELECT sum(debit_minor)::text debit,sum(credit_minor)::text credit FROM finance.journal_lines WHERE tenant_id=$1',[a.tenantId]);assert.equal(totals.rows[0].debit,totals.rows[0].credit);
    });

    await t.test('mixed baskets consume only goods and prepared payment rejects without partial postings',async()=>{
      const a=await fixture(),goods=await create(a),service=await create(a,'SERVICE'),prepared=await create(a,'PREPARED');await receive(a,goods.productId);const shift=await confirm(a,'shift.open',{openingFloatMinor:1000});
      await confirm(a,'sales.order.settle',{shiftId:shift.shiftId,lines:[{productId:goods.productId,quantity:'1'},{productId:service.productId,quantity:'2'}],tenders:[{method:'CASH',amountMinor:3000,currency:'KES'}]},{['shift:'+shift.shiftId]:1,['product:'+goods.productId]:1,['product:'+service.productId]:1});
      assert.deepEqual(await balance(a,goods.productId),{quantity:'1.000000',inventory_value_minor:'400',version:'3'});assert.equal(await balance(a,service.productId),undefined);assert.equal(await balance(a,prepared.productId),undefined);
      const lines=(await db.pool.query('SELECT item_kind_snapshot,cogs_minor::text FROM commerce.order_lines WHERE tenant_id=$1 ORDER BY item_kind_snapshot',[a.tenantId])).rows;assert.deepEqual(lines,[{item_kind_snapshot:'SERVICE',cogs_minor:'0'},{item_kind_snapshot:'STOCKED_GOOD',cogs_minor:'400'}]);
      const before=await businessEvidence(a);denied(await send(a,envelope(a,'sales.order.settle',{shiftId:shift.shiftId,lines:[{productId:goods.productId,quantity:'1'},{productId:prepared.productId,quantity:'1'}],tenders:[{method:'CASH',amountMinor:2000,currency:'KES'}]},{['shift:'+shift.shiftId]:2})),'RECIPE_CONSUMPTION_UNAVAILABLE');assert.deepEqual(await businessEvidence(a),before);
      denied(await send(a,envelope(a,'inventory.receive',{lines:[{productId:goods.productId,quantity:'1',unitCostMinor:400},{productId:service.productId,quantity:'1',unitCostMinor:400}]})),'NOT_STOCKED_ITEM');assert.deepEqual(await businessEvidence(a),before);
    });

    await t.test('counts include goods only and nonstock creation does not invalidate a physical baseline',async()=>{
      const a=await fixture(),goods=await create(a),service=await create(a,'SERVICE');await create(a,'PREPARED');await receive(a,goods.productId);
      const count=await confirm(a,'inventory.count.open',{areaLabel:'Physical goods only'}),detail=await read(a,'/inventory/counts/'+count.countId);assert.deepEqual(detail.count.lines.map((line:any)=>line.productId),[goods.productId]);
      await create(a,'SERVICE');denied(await change(a,service.productId,'PREPARED',1),'OPEN_COUNT_CONFLICT');
      const saved=await confirm(a,'inventory.count.save',{countId:count.countId,lines:[{productId:goods.productId,countedQuantity:'2',varianceReason:''}]},{['count:'+count.countId]:1});
      await confirm(a,'inventory.count.post',{countId:count.countId},{['count:'+count.countId]:saved.version});assert.equal((await balance(a,goods.productId)).quantity,'2.000000');
    });

    await t.test('legacy misclassification first records a reviewed stock correction and retains every movement and journal',async()=>{
      const a=await fixture(),goods=await create(a);await receive(a,goods.productId);const original=await businessEvidence(a);
      denied(await change(a,goods.productId,'SERVICE',1,2),'ITEM_KIND_STOCK_REMAINING');assert.deepEqual(await businessEvidence(a),original);
      const count=await confirm(a,'inventory.count.open',{}),saved=await confirm(a,'inventory.count.save',{countId:count.countId,lines:[{productId:goods.productId,countedQuantity:'0',varianceReason:'Reviewed service misclassification; no physical stock exists'}]},{['count:'+count.countId]:1});await confirm(a,'inventory.count.post',{countId:count.countId},{['count:'+count.countId]:saved.version});
      const corrected=await businessEvidence(a),stock=await balance(a,goods.productId),changed=await change(a,goods.productId,'SERVICE',1,Number(stock.version));assert.equal(changed.status,'CONFIRMED',JSON.stringify(changed));assert.deepEqual(await businessEvidence(a),corrected);assert.deepEqual(await balance(a,goods.productId),stock);
      assert.equal((await row(a,goods.productId)).item_kind,'SERVICE');const view=(await read(a,'/catalog/items')).items[0];assert.equal(view.quantity,null);assert.equal(view.balanceVersion,Number(stock.version));
      denied(await change(a,goods.productId,'PREPARED',1,Number(stock.version)),'VERSION_CONFLICT');denied(await change(a,goods.productId,'PREPARED',2,Number(stock.version)-1),'VERSION_CONFLICT');
      const report=await read(a,'/reports/inventory-value');assert.equal(report.total,'0');assert.equal(report.control.totalsAgree,true);
    });

    await t.test('new nonstock identities acquire a balance only on explicit versioned conversion to goods',async()=>{
      const a=await fixture(),service=await create(a,'SERVICE');const first=await change(a,service.productId,'STOCKED_GOOD',1);assert.equal(first.status,'CONFIRMED',JSON.stringify(first));assert.deepEqual(await balance(a,service.productId),{quantity:'0.000000',inventory_value_minor:'0',version:'1'});
      denied(await change(a,service.productId,'PREPARED',1,1),'VERSION_CONFLICT');assert.equal((await change(a,service.productId,'PREPARED',2,1)).status,'CONFIRMED');assert.equal((await balance(a,service.productId)).version,'1');
      const other=await fixture(['commerce']),prepared=await create(other,'PREPARED');assert.equal((await change(other,prepared.productId,'SERVICE',1)).status,'CONFIRMED');denied(await change(other,prepared.productId,'STOCKED_GOOD',2),'CAPABILITY_DISABLED');
      const foreign=await fixture();denied(await change(foreign,service.productId,'SERVICE',3,1),'NOT_FOUND');
    });

    await t.test('old stocked sale refunds use their original kind after current reclassification',async()=>{
      const a=await fixture(),goods=await create(a);await receive(a,goods.productId,'1');const shift=await confirm(a,'shift.open',{openingFloatMinor:1000}),paid=await sale(a,goods.productId,shift.shiftId,1),line=(await db.pool.query('SELECT id FROM commerce.order_lines WHERE order_id=$1',[paid.saleId])).rows[0];
      const stock=await balance(a,goods.productId);assert.equal((await change(a,goods.productId,'SERVICE',1,Number(stock.version))).status,'CONFIRMED');const before=await businessEvidence(a);
      denied(await send(a,envelope(a,'sales.order.refund',{orderId:paid.saleId,shiftId:shift.shiftId,reason:'Original goods return needs classification review',lines:[{orderLineId:line.id,quantity:'1',restock:true}]},{['shift:'+shift.shiftId]:2})),'ITEM_KIND_CHANGED');assert.deepEqual(await businessEvidence(a),before);
      await confirm(a,'sales.order.refund',{orderId:paid.saleId,shiftId:shift.shiftId,reason:'No physical goods returned',lines:[{orderLineId:line.id,quantity:'1',restock:false}]},{['shift:'+shift.shiftId]:2});
      const original=await read(a,'/sales/orders/'+paid.saleId+'/receipt');assert.equal(original.lines[0].itemKind,'STOCKED_GOOD');assert.equal((await row(a,goods.productId)).item_kind,'SERVICE');assert.deepEqual(await balance(a,goods.productId),stock);
    });
  });
}
