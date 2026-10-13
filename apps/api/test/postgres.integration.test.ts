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

  test('fresh migrations support authenticated catalog reads and canonical command replay', async () => {
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
      const first = await app.inject({ method: 'POST', url: '/api/v1/commands', headers, payload: createProduct });
      assert.equal(first.statusCode, 200, first.body);
      assert.equal(first.json().status, 'CONFIRMED');

      const replay = await app.inject({ method: 'POST', url: '/api/v1/commands', headers, payload: createProduct });
      assert.equal(replay.statusCode, 200, replay.body);
      assert.deepEqual(replay.json(), first.json(), 'same command ID and payload must have the same response shape and value');

      const catalog = await app.inject({ method: 'GET', url: '/api/v1/catalog/items', headers });
      assert.equal(catalog.statusCode, 200, catalog.body);
      const items = catalog.json().items as Array<{ id: string; sku: string; quantity: string }>;
      assert.equal(items.length, 1);
      assert.equal(items[0].sku, 'GAP-530CDBF');
      assert.equal(items[0].quantity, '0');

      const persisted = await db.pool.query<{ command_count: string; product_count: string }>(`SELECT
        (SELECT count(*) FROM system.commands WHERE tenant_id=$1 AND command_id=$2)::text command_count,
        (SELECT count(*) FROM catalog.products WHERE tenant_id=$1 AND outlet_id=$3 AND sku='GAP-530CDBF')::text product_count`, [tenantId, commandId, outletId]);
      assert.equal(persisted.rows[0].command_count, '1');
      assert.equal(persisted.rows[0].product_count, '1');

      const roomCommandId = randomUUID();
      const roomResult = await app.inject({ method: 'POST', url: '/api/v1/commands', headers, payload: {
        protocolVersion: 1, commandId: roomCommandId, tenantId, deviceId,
        type: 'hotel.room.create', occurredAt: new Date().toISOString(), expectedVersions: {},
        payload: { roomNumber: '101', roomType: 'Standard', nightlyRateMinor: 12000, taxRateBps: 1600 },
      } });
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
      const reservationResponses = await Promise.all(reservations.map(payload => app.inject({ method: 'POST', url: '/api/v1/commands', headers, payload })));
      assert.deepEqual(reservationResponses.map(response => response.json().status).sort(), ['CONFIRMED', 'CONFLICT']);
      const confirmedReservations = await db.pool.query<{ count: string }>(`SELECT count(*)::text count FROM hospitality.reservations WHERE tenant_id=$1 AND outlet_id=$2 AND room_id=$3 AND status='CONFIRMED' AND check_in_date<'2030-01-12' AND check_out_date>'2030-01-10'`, [tenantId, outletId, roomId]);
      assert.equal(confirmedReservations.rows[0].count, '1');
    } finally {
      await app.close();
      await db.pool.end();
    }
  });
}
