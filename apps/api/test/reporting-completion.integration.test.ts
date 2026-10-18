import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,test} from 'node:test';
import type {ApiSession} from '../src/contracts.js';

if(!process.env.TEST_DATABASE_URL){
  test('populated reporting, scoped detail and exact complete exports',{skip:'Set TEST_DATABASE_URL to disposable PostgreSQL.'},()=>{});
}else{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
  const [{pool},{getOperationalAnalytics},{getItemReport,getItemReportCsv,getItemEvents},{getTrialBalance,getProfitLoss,getJournalLines},{getJournalSource},{getCustomerBalanceReport,getInventoryValueReport}]=await Promise.all([
    import('../src/db.js'),import('../src/operationalAnalytics.js'),import('../src/itemReports.js'),import('../src/financeReports.js'),import('../src/journalSources.js'),import('../src/controlReports.js'),
  ]);
  after(async()=>{await pool.end();});
  test('populated reports use whole datasets, exact discounted returns and collection dates without rewriting evidence',async()=>{
    const tenantId=randomUUID(),outletId=randomUUID(),otherOutletId=randomUUID(),userId=randomUUID(),deviceId=randomUUID(),shiftId=randomUUID(),customerId=randomUUID();
    const session:ApiSession={sessionId:randomUUID(),userId,fullName:'Reporting operator',email:`reports-${userId}@example.invalid`,tenantId,tenantName:'Report acceptance',currency:'KES',outletId,outletName:'Counter',tenantTimeZone:'UTC',timeZone:'Africa/Nairobi',deviceId,role:'manager',capabilities:['commerce','inventory','hospitality'],expiresAt:new Date(Date.now()+60_000)};
    await pool.query('INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,\'Report acceptance\',\'KES\',\'UTC\')',[tenantId]);
    await pool.query('INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$3,\'Counter\',\'Africa/Nairobi\'),($2,$3,\'Other\',\'Pacific/Auckland\')',[outletId,otherOutletId,tenantId]);
    await pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,\'unused-disposable-fixture\',\'Reporting operator\')',[userId,session.email]);
    await pool.query('INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,\'manager\')',[tenantId,userId]);
    await pool.query('INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,\'Reporting device\')',[deviceId,tenantId,outletId,userId]);
    await pool.query('INSERT INTO commerce.shifts(id,tenant_id,outlet_id,operator_id,status,opening_float_minor) VALUES($1,$2,$3,$4,\'OPEN\',0)',[shiftId,tenantId,outletId,userId]);
    await pool.query('INSERT INTO finance.customer_accounts(id,tenant_id,display_name,phone,credit_limit_minor,balance_minor,status) VALUES($1,$2,\'Account customer\',\'000\',10000,1600,\'ACTIVE\')',[customerId,tenantId]);
    const product=async(name:string,taxRateBps=1600)=>{
      const id=randomUUID();await pool.query('INSERT INTO catalog.products(id,tenant_id,outlet_id,sku,name,base_unit,currency,selling_price_minor,cost_price_minor,tax_rate_bps) VALUES($1,$2,$3,$4,$5,\'each\',\'KES\',1000,400,$6)',[id,tenantId,outletId,`SKU-${id}`,name,taxRateBps]);return id;
    };
    const journal=async(sourceType:string,sourceId:string,at:string,lines:Array<[string,number,number]>,effectiveDate?:string)=>{
      const id=randomUUID(),client=await pool.connect();
      try{await client.query('BEGIN');await client.query('INSERT INTO finance.journal_entries(id,tenant_id,source_type,source_id,currency,created_by,posted_at,effective_date) VALUES($1,$2,$3,$4,\'KES\',$5,$6,$7)',[id,tenantId,sourceType,sourceId,userId,at,effectiveDate??null]);
        for(const [account,debit,credit]of lines)await client.query('INSERT INTO finance.journal_lines(id,tenant_id,journal_entry_id,account_code,debit_minor,credit_minor) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),tenantId,id,account,debit,credit]);
        await client.query('COMMIT');return id;
      }catch(cause){await client.query('ROLLBACK');throw cause;}finally{client.release();}
    };
    const order=async(productId:string,name:string,at:string,subtotal:number,tax:number,discount:number,cogs:number,quantity:string,method:'CASH'|'MANUAL_MPESA'|'ACCOUNT')=>{
      const id=randomUUID(),lineId=randomUUID(),commandId=randomUUID();
      await pool.query(`INSERT INTO commerce.orders(id,tenant_id,outlet_id,shift_id,operator_id,currency,subtotal_minor,tax_minor,total_minor,status,created_at,
        receipt_number,tenant_name_snapshot,outlet_name_snapshot,outlet_time_zone_snapshot,customer_account_id,customer_name_snapshot,customer_amount_due_minor)
        VALUES($1,$2,$3,$4,$5,'KES',$6,$7,$8,'CONFIRMED',$9,$10,'Report acceptance','Counter','Africa/Nairobi',$11,$12,$13)`,[id,tenantId,outletId,shiftId,userId,subtotal,tax,subtotal+tax,at,`MZ-${id}`,method==='ACCOUNT'?customerId:null,method==='ACCOUNT'?'Account customer':null,method==='ACCOUNT'?subtotal+tax:0]);
      await pool.query(`INSERT INTO commerce.order_lines(id,tenant_id,outlet_id,order_id,product_id,sku_snapshot,name_snapshot,quantity,unit_price_minor,cost_price_minor,tax_rate_bps,line_subtotal_minor,line_tax_minor,cogs_minor,discount_minor,discount_reason)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9,400,$15,$10,$11,$12,$13,$14)`,[lineId,tenantId,outletId,id,productId,`SKU-${productId}`,name,quantity,(subtotal+discount)/Number(quantity),subtotal,tax,cogs,discount,discount?'Reviewed item discount':null,tax?1600:0]);
      await pool.query(`INSERT INTO system.commands(tenant_id,command_id,actor_id,device_id,command_type,request_hash,status,response,created_at)
        VALUES($1,$2,$3,$4,'sales.order.settle',$5,'CONFIRMED',$6::jsonb,$7)`,[tenantId,commandId,userId,deviceId,Buffer.from('fixture'),JSON.stringify({status:'CONFIRMED',value:{saleId:id}}),at]);
      let chargeId:string|undefined;
      if(method==='ACCOUNT'){chargeId=randomUUID();await pool.query('INSERT INTO finance.customer_charges(id,tenant_id,outlet_id,customer_account_id,order_id,amount_minor,currency,created_at) VALUES($1,$2,$3,$4,$5,$6,\'KES\',$7)',[chargeId,tenantId,outletId,customerId,id,subtotal+tax,at]);}
      else await pool.query(`INSERT INTO commerce.payments(id,tenant_id,outlet_id,order_id,method,amount_minor,currency,status,created_at,reference,manually_confirmed_by,manually_confirmed_at,confirmed_operator_name_snapshot)
        VALUES($1,$2,$3,$4,$5,$6,'KES','CONFIRMED',$7,$8,$9,$10,$11)`,[randomUUID(),tenantId,outletId,id,method,subtotal+tax,at,method==='MANUAL_MPESA'?`REF-${id}`.toUpperCase():null,method==='MANUAL_MPESA'?userId:null,method==='MANUAL_MPESA'?at:null,method==='MANUAL_MPESA'?'Reporting operator':null]);
      const entryId=await journal('SALE',commandId,at,[[method==='ACCOUNT'?'ACCOUNTS_RECEIVABLE':method==='MANUAL_MPESA'?'MOBILE_MONEY_CONTROL':'CASH_TILL',subtotal+tax,0],['SALES_REVENUE',0,subtotal],...(tax?[['VAT_PAYABLE',0,tax]as[string,number,number]]:[])]);
      await journal('SALE_COGS',commandId,at,[['COST_OF_GOODS_SOLD',cogs,0],['INVENTORY',0,cogs]]);
      return{id,lineId,chargeId,entryId};
    };
    const itemId=await product('Current catalogue name'),secondId=await product('Credit item',0);
    const old=await order(itemId,'Original item name','2026-10-09T10:00:00Z',1000,160,100,400,'1','CASH');
    const oldCredit=await order(secondId,'Credit item','2026-10-09T11:00:00Z',1000,0,0,300,'1','ACCOUNT');
    const first=await order(itemId,'Original item name','2026-10-10T10:00:00.123451Z',2000,320,500,800,'2','CASH');
    await order(itemId,'Renamed item','2026-10-10T10:00:00.123452Z',1000,160,0,400,'1','MANUAL_MPESA');
    await order(secondId,'Credit item','2026-10-10T12:00:00Z',900,0,0,300,'1','ACCOUNT');
    for(let index=0;index<12;index++)await order(await product(index===0?'=Untrusted spreadsheet label':`Other item ${index}`,0),index===0?'=Untrusted spreadsheet label':`Other item ${index}`,'2026-10-10T12:30:00Z',10,0,0,4,'1','CASH');
    const refundId=randomUUID(),refundCommand=randomUUID();
    await pool.query(`INSERT INTO commerce.refunds(id,tenant_id,outlet_id,order_id,shift_id,command_id,actor_id,currency,reason,subtotal_minor,tax_minor,total_minor,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,'KES','Part returned',500,80,580,'2026-10-10T13:00:00Z')`,[refundId,tenantId,outletId,old.id,shiftId,refundCommand,userId]);
    await pool.query(`INSERT INTO commerce.refund_lines(id,tenant_id,outlet_id,refund_id,order_id,order_line_id,product_id,quantity,subtotal_minor,tax_minor,cogs_minor,restocked,discount_minor)
      VALUES($1,$2,$3,$4,$5,$6,$7,0.5,500,80,200,true,50)`,[randomUUID(),tenantId,outletId,refundId,old.id,old.lineId,itemId]);
    await journal('SALE_REFUND',refundCommand,'2026-10-10T13:00:00Z',[['SALES_REVENUE',500,0],['VAT_PAYABLE',80,0],['CASH_TILL',0,580]]);
    await journal('SALE_REFUND_COGS',refundCommand,'2026-10-10T13:00:00Z',[['INVENTORY',200,0],['COST_OF_GOODS_SOLD',0,200]]);
    const repaymentId=randomUUID(),repaymentCommand=randomUUID();
    await pool.query('INSERT INTO finance.customer_repayments(id,tenant_id,outlet_id,customer_account_id,shift_id,command_id,actor_id,amount_minor,currency,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,300,\'KES\',\'2026-10-10T14:00:00Z\')',[repaymentId,tenantId,outletId,customerId,shiftId,repaymentCommand,userId]);
    await journal('CUSTOMER_REPAYMENT',repaymentCommand,'2026-10-10T14:00:00Z',[['CASH_TILL',300,0],['ACCOUNTS_RECEIVABLE',0,300]]);
    await pool.query('INSERT INTO finance.customer_repayment_allocations(id,tenant_id,repayment_id,charge_id,customer_account_id,amount_minor) VALUES($1,$2,$3,$4,$5,300)',[randomUUID(),tenantId,repaymentId,oldCredit.chargeId,customerId]);
    const roomId=randomUUID(),stayId=randomUUID(),folioId=randomUUID();
    await pool.query('INSERT INTO hospitality.rooms(id,tenant_id,outlet_id,room_number,room_type,nightly_rate_minor,tax_rate_bps,currency) VALUES($1,$2,$3,\'101\',\'Standard\',700,0,\'KES\')',[roomId,tenantId,outletId]);
    await pool.query('INSERT INTO hospitality.stays(id,tenant_id,outlet_id,room_id,guest_name,check_in_date,expected_check_out_date,nightly_rate_minor,tax_rate_bps,currency,status,created_by) VALUES($1,$2,$3,$4,\'Guest\',\'2026-10-09\',\'2026-10-10\',700,0,\'KES\',\'CHECKED_OUT\',$5)',[stayId,tenantId,outletId,roomId,userId]);
    await pool.query('INSERT INTO hospitality.folios(id,tenant_id,outlet_id,stay_id,currency,status) VALUES($1,$2,$3,$4,\'KES\',\'SETTLED\')',[folioId,tenantId,outletId,stayId]);
    const roomCommand=randomUUID();
    await pool.query('INSERT INTO hospitality.folio_entries(id,tenant_id,outlet_id,folio_id,command_id,entry_type,amount_minor,currency,created_at) VALUES($1,$2,$3,$4,$5,\'CASH_PAYMENT\',700,\'KES\',\'2026-10-10T15:00:00Z\')',[randomUUID(),tenantId,outletId,folioId,roomCommand]);
    await journal('ROOM_CHECKOUT',roomCommand,'2026-10-10T15:00:00Z',[['CASH_TILL',700,0],['ROOM_REVENUE',0,700]]);
    for(const [type,amount]of [['PAID_IN',50],['PAYOUT',20]]as const){
      const commandId=randomUUID();await pool.query('INSERT INTO commerce.shift_cash_movements(id,tenant_id,outlet_id,shift_id,command_id,actor_id,movement_type,amount_minor,reason,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,\'Review evidence\',\'2026-10-10T16:00:00Z\')',[randomUUID(),tenantId,outletId,shiftId,commandId,userId,type,amount]);
      await journal(type==='PAID_IN'?'SHIFT_CASH_PAID_IN':'SHIFT_CASH_PAYOUT',commandId,'2026-10-10T16:00:00Z',type==='PAID_IN'?[['CASH_TILL',amount,0],['CASH_PAID_IN_CLEARING',0,amount]]:[['CASH_PAYOUT_CLEARING',amount,0],['CASH_TILL',0,amount]]);
    }
    await journal('EXPENSE',randomUUID(),'2026-10-18T00:00:00Z',[['OPERATING_EXPENSE',100,0],['BANK_CONTROL',0,100]],'2026-10-10');
    const fingerprints=async()=>JSON.stringify((await pool.query(`SELECT
      (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM commerce.orders o WHERE tenant_id=$1) orders,
      (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM commerce.order_lines l WHERE tenant_id=$1) lines,
      (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM commerce.payments p WHERE tenant_id=$1) payments,
      (SELECT jsonb_agg(to_jsonb(j) ORDER BY id) FROM finance.journal_entries j WHERE tenant_id=$1) journals,
      (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM finance.journal_lines l WHERE tenant_id=$1) journal_lines`,[tenantId])).rows[0]);
    const before=await fingerprints();
    const analytics=await getOperationalAnalytics(session,'2026-10-10','2026-10-10');
    assert.equal(analytics.totals.grossSalesMinor,'4500');assert.equal(analytics.totals.subtotalMinor,'4020');assert.equal(analytics.totals.taxMinor,'480');
    assert.equal(analytics.totals.originalSubtotalMinor,'4520');assert.equal(analytics.totals.discountMinor,'500');assert.equal(analytics.totals.netRevenueMinor,'3520');
    assert.equal(analytics.totals.refundTaxMinor,'80');assert.equal(analytics.totals.netTaxMinor,'400');assert.equal(analytics.totals.netInvoiceMinor,'3920');
    assert.equal(analytics.totals.cashCollectedMinor,'2440');assert.equal(analytics.totals.manualMpesaMinor,'1160');assert.equal(analytics.totals.accountCreditMinor,'900');
    assert.equal(analytics.totals.customerCollectionsMinor,'300');assert.equal(analytics.totals.roomCashCollectionsMinor,'700');assert.equal(analytics.totals.netDrawerMovementMinor,'2890');
    assert.equal(analytics.coverage.productCount,'14');assert.equal(analytics.coverage.topProductsComplete,false);assert.equal(analytics.topProducts.length,10);
    assert.equal(analytics.topProducts.filter((row:{productId:string})=>row.productId===itemId).length,1);assert.equal(analytics.topProducts.find((row:{productId:string})=>row.productId===itemId)?.name,'Renamed item');
    let itemReport=await getItemReport(session,{from:'2026-10-10',to:'2026-10-10',limit:3});
    const allItems=[...itemReport.items];assert.equal(itemReport.total,'14');assert.equal(itemReport.totals.netRevenueMinor,'3520');
    while(itemReport.nextAfter){itemReport=await getItemReport(session,{from:'2026-10-10',to:'2026-10-10',limit:3,after:itemReport.nextAfter,asOf:itemReport.asOf});allItems.push(...itemReport.items);}
    assert.equal(allItems.length,14);assert.equal(new Set(allItems.map(row=>row.productId)).size,14);
    const item=allItems.find(row=>row.productId===itemId)as any;
    assert.equal(item.netRevenueMinor,'2500');assert.equal(item.discountMinor,'500');assert.equal(item.refundDiscountMinor,'50');assert.equal(item.netCogsMinor,'1000');assert.equal(item.grossProfitMinor,'1500');
    let events=await getItemEvents(session,{productId:itemId,from:'2026-10-10',to:'2026-10-10',limit:1}),eventIds=events.events.map(row=>row.eventId);
    while(events.nextAfter){events=await getItemEvents(session,{productId:itemId,from:'2026-10-10',to:'2026-10-10',limit:1,after:events.nextAfter,asOf:events.asOf});eventIds.push(...events.events.map(row=>row.eventId));}
    assert.equal(eventIds.length,3,'microsecond cursor retains both same-millisecond sales and old-sale return');assert.equal(new Set(eventIds).size,3);
    const csv=await getItemReportCsv(session,{from:'2026-10-10',to:'2026-10-10'});assert.equal(csv.trim().split('\r\n').length,15,'complete export covers every item beyond first page');assert.match(csv,/'=Untrusted spreadsheet label/);
    const source=await getJournalSource(session,first.entryId);assert.equal(source.document.receiptId,first.id);assert.equal(source.document.rows[0].discountMinor,'500');
    await assert.rejects(()=>getJournalSource({...session,outletId:otherOutletId},first.entryId),{code:'SOURCE_UNAVAILABLE'});
    await assert.rejects(()=>getItemReport({...session,role:'cashier'},{from:'2026-10-10',to:'2026-10-10'}),{code:'FORBIDDEN'});
    const foreign=await getOperationalAnalytics({...session,outletId:otherOutletId},'2026-10-10','2026-10-10');assert.equal(foreign.totals.grossSalesMinor,'0');
    const operating=await getProfitLoss(session,'2026-10-10','2026-10-10');assert.equal(operating.timeZone,'UTC');assert.equal(operating.totals.otherOperatingCostsMinor,'100','backdated expense uses effective date');assert.ok(!operating.coverage.unknownAccountCodes.includes('ACCOUNTS_RECEIVABLE'));
    const sameTenantOtherOutlet=await getProfitLoss({...session,timeZone:'Pacific/Auckland',outletId:otherOutletId},'2026-10-10','2026-10-10');assert.deepEqual(sameTenantOtherOutlet.totals,operating.totals,'tenant period cannot depend on current outlet timezone');
    assert.equal((await getTrialBalance(session,'2026-10-10')).totals.balanced,true);
    assert.equal((await getJournalLines(session,{accountCode:'OPERATING_EXPENSE',from:'2026-10-10',to:'2026-10-10',limit:100,offset:0})).total,'1');
    const ar=await getCustomerBalanceReport(session,{asOf:'2026-10-10',limit:1});
    assert.equal(ar.totals.outstandingMinor,'1600');assert.equal(ar.totals.ledgerBalanceMinor,'1600');assert.equal(ar.coverage.balanced,true);
    assert.equal(ar.coverage.ageingBasis,'CHARGE_AGE_NOT_OVERDUE');assert.equal(ar.coverage.missingDueDates,true);
    assert.equal(ar.totals.age0To30Minor,'1600');assert.equal((await getCustomerBalanceReport(session,{asOf:'2026-10-09'})).totals.outstandingMinor,'1000');
    await assert.rejects(()=>getCustomerBalanceReport({...session,role:'cashier'},{asOf:'2026-10-10'}),{code:'FORBIDDEN'});
    assert.equal(await fingerprints(),before,'report reads and export preserve orders, immutable sale lines, payments and journals');
    assert.equal((await pool.query('SELECT count(*)::text n FROM system.audit_events WHERE tenant_id=$1 AND event_type=\'REPORT_ITEMS_EXPORTED\'',[tenantId])).rows[0].n,'1');
  });
  test('inventory values compare the same business scope and include archived stock without hiding incomplete movements',async()=>{
    const tenantId=randomUUID(),outletId=randomUUID(),otherOutlet=randomUUID(),userId=randomUUID();
    const session:ApiSession={sessionId:randomUUID(),userId,fullName:'Stock reviewer',email:`stock-${userId}@example.invalid`,tenantId,tenantName:'Stock controls',currency:'KES',outletId,outletName:'North',timeZone:'Africa/Nairobi',deviceId:randomUUID(),role:'accountant',capabilities:['inventory'],expiresAt:new Date(Date.now()+60_000)};
    await pool.query('INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,\'Stock controls\',\'KES\',\'Africa/Nairobi\')',[tenantId]);
    await pool.query('INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$3,\'North\',\'Africa/Nairobi\'),($2,$3,\'South\',\'Africa/Nairobi\')',[outletId,otherOutlet,tenantId]);
    await pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,\'unused-fixture\',\'Stock reviewer\')',[userId,session.email]);
    await pool.query('INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,\'accountant\')',[tenantId,userId]);
    const add=async(outlet:string,quantity:number,value:number,active:boolean,movement=true)=>{
      const id=randomUUID();await pool.query('INSERT INTO catalog.products(id,tenant_id,outlet_id,sku,name,base_unit,currency,selling_price_minor,cost_price_minor,tax_rate_bps,active) VALUES($1,$2,$3,$4,\'Control item\',\'each\',\'KES\',200,100,0,$5)',[id,tenantId,outlet,`ITEM-${id}`,active]);
      await pool.query('INSERT INTO inventory.balances(tenant_id,outlet_id,product_id,quantity,inventory_value_minor) VALUES($1,$2,$3,$4,$5)',[tenantId,outlet,id,quantity,value]);
      if(movement&&quantity)await pool.query('INSERT INTO inventory.movements(id,tenant_id,outlet_id,product_id,command_id,movement_type,quantity_delta,unit_cost_minor,value_minor) VALUES($1,$2,$3,$4,$5,\'OPENING\',$6,100,$7)',[randomUUID(),tenantId,outlet,id,randomUUID(),quantity,value]);
      return id;
    };
    const archived=await add(outletId,10,1000,false);await add(otherOutlet,5,600,true);await add(outletId,0,0,true);
    const entryId=randomUUID(),client=await pool.connect();
    try{await client.query('BEGIN');await client.query('INSERT INTO finance.journal_entries(id,tenant_id,source_type,source_id,currency,created_by) VALUES($1,$2,\'OPENING_PRODUCT_IMPORT\',$3,\'KES\',$4)',[entryId,tenantId,randomUUID(),userId]);await client.query('INSERT INTO finance.journal_lines(id,tenant_id,journal_entry_id,account_code,debit_minor,credit_minor) VALUES($1,$2,$3,\'INVENTORY\',1600,0),($4,$2,$3,\'OPENING_BALANCE_CLEARING\',0,1600)',[randomUUID(),tenantId,entryId,randomUUID()]);await client.query('COMMIT');}catch(cause){await client.query('ROLLBACK');throw cause;}finally{client.release();}
    const report=await getInventoryValueReport(session,{limit:1});assert.equal(report.outlet.carryingValueMinor,'1000');assert.equal(report.control.carryingValueMinor,'1600');assert.equal(report.control.ledgerValueMinor,'1600');assert.equal(report.control.totalsAgree,true);
    const rows=[...report.items];if(report.nextAfter)rows.push(...(await getInventoryValueReport(session,{limit:1,after:report.nextAfter,revision:report.revision})).items);
    assert.equal(rows.length,2);assert.equal(rows.find(row=>row.productId===archived)?.active,false);assert.equal(report.coverage.estimateProvenance,'NOT_RECORDED');
    await add(outletId,2,200,true,false);
    await assert.rejects(()=>getInventoryValueReport(session,{limit:1,after:report.nextAfter!,revision:report.revision}),{code:'REPORT_CHANGED'});
    const incomplete=await getInventoryValueReport(session);assert.equal(incomplete.outlet.movementMismatchCount,'1');assert.equal(incomplete.control.totalsAgree,false);assert.equal(incomplete.control.differenceMinor,'-200');
    await assert.rejects(()=>getInventoryValueReport({...session,role:'storekeeper'}),{code:'FORBIDDEN'});
  });
}
