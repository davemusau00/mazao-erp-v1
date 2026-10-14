import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { CommandEnvelope } from '../src/contracts.js';

const databaseUrl=process.env.TEST_DATABASE_URL;
if(!databaseUrl){
  test('import price changes require a fresh catalog quote before cash settlement',{skip:'Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database.'},()=>{});
}else{
  process.env.DATABASE_URL=databaseUrl;
  process.env.APP_ORIGINS ??= 'http://localhost:3000';
  const [{buildApp},{hashPassword},db]=await Promise.all([import('../src/app.js'),import('../src/security.js'),import('../src/db.js')]);
  test('metadata imports reject stale checkout prices and preserve prior receipt and COGS evidence',async()=>{
    const tenantId=randomUUID(),outletId=randomUUID(),userId=randomUUID(),deviceId=randomUUID();
    const email=`csv-sale-${userId}@example.invalid`,password=`Disposable-csv-sale-${randomUUID()}`;
    const app=buildApp(); await app.ready();
    try{
      await db.pool.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Disposable import sale','KES','Africa/Nairobi')",[tenantId]);
      await db.pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Import sale outlet','Africa/Nairobi')",[outletId,tenantId]);
      await db.pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'inventory'),($1,'commerce')",[tenantId]);
      await db.pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)',[userId,email,await hashPassword(password),'CSV Sale Admin']);
      await db.pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[tenantId,userId]);
      await db.pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Disposable import sale device')",[deviceId,tenantId,outletId,userId]);
      const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password}}); assert.equal(login.statusCode,200,login.body);
      const raw=login.headers['set-cookie'];
      const cookie=(Array.isArray(raw)?raw:[raw]).filter((value):value is string=>typeof value==='string').map(value=>value.split(';',1)[0]).join('; ');
      const headers={cookie,origin:process.env.APP_ORIGINS!.split(',')[0],'x-csrf-token':login.json().csrfToken};
      const command=(type:string,payload:Record<string,unknown>,expectedVersions:Record<string,number>={}):CommandEnvelope=>({protocolVersion:1,commandId:randomUUID(),tenantId,deviceId,type,occurredAt:new Date().toISOString(),expectedVersions,payload});
      const submit=(envelope:CommandEnvelope)=>app.inject({method:'POST',url:'/api/v1/commands',headers,payload:envelope});
      const mapping={sku:'sku',name:'name',baseUnit:'unit',sellingPrice:'price',costPrice:'cost',taxRatePercent:'tax',openingQuantity:'qty',openingUnitCost:'openingCost'};
      async function apply(source:string,mode='CREATE_ONLY'){
        const staged=await submit(command('catalog.import.validate',{fileName:'quote.csv',csv:source,mapping,mode}));
        assert.equal(staged.json().status,'CONFIRMED',staged.body); assert.equal(staged.json().value.status,'READY');
        const batchId=staged.json().value.batchId;
        const applied=await submit(command('catalog.import.apply',{batchId,reviewed:true,acknowledgedWarnings:true},{[`import:${batchId}`]:1}));
        assert.equal(applied.json().status,'CONFIRMED',applied.body);
      }
      const source=(name:string,price:string,tax:string,qty:string)=>`sku,name,unit,price,cost,tax,qty,openingCost\nQUOTE-ITEM,${name},each,${price},4.00,${tax},${qty},4.00`;
      await apply(source('Original item','5.00','0','3'));
      const item=(await db.pool.query("SELECT id,version FROM catalog.products WHERE tenant_id=$1 AND sku='QUOTE-ITEM'",[tenantId])).rows[0];
      const opened=await submit(command('shift.open',{openingFloatMinor:10000})); assert.equal(opened.json().status,'CONFIRMED',opened.body);
      const shiftId=opened.json().value.shiftId;
      const sale=(shiftVersion:number,productVersion?:number)=>command('sales.order.settle',{shiftId,lines:[{productId:item.id,quantity:'1'}],tenders:[{method:'CASH',amountMinor:2000,currency:'KES'}]},{[`shift:${shiftId}`]:shiftVersion,...(productVersion===undefined?{}:{[`product:${item.id}`]:productVersion})});
      const originalSale=await submit(sale(1,1)); assert.equal(originalSale.json().status,'CONFIRMED',originalSale.body);
      const receiptId=originalSale.json().value.saleId;
      const receiptBefore=await app.inject({url:`/api/v1/sales/orders/${receiptId}/receipt`,headers}); assert.equal(receiptBefore.json().totalMinor,'500');
      await apply(source('Changed item','6.00','16','0'),'UPSERT');
      for(const quoted of [1,undefined]){
        const stale=await submit(sale(2,quoted)); assert.equal(stale.json().status,'CONFLICT',stale.body); assert.equal(stale.json().code,'VERSION_CONFLICT');
      }
      assert.equal((await db.pool.query('SELECT count(*)::int n FROM commerce.orders WHERE tenant_id=$1',[tenantId])).rows[0].n,1);
      const oldReceipt=await app.inject({url:`/api/v1/sales/orders/${receiptId}/receipt`,headers}); assert.deepEqual(oldReceipt.json(),receiptBefore.json());
      const current=await submit(sale(2,2)); assert.equal(current.json().status,'CONFIRMED',current.body);
      const newReceipt=await app.inject({url:`/api/v1/sales/orders/${current.json().value.saleId}/receipt`,headers}); assert.equal(newReceipt.json().totalMinor,'696');
      assert.deepEqual((await db.pool.query('SELECT quantity::text,inventory_value_minor::text FROM inventory.balances WHERE tenant_id=$1 AND product_id=$2',[tenantId,item.id])).rows[0],{quantity:'1.000000',inventory_value_minor:'400'});
      assert.equal((await submit(sale(3,2))).json().status,'CONFIRMED');
      assert.equal((await db.pool.query('SELECT count(*)::int n FROM finance.journal_lines WHERE tenant_id=$1 AND account_code=\'COST_OF_GOODS_SOLD\' AND debit_minor=400',[tenantId])).rows[0].n,3);
    }finally{await app.close();await db.pool.end();}
  });
}
