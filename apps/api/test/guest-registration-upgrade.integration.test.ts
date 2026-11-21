import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Client } from 'pg';

const sourceUrl = process.env.TEST_DATABASE_URL;
if (!sourceUrl) {
  test('guest registration additive upgrade preserves legacy hotel and posted evidence', { skip: 'Set TEST_DATABASE_URL to disposable localhost PostgreSQL.' }, () => {});
} else {
  const parsed = new URL(sourceUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) throw new Error('Guest upgrade acceptance requires disposable localhost PostgreSQL.');

  test('upgrade from029 preserves hotel, inventory, journal and canonical command evidence and reruns safely', { timeout: 120_000 }, async () => {
    const databaseName = `mazao_guest_upgrade_${randomUUID().replaceAll('-', '')}`;
    const maintenanceUrl = new URL(sourceUrl); maintenanceUrl.pathname = '/postgres';
    const databaseUrl = new URL(sourceUrl); databaseUrl.pathname = '/' + databaseName;
    const admin = new Client({ connectionString: maintenanceUrl.href });
    let fixture: Client | undefined, created = false;
    const migrate = (target?: string) => {
      const script = fileURLToPath(new URL('../src/migration.ts', import.meta.url));
      const result = spawnSync(process.execPath, ['--import', 'tsx', script], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl.href, MIGRATION_TARGET: target ?? '' }, encoding: 'utf8', timeout: 60_000 });
      assert.ifError(result.error); assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
      return result.stdout;
    };
    try {
      await admin.connect(); await admin.query(`CREATE DATABASE "${databaseName}"`); created = true;
      migrate('029_product_import_queue_archive');
      fixture = new Client({ connectionString: databaseUrl.href }); await fixture.connect();
      await fixture.query("SET TIME ZONE 'UTC'");
      const tenantId = randomUUID(), outletId = randomUUID(), userId = randomUUID(), deviceId = randomUUID();
      const roomId = randomUUID(), reservationId = randomUUID(), stayId = randomUUID(), folioId = randomUUID();
      const commandId = randomUUID(), productId = randomUUID(), movementId = randomUUID(), journalId = randomUUID();
      const legacyResponse = { status: 'CONFIRMED', value: { stayId, folioId, roomId, roomVersion: 3, guestName: 'Legacy registered guest', checkInDate: '2026-01-10', checkOutDate: '2026-01-11', status: 'CHECKED_IN' } };
      await fixture.query('BEGIN');
      await fixture.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Legacy hotel upgrade','KES','Africa/Nairobi')", [tenantId]);
      await fixture.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Legacy outlet','Africa/Nairobi')", [outletId, tenantId]);
      await fixture.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'hospitality'),($1,'inventory')", [tenantId]);
      await fixture.query("INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,'fixture-only-invalid-hash','Legacy operator')", [userId, `legacy-guest-${userId}@example.invalid`]);
      await fixture.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')", [tenantId, userId]);
      await fixture.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Legacy assignment')", [deviceId, tenantId, outletId, userId]);
      await fixture.query("INSERT INTO hospitality.rooms(id,tenant_id,outlet_id,room_number,room_type,nightly_rate_minor,tax_rate_bps,currency,status,version) VALUES($1,$2,$3,'101','Standard',10000,0,'KES','OCCUPIED',3)", [roomId, tenantId, outletId]);
      await fixture.query("INSERT INTO hospitality.reservations(id,tenant_id,outlet_id,room_id,guest_name,guest_contact,check_in_date,check_out_date,nightly_rate_minor,tax_rate_bps,currency,status,created_by,version) VALUES($1,$2,$3,$4,'Legacy registered guest','Original free-form contact',DATE '2026-01-10',DATE '2026-01-11',10000,0,'KES','CHECKED_IN',$5,2)", [reservationId, tenantId, outletId, roomId, userId]);
      await fixture.query("INSERT INTO hospitality.stays(id,tenant_id,outlet_id,room_id,reservation_id,guest_name,guest_contact,check_in_date,expected_check_out_date,nightly_rate_minor,tax_rate_bps,currency,status,created_by) VALUES($1,$2,$3,$4,$5,'Legacy registered guest','Original free-form contact',DATE '2026-01-10',DATE '2026-01-11',10000,0,'KES','CHECKED_IN',$6)", [stayId, tenantId, outletId, roomId, reservationId, userId]);
      await fixture.query("INSERT INTO hospitality.folios(id,tenant_id,outlet_id,stay_id,currency,status) VALUES($1,$2,$3,$4,'KES','OPEN')", [folioId, tenantId, outletId, stayId]);
      await fixture.query("INSERT INTO system.commands(tenant_id,command_id,actor_id,device_id,command_type,request_hash,status,response,completed_at,authority_version,required_capabilities) VALUES($1,$2,$3,$4,'hotel.checkin',$5,'CONFIRMED',$6::jsonb,now(),1,ARRAY['hospitality']::text[])", [tenantId, commandId, userId, deviceId, Buffer.from('legacy-hotel-immutable-input'), JSON.stringify(legacyResponse)]);
      await fixture.query("INSERT INTO catalog.products(id,tenant_id,outlet_id,sku,name,base_unit,currency,selling_price_minor,cost_price_minor,tax_rate_bps) VALUES($1,$2,$3,'UPGRADE-ROOM-ITEM','Legacy inventory item','each','KES',250,120,0)", [productId, tenantId, outletId]);
      await fixture.query('INSERT INTO inventory.balances(tenant_id,outlet_id,product_id,quantity,inventory_value_minor) VALUES($1,$2,$3,2,240)', [tenantId, outletId, productId]);
      await fixture.query("INSERT INTO inventory.movements(id,tenant_id,outlet_id,product_id,command_id,movement_type,quantity_delta,unit_cost_minor,value_minor) VALUES($1,$2,$3,$4,$5,'RECEIPT',2,120,240)", [movementId, tenantId, outletId, productId, randomUUID()]);
      await fixture.query("INSERT INTO finance.journal_entries(id,tenant_id,source_type,source_id,currency,created_by) VALUES($1,$2,'INVENTORY_RECEIPT',$3,'KES',$4)", [journalId, tenantId, movementId, userId]);
      await fixture.query("INSERT INTO finance.journal_lines(id,tenant_id,journal_entry_id,account_code,debit_minor,credit_minor) VALUES($1,$2,$3,'INVENTORY',240,0),($4,$2,$3,'GOODS_RECEIVED_NOT_INVOICED',0,240)", [randomUUID(), tenantId, journalId, randomUUID()]);
      await fixture.query('COMMIT');

      const snapshot = async () => ({
        rooms: (await fixture!.query("SELECT to_jsonb(t)-'max_adults'-'max_children'-'max_occupants' evidence FROM hospitality.rooms t ORDER BY id")).rows,
        reservations: (await fixture!.query("SELECT to_jsonb(t)-'guest_registration_id' evidence FROM hospitality.reservations t ORDER BY id")).rows,
        stays: (await fixture!.query("SELECT to_jsonb(t)-'guest_registration_id' evidence FROM hospitality.stays t ORDER BY id")).rows,
        folios: (await fixture!.query('SELECT to_jsonb(t) evidence FROM hospitality.folios t ORDER BY id')).rows,
        commands: (await fixture!.query('SELECT to_jsonb(t) evidence FROM system.commands t ORDER BY command_id')).rows,
        balances: (await fixture!.query('SELECT to_jsonb(t) evidence FROM inventory.balances t ORDER BY product_id')).rows,
        movements: (await fixture!.query('SELECT to_jsonb(t) evidence FROM inventory.movements t ORDER BY id')).rows,
        entries: (await fixture!.query('SELECT to_jsonb(t) evidence FROM finance.journal_entries t ORDER BY id')).rows,
        lines: (await fixture!.query('SELECT to_jsonb(t) evidence FROM finance.journal_lines t ORDER BY id')).rows,
      });
      const before = await snapshot();
      const applied = migrate('030_guest_registration'); assert.match(applied, /Applied 030_guest_registration/);
      const rerun = migrate('030_guest_registration'); assert.match(rerun, /Migration 030_guest_registration already applied; checksum matches/);
      assert.deepEqual(await snapshot(), before, 'Additive guest registration migration must not rewrite existing room/stay/folio/command or posted financial and stock evidence.');
      const room = (await fixture.query('SELECT max_adults,max_children,max_occupants,status,version FROM hospitality.rooms WHERE id=$1', [roomId])).rows[0];
      assert.deepEqual(room, { max_adults: null, max_children: null, max_occupants: null, status: 'OCCUPIED', version: '3' });
      assert.equal((await fixture.query('SELECT guest_registration_id FROM hospitality.reservations WHERE id=$1', [reservationId])).rows[0].guest_registration_id, null);
      assert.equal((await fixture.query('SELECT guest_registration_id FROM hospitality.stays WHERE id=$1', [stayId])).rows[0].guest_registration_id, null);
      assert.equal((await fixture.query('SELECT count(*)::int n FROM hospitality.guest_registrations')).rows[0].n, 0, 'Upgrade must not fabricate verified identity records for legacy guests.');
      assert.equal((await fixture.query('SELECT count(*)::int n FROM system.guest_registration_operations')).rows[0].n, 0);
      assert.deepEqual((await fixture.query('SELECT response FROM system.commands WHERE tenant_id=$1 AND command_id=$2', [tenantId, commandId])).rows[0].response, legacyResponse);
      assert.equal((await fixture.query('SELECT count(*)::int n FROM system.schema_migrations')).rows[0].n, 30);
    } finally {
      try { await fixture?.end(); if (created) await admin.query(`DROP DATABASE "${databaseName}"`); } finally { await admin.end(); }
    }
  });
}
