import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

if (!process.env.TEST_DATABASE_URL) {
  test('history continuation beyond prior caps',{skip:'Requires disposable TEST_DATABASE_URL.'},()=>{});
} else {
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
  process.env.APP_ORIGINS??='http://localhost:3000';
  const [{buildApp},{pool},{hashPassword}]=await Promise.all([import('../src/app.js'),import('../src/db.js'),import('../src/security.js')]);
  test('full authorized history and evidence remain reachable with stable microsecond cursors',async t=>{
    const app=buildApp({logger:{level:'error'}});await app.ready();
    const tenantId=randomUUID(),outletId=randomUUID(),userId=randomUUID(),deviceId=randomUUID();
    const email=`history-${userId}@example.invalid`,password=`History-${randomUUID()}`;
    try {
      await pool.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'History fixtures','KES','Africa/Nairobi')",[tenantId]);
      await pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'History outlet','Africa/Nairobi')",[outletId,tenantId]);
      await pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'commerce'),($1,'inventory')",[tenantId]);
      await pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,\'History owner\')',[userId,email,await hashPassword(password)]);
      await pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",[tenantId,userId]);
      await pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'History assignment')",[deviceId,tenantId,outletId,userId]);
      const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password,deviceId}});assert.equal(login.statusCode,200,login.body);
      const cookies=login.headers['set-cookie'];
      const headers={origin:process.env.APP_ORIGINS!.split(',')[0],'x-csrf-token':login.json().csrfToken,cookie:(Array.isArray(cookies)?cookies:[cookies]).filter((v):v is string=>typeof v==='string').map(v=>v.split(';',1)[0]).join('; ')};
      async function read(path:string){const r=await app.inject({url:'/api/v1'+path,headers});assert.equal(r.statusCode,200,r.body);return r.json();}
      async function command(type:string,payload:Record<string,unknown>,expectedVersions:Record<string,number>={}){
        const r=await app.inject({method:'POST',url:'/api/v1/commands',headers,payload:{protocolVersion:1,commandId:randomUUID(),tenantId,deviceId,type,occurredAt:new Date().toISOString(),expectedVersions,payload}});
        assert.equal(r.statusCode,200,r.body);assert.equal(r.json().status,'CONFIRMED',r.body);return r.json().value;
      }
      const product=await command('catalog.product.create',{sku:'HISTORY',name:'History product',baseUnit:'each',currency:'KES',sellingPriceMinor:100,costPriceMinor:10,taxRateBps:0});
      const productId=product.productId;
      const shift=await command('shift.open',{openingFloatMinor:0}),shiftId=shift.shiftId;
      const policy=await read('/configuration/stock-sale-policy');
      await command('configuration.stock_exception_policy.update',{enabled:true,allowZeroReferenceCost:false},{['stock-sale-policy:'+outletId]:policy.policy.version});
      const current=await read('/shifts/current'),catalog=await read('/catalog/items');
      await command('sales.order.settle',{shiftId,lines:[{productId,quantity:'1'}],tenders:[{method:'CASH',amountMinor:100,currency:'KES'}],stockException:{physicallyConfirmed:true,lines:[{productId,maxConfirmedShortfall:'1',reasonCode:'SUSPECTED_UNRECORDED_DELIVERY'}]}},{['shift:'+shiftId]:current.shift.version,['product:'+productId]:catalog.items[0].productVersion});
      const shortfalls=await read('/inventory/shortfalls'),shortfallId=shortfalls.items[0].id;

      // These rows are immutable read fixtures. Posting invariants are exercised
      // by the separate receiving/count/close/shortfall command suites.
      await pool.query(`INSERT INTO inventory.movements(id,tenant_id,outlet_id,product_id,command_id,movement_type,quantity_delta,unit_cost_minor,value_minor,document_reference,created_at)
        SELECT gen_random_uuid(),$1,$2,$3,gen_random_uuid(),'RECEIPT',1,10,10,CASE WHEN g=1 THEN 'oldest-target' ELSE 'Delivery '||g END,
          '2000-01-01T00:00:00Z'::timestamptz+floor(g/2)*interval '1 microsecond' FROM generate_series(1,251) g`,[tenantId,outletId,productId]);
      await pool.query(`INSERT INTO inventory.stock_counts(id,tenant_id,outlet_id,status,opened_by,area_label,opened_at,cancelled_by,cancelled_at)
        SELECT gen_random_uuid(),$1,$2,'CANCELLED',$3,CASE WHEN g=1 THEN 'oldest-target' ELSE 'Count '||g END,'2000-01-01'::timestamptz+g*interval '1 microsecond',$3,now() FROM generate_series(1,51) g`,[tenantId,outletId,userId]);
      await pool.query(`INSERT INTO catalog.product_import_batches(id,tenant_id,outlet_id,created_by,created_at,file_name,raw_source,source_sha256,source_bytes,column_mapping,import_mode,status,configuration_snapshot,validation_report,validation_sha256)
        SELECT gen_random_uuid(),$1,$2,$3,'2000-01-01'::timestamptz+g*interval '1 microsecond',CASE WHEN g=1 THEN 'oldest-target.csv' ELSE 'Import '||g END,'',repeat('a',64),0,'{}','CREATE_ONLY','READY','{"businessVersion":1,"currency":"KES","taxRateBps":0}','{"summary":{}}',repeat('b',64) FROM generate_series(1,51) g`,[tenantId,outletId,userId]);
      await pool.query(`INSERT INTO commerce.shift_cash_movements(id,tenant_id,outlet_id,shift_id,command_id,actor_id,movement_type,amount_minor,reason,created_at)
        SELECT gen_random_uuid(),$1,$2,$3,gen_random_uuid(),$4,'PAID_IN',1,CASE WHEN g=1 THEN 'oldest-target' ELSE 'Movement '||g END,'2000-01-01'::timestamptz+g*interval '1 microsecond' FROM generate_series(1,101) g`,[tenantId,outletId,shiftId,userId]);
      await pool.query(`WITH fixtures AS (INSERT INTO commerce.shifts(id,tenant_id,outlet_id,operator_id,status,opening_float_minor,expected_cash_minor,version,closed_at)
        SELECT gen_random_uuid(),$1,$2,$3,'CLOSED',0,0,2,now() FROM generate_series(1,51) RETURNING *)
        INSERT INTO commerce.shift_close_reports(id,tenant_id,outlet_id,shift_id,command_id,operator_id,tenant_name_snapshot,outlet_name_snapshot,operator_name_snapshot,time_zone_snapshot,business_date,currency,shift_version,opened_at,closed_at,opening_float_minor,cash_sales_minor,customer_collections_minor,cash_refunds_minor,cash_paid_in_minor,cash_payout_minor,expected_cash_minor,counted_cash_minor,variance_minor)
        SELECT gen_random_uuid(),tenant_id,outlet_id,id,gen_random_uuid(),operator_id,'History fixtures','History outlet','History owner','Africa/Nairobi','2000-01-01','KES',2,opened_at,'2000-01-01'::timestamptz,0,0,0,0,0,0,0,0,0 FROM fixtures`,[tenantId,outletId,userId]);

      await t.test('all previous caps have continuation and exact filter totals',async()=>{
        for(const [path,key,total] of [
          ['/inventory/movements','movements',251],['/inventory/counts','counts',51],['/catalog/imports','batches',51],
          ['/shifts/close-reports','reports',51],[`/shifts/${shiftId}/cash-movements`,'movements',101],[`/inventory/shortfalls/${shortfallId}/evidence`,'evidence',251],
        ] as const){
          let page=await read(path);assert.equal(page.page.totalCount,total,path);assert.ok(page.page.nextCursor,path);
          const ids=new Set<string>();let seen=0;
          while(true){for(const row of page[key]){assert.ok(!ids.has(row.id),`duplicate ${path}`);ids.add(row.id);seen++;}if(!page.page.nextCursor)break;page=await read(path+'?after='+page.page.nextCursor);}
          assert.equal(seen,total,path);
        }
      });
      await t.test('server search finds oldest records and preserves whole-history balances',async()=>{
        const movement=await read('/inventory/movements?q=oldest-target');assert.equal(movement.movements.length,1);assert.equal(movement.page.totalCount,1);assert.equal(movement.movements[0].balanceAfter,'1.000000');
        for(const [path,key] of [['/inventory/counts','counts'],['/catalog/imports','batches'],[`/shifts/${shiftId}/cash-movements`,'movements'],[`/inventory/shortfalls/${shortfallId}/evidence`,'evidence']] as const){const page=await read(path+'?q=oldest-target');assert.equal(page[key].length,1,path);}
      });
      await t.test('continuation rejects wrong resource, changed filter and malformed values',async()=>{
        const first=await read('/inventory/movements?limit=2');
        for(const path of ['/inventory/counts?after='+first.page.nextCursor,'/inventory/movements?q=changed&after='+first.page.nextCursor,'/inventory/movements?after=invalid','/inventory/movements?limit=0','/inventory/movements?limit=251']){
          const r=await app.inject({url:'/api/v1'+path,headers});assert.equal(r.statusCode,400,r.body);assert.equal(r.json().error.code,'VALIDATION_FAILED');
        }
      });
      await t.test('new rows after page one do not enter its continuation',async()=>{
        const first=await read('/inventory/movements?limit=250');
        await pool.query(`INSERT INTO inventory.movements(id,tenant_id,outlet_id,product_id,command_id,movement_type,quantity_delta,unit_cost_minor,value_minor,created_at) VALUES($1,$2,$3,$4,$5,'RECEIPT',1,10,10,clock_timestamp())`,[randomUUID(),tenantId,outletId,productId,randomUUID()]);
        const next=await read('/inventory/movements?after='+first.page.nextCursor);assert.equal(next.page.totalCount,251);assert.equal(next.movements.length,1);assert.equal((await read('/inventory/movements')).page.totalCount,252);
      });
      await t.test('current shift labels its limited cash preview and points to complete history',async()=>{const r=await read('/shifts/current');assert.equal(r.shift.cashMovements.length,100);assert.equal(r.shift.cashMovementPage.totalCount,101);assert.ok(r.shift.cashMovementPage.nextCursor);});
      await t.test('outlet and current role still authorize every page and evidence read',async()=>{
        const first=await read('/inventory/movements?limit=2'),otherOutlet=randomUUID(),otherDevice=randomUUID();
        await pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Other history outlet','Africa/Nairobi')",[otherOutlet,tenantId]);
        await pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Other history assignment')",[otherDevice,tenantId,otherOutlet,userId]);
        const otherLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password,deviceId:otherDevice}});assert.equal(otherLogin.statusCode,200,otherLogin.body);
        const otherCookies=otherLogin.headers['set-cookie'];
        const otherHeaders={...headers,cookie:(Array.isArray(otherCookies)?otherCookies:[otherCookies]).filter((v):v is string=>typeof v==='string').map(v=>v.split(';',1)[0]).join('; ')};
        const empty=await app.inject({url:'/api/v1/inventory/movements',headers:otherHeaders});assert.equal(empty.statusCode,200);assert.equal(empty.json().movements.length,0);
        const swapped=await app.inject({url:'/api/v1/inventory/movements?after='+first.page.nextCursor,headers:otherHeaders});assert.equal(swapped.statusCode,400,swapped.body);
        const foreignEvidence=await app.inject({url:`/api/v1/inventory/shortfalls/${shortfallId}/evidence`,headers:otherHeaders});assert.equal(foreignEvidence.statusCode,404,foreignEvidence.body);
        await pool.query("UPDATE identity.memberships SET role='cashier' WHERE tenant_id=$1 AND user_id=$2",[tenantId,userId]);
        for(const path of ['/inventory/movements?after='+first.page.nextCursor,'/inventory/counts',`/inventory/shortfalls/${shortfallId}/evidence`]){
          const denied=await app.inject({url:'/api/v1'+path,headers});assert.equal(denied.statusCode,403,denied.body);
        }
      });
    } finally {await app.close();await pool.end();}
  });
}
