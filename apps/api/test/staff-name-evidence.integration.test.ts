import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { CommandEnvelope } from '../src/contracts.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  test('tenant staff names propagate to live identity and new evidence without rewriting history', { skip: 'Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database.' }, () => {});
} else {
  process.env.DATABASE_URL = databaseUrl;
  process.env.APP_ORIGINS ??= 'http://localhost:3000';
  const [{ buildApp }, { hashPassword }, db] = await Promise.all([import('../src/app.js'), import('../src/security.js'), import('../src/db.js')]);
  const password = `Disposable-staff-names-${randomUUID()}`, passwordHash = await hashPassword(password);
  const origin = process.env.APP_ORIGINS.split(',')[0];
  type Tenant = { tenantId: string; outletId: string };
  type Actor = Tenant & { userId: string; deviceId: string; email: string; loginName: string; headers: Record<string, string> };

  async function makeTenant(name: string): Promise<Tenant> {
    const tenantId = randomUUID(), outletId = randomUUID();
    await db.pool.query('INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,$2,\'KES\',\'Africa/Nairobi\')', [tenantId, name]);
    await db.pool.query('INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,$3,\'Africa/Nairobi\')', [outletId, tenantId, `${name} outlet`]);
    await db.pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'commerce'),($1,'inventory')", [tenantId]);
    return { tenantId, outletId };
  }
  async function login(app: FastifyInstance, actor: Omit<Actor, 'headers' | 'loginName'>): Promise<Actor> {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { email: actor.email, password, deviceId: actor.deviceId } });
    assert.equal(response.statusCode, 200, response.body);
    const raw = response.headers['set-cookie'];
    const cookie = (Array.isArray(raw) ? raw : [raw]).filter((value): value is string => typeof value === 'string').map(value => value.split(';', 1)[0]).join('; ');
    return { ...actor, loginName: response.json().user.name, headers: { cookie, origin, 'x-csrf-token': response.json().csrfToken } };
  }
  async function makeActor(app: FastifyInstance, tenant: Tenant, role: 'admin' | 'cashier', displayName: string, shared?: Actor) {
    const userId = shared?.userId ?? randomUUID(), deviceId = randomUUID(), email = shared?.email ?? `staff-names-${userId}@example.invalid`;
    if (!shared) await db.pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)', [userId, email, passwordHash, 'Global identity name']);
    await db.pool.query('INSERT INTO identity.memberships(tenant_id,user_id,role,display_name) VALUES($1,$2,$3,$4)', [tenant.tenantId, userId, role, displayName]);
    await db.pool.query('INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,$5)', [deviceId, tenant.tenantId, tenant.outletId, userId, `${displayName} workspace`]);
    return login(app, { ...tenant, userId, deviceId, email });
  }
  async function submit(app: FastifyInstance, actor: Actor, type: string, payload: Record<string, unknown>, expectedVersions: Record<string, number> = {}) {
    const command: CommandEnvelope = { protocolVersion: 1, commandId: randomUUID(), tenantId: actor.tenantId, deviceId: actor.deviceId, type, occurredAt: new Date().toISOString(), expectedVersions, payload };
    return app.inject({ method: 'POST', url: '/api/v1/commands', headers: actor.headers, payload: command });
  }
  async function confirmed(app: FastifyInstance, actor: Actor, type: string, payload: Record<string, unknown>, versions: Record<string, number> = {}) {
    const response = await submit(app, actor, type, payload, versions);
    assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().status, 'CONFIRMED', response.body); return response.json().value;
  }
  async function read(app: FastifyInstance, actor: Actor, path: string) {
    const response = await app.inject({ url: `/api/v1${path}`, headers: actor.headers });
    assert.equal(response.statusCode, 200, response.body); return response.json();
  }
  async function product(app: FastifyInstance, owner: Actor) {
    const item = await confirmed(app, owner, 'catalog.product.create', { sku: 'STAFF-NAME-ITEM', name: 'Staff name evidence item', baseUnit: 'each', currency: 'KES', sellingPriceMinor: 100, costPriceMinor: 40, taxRateBps: 0 });
    await confirmed(app, owner, 'inventory.receive', { lines: [{ productId: item.productId, quantity: '10', unitCostMinor: 40 }] });
    return String(item.productId);
  }
  async function cashSale(app: FastifyInstance, actor: Actor, productId: string, shiftId: string, shiftVersion: number) {
    return confirmed(app, actor, 'sales.order.settle', { shiftId, lines: [{ productId, quantity: '1' }], tenders: [{ method: 'CASH', amountMinor: 100, currency: 'KES' }] }, { [`shift:${shiftId}`]: shiftVersion });
  }
  async function rename(app: FastifyInstance, owner: Actor, target: Actor, displayName: string, version: number) {
    return confirmed(app, owner, 'staff.member.update', { userId: target.userId, displayName, role: 'cashier' }, { [`staff:${target.userId}`]: version });
  }

  test('live names use tenant membership while posted receipts, sales history and closed Z reports retain their snapshots', async () => {
    const app = buildApp({ logger: { level: 'error' } }); await app.ready();
    try {
      const north = await makeTenant('North names business'), south = await makeTenant('South names business');
      const northOwner = await makeActor(app, north, 'admin', 'North administrator');
      const southOwner = await makeActor(app, south, 'admin', 'South administrator');
      const northCashier = await makeActor(app, north, 'cashier', 'Asha at North');
      const southCashier = await makeActor(app, south, 'cashier', 'Asha at South', northCashier);
      assert.equal(northCashier.loginName, 'Asha at North');
      assert.equal(southCashier.loginName, 'Asha at South');
      assert.equal((await read(app, northCashier, '/auth/me')).user.name, 'Asha at North');
      assert.equal((await read(app, southCashier, '/auth/me')).user.name, 'Asha at South');
      const globalBefore = (await db.pool.query('SELECT full_name,email,password_hash FROM identity.users WHERE id=$1', [northCashier.userId])).rows[0];
      const northProduct = await product(app, northOwner), southProduct = await product(app, southOwner);
      const firstShift = await confirmed(app, northCashier, 'shift.open', { openingFloatMinor: 0 });
      const firstSale = await cashSale(app, northCashier, northProduct, firstShift.shiftId, 1);
      const firstReceipt = await read(app, northCashier, `/sales/orders/${firstSale.saleId}/receipt`);
      assert.equal(firstReceipt.operatorName, 'Asha at North');
      await confirmed(app, northCashier, 'shift.close', { shiftId: firstShift.shiftId, countedCashMinor: 100 }, { [`shift:${firstShift.shiftId}`]: 2 });
      const firstReport = (await read(app, northCashier, '/shifts/close-reports')).reports[0];
      assert.equal(firstReport.operatorName, 'Asha at North');
      const firstHistory = (await read(app, northCashier, '/sales/orders')).orders.find((row: { id: string }) => row.id === firstSale.saleId);
      assert.equal(firstHistory.cashierName, 'Asha at North');

      const southShift = await confirmed(app, southCashier, 'shift.open', { openingFloatMinor: 0 });
      const southSale = await cashSale(app, southCashier, southProduct, southShift.shiftId, 1);
      const southReceipt = await read(app, southCashier, `/sales/orders/${southSale.saleId}/receipt`);
      assert.equal(southReceipt.operatorName, 'Asha at South');
      const southHistory = await read(app, southCashier, '/sales/orders');
      await confirmed(app, southCashier, 'shift.close', { shiftId: southShift.shiftId, countedCashMinor: 100 }, { [`shift:${southShift.shiftId}`]: 2 });
      const southReports = await read(app, southCashier, '/shifts/close-reports');

      const renamed = await rename(app, northOwner, northCashier, 'Asha North Updated', 1);
      assert.equal(renamed.revokedSessionCount, 0, 'a name-only edit must not remove valid access');
      assert.equal((await read(app, northCashier, '/auth/me')).user.name, 'Asha North Updated', 'an already-authenticated session must refresh the local profile');
      assert.equal((await login(app, northCashier)).loginName, 'Asha North Updated');
      assert.equal((await read(app, southCashier, '/auth/me')).user.name, 'Asha at South');
      assert.equal((await login(app, southCashier)).loginName, 'Asha at South');
      assert.deepEqual((await db.pool.query('SELECT full_name,email,password_hash FROM identity.users WHERE id=$1', [northCashier.userId])).rows[0], globalBefore);
      assert.equal((await db.pool.query('SELECT display_name FROM identity.memberships WHERE tenant_id=$1 AND user_id=$2', [south.tenantId, southCashier.userId])).rows[0].display_name, 'Asha at South');

      const nextShift = await confirmed(app, northCashier, 'shift.open', { openingFloatMinor: 0 });
      const nextSale = await cashSale(app, northCashier, northProduct, nextShift.shiftId, 1);
      const nextReceipt = await read(app, northCashier, `/sales/orders/${nextSale.saleId}/receipt`);
      assert.equal(nextReceipt.operatorName, 'Asha North Updated');
      assert.equal((await db.pool.query('SELECT operator_name_snapshot FROM commerce.orders WHERE tenant_id=$1 AND id=$2', [north.tenantId, nextSale.saleId])).rows[0].operator_name_snapshot, 'Asha North Updated', 'migration 016 must snapshot the current membership on insert');
      await rename(app, northOwner, northCashier, 'Asha North Closing', 2);
      await confirmed(app, northCashier, 'shift.close', { shiftId: nextShift.shiftId, countedCashMinor: 100 }, { [`shift:${nextShift.shiftId}`]: 2 });
      const reports = await read(app, northCashier, '/shifts/close-reports');
      const nextReport = reports.reports.find((row: { shiftId: string }) => row.shiftId === nextShift.shiftId);
      assert.equal(nextReport.operatorName, 'Asha North Closing', 'Z identity is captured from the tenant profile at close');
      await rename(app, northOwner, northCashier, 'Asha North Final', 3);

      assert.deepEqual(await read(app, northCashier, `/sales/orders/${firstSale.saleId}/receipt`), firstReceipt);
      assert.deepEqual(await read(app, northCashier, `/sales/orders/${nextSale.saleId}/receipt`), nextReceipt);
      const history = (await read(app, northCashier, '/sales/orders')).orders;
      assert.deepEqual(history.find((row: { id: string }) => row.id === firstSale.saleId), firstHistory);
      assert.equal(history.find((row: { id: string }) => row.id === nextSale.saleId).cashierName, 'Asha North Updated');
      const finalReports = await read(app, northCashier, '/shifts/close-reports');
      assert.deepEqual(finalReports, reports);
      assert.deepEqual(finalReports.reports.find((row: { id: string }) => row.id === firstReport.id), firstReport);
      assert.deepEqual(await read(app, southCashier, `/sales/orders/${southSale.saleId}/receipt`), southReceipt);
      assert.deepEqual(await read(app, southCashier, `/sales/orders?asOf=${encodeURIComponent(southHistory.asOf)}`), southHistory);
      assert.deepEqual(await read(app, southCashier, '/shifts/close-reports'), southReports);
    } finally { await app.close(); }
  });

  test('name-only edits cannot smuggle role changes, suspension or assignment transfer past an open till', async () => {
    const app = buildApp({ logger: { level: 'error' } }); await app.ready();
    try {
      const tenant = await makeTenant('Open-till name guard');
      const owner = await makeActor(app, tenant, 'admin', 'Guard administrator');
      const cashier = await makeActor(app, tenant, 'cashier', 'Cashier before rename');
      const shift = await confirmed(app, cashier, 'shift.open', { openingFloatMinor: 0 });
      await rename(app, owner, cashier, 'Cashier renamed during open till', 1);
      assert.equal((await read(app, cashier, '/auth/me')).user.name, 'Cashier renamed during open till');
      const attempts = [
        ['staff.member.update', { userId: cashier.userId, displayName: 'Smuggled role rename', role: 'storekeeper' }, { [`staff:${cashier.userId}`]: 2 }],
        ['staff.member.set_active', { userId: cashier.userId, active: false, reason: 'Rename must not bypass till guard' }, { [`staff:${cashier.userId}`]: 2 }],
        ['devices.assignment.update', { deviceId: cashier.deviceId, label: 'Reassigned after rename', assignedUserId: owner.userId }, { [`device:${cashier.deviceId}`]: 1 }],
      ] as const;
      for (const [type, payload, versions] of attempts) {
        const rejected = await submit(app, owner, type, payload, versions);
        assert.equal(rejected.json().status, 'REJECTED', rejected.body);
        assert.equal(rejected.json().code, 'OPEN_SHIFT_CONFLICT');
      }
      const member = (await db.pool.query('SELECT display_name,role,active,version FROM identity.memberships WHERE tenant_id=$1 AND user_id=$2', [tenant.tenantId, cashier.userId])).rows[0];
      assert.deepEqual(member, { display_name: 'Cashier renamed during open till', role: 'cashier', active: true, version: '2' });
      const assignment = (await db.pool.query('SELECT assigned_user_id,active,version FROM identity.devices WHERE tenant_id=$1 AND id=$2', [tenant.tenantId, cashier.deviceId])).rows[0];
      assert.deepEqual(assignment, { assigned_user_id: cashier.userId, active: true, version: '1' });
      await confirmed(app, cashier, 'shift.close', { shiftId: shift.shiftId, countedCashMinor: 0 }, { [`shift:${shift.shiftId}`]: 1 });
      assert.equal((await read(app, cashier, '/shifts/close-reports')).reports[0].operatorName, 'Cashier renamed during open till');
    } finally { await app.close(); }
  });

  test.after(async () => { await db.pool.end(); });
}
