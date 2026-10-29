import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { ApiRole, CommandEnvelope } from '../src/contracts.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  test('accounting source posting, corrections, AP, reconciliation and periods', { skip: 'Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database.' }, () => {});
} else {
  process.env.DATABASE_URL = databaseUrl;
  process.env.APP_ORIGINS ??= 'http://localhost:3000';
  const [{ buildApp }, { hashPassword }, db] = await Promise.all([import('../src/app.js'), import('../src/security.js'), import('../src/db.js')]);
  const origin = process.env.APP_ORIGINS.split(',')[0], password = `Disposable-accounting-${randomUUID()}`, passwordHash = await hashPassword(password);
  type Actor = { tenantId: string; outletId: string; userId: string; deviceId: string; headers: Record<string,string> };
  let loginNumber = 0;

  test('accounting workflows post balanced immutable source evidence and enforce close controls', async t => {
    const app = buildApp({logger:{level:'error'}}); await app.ready();
    async function tenant() {
      const tenantId = randomUUID(), outletId = randomUUID();
      await db.pool.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Disposable accounting business','KES','Africa/Nairobi')",[tenantId]);
      await db.pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Accounting outlet','Africa/Nairobi')",[outletId,tenantId]);
      await db.pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'commerce'),($1,'inventory'),($1,'hospitality')",[tenantId]);
      return {tenantId,outletId};
    }
    async function actor(scope:{tenantId:string;outletId:string},role:ApiRole,name:string):Promise<Actor> {
      const userId = randomUUID(),deviceId = randomUUID(),email = `accounting-${userId}@example.invalid`;
      await db.pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)',[userId,email,passwordHash,name]);
      await db.pool.query('INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[scope.tenantId,userId,role]);
      await db.pool.query('INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,$5)',[deviceId,scope.tenantId,scope.outletId,userId,`${name} workspace`]);
      const login = await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{'x-forwarded-for':`198.51.100.${100+(++loginNumber)}`},payload:{email,password,deviceId}});
      assert.equal(login.statusCode,200,login.body);
      const raw = login.headers['set-cookie'],cookie = (Array.isArray(raw)?raw:[raw]).filter((value):value is string=>typeof value==='string').map(value=>value.split(';',1)[0]).join('; ');
      return {...scope,userId,deviceId,headers:{cookie,origin,'x-csrf-token':login.json().csrfToken}};
    }
    function command(operator:Actor,type:string,payload:Record<string,unknown>,expectedVersions:Record<string,number>={}):CommandEnvelope { return {protocolVersion:1,commandId:randomUUID(),tenantId:operator.tenantId,deviceId:operator.deviceId,type,occurredAt:new Date().toISOString(),expectedVersions,payload}; }
    async function submit(operator:Actor,envelope:CommandEnvelope) { const response = await app.inject({method:'POST',url:'/api/v1/commands',headers:operator.headers,payload:envelope}); assert.equal(response.statusCode,200,response.body); return response.json(); }
    async function confirmed(operator:Actor,type:string,payload:Record<string,unknown>,versions:Record<string,number>={}) { const result = await submit(operator,command(operator,type,payload,versions)); assert.equal(result.status,'CONFIRMED',JSON.stringify(result)); return result.value; }
    async function read(operator:Actor,path:string) { const response = await app.inject({url:`/api/v1${path}`,headers:operator.headers}); assert.equal(response.statusCode,200,response.body); return response.json(); }
    const scope = await tenant(), otherScope = await tenant();
    try {
      const owner = await actor(scope,'owner','Accounting owner'), cashier = await actor(scope,'cashier','Accounting cashier'), manager = await actor(scope,'manager','Accounting manager'), other = await actor(otherScope,'owner','Other business owner');
      const current = (await db.pool.query("SELECT to_char(transaction_timestamp() AT TIME ZONE 'Africa/Nairobi','YYYY-MM-DD') today,to_char((transaction_timestamp() AT TIME ZONE 'Africa/Nairobi')::date-2,'YYYY-MM-DD') earlier")).rows[0];
      const today:string = current.today, earlier:string = current.earlier;
      const expensePayload = {effectiveDate:earlier,amountMinor:1000,currency:'KES',category:'UTILITIES_EXPENSE',description:'Reviewed electricity payment',payee:'Utility provider',paymentAccount:'BANK_CONTROL',reference:'BANK-EXPENSE-001',manuallyConfirmed:true};
      let expenseId = '', invoiceId = '', supplierId = '', receiptCommandId = '', productId = '', periodId = '';

      await t.test('expenses use effective dates, immutable corrections and original-command recovery',async()=>{
        const envelope = command(owner,'finance.expense.record',expensePayload), saved = await submit(owner,envelope);
        assert.equal(saved.status,'CONFIRMED',JSON.stringify(saved)); expenseId = saved.value.expenseId;
        assert.deepEqual(await submit(owner,envelope),saved);
        assert.deepEqual((await read(owner,`/commands/${envelope.commandId}`)).response.value,saved.value);
        const entry = (await db.pool.query('SELECT effective_date::text,posted_at::date::text posted_day FROM finance.journal_entries WHERE tenant_id=$1 AND source_id=$2',[scope.tenantId,envelope.commandId])).rows[0]; assert.equal(entry.effective_date,earlier);
        const periodReport = await read(owner,`/reports/profit-loss?from=${earlier}&to=${earlier}`); assert.equal(periodReport.totals.otherOperatingCostsMinor,'1000');
        assert.equal((await submit(owner,command(owner,'finance.expense.record',expensePayload))).code,'DUPLICATE_PAYMENT_REFERENCE');
        const invalid = await submit(owner,command(owner,'finance.expense.record',{...expensePayload,reference:'BANK-INVALID-001',amountMinor:1.25})); assert.equal(invalid.status,'REJECTED');
        assert.equal((await submit(cashier,command(cashier,'finance.expense.record',{...expensePayload,reference:'CASHIER-DENIED'}))).code,'FORBIDDEN');
        assert.equal((await submit(other,command(other,'finance.expense.reverse',{expenseId,effectiveDate:today,reason:'Foreign expense must stay private'}))).code,'NOT_FOUND');
        const reclassified = await confirmed(owner,'finance.expense.reclassify',{expenseId,effectiveDate:today,category:'RENT_EXPENSE',reason:'Original category was entered incorrectly'},{[`expense:${expenseId}`]:1});
        assert.equal(reclassified.version,2);
        assert.equal((await submit(owner,command(owner,'finance.expense.reclassify',{expenseId,effectiveDate:today,category:'OPERATING_EXPENSE',reason:'Stale edit'},{[`expense:${expenseId}`]:1}))).code,'VERSION_CONFLICT');
        const categoryHistory = (await read(owner,'/finance/records/expenses')).records[0];
        assert.equal(categoryHistory.category,'UTILITIES_EXPENSE'); assert.equal(categoryHistory.currentCategory,'RENT_EXPENSE');
        assert.equal(categoryHistory.reclassification.category,'RENT_EXPENSE');
        const correctedCategoryReport = await read(owner,`/reports/profit-loss?from=${today}&to=${today}`);
        assert.equal(correctedCategoryReport.totals.otherOperatingCostsMinor,'0');
        assert.equal((await db.pool.query('SELECT count(*)::text n FROM finance.expense_reclassifications WHERE tenant_id=$1 AND expense_id=$2',[scope.tenantId,expenseId])).rows[0].n,'1');
        const corrected = await confirmed(owner,'finance.expense.reverse',{expenseId,effectiveDate:today,reason:'Wrong payment was recorded; correction only'},{[`expense:${expenseId}`]:2}); assert.equal(corrected.moneyTransferInitiated,false);
        assert.equal((await submit(owner,command(owner,'finance.expense.reverse',{expenseId,effectiveDate:today,reason:'Attempted duplicate correction'},{[`expense:${expenseId}`]:3}))).code,'ALREADY_REVERSED');
        const original = (await db.pool.query('SELECT amount_minor::text,description FROM finance.expenses WHERE id=$1',[expenseId])).rows[0]; assert.deepEqual(original,{amount_minor:'1000',description:'Reviewed electricity payment'});
        await assert.rejects(db.pool.query('UPDATE finance.expenses SET amount_minor=1 WHERE id=$1',[expenseId]),{code:'55000'});
        const history = await read(owner,'/finance/records/expenses'); assert.equal(history.records[0].reversal.id,corrected.reversalId);
        const earlierAgain = await read(owner,`/reports/profit-loss?from=${earlier}&to=${earlier}`); assert.equal(earlierAgain.totals.otherOperatingCostsMinor,'1000','today correction must not rewrite the original accounting date');
      });

      await t.test('supplier bills and partial payments reconcile AP without expensing received stock twice',async()=>{
        supplierId = (await confirmed(owner,'finance.supplier.create',{name:'Verified supplier',phone:'0700000001'})).supplierId;
        const invoice = await confirmed(owner,'finance.supplier.invoice',{supplierId,reference:'OPERATING-BILL-001',invoiceDate:earlier,dueDate:today,amountMinor:500,currency:'KES',description:'Operating services invoice',kind:'EXPENSE',category:'OPERATING_EXPENSE'}); invoiceId = invoice.invoiceId;
        assert.equal((await submit(owner,command(owner,'finance.supplier.invoice',{supplierId,reference:'OPERATING-BILL-001',invoiceDate:earlier,dueDate:today,amountMinor:500,currency:'KES',description:'Duplicate reference invoice',kind:'EXPENSE',category:'OPERATING_EXPENSE'}))).code,'DUPLICATE_SUPPLIER_INVOICE');
        const paymentPayload = {invoiceId,effectiveDate:today,amountMinor:200,currency:'KES',paymentAccount:'BANK_CONTROL',reference:'SUPPLIER-PAYMENT-001',manuallyConfirmed:true};
        const paymentCommand = command(owner,'finance.supplier.payment',paymentPayload,{[`invoice:${invoiceId}`]:1}), paid = await submit(owner,paymentCommand); assert.equal(paid.status,'CONFIRMED',JSON.stringify(paid)); assert.equal(paid.value.remainingMinor,'300'); assert.deepEqual(await submit(owner,paymentCommand),paid);
        assert.equal((await submit(owner,command(owner,'finance.supplier.payment',{...paymentPayload,reference:'SUPPLIER-STALE-001'},{[`invoice:${invoiceId}`]:1}))).code,'VERSION_CONFLICT');
        assert.equal((await submit(owner,command(owner,'finance.supplier.payment',{...paymentPayload,reference:'SUPPLIER-EXCESS-001',amountMinor:301},{[`invoice:${invoiceId}`]:2}))).code,'PAYMENT_EXCEEDS_BALANCE');
        assert.equal((await submit(owner,command(owner,'finance.supplier.payment',{...paymentPayload,reference:'BANK-EXPENSE-001'},{[`invoice:${invoiceId}`]:2}))).code,'DUPLICATE_PAYMENT_REFERENCE','corrected expense references stay reserved across AP');
        assert.equal((await submit(owner,command(owner,'finance.supplier.invoice.reverse',{invoiceId,effectiveDate:today,reason:'Paid invoice cannot lose its payment'},{[`invoice:${invoiceId}`]:2}))).code,'PAID_INVOICE_REVERSAL_UNAVAILABLE');
        const product = await confirmed(owner,'catalog.product.create',{sku:'ACCOUNTING-ITEM',name:'Accounting receipt item',baseUnit:'each',currency:'KES',sellingPriceMinor:10000,costPriceMinor:4000,taxRateBps:0}); productId = product.productId;
        const receive = command(owner,'inventory.receive',{documentReference:'DELIVERY-ACCOUNTING-001',supplierName:'Verified supplier',lines:[{productId,quantity:'10',unitCostMinor:4000}]}); receiptCommandId = receive.commandId; assert.equal((await submit(owner,receive)).status,'CONFIRMED');
        const receipts = await read(owner,'/finance/records/receipts'); assert.ok(receipts.records.some((receipt:{id:string})=>receipt.id===receiptCommandId));
        const inventoryBefore = (await db.pool.query('SELECT quantity::text,inventory_value_minor::text FROM inventory.balances WHERE tenant_id=$1 AND product_id=$2',[scope.tenantId,productId])).rows[0];
        const matched = await confirmed(owner,'finance.supplier.invoice',{supplierId,reference:'STOCK-INVOICE-001',invoiceDate:today,dueDate:today,amountMinor:40000,currency:'KES',description:'Matched received-stock invoice',kind:'RECEIPT',receiptCommandId});
        const source = (await db.pool.query(`SELECT l.account_code,l.debit_minor::text,l.credit_minor::text FROM finance.journal_entries j JOIN finance.journal_lines l ON l.tenant_id=j.tenant_id AND l.journal_entry_id=j.id WHERE j.tenant_id=$1 AND j.id=$2 ORDER BY l.account_code`,[scope.tenantId,matched.journalId])).rows;
        assert.deepEqual(source,[{account_code:'ACCOUNTS_PAYABLE',debit_minor:'0',credit_minor:'40000'},{account_code:'GOODS_RECEIVED_NOT_INVOICED',debit_minor:'40000',credit_minor:'0'}]);
        assert.deepEqual((await db.pool.query('SELECT quantity::text,inventory_value_minor::text FROM inventory.balances WHERE tenant_id=$1 AND product_id=$2',[scope.tenantId,productId])).rows[0],inventoryBefore);
        const duplicateReceipt = await submit(owner,command(owner,'finance.supplier.invoice',{supplierId,reference:'STOCK-DOUBLE-INVOICE',invoiceDate:today,dueDate:today,amountMinor:40000,currency:'KES',description:'Must not invoice received stock twice',kind:'RECEIPT',receiptCommandId})); assert.equal(duplicateReceipt.code,'DUPLICATE_SUPPLIER_INVOICE');
        await confirmed(owner,'finance.supplier.invoice.reverse',{invoiceId:matched.invoiceId,effectiveDate:today,reason:'Invoice linked to wrong received delivery'},{[`invoice:${matched.invoiceId}`]:1});
        assert.equal((await read(owner,'/finance/records/invoices')).records.find((record:{id:string})=>record.id===matched.invoiceId).status,'REVERSED');
        assert.ok((await read(owner,'/finance/records/receipts')).records.some((receipt:{id:string})=>receipt.id===receiptCommandId),'a reversed unpaid receipt invoice must permit correction');
        const rerecorded = await confirmed(owner,'finance.supplier.invoice',{supplierId,reference:'STOCK-INVOICE-001',invoiceDate:today,dueDate:today,amountMinor:40000,currency:'KES',description:'Corrected received-stock invoice',kind:'RECEIPT',receiptCommandId});
        await confirmed(owner,'finance.supplier.invoice.reverse',{invoiceId:rerecorded.invoiceId,effectiveDate:today,reason:'Leave receipt unbilled for the remaining test'},{[`invoice:${rerecorded.invoiceId}`]:1});
        const controls = await read(owner,'/finance/controls'); assert.equal(controls.controls.payables.ledgerMinor,'300'); assert.equal(controls.controls.payables.subledgerMinor,'300'); assert.equal(controls.controls.payables.balanced,true); assert.equal(controls.controls.inventory.balanced,true); assert.equal(controls.coverage.status,'PARTIAL'); assert.ok(controls.coverage.negativeNoncashAccounts.some((account:{accountCode:string})=>account.accountCode==='BANK_CONTROL'));
      });

      await t.test('incoming statement match and versioned correction preserve proof and never post money twice',async()=>{
        const opened = await confirmed(owner,'shift.open',{openingFloatMinor:0});
        const sale = await confirmed(owner,'sales.order.settle',{shiftId:opened.shiftId,lines:[{productId,quantity:'1'}],tenders:[{method:'MANUAL_MPESA',amountMinor:10000,currency:'KES',reference:'PROOF-PAYMENT-001',manuallyConfirmed:true}]},{[`shift:${opened.shiftId}`]:1});
        const before = (await db.pool.query('SELECT count(*)::int n FROM finance.journal_entries WHERE tenant_id=$1',[scope.tenantId])).rows[0].n;
        await confirmed(owner,'finance.mpesa.statement.record',{reference:'INCOMING-STATEMENT-001',from:today,to:today,currency:'KES',lines:[{reference:'TYPO-REFERENCE-001',occurredOn:today,amountMinor:9999}]});
        let line = (await read(owner,'/finance/records/statement-lines')).records[0];
        const candidates = await read(owner,'/finance/records/mpesa-payments?reference=PROOF-PAYMENT-001'); assert.equal(candidates.records.length,1); assert.equal(candidates.records[0].operatorName,'Accounting owner');
        const paymentId = candidates.records[0].id;
        assert.equal((await submit(owner,command(owner,'finance.mpesa.statement.match',{lineId:line.id,paymentId}))).code,'STATEMENT_PAYMENT_MISMATCH');
        await confirmed(owner,'finance.mpesa.statement.correct',{lineId:line.id,reference:'PROOF-PAYMENT-001',occurredOn:today,amountMinor:10001,reason:'Correct the transaction reference first'},{[`statement-line:${line.id}`]:1});
        assert.equal((await submit(owner,command(owner,'finance.mpesa.statement.correct',{lineId:line.id,reference:'PROOF-PAYMENT-001',occurredOn:today,amountMinor:10000,reason:'Stale correction must not overwrite'},{[`statement-line:${line.id}`]:1}))).code,'VERSION_CONFLICT');
        await confirmed(owner,'finance.mpesa.statement.correct',{lineId:line.id,reference:'PROOF-PAYMENT-001',occurredOn:today,amountMinor:10000,reason:'Correct reviewed incoming amount'},{[`statement-line:${line.id}`]:2});
        line = (await read(owner,'/finance/records/statement-lines')).records[0]; assert.equal(line.originalReference,'TYPO-REFERENCE-001'); assert.equal(line.originalAmountMinor,'9999'); assert.equal(line.reference,'PROOF-PAYMENT-001'); assert.equal(line.amountMinor,'10000'); assert.equal(line.version,3);
        const envelope = command(owner,'finance.mpesa.statement.match',{lineId:line.id,paymentId}), matched = await submit(owner,envelope); assert.equal(matched.status,'CONFIRMED',JSON.stringify(matched)); assert.deepEqual(await submit(owner,envelope),matched);
        assert.equal((await submit(owner,command(owner,'finance.mpesa.statement.match',{lineId:line.id,paymentId}))).code,'ALREADY_MATCHED');
        assert.equal((await submit(owner,command(owner,'finance.mpesa.statement.correct',{lineId:line.id,reference:'PROOF-PAYMENT-001',occurredOn:today,amountMinor:1,reason:'Matched evidence must stay frozen'},{[`statement-line:${line.id}`]:3}))).code,'MATCHED_STATEMENT_CORRECTION_UNAVAILABLE');
        for (const reference of ['TYPO-REFERENCE-001','PROOF-PAYMENT-001']) assert.equal((await submit(owner,command(owner,'finance.mpesa.statement.record',{reference:`DUPLICATE-${reference}`,from:today,to:today,currency:'KES',lines:[{reference,occurredOn:today,amountMinor:10000}]}))).code,'DUPLICATE_STATEMENT_REFERENCE');
        assert.equal((await db.pool.query('SELECT count(*)::int n FROM finance.journal_entries WHERE tenant_id=$1',[scope.tenantId])).rows[0].n,before);
        const controls = await read(owner,'/finance/controls'); assert.equal(controls.incomingMpesa.recordedMinor,'10000'); assert.equal(controls.incomingMpesa.matchedMinor,'10000'); assert.equal(controls.incomingMpesa.unmatchedCount,'0'); assert.equal(controls.incomingMpesa.unmatchedStatementCount,'0');
        const receipt = await read(owner,`/sales/orders/${sale.saleId}/receipt`); assert.equal(receipt.totalMinor,'10000'); assert.equal(receipt.payments[0].reference,'PROOF-PAYMENT-001');
        await assert.rejects(db.pool.query('DELETE FROM finance.mpesa_statement_line_corrections WHERE tenant_id=$1',[scope.tenantId]),{code:'55000'});
      });

      await t.test('bounded histories continue without omissions and remain tenant/role scoped',async()=>{
        const ids = [supplierId];
        for (let i=0;i<5;i++) {
          const supplier = await confirmed(owner,'finance.supplier.create',{name:`History supplier ${i}`}); ids.push(supplier.supplierId);
          await db.pool.query('UPDATE finance.suppliers SET created_at=$2::timestamptz WHERE id=$1',[supplier.supplierId,`${earlier}T12:00:00.00000${i+1}Z`]);
        }
        const seen:string[] = []; let cursor:string|null = null;
        do {
          const page = await read(owner,`/finance/records/suppliers?limit=2${cursor?`&after=${encodeURIComponent(cursor)}`:''}`);
          seen.push(...page.records.map((row:{id:string})=>row.id)); assert.equal(page.pageInfo.limit,2); cursor = page.pageInfo.nextCursor;
          if (!page.pageInfo.hasMore) assert.equal(cursor,null);
        } while(cursor);
        assert.equal(seen.length,ids.length); assert.deepEqual(new Set(seen),new Set(ids));
        assert.equal((await app.inject({url:'/api/v1/finance/records/suppliers?limit=101',headers:owner.headers})).statusCode,400);
        assert.equal((await app.inject({url:'/api/v1/finance/controls',headers:cashier.headers})).statusCode,403);
        assert.equal((await read(other,'/finance/records/suppliers')).records.length,0);
        assert.equal((await read(manager,'/finance/controls')).permissions.manage,true); assert.equal((await read(manager,'/finance/controls')).permissions.close,false);
      });

      await t.test('period close freezes posting, requires reconciled evidence and defeats stale serializable snapshots',async()=>{
        const opened = await confirmed(owner,'finance.period.create',{from:today,to:today,reason:'Daily accounting review'}); periodId = opened.periodId;
        assert.equal((await submit(manager,command(manager,'finance.period.transition',{periodId,status:'CLOSING',reason:'A manager cannot close accounting periods'},{[`period:${periodId}`]:1}))).code,'FORBIDDEN');
        assert.equal((await submit(owner,command(owner,'finance.period.transition',{periodId,status:'CLOSING',reason:'Cashiers still need to close their shifts'},{[`period:${periodId}`]:1}))).code,'OPEN_SHIFTS_BLOCK_PERIOD');
        const shift = (await read(owner,'/shifts/current')).shift;
        await confirmed(owner,'shift.close',{shiftId:shift.id,countedCashMinor:0},{[`shift:${shift.id}`]:shift.version});
        await confirmed(owner,'finance.period.transition',{periodId,status:'CLOSING',reason:'Review completed cashier cash-up'},{[`period:${periodId}`]:1});
        assert.equal((await submit(owner,command(owner,'finance.expense.record',{...expensePayload,effectiveDate:today,reference:'CLOSING-BLOCKS-EXPENSE'}))).code,'PERIOD_CLOSED');
        await db.pool.query('UPDATE inventory.balances SET inventory_value_minor=inventory_value_minor+1 WHERE tenant_id=$1 AND product_id=$2',[scope.tenantId,productId]);
        assert.equal((await submit(owner,command(owner,'finance.period.transition',{periodId,status:'CLOSED',reason:'Unexplained inventory difference must block closing'},{[`period:${periodId}`]:2}))).code,'PERIOD_RECONCILIATION_FAILED');
        await db.pool.query('UPDATE inventory.balances SET inventory_value_minor=inventory_value_minor-1 WHERE tenant_id=$1 AND product_id=$2',[scope.tenantId,productId]);
        const stale = await db.pool.connect();
        try {
          await stale.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
          await stale.query('SELECT accounting_period_version FROM core.tenants WHERE id=$1',[scope.tenantId]);
          await confirmed(owner,'finance.period.transition',{periodId,status:'CLOSED',reason:'Matched incoming proof and reconciled supported controls'},{[`period:${periodId}`]:2});
          await stale.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1::text,9036))',[scope.tenantId]);
          await assert.rejects(stale.query('SELECT accounting_period_version FROM core.tenants WHERE id=$1 FOR SHARE',[scope.tenantId]),{code:'40001'});
        } finally { await stale.query('ROLLBACK'); stale.release(); }
        assert.equal((await submit(owner,command(owner,'finance.period.transition',{periodId,status:'OPEN',reason:'Closed periods must remain immutable in scope'},{[`period:${periodId}`]:3}))).code,'INVALID_PERIOD_TRANSITION');
        for (const type of ['inventory.receive','inventory.count.post','shift.open','shift.cash.movement','shift.close','sales.order.settle','sales.order.refund','customers.repayment','hotel.checkout']) {
          const payload=type==='inventory.count.post'?{countId:randomUUID(),valuationReason:'Valid count posting payload for closed-period admission'}:{openingFloatMinor:0};
          const envelope = command(owner,type,payload); envelope.occurredAt = `${earlier}T10:00:00.000Z`;
          const rejected = await submit(owner,envelope); assert.equal(rejected.code,'PERIOD_CLOSED',`${type}: ${JSON.stringify(rejected)}`);
          assert.deepEqual(await submit(owner,envelope),rejected,'closed-period rejection remains an exact recoverable outcome');
        }
        assert.equal((await submit(owner,command(owner,'shift.open',{openingFloatMinor:-1}))).code,'VALIDATION_FAILED','existing strict static schema validation keeps precedence over closed-period admission');
        assert.equal((await submit(owner,command(owner,'catalog.import.apply',{batchId:'invalid-uuid',reviewed:true,acknowledgedWarnings:true}))).code,'VALIDATION_FAILED','compatibility admission must not query an invalid batch UUID');
        for(const orderId of ['invalid-uuid',42,[],{}])assert.equal((await submit(owner,command(owner,'sales.order.refund',{orderId}))).code,'VALIDATION_FAILED','compatibility admission must not query a malformed supplied refund UUID');
        const service=await confirmed(owner,'catalog.product.create',{sku:'CLOSED-PERIOD-SERVICE',name:'Closed period service',itemKind:'SERVICE',baseUnit:'each',currency:'KES',sellingPriceMinor:1000,costPriceMinor:0,taxRateBps:0});
        await db.pool.query("DELETE FROM core.tenant_capabilities WHERE tenant_id=$1 AND capability='inventory'",[scope.tenantId]);
        try {
          const envelope=command(owner,'sales.order.settle',{shiftId:shift.id,lines:[{productId:service.productId,quantity:'1'}],tenders:[{method:'CASH',amountMinor:1000,currency:'KES'}]},{[`shift:${shift.id}`]:shift.version});
          const rejected=await submit(owner,envelope);assert.equal(rejected.code,'PERIOD_CLOSED');
          assert.deepEqual((await db.pool.query('SELECT required_capabilities FROM system.commands WHERE tenant_id=$1 AND command_id=$2',[scope.tenantId,envelope.commandId])).rows[0].required_capabilities,['commerce']);
          assert.equal((await read(owner,`/commands/${envelope.commandId}`)).response.code,'PERIOD_CLOSED','valid service rejection remains recoverable without inventory');
          assert.deepEqual(await submit(owner,envelope),rejected);
        } finally {await db.pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'inventory')",[scope.tenantId]);}
        await assert.rejects(db.pool.query("INSERT INTO finance.journal_entries(id,tenant_id,source_type,source_id,currency,created_by,effective_date) VALUES($1,$2,'UNAUTHORIZED_DATE_BYPASS',$3,'KES',$4,$5::date)",[randomUUID(),scope.tenantId,randomUUID(),owner.userId,today]),{code:'55000'});
        const unbalanced = await db.pool.query(`SELECT j.id FROM finance.journal_entries j LEFT JOIN finance.journal_lines l ON l.tenant_id=j.tenant_id AND l.journal_entry_id=j.id WHERE j.tenant_id=$1 GROUP BY j.id HAVING coalesce(sum(l.debit_minor),0)=0 OR coalesce(sum(l.debit_minor),0)<>coalesce(sum(l.credit_minor),0)`,[scope.tenantId]); assert.equal(unbalanced.rowCount,0);
        assert.equal((await read(owner,'/finance/records/periods')).records[0].status,'CLOSED');
      });
    } finally { await app.close(); await db.pool.end(); }
  });
}
