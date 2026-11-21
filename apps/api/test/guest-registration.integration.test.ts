import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { ApiRole, CommandEnvelope } from '../src/contracts.js';
import type { GuestRegistrationInput, GuestRegistrationSave, GuestRegistrationView } from '../src/guestRegistrationTypes.js';
import {
  createGuestRegistration, guestCommand, guestDetails, guestOperation, readGuestRegistration,
  reviewGuestPolicy, submitGuestPrivateSave, type GuestTestActor,
} from './support/guest-registration-fixture.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  test('guest registration HTTP security, recovery and arrival acceptance', { skip: 'Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database.' }, () => {});
} else {
  process.env.DATABASE_URL = databaseUrl;
  process.env.APP_ORIGINS ??= 'http://localhost:3000';
  process.env.CREDENTIAL_FINGERPRINT_KEY ??= 'c'.repeat(64);
  process.env.TRUSTED_PROXY_IPS ??= '127.0.0.1,::1,::ffff:127.0.0.1';
  process.env.GUEST_IDENTITY_KEYS = JSON.stringify({ v1: '1'.repeat(64) });
  process.env.GUEST_IDENTITY_ACTIVE_KEY = 'v1';
  const [{ buildApp }, { hashPassword }, db] = await Promise.all([import('../src/app.js'), import('../src/security.js'), import('../src/db.js')]);
  const origin = process.env.APP_ORIGINS.split(',')[0];
  const password = `Disposable-registration-${randomUUID()}`;
  const passwordHash = await hashPassword(password);
  interface Scope { tenantId: string; outletId: string }
  let loginNumber = 0;

  async function scope(tenantId: string = randomUUID()): Promise<Scope> {
    await db.pool.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Disposable guest business','KES','Africa/Nairobi') ON CONFLICT DO NOTHING", [tenantId]);
    const outletId = randomUUID();
    await db.pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Guest outlet','Africa/Nairobi')", [outletId, tenantId]);
    for (const capability of ['hospitality', 'commerce', 'inventory']) {
      await db.pool.query('INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,$2) ON CONFLICT DO NOTHING', [tenantId, capability]);
    }
    return { tenantId, outletId };
  }

  async function actor(app: FastifyInstance, context: Scope, role: ApiRole = 'admin'): Promise<GuestTestActor> {
    const userId = randomUUID(), deviceId = randomUUID(), email = `guest-${userId}@example.invalid`;
    await db.pool.query("INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,'Guest operator')", [userId, email, passwordHash]);
    await db.pool.query('INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [context.tenantId, userId, role]);
    await db.pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Disposable guest assignment')", [deviceId, context.tenantId, context.outletId, userId]);
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin, 'x-forwarded-for': `198.51.100.${++loginNumber}` }, payload: { email, password, deviceId } });
    assert.equal(login.statusCode, 200, login.body);
    const cookies = login.headers['set-cookie'];
    const cookie = (Array.isArray(cookies) ? cookies : [cookies]).filter((value): value is string => typeof value === 'string').map(value => value.split(';', 1)[0]).join('; ');
    return { ...context, userId, deviceId, headers: { cookie, origin, 'x-csrf-token': login.json().csrfToken } };
  }

  async function fixture(t: TestContext, reviewed = true) {
    const app = buildApp({ logger: { level: 'silent' } });
    await app.ready(); t.after(() => app.close());
    const owner = await actor(app, await scope());
    if (reviewed) await reviewGuestPolicy(app, owner);
    const dates = (await db.pool.query("SELECT to_char(now() AT TIME ZONE 'Africa/Nairobi','YYYY-MM-DD') today,to_char((now() AT TIME ZONE 'Africa/Nairobi')::date+1,'YYYY-MM-DD') tomorrow,to_char((now() AT TIME ZONE 'Africa/Nairobi')::date+2,'YYYY-MM-DD') later")).rows[0];
    return { app, owner, dates };
  }

  const submit = (app: FastifyInstance, owner: GuestTestActor, command: CommandEnvelope) => app.inject({ method: 'POST', url: '/api/v1/commands', headers: owner.headers, payload: command });
  const reconcile = (app: FastifyInstance, owner: GuestTestActor, input: object) => app.inject({ method: 'POST', url: '/api/v1/hospitality/registrations/reconcile', headers: owner.headers, payload: input });
  async function confirmed(app: FastifyInstance, owner: GuestTestActor, command: CommandEnvelope) {
    const response = await submit(app, owner, command);
    assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().status, 'CONFIRMED', response.body);
    return response.json().value;
  }
  const outcomeCode = (response: { body: string; json(): any }) => response.json().code ?? response.json().error?.code;
  const denied = (response: { statusCode: number; body: string; json(): any }, status: number, code?: string) => {
    assert.equal(response.statusCode, status, response.body);
    if (code) assert.equal(outcomeCode(response), code, response.body);
  };
  async function room(app: FastifyInstance, owner: GuestTestActor) {
    return confirmed(app, owner, guestCommand(owner, 'hotel.room.create', { roomNumber: randomUUID().slice(0, 8), roomType: 'Standard', nightlyRateMinor: 10000, taxRateBps: 0 }));
  }
  async function roomVersion(app: FastifyInstance, owner: GuestTestActor, id: string) {
    const response = await app.inject({ url: '/api/v1/hospitality/rooms', headers: owner.headers });
    assert.equal(response.statusCode, 200, response.body);
    return response.json().rooms.find((item: any) => item.id === id).version as number;
  }
  async function reservationVersion(app: FastifyInstance, owner: GuestTestActor, id: string) {
    const response = await app.inject({ url: '/api/v1/hospitality/reservations', headers: owner.headers });
    assert.equal(response.statusCode, 200, response.body);
    return response.json().reservations.find((item: any) => item.id === id).version as number;
  }
  async function checkinCommand(app: FastifyInstance, owner: GuestTestActor, roomId: string, registrationId: string, dates: { today: string; tomorrow: string }, reservationId?: string) {
    const registration = await readGuestRegistration(app, owner, registrationId);
    return guestCommand(owner, 'hotel.checkin', { roomId, registrationId, checkInDate: dates.today, checkOutDate: dates.tomorrow, ...(reservationId ? { reservationId } : {}) }, {
      [`room:${roomId}`]: await roomVersion(app, owner, roomId), [`registration:${registrationId}`]: registration.version,
      ...(reservationId ? { [`reservation:${reservationId}`]: await reservationVersion(app, owner, reservationId) } : {}),
    });
  }
  async function effects(owner: GuestTestActor) {
    return (await db.pool.query(`SELECT
      (SELECT count(*)::int FROM hospitality.stays WHERE tenant_id=$1 AND outlet_id=$2) stays,
      (SELECT count(*)::int FROM hospitality.folios WHERE tenant_id=$1 AND outlet_id=$2) folios,
      (SELECT count(*)::int FROM hospitality.folio_entries WHERE tenant_id=$1 AND outlet_id=$2) folio_entries,
      (SELECT count(*)::int FROM finance.journal_entries WHERE tenant_id=$1) journals,
      (SELECT count(*)::int FROM inventory.movements WHERE tenant_id=$1 AND outlet_id=$2) movements`, [owner.tenantId, owner.outletId])).rows[0];
  }
  function fromView(view: GuestRegistrationView): GuestRegistrationInput {
    return { adultCount: view.adultCount, childCount: view.childCount, booker: view.booker, emergencyContact: view.emergencyContact, occupants: view.occupants.map(({ identity, ...occupant }) => ({ ...occupant, identity: { action: identity.maskedNumber ? 'KEEP' : 'REMOVE', verified: identity.verified } })) };
  }
  async function storedIdentity(owner: GuestTestActor, registrationId: string, occupantId: string) {
    return (await db.pool.query('SELECT document_ciphertext,document_key_version,document_suffix,verified_by,verified_at FROM hospitality.guest_registration_occupants WHERE tenant_id=$1 AND outlet_id=$2 AND registration_id=$3 AND id=$4', [owner.tenantId, owner.outletId, registrationId, occupantId])).rows[0];
  }
  async function assertNoIdentityLeak(owner: GuestTestActor, values: string[]) {
    const evidence = await db.pool.query(`SELECT jsonb_build_object(
      'commands',(SELECT jsonb_agg(to_jsonb(t)) FROM system.commands t WHERE tenant_id=$1),
      'audit',(SELECT jsonb_agg(to_jsonb(t)) FROM system.audit_events t WHERE tenant_id=$1),
      'outbox',(SELECT jsonb_agg(to_jsonb(t)) FROM system.transactional_outbox t WHERE tenant_id=$1),
      'occupants',(SELECT jsonb_agg(to_jsonb(t)) FROM hospitality.guest_registration_occupants t WHERE tenant_id=$1),
      'revisions',(SELECT jsonb_agg(to_jsonb(t)) FROM hospitality.guest_registration_revisions t WHERE tenant_id=$1)
    ) evidence`, [owner.tenantId]);
    const encoded = JSON.stringify(evidence.rows[0].evidence);
    for (const value of values) assert.equal(encoded.includes(value), false, 'Full identity must not appear in stored cleartext, command outcomes, audit or outbox.');
  }

  test('guest registration enforces every adult identity while preserving recovery and accounting', { timeout: 180_000 }, async t => {
    t.after(() => db.pool.end());

    await t.test('draft booking is separate from occupancy; two adults need two verified documents', async t => {
      const { app, owner, dates } = await fixture(t);
      const createdRoom = await room(app, owner);
      const details = guestDetails(2, 1);
      details.occupants[1].identity = { action: 'REMOVE', verified: false };
      const baseline = await effects(owner);
      const staged = await createGuestRegistration(app, owner, details);
      assert.deepEqual(await effects(owner), baseline, 'Private draft does not create occupancy, folio, stock or journal evidence.');
      const booking = await confirmed(app, owner, guestCommand(owner, 'hotel.reservation.create', { roomId: createdRoom.roomId, registrationId: staged.registration.id, checkInDate: dates.today, checkOutDate: dates.tomorrow }, { [`room:${createdRoom.roomId}`]: 1, [`registration:${staged.registration.id}`]: staged.registration.version }));
      assert.deepEqual(await effects(owner), baseline, 'Reservation is distinct from actual check-in.');
      const incomplete = await submit(app, owner, await checkinCommand(app, owner, createdRoom.roomId, staged.registration.id, dates, booking.reservationId));
      assert.equal(incomplete.json().status, 'REJECTED', incomplete.body);
      assert.equal(outcomeCode(incomplete), 'GUEST_REGISTRATION_INCOMPLETE', incomplete.body);
      assert.deepEqual(await effects(owner), baseline);
      const beforeArrival = await readGuestRegistration(app, owner, staged.registration.id);
      const completedDetails = fromView(beforeArrival);
      completedDetails.occupants[1].identity = { action: 'REPLACE', documentType: 'PASSPORT', number: '000P2345678', issuingCountry: 'UG', verified: true };
      const save = await submitGuestPrivateSave(app, owner, { ...guestOperation(owner, beforeArrival.id, beforeArrival.version), reservationId: booking.reservationId, expectedReservationVersion: await reservationVersion(app, owner, booking.reservationId), details: completedDetails });
      assert.equal(save.json().status, 'CONFIRMED', save.body);
      const arrival = await checkinCommand(app, owner, createdRoom.roomId, staged.registration.id, dates, booking.reservationId);
      const accepted = await submit(app, owner, arrival);
      assert.equal(accepted.json().status, 'CONFIRMED', accepted.body);
      assert.deepEqual((await submit(app, owner, arrival)).json(), accepted.json(), 'Lost check-in response replays the original exact result.');
      const checkedIn = await readGuestRegistration(app, owner, staged.registration.id);
      assert.equal(checkedIn.status, 'FINAL'); assert.equal(checkedIn.stayId, accepted.json().value.stayId);
      assert.equal(checkedIn.occupants.filter(person => person.kind === 'ADULT' && person.identity.verified).length, 2);
      assert.equal(checkedIn.occupants.find(person => person.kind === 'CHILD')!.guardianId, checkedIn.occupants.find(person => person.primary)!.id);
      assert.deepEqual(await effects(owner), { ...baseline, stays: 1, folios: 1 }, 'Exactly one stay and folio; arrival creates no charges or financial/stock entries.');
      const reuse = await confirmed(app, owner, guestCommand(owner, 'hotel.room.create', { roomNumber: 'OTHER', roomType: 'Standard', nightlyRateMinor: 10000, taxRateBps: 0 }));
      const cannotReuse = await submit(app, owner, await checkinCommand(app, owner, reuse.roomId, staged.registration.id, dates));
      assert.notEqual(cannotReuse.json().status, 'CONFIRMED', cannotReuse.body);
      await assertNoIdentityLeak(owner, ['0012345670', '000P2345678']);
    });

    await t.test('identity is encrypted, masked and preserved through KEEP; reveal and corrections are audited', async t => {
      const { app, owner, dates } = await fixture(t);
      const staged = await createGuestRegistration(app, owner);
      const occupantId = staged.registration.occupants[0].id;
      const privateBefore = await storedIdentity(owner, staged.registration.id, occupantId);
      assert.equal(privateBefore.document_key_version, 'v1');
      assert.equal(privateBefore.document_suffix, '5670');
      assert.ok(privateBefore.document_ciphertext.length > 30);
      assert.equal(privateBefore.document_ciphertext.includes('0012345670'), false);
      assert.equal(staged.registration.occupants[0].identity.maskedNumber?.endsWith('5670'), true);
      assert.equal(JSON.stringify(staged.registration).includes('0012345670'), false);
      const details = fromView(staged.registration); details.booker.company = 'Separate booking company';
      const kept = await submitGuestPrivateSave(app, owner, { ...guestOperation(owner, staged.registration.id, staged.registration.version), details });
      assert.equal(kept.json().status, 'CONFIRMED', kept.body);
      assert.deepEqual(await storedIdentity(owner, staged.registration.id, occupantId), privateBefore, 'KEEP retains the actual encrypted number and verification evidence.');
      const reveal = await app.inject({ method: 'POST', url: `/api/v1/hospitality/registrations/${staged.registration.id}/reveal`, headers: owner.headers, payload: { occupantId, reason: 'VERIFY_DOCUMENT' } });
      assert.equal(reveal.statusCode, 200, reveal.body); assert.equal(reveal.json().number, '0012345670');
      assert.match(String(reveal.headers['cache-control']), /no-store/);
      denied(await app.inject({ method: 'POST', url: `/api/v1/hospitality/registrations/${staged.registration.id}/reveal`, headers: owner.headers, payload: { occupantId, reason: 'An uncontrolled free-text purpose' } }), 400, 'VALIDATION_FAILED');
      const revealAudit = await db.pool.query("SELECT payload FROM system.audit_events WHERE tenant_id=$1 AND event_type='hotel.registration.identity.revealed' AND payload->>'registrationId'=$2", [owner.tenantId, staged.registration.id]);
      assert.equal(revealAudit.rowCount, 1);
      assert.equal(revealAudit.rows[0].payload.purposeCode, 'VERIFY_DOCUMENT');
      assert.equal(JSON.stringify(revealAudit.rows[0].payload).includes('0012345670'), false);
      const createdRoom = await room(app, owner);
      await confirmed(app, owner, await checkinCommand(app, owner, createdRoom.roomId, staged.registration.id, dates));
      const finalized = await readGuestRegistration(app, owner, staged.registration.id);
      const correctedDetails = fromView(finalized); correctedDetails.occupants[0].fullName = 'Corrected Legal Guest';
      const baseline = await effects(owner);
      const ordinaryEdit = await submitGuestPrivateSave(app, owner, { ...guestOperation(owner, finalized.id, finalized.version), details: correctedDetails });
      assert.notEqual(ordinaryEdit.json().status, 'CONFIRMED', ordinaryEdit.body);
      const correction = { ...guestOperation(owner, finalized.id, finalized.version, 'hotel.registration.correct'), details: correctedDetails, reason: 'Correct spelling from the document sighted at arrival' };
      const corrected = await submitGuestPrivateSave(app, owner, correction);
      assert.equal(corrected.json().status, 'CONFIRMED', corrected.body);
      assert.deepEqual(await effects(owner), baseline, 'Guest correction creates no charges, stock or journals.');
      const current = await readGuestRegistration(app, owner, finalized.id);
      assert.equal(current.occupants[0].fullName, 'Corrected Legal Guest');
      const snapshots = await db.pool.query('SELECT version,private_snapshot FROM hospitality.guest_registration_revisions WHERE tenant_id=$1 AND registration_id=$2 ORDER BY version', [owner.tenantId, finalized.id]);
      assert.ok(snapshots.rowCount! >= 3);
      assert.equal(JSON.stringify(snapshots.rows.slice(0, -1)).includes('Corrected Legal Guest'), false, 'Earlier private snapshots do not change after correction.');
      await assertNoIdentityLeak(owner, ['0012345670']);
    });

    await t.test('private operation replay and metadata fence retain original identity without resubmitting secrets', async t => {
      const { app, owner } = await fixture(t);
      const staged = await createGuestRegistration(app, owner);
      assert.deepEqual((await submitGuestPrivateSave(app, owner, staged.input)).json(), staged.response);
      const recovered = await reconcile(app, owner, guestOperationMetadata(staged.input));
      assert.equal(recovered.statusCode, 200, recovered.body);
      assert.deepEqual(recovered.json().response, { status: staged.response.status, value: staged.response.value });
      const changed = structuredClone(staged.input); changed.details.occupants[0].identity.number = '0099999999';
      denied(await submitGuestPrivateSave(app, owner, changed), 409, 'IDEMPOTENCY_MISMATCH');
      const missing = guestOperation(owner);
      const fenced = await reconcile(app, owner, missing);
      assert.equal(fenced.statusCode, 200, fenced.body);
      assert.equal(fenced.json().response.code, 'GUEST_REGISTRATION_OPERATION_FENCED', fenced.body);
      assert.deepEqual((await reconcile(app, owner, missing)).json(), fenced.json());
      const late = await submitGuestPrivateSave(app, owner, { ...missing, details: guestDetails() });
      assert.equal(late.json().code, 'GUEST_REGISTRATION_OPERATION_FENCED', late.body);
      assert.equal((await db.pool.query('SELECT count(*)::int n FROM hospitality.guest_registrations WHERE id=$1', [missing.registrationId])).rows[0].n, 0);
      const status = await app.inject({ url: `/api/v1/commands/${missing.commandId}`, headers: owner.headers });
      assert.equal(status.statusCode, 200, status.body); assert.equal(status.json().response.code, 'GUEST_REGISTRATION_OPERATION_FENCED');
      denied(await reconcile(app, owner, { ...missing, expectedVersion: 1 }), 409, 'IDEMPOTENCY_MISMATCH');
      for (const payload of [{ ...missing, number: '0012345670' }, { ...missing, details: guestDetails() }, { ...missing, kind: 'hotel.checkin' }]) {
        denied(await reconcile(app, owner, payload), 400, 'VALIDATION_FAILED');
      }
      const racing = guestOperation(owner);
      const [racingSave, racingRecovery] = await Promise.all([
        submitGuestPrivateSave(app, owner, { ...racing, details: guestDetails() }),
        reconcile(app, owner, racing),
      ]);
      assert.equal(racingSave.statusCode, 200, racingSave.body);
      assert.equal(racingRecovery.statusCode, 200, racingRecovery.body);
      const { commandId: _commandId, ...saveOutcome } = racingSave.json();
      assert.deepEqual(saveOutcome, racingRecovery.json().response, 'Concurrent save and fence must agree on the single canonical outcome.');
      assert.ok(['CONFIRMED', 'REJECTED'].includes(saveOutcome.status));
      if (saveOutcome.status === 'REJECTED') assert.equal(saveOutcome.code, 'GUEST_REGISTRATION_OPERATION_FENCED');
      const racingCount = (await db.pool.query('SELECT count(*)::int n FROM hospitality.guest_registrations WHERE id=$1', [racing.registrationId])).rows[0].n;
      assert.equal(racingCount, saveOutcome.status === 'CONFIRMED' ? 1 : 0);
      assert.equal((await db.pool.query('SELECT count(*)::int n FROM system.commands WHERE tenant_id=$1 AND command_id=$2', [owner.tenantId, racing.commandId])).rows[0].n, 1);
      await assertNoIdentityLeak(owner, ['0012345670', '0099999999']);
    });

    await t.test('short document identifiers stay entirely masked and invalid countries, future DOB and masked replacements are rejected', async t => {
      const { app, owner } = await fixture(t);
      for (const number of ['7', '07', '007', '0007']) {
        const details = guestDetails();
        details.occupants[0].identity = { action: 'REPLACE', documentType: 'OTHER', number, issuingCountry: 'KE', verified: true };
        const staged = await createGuestRegistration(app, owner, details);
        const masked = staged.registration.occupants[0].identity.maskedNumber;
        assert.ok(masked, 'A stored short identity still has a masked presence indicator.');
        assert.equal(masked.includes(number), false, 'Displaying a suffix must not expose an entire short document number.');
        const stored = await storedIdentity(owner, staged.registration.id, staged.registration.occupants[0].id);
        assert.notEqual(stored.document_suffix, number, 'Short identity is not retained in full as a cleartext display suffix.');
      }
      const invalidCases: Array<{ details: GuestRegistrationInput; privateValue: string }> = [];
      const unknownNationality = guestDetails(); unknownNationality.occupants[0].nationality = 'ZZ'; invalidCases.push({ details: unknownNationality, privateValue: 'ZZ' });
      const unknownResidence = guestDetails(); unknownResidence.occupants[0].residenceCountry = 'AB'; invalidCases.push({ details: unknownResidence, privateValue: 'AB' });
      const unknownIssuer = guestDetails(); unknownIssuer.occupants[0].identity.issuingCountry = 'ZZ'; invalidCases.push({ details: unknownIssuer, privateValue: 'ZZ' });
      const futureBirth = guestDetails(); futureBirth.occupants[0].dateOfBirth = '2999-01-01'; invalidCases.push({ details: futureBirth, privateValue: '2999-01-01' });
      const staged = await createGuestRegistration(app, owner);
      const maskedReplacement = fromView(staged.registration);
      const displayedMask = staged.registration.occupants[0].identity.maskedNumber!;
      maskedReplacement.occupants[0].identity = { action: 'REPLACE', documentType: 'NATIONAL_ID', number: displayedMask, issuingCountry: 'KE', verified: true };
      invalidCases.push({ details: maskedReplacement, privateValue: displayedMask });
      const baseline = await effects(owner);
      for (const item of invalidCases) {
        const response = await submitGuestPrivateSave(app, owner, { ...guestOperation(owner), details: item.details });
        assert.notEqual(response.json().status, 'CONFIRMED', response.body);
        assert.equal(outcomeCode(response), 'VALIDATION_FAILED', response.body);
        const message = response.json().message ?? response.json().error?.message;
        assert.equal(String(message).includes(item.privateValue), false, 'Validation explains the field without echoing the submitted private value.');
      }
      assert.deepEqual(await effects(owner), baseline);
    });

    await t.test('tenant, outlet, operator and role authority also protect private status and reveal', async t => {
      const { app, owner } = await fixture(t);
      const staged = await createGuestRegistration(app, owner);
      const receptionist = await actor(app, owner, 'receptionist');
      const housekeeper = await actor(app, owner, 'housekeeper');
      const accountant = await actor(app, owner, 'accountant');
      const foreign = await actor(app, await scope());
      const otherOutlet = await actor(app, await scope(owner.tenantId));
      const path = `/api/v1/hospitality/registrations/${staged.registration.id}`;
      denied(await app.inject({ url: path, headers: foreign.headers }), 404);
      denied(await app.inject({ url: path, headers: otherOutlet.headers }), 404);
      denied(await app.inject({ url: path, headers: housekeeper.headers }), 403);
      denied(await app.inject({ url: path, headers: accountant.headers }), 403);
      const deskView = await app.inject({ url: path, headers: receptionist.headers });
      assert.equal(deskView.statusCode, 200, deskView.body); assert.equal(deskView.body.includes('0012345670'), false);
      denied(await app.inject({ method: 'POST', url: path + '/reveal', headers: receptionist.headers, payload: { occupantId: staged.registration.occupants[0].id, reason: 'VERIFY_DOCUMENT' } }), 403);
      denied(await reconcile(app, receptionist, guestOperationMetadata(staged.input)), 404);
      denied(await reconcile(app, otherOutlet, guestOperationMetadata(staged.input)), 404);
      const foreignSave = await submitGuestPrivateSave(app, foreign, { ...guestOperation(foreign, staged.registration.id, staged.registration.version), details: guestDetails() });
      assert.equal(foreignSave.statusCode, 200, foreignSave.body);
      assert.equal(foreignSave.json().status, 'REJECTED', foreignSave.body);
      assert.equal(outcomeCode(foreignSave), 'NOT_FOUND', foreignSave.body);
      assert.equal((await readGuestRegistration(app, owner, staged.registration.id)).version, staged.registration.version, 'Foreign private operation cannot mutate the scoped registration.');
      const noCsrf = { ...owner.headers }; delete noCsrf['x-csrf-token'];
      denied(await app.inject({ method: 'POST', url: '/api/v1/hospitality/registrations/save', headers: noCsrf, payload: { ...guestOperation(owner), details: guestDetails() } }), 403);
      const next = { ...guestOperation(owner), details: guestDetails() };
      await db.pool.query('UPDATE identity.devices SET active=false WHERE tenant_id=$1 AND id=$2', [owner.tenantId, owner.deviceId]);
      const revoked = await submitGuestPrivateSave(app, owner, next);
      assert.ok([401, 403].includes(revoked.statusCode), revoked.body);
      assert.equal((await db.pool.query('SELECT count(*)::int n FROM hospitality.guest_registrations WHERE id=$1', [next.registrationId])).rows[0].n, 0);
    });

    await t.test('captured private scope rejects cross-context raw input before ledger writes and replacement assignments can recover metadata only', async t => {
      const { app, owner } = await fixture(t);
      const foreign = await actor(app, await scope());
      for (const field of ['tenantId', 'actorId', 'outletId', 'deviceId'] as const) {
        const input = { ...guestOperation(owner), details: guestDetails() };
        input.scope = { ...input.scope, [field]: randomUUID() };
        denied(await submitGuestPrivateSave(app, owner, input), 403, 'FORBIDDEN');
        assert.equal((await db.pool.query('SELECT count(*)::int n FROM system.commands WHERE tenant_id=$1 AND command_id=$2', [owner.tenantId, input.commandId])).rows[0].n, 0, 'Mismatched captured context must be rejected before a command or private registration is retained.');
      }
      const original = guestOperation(owner);
      denied(await submitGuestPrivateSave(app, foreign, { ...original, details: guestDetails() }), 403, 'FORBIDDEN');
      denied(await reconcile(app, foreign, original), 404, 'NOT_FOUND');
      assert.equal((await db.pool.query('SELECT count(*)::int n FROM system.commands WHERE command_id=$1', [original.commandId])).rows[0].n, 0);

      const deviceId = randomUUID();
      await db.pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Replacement guest assignment')", [deviceId, owner.tenantId, owner.outletId, owner.userId]);
      const email = (await db.pool.query('SELECT email FROM identity.users WHERE id=$1', [owner.userId])).rows[0].email;
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin, 'x-forwarded-for': `198.51.100.${++loginNumber}` }, payload: { email, password, deviceId } });
      assert.equal(login.statusCode, 200, login.body);
      const rawCookies = login.headers['set-cookie'];
      const cookie = (Array.isArray(rawCookies) ? rawCookies : [rawCookies]).filter((value): value is string => typeof value === 'string').map(value => value.split(';', 1)[0]).join('; ');
      const replacement: GuestTestActor = { ...owner, deviceId, headers: { cookie, origin, 'x-csrf-token': login.json().csrfToken } };
      denied(await submitGuestPrivateSave(app, replacement, { ...original, details: guestDetails() }), 403, 'FORBIDDEN');
      assert.equal((await db.pool.query('SELECT count(*)::int n FROM system.commands WHERE tenant_id=$1 AND command_id=$2', [owner.tenantId, original.commandId])).rows[0].n, 0);
      const fenced = await reconcile(app, replacement, original);
      assert.equal(fenced.statusCode, 200, fenced.body);
      assert.equal(fenced.json().response.code, 'GUEST_REGISTRATION_OPERATION_FENCED', fenced.body);
      const lateOriginal = await submitGuestPrivateSave(app, owner, { ...original, details: guestDetails() });
      assert.equal(lateOriginal.json().code, 'GUEST_REGISTRATION_OPERATION_FENCED', lateOriginal.body);
      await db.pool.query('UPDATE identity.devices SET active=false WHERE tenant_id=$1 AND id=$2', [owner.tenantId, owner.deviceId]);
      const recovered = await reconcile(app, replacement, original);
      assert.deepEqual(recovered.json(), fenced.json(), 'An active replacement assignment recovers the canonical original operation after the old assignment is revoked.');
      assert.equal((await db.pool.query('SELECT count(*)::int n FROM hospitality.guest_registrations WHERE id=$1', [original.registrationId])).rows[0].n, 0);
      assert.equal((await db.pool.query('SELECT device_id FROM system.commands WHERE tenant_id=$1 AND command_id=$2', [owner.tenantId, original.commandId])).rows[0].device_id, replacement.deviceId);
    });

    await t.test('each adult needs a distinct document tuple within the party while country and document type keep separate identities', async t => {
      const { app, owner, dates } = await fixture(t);
      const createdRoom = await room(app, owner);
      const details = guestDetails(3);
      details.occupants[0].identity = { action: 'REPLACE', documentType: 'PASSPORT', number: '00ab12', issuingCountry: 'KE', verified: true };
      details.occupants[1].identity = { action: 'REPLACE', documentType: 'PASSPORT', number: ' 00 AB 12 ', issuingCountry: 'KE', verified: true };
      details.occupants[2].identity = { action: 'REPLACE', documentType: 'PASSPORT', number: '00AB12', issuingCountry: 'UG', verified: true };
      const duplicateOccupantId = details.occupants[1].id;
      const staged = await createGuestRegistration(app, owner, details);
      const baseline = await effects(owner);
      const duplicate = await submit(app, owner, await checkinCommand(app, owner, createdRoom.roomId, staged.registration.id, dates));
      assert.equal(outcomeCode(duplicate), 'DUPLICATE_GUEST_IDENTITY', duplicate.body);
      assert.equal(String(duplicate.json().message).includes('00ab12'), false);
      assert.equal(String(duplicate.json().message).includes('00 AB 12'), false);
      assert.deepEqual(await effects(owner), baseline);
      const distinct = fromView(staged.registration);
      distinct.occupants.find(person => person.id === duplicateOccupantId)!.identity = { action: 'REPLACE', documentType: 'NATIONAL_ID', number: '00AB12', issuingCountry: 'KE', verified: true };
      const saved = await submitGuestPrivateSave(app, owner, { ...guestOperation(owner, staged.registration.id, staged.registration.version), details: distinct });
      assert.equal(saved.json().status, 'CONFIRMED', saved.body);
      await confirmed(app, owner, await checkinCommand(app, owner, createdRoom.roomId, staged.registration.id, dates));
      const final = await readGuestRegistration(app, owner, staged.registration.id);
      const invalidCorrection = fromView(final);
      invalidCorrection.occupants.find(person => person.id === duplicateOccupantId)!.identity = { action: 'REPLACE', documentType: 'PASSPORT', number: ' 00aB 12 ', issuingCountry: 'KE', verified: true };
      const corrected = await submitGuestPrivateSave(app, owner, { ...guestOperation(owner, final.id, final.version, 'hotel.registration.correct'), details: invalidCorrection, reason: 'Duplicate identity must not replace one adult in the finalized party' });
      assert.equal(outcomeCode(corrected), 'DUPLICATE_GUEST_IDENTITY', corrected.body);
      assert.equal((await readGuestRegistration(app, owner, final.id)).version, final.version);
      assert.equal((await effects(owner)).stays, 1);
    });

    await t.test('roster, document and capacity validation reject forged or incomplete arrivals without side effects', async t => {
      const { app, owner, dates } = await fixture(t);
      const createdRoom = await room(app, owner);
      const capacities = await confirmed(app, owner, guestCommand(owner, 'hotel.room.capacity.update', { roomId: createdRoom.roomId, maxAdults: 1, maxChildren: 1, maxOccupants: 2, reason: 'Reviewed physical room capacity' }, { [`room:${createdRoom.roomId}`]: 1 }));
      assert.ok(capacities);
      const invalidInputs: GuestRegistrationInput[] = [];
      const noPrimary = guestDetails(); noPrimary.occupants[0].primary = false; invalidInputs.push(noPrimary);
      const twoPrimary = guestDetails(2); twoPrimary.occupants[1].primary = true; invalidInputs.push(twoPrimary);
      const mismatch = guestDetails(); mismatch.adultCount = 2; invalidInputs.push(mismatch);
      const wrongGuardian = guestDetails(1, 1); wrongGuardian.occupants[1].guardianId = randomUUID(); invalidInputs.push(wrongGuardian);
      const childGuardian = guestDetails(1, 2); childGuardian.occupants[1].guardianId = childGuardian.occupants[2].id; invalidInputs.push(childGuardian);
      const maskedReplacement = guestDetails(); maskedReplacement.occupants[0].identity.number = '******5670'; invalidInputs.push(maskedReplacement);
      const baseline = await effects(owner);
      for (const details of invalidInputs) {
        const response = await submitGuestPrivateSave(app, owner, { ...guestOperation(owner), details });
        assert.notEqual(response.json().status, 'CONFIRMED', response.body);
        assert.equal(outcomeCode(response), 'VALIDATION_FAILED', response.body);
      }
      const tooMany = await createGuestRegistration(app, owner, guestDetails(2));
      const rejected = await submit(app, owner, await checkinCommand(app, owner, createdRoom.roomId, tooMany.registration.id, dates));
      assert.equal(outcomeCode(rejected), 'ROOM_CAPACITY_EXCEEDED', rejected.body);
      assert.deepEqual(await effects(owner), baseline);
      const accepted = await createGuestRegistration(app, owner, guestDetails(1, 1));
      await confirmed(app, owner, await checkinCommand(app, owner, createdRoom.roomId, accepted.registration.id, dates));
      const reduction = await submit(app, owner, guestCommand(owner, 'hotel.room.capacity.update', { roomId: createdRoom.roomId, maxAdults: 1, maxChildren: 0, maxOccupants: 1, reason: 'Attempt an unsafe reduction' }, { [`room:${createdRoom.roomId}`]: await roomVersion(app, owner, createdRoom.roomId) }));
      assert.notEqual(reduction.json().status, 'CONFIRMED', reduction.body);
      assert.equal((await db.pool.query('SELECT max_occupants FROM hospitality.rooms WHERE id=$1', [createdRoom.roomId])).rows[0].max_occupants, 2);
      const final = await readGuestRegistration(app, owner, accepted.registration.id);
      const overCapacityCorrection = await submitGuestPrivateSave(app, owner, { ...guestOperation(owner, final.id, final.version, 'hotel.registration.correct'), details: guestDetails(2), reason: 'Attempt to register another adult in a one-adult room' });
      assert.equal(outcomeCode(overCapacityCorrection), 'ROOM_CAPACITY_EXCEEDED', overCapacityCorrection.body);
      assert.equal((await readGuestRegistration(app, owner, final.id)).version, final.version);
      const bookedRoom = await room(app, owner);
      await confirmed(app, owner, guestCommand(owner, 'hotel.room.capacity.update', { roomId: bookedRoom.roomId, maxAdults: 1, maxChildren: 0, maxOccupants: 1, reason: 'Reviewed single guest room' }, { [`room:${bookedRoom.roomId}`]: 1 }));
      const draft = await createGuestRegistration(app, owner);
      const booking = await confirmed(app, owner, guestCommand(owner, 'hotel.reservation.create', { roomId: bookedRoom.roomId, registrationId: draft.registration.id, checkInDate: dates.today, checkOutDate: dates.tomorrow }, { [`room:${bookedRoom.roomId}`]: 2, [`registration:${draft.registration.id}`]: draft.registration.version }));
      const linked = await readGuestRegistration(app, owner, draft.registration.id);
      const linkedOverflow = await submitGuestPrivateSave(app, owner, { ...guestOperation(owner, linked.id, linked.version), reservationId: booking.reservationId, expectedReservationVersion: await reservationVersion(app, owner, booking.reservationId), details: guestDetails(2) });
      assert.equal(outcomeCode(linkedOverflow), 'ROOM_CAPACITY_EXCEEDED', linkedOverflow.body);
      assert.equal((await readGuestRegistration(app, owner, linked.id)).version, linked.version);
    });

    await t.test('unreviewed policy and unavailable keys fail safely; key rotation keeps prior documents readable', async t => {
      const { app, owner } = await fixture(t, false);
      const blank = await createGuestRegistration(app, owner, guestDetails(1, 0, false));
      const unreviewed = await submitGuestPrivateSave(app, owner, { ...guestOperation(owner, blank.registration.id, blank.registration.version), details: guestDetails() });
      assert.equal(outcomeCode(unreviewed), 'GUEST_POLICY_REVIEW_REQUIRED', unreviewed.body);
      await reviewGuestPolicy(app, owner);
      const savedKeys = process.env.GUEST_IDENTITY_KEYS, savedActive = process.env.GUEST_IDENTITY_ACTIVE_KEY;
      try {
        delete process.env.GUEST_IDENTITY_KEYS;
        const missingKey = await submitGuestPrivateSave(app, owner, { ...guestOperation(owner), details: guestDetails() });
        assert.equal(outcomeCode(missingKey), 'GUEST_IDENTITY_UNAVAILABLE', missingKey.body);
        process.env.GUEST_IDENTITY_KEYS = savedKeys;
        const staged = await createGuestRegistration(app, owner);
        process.env.GUEST_IDENTITY_KEYS = JSON.stringify({ v1: '1'.repeat(64), v2: '2'.repeat(64) }); process.env.GUEST_IDENTITY_ACTIVE_KEY = 'v2';
        const revealOld = await app.inject({ method: 'POST', url: `/api/v1/hospitality/registrations/${staged.registration.id}/reveal`, headers: owner.headers, payload: { occupantId: staged.registration.occupants[0].id, reason: 'VERIFY_DOCUMENT' } });
        assert.equal(revealOld.statusCode, 200, revealOld.body); assert.equal(revealOld.json().number, '0012345670');
        const replacement = fromView(staged.registration); replacement.occupants[0].identity = { action: 'REPLACE', documentType: 'PASSPORT', number: '000ROTATE99', issuingCountry: 'TZ', verified: true };
        const updated = await submitGuestPrivateSave(app, owner, { ...guestOperation(owner, staged.registration.id, staged.registration.version), details: replacement });
        assert.equal(updated.json().status, 'CONFIRMED', updated.body);
        assert.equal((await storedIdentity(owner, staged.registration.id, staged.registration.occupants[0].id)).document_key_version, 'v2');
        const current = await readGuestRegistration(app, owner, staged.registration.id);
        const removed = fromView(current); removed.occupants[0].identity = { action: 'REMOVE', verified: false };
        const cleared = await submitGuestPrivateSave(app, owner, { ...guestOperation(owner, current.id, current.version), details: removed });
        assert.equal(cleared.json().status, 'CONFIRMED', cleared.body);
        assert.equal((await storedIdentity(owner, current.id, current.occupants[0].id)).document_ciphertext, null);
        await assertNoIdentityLeak(owner, ['0012345670', '000ROTATE99']);
      } finally { if (savedKeys === undefined) delete process.env.GUEST_IDENTITY_KEYS; else process.env.GUEST_IDENTITY_KEYS = savedKeys; if (savedActive === undefined) delete process.env.GUEST_IDENTITY_ACTIVE_KEY; else process.env.GUEST_IDENTITY_ACTIVE_KEY = savedActive; }
    });

    await t.test('concurrent arrivals resolve to one stay and finalized registrations reject stale edits', async t => {
      const { app, owner, dates } = await fixture(t);
      const createdRoom = await room(app, owner);
      const staged = await createGuestRegistration(app, owner);
      const first = await checkinCommand(app, owner, createdRoom.roomId, staged.registration.id, dates);
      const second = { ...first, commandId: randomUUID(), occurredAt: new Date().toISOString() };
      const results = await Promise.all([submit(app, owner, first), submit(app, owner, second)]);
      assert.equal(results.filter(result => result.json().status === 'CONFIRMED').length, 1, results.map(result => result.body).join('\n'));
      const counts = await effects(owner); assert.equal(counts.stays, 1); assert.equal(counts.folios, 1);
      const stale = await submitGuestPrivateSave(app, owner, { ...guestOperation(owner, staged.registration.id, staged.registration.version, 'hotel.registration.correct'), details: fromView(staged.registration), reason: 'Stale correction must not replace the final registration' });
      assert.equal(stale.json().status, 'CONFLICT', stale.body);
      assert.equal(outcomeCode(stale), 'VERSION_CONFLICT', stale.body);
    });

    await t.test('pre-upgrade confirmed arrivals replay unchanged while new legacy-format arrivals require registration', async t => {
      const { app, owner, dates } = await fixture(t);
      const { hashCommand } = await import('../src/commands.js');
      const createdRoom = await room(app, owner), stayId = randomUUID(), folioId = randomUUID();
      const original = guestCommand(owner, 'hotel.checkin', { roomId: createdRoom.roomId, guestName: 'Legacy arrival', checkInDate: dates.today, checkOutDate: dates.tomorrow }, { [`room:${createdRoom.roomId}`]: 1 });
      const oldResponse = { status: 'CONFIRMED', value: { stayId, folioId, roomId: createdRoom.roomId, roomVersion: 2, guestName: 'Legacy arrival', checkInDate: dates.today, checkOutDate: dates.tomorrow, status: 'CHECKED_IN' } };
      await db.pool.query("INSERT INTO hospitality.stays(id,tenant_id,outlet_id,room_id,guest_name,check_in_date,expected_check_out_date,nightly_rate_minor,tax_rate_bps,currency,status,created_by) VALUES($1,$2,$3,$4,'Legacy arrival',$5::date,$6::date,10000,0,'KES','CHECKED_IN',$7)", [stayId, owner.tenantId, owner.outletId, createdRoom.roomId, dates.today, dates.tomorrow, owner.userId]);
      await db.pool.query("INSERT INTO hospitality.folios(id,tenant_id,outlet_id,stay_id,currency) VALUES($1,$2,$3,$4,'KES')", [folioId, owner.tenantId, owner.outletId, stayId]);
      await db.pool.query("UPDATE hospitality.rooms SET status='OCCUPIED',version=2 WHERE id=$1", [createdRoom.roomId]);
      await db.pool.query("INSERT INTO system.commands(tenant_id,command_id,actor_id,device_id,command_type,request_hash,status,response,completed_at,authority_version,required_capabilities) VALUES($1,$2,$3,$4,'hotel.checkin',$5,'CONFIRMED',$6::jsonb,now(),1,ARRAY['hospitality']::text[])", [owner.tenantId, original.commandId, owner.userId, owner.deviceId, hashCommand(original), JSON.stringify(oldResponse)]);
      const replayed = await submit(app, owner, original);
      assert.equal(replayed.statusCode, 200, replayed.body); assert.equal(replayed.json().status, 'CONFIRMED', replayed.body);
      assert.deepEqual(replayed.json().value, oldResponse.value, 'New registration rules cannot reinterpret a previously confirmed arrival.');
      const status = await app.inject({ url: `/api/v1/commands/${original.commandId}`, headers: owner.headers });
      assert.deepEqual(status.json().response, oldResponse);
      assert.equal((await effects(owner)).stays, 1); assert.equal((await effects(owner)).folios, 1);
      const newRoom = await room(app, owner);
      const missing = guestCommand(owner, 'hotel.checkin', { roomId: newRoom.roomId, guestName: 'New unregistered arrival', checkInDate: dates.today, checkOutDate: dates.tomorrow }, { [`room:${newRoom.roomId}`]: 1 });
      const rejected = await submit(app, owner, missing);
      assert.equal(outcomeCode(rejected), 'GUEST_REGISTRATION_REQUIRED', rejected.body);
      assert.deepEqual((await submit(app, owner, missing)).json(), rejected.json(), 'Rejected pre-registration client commands keep a stable terminal result.');
      assert.equal((await effects(owner)).stays, 1);
    });

    await t.test('approved retention erases expired unbound drafts and their snapshots without touching active stays', async t => {
      const { app, owner, dates } = await fixture(t);
      const expired = await createGuestRegistration(app, owner);
      const active = await createGuestRegistration(app, owner);
      const createdRoom = await room(app, owner);
      await confirmed(app, owner, await checkinCommand(app, owner, createdRoom.roomId, active.registration.id, dates));
      await db.pool.query("UPDATE hospitality.guest_registrations SET updated_at=now()-interval '3 days' WHERE tenant_id=$1 AND id=$2", [owner.tenantId, expired.registration.id]);
      const baseline = await effects(owner);
      const policy = await app.inject({ url: '/api/v1/hospitality/registration-policy', headers: owner.headers });
      await confirmed(app, owner, guestCommand(owner, 'hotel.registration.retention.run', { reason: 'Execute reviewed disposable guest retention policy' }, { 'guest-policy': policy.json().policy.version }));
      const erased = await db.pool.query('SELECT data_erased_at FROM hospitality.guest_registrations WHERE tenant_id=$1 AND id=$2', [owner.tenantId, expired.registration.id]);
      assert.ok(erased.rows[0].data_erased_at);
      const erasedDocuments = await db.pool.query('SELECT document_ciphertext FROM hospitality.guest_registration_occupants WHERE tenant_id=$1 AND registration_id=$2', [owner.tenantId, expired.registration.id]);
      assert.equal(erasedDocuments.rows.every(row => row.document_ciphertext === null), true);
      const revisions = await db.pool.query('SELECT private_snapshot,erased_at FROM hospitality.guest_registration_revisions WHERE tenant_id=$1 AND registration_id=$2', [owner.tenantId, expired.registration.id]);
      assert.equal(revisions.rows.every(row => row.erased_at && !JSON.stringify(row.private_snapshot).includes('document_ciphertext')), true);
      assert.equal((await readGuestRegistration(app, owner, active.registration.id)).status, 'FINAL');
      assert.ok((await storedIdentity(owner, active.registration.id, active.registration.occupants[0].id)).document_ciphertext);
      assert.deepEqual(await effects(owner), baseline);
    });
  });
}

function guestOperationMetadata(input: GuestRegistrationSave) {
  const { details: _details, reason: _reason, ...metadata } = input;
  return metadata;
}
