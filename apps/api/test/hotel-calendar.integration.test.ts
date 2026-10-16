import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import type { CommandEnvelope } from '../src/contracts.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  test('hotel calendar guards and projections', { skip: 'Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database.' }, () => {});
} else {
  process.env.DATABASE_URL = databaseUrl;
  const [{ buildApp }, { hashPassword }, { pool }] = await Promise.all([
    import('../src/app.js'), import('../src/security.js'), import('../src/db.js'),
  ]);
  after(async () => { await pool.end(); });
  const origin = 'http://localhost:3000';
  process.env.APP_ORIGINS = origin;
  const initialTimeZone = process.env.TZ;

  for (const [hostTimeZone, outletTimeZone] of [
    ['UTC', 'Africa/Nairobi'], ['Africa/Nairobi', 'Pacific/Kiritimati'], ['America/Los_Angeles', 'America/Adak'],
  ]) {
    test(`hotel calendar dates stay exact with host ${hostTimeZone} and outlet ${outletTimeZone}`, async () => {
      process.env.TZ = hostTimeZone;
      const tenantId = randomUUID(), outletId = randomUUID(), userId = randomUUID(), deviceId = randomUUID();
      const email = `hotel-calendar-${userId}@example.invalid`, password = `Disposable-hotel-${randomUUID()}`;
      await pool.query('INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,$2,\'KES\',$3)', [tenantId, 'Disposable calendar business', outletTimeZone]);
      await pool.query('INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,$3,$4)', [outletId, tenantId, 'Calendar outlet', outletTimeZone]);
      for (const capability of ['hospitality', 'commerce', 'inventory']) {
        await pool.query('INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,$2)', [tenantId, capability]);
      }
      await pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)', [userId, email, await hashPassword(password), 'Calendar Operator']);
      await pool.query('INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,\'admin\')', [tenantId, userId]);
      await pool.query('INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,$5)', [deviceId, tenantId, outletId, userId, 'Calendar assignment']);

      const app = buildApp(); await app.ready();
      try {
        const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { email, password } });
        assert.equal(login.statusCode, 200, login.body);
        const rawCookies = login.headers['set-cookie'];
        const cookie = (Array.isArray(rawCookies) ? rawCookies : [rawCookies]).filter((value): value is string => typeof value === 'string').map(value => value.split(';', 1)[0]).join('; ');
        const headers = { cookie, origin, 'x-csrf-token': login.json().csrfToken };
        const make = (type: string, payload: Record<string, unknown>, expectedVersions: Record<string, number> = {}): CommandEnvelope => ({
          protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId, type, occurredAt: new Date().toISOString(), expectedVersions, payload,
        });
        const submit = (command: CommandEnvelope) => app.inject({ method: 'POST', url: '/api/v1/commands', headers, payload: command });
        const confirmed = async (command: CommandEnvelope) => {
          const response = await submit(command); assert.equal(response.statusCode, 200, response.body);
          assert.equal(response.json().status, 'CONFIRMED', response.body); return response.json().value;
        };
        const dates = (await pool.query(`SELECT to_char(now() AT TIME ZONE $1,'YYYY-MM-DD') today,
          to_char((now() AT TIME ZONE $1)::date + 1,'YYYY-MM-DD') tomorrow,
          to_char((now() AT TIME ZONE $1)::date + 2,'YYYY-MM-DD') later,
          to_char((now() AT TIME ZONE $1)::date - 2,'YYYY-MM-DD') before,
          to_char((now() AT TIME ZONE $1)::date - 1,'YYYY-MM-DD') yesterday`, [outletTimeZone])).rows[0];
        let roomIndex = 0;
        const room = () => confirmed(make('hotel.room.create', { roomNumber: String(++roomIndex), roomType: 'Standard', nightlyRateMinor: 10000, taxRateBps: 0 }));
        const reservation = async (arrival: string, departure: string) => {
          const createdRoom = await room();
          const booked = await confirmed(make('hotel.reservation.create', { roomId: createdRoom.roomId, guestName: 'Calendar Guest', checkInDate: arrival, checkOutDate: departure }, { [`room:${createdRoom.roomId}`]: 1 }));
          return { ...booked, roomId: createdRoom.roomId };
        };

        for (const [arrival, departure] of [[dates.tomorrow, dates.later], [dates.before, dates.yesterday]]) {
          const booked = await reservation(arrival, departure);
          const command = make('hotel.checkin', { reservationId: booked.reservationId }, { [`room:${booked.roomId}`]: 2, [`reservation:${booked.reservationId}`]: 1 });
          const rejected = await submit(command);
          assert.equal(rejected.json().status, 'REJECTED', rejected.body);
          assert.equal(rejected.json().code, 'VALIDATION_FAILED', rejected.body);
          assert.equal(rejected.json().details.checkInDate, arrival);
          assert.equal(rejected.json().details.checkOutDate, departure);
          assert.deepEqual((await submit(command)).json(), rejected.json(), 'a rejected arrival has a stable replay outcome');
          const state = (await pool.query(`SELECT r.status,r.version::text version,
            (SELECT count(*)::text FROM hospitality.stays WHERE tenant_id=$1 AND room_id=r.id) stays
            FROM hospitality.rooms r WHERE r.tenant_id=$1 AND r.id=$2`, [tenantId, booked.roomId])).rows[0];
          assert.deepEqual(state, { status: 'READY', version: '2', stays: '0' });
          assert.equal((await pool.query('SELECT 1 FROM system.audit_events WHERE tenant_id=$1 AND command_id=$2', [tenantId, command.commandId])).rowCount, 0);
        }

        const arrival = await reservation(dates.today, dates.tomorrow);
        const listed = await app.inject({ url: '/api/v1/hospitality/reservations', headers });
        assert.equal(listed.statusCode, 200, listed.body);
        for (const row of listed.json().reservations) {
          assert.match(row.checkInDate, /^\d{4}-\d{2}-\d{2}$/);
          assert.match(row.checkOutDate, /^\d{4}-\d{2}-\d{2}$/);
        }
        const checkIn = make('hotel.checkin', { reservationId: arrival.reservationId }, { [`room:${arrival.roomId}`]: 2, [`reservation:${arrival.reservationId}`]: 1 });
        const active = await confirmed(checkIn);
        assert.equal(active.checkInDate, dates.today); assert.equal(active.checkOutDate, dates.tomorrow);
        assert.equal((await confirmed(checkIn)).stayId, active.stayId, 'arrival replay cannot create a second stay');
        const stays = await app.inject({ url: '/api/v1/hospitality/stays', headers });
        const stay = stays.json().stays.find((row: { id: string }) => row.id === active.stayId);
        assert.equal(stay.checkInDate, dates.today); assert.equal(stay.checkOutDate, dates.tomorrow); assert.equal(stay.nights, 1);
        const rooms = await app.inject({ url: '/api/v1/hospitality/rooms', headers });
        const activeRoom = rooms.json().rooms.find((row: { id: string }) => row.id === arrival.roomId);
        assert.equal(activeRoom.activeStay.checkInDate, dates.today); assert.equal(activeRoom.activeStay.checkOutDate, dates.tomorrow);

        const shift = await confirmed(make('shift.open', { openingFloatMinor: 0 }));
        const early = make('hotel.checkout', { stayId: active.stayId, shiftId: shift.shiftId, tenderedMinor: 10000, currency: 'KES' }, {
          [`stay:${active.stayId}`]: 1, [`room:${arrival.roomId}`]: 3, [`shift:${shift.shiftId}`]: 1,
        });
        const rejected = await submit(early);
        assert.equal(rejected.json().status, 'REJECTED', rejected.body);
        assert.equal(rejected.json().details.bookedDepartureDate, dates.tomorrow);
        assert.deepEqual((await submit(early)).json(), rejected.json());
        assert.equal((await pool.query('SELECT 1 FROM hospitality.folio_entries WHERE tenant_id=$1 AND folio_id=$2', [tenantId, active.folioId])).rowCount, 0);
        assert.equal((await pool.query('SELECT 1 FROM finance.journal_entries WHERE tenant_id=$1 AND source_id=$2', [tenantId, early.commandId])).rowCount, 0);

        // A separate historical fixture represents a guest who arrived yesterday.
        // No application clock, posted evidence or live tenant is modified.
        const dueRoom = await room(), stayId = randomUUID(), folioId = randomUUID();
        await pool.query(`INSERT INTO hospitality.stays(id,tenant_id,outlet_id,room_id,guest_name,check_in_date,expected_check_out_date,nightly_rate_minor,tax_rate_bps,currency,status,created_by)
          VALUES($1,$2,$3,$4,'Departure Guest',$5::date,$6::date,10000,0,'KES','CHECKED_IN',$7)`, [stayId, tenantId, outletId, dueRoom.roomId, dates.yesterday, dates.today, userId]);
        await pool.query("INSERT INTO hospitality.folios(id,tenant_id,outlet_id,stay_id,currency) VALUES($1,$2,$3,$4,'KES')", [folioId, tenantId, outletId, stayId]);
        await pool.query("UPDATE hospitality.rooms SET status='OCCUPIED',version=2 WHERE tenant_id=$1 AND id=$2", [tenantId, dueRoom.roomId]);
        const checkout = make('hotel.checkout', { stayId, shiftId: shift.shiftId, tenderedMinor: 10000, currency: 'KES' }, { [`stay:${stayId}`]: 1, [`room:${dueRoom.roomId}`]: 2, [`shift:${shift.shiftId}`]: 1 });
        const checkedOut = await confirmed(checkout); assert.equal(checkedOut.totalMinor, 10000);
        await confirmed(checkout);
        const posting = (await pool.query(`SELECT sum(l.debit_minor)::text debit,sum(l.credit_minor)::text credit,count(DISTINCT e.id)::text entries
          FROM finance.journal_entries e JOIN finance.journal_lines l ON l.journal_entry_id=e.id AND l.tenant_id=e.tenant_id WHERE e.tenant_id=$1 AND e.source_id=$2`, [tenantId, checkout.commandId])).rows[0];
        assert.deepEqual(posting, { debit: '10000', credit: '10000', entries: '1' });
        assert.equal((await pool.query('SELECT status FROM hospitality.rooms WHERE tenant_id=$1 AND id=$2', [tenantId, dueRoom.roomId])).rows[0].status, 'DIRTY');
        assert.equal((await pool.query('SELECT expected_cash_minor::text cash FROM commerce.shifts WHERE tenant_id=$1 AND id=$2', [tenantId, shift.shiftId])).rows[0].cash, '10000');
      } finally {
        await app.close();
        if (initialTimeZone === undefined) delete process.env.TZ; else process.env.TZ = initialTimeZone;
      }
    });
  }
}
