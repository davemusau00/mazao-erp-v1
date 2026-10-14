import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  test('PostgreSQL migration, catalog and idempotency acceptance', { skip: 'Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database.' }, () => {});
} else {
  process.env.DATABASE_URL = databaseUrl;
  process.env.APP_ORIGINS ??= 'http://localhost:3000';

  const [{ buildApp }, { hashPassword }, db] = await Promise.all([
    import('../src/app.js'), import('../src/security.js'), import('../src/db.js'),
  ]);

  test('fresh migrations support authenticated commands, canonical replay, and role-scoped cost projections', async () => {
    const tenantId = randomUUID();
    const outletId = randomUUID();
    const userId = randomUUID();
    const deviceId = randomUUID();
    const commandId = randomUUID();
    const email = `integration-${userId}@example.invalid`;
    const password = 'integration-only-password-530cdbf';
    const passwordHash = await hashPassword(password);

    await db.pool.query('INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,$2,$3,$4)', [tenantId, 'Disposable API integration tenant', 'KES', 'Africa/Nairobi']);
    await db.pool.query('INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,$3,$4)', [outletId, tenantId, 'Integration outlet', 'Africa/Nairobi']);
    await db.pool.query('INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,$2),($1,$3),($1,$4),($1,$5)', [tenantId, 'retail', 'inventory', 'commerce', 'hospitality']);
    await db.pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)', [userId, email, passwordHash, 'Integration Admin']);
    await db.pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')", [tenantId, userId]);
    await db.pool.query('INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,$5)', [deviceId, tenantId, outletId, userId, 'Disposable integration device']);

    const app = buildApp();
    await app.ready();
    try {
      const login = await app.inject({
        method: 'POST', url: '/api/v1/auth/login',
        payload: { email, password },
      });
      assert.equal(login.statusCode, 200, login.body);
      const loginBody = login.json() as { csrfToken: string };
      const rawCookies = login.headers['set-cookie'];
      const cookies = (Array.isArray(rawCookies) ? rawCookies : [rawCookies])
        .filter((value): value is string => typeof value === 'string')
        .map(value => value.split(';', 1)[0])
        .join('; ');
      assert.match(cookies, /maz_session=/);
      assert.match(cookies, /maz_csrf=/);

      const headers = { cookie: cookies, origin: 'http://localhost:3000', 'x-csrf-token': loginBody.csrfToken };
      const postCommand = (payload: unknown) => app.inject({ method: 'POST', url: '/api/v1/commands', headers: { ...headers, 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
      const createProduct = {
        protocolVersion: 1,
        commandId,
        tenantId,
        deviceId,
        type: 'catalog.product.create',
        occurredAt: new Date().toISOString(),
        expectedVersions: {},
        payload: {
          sku: 'GAP-530CDBF', name: 'Integration catalog item', baseUnit: 'each',
          currency: 'KES', sellingPriceMinor: 25000, costPriceMinor: 15000, taxRateBps: 1600,
        },
      };
      const first = await postCommand(createProduct);
      assert.equal(first.statusCode, 200, first.body);
      assert.equal(first.json().status, 'CONFIRMED');

      const replay = await postCommand(createProduct);
      assert.equal(replay.statusCode, 200, replay.body);
      assert.deepEqual(replay.json(), first.json(), 'same command ID and payload must have the same response shape and value');

      const catalog = await app.inject({ method: 'GET', url: '/api/v1/catalog/items', headers });
      assert.equal(catalog.statusCode, 200, catalog.body);
      const items = catalog.json().items as Array<{ id: string; sku: string; quantity: string; costPriceMinor?: number }>;
      assert.equal(items.length, 1);
      assert.equal(items[0].sku, 'GAP-530CDBF');
      assert.equal(items[0].quantity, '0.000000');
      assert.equal(items[0].costPriceMinor, 15000, 'catalog managers may read unit cost');
      const productId = String(first.json().value.productId);

      const persisted = await db.pool.query<{ command_count: string; product_count: string }>(`SELECT
        (SELECT count(*) FROM system.commands WHERE tenant_id=$1 AND command_id=$2)::text command_count,
        (SELECT count(*) FROM catalog.products WHERE tenant_id=$1 AND outlet_id=$3 AND sku='GAP-530CDBF')::text product_count`, [tenantId, commandId, outletId]);
      assert.equal(persisted.rows[0].command_count, '1');
      assert.equal(persisted.rows[0].product_count, '1');

      const roomCommandId = randomUUID();
      const roomResult = await postCommand({
        protocolVersion: 1, commandId: roomCommandId, tenantId, deviceId,
        type: 'hotel.room.create', occurredAt: new Date().toISOString(), expectedVersions: {},
        payload: { roomNumber: '101', roomType: 'Standard', nightlyRateMinor: 12000, taxRateBps: 1600 },
      });
      assert.equal(roomResult.statusCode, 200, roomResult.body);
      assert.equal(roomResult.json().status, 'CONFIRMED');
      const roomId = String(roomResult.json().value.roomId);

      const reservations = [randomUUID(), randomUUID()].map((reservationCommandId, index) => ({
        protocolVersion: 1,
        commandId: reservationCommandId,
        tenantId,
        deviceId,
        type: 'hotel.reservation.create',
        occurredAt: new Date().toISOString(),
        expectedVersions: { [`room:${roomId}`]: 1 },
        payload: { roomId, guestName: `Overlap guest ${index + 1}`, checkInDate: '2030-01-10', checkOutDate: '2030-01-12' },
      }));
      const reservationResponses = await Promise.all(reservations.map(payload => postCommand(payload)));
      assert.deepEqual(reservationResponses.map(response => response.json().status).sort(), ['CONFIRMED', 'CONFLICT']);
      const confirmedReservations = await db.pool.query<{ count: string }>(`SELECT count(*)::text count FROM hospitality.reservations WHERE tenant_id=$1 AND outlet_id=$2 AND room_id=$3 AND status='CONFIRMED' AND check_in_date<'2030-01-12' AND check_out_date>'2030-01-10'`, [tenantId, outletId, roomId]);
      assert.equal(confirmedReservations.rows[0].count, '1');

      const foreignTenantId = randomUUID();
      const foreignOutletId = randomUUID();
      const foreignProductId = randomUUID();
      await db.pool.query('INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,$2,$3,$4)', [foreignTenantId, 'Foreign integration tenant', 'KES', 'Africa/Nairobi']);
      await db.pool.query('INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,$3,$4)', [foreignOutletId, foreignTenantId, 'Foreign outlet', 'Africa/Nairobi']);
      await db.pool.query(`INSERT INTO catalog.products(id,tenant_id,outlet_id,sku,name,base_unit,currency,selling_price_minor,cost_price_minor,tax_rate_bps)
        VALUES($1,$2,$3,'FOREIGN-ITEM','Foreign item','each','KES',25000,15000,1600)`, [foreignProductId, foreignTenantId, foreignOutletId]);
      await db.pool.query('INSERT INTO inventory.balances(tenant_id,outlet_id,product_id,quantity) VALUES($1,$2,$3,5)', [foreignTenantId, foreignOutletId, foreignProductId]);

      const receipt = await postCommand({
        protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId, type: 'inventory.receive',
        occurredAt: new Date().toISOString(), expectedVersions: {},
        payload: { documentReference: 'CI-GRN-1', supplierName: 'Integration supplier', lines: [{ productId, quantity: '4', unitCostMinor: 15000 }] },
      });
      assert.equal(receipt.statusCode, 200, receipt.body);
      assert.equal(receipt.json().status, 'CONFIRMED');

      const shiftOpen = await postCommand({
        protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId, type: 'shift.open',
        occurredAt: new Date().toISOString(), expectedVersions: {}, payload: { openingFloatMinor: 50000 },
      });
      assert.equal(shiftOpen.json().status, 'CONFIRMED');
      const shiftId = String(shiftOpen.json().value.shiftId);

      const foreignSale = await postCommand({
        protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId, type: 'sales.order.settle',
        occurredAt: new Date().toISOString(), expectedVersions: { [`shift:${shiftId}`]: 1 },
        payload: { shiftId, lines: [{ productId: foreignProductId, quantity: '1' }], tenders: [{ method: 'CASH', amountMinor: 30000, currency: 'KES' }] },
      });
      assert.equal(foreignSale.json().status, 'REJECTED');

      const saleCommand = {
        protocolVersion: 1,
        commandId: randomUUID(),
        tenantId,
        deviceId,
        type: 'sales.order.settle',
        occurredAt: new Date().toISOString(),
        expectedVersions: { [`shift:${shiftId}`]: 1 },
        payload: { shiftId, lines: [{ productId, quantity: '2' }], tenders: [{ method: 'CASH', amountMinor: 60000, currency: 'KES' }] },
      };
      const sale = await postCommand(saleCommand);
      assert.equal(sale.statusCode, 200, sale.body);
      assert.equal(sale.json().status, 'CONFIRMED');
      assert.equal(sale.json().value.subtotalMinor, 50000);
      assert.equal(sale.json().value.taxMinor, 8000);
      assert.equal(sale.json().value.totalMinor, 58000);
      assert.equal(sale.json().value.changeMinor, 2000);
      const saleReplay = await postCommand(saleCommand);
      assert.deepEqual(saleReplay.json(), sale.json());
      const saleId = String(sale.json().value.saleId);

      const managerOrders = await app.inject({ method: 'GET', url: '/api/v1/sales/orders', headers });
      assert.equal(managerOrders.statusCode, 200, managerOrders.body);
      const managerOrder = (managerOrders.json().orders as Array<{ id: string; lines: Array<{ costPriceMinor?: number | string }> }>).find(order => order.id === saleId);
      assert.ok(managerOrder, 'manager should see the confirmed sale');
      assert.equal(Number(managerOrder.lines[0].costPriceMinor), 15000, 'finance users may read historical unit cost');

      const cashierId = randomUUID();
      const cashierDeviceId = randomUUID();
      const cashierEmail = `cashier-${cashierId}@example.invalid`;
      const cashierPassword = 'cashier-only-integration-password';
      await db.pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)', [cashierId, cashierEmail, await hashPassword(cashierPassword), 'Integration Cashier']);
      await db.pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'cashier')", [tenantId, cashierId]);
      await db.pool.query('INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,$5)', [cashierDeviceId, tenantId, outletId, cashierId, 'Disposable cashier device']);
      const cashierLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: cashierEmail, password: cashierPassword } });
      assert.equal(cashierLogin.statusCode, 200, cashierLogin.body);
      const cashierSession = cashierLogin.json() as { csrfToken: string; user: { permissions: string[] } };
      assert.ok(cashierSession.user.permissions.includes('commerce.sell'));
      assert.ok(!cashierSession.user.permissions.includes('catalog.manage'));
      assert.ok(!cashierSession.user.permissions.includes('finance.view'));
      const cashierRawCookies = cashierLogin.headers['set-cookie'];
      const cashierCookies = (Array.isArray(cashierRawCookies) ? cashierRawCookies : [cashierRawCookies])
        .filter((value): value is string => typeof value === 'string')
        .map(value => value.split(';', 1)[0])
        .join('; ');
      const cashierHeaders = { cookie: cashierCookies, origin: 'http://localhost:3000', 'x-csrf-token': cashierSession.csrfToken };

      const cashierCatalog = await app.inject({ method: 'GET', url: '/api/v1/catalog/items', headers: cashierHeaders });
      assert.equal(cashierCatalog.statusCode, 200, cashierCatalog.body);
      const cashierItem = (cashierCatalog.json().items as Array<Record<string, unknown>>).find(item => item.sku === 'GAP-530CDBF');
      assert.ok(cashierItem, 'cashier should see sellable catalog items');
      assert.equal(Object.hasOwn(cashierItem, 'costPriceMinor'), false, 'cashier catalog response must omit cost');

      const cashierOrders = await app.inject({ method: 'GET', url: '/api/v1/sales/orders', headers: cashierHeaders });
      assert.equal(cashierOrders.statusCode, 200, cashierOrders.body);
      const cashierOrder = (cashierOrders.json().orders as Array<{ id: string; lines: Array<Record<string, unknown>> }>).find(order => order.id === saleId);
      assert.ok(cashierOrder, 'cashier may review sales history');
      assert.equal(Object.hasOwn(cashierOrder.lines[0], 'costPriceMinor'), false, 'cashier sales response must omit historical cost');

      const line = await db.pool.query<{ id: string }>('SELECT id FROM commerce.order_lines WHERE tenant_id=$1 AND outlet_id=$2 AND order_id=$3', [tenantId, outletId, saleId]);
      assert.equal(line.rowCount, 1);

      const refundCommand = {
        protocolVersion: 1,
        commandId: randomUUID(),
        tenantId,
        deviceId,
        type: 'sales.order.refund',
        occurredAt: new Date().toISOString(),
        expectedVersions: { [`shift:${shiftId}`]: 2 },
        payload: { orderId: saleId, shiftId, reason: 'CI partial return', lines: [{ orderLineId: line.rows[0].id, quantity: '1', restock: true }] },
      };
      const refund = await postCommand(refundCommand);
      assert.equal(refund.statusCode, 200, refund.body);
      assert.equal(refund.json().status, 'CONFIRMED');
      assert.equal(refund.json().value.totalMinor, 29000);
      const refundReplay = await postCommand(refundCommand);
      assert.deepEqual(refundReplay.json(), refund.json());

      const close = await postCommand({
        protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId, type: 'shift.close',
        occurredAt: new Date().toISOString(), expectedVersions: { [`shift:${shiftId}`]: 3 },
        payload: { shiftId, countedCashMinor: 79000 },
      });
      assert.equal(close.statusCode, 200, close.body);
      assert.equal(close.json().status, 'CONFIRMED');
      assert.equal(close.json().value.varianceMinor, 0);

      const balances = await db.pool.query<{ quantity: string; unbalanced_journals: string; refunds: string; shift_status: string; expected_cash_minor: string; variance_minor: string }>(`SELECT
        (SELECT quantity::text FROM inventory.balances WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3) quantity,
        (SELECT count(*)::text FROM (SELECT je.id FROM finance.journal_entries je LEFT JOIN finance.journal_lines jl ON jl.journal_entry_id=je.id WHERE je.tenant_id=$1 GROUP BY je.id HAVING coalesce(sum(jl.debit_minor),0)<>coalesce(sum(jl.credit_minor),0) OR coalesce(sum(jl.debit_minor),0)=0) unbalanced) unbalanced_journals,
        (SELECT count(*)::text FROM commerce.refunds WHERE tenant_id=$1 AND outlet_id=$2 AND order_id=$4) refunds,
        (SELECT status FROM commerce.shifts WHERE tenant_id=$1 AND outlet_id=$2 AND id=$5) shift_status,
        (SELECT expected_cash_minor::text FROM commerce.shifts WHERE tenant_id=$1 AND outlet_id=$2 AND id=$5) expected_cash_minor,
        (SELECT variance_minor::text FROM commerce.shifts WHERE tenant_id=$1 AND outlet_id=$2 AND id=$5) variance_minor`, [tenantId, outletId, productId, saleId, shiftId]);
      assert.equal(balances.rows[0].quantity, '3.000000');
      assert.equal(balances.rows[0].unbalanced_journals, '0');
      assert.equal(balances.rows[0].refunds, '1');
      assert.equal(balances.rows[0].shift_status, 'CLOSED');
      assert.equal(balances.rows[0].expected_cash_minor, '79000');
      assert.equal(balances.rows[0].variance_minor, '0');
    } finally {
      await app.close();
      await db.pool.end();
    }
  });
}
