import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { ApiRole, CommandEnvelope } from '../src/contracts.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  test('command recovery checks original actor/outlet and current transactional authority', { skip: 'Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database.' }, () => {});
} else {
  process.env.DATABASE_URL = databaseUrl;
  process.env.APP_ORIGINS ??= 'http://localhost:3000';
  process.env.CREDENTIAL_FINGERPRINT_KEY ??= 'c'.repeat(64);
  const [{ buildApp }, security, db, { hashCommand }] = await Promise.all([
    import('../src/app.js'), import('../src/security.js'), import('../src/db.js'), import('../src/commands.js'),
  ]);
  const origin = process.env.APP_ORIGINS.split(',')[0];
  const password = `Disposable-recovery-${randomUUID()}`;
  const passwordHash = await security.hashPassword(password);
  interface Context { tenantId: string; outletId: string }
  interface Actor extends Context { userId: string; deviceId: string; email: string; sessionId: string; headers: Record<string, string> }
  let terminal = 0;

  async function context(tenantId: string = randomUUID()): Promise<Context> {
    await db.pool.query('INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,\'Disposable recovery business\',\'KES\',\'Africa/Nairobi\') ON CONFLICT DO NOTHING', [tenantId]);
    const outletId = randomUUID();
    await db.pool.query('INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,\'Recovery outlet\',\'Africa/Nairobi\')', [outletId, tenantId]);
    for (const capability of ['commerce', 'inventory', 'retail', 'hospitality']) await db.pool.query('INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,$2) ON CONFLICT DO NOTHING', [tenantId, capability]);
    return { tenantId, outletId };
  }
  async function login(app: FastifyInstance, actor: Omit<Actor, 'headers' | 'sessionId'>): Promise<Actor> {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `198.51.100.${++terminal}`, headers: { origin }, payload: { email: actor.email, password, deviceId: actor.deviceId } });
    assert.equal(response.statusCode, 200, response.body);
    const cookies = response.headers['set-cookie'];
    const cookie = (Array.isArray(cookies) ? cookies : [cookies]).filter((value): value is string => typeof value === 'string').map(value => value.split(';', 1)[0]).join('; ');
    const token = /maz_session=([^;]+)/.exec(cookie)![1];
    const session = await db.pool.query('SELECT id FROM identity.sessions WHERE token_hash=$1', [security.hashToken(token)]);
    return { ...actor, sessionId: session.rows[0].id, headers: { cookie, origin, 'x-csrf-token': response.json().csrfToken } };
  }
  async function actor(app: FastifyInstance, scope: Context, role: ApiRole = 'admin', existing?: Actor): Promise<Actor> {
    const userId = existing?.userId ?? randomUUID(), email = existing?.email ?? `recovery-${userId}@example.invalid`, deviceId = randomUUID();
    if (!existing) await db.pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,\'Recovery operator\')', [userId, email, passwordHash]);
    await db.pool.query('INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [scope.tenantId, userId, role]);
    await db.pool.query('INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,\'Disposable recovery terminal\')', [deviceId, scope.tenantId, scope.outletId, userId]);
    return login(app, { ...scope, userId, email, deviceId });
  }
  async function fixture(t: TestContext) {
    const app = buildApp({ logger: { level: 'silent' } });
    let beforeTransaction: (() => Promise<unknown>) | undefined;
    // Runs after the real HTTP authentication hook, before the route transaction.
    app.addHook('preHandler', async request => {
      if (request.headers['x-recovery-race'] !== '1' || !beforeTransaction) return;
      const change = beforeTransaction; beforeTransaction = undefined; await change();
    });
    await app.ready();
    t.after(async () => { await app.close(); });
    const owner = await actor(app, await context());
    return { app, owner, race: (change: () => Promise<unknown>) => { beforeTransaction = change; } };
  }
  function command(owner: Actor, type: string, payload: Record<string, unknown>, expectedVersions: Record<string, number> = {}): CommandEnvelope {
    return { protocolVersion: 1, commandId: randomUUID(), tenantId: owner.tenantId, deviceId: owner.deviceId, type, occurredAt: new Date().toISOString(), expectedVersions, payload };
  }
  const submit = (app: FastifyInstance, owner: Actor, envelope: CommandEnvelope, race = false) => app.inject({ method: 'POST', url: '/api/v1/commands', headers: { ...owner.headers, ...(race ? { 'x-recovery-race': '1' } : {}) }, payload: envelope });
  const status = (app: FastifyInstance, owner: Actor, commandId: string, race = false) => app.inject({ url: `/api/v1/commands/${commandId}`, headers: { ...owner.headers, ...(race ? { 'x-recovery-race': '1' } : {}) } });
  const productCommand = (owner: Actor) => command(owner, 'catalog.product.create', { sku: `REC-${randomUUID()}`, name: 'Recovery item', baseUnit: 'each', currency: 'KES', sellingPriceMinor: 1000, costPriceMinor: 400, taxRateBps: 0 });
  function confirmed(response: { statusCode: number; body: string; json(): any }) { assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().status, 'CONFIRMED', response.body); return response.json(); }
  function denied(response: { statusCode: number; body: string; json(): any }, http: number, code: string) { assert.equal(response.statusCode, http, response.body); assert.equal(response.json().error.code, code, response.body); assert.ok(!response.json().response && !response.json().value); }
  async function controls(tenantId: string) {
    const result = await db.pool.query(`SELECT
      (SELECT count(*) FROM catalog.products WHERE tenant_id=$1)::text products,
      (SELECT count(*) FROM inventory.movements WHERE tenant_id=$1)::text movements,
      (SELECT coalesce(sum(quantity),0)::text FROM inventory.balances WHERE tenant_id=$1) quantity,
      (SELECT coalesce(sum(inventory_value_minor),0)::text FROM inventory.balances WHERE tenant_id=$1) inventory_value,
      (SELECT count(*) FROM commerce.orders WHERE tenant_id=$1)::text orders,
      (SELECT count(*) FROM commerce.payments WHERE tenant_id=$1)::text payments,
      (SELECT count(*) FROM finance.journal_entries WHERE tenant_id=$1)::text journals,
      (SELECT count(*) FROM system.audit_events WHERE tenant_id=$1)::text audits,
      (SELECT count(*) FROM system.transactional_outbox WHERE tenant_id=$1)::text outbox,
      (SELECT jsonb_agg(jsonb_build_object('id',command_id,'status',status,'response',response,'hash',encode(request_hash,'hex')) ORDER BY command_id) FROM system.commands WHERE tenant_id=$1) commands`, [tenantId]);
    return result.rows[0];
  }

  test('original command recovery is scoped and reauthorizes current identity without repeating effects', { timeout: 180_000 }, async t => {
    t.after(async () => { await db.pool.end(); });

    await t.test('another actor, outlet or tenant cannot recover ordinary outcomes; same actor can use a fresh session', async t => {
      const { app, owner } = await fixture(t), peer = await actor(app, owner), otherOutlet = await actor(app, await context(owner.tenantId), 'admin', owner), sameOutlet = await actor(app, owner, 'admin', owner), foreign = await actor(app, await context());
      const envelope = productCommand(owner), first = confirmed(await submit(app, owner, envelope));
      const baseline = await controls(owner.tenantId);
      denied(await status(app, peer, envelope.commandId), 404, 'NOT_FOUND');
      denied(await submit(app, peer, { ...envelope, deviceId: peer.deviceId }), 403, 'FORBIDDEN');
      denied(await status(app, otherOutlet, envelope.commandId), 404, 'NOT_FOUND');
      denied(await submit(app, otherOutlet, { ...envelope, deviceId: otherOutlet.deviceId }), 403, 'FORBIDDEN');
      denied(await status(app, foreign, envelope.commandId), 404, 'NOT_FOUND');
      assert.deepEqual((await status(app, sameOutlet, envelope.commandId)).json().response, { status: 'CONFIRMED', value: first.value });
      denied(await submit(app, sameOutlet, envelope), 403, 'FORBIDDEN');
      await db.pool.query('UPDATE identity.sessions SET revoked_at=now() WHERE id=$1', [owner.sessionId]);
      denied(await status(app, owner, envelope.commandId), 401, 'UNAUTHENTICATED');
      const renewed = await login(app, owner);
      assert.deepEqual(confirmed(await submit(app, renewed, envelope)), first);
      assert.deepEqual((await status(app, renewed, envelope.commandId)).json().response, { status: 'CONFIRMED', value: first.value });
      await db.pool.query('UPDATE identity.devices SET assigned_user_id=$2 WHERE id=$1', [owner.deviceId, peer.userId]);
      const reassigned = await login(app, { ...peer, deviceId: owner.deviceId });
      denied(await status(app, reassigned, envelope.commandId), 404, 'NOT_FOUND');
      denied(await submit(app, reassigned, envelope), 403, 'FORBIDDEN');
      assert.deepEqual((await status(app, sameOutlet, envelope.commandId)).json().response, { status: 'CONFIRMED', value: first.value }, 'a new device assignee cannot acquire the old actor\'s outcome');
      assert.deepEqual(await controls(owner.tenantId), baseline);
    });

    await t.test('role/capability loss after HTTP preflight denies status and replay using the persisted type', async t => {
      const { app, owner, race } = await fixture(t), envelope = productCommand(owner);
      confirmed(await submit(app, owner, envelope));
      const baseline = await controls(owner.tenantId);
      const role = (value: ApiRole) => db.pool.query('UPDATE identity.memberships SET role=$3 WHERE tenant_id=$1 AND user_id=$2', [owner.tenantId, owner.userId, value]);
      race(() => role('cashier'));
      denied(await status(app, owner, envelope.commandId, true), 403, 'FORBIDDEN');
      denied(await submit(app, owner, { ...envelope, type: 'auth.session.revoke' }), 403, 'FORBIDDEN');
      await role('admin'); race(() => role('cashier'));
      denied(await submit(app, owner, envelope, true), 403, 'FORBIDDEN');
      await role('admin');
      race(() => db.pool.query('DELETE FROM core.tenant_capabilities WHERE tenant_id=$1 AND capability=\'inventory\'', [owner.tenantId]));
      denied(await status(app, owner, envelope.commandId, true), 403, 'CAPABILITY_DISABLED');
      denied(await submit(app, owner, envelope), 403, 'CAPABILITY_DISABLED');
      await db.pool.query('INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,\'inventory\')', [owner.tenantId]);
      race(() => db.pool.query('DELETE FROM core.tenant_capabilities WHERE tenant_id=$1 AND capability=\'inventory\'', [owner.tenantId]));
      denied(await submit(app, owner, envelope, true), 403, 'CAPABILITY_DISABLED');
      assert.deepEqual(await controls(owner.tenantId), baseline, 'denial cannot change the confirmed outcome or business evidence');
    });

    await t.test('session and assignment revocation after preflight block recovery within the transaction', async t => {
      const { app, owner, race } = await fixture(t), envelope = productCommand(owner);
      confirmed(await submit(app, owner, envelope)); const baseline = await controls(owner.tenantId);
      race(() => db.pool.query('UPDATE identity.sessions SET revoked_at=now() WHERE id=$1', [owner.sessionId]));
      denied(await status(app, owner, envelope.commandId, true), 401, 'UNAUTHENTICATED');
      const renewed = await login(app, owner);
      race(() => db.pool.query('UPDATE identity.memberships SET active=false WHERE tenant_id=$1 AND user_id=$2', [owner.tenantId, owner.userId]));
      denied(await status(app, renewed, envelope.commandId, true), 401, 'UNAUTHENTICATED');
      await db.pool.query('UPDATE identity.memberships SET active=true WHERE tenant_id=$1 AND user_id=$2', [owner.tenantId, owner.userId]);
      race(() => db.pool.query('UPDATE identity.devices SET active=false WHERE id=$1', [owner.deviceId]));
      denied(await submit(app, renewed, envelope, true), 401, 'UNAUTHENTICATED');
      assert.deepEqual(await controls(owner.tenantId), baseline);
    });

    await t.test('staff, assignment and credential metadata outcomes keep original actor/outlet and current admin authority', async t => {
      const { app, owner } = await fixture(t), peer = await actor(app, owner), otherOutlet = await actor(app, await context(owner.tenantId), 'admin', owner);
      const member = command(owner, 'staff.member.create', { email: `created-${randomUUID()}@example.invalid`, displayName: 'New recovery operator', role: 'cashier' });
      const memberResult = confirmed(await submit(app, owner, member));
      const assignment = command(owner, 'devices.assignment.create', { label: 'Recovery assignment', outletId: owner.outletId, assignedUserId: memberResult.value.userId });
      confirmed(await submit(app, owner, assignment));
      const credential = { protocolVersion: 1, commandId: randomUUID(), expectedVersions: { [`credential:${memberResult.value.userId}`]: 1 }, newPassword: `Initial-recovery-${randomUUID()}` };
      confirmed(await app.inject({ method: 'POST', url: `/api/v1/staff/${memberResult.value.userId}/password`, headers: owner.headers, payload: credential }));
      const baseline = await controls(owner.tenantId);
      for (const envelope of [member, assignment]) {
        denied(await status(app, peer, envelope.commandId), 404, 'NOT_FOUND');
        denied(await status(app, otherOutlet, envelope.commandId), 404, 'NOT_FOUND');
        denied(await submit(app, peer, { ...envelope, deviceId: peer.deviceId }), 403, 'FORBIDDEN');
      }
      denied(await status(app, otherOutlet, credential.commandId), 404, 'NOT_FOUND');
      denied(await app.inject({ method: 'POST', url: `/api/v1/staff/${memberResult.value.userId}/password`, headers: otherOutlet.headers, payload: credential }), 403, 'FORBIDDEN');
      await db.pool.query('UPDATE identity.memberships SET role=\'manager\' WHERE tenant_id=$1 AND user_id=$2', [owner.tenantId, owner.userId]);
      for (const id of [member.commandId, assignment.commandId, credential.commandId]) denied(await status(app, owner, id), 403, 'FORBIDDEN');
      denied(await submit(app, owner, { ...member, type: 'catalog.product.create' }), 403, 'FORBIDDEN');
      assert.deepEqual(await controls(owner.tenantId), baseline);
    });

    await t.test('self-session metadata recovers after fresh sign-in without requiring an administrative role', async t => {
      const { app, owner } = await fixture(t), peer = await actor(app, owner);
      const envelope = command(owner, 'auth.session.revoke', { sessionId: owner.sessionId, reason: 'Recovery self sign-out' }, { [`session:${owner.sessionId}`]: 1 });
      const first = confirmed(await submit(app, owner, envelope));
      denied(await status(app, peer, envelope.commandId), 404, 'NOT_FOUND');
      await db.pool.query('UPDATE identity.memberships SET role=\'cashier\' WHERE tenant_id=$1 AND user_id=$2', [owner.tenantId, owner.userId]);
      const renewed = await login(app, owner), baseline = await controls(owner.tenantId);
      assert.deepEqual((await status(app, renewed, envelope.commandId)).json().response, { status: 'CONFIRMED', value: first.value });
      assert.deepEqual(confirmed(await submit(app, renewed, envelope)), first);
      assert.deepEqual(await controls(owner.tenantId), baseline);
    });

    await t.test('confirmed cash replay does not repeat money or stock checks/effects after shift closure', async t => {
      const { app, owner } = await fixture(t), product = confirmed(await submit(app, owner, productCommand(owner))).value;
      confirmed(await submit(app, owner, command(owner, 'inventory.receive', { lines: [{ productId: product.productId, quantity: '1', unitCostMinor: 400 }] })));
      const shift = confirmed(await submit(app, owner, command(owner, 'shift.open', { openingFloatMinor: 0 }))).value;
      const sale = command(owner, 'sales.order.settle', { shiftId: shift.shiftId, lines: [{ productId: product.productId, quantity: '1' }], tenders: [{ method: 'CASH', amountMinor: 1000, currency: 'KES' }] }, { [`shift:${shift.shiftId}`]: 1 });
      const first = confirmed(await submit(app, owner, sale));
      confirmed(await submit(app, owner, command(owner, 'shift.close', { shiftId: shift.shiftId, countedCashMinor: 1000 }, { [`shift:${shift.shiftId}`]: 2 })));
      const baseline = await controls(owner.tenantId);
      assert.deepEqual(confirmed(await submit(app, owner, sale)), first, 'original stale versions and exhausted stock do not rerun domain work');
      assert.deepEqual((await status(app, owner, sale.commandId)).json().response, { status: 'CONFIRMED', value: first.value });
      await db.pool.query('UPDATE identity.memberships SET role=\'accountant\' WHERE tenant_id=$1 AND user_id=$2', [owner.tenantId, owner.userId]);
      denied(await submit(app, owner, sale), 403, 'FORBIDDEN');
      await db.pool.query('UPDATE identity.memberships SET role=\'admin\' WHERE tenant_id=$1 AND user_id=$2', [owner.tenantId, owner.userId]);
      await db.pool.query('DELETE FROM core.tenant_capabilities WHERE tenant_id=$1 AND capability=\'commerce\'', [owner.tenantId]);
      denied(await status(app, owner, sale.commandId), 403, 'CAPABILITY_DISABLED');
      denied(await submit(app, owner, sale), 403, 'CAPABILITY_DISABLED');
      assert.deepEqual(await controls(owner.tenantId), baseline);
    });

    await t.test('unknown persisted command types deny recovery rather than borrowing a submitted type', async t => {
      const { app, owner } = await fixture(t), envelope = command(owner, 'future.unsupported.operation', {});
      await db.pool.query(`INSERT INTO system.commands(tenant_id,command_id,actor_id,device_id,command_type,request_hash,status,response)
        VALUES($1,$2,$3,$4,$5,$6,'CONFIRMED','{"status":"CONFIRMED","value":{"privateReference":"future-only"}}')`, [owner.tenantId, envelope.commandId, owner.userId, owner.deviceId, envelope.type, hashCommand(envelope)]);
      const baseline = await controls(owner.tenantId);
      denied(await status(app, owner, envelope.commandId), 403, 'FORBIDDEN');
      denied(await submit(app, owner, { ...envelope, type: 'auth.session.revoke' }), 403, 'FORBIDDEN');
      assert.deepEqual(await controls(owner.tenantId), baseline);
    });

    await t.test('trusted requirements survive business rejection and later classification changes', async t => {
      const { app, owner } = await fixture(t);
      const stocked = productCommand(owner), stockedResult = confirmed(await submit(app, owner, stocked));
      const service = command(owner, 'catalog.product.create', { ...productCommand(owner).payload, itemKind: 'SERVICE', costPriceMinor: 0 });
      const serviceResult = confirmed(await submit(app, owner, service));
      const rejected = command(owner, 'catalog.product.set_active', { productId: stockedResult.value.productId, active: false, reason: 'Stale expected version' }, { [`product:${stockedResult.value.productId}`]: 999 });
      assert.equal((await submit(app, owner, rejected)).json().status, 'CONFLICT');
      const descriptor = async (commandId: string) => (await db.pool.query('SELECT authority_version,required_capabilities,status FROM system.commands WHERE tenant_id=$1 AND command_id=$2', [owner.tenantId, commandId])).rows[0];
      assert.deepEqual(await descriptor(stocked.commandId), { authority_version: 1, required_capabilities: ['inventory'], status: 'CONFIRMED' });
      assert.deepEqual(await descriptor(rejected.commandId), { authority_version: 1, required_capabilities: ['inventory'], status: 'CONFLICT' });
      assert.deepEqual(await descriptor(service.commandId), { authority_version: 1, required_capabilities: ['commerce'], status: 'CONFIRMED' });
      confirmed(await submit(app, owner, command(owner, 'catalog.product.change_kind', { productId: stockedResult.value.productId, itemKind: 'SERVICE', reason: 'Change future sales classification' }, { [`product:${stockedResult.value.productId}`]: 1, [`balance:${stockedResult.value.productId}`]: 1 })));
      confirmed(await submit(app, owner, command(owner, 'catalog.product.change_kind', { productId: serviceResult.value.productId, itemKind: 'STOCKED_GOOD', reason: 'Change future stock classification' }, { [`product:${serviceResult.value.productId}`]: 1 })));
      await db.pool.query("DELETE FROM core.tenant_capabilities WHERE tenant_id=$1 AND capability='inventory'", [owner.tenantId]);
      const baseline = await controls(owner.tenantId);
      for (const envelope of [stocked, rejected]) {
        denied(await status(app, owner, envelope.commandId), 403, 'CAPABILITY_DISABLED');
        denied(await submit(app, owner, { ...envelope, type: 'catalog.product.create', payload: { ...service.payload } }), 403, 'CAPABILITY_DISABLED');
      }
      assert.deepEqual(confirmed(await submit(app, owner, service)), serviceResult, 'recovery uses original service requirements, not its new stocked classification');
      const recovered = (await status(app, owner, service.commandId)).json();
      assert.deepEqual(recovered.response, { status: 'CONFIRMED', value: serviceResult.value });
      assert.ok(!Object.hasOwn(recovered, 'required_capabilities') && !Object.hasOwn(recovered, 'authority_version'));
      assert.deepEqual(await controls(owner.tenantId), baseline);
    });

    await t.test('legacy and rolling-upgrade writers retain inventory while malformed descriptors fail closed', async t => {
      const { app, owner } = await fixture(t);
      const legacy = productCommand(owner);
      const response = { status: 'CONFIRMED', value: { productId: randomUUID(), version: 1 } };
      // Intentionally omit both new columns, exactly as an old API writer does
      // after migration. Empty SQL defaults cannot grant service-only recovery.
      await db.pool.query(`INSERT INTO system.commands(tenant_id,command_id,actor_id,device_id,command_type,request_hash,status,response)
        VALUES($1,$2,$3,$4,$5,$6,'CONFIRMED',$7::jsonb)`, [owner.tenantId, legacy.commandId, owner.userId, owner.deviceId, legacy.type, hashCommand(legacy), JSON.stringify(response)]);
      assert.deepEqual(confirmed(await submit(app, owner, legacy)), { commandId: legacy.commandId, ...response });
      await db.pool.query("DELETE FROM core.tenant_capabilities WHERE tenant_id=$1 AND capability='inventory'", [owner.tenantId]);
      denied(await status(app, owner, legacy.commandId), 403, 'CAPABILITY_DISABLED');
      denied(await submit(app, owner, { ...legacy, payload: { ...legacy.payload, itemKind: 'SERVICE' } }), 403, 'CAPABILITY_DISABLED');
      await db.pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'inventory')", [owner.tenantId]);
      for (const [version, requirements] of [[2, ['inventory']], [1, []], [1, ['hospitality']], [1, ['inventory', 'inventory']], [1, ['unknown-capability']]] as const) {
        await db.pool.query('UPDATE system.commands SET authority_version=$3,required_capabilities=$4::text[] WHERE tenant_id=$1 AND command_id=$2', [owner.tenantId, legacy.commandId, version, requirements]);
        denied(await status(app, owner, legacy.commandId), 403, 'FORBIDDEN');
        denied(await submit(app, owner, legacy), 403, 'FORBIDDEN');
      }
      await db.pool.query("UPDATE system.commands SET authority_version=0,required_capabilities='{}' WHERE tenant_id=$1 AND command_id=$2", [owner.tenantId, legacy.commandId]);
      assert.deepEqual(confirmed(await submit(app, owner, legacy)), { commandId: legacy.commandId, ...response });
    });

    await t.test('failed planning keeps conservative requirements and never creates business effects', async t => {
      const { app, owner } = await fixture(t);
      await db.pool.query("DELETE FROM core.tenant_capabilities WHERE tenant_id=$1 AND capability='inventory'", [owner.tenantId]);
      const envelope = command(owner, 'catalog.product.set_active', { productId: randomUUID(), active: false, reason: 'Missing scoped item' }, {});
      const result = await submit(app, owner, envelope);
      assert.equal(result.statusCode, 200, result.body);
      assert.equal(result.json().status, 'REJECTED');
      assert.equal(result.json().code, 'NOT_FOUND');
      const stored = (await db.pool.query('SELECT authority_version,required_capabilities,status FROM system.commands WHERE tenant_id=$1 AND command_id=$2', [owner.tenantId, envelope.commandId])).rows[0];
      assert.deepEqual(stored, { authority_version: 1, required_capabilities: ['inventory'], status: 'REJECTED' });
      const baseline = await controls(owner.tenantId);
      denied(await status(app, owner, envelope.commandId), 403, 'CAPABILITY_DISABLED');
      denied(await submit(app, owner, envelope), 403, 'CAPABILITY_DISABLED');
      assert.deepEqual(await controls(owner.tenantId), baseline);
    });

    await t.test('category authority includes archived stocked references and freezes empty-category capability choice', async t => {
      const { app, owner } = await fixture(t);
      const category = confirmed(await submit(app, owner, command(owner, 'catalog.category.create', { name: 'Mixed recovery category' }))).value;
      const stock = confirmed(await submit(app, owner, command(owner, 'catalog.product.create', { ...productCommand(owner).payload, category: 'Mixed recovery category' }))).value;
      confirmed(await submit(app, owner, command(owner, 'catalog.product.create', { ...productCommand(owner).payload, itemKind: 'SERVICE', costPriceMinor: 0, category: 'Mixed recovery category' })));
      confirmed(await submit(app, owner, command(owner, 'catalog.product.set_active', { productId: stock.productId, active: false, reason: 'Archive zero-stock test identity' }, { [`product:${stock.productId}`]: 1 })));
      await db.pool.query("DELETE FROM core.tenant_capabilities WHERE tenant_id=$1 AND capability='inventory'", [owner.tenantId]);
      const rename = command(owner, 'catalog.category.update', { categoryId: category.categoryId, name: 'Mixed renamed', reason: 'Review every linked identity' }, { [`category:${category.categoryId}`]: 1 });
      const rejected = await submit(app, owner, rename);
      assert.equal(rejected.json().status, 'REJECTED', rejected.body);
      assert.equal(rejected.json().code, 'CAPABILITY_DISABLED', rejected.body);
      const descriptor = (await db.pool.query('SELECT required_capabilities FROM system.commands WHERE tenant_id=$1 AND command_id=$2', [owner.tenantId, rename.commandId])).rows[0];
      assert.deepEqual(descriptor.required_capabilities, ['commerce', 'inventory']);
      const names = await db.pool.query('SELECT name FROM catalog.categories WHERE id=$1', [category.categoryId]);
      assert.equal(names.rows[0].name, 'Mixed recovery category', 'archive cannot hide a stocked reference from category planning');
      await db.pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'inventory')", [owner.tenantId]);
      await db.pool.query("DELETE FROM core.tenant_capabilities WHERE tenant_id=$1 AND capability='commerce'", [owner.tenantId]);
      const empty = command(owner, 'catalog.category.create', { name: 'Inventory-only empty category' });
      const accepted = confirmed(await submit(app, owner, empty));
      assert.deepEqual((await db.pool.query('SELECT required_capabilities FROM system.commands WHERE tenant_id=$1 AND command_id=$2', [owner.tenantId, empty.commandId])).rows[0].required_capabilities, ['inventory']);
      assert.deepEqual(confirmed(await submit(app, owner, empty)), accepted);
      denied(await status(app, owner, rename.commandId), 403, 'CAPABILITY_DISABLED');
    });

    await t.test('sale and nonrestocking refund retain original stocked snapshot authority after reclassification', async t => {
      const { app, owner } = await fixture(t);
      const product = confirmed(await submit(app, owner, productCommand(owner))).value;
      confirmed(await submit(app, owner, command(owner, 'inventory.receive', { lines: [{ productId: product.productId, quantity: '1', unitCostMinor: 400 }] })));
      const shift = confirmed(await submit(app, owner, command(owner, 'shift.open', { openingFloatMinor: 0 }))).value;
      const sale = command(owner, 'sales.order.settle', { shiftId: shift.shiftId, lines: [{ productId: product.productId, quantity: '1' }], tenders: [{ method: 'CASH', amountMinor: 1000, currency: 'KES' }] }, { [`shift:${shift.shiftId}`]: 1 });
      const saleResult = confirmed(await submit(app, owner, sale));
      const line = (await db.pool.query('SELECT id,item_kind_snapshot FROM commerce.order_lines WHERE tenant_id=$1 AND order_id=$2', [owner.tenantId, saleResult.value.saleId])).rows[0];
      assert.equal(line.item_kind_snapshot, 'STOCKED_GOOD');
      const balance = (await db.pool.query('SELECT version FROM inventory.balances WHERE tenant_id=$1 AND product_id=$2', [owner.tenantId, product.productId])).rows[0];
      confirmed(await submit(app, owner, command(owner, 'catalog.product.change_kind', { productId: product.productId, itemKind: 'SERVICE', reason: 'Future identity classification only' }, { [`product:${product.productId}`]: 1, [`balance:${product.productId}`]: Number(balance.version) })));
      const refund = command(owner, 'sales.order.refund', { orderId: saleResult.value.saleId, shiftId: shift.shiftId, reason: 'Original goods refund without restocking', lines: [{ orderLineId: line.id, quantity: '1', restock: false }] }, { [`shift:${shift.shiftId}`]: 2 });
      const refundResult = confirmed(await submit(app, owner, refund));
      for (const envelope of [sale, refund]) assert.deepEqual((await db.pool.query('SELECT required_capabilities FROM system.commands WHERE tenant_id=$1 AND command_id=$2', [owner.tenantId, envelope.commandId])).rows[0].required_capabilities, ['commerce', 'inventory']);
      await db.pool.query("DELETE FROM core.tenant_capabilities WHERE tenant_id=$1 AND capability='inventory'", [owner.tenantId]);
      const baseline = await controls(owner.tenantId);
      for (const envelope of [sale, refund]) {
        denied(await status(app, owner, envelope.commandId), 403, 'CAPABILITY_DISABLED');
        denied(await submit(app, owner, envelope), 403, 'CAPABILITY_DISABLED');
      }
      await db.pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'inventory')", [owner.tenantId]);
      assert.deepEqual(confirmed(await submit(app, owner, sale)), saleResult);
      assert.deepEqual(confirmed(await submit(app, owner, refund)), refundResult);
      assert.deepEqual(await controls(owner.tenantId), baseline);
    });
  });
}
