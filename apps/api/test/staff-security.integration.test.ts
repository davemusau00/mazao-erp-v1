import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { CommandEnvelope } from '../src/contracts.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  test('staff, logical assignment, session and credential security acceptance', { skip: 'Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database.' }, () => {});
} else {
  process.env.DATABASE_URL = databaseUrl;
  process.env.APP_ORIGINS ??= 'http://localhost:3000';
  process.env.CREDENTIAL_FINGERPRINT_KEY ??= 'c'.repeat(64);
  const [{ buildApp }, security, db] = await Promise.all([import('../src/app.js'), import('../src/security.js'), import('../src/db.js')]);
  const origin = process.env.APP_ORIGINS.split(',')[0];
  const initialPassword = `Disposable-staff-security-${randomUUID()}`;
  const initialHash = await security.hashPassword(initialPassword);
  interface Context { tenantId: string; outletId: string }
  interface Actor extends Context { userId: string; deviceId: string; email: string; globalName: string; headers: Record<string, string> }
  interface Member { userId: string; displayName: string; email: string; role: string; active: boolean; version: number; credentialVersion: number; hasCredential: boolean }
  interface Assignment { id: string; kind: string; label: string; outletId: string; assignedUserId: string; active: boolean; version: number }
  interface OperatorSession { id: string; userId?: string; deviceId: string; current: boolean; version: number; revokedAt: string | null }
  const code = (response: { json(): any }) => response.json().error?.code ?? response.json().code;
  function rejected(response: { statusCode: number; body: string; json(): any }, expectedCode: string) {
    assert.ok(response.statusCode === 403 || response.statusCode === 404 || response.statusCode === 409 || response.statusCode === 401 || response.json().status === 'REJECTED' || response.json().status === 'CONFLICT', response.body);
    assert.equal(code(response), expectedCode, response.body);
  }
  async function makeTenant(): Promise<Context> {
    const tenantId = randomUUID(), outletId = randomUUID();
    await db.pool.query('INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,$2,\'KES\',\'Africa/Nairobi\')', [tenantId, `Disposable staff business ${tenantId}`]);
    await db.pool.query('INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,$3,\'Africa/Nairobi\')', [outletId, tenantId, `Disposable staff outlet ${outletId}`]);
    await db.pool.query('INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,\'commerce\'),($1,\'inventory\'),($1,\'retail\')', [tenantId]);
    return { tenantId, outletId };
  }
  async function authenticate(app: FastifyInstance, actor: Omit<Actor, 'headers'>, password = initialPassword) {
    const result = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { email: actor.email, password, deviceId: actor.deviceId } });
    assert.equal(result.statusCode, 200, result.body);
    const raw = result.headers['set-cookie'];
    const cookie = (Array.isArray(raw) ? raw : [raw]).filter((value): value is string => typeof value === 'string').map(value => value.split(';', 1)[0]).join('; ');
    return { ...actor, headers: { cookie, origin, 'x-csrf-token': result.json().csrfToken } } satisfies Actor;
  }
  async function makeActor(app: FastifyInstance, context: Context, role = 'admin', options: { userId?: string; deviceId?: string; shared?: boolean; globalName?: string } = {}): Promise<Actor> {
    const userId = options.userId ?? randomUUID(), deviceId = options.deviceId ?? randomUUID(), email = `staff-security-${userId}@example.invalid`, globalName = options.globalName ?? `Global ${role} ${userId}`;
    if (!options.shared) await db.pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)', [userId, email, initialHash, globalName]);
    await db.pool.query('INSERT INTO identity.memberships(tenant_id,user_id,role,display_name) VALUES($1,$2,$3,$4)', [context.tenantId, userId, role, `Local ${role} ${userId}`]);
    await db.pool.query('INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,$5)', [deviceId, context.tenantId, context.outletId, userId, 'Disposable logical workspace assignment']);
    return authenticate(app, { ...context, userId, deviceId, email, globalName });
  }
  function command(actor: Actor, type: string, payload: Record<string, unknown>, expectedVersions: Record<string, number> = {}): CommandEnvelope {
    return { protocolVersion: 1, commandId: randomUUID(), tenantId: actor.tenantId, deviceId: actor.deviceId, type, occurredAt: new Date().toISOString(), expectedVersions, payload };
  }
  const submit = (app: FastifyInstance, actor: Actor, envelope: CommandEnvelope) => app.inject({ method: 'POST', url: '/api/v1/commands', headers: actor.headers, payload: envelope });
  async function members(app: FastifyInstance, actor: Actor): Promise<Member[]> {
    const result = await app.inject({ url: '/api/v1/staff', headers: actor.headers }); assert.equal(result.statusCode, 200, result.body); return result.json().staff;
  }
  async function member(app: FastifyInstance, actor: Actor, userId: string) { const value = (await members(app, actor)).find(row => row.userId === userId); assert.ok(value); return value; }
  async function assignments(app: FastifyInstance, actor: Actor): Promise<Assignment[]> {
    const result = await app.inject({ url: '/api/v1/devices', headers: actor.headers }); assert.equal(result.statusCode, 200, result.body); return result.json().devices;
  }
  async function sessions(app: FastifyInstance, actor: Actor, userId = actor.userId): Promise<{ userId: string; credentialVersion: number; sessions: OperatorSession[] }> {
    const result = await app.inject({ url: userId === actor.userId ? '/api/v1/auth/sessions' : `/api/v1/staff/${userId}/sessions`, headers: actor.headers }); assert.equal(result.statusCode, 200, result.body); return result.json();
  }
  function credentialInput(userId: string, version: number, newPassword: string, currentPassword?: string) {
    return { protocolVersion: 1, commandId: randomUUID(), expectedVersions: { [`credential:${userId}`]: version }, newPassword, ...(currentPassword === undefined ? {} : { currentPassword }) };
  }
  const reset = (app: FastifyInstance, owner: Actor, targetId: string, body: Record<string, unknown>) => app.inject({ method: 'POST', url: `/api/v1/staff/${targetId}/password`, headers: owner.headers, payload: body });
  const changePassword = (app: FastifyInstance, actor: Actor, body: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/v1/auth/password', headers: actor.headers, payload: body });
  async function setup() {
    const logs: string[] = [], stream = new Writable({ write(chunk, _encoding, callback) { logs.push(String(chunk)); callback(); } });
    const app = buildApp({ logger: { stream } }); await app.ready();
    return { app, logs, owner: await makeActor(app, await makeTenant()) };
  }

  test('independent staff and credential security invariants', { timeout: 180_000 }, async t => {
    t.after(async () => { await db.pool.end(); });

    await t.test('directory writes require owner/admin authority and every foreign identifier stays scoped', async () => {
      const { app, owner } = await setup();
      try {
        const manager = await makeActor(app, owner, 'manager'), cashier = await makeActor(app, owner, 'cashier'), foreign = await makeActor(app, await makeTenant());
        const ownerRead = await app.inject({ url: '/api/v1/staff', headers: owner.headers });
        assert.equal(ownerRead.json().authorizationModel, 'COARSE_ROLE_MAP');
        assert.equal((await members(app, manager)).length, 3);
        assert.ok((await assignments(app, owner)).every(assignment => assignment.kind === 'WORKSPACE_ASSIGNMENT'));
        assert.equal((await app.inject({ url: '/api/v1/staff', headers: cashier.headers })).statusCode, 403);
        assert.equal((await app.inject({ url: '/api/v1/devices', headers: cashier.headers })).statusCode, 403);
        for (const type of ['staff.member.create', 'devices.assignment.create']) rejected(await submit(app, manager, command(manager, type, { email: 'denied@example.invalid', displayName: 'Denied', role: 'cashier', label: 'Denied', outletId: owner.outletId, assignedUserId: cashier.userId })), 'FORBIDDEN');
        const foreignRead = await app.inject({ url: `/api/v1/staff/${foreign.userId}/sessions`, headers: owner.headers }); assert.equal(foreignRead.statusCode, 404);
        rejected(await submit(app, owner, command(owner, 'staff.member.update', { userId: foreign.userId, displayName: 'Wrong tenant', role: 'cashier' }, { [`staff:${foreign.userId}`]: 1 })), 'NOT_FOUND');
        rejected(await submit(app, owner, command(owner, 'devices.assignment.update', { deviceId: foreign.deviceId, label: 'Wrong tenant', assignedUserId: cashier.userId }, { [`device:${foreign.deviceId}`]: 1 })), 'NOT_FOUND');
        rejected(await submit(app, owner, command(owner, 'devices.assignment.create', { label: 'Foreign outlet', outletId: foreign.outletId, assignedUserId: cashier.userId })), 'NOT_FOUND');
        rejected(await submit(app, owner, command(owner, 'devices.assignment.create', { label: 'Foreign user', outletId: owner.outletId, assignedUserId: foreign.userId })), 'NOT_FOUND');
        rejected(await reset(app, owner, foreign.userId, credentialInput(foreign.userId, 1, `Foreign-reset-${randomUUID()}`)), 'NOT_FOUND');
        const unsupported = await submit(app, owner, command(owner, 'staff.member.create', { email: `unsupported-${randomUUID()}@example.invalid`, displayName: 'Unsupported', role: 'superadmin' })); rejected(unsupported, 'VALIDATION_FAILED');
        const globallyExisting = await submit(app, owner, command(owner, 'staff.member.create', { email: foreign.email, displayName: 'Attempted takeover', role: 'cashier' })); rejected(globallyExisting, 'EMAIL_UNAVAILABLE');
        assert.equal((await members(app, foreign)).length, 1, 'foreign membership data must remain intact');
        assert.equal((await assignments(app, foreign))[0].assignedUserId, foreign.userId);
      } finally { await app.close(); }
    });

    await t.test('staff creation has no credential until a dedicated password operation and exact replay cannot duplicate the member', async () => {
      const { app, owner } = await setup();
      try {
        const email = `pending-${randomUUID()}@example.invalid`, create = command(owner, 'staff.member.create', { email, displayName: 'Pending cashier', role: 'cashier' });
        const first = await submit(app, owner, create); assert.equal(first.json().status, 'CONFIRMED', first.body);
        assert.deepEqual((await submit(app, owner, create)).json(), first.json());
        const target = (await members(app, owner)).find(person => person.email === email); assert.ok(target); assert.equal(target.hasCredential, false);
        assert.equal((await db.pool.query('SELECT password_hash FROM identity.users WHERE id=$1', [target.userId])).rows[0].password_hash, null);
        const before = target.version;
        const rename = await submit(app, owner, command(owner, 'staff.member.update', { userId: target.userId, displayName: 'Assigned cashier', role: 'cashier' }, { [`staff:${target.userId}`]: before })); assert.equal(rename.json().status, 'CONFIRMED');
        rejected(await submit(app, owner, command(owner, 'staff.member.update', { userId: target.userId, displayName: 'Stale name', role: 'cashier' }, { [`staff:${target.userId}`]: before })), 'VERSION_CONFLICT');
        assert.equal((await member(app, owner, target.userId)).displayName, 'Assigned cashier');
        const originalEmail = (await db.pool.query('SELECT email FROM identity.users WHERE id=$1', [target.userId])).rows[0].email;
        const malicious = await submit(app, owner, command(owner, 'staff.member.update', { userId: target.userId, displayName: 'Safe name', role: 'cashier', email: 'hijack@example.invalid' }, { [`staff:${target.userId}`]: before + 1 }));
        assert.notEqual(malicious.statusCode, 500); assert.equal((await db.pool.query('SELECT email FROM identity.users WHERE id=$1', [target.userId])).rows[0].email, originalEmail, 'membership updates cannot rewrite global identity email');
      } finally { await app.close(); }
    });

    await t.test('wrong passwords never enumerate logical assignments and a valid password can select only its own active assignment', async () => {
      const { app, owner } = await setup();
      try {
        const target = await makeActor(app, owner, 'cashier'), foreign = await makeActor(app, await makeTenant());
        const outletId = randomUUID(), alternateDevice = randomUUID();
        await db.pool.query('INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,$3,\'Africa/Nairobi\')', [outletId, owner.tenantId, 'Private secondary outlet']);
        await db.pool.query('INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,$5)', [alternateDevice, owner.tenantId, outletId, target.userId, 'Private secondary assignment']);
        const bad = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { email: target.email, password: 'wrong-password-only', deviceId: alternateDevice } });
        const missing = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { email: `missing-${randomUUID()}@example.invalid`, password: 'wrong-password-only' } });
        assert.equal(bad.statusCode, 401); assert.equal(missing.statusCode, 401); assert.deepEqual(bad.json(), missing.json());
        assert.doesNotMatch(bad.body, /Private secondary|assignments|tenantId|deviceId|outletId/);
        const choices = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { email: target.email, password: initialPassword } });
        assert.equal(choices.statusCode, 409); assert.equal(code(choices), 'ASSIGNMENT_REQUIRED');
        const options = choices.json().error.details.assignments; assert.equal(options.length, 2);
        assert.ok(options.every((option: { tenantId: string }) => option.tenantId === owner.tenantId));
        const selected = await authenticate(app, { ...target, deviceId: alternateDevice, outletId });
        assert.equal((await app.inject({ url: '/api/v1/auth/me', headers: selected.headers })).json().outlet.id, outletId);
        const rejectedForeign = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { email: target.email, password: initialPassword, deviceId: foreign.deviceId } }); assert.equal(rejectedForeign.statusCode, 401);
      } finally { await app.close(); }
    });

    await t.test('self access, open till, assignment boundaries and session revocation protect operational identity', async () => {
      const { app, owner } = await setup();
      try {
        const target = await makeActor(app, owner, 'cashier'), peer = await makeActor(app, owner, 'admin');
        const own = await member(app, owner, owner.userId);
        rejected(await submit(app, owner, command(owner, 'staff.member.update', { userId: owner.userId, displayName: own.displayName, role: 'cashier' }, { [`staff:${owner.userId}`]: own.version })), 'SELF_ACCESS_CHANGE_FORBIDDEN');
        rejected(await submit(app, owner, command(owner, 'staff.member.set_active', { userId: owner.userId, active: false, reason: 'Self guard acceptance' }, { [`staff:${owner.userId}`]: own.version })), 'SELF_ACCESS_CHANGE_FORBIDDEN');
        const ownAssignment = (await assignments(app, owner)).find(assignment => assignment.id === owner.deviceId)!;
        rejected(await submit(app, owner, command(owner, 'devices.assignment.revoke', { deviceId: owner.deviceId, reason: 'Self guard acceptance' }, { [`device:${owner.deviceId}`]: ownAssignment.version })), 'SELF_ACCESS_CHANGE_FORBIDDEN');
        rejected(await submit(app, owner, command(owner, 'devices.assignment.update', { deviceId: owner.deviceId, label: ownAssignment.label, assignedUserId: target.userId }, { [`device:${owner.deviceId}`]: ownAssignment.version })), 'SELF_ACCESS_CHANGE_FORBIDDEN');
        const opening = await submit(app, target, command(target, 'shift.open', { openingFloatMinor: 0 })); assert.equal(opening.json().status, 'CONFIRMED');
        const targetMember = await member(app, owner, target.userId), targetDevice = (await assignments(app, owner)).find(assignment => assignment.id === target.deviceId)!;
        for (const envelope of [
          command(owner, 'staff.member.set_active', { userId: target.userId, active: false, reason: 'Open till guard' }, { [`staff:${target.userId}`]: targetMember.version }),
          command(owner, 'staff.member.update', { userId: target.userId, displayName: targetMember.displayName, role: 'storekeeper' }, { [`staff:${target.userId}`]: targetMember.version }),
          command(owner, 'devices.assignment.revoke', { deviceId: target.deviceId, reason: 'Open till guard' }, { [`device:${target.deviceId}`]: targetDevice.version }),
          command(owner, 'devices.assignment.update', { deviceId: target.deviceId, label: targetDevice.label, assignedUserId: peer.userId }, { [`device:${target.deviceId}`]: targetDevice.version }),
        ]) rejected(await submit(app, owner, envelope), 'OPEN_SHIFT_CONFLICT');
        const targetSessions = await sessions(app, owner, target.userId), currentTarget = targetSessions.sessions.find(session => session.current) ?? targetSessions.sessions.find(session => !session.revokedAt)!;
        const foreignSessionAttempt = await submit(app, target, command(target, 'auth.session.revoke', { sessionId: (await sessions(app, owner)).sessions.find(session => session.current)!.id, reason: 'Foreign owner session' }, { [`session:${(await sessions(app, owner)).sessions.find(session => session.current)!.id}`]: 1 })); rejected(foreignSessionAttempt, 'NOT_FOUND');
        const revoke = command(owner, 'staff.sessions.revoke', { userId: target.userId, sessionId: currentTarget.id, reason: 'Revoke lost session' }, { [`session:${currentTarget.id}`]: currentTarget.version });
        const result = await submit(app, owner, revoke); assert.equal(result.json().status, 'CONFIRMED', result.body); assert.deepEqual((await submit(app, owner, revoke)).json(), result.json());
        assert.equal((await app.inject({ url: '/api/v1/auth/me', headers: target.headers })).statusCode, 401);
        const ownSessions = await sessions(app, owner), active = ownSessions.sessions.find(session => session.current)!;
        const ownRevoke = await submit(app, owner, command(owner, 'auth.session.revoke', { sessionId: active.id, reason: 'Own sign out session' }, { [`session:${active.id}`]: active.version })); assert.equal(ownRevoke.json().status, 'CONFIRMED');
        assert.equal((await app.inject({ url: '/api/v1/auth/me', headers: owner.headers })).statusCode, 401);
      } finally { await app.close(); }
    });

    await t.test('parallel administrator removals or assignment transfers cannot strand the business', async () => {
      for (const kind of ['membership', 'assignment']) {
        const { app, owner } = await setup();
        try {
          const peer = await makeActor(app, owner, 'admin'), cashier = await makeActor(app, owner, 'cashier');
          const prepare = async (actor: Actor, target: Actor) => {
            if (kind === 'membership') {
              const current = await member(app, actor, target.userId);
              return { actor, envelope: command(actor, 'staff.member.set_active', { userId: target.userId, active: false, reason: 'Last administrator race' }, { [`staff:${target.userId}`]: current.version }) };
            }
            const targetAssignment = (await assignments(app, actor)).find(assignment => assignment.id === target.deviceId)!;
            return { actor, envelope: command(actor, 'devices.assignment.update', { deviceId: target.deviceId, label: targetAssignment.label, assignedUserId: cashier.userId }, { [`device:${target.deviceId}`]: targetAssignment.version }) };
          };
          // Read both versions before either command can revoke the other actor's session.
          const prepared = await Promise.all([prepare(owner, peer), prepare(peer, owner)]);
          const outcomes = await Promise.all(prepared.map(({ actor, envelope }) => submit(app, actor, envelope)));
          assert.equal(outcomes.filter(result => result.json().status === 'CONFIRMED').length, 1, outcomes.map(result => result.body).join('\n'));
          assert.ok(outcomes.every(result => result.statusCode !== 500));
          const usable = await db.pool.query(`SELECT count(DISTINCT m.user_id)::int count FROM identity.memberships m JOIN identity.users u ON u.id=m.user_id
            JOIN identity.devices d ON d.tenant_id=m.tenant_id AND d.assigned_user_id=m.user_id JOIN core.outlets o ON o.id=d.outlet_id AND o.tenant_id=d.tenant_id
            WHERE m.tenant_id=$1 AND m.active AND m.role IN ('owner','admin') AND u.active AND u.password_hash IS NOT NULL AND d.active AND o.active`, [owner.tenantId]);
          assert.equal(usable.rows[0].count, 1);
        } finally { await app.close(); }
      }
    });

    await t.test('shared global identity credentials stay protected while display names and activation remain tenant local', async () => {
      const { app, owner } = await setup();
      try {
        const shared = await makeActor(app, owner, 'cashier'), foreignContext = await makeTenant();
        const sharedElsewhere = await makeActor(app, foreignContext, 'cashier', { userId: shared.userId, shared: true, globalName: shared.globalName });
        const original = await member(app, owner, shared.userId), elsewhereOwner = await makeActor(app, foreignContext, 'admin');
        const originalGlobal = (await db.pool.query('SELECT email,full_name,password_hash FROM identity.users WHERE id=$1', [shared.userId])).rows[0];
        for (const active of [true, false]) {
          await db.pool.query('UPDATE identity.memberships SET active=$3 WHERE tenant_id=$1 AND user_id=$2', [foreignContext.tenantId, shared.userId, active]);
          rejected(await reset(app, owner, shared.userId, credentialInput(shared.userId, original.credentialVersion, `Shared-reset-${randomUUID()}`)), 'CREDENTIAL_SCOPE_RESTRICTED');
          assert.deepEqual((await db.pool.query('SELECT email,full_name,password_hash FROM identity.users WHERE id=$1', [shared.userId])).rows[0], originalGlobal);
        }
        await db.pool.query('UPDATE identity.memberships SET active=true WHERE tenant_id=$1 AND user_id=$2', [foreignContext.tenantId, shared.userId]);
        const renamed = await submit(app, owner, command(owner, 'staff.member.update', { userId: shared.userId, displayName: 'Local-only display name', role: 'cashier' }, { [`staff:${shared.userId}`]: original.version })); assert.equal(renamed.json().status, 'CONFIRMED');
        assert.equal((await member(app, owner, shared.userId)).displayName, 'Local-only display name');
        assert.notEqual((await member(app, elsewhereOwner, shared.userId)).displayName, 'Local-only display name');
        const current = await member(app, owner, shared.userId);
        assert.equal((await submit(app, owner, command(owner, 'staff.member.set_active', { userId: shared.userId, active: false, reason: 'Membership-only revocation' }, { [`staff:${shared.userId}`]: current.version }))).json().status, 'CONFIRMED');
        assert.equal((await app.inject({ url: '/api/v1/auth/me', headers: shared.headers })).statusCode, 401);
        assert.equal((await app.inject({ url: '/api/v1/auth/me', headers: sharedElsewhere.headers })).statusCode, 200, 'another tenant membership/session must survive');
        assert.equal((await db.pool.query('SELECT active FROM identity.users WHERE id=$1', [shared.userId])).rows[0].active, true);
      } finally { await app.close(); }
    });

    await t.test('credential versions, exact secret replay, fresh permissions, Scrypt and sanitized logs preserve password privacy', async () => {
      const { app, owner, logs } = await setup();
      try {
        const target = await makeActor(app, owner, 'cashier'), targetVersion = (await member(app, owner, target.userId)).credentialVersion;
        const newPassword = ` Secret-$-&-${randomUUID()} `, input = credentialInput(target.userId, targetVersion, newPassword);
        const first = await reset(app, owner, target.userId, input); assert.equal(first.json().status, 'CONFIRMED', first.body); assert.equal(first.json().value.credentialVersion, targetVersion + 1);
        assert.deepEqual((await reset(app, owner, target.userId, input)).json(), first.json(), 'exact secret replay returns the canonical stored result');
        rejected(await reset(app, owner, target.userId, { ...input, newPassword: newPassword.trim() }), 'IDEMPOTENCY_MISMATCH');
        rejected(await reset(app, owner, target.userId, credentialInput(target.userId, targetVersion, `Stale-${randomUUID()}`)), 'VERSION_CONFLICT');
        assert.equal((await app.inject({ url: '/api/v1/auth/me', headers: target.headers })).statusCode, 401);
        const stored = (await db.pool.query('SELECT password_hash,credential_version FROM identity.users WHERE id=$1', [target.userId])).rows[0];
        assert.match(stored.password_hash, /^scrypt\$/); assert.ok(await security.verifyPassword(newPassword, stored.password_hash)); assert.equal(await security.verifyPassword(initialPassword, stored.password_hash), false);
        const signedIn = await authenticate(app, target, newPassword), ownVersion = (await sessions(app, signedIn)).credentialVersion;
        rejected(await reset(app, signedIn, target.userId, credentialInput(target.userId, ownVersion, `Wrong-route-${randomUUID()}`)), 'USE_SELF_PASSWORD_CHANGE');
        rejected(await changePassword(app, signedIn, credentialInput(target.userId, ownVersion, `Unchanged-${randomUUID()}`, 'incorrect-current-password')), 'INVALID_CURRENT_PASSWORD');
        const selfSecret = `Self-$-&-${randomUUID()}`, selfInput = credentialInput(target.userId, ownVersion, selfSecret, newPassword);
        const selfChange = await changePassword(app, signedIn, selfInput); assert.equal(selfChange.json().status, 'CONFIRMED', selfChange.body);
        assert.equal((await app.inject({ url: '/api/v1/auth/me', headers: signedIn.headers })).statusCode, 401);
        const restored = await authenticate(app, target, selfSecret);
        assert.deepEqual((await changePassword(app, restored, selfInput)).json(), selfChange.json(), 'a new authenticated session can recover an exact self-change without the obsolete current password');
        const status = await app.inject({ url: `/api/v1/commands/${selfInput.commandId}`, headers: restored.headers }); assert.equal(status.statusCode, 200); assert.deepEqual(status.json().response, { status: 'CONFIRMED', value: selfChange.json().value });
        assert.equal((await app.inject({ url: `/api/v1/commands/${input.commandId}`, headers: restored.headers })).statusCode, 404, 'sensitive command status belongs to its actor');
        const serialized = JSON.stringify((await db.pool.query(`SELECT
          (SELECT jsonb_agg(response) FROM system.commands WHERE tenant_id=$1) commands,
          (SELECT jsonb_agg(payload) FROM system.audit_events WHERE tenant_id=$1) audit,
          (SELECT jsonb_agg(payload) FROM system.transactional_outbox WHERE tenant_id=$1) outbox`, [owner.tenantId])).rows[0]);
        const responses = first.body + selfChange.body + status.body;
        await new Promise(resolve => setImmediate(resolve));
        for (const secret of [initialPassword, newPassword, selfSecret, stored.password_hash, owner.headers.cookie, owner.headers['x-csrf-token'], process.env.CREDENTIAL_FINGERPRINT_KEY!]) {
          assert.ok(!serialized.includes(secret), 'stored command/audit/outbox metadata must not contain secrets');
          assert.ok(!responses.includes(secret), 'credential/status replies must not contain secrets');
          assert.ok(!logs.join('').includes(secret), 'actual structured request logs must not contain passwords, cookies, tokens or hashes');
        }
        assert.doesNotMatch(serialized, /"(?:newPassword|currentPassword|password_hash)"/);
        const fingerprint = await db.pool.query('SELECT encode(request_hash,\'hex\') fingerprint FROM system.commands WHERE tenant_id=$1 AND command_id=$2', [owner.tenantId, input.commandId]); assert.match(fingerprint.rows[0].fingerprint, /^[a-f0-9]{64}$/);
        await db.pool.query('UPDATE identity.memberships SET role=\'manager\' WHERE tenant_id=$1 AND user_id=$2', [owner.tenantId, owner.userId]);
        rejected(await reset(app, owner, target.userId, input), 'FORBIDDEN');
        assert.equal((await app.inject({ url: `/api/v1/commands/${input.commandId}`, headers: owner.headers })).statusCode, 403, 'stored credential outcomes cannot bypass revoked reset authority');
      } finally { await app.close(); }
    });
  });
}
