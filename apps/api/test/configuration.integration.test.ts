import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CommandEnvelope } from '../src/contracts.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  test('server configuration authorization, versioning, replay and receipt history', { skip: 'Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database.' }, () => {});
} else {
  process.env.DATABASE_URL = databaseUrl;
  process.env.APP_ORIGINS ??= 'http://localhost:3000';
  const [{ buildApp }, { hashPassword }, db] = await Promise.all([import('../src/app.js'), import('../src/security.js'), import('../src/db.js')]);

  test('configuration persists authoritative settings with scoped permissions, concurrency, idempotency and immutable receipt snapshots', async () => {
    const tenantId = randomUUID(); const outletId = randomUUID(); const userId = randomUUID(); const deviceId = randomUUID();
    const email = `configuration-${userId}@example.invalid`; const password = 'disposable-configuration-password';
    await db.pool.query('INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,$2,$3,$4)', [tenantId, 'Disposable configuration tenant', 'KES', 'Africa/Nairobi']);
    await db.pool.query('INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,$3,$4)', [outletId, tenantId, 'Configuration outlet', 'Africa/Nairobi']);
    await db.pool.query('INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,\'commerce\'),($1,\'inventory\'),($1,\'retail\')', [tenantId]);
    await db.pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)', [userId, email, await hashPassword(password), 'Configuration Admin']);
    await db.pool.query('INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,\'admin\')', [tenantId, userId]);
    await db.pool.query('INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,$5)', [deviceId, tenantId, outletId, userId, 'Configuration acceptance device']);
    const app = buildApp(); await app.ready();
    try {
      assert.equal((await app.inject({ url: '/api/v1/configuration' })).statusCode, 401);
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
      assert.equal(login.statusCode, 200, login.body);
      assert.ok(login.json().user.permissions.includes('config.manage'));
      const raw = login.headers['set-cookie'];
      const cookie = (Array.isArray(raw) ? raw : [raw]).filter((item): item is string => typeof item === 'string').map(item => item.split(';', 1)[0]).join('; ');
      const headers = { cookie, origin: 'http://localhost:3000', 'x-csrf-token': login.json().csrfToken };
      const command = (type: string, payload: Record<string, unknown>, expectedVersions: Record<string, number> = {}): CommandEnvelope => ({ protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId, type, occurredAt: new Date().toISOString(), expectedVersions, payload });
      const submit = (envelope: CommandEnvelope) => app.inject({ method: 'POST', url: '/api/v1/commands', headers, payload: envelope });
      const read = async () => { const response = await app.inject({ url: '/api/v1/configuration', headers }); assert.equal(response.statusCode, 200, response.body); return response.json().configuration; };
      const initial = await read();
      assert.equal(initial.business.version, 1); assert.equal(initial.outlet.version, 1);
      assert.equal(initial.currencyLocked, false); assert.equal(initial.readiness.readyForFirstSale, false);
      assert.deepEqual(initial.supportedCapabilities, ['commerce', 'inventory', 'hospitality', 'retail']);
      const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
      const businessInput = { ...initial.business, name: 'Configured resort', legalName: 'Configured Resort Limited', address: 'Nairobi\nKenya', phone: '+254 700 123 456', email: 'CONTACT@EXAMPLE.INVALID', website: 'https://example.invalid', logoUrl: png, receiptQrImage: png, showQrOnReceipt: true, registrationNumber: 'B1234', taxRegistrationNumber: 'P1234', receiptHeader: 'Welcome to the resort', receiptFooter: 'Original receipt footer', taxPolicy: { calculation: 'exclusive', defaultRateBps: 1600, label: 'VAT', reviewed: true } };
      const save = command('configuration.business.update', businessInput, { [`business:${tenantId}`]: 1 });
      const first = await submit(save); assert.equal(first.json().status, 'CONFIRMED', first.body); assert.equal(first.json().value.version, 2);
      assert.deepEqual((await submit(save)).json(), first.json(), 'canonical replay must return stored result');
      const mismatch = await submit({ ...save, payload: { ...businessInput, name: 'Different content' } });
      assert.equal(mismatch.json().code, 'IDEMPOTENCY_MISMATCH');
      const evidence = await db.pool.query(`SELECT
        (SELECT count(*)::int FROM system.audit_events WHERE tenant_id=$1 AND command_id=$2) audit_count,
        (SELECT count(*)::int FROM system.transactional_outbox WHERE tenant_id=$1 AND command_id=$2) outbox_count`, [tenantId, save.commandId]);
      assert.deepEqual(evidence.rows[0], { audit_count: 1, outbox_count: 1 });
      const configured = await read(); assert.equal(configured.business.email, 'contact@example.invalid'); assert.equal(configured.business.receiptFooter, businessInput.receiptFooter);
      assert.equal(configured.business.taxPolicy.reviewed, true);
      assert.equal((await app.inject({ url: '/api/v1/auth/me', headers })).json().tenant.taxPolicy.defaultRateBps, 1600);
      assert.equal((await app.inject({ url: '/api/v1/auth/me', headers })).json().tenant.name, 'Configured resort');

      const stale = await submit(command('configuration.business.update', businessInput, { [`business:${tenantId}`]: 1 }));
      assert.equal(stale.json().status, 'CONFLICT'); assert.equal(stale.json().details.currentVersion, 2);
      for (const invalid of [{ email: 'invalid' }, { timeZone: 'GMT3+' }, { currency: 'ZZZ' }, { logoUrl: 'javascript:alert(1)' }, { receiptQrImage: 'data:image/svg+xml;base64,PHN2Zz4=' }, { receiptQrImage: 'data:image/png;base64,AAAA' }, { showQrOnReceipt: 'yes' }, { taxPolicy: { calculation: 'inclusive', defaultRateBps: 1600, label: 'VAT', reviewed: true } }, { taxPolicy: { calculation: 'exclusive', defaultRateBps: 16.5, label: 'VAT', reviewed: true } }]) {
        const failed = await submit(command('configuration.business.update', { ...businessInput, ...invalid }, { [`business:${tenantId}`]: 2 }));
        assert.equal(failed.json().status, 'REJECTED', failed.body); assert.equal(failed.json().code, 'VALIDATION_FAILED');
      }
      assert.equal((await read()).business.version, 2, 'failed validation must not advance version');
      const raced = await Promise.all(['First edit', 'Second edit'].map(name => submit(command('configuration.business.update', { ...businessInput, name }, { [`business:${tenantId}`]: 2 }))));
      assert.deepEqual(raced.map(result => result.json().status).sort(), ['CONFIRMED', 'CONFLICT']);
      assert.equal((await read()).business.version, 3);
      const outletSave = await submit(command('configuration.outlet.update', { ...initial.outlet, name: 'Configured bar', address: 'Bar street', timeZone: 'Africa/Kampala', receiptFooter: 'Outlet receipt footer' }, { [`outlet:${outletId}`]: 1 }));
      assert.equal(outletSave.json().status, 'CONFIRMED', outletSave.body);
      const me = (await app.inject({ url: '/api/v1/auth/me', headers })).json();
      assert.equal(me.tenant.timeZone, 'Africa/Nairobi'); assert.equal(me.outlet.timeZone, 'Africa/Kampala'); assert.equal(me.outlet.name, 'Configured bar');
      const foreign = await submit({ ...command('configuration.outlet.update', initial.outlet, { [`outlet:${outletId}`]: 2 }), tenantId: randomUUID() });
      assert.equal(foreign.statusCode, 403);

      for (const capabilities of [['restaurant'], ['commerce'], ['inventory', 'hospitality'], ['commerce', 'inventory', 'inventory']]) {
        const failed = await submit(command('configuration.capabilities.update', { capabilities }, { [`business:${tenantId}`]: 3 }));
        assert.equal(failed.json().status, 'REJECTED'); assert.equal(failed.json().code, 'VALIDATION_FAILED');
      }
      const enabled = await submit(command('configuration.capabilities.update', { capabilities: ['commerce', 'inventory', 'retail', 'hospitality'] }, { [`business:${tenantId}`]: 3 }));
      assert.equal(enabled.json().status, 'CONFIRMED'); assert.equal(enabled.json().value.version, 4);
      assert.ok((await app.inject({ url: '/api/v1/auth/me', headers })).json().tenant.capabilities.includes('hospitality'));
      await db.pool.query('UPDATE identity.memberships SET role=\'manager\' WHERE tenant_id=$1 AND user_id=$2', [tenantId, userId]);
      assert.equal((await app.inject({ url: '/api/v1/configuration', headers })).statusCode, 200);
      const managerWrite = await submit(command('configuration.business.update', businessInput, { [`business:${tenantId}`]: 4 }));
      assert.equal(managerWrite.json().code, 'FORBIDDEN');
      await db.pool.query('UPDATE identity.memberships SET role=\'cashier\' WHERE tenant_id=$1 AND user_id=$2', [tenantId, userId]);
      assert.equal((await app.inject({ url: '/api/v1/configuration', headers })).statusCode, 403);
      await db.pool.query('UPDATE identity.memberships SET role=\'admin\' WHERE tenant_id=$1 AND user_id=$2', [tenantId, userId]);

      const product = await submit(command('catalog.product.create', { sku: 'CONFIG-ITEM', name: 'Configuration test item', baseUnit: 'each', currency: 'KES', sellingPriceMinor: 10000, costPriceMinor: 5000 }));
      assert.equal(product.json().status, 'CONFIRMED', product.body); const productId = product.json().value.productId;
      assert.equal((await app.inject({ url: '/api/v1/catalog/items', headers })).json().items.find((item: { id: string }) => item.id === productId).taxRateBps, 1600, 'omitted item tax uses authoritative business default');
      const room = await submit(command('hotel.room.create', { roomNumber: 'CONFIG-1', roomType: 'Configuration room', nightlyRateMinor: 100000 }));
      assert.equal(room.json().status, 'CONFIRMED', room.body); const roomId = room.json().value.roomId;
      assert.equal((await app.inject({ url: '/api/v1/hospitality/rooms', headers })).json().rooms.find((item: { id: string }) => item.id === roomId).taxRateBps, 1600, 'omitted room tax uses authoritative business default');
      const reservation = await submit(command('hotel.reservation.create', { roomId, guestName: 'Disposable configuration guest', checkInDate: '2099-01-01', checkOutDate: '2099-01-02' }, { [`room:${roomId}`]: 1 }));
      assert.equal(reservation.json().status, 'CONFIRMED', reservation.body); const reservationId = reservation.json().value.reservationId;
      const hotelInUse = await submit(command('configuration.capabilities.update', { capabilities: ['commerce', 'inventory', 'retail'] }, { [`business:${tenantId}`]: 4 }));
      assert.equal(hotelInUse.json().code, 'CAPABILITY_IN_USE');
      assert.equal((await submit(command('hotel.reservation.cancel', { reservationId }, { [`reservation:${reservationId}`]: 1 }))).json().status, 'CONFIRMED');
      assert.equal((await read()).currencyLocked, true);
      const currencyChange = await submit(command('configuration.business.update', { ...businessInput, currency: 'USD' }, { [`business:${tenantId}`]: 4 }));
      assert.equal(currencyChange.json().code, 'CURRENCY_LOCKED');
      const receive = await submit(command('inventory.receive', { lines: [{ productId, quantity: '2', unitCostMinor: 5000 }], documentReference: 'DISPOSABLE-CONFIG-RECEIPT' }));
      assert.equal(receive.json().status, 'CONFIRMED', receive.body);
      assert.equal((await read()).readiness.readyForFirstSale, true);
      const shift = await submit(command('shift.open', { openingFloatMinor: 0 })); assert.equal(shift.json().status, 'CONFIRMED', shift.body); const shiftId = shift.json().value.shiftId;
      const blocked = await submit(command('configuration.capabilities.update', { capabilities: ['inventory'] }, { [`business:${tenantId}`]: 4 }));
      assert.equal(blocked.json().code, 'CAPABILITY_IN_USE');
      const sale = await submit(command('sales.order.settle', { shiftId, lines: [{ productId, quantity: '1' }], tenders: [{ method: 'CASH', amountMinor: 11600, currency: 'KES' }] }, { [`shift:${shiftId}`]: 1 }));
      assert.equal(sale.json().status, 'CONFIRMED', sale.body); const orderId = sale.json().value.saleId;
      const receiptBefore = await app.inject({ url: `/api/v1/sales/orders/${orderId}/receipt`, headers });
      assert.equal(receiptBefore.statusCode, 200, receiptBefore.body);
      assert.equal(receiptBefore.json().receiptProfile.receiptFooter, 'Outlet receipt footer');
      assert.equal(receiptBefore.json().receiptProfile.legalName, 'Configured Resort Limited');
      assert.equal(receiptBefore.json().receiptProfile.taxLabel, 'VAT');
      assert.equal(receiptBefore.json().receiptProfile.logoUrl, png);
      assert.equal(receiptBefore.json().receiptProfile.receiptQrImage, png);
      assert.equal(receiptBefore.json().receiptProfile.showQrOnReceipt, true);
      const newerBusiness = await submit(command('configuration.business.update', { ...businessInput, name: 'Later business identity', legalName: 'Later legal identity', receiptFooter: 'Later business footer', logoUrl: '', receiptQrImage: '', showQrOnReceipt: false, taxPolicy: { ...businessInput.taxPolicy, defaultRateBps: 800, label: 'Later tax label' } }, { [`business:${tenantId}`]: 4 }));
      assert.equal(newerBusiness.json().status, 'CONFIRMED', newerBusiness.body);
      const newerOutlet = await submit(command('configuration.outlet.update', { ...initial.outlet, name: 'Later outlet', receiptFooter: 'Later outlet footer' }, { [`outlet:${outletId}`]: 2 }));
      assert.equal(newerOutlet.json().status, 'CONFIRMED', newerOutlet.body);
      assert.deepEqual((await app.inject({ url: `/api/v1/sales/orders/${orderId}/receipt`, headers })).json(), receiptBefore.json(), 'reprint must preserve all original identities and configuration despite later changes');
      const status = await app.inject({ url: `/api/v1/commands/${newerBusiness.json().commandId}`, headers });
      assert.equal(status.json().status, 'CONFIRMED');
      const defaultItem = await submit(command('catalog.product.create', { sku: 'CONFIG-DEFAULT', name: 'Later default-tax item', baseUnit: 'each', currency: 'KES', sellingPriceMinor: 10000, costPriceMinor: 5000 }));
      const zeroTaxItem = await submit(command('catalog.product.create', { sku: 'CONFIG-ZERO', name: 'Explicitly zero-tax item', baseUnit: 'each', currency: 'KES', sellingPriceMinor: 10000, costPriceMinor: 5000, taxRateBps: 0 }));
      assert.equal(defaultItem.json().status, 'CONFIRMED'); assert.equal(zeroTaxItem.json().status, 'CONFIRMED');
      const itemRates = (await app.inject({ url: '/api/v1/catalog/items', headers })).json().items;
      assert.equal(itemRates.find((item: { id: string }) => item.id === productId).taxRateBps, 1600, 'existing item tax does not change with defaults');
      assert.equal(itemRates.find((item: { id: string }) => item.id === defaultItem.json().value.productId).taxRateBps, 800);
      assert.equal(itemRates.find((item: { id: string }) => item.id === zeroTaxItem.json().value.productId).taxRateBps, 0, 'explicit per-item zero overrides default');
      const closed = await submit(command('shift.close', { shiftId, countedCashMinor: 11600 }, { [`shift:${shiftId}`]: 2 }));
      assert.equal(closed.json().status, 'CONFIRMED', closed.body);
      const count = await submit(command('inventory.count.open', { areaLabel: 'Capability guard acceptance' }));
      assert.equal(count.json().status, 'CONFIRMED'); const countId = count.json().value.countId;
      const countInUse = await submit(command('configuration.capabilities.update', { capabilities: [] }, { [`business:${tenantId}`]: 5 }));
      assert.equal(countInUse.json().code, 'CAPABILITY_IN_USE');
      const cancelled = await submit(command('inventory.count.cancel', { countId }, { [`count:${countId}`]: 1 }));
      assert.equal(cancelled.json().status, 'CONFIRMED');
      const disabled = await submit(command('configuration.capabilities.update', { capabilities: [] }, { [`business:${tenantId}`]: 5 }));
      assert.equal(disabled.json().status, 'CONFIRMED', disabled.body);
      assert.deepEqual((await read()).capabilities, [], 'administration remains accessible with no operational capabilities');
      for (const path of ['/api/v1/catalog/items', '/api/v1/inventory/movements', '/api/v1/inventory/counts', '/api/v1/inventory/counts/current', `/api/v1/inventory/counts/${countId}`, '/api/v1/shifts/current', '/api/v1/hospitality/rooms']) {
        const forbidden = await app.inject({ url: path, headers }); assert.equal(forbidden.statusCode, 403, forbidden.body); assert.equal(forbidden.json().error.code, 'CAPABILITY_DISABLED');
      }
      const disabledSalePayload = { shiftId, lines: [{ productId, quantity: '1' }], tenders: [{ method: 'CASH', amountMinor: 11600, currency: 'KES' }] };
      for (const [type, payload] of [['catalog.product.create', {}], ['inventory.receive', {}], ['inventory.count.open', {}], ['shift.open', { openingFloatMinor: 0 }], ['hotel.room.create', {}], ['sales.order.settle', disabledSalePayload], ['sales.order.settle', { ...disabledSalePayload, customerId: randomUUID(), tenders: [] }], ['sales.order.refund', { orderId, shiftId, reason: 'Disabled capability acceptance' }]] as Array<[string, Record<string, unknown>]>) {
        const forbidden = await submit(command(type, payload)); assert.equal(forbidden.json().status, 'REJECTED', forbidden.body); assert.equal(forbidden.json().code, 'CAPABILITY_DISABLED');
      }
      // Legacy or externally provisioned capability rows must never allow a
      // sale to mutate stock when only commerce is enabled.
      await db.pool.query('INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,\'commerce\')', [tenantId]);
      for (const type of ['sales.order.settle', 'sales.order.refund']) {
        const deniedWithoutInventory = await submit(command(type, type === 'sales.order.settle' ? disabledSalePayload : { orderId, shiftId, reason: 'Missing inventory acceptance' }));
        assert.equal(deniedWithoutInventory.json().status, 'REJECTED', deniedWithoutInventory.body);
        assert.equal(deniedWithoutInventory.json().code, 'CAPABILITY_DISABLED');
        assert.match(deniedWithoutInventory.json().message, /inventory/);
      }
      await db.pool.query('DELETE FROM core.tenant_capabilities WHERE tenant_id=$1', [tenantId]);
      assert.deepEqual((await submit(save)).json(), first.json(), 'exact historical command replay remains available after capabilities change');
      assert.equal((await app.inject({ url: `/api/v1/sales/orders/${orderId}/receipt`, headers })).statusCode, 200, 'immutable sale evidence remains accessible after commerce is disabled');
    } finally { await app.close(); await db.pool.end(); }
  });
}
