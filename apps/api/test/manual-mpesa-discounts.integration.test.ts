import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { CommandEnvelope, ApiRole } from '../src/contracts.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  test('manual M-Pesa, line amount discounts, exact returns and cash reconciliation', { skip: 'Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database.' }, () => {});
} else {
  process.env.DATABASE_URL = databaseUrl;
  process.env.APP_ORIGINS ??= 'http://localhost:3000';
  const [{ buildApp }, { hashPassword }, { ROLE_PERMISSIONS }, db] = await Promise.all([
    import('../src/app.js'), import('../src/security.js'), import('../src/contracts.js'), import('../src/db.js'),
  ]);
  const origin = process.env.APP_ORIGINS.split(',')[0];
  type Actor = { tenantId: string; outletId: string; userId: string; deviceId: string; headers: Record<string, string> };
  const password = `Disposable-payment-${randomUUID()}`, passwordHash = await hashPassword(password);
  let loginNumber = 0;

  test('manual payments and amount discounts preserve money, stock, history and recovery', async t => {
    const app = buildApp({ logger: { level: 'error' } });
    await app.ready();
    async function actor(tenantId: string, outletId: string, role: ApiRole, name: string): Promise<Actor> {
      const userId = randomUUID(), deviceId = randomUUID(), email = `manual-${userId}@example.invalid`;
      await db.pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)', [userId, email, passwordHash, name]);
      await db.pool.query('INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [tenantId, userId, role]);
      await db.pool.query('INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,$5)', [deviceId, tenantId, outletId, userId, `${name} workspace`]);
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'x-forwarded-for': `198.51.100.${++loginNumber}` }, payload: { email, password, deviceId } });
      assert.equal(login.statusCode, 200, login.body);
      const cookies = login.headers['set-cookie'];
      const cookie = (Array.isArray(cookies) ? cookies : [cookies]).filter((value): value is string => typeof value === 'string').map(value => value.split(';', 1)[0]).join('; ');
      return { tenantId, outletId, userId, deviceId, headers: { cookie, origin, 'x-csrf-token': login.json().csrfToken } };
    }
    function command(operator: Actor, type: string, payload: Record<string, unknown>, expectedVersions: Record<string, number> = {}): CommandEnvelope {
      return { protocolVersion: 1, commandId: randomUUID(), tenantId: operator.tenantId, deviceId: operator.deviceId, type, occurredAt: new Date().toISOString(), expectedVersions, payload };
    }
    async function submit(operator: Actor, envelope: CommandEnvelope) {
      const response = await app.inject({ method: 'POST', url: '/api/v1/commands', headers: operator.headers, payload: envelope });
      assert.equal(response.statusCode, 200, response.body);
      return response.json();
    }
    async function confirmed(operator: Actor, type: string, payload: Record<string, unknown>, versions: Record<string, number> = {}) {
      const response = await submit(operator, command(operator, type, payload, versions));
      assert.equal(response.status, 'CONFIRMED', JSON.stringify(response));
      return response.value;
    }
    async function read(operator: Actor, path: string) {
      const response = await app.inject({ url: `/api/v1${path}`, headers: operator.headers });
      assert.equal(response.statusCode, 200, response.body); return response.json();
    }
    async function item(operator: Actor, price = 10000, cost = 4000, tax = 1600) {
      const created = await confirmed(operator, 'catalog.product.create', { sku: `PAY-${randomUUID().slice(0, 8)}`, name: 'Payment evidence item', baseUnit: 'each', currency: 'KES', sellingPriceMinor: price, costPriceMinor: cost, taxRateBps: tax });
      await confirmed(operator, 'inventory.receive', { lines: [{ productId: created.productId, quantity: '100', unitCostMinor: cost }] });
      return String(created.productId);
    }
    async function sale(operator: Actor, lines: unknown[], tenders: unknown[]) {
      const { shift } = await read(operator, '/shifts/current');
      return command(operator, 'sales.order.settle', { shiftId: shift.id, lines, tenders }, { [`shift:${shift.id}`]: shift.version });
    }
    async function refund(operator: Actor, orderId: string, lineId: string, quantity: string) {
      const { shift } = await read(operator, '/shifts/current');
      return command(operator, 'sales.order.refund', { orderId, shiftId: shift.id, reason: 'Customer returned item', lines: [{ orderLineId: lineId, quantity, restock: true }] }, { [`shift:${shift.id}`]: shift.version });
    }
    const cash = (amountMinor: number) => [{ method: 'CASH', amountMinor, currency: 'KES' }];
    const mpesa = (reference: string, amountMinor: number) => [{ method: 'MANUAL_MPESA', amountMinor, currency: 'KES', reference, manuallyConfirmed: true }];
    const tenantId = randomUUID(), outletId = randomUUID();
    try {
      await db.pool.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Disposable manual payment business','KES','Africa/Nairobi')", [tenantId]);
      await db.pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Payment outlet','Africa/Nairobi')", [outletId, tenantId]);
      await db.pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'commerce'),($1,'inventory')", [tenantId]);
      const owner = await actor(tenantId, outletId, 'owner', 'Payment owner');
      const cashier = await actor(tenantId, outletId, 'cashier', 'Confirming cashier');
      assert.ok(ROLE_PERMISSIONS.cashier.includes('commerce.discount'));
      const productId = await item(owner);
      await confirmed(owner, 'shift.open', { openingFloatMinor: 100000 });
      await confirmed(cashier, 'shift.open', { openingFloatMinor: 100000 });
      // Omitted discount/payment evidence fields remain the original cash contract.
      const oldCash = await submit(owner, await sale(owner, [{ productId, quantity: '1' }], cash(12000)));
      assert.equal(oldCash.status, 'CONFIRMED', JSON.stringify(oldCash));
      const oldReceipt = await read(owner, `/sales/orders/${oldCash.value.saleId}/receipt`);
      assert.equal(oldReceipt.discountMinor, '0'); assert.equal(oldReceipt.totalMinor, '11600');
      let manualSaleId = '', manualLineId = '';

      await t.test('cashier confirmation posts once to mobile money and survives exact replay/status recovery', async () => {
        const envelope = await sale(cashier, [{ productId, quantity: '2', discountMinor: 3000, discountReason: 'Customer loyalty amount' }], mpesa('PAY-REFERENCE-001', 19720));
        const result = await submit(cashier, envelope);
        assert.equal(result.status, 'CONFIRMED', JSON.stringify(result));
        assert.equal(result.value.originalSubtotalMinor, 20000); assert.equal(result.value.discountMinor, 3000);
        assert.equal(result.value.subtotalMinor, 17000); assert.equal(result.value.taxMinor, 2720); assert.equal(result.value.totalMinor, 19720);
        manualSaleId = result.value.saleId;
        assert.deepEqual(await submit(cashier, envelope), result);
        const changed = structuredClone(envelope); (changed.payload.tenders as Array<Record<string, unknown>>)[0].reference = 'PAY-CHANGED-REFERENCE';
        assert.equal((await submit(cashier, changed)).code, 'IDEMPOTENCY_MISMATCH');
        const status = await read(cashier, `/commands/${envelope.commandId}`); assert.deepEqual(status.response.value, result.value);
        const receipt = await read(cashier, `/sales/orders/${manualSaleId}/receipt`);
        manualLineId = receipt.lines[0].lineId;
        assert.equal(receipt.lines[0].originalSubtotalMinor, '20000'); assert.equal(receipt.lines[0].discountMinor, '3000');
        assert.equal(receipt.lines[0].discountReason, 'Customer loyalty amount');
        assert.equal(receipt.cashTenderedMinor, null); assert.equal(receipt.changeMinor, null);
        assert.equal(receipt.payments[0].method, 'MANUAL_MPESA'); assert.equal(receipt.payments[0].reference, 'PAY-REFERENCE-001');
        assert.equal(receipt.payments[0].confirmation, 'CASHIER_CONFIRMED'); assert.equal(receipt.payments[0].confirmedBy, 'Confirming cashier');
        assert.ok(receipt.payments[0].confirmedAt);
        const current = (await read(cashier, '/shifts/current')).shift;
        assert.equal(current.expectedCashMinor, 100000); assert.equal(current.cashSalesMinor, 0); assert.equal(current.mpesaSalesMinor, 19720);
        const history = (await read(cashier, '/sales/orders')).orders.find((order: { id: string }) => order.id === manualSaleId);
        assert.equal(history.paymentMethod, 'manual_mpesa'); assert.equal(history.discountMinor, '3000'); assert.equal(history.payments[0].reference, 'PAY-REFERENCE-001');
        const evidence = (await db.pool.query(`SELECT
          (SELECT count(*)::int FROM commerce.orders WHERE tenant_id=$1 AND id=$2) orders,
          (SELECT count(*)::int FROM commerce.payments WHERE tenant_id=$1 AND order_id=$2) payments,
          (SELECT cogs_minor::text FROM commerce.order_lines WHERE tenant_id=$1 AND order_id=$2) cogs,
          (SELECT sum(jl.debit_minor)::text FROM finance.journal_entries je JOIN finance.journal_lines jl ON jl.journal_entry_id=je.id AND jl.tenant_id=je.tenant_id WHERE je.tenant_id=$1 AND je.source_id=$3 AND jl.account_code='MOBILE_MONEY_CONTROL') mobile_debit`, [tenantId, manualSaleId, envelope.commandId])).rows[0];
        assert.deepEqual(evidence, { orders: 1, payments: 1, cogs: '8000', mobile_debit: '19720' });
        await assert.rejects(db.pool.query("UPDATE commerce.payments SET reference='PAY-REPLACEMENT' WHERE tenant_id=$1 AND order_id=$2", [tenantId, manualSaleId]), { code: '55000' });
        await assert.rejects(db.pool.query('UPDATE commerce.order_lines SET discount_minor=0,discount_reason=NULL WHERE id=$1', [manualLineId]), { code: '55000' });
        assert.deepEqual(await read(owner, `/sales/orders/${oldCash.value.saleId}/receipt`), oldReceipt);
      });

      await t.test('invalid or unsupported pricing/payment inputs cannot silently change or post a sale', async () => {
        const validLine = { productId, quantity: '2', discountMinor: 3000, discountReason: 'Reviewed item amount' };
        const before = (await db.pool.query(`SELECT (SELECT count(*)::int FROM commerce.orders WHERE tenant_id=$1) orders,(SELECT count(*)::int FROM finance.journal_entries WHERE tenant_id=$1) journals,(SELECT quantity::text FROM inventory.balances WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3) quantity`, [tenantId, outletId, productId])).rows[0];
        const cases: Array<{ line?: unknown; tender?: unknown[]; extra?: Record<string, unknown> }> = [
          { line: { ...validLine, discountPercent: 10 } }, { line: { ...validLine, unitPriceMinor: 1 } }, { extra: { discountMinor: 100 } },
          ...[-1, 0.5, '3000', null, Number.MAX_SAFE_INTEGER + 1, 20001].map(discountMinor => ({ line: { ...validLine, discountMinor } })),
          { line: { productId, quantity: '2', discountMinor: 3000 } }, { line: { ...validLine, discountReason: ' ' } },
          { tender: [{ ...mpesa('PAY-INVALID-001', 19720)[0], manuallyConfirmed: false }] },
          { tender: mpesa('lower-reference', 19720) }, { tender: mpesa('INVALID_REFERENCE', 19720) }, { tender: mpesa('P'.repeat(65), 19720) },
          { tender: mpesa('PAY-AMOUNT-LOW', 19719) }, { tender: mpesa('PAY-AMOUNT-HIGH', 19721) },
          { tender: [...mpesa('PAY-MIXED-001', 19720), ...cash(1)] }, { tender: [{ ...mpesa('PAY-CURRENCY-001', 19720)[0], currency: 'USD' }] },
          { tender: [{ ...cash(20000)[0], manuallyConfirmed: true }] },
        ];
        for (const invalid of cases) {
          const envelope = await sale(cashier, [invalid.line ?? validLine], invalid.tender ?? mpesa('PAY-INVALID-001', 19720));
          Object.assign(envelope.payload, invalid.extra);
          const result = await submit(cashier, envelope); assert.equal(result.status, 'REJECTED', JSON.stringify({ invalid, result }));
          assert.deepEqual(await submit(cashier, envelope), result, 'rejected envelopes also replay deterministically');
        }
        const after = (await db.pool.query(`SELECT (SELECT count(*)::int FROM commerce.orders WHERE tenant_id=$1) orders,(SELECT count(*)::int FROM finance.journal_entries WHERE tenant_id=$1) journals,(SELECT quantity::text FROM inventory.balances WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3) quantity`, [tenantId, outletId, productId])).rows[0];
        assert.deepEqual(after, before);
        const forbidden = await refund(owner, manualSaleId, manualLineId, '1');
        assert.equal((await submit(owner, forbidden)).code, 'MANUAL_MPESA_REFUND_UNAVAILABLE');
        await db.pool.query("UPDATE identity.memberships SET role='storekeeper' WHERE tenant_id=$1 AND user_id=$2", [tenantId, cashier.userId]);
        const denied = await submit(cashier, command(cashier, 'sales.order.settle', { shiftId: 'unused', lines: [validLine], tenders: cash(19720) }));
        assert.equal(denied.code, 'FORBIDDEN');
        await db.pool.query("UPDATE identity.memberships SET role='cashier' WHERE tenant_id=$1 AND user_id=$2", [tenantId, cashier.userId]);
      });

      await t.test('a reference is unique under concurrent operators and across outlets', async () => {
        const commands = await Promise.all([owner, cashier].map(operator => sale(operator, [{ productId, quantity: '1' }], mpesa('PAY-CONCURRENT-001', 11600))));
        const outcomes = await Promise.all(commands.map((envelope, index) => submit([owner, cashier][index], envelope)));
        assert.equal(outcomes.filter(outcome => outcome.status === 'CONFIRMED').length, 1, JSON.stringify(outcomes));
        assert.equal(outcomes.filter(outcome => outcome.code === 'DUPLICATE_PAYMENT_REFERENCE').length, 1, JSON.stringify(outcomes));
        const reserved = await db.pool.query("SELECT count(*)::int n FROM commerce.payments WHERE tenant_id=$1 AND reference='PAY-CONCURRENT-001'", [tenantId]); assert.equal(reserved.rows[0].n, 1);
        const otherOutletId = randomUUID();
        await db.pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Other payment outlet','Africa/Nairobi')", [otherOutletId, tenantId]);
        const other = await actor(tenantId, otherOutletId, 'owner', 'Other outlet cashier');
        const otherItem = await item(other); await confirmed(other, 'shift.open', { openingFloatMinor: 0 });
        const duplicate = await submit(other, await sale(other, [{ productId: otherItem, quantity: '1' }], mpesa('PAY-CONCURRENT-001', 11600)));
        assert.equal(duplicate.code, 'DUPLICATE_PAYMENT_REFERENCE');
        const unchanged = (await db.pool.query('SELECT quantity::text FROM inventory.balances WHERE tenant_id=$1 AND product_id=$2', [tenantId, otherItem])).rows[0]; assert.equal(unchanged.quantity, '100.000000');
        assert.equal((await read(other, '/shifts/current')).shift.mpesaSalesMinor, 0);
      });

      await t.test('partial/final cash returns allocate the original net value, discount, tax and COGS exactly', async () => {
        const roundedItem = await item(owner, 101, 40, 1600);
        const sold = await submit(owner, await sale(owner, [{ productId: roundedItem, quantity: '3', discountMinor: 100, discountReason: 'Fixed amount for three items' }], cash(300)));
        assert.equal(sold.status, 'CONFIRMED', JSON.stringify(sold)); assert.equal(sold.value.totalMinor, 235);
        const receipt = await read(owner, `/sales/orders/${sold.value.saleId}/receipt`);
        for (const expected of [79, 79, 77]) {
          const envelope = await refund(owner, sold.value.saleId, receipt.lines[0].lineId, '1');
          const returned = await submit(owner, envelope); assert.equal(returned.status, 'CONFIRMED', JSON.stringify(returned)); assert.equal(returned.value.totalMinor, expected);
          assert.deepEqual(await submit(owner, envelope), returned);
        }
        const allocations = (await db.pool.query(`SELECT sum(quantity)::text quantity,sum(subtotal_minor)::text subtotal,sum(discount_minor)::text discount,sum(tax_minor)::text tax,sum(cogs_minor)::text cogs FROM commerce.refund_lines WHERE tenant_id=$1 AND order_id=$2`, [tenantId, sold.value.saleId])).rows[0];
        assert.deepEqual(allocations, { quantity: '3.000000', subtotal: '203', discount: '100', tax: '32', cogs: '120' });
        assert.equal((await submit(owner, await refund(owner, sold.value.saleId, receipt.lines[0].lineId, '1'))).code, 'ALREADY_REFUNDED');
        const balance = (await db.pool.query('SELECT quantity::text,inventory_value_minor::text value FROM inventory.balances WHERE tenant_id=$1 AND product_id=$2', [tenantId, roundedItem])).rows[0]; assert.deepEqual(balance, { quantity: '100.000000', value: '4000' });
        await assert.rejects(db.pool.query('UPDATE commerce.refund_lines SET discount_minor=0 WHERE tenant_id=$1 AND order_id=$2', [tenantId, sold.value.saleId]), { code: '55000' });
        assert.deepEqual(await read(owner, `/sales/orders/${sold.value.saleId}/receipt`), { ...receipt, saleStatus: 'REFUNDED' });
      });

      await t.test('fully discounted line returns restore stock without inventing a cash refund or free checkout', async () => {
        const freeItem = await item(owner, 100, 40, 0), paidItem = await item(owner, 100, 40, 0);
        const onlyFree = await submit(owner, await sale(owner, [{ productId: freeItem, quantity: '1', discountMinor: 100, discountReason: 'Fully discounted line' }], cash(100)));
        assert.equal(onlyFree.status, 'REJECTED');
        const sold = await submit(owner, await sale(owner, [{ productId: freeItem, quantity: '1', discountMinor: 100, discountReason: 'Promotional item amount' }, { productId: paidItem, quantity: '1' }], cash(100)));
        assert.equal(sold.status, 'CONFIRMED', JSON.stringify(sold));
        const receipt = await read(owner, `/sales/orders/${sold.value.saleId}/receipt`);
        const freeLine = receipt.lines.find((line: { discountMinor: string }) => line.discountMinor === '100');
        const before = (await read(owner, '/shifts/current')).shift.expectedCashMinor;
        const envelope = await refund(owner, sold.value.saleId, freeLine.lineId, '1');
        const returned = await submit(owner, envelope); assert.equal(returned.status, 'CONFIRMED', JSON.stringify(returned)); assert.equal(returned.value.totalMinor, 0); assert.equal(returned.value.discountMinor, 100);
        assert.equal((await read(owner, '/shifts/current')).shift.expectedCashMinor, before);
        const entries = (await db.pool.query('SELECT source_type FROM finance.journal_entries WHERE tenant_id=$1 AND source_id=$2 ORDER BY source_type', [tenantId, envelope.commandId])).rows;
        assert.deepEqual(entries, [{ source_type: 'SALE_REFUND_COGS' }]);
      });

      await t.test('close snapshots separate M-Pesa from counted cash and all journal entries balance', async () => {
        for (const operator of [owner, cashier]) {
          const current = (await read(operator, '/shifts/current')).shift;
          const closed = await confirmed(operator, 'shift.close', { shiftId: current.id, countedCashMinor: current.expectedCashMinor }, { [`shift:${current.id}`]: current.version });
          const snapshot = (await read(operator, '/shifts/close-reports')).reports.find((report: { shiftId: string }) => report.shiftId === current.id);
          assert.equal(snapshot.mpesaSalesMinor, String(current.mpesaSalesMinor)); assert.equal(snapshot.varianceMinor, '0'); assert.equal(closed.mpesaSalesMinor, snapshot.mpesaSalesMinor);
          assert.equal(BigInt(snapshot.expectedCashMinor), BigInt(snapshot.openingFloatMinor) + BigInt(snapshot.cashSalesMinor) + BigInt(snapshot.customerCollectionsMinor) + BigInt(snapshot.cashPaidInMinor) - BigInt(snapshot.cashPayoutMinor) - BigInt(snapshot.cashRefundsMinor));
          await assert.rejects(db.pool.query('UPDATE commerce.shift_close_reports SET mpesa_sales_minor=0 WHERE id=$1', [snapshot.id]), { code: '55000' });
        }
        const unbalanced = await db.pool.query(`SELECT je.id FROM finance.journal_entries je JOIN finance.journal_lines jl ON jl.tenant_id=je.tenant_id AND jl.journal_entry_id=je.id WHERE je.tenant_id=$1 GROUP BY je.id HAVING sum(jl.debit_minor)<>sum(jl.credit_minor)`, [tenantId]); assert.equal(unbalanced.rowCount, 0);
        assert.deepEqual(await read(owner, `/sales/orders/${oldCash.value.saleId}/receipt`), oldReceipt);
      });
    } finally {
      await app.close(); await db.pool.end();
    }
  });
}
