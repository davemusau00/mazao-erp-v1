import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { test } from 'node:test';

const sourceUrl = process.env.TEST_DATABASE_URL;
if (!sourceUrl) {
  test('restaurant additive upgrade and scoped foreign keys', { skip: 'Requires disposable localhost PostgreSQL with CREATE DATABASE permission.' }, () => {});
} else {
  test('028 to 029 preserves all prior rows, remains checksum-safe and enforces outlet references', { timeout: 120_000 }, async () => {
    const source = new URL(sourceUrl); assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname));
    const databaseName = `mazao_restaurant_upgrade_${randomUUID().replaceAll('-', '')}`;
    const maintenance = new URL(source); maintenance.pathname = '/postgres';
    const disposable = new URL(source); disposable.pathname = `/${databaseName}`;
    const admin = new Client({ connectionString: maintenance.href });
    let client: Client | undefined, created = false;
    const migrate = (target: string) => {
      const result = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../src/migration.ts', import.meta.url))], {
        cwd: process.cwd(), encoding: 'utf8', timeout: 60_000,
        env: { ...process.env, DATABASE_URL: disposable.href, MIGRATION_TARGET: target },
      });
      assert.ifError(result.error); assert.equal(result.status, 0, result.stdout + result.stderr); return result.stdout;
    };
    try {
      await admin.connect(); await admin.query(`CREATE DATABASE "${databaseName}"`); created = true;
      migrate('028_tenant_onboarding');
      client = new Client({ connectionString: disposable.href }); await client.connect();
      const tenant = randomUUID(), outlet = randomUUID(), otherOutlet = randomUUID(), user = randomUUID(), device = randomUUID(), product = randomUUID();
      await client.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Upgrade restaurant business','KES','Africa/Nairobi')", [tenant]);
      await client.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$3,'Original dining outlet','Africa/Nairobi'),($2,$3,'Other outlet','Africa/Nairobi')", [outlet, otherOutlet, tenant]);
      await client.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'commerce'),($1,'inventory')", [tenant]);
      await client.query("INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,'unusable-fixture-hash','Original owner')", [user, `${user}@example.invalid`]);
      await client.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')", [tenant, user]);
      await client.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Original logical assignment')", [device, tenant, outlet, user]);
      await client.query("INSERT INTO catalog.products(id,tenant_id,outlet_id,sku,name,base_unit,currency,selling_price_minor,cost_price_minor,tax_rate_bps,item_kind) VALUES($1,$2,$3,'UPGRADE-ITEM','Original item','each','KES',500,200,1600,'STOCKED_GOOD')", [product, tenant, outlet]);
      await client.query('INSERT INTO inventory.balances(tenant_id,outlet_id,product_id,quantity,inventory_value_minor) VALUES($1,$2,$3,3,600)', [tenant, outlet, product]);
      const originalTables = (await client.query<{ schema: string; name: string }>(`SELECT schemaname AS schema,tablename AS name FROM pg_tables
        WHERE schemaname IN ('core','identity','catalog','inventory','commerce','hospitality','finance','system') AND tablename<>'schema_migrations' ORDER BY schemaname,tablename`)).rows;
      const snapshot = async () => {
        const result: Record<string, unknown> = {};
        for (const table of originalTables) {
          // Table identifiers come only from PostgreSQL's catalogue, quoted as identifiers.
          const identifier = [table.schema, table.name].map(part => '"' + part.replaceAll('"', '""') + '"').join('.');
          result[identifier] = (await client!.query(`SELECT to_jsonb(x)::text evidence FROM ${identifier} x ORDER BY to_jsonb(x)::text`)).rows;
        }
        return result;
      };
      const before = await snapshot();
      const upgradeStarted = performance.now(); migrate('029_restaurant_configuration');
      assert.ok(performance.now() - upgradeStarted < 60_000);
      assert.deepEqual(await snapshot(), before, 'Expansion must not rewrite any prior domain or command record.');
      const rerun = migrate('029_restaurant_configuration');
      assert.equal((rerun.match(/already applied; checksum matches/g) ?? []).length, 29);
      const checksum = createHash('sha256').update(readFileSync(new URL('../migrations/029_restaurant_configuration.sql', import.meta.url))).digest('hex');
      assert.equal((await client.query("SELECT checksum FROM system.schema_migrations WHERE version='029_restaurant_configuration'")).rows[0].checksum, checksum);
      const section = randomUUID(), station = randomUUID();
      await client.query("INSERT INTO restaurant.sections(id,tenant_id,outlet_id,name) VALUES($1,$2,$3,'Original dining room')", [section, tenant, outlet]);
      await client.query("INSERT INTO restaurant.stations(id,tenant_id,outlet_id,name,kind,characters_per_line) VALUES($1,$2,$3,'Kitchen','KITCHEN',42)", [station, tenant, outlet]);
      await assert.rejects(client.query("INSERT INTO restaurant.tables(id,tenant_id,outlet_id,name,section_id,seats) VALUES($1,$2,$3,'Foreign section table',$4,2)", [randomUUID(), tenant, otherOutlet, section]), { code: '23503' });
      await assert.rejects(client.query("INSERT INTO restaurant.menu_routes(tenant_id,outlet_id,product_id,preparation_label,instructions) VALUES($1,$2,$3,'Foreign item','')", [tenant, otherOutlet, product]), { code: '23503' });
      await assert.rejects(client.query('INSERT INTO restaurant.station_assignments(tenant_id,outlet_id,device_id,device_version) VALUES($1,$2,$3,1)', [tenant, otherOutlet, device]), { code: '23503' });
      await assert.rejects(client.query("INSERT INTO restaurant.sections(id,tenant_id,outlet_id,name) VALUES($1,$2,$3,'original dining room')", [randomUUID(), tenant, outlet]), { code: '23505' });
      assert.deepEqual(await snapshot(), before, 'Configuration and failed cross-scope writes leave preexisting evidence unchanged.');
    } finally {
      await client?.end();
      // Delete only the generated database created by this test, never the input database.
      try { if (created) await admin.query(`DROP DATABASE "${databaseName}"`); } finally { await admin.end(); }
    }
  });
}
