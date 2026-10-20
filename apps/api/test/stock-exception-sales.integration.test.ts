import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { ApiRole, CommandEnvelope } from '../src/contracts.js';

const databaseUrl=process.env.TEST_DATABASE_URL;
if(!databaseUrl){test('stock exception sale, immutable history, reconciliation and period controls',{skip:'Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database.'},()=>{});}
else{
  process.env.DATABASE_URL=databaseUrl;process.env.APP_ORIGINS??='http://localhost:3000';
  const [{buildApp},{hashPassword},{ROLE_PERMISSIONS},db]=await Promise.all([import('../src/app.js'),import('../src/security.js'),import('../src/contracts.js'),import('../src/db.js')]);
  type Actor={tenantId:string;outletId:string;userId:string;deviceId:string;headers:Record<string,string>};
  const password=`Disposable-stock-${randomUUID()}`,passwordHash=await hashPassword(password);let loginNumber=0;
  test('short stock sales post once, preserve a provisional liability, and require evidence to resolve',async t=>{
    const app=buildApp({logger:{level:'error'}});await app.ready();
    const tenantId=randomUUID(),outletId=randomUUID();
    async function actor(role:ApiRole,name:string):Promise<Actor>{
      const userId=randomUUID(),deviceId=randomUUID(),email=`stock-${userId}@example.invalid`;
      await db.pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)',[userId,email,passwordHash,name]);
      await db.pool.query('INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenantId,userId,role]);
      await db.pool.query('INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,$5)',[deviceId,tenantId,outletId,userId,`${name} device`]);
      const login=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{'x-forwarded-for':`198.51.100.${++loginNumber}`},payload:{email,password,deviceId}});
      assert.equal(login.statusCode,200,login.body);const cookies=login.headers['set-cookie'];const cookie=(Array.isArray(cookies)?cookies:[cookies]).filter((value):value is string=>typeof value==='string').map(value=>value.split(';',1)[0]).join('; ');
      return{tenantId,outletId,userId,deviceId,headers:{cookie,origin:process.env.APP_ORIGINS!.split(',')[0],'x-csrf-token':login.json().csrfToken}};
    }
    function command(operator:Actor,type:string,payload:Record<string,unknown>,expectedVersions:Record<string,number>={}):CommandEnvelope{return{protocolVersion:1,commandId:randomUUID(),tenantId,deviceId:operator.deviceId,type,occurredAt:new Date().toISOString(),expectedVersions,payload};}
    async function submit(operator:Actor,envelope:CommandEnvelope){const response=await app.inject({method:'POST',url:'/api/v1/commands',headers:operator.headers,payload:envelope});assert.equal(response.statusCode,200,response.body);return response.json();}
    async function confirmed(operator:Actor,type:string,payload:Record<string,unknown>,versions:Record<string,number>={}){const result=await submit(operator,command(operator,type,payload,versions));assert.equal(result.status,'CONFIRMED',JSON.stringify(result));return result.value;}
    async function read(operator:Actor,path:string){const response=await app.inject({url:`/api/v1${path}`,headers:operator.headers});assert.equal(response.statusCode,200,response.body);return response.json();}
    try{
      await db.pool.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Disposable stock exception business','KES','Africa/Nairobi')",[tenantId]);
      await db.pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Stock exception outlet','Africa/Nairobi')",[outletId,tenantId]);
      await db.pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'commerce'),($1,'inventory')",[tenantId]);
      const owner=await actor('owner','Stock owner'),cashier=await actor('cashier','Stock cashier'),manager=await actor('manager','Stock manager');
      assert.ok(ROLE_PERMISSIONS.manager.includes('inventory.shortfall.resolve'));
      const created=await confirmed(owner,'catalog.product.create',{sku:`STK-${randomUUID().slice(0,8)}`,name:'Short stock item',baseUnit:'each',currency:'KES',sellingPriceMinor:10000,costPriceMinor:4000,taxRateBps:0});
      const productId=String(created.productId);await confirmed(owner,'inventory.receive',{lines:[{productId,quantity:'2',unitCostMinor:4000}]});
      const shift=await confirmed(owner,'shift.open',{openingFloatMinor:0});
      async function shortSale(stockException?:Record<string,unknown>){
        const catalog=await read(owner,'/catalog/items'),current=await read(owner,'/shifts/current');
        return command(owner,'sales.order.settle',{shiftId:current.shift.id,lines:[{productId,quantity:'3'}],tenders:[{method:'CASH',amountMinor:30000,currency:'KES'}],...(stockException?{stockException}: {})},{[`shift:${current.shift.id}`]:current.shift.version,[`product:${productId}`]:catalog.items[0].productVersion});
      }
      const before=(await db.pool.query('SELECT quantity::text,inventory_value_minor::text FROM inventory.balances WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3',[tenantId,outletId,productId])).rows[0];
      assert.equal((await submit(owner,await shortSale())).code,'INSUFFICIENT_STOCK');
      assert.deepEqual((await db.pool.query('SELECT quantity::text,inventory_value_minor::text FROM inventory.balances WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3',[tenantId,outletId,productId])).rows[0],before);
      const policy=await read(owner,'/configuration/stock-sale-policy');assert.equal(policy.policy.enabled,false);
      await confirmed(owner,'configuration.stock_exception_policy.update',{enabled:true,allowZeroReferenceCost:false},{['stock-sale-policy:'+outletId]:policy.policy.version});
      assert.equal((await submit(owner,await shortSale({physicallyConfirmed:false,lines:[]}))).code,'PHYSICAL_CONFIRMATION_REQUIRED');
      assert.equal((await submit(owner,await shortSale({physicallyConfirmed:true,lines:[{productId,maxConfirmedShortfall:'0.5',reasonCode:'SUSPECTED_UNRECORDED_DELIVERY'}]}))).code,'SHORTFALL_QUANTITY_CHANGED');
      const saleEnvelope=await shortSale({physicallyConfirmed:true,lines:[{productId,maxConfirmedShortfall:'1',reasonCode:'SUSPECTED_UNRECORDED_DELIVERY',reasonNote:'Delivery record checked'}]});
      const sale=await submit(owner,saleEnvelope);assert.equal(sale.status,'CONFIRMED',JSON.stringify(sale));assert.equal(sale.value.stockExceptionCount,1);
      assert.deepEqual(await submit(owner,saleEnvelope),sale,'retry uses the same command outcome');
      const sold=await db.pool.query(`SELECT o.id,l.id line_id,l.quantity::text,l.unrecorded_quantity::text,l.provisional_cogs_minor::text,l.cogs_minor::text,b.quantity::text balance,b.inventory_value_minor::text inventory_value
        FROM commerce.orders o JOIN commerce.order_lines l ON l.tenant_id=o.tenant_id AND l.outlet_id=o.outlet_id AND l.order_id=o.id JOIN inventory.balances b ON b.tenant_id=o.tenant_id AND b.outlet_id=o.outlet_id AND b.product_id=l.product_id WHERE o.tenant_id=$1 AND o.id=$2`,[tenantId,sale.value.saleId]);
      assert.deepEqual(sold.rows[0],{id:sale.value.saleId,line_id:sold.rows[0].line_id,quantity:'3.000000',unrecorded_quantity:'1.000000',provisional_cogs_minor:'4000',cogs_minor:'12000',balance:'0.000000',inventory_value:'0'});
      const receipt=await read(owner,`/sales/orders/${sale.value.saleId}/receipt`);assert.equal(receipt.lines[0].unrecordedQuantity,'1.000000');
      const shortfallId=(await db.pool.query('SELECT id FROM inventory.sale_shortfalls WHERE tenant_id=$1 AND order_id=$2',[tenantId,sale.value.saleId])).rows[0].id;
      await assert.rejects(db.pool.query('UPDATE inventory.sale_shortfalls SET reason_note=reason_note WHERE tenant_id=$1 AND id=$2',[tenantId,shortfallId]),{code:'55000'});
      await assert.rejects(db.pool.query('DELETE FROM inventory.sale_shortfalls WHERE tenant_id=$1 AND id=$2',[tenantId,shortfallId]),{code:'55000'});
      assert.equal((await app.inject({url:'/api/v1/inventory/shortfalls',headers:cashier.headers})).statusCode,403);
      const shortfalls=await read(manager,'/inventory/shortfalls?status=OPEN');assert.equal(shortfalls.scope,'OUTLET');assert.equal(shortfalls.items[0].id,shortfallId);assert.equal(shortfalls.items[0].unresolvedCogsMinor,'4000');
      const report=await read(manager,`/reports/stock-exceptions?from=${new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date())}&to=${new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date())}`);assert.equal(report.totals.unresolvedQuantityNow,'1.000000');assert.equal(report.coverage.costVisible,true);
      const csv=await app.inject({url:`/api/v1/reports/stock-exceptions.csv?from=${report.from}&to=${report.to}`,headers:manager.headers});assert.equal(csv.statusCode,200,csv.body);assert.match(csv.body,/Short stock item/);
      const refundShift=(await read(owner,'/shifts/current')).shift;
      const attemptedRefund=command(owner,'sales.order.refund',{orderId:sale.value.saleId,shiftId:refundShift.id,reason:'Return review',lines:[{orderLineId:sold.rows[0].line_id,quantity:'1',restock:true}]},{[`shift:${refundShift.id}`]:refundShift.version});
      assert.equal((await submit(owner,attemptedRefund)).code,'SHORTFALL_RESTOCK_REQUIRES_REVIEW');
      const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date());const period=await confirmed(owner,'finance.period.create',{from:today,to:today,reason:'Review stock exception accounting'});
      const activeShift=(await read(owner,'/shifts/current')).shift;await confirmed(owner,'shift.close',{shiftId:activeShift.id,countedCashMinor:30000},{[`shift:${activeShift.id}`]:activeShift.version});
      await confirmed(owner,'finance.period.transition',{periodId:period.periodId,status:'CLOSING',reason:'Review the supported financial records'},{[`period:${period.periodId}`]:1});
      const blocked=await submit(owner,command(owner,'finance.period.transition',{periodId:period.periodId,status:'CLOSED',reason:'Exception still needs stock evidence'},{[`period:${period.periodId}`]:2}));
      assert.equal(blocked.code,'PERIOD_RECONCILIATION_FAILED');assert.equal(blocked.details.openStockExceptions,'1');assert.equal(blocked.details.unresolvedExceptionProvisionalCogsMinor,'4000');
      await confirmed(owner,'finance.period.transition',{periodId:period.periodId,status:'OPEN',reason:'Return to review after the discrepancy is resolved'},{[`period:${period.periodId}`]:2});
      const received=await submit(owner,command(owner,'inventory.receive',{lines:[{productId,quantity:'1',unitCostMinor:4500}],documentReference:'DELIVERY-OMITTED-42'}));assert.equal(received.status,'CONFIRMED',JSON.stringify(received));
      const movement=(await db.pool.query("SELECT id FROM inventory.movements WHERE tenant_id=$1 AND command_id=$2 AND movement_type='RECEIPT'",[tenantId,received.commandId])).rows[0];
      const detail=await read(manager,`/inventory/shortfalls/${shortfallId}`);
      const resolution=await submit(manager,command(manager,'inventory.sale_shortfall.resolve',{shortfallId,quantity:'1',resolutionType:'OMITTED_RECEIPT',supportingMovementId:movement.id,supportingDocumentReference:'DELIVERY-OMITTED-42',reason:'Verified the missing delivery paperwork'},{['shortfall:'+shortfallId]:detail.exception.version,[`balance:${productId}`]:detail.exception.balanceVersion}));
      assert.equal(resolution.status,'CONFIRMED',JSON.stringify(resolution));assert.equal(resolution.value.cogsAdjustmentMinor,'500');
      const resolved=await read(manager,`/inventory/shortfalls/${shortfallId}`);assert.equal(resolved.exception.status,'RESOLVED');assert.equal(resolved.exception.remainingQuantity,'0');assert.equal(resolved.exception.resolutions[0].actualCogsMinor,'4500');
      await assert.rejects(db.pool.query('DELETE FROM inventory.sale_shortfall_resolutions WHERE tenant_id=$1 AND shortfall_id=$2',[tenantId,shortfallId]),{code:'55000'});
      const controls=await read(owner,'/finance/controls');assert.equal(controls.controls.stockExceptionClearing.balanced,true);assert.equal(controls.controls.stockExceptionClearing.ledgerMinor,'0');
      const close=await confirmed(owner,'finance.period.transition',{periodId:period.periodId,status:'CLOSING',reason:'Updated review for the resolved discrepancy'},{[`period:${period.periodId}`]:3});
      assert.equal(close.status,'CLOSING');
      const final=await submit(owner,command(owner,'finance.period.transition',{periodId:period.periodId,status:'CLOSED',reason:'Reconciled the stock exception and its provisional cost'},{[`period:${period.periodId}`]:4}));assert.equal(final.status,'CONFIRMED',JSON.stringify(final));
      const closeReport=await read(owner,'/shifts/close-reports');assert.equal(closeReport.reports[0].stockExceptionSalesCount,1);
      const finalControls=await db.pool.query(`SELECT (SELECT count(*)::int FROM inventory.sale_shortfall_resolutions WHERE tenant_id=$1 AND shortfall_id=$2) resolution_count,
        (SELECT sum(debit_minor-credit_minor)::text FROM finance.journal_lines jl JOIN finance.journal_entries je ON je.tenant_id=jl.tenant_id AND je.id=jl.journal_entry_id WHERE je.tenant_id=$1 AND je.source_type='SALE_SHORTFALL_RESOLUTION' AND je.source_id=$3) resolution_net,
        (SELECT count(*)::int FROM finance.journal_entries je JOIN finance.journal_lines jl ON jl.tenant_id=je.tenant_id AND jl.journal_entry_id=je.id WHERE je.tenant_id=$1 AND je.source_type='SALE_SHORTFALL_RESOLUTION' AND je.source_id=$3) resolution_journal_lines`,[tenantId,shortfallId,resolution.commandId]);
      assert.equal(finalControls.rows[0].resolution_count,1);assert.equal(finalControls.rows[0].resolution_net,'0');assert.equal(finalControls.rows[0].resolution_journal_lines,3);
    }finally{await app.close();await db.pool.end();}
  });
}
