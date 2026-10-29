import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { CommandEnvelope } from '../src/contracts.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  test('restaurant configuration authority, replay and concurrency', { skip: 'Requires an isolated disposable PostgreSQL database.' }, () => {});
} else {
  process.env.DATABASE_URL = databaseUrl;
  process.env.APP_ORIGINS ??= 'http://localhost:3000';
  const [{ buildApp }, { hashPassword }, db] = await Promise.all([import('../src/app.js'), import('../src/security.js'), import('../src/db.js')]);
  const origin = process.env.APP_ORIGINS.split(',')[0];

  test('restaurant setup persists scoped directories and routing without changing financial or stock evidence', async t => {
    const app = buildApp({ logger: { level: 'silent' } }); await app.ready();
    type Scope = { tenantId: string; outletId: string };
    type Actor = Scope & { userId: string; deviceId: string; headers: Record<string, string> };
    const password = `Disposable-restaurant-${randomUUID()}`, passwordHash = await hashPassword(password);
    const createScope = async (tenantId: string = randomUUID()): Promise<Scope> => {
      await db.pool.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Disposable restaurant','KES','Africa/Nairobi') ON CONFLICT DO NOTHING", [tenantId]);
      const outletId = randomUUID();
      await db.pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Restaurant outlet','Africa/Nairobi')", [outletId, tenantId]);
      await db.pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'commerce'),($1,'inventory'),($1,'restaurant') ON CONFLICT DO NOTHING", [tenantId]);
      return { tenantId, outletId };
    };
    const actor = async (scope: Scope, role = 'admin'): Promise<Actor> => {
      const userId = randomUUID(), deviceId = randomUUID(), email = `restaurant-${userId}@example.invalid`;
      await db.pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)', [userId, email, passwordHash, `Restaurant ${role}`]);
      await db.pool.query('INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [scope.tenantId, userId, role]);
      await db.pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Restaurant test assignment')", [deviceId, scope.tenantId, scope.outletId, userId]);
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password, deviceId } });
      assert.equal(login.statusCode, 200, login.body);
      const raw = login.headers['set-cookie'];
      const cookie = (Array.isArray(raw) ? raw : [raw]).filter((value): value is string => typeof value === 'string').map(value => value.split(';', 1)[0]).join('; ');
      return { ...scope, userId, deviceId, headers: { cookie, origin, 'x-csrf-token': login.json().csrfToken } };
    };
    const command = (a: Actor, type: string, payload: Record<string, unknown>, expectedVersions: Record<string, number> = {}): CommandEnvelope => ({ protocolVersion: 1, commandId: randomUUID(), tenantId: a.tenantId, deviceId: a.deviceId, type, occurredAt: new Date().toISOString(), expectedVersions, payload });
    const submit = (a: Actor, envelope: CommandEnvelope) => app.inject({ method: 'POST', url: '/api/v1/commands', headers: a.headers, payload: envelope });
    const save = async (a: Actor, type: string, payload: Record<string, unknown>, versions: Record<string, number> = {}) => {
      const response = await submit(a, command(a, type, payload, versions));
      assert.equal(response.json().status, 'CONFIRMED', response.body); return response.json().value;
    };
    const rejected = (response: { statusCode: number; body: string; json(): any }, code?: string) => {
      assert.ok(response.statusCode >= 400 || ['REJECTED', 'CONFLICT'].includes(response.json().status), response.body);
      if (code) assert.equal(response.json().code ?? response.json().error?.code, code, response.body);
    };
    const read = async (a: Actor) => {
      const response = await app.inject({ url: '/api/v1/restaurant/configuration', headers: a.headers });
      assert.equal(response.statusCode, 200, response.body); return response.json().configuration;
    };
    const financialEvidence = async (scope: Scope) => Promise.all(['inventory.balances', 'inventory.movements', 'commerce.orders', 'commerce.order_lines', 'commerce.payments', 'finance.journal_entries', 'finance.journal_lines'].map(async table => (await db.pool.query(`SELECT to_jsonb(x)::text evidence FROM ${table} x WHERE tenant_id=$1 ORDER BY to_jsonb(x)::text`, [scope.tenantId])).rows));
    const scope = await createScope(), admin = await actor(scope), waiter = await actor(scope, 'waiter');
    const foreign = await actor(await createScope()), otherOutlet = await actor(await createScope(scope.tenantId));
    let sectionId: string, stationId: string, tableId: string, productId: string;
    try {
      await t.test('requires a session and capability and grants view-only restaurant roles', async () => {
        assert.equal((await app.inject({ url: '/api/v1/restaurant/configuration' })).statusCode, 401);
        const configuration = await read(waiter);
        assert.equal(configuration.permissions.manage, false);
        assert.ok(Object.values(configuration.availability).every(value => value === false), 'Setup cannot claim live restaurant workflows.');
        rejected(await app.inject({ url: '/api/v1/restaurant/products', headers: waiter.headers }), 'FORBIDDEN');
        rejected(await submit(waiter, command(waiter, 'restaurant.section.save', { name: 'Unauthorized area', active: true })), 'FORBIDDEN');
        rejected(await submit(waiter, command(waiter, 'sales.order.settle', { lines: [], tenders: [] })), 'FORBIDDEN');
        await db.pool.query("DELETE FROM core.tenant_capabilities WHERE tenant_id=$1 AND capability='restaurant'", [scope.tenantId]);
        rejected(await app.inject({ url: '/api/v1/restaurant/configuration', headers: admin.headers }), 'CAPABILITY_DISABLED');
        await db.pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'restaurant')", [scope.tenantId]);
      });
      const before = await financialEvidence(scope);
      await t.test('creates an area, table and preparation station with exactly-once evidence', async () => {
        const envelope = command(admin, 'restaurant.section.save', { name: 'Dining room', active: true });
        const first = await submit(admin, envelope); assert.equal(first.json().status, 'CONFIRMED', first.body);
        sectionId = first.json().value.sectionId;
        assert.ok(sectionId); assert.deepEqual((await submit(admin, envelope)).json(), first.json());
        rejected(await submit(admin, { ...envelope, payload: { name: 'Changed original', active: true } }), 'IDEMPOTENCY_MISMATCH');
        const status = await app.inject({ url: `/api/v1/commands/${envelope.commandId}`, headers: admin.headers });
        assert.equal(status.json().commandId, envelope.commandId);
        assert.deepEqual(status.json().response, { status: 'CONFIRMED', value: first.json().value }, 'Lost response is recoverable from the original operation.');
        const evidence = await db.pool.query(`SELECT
          (SELECT count(*)::int FROM system.audit_events WHERE tenant_id=$1 AND command_id=$2) audit,
          (SELECT count(*)::int FROM system.transactional_outbox WHERE tenant_id=$1 AND command_id=$2) outbox`, [scope.tenantId, envelope.commandId]);
        assert.deepEqual(evidence.rows[0], { audit: 1, outbox: 1 });
        stationId = (await save(admin, 'restaurant.station.save', { name: 'Hot kitchen', kind: 'KITCHEN', charactersPerLine: 42, active: true })).stationId;
        tableId = (await save(admin, 'restaurant.table.save', { name: 'Table 1', sectionId, seats: 4, active: true })).tableId;
        const configuration = await read(admin);
        assert.equal(configuration.sections.find((row: any) => row.id === sectionId).name, 'Dining room');
        assert.equal(configuration.tables.find((row: any) => row.id === tableId).sectionId, sectionId);
        assert.equal(configuration.stations.find((row: any) => row.id === stationId).charactersPerLine, 42);
      });
      await t.test('concurrent edits yield one confirmation and one controlled conflict', async () => {
        const responses = await Promise.all(['Dining east', 'Dining west'].map(name => submit(admin, command(admin, 'restaurant.section.save', { sectionId, name, active: true }, { [`section:${sectionId}`]: 1 }))));
        assert.deepEqual(responses.map(response => response.json().status).sort(), ['CONFIRMED', 'CONFLICT']);
        rejected(await submit(admin, command(admin, 'restaurant.table.save', { tableId, name: 'Table edited', sectionId, seats: 4, active: true })), 'VALIDATION_FAILED');
        const area = (await read(admin)).sections.find((row: any) => row.id === sectionId); assert.equal(area.version, 2);
      });
      await t.test('ten simultaneous independent setup creates remain controlled and persist one identity each', async () => {
        const responses = await Promise.all(Array.from({ length: 10 }, (_, index) => submit(admin, command(admin, 'restaurant.section.save', { name: `Concurrent area ${index}`, active: true }))));
        for (const response of responses) { assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().status, 'CONFIRMED', response.body); }
        assert.equal(new Set(responses.map(response => response.json().value.sectionId)).size, 10);
      });
      await t.test('rejects guessed foreign identities, supplied scope, malformed fields and duplicate names', async () => {
        for (const a of [foreign, otherOutlet]) {
          assert.equal((await read(a)).sections.length, 0);
          rejected(await submit(a, command(a, 'restaurant.section.save', { sectionId, name: 'Foreign edit', active: true }, { [`section:${sectionId}`]: 2 })), 'NOT_FOUND');
          rejected(await submit(a, command(a, 'restaurant.table.save', { name: 'Foreign link', sectionId, seats: 2, active: true })), 'NOT_FOUND');
        }
        for (const payload of [{ name: '', active: true }, { name: 'Bad\narea', active: true }, { name: 'Scope attack', active: true, outletId: foreign.outletId }, { name: 'Wrong boolean', active: 'true' }, { name: 'Too long'.repeat(80), active: true }]) {
          rejected(await submit(admin, command(admin, 'restaurant.section.save', payload)), 'VALIDATION_FAILED');
        }
        rejected(await submit(admin, command(admin, 'restaurant.station.save', { name: 'Narrow', kind: 'KITCHEN', charactersPerLine: 12, active: true })), 'VALIDATION_FAILED');
        rejected(await submit(admin, command(admin, 'restaurant.table.save', { name: 'Wrong seats', sectionId, seats: 2.5, active: true })), 'VALIDATION_FAILED');
        rejected(await submit(admin, command(admin, 'restaurant.table.save', { name: 'Table 1', sectionId, seats: 2, active: true })));
      });
      await t.test('routes explicit prepared items without claiming consumption and protects item versions', async () => {
        productId = (await save(admin, 'catalog.product.create', { sku: 'RESTAURANT-DISH', name: 'Prepared test dish', itemKind: 'PREPARED', baseUnit: 'portion', currency: 'KES', sellingPriceMinor: 25000, costPriceMinor: 0, taxRateBps: 1600 })).productId;
        const payload = { productId, stationIds: [stationId], preparationLabel: 'Meal for pass', instructions: 'No salt', available: true };
        const route = await save(admin, 'restaurant.menu.save', payload, { [`product:${productId}`]: 1 });
        assert.equal(route.productId, productId); assert.equal(route.version, 1);
        const configuration = await read(admin);
        assert.deepEqual(configuration.menuRoutes.find((row: any) => row.productId === productId).stationIds, [stationId]);
        assert.doesNotMatch(JSON.stringify(await read(waiter)), /costPrice|inventoryValue|credential|password|sessionId|csrfToken/i);
        rejected(await submit(admin, command(admin, 'restaurant.menu.save', payload, { [`product:${productId}`]: 1 })), 'VALIDATION_FAILED');
        rejected(await submit(admin, command(admin, 'restaurant.menu.save', { ...payload, stationIds: [randomUUID()] }, { [`product:${productId}`]: 1, [`menu:${productId}`]: 1 })), 'NOT_FOUND');
        rejected(await submit(admin, command(admin, 'restaurant.menu.save', { ...payload, stationIds: [stationId, stationId] }, { [`product:${productId}`]: 1, [`menu:${productId}`]: 1 })), 'VALIDATION_FAILED');
        const shift = await save(admin, 'shift.open', { openingFloatMinor: 0 });
        rejected(await submit(admin, command(admin, 'sales.order.settle', { shiftId: shift.shiftId, lines: [{ productId, quantity: '1' }], tenders: [{ method: 'CASH', amountMinor: 29000, currency: 'KES' }] }, { [`shift:${shift.shiftId}`]: 1 })), 'RECIPE_CONSUMPTION_UNAVAILABLE');
        await save(admin, 'shift.close', { shiftId: shift.shiftId, countedCashMinor: 0 }, { [`shift:${shift.shiftId}`]: 1 });
      });
      await t.test('archives dependencies in a reviewed order and retains identities', async () => {
        rejected(await submit(admin, command(admin, 'restaurant.section.save', { sectionId, name: 'Closed dining room', active: false }, { [`section:${sectionId}`]: 2 })));
        rejected(await submit(admin, command(admin, 'restaurant.station.save', { stationId, name: 'Hot kitchen', kind: 'KITCHEN', charactersPerLine: 42, active: false }, { [`station:${stationId}`]: 1 })));
        await save(admin, 'restaurant.menu.save', { productId, stationIds: [stationId], preparationLabel: 'Meal for pass', instructions: '', available: false }, { [`product:${productId}`]: 1, [`menu:${productId}`]: 1 });
        await save(admin, 'restaurant.table.save', { tableId, name: 'Table 1', sectionId, seats: 4, active: false }, { [`table:${tableId}`]: 1 });
        await save(admin, 'restaurant.section.save', { sectionId, name: 'Closed dining room', active: false }, { [`section:${sectionId}`]: 2 });
        const configuration = await read(admin);
        assert.equal(configuration.sections.find((row: any) => row.id === sectionId).active, false);
        assert.equal(configuration.tables.find((row: any) => row.id === tableId).active, false);
        await save(admin, 'restaurant.table.save', { tableId, name: 'Retired Table 1', sectionId, seats: 4, active: false }, { [`table:${tableId}`]: 2 });
      });
      await t.test('station access binds current logical assignments and can be revoked without granting terminal authority', async () => {
        const payload = { deviceId: waiter.deviceId, stationIds: [stationId] };
        const assignment = await save(admin, 'restaurant.station.assign', payload, { [`device:${waiter.deviceId}`]: 1 });
        assert.equal(assignment.deviceId, waiter.deviceId); assert.equal(assignment.version, 1);
        let currentAssignment = (await read(admin)).stationAssignments.find((row: any) => row.deviceId === waiter.deviceId);
        assert.equal(currentAssignment.deviceVersion, 1); assert.equal(currentAssignment.effectiveActive, true);
        rejected(await submit(waiter, command(waiter, 'restaurant.station.assign', payload, { [`device:${waiter.deviceId}`]: 1 })), 'FORBIDDEN');
        rejected(await submit(admin, command(admin, 'restaurant.station.assign', { deviceId: foreign.deviceId, stationIds: [stationId] }, { [`device:${foreign.deviceId}`]: 1 })), 'NOT_FOUND');
        rejected(await submit(admin, command(admin, 'restaurant.station.assign', { deviceId: otherOutlet.deviceId, stationIds: [stationId] }, { [`device:${otherOutlet.deviceId}`]: 1 })), 'NOT_FOUND');
        await db.pool.query("UPDATE identity.devices SET label='Reviewed logical assignment',version=version+1 WHERE id=$1", [waiter.deviceId]);
        currentAssignment = (await read(admin)).stationAssignments.find((row: any) => row.deviceId === waiter.deviceId);
        assert.equal(currentAssignment.effectiveActive, false, 'A changed logical assignment must not inherit prior station authority.');
        rejected(await submit(admin, command(admin, 'restaurant.station.assign', payload, { [`device:${waiter.deviceId}`]: 1, [`stationAssignment:${waiter.deviceId}`]: 1 })), 'VERSION_CONFLICT');
        await save(admin, 'restaurant.station.assign', payload, { [`device:${waiter.deviceId}`]: 2, [`stationAssignment:${waiter.deviceId}`]: 1 });
        assert.equal((await read(admin)).stationAssignments.find((row: any) => row.deviceId === waiter.deviceId).effectiveActive, true);
        await save(admin, 'restaurant.station.assign', { deviceId: waiter.deviceId, stationIds: [] }, { [`device:${waiter.deviceId}`]: 2, [`stationAssignment:${waiter.deviceId}`]: 2 });
        assert.deepEqual((await read(admin)).stationAssignments.find((row: any) => row.deviceId === waiter.deviceId).stationIds, []);
        await db.pool.query('UPDATE identity.devices SET active=false,version=version+1 WHERE id=$1', [waiter.deviceId]);
        rejected(await submit(admin, command(admin, 'restaurant.station.assign', payload, { [`device:${waiter.deviceId}`]: 3, [`stationAssignment:${waiter.deviceId}`]: 3 })));
        await save(admin, 'restaurant.station.assign', { deviceId: waiter.deviceId, stationIds: [] }, { [`device:${waiter.deviceId}`]: 3, [`stationAssignment:${waiter.deviceId}`]: 3 });
      });
      await t.test('withdraws a menu route after its product and station retire without reviving either identity', async () => {
        await save(admin, 'catalog.product.set_active', { productId, active: false, reason: 'Retire reviewed menu item' }, { [`product:${productId}`]: 1 });
        await save(admin, 'restaurant.station.save', { stationId, name: 'Hot kitchen', kind: 'KITCHEN', charactersPerLine: 42, active: false }, { [`station:${stationId}`]: 1 });
        const payload = { productId, stationIds: [stationId], preparationLabel: 'Retired dish', instructions: '', available: false };
        await save(admin, 'restaurant.menu.save', payload, { [`product:${productId}`]: 2, [`menu:${productId}`]: 2 });
        const route = (await read(admin)).menuRoutes.find((row: any) => row.productId === productId);
        assert.equal(route.available, false); assert.equal(route.productActive, false); assert.equal(route.effectiveAvailable, false);
        rejected(await submit(admin, command(admin, 'restaurant.menu.save', { ...payload, available: true }, { [`product:${productId}`]: 2, [`menu:${productId}`]: 3 })), 'NOT_FOUND');
        rejected(await submit(admin, command(admin, 'restaurant.table.save', { tableId, name: 'Retired Table 1', sectionId, seats: 4, active: true }, { [`table:${tableId}`]: 3 })), 'NOT_FOUND');
      });
      await t.test('menu candidates search the full authorized directory and continue beyond the first page', async () => {
        for (let index = 0; index < 55; index++) {
          await db.pool.query("INSERT INTO catalog.products(id,tenant_id,outlet_id,sku,name,base_unit,currency,selling_price_minor,cost_price_minor,tax_rate_bps,item_kind) VALUES($1,$2,$3,$4,$5,'portion','KES',500,0,0,'SERVICE')", [randomUUID(), scope.tenantId, scope.outletId, `MENU-${index}`, `Candidate ${index}`]);
        }
        const first = await app.inject({ url: '/api/v1/restaurant/products?limit=10', headers: admin.headers }); assert.equal(first.statusCode, 200, first.body);
        assert.equal(first.json().products.length, 10); assert.equal(first.json().page.totalCount, 55);
        const seen = new Set<string>(first.json().products.map((row: any) => row.id)); let cursor = first.json().page.nextCursor;
        while (cursor) {
          const response = await app.inject({ url: `/api/v1/restaurant/products?limit=10&after=${encodeURIComponent(cursor)}`, headers: admin.headers }); assert.equal(response.statusCode, 200, response.body);
          for (const product of response.json().products) { assert.ok(!seen.has(product.id)); seen.add(product.id); }
          cursor = response.json().page.nextCursor;
        }
        assert.equal(seen.size, 55);
        const search = await app.inject({ url: '/api/v1/restaurant/products?q=MENU-54', headers: admin.headers }); assert.equal(search.json().page.totalCount, 1); assert.equal(search.json().products[0].sku, 'MENU-54');
        rejected(await app.inject({ url: `/api/v1/restaurant/products?after=${encodeURIComponent(first.json().page.nextCursor)}`, headers: otherOutlet.headers }), 'VALIDATION_FAILED');
        rejected(await app.inject({ url: '/api/v1/restaurant/products?limit=9999', headers: admin.headers }), 'VALIDATION_FAILED');
      });
      await t.test('first-use businesses can prepare restaurant setup without gaining access to trading commands', async () => {
        await db.pool.query("INSERT INTO core.tenant_onboarding(tenant_id,bootstrap_key_hash) VALUES($1,$2)", [scope.tenantId, `restaurant-setup-${scope.tenantId}`]);
        assert.equal((await app.inject({ url: '/api/v1/restaurant/configuration', headers: admin.headers })).statusCode, 200);
        assert.equal((await app.inject({ url: '/api/v1/restaurant/products?q=MENU-54', headers: admin.headers })).statusCode, 200);
        await save(admin, 'restaurant.section.save', { name: 'First-use setup area', active: true });
        rejected(await submit(admin, command(admin, 'shift.open', { openingFloatMinor: 0 })), 'ONBOARDING_REQUIRED');
        rejected(await submit(admin, command(admin, 'restaurant.order.fire', {})), 'ONBOARDING_REQUIRED');
      });
      await t.test('setup has no sale, payment, stock or journal side effects and retains recovery permission', async () => {
        // Item creation legitimately adds a zero balance; no movement/value is posted.
        const after = await financialEvidence(scope);
        assert.deepEqual(after.slice(1), before.slice(1));
        const balance = await db.pool.query('SELECT quantity::text,inventory_value_minor::text FROM inventory.balances WHERE tenant_id=$1', [scope.tenantId]);
        assert.ok(balance.rows.every(row => Number(row.quantity) === 0 && row.inventory_value_minor === '0'));
        const saved = command(admin, 'restaurant.station.save', { name: 'Recovery bar', kind: 'BAR', charactersPerLine: 48, active: true });
        await submit(admin, saved);
        await db.pool.query("UPDATE identity.memberships SET role='storekeeper' WHERE tenant_id=$1 AND user_id=$2", [scope.tenantId, admin.userId]);
        rejected(await app.inject({ url: `/api/v1/commands/${saved.commandId}`, headers: admin.headers }), 'FORBIDDEN');
        rejected(await submit(admin, saved), 'FORBIDDEN');
      });
    } finally { await app.close(); await db.pool.end(); }
  });
}
