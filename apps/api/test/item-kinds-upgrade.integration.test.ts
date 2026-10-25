import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { test } from 'node:test';
import { DomainError, type ApiSession } from '../src/contracts.js';
import { requireStoredCommandAuthority } from '../src/commandAuthorization.js';

const sourceUrl = process.env.TEST_DATABASE_URL;
if (!sourceUrl) {
  test('item kind upgrade preserves posted and legacy authority evidence', { skip: 'Requires a disposable localhost TEST_DATABASE_URL with CREATE DATABASE permission.' }, () => {});
} else {
  test('populated 023 to 024/025 upgrade preserves history, defaults legacy kinds and fences physical writes', { timeout: 180_000 }, async t => {
    const source = new URL(sourceUrl);
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname), 'Upgrade fixture requires explicitly disposable localhost PostgreSQL.');
    const name = 'mazao_kind_upgrade_' + randomUUID().replaceAll('-', '');
    const maintenance = new URL(source); maintenance.pathname = '/postgres';
    const database = new URL(source); database.pathname = '/' + name;
    const admin = new Client({ connectionString: maintenance.href });
    let client: Client | undefined, created = false;
    const migrate = (target?: string) => {
      const result = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../src/migration.ts', import.meta.url))], {
        cwd: process.cwd(), encoding: 'utf8', timeout: 120_000,
        env: { ...process.env, DATABASE_URL: database.href, MIGRATION_TARGET: target ?? '' },
      });
      assert.ifError(result.error); assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
      return result.stdout;
    };
    try {
      await admin.connect(); await admin.query(`CREATE DATABASE "${name}"`); created = true;
      migrate('023_catalog_maintenance'); client = new Client({ connectionString: database.href }); await client.connect();
      const tenant = randomUUID(), outlet = randomUUID(), operator = randomUUID(), device = randomUUID(), paid = randomUUID(), zero = randomUUID(), shift = randomUUID(), order = randomUUID();
      const createCommand = randomUUID(), saleCommand = randomUUID(), credentialCommand = randomUUID(), receiveCommand = randomUUID();
      await client.query('BEGIN');
      await client.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Upgrade evidence business','KES','Africa/Nairobi')", [tenant]);
      await client.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Upgrade evidence outlet','Africa/Nairobi')", [outlet, tenant]);
      await client.query("INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,'fixture-invalid-hash','Upgrade evidence operator')", [operator, operator + '@example.invalid']);
      await client.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')", [tenant, operator]);
      await client.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Upgrade evidence assignment')", [device, tenant, outlet, operator]);
      for (const [id, sku, active] of [[paid, 'KIND-PAID', true], [zero, 'KIND-ZERO-ARCHIVED', false]] as const) {
        await client.query("INSERT INTO catalog.products(id,tenant_id,outlet_id,sku,name,base_unit,currency,selling_price_minor,cost_price_minor,tax_rate_bps,active) VALUES($1,$2,$3,$4,$4,'each','KES',500,400,0,$5)", [id, tenant, outlet, sku, active]);
        await client.query('INSERT INTO inventory.balances(tenant_id,outlet_id,product_id,quantity,inventory_value_minor) VALUES($1,$2,$3,$4,$5)', [tenant, outlet, id, id === paid ? 1 : 0, id === paid ? 400 : 0]);
      }
      await client.query("INSERT INTO commerce.shifts(id,tenant_id,outlet_id,operator_id,status,opening_float_minor,cash_sales_minor,expected_cash_minor,counted_cash_minor,variance_minor,closed_at) VALUES($1,$2,$3,$4,'CLOSED',0,500,500,500,0,now())", [shift, tenant, outlet, operator]);
      await client.query(`INSERT INTO commerce.orders(id,tenant_id,outlet_id,shift_id,operator_id,currency,subtotal_minor,tax_minor,total_minor,status,receipt_number,tenant_name_snapshot,outlet_name_snapshot,outlet_time_zone_snapshot,cash_tendered_minor,change_minor,receipt_profile_snapshot)
        VALUES($1,$2,$3,$4,$5,'KES',500,0,500,'CONFIRMED',$6,'Immutable kind upgrade business','Immutable kind upgrade outlet','Africa/Nairobi',500,0,'{"receiptFooter":"Original kind upgrade receipt"}'::jsonb)`, [order, tenant, outlet, shift, operator, 'MZ-' + order.replaceAll('-', '').toUpperCase()]);
      await client.query("INSERT INTO commerce.order_lines(id,tenant_id,outlet_id,order_id,product_id,sku_snapshot,name_snapshot,quantity,unit_price_minor,cost_price_minor,tax_rate_bps,line_subtotal_minor,line_tax_minor,cogs_minor) VALUES($1,$2,$3,$4,$5,'KIND-PAID','Original paid goods',1,500,400,0,500,0,400)", [randomUUID(), tenant, outlet, order, paid]);
      await client.query("INSERT INTO commerce.payments(id,tenant_id,outlet_id,order_id,method,amount_minor,currency,status) VALUES($1,$2,$3,$4,'CASH',500,'KES','CONFIRMED')", [randomUUID(), tenant, outlet, order]);
      await client.query(`INSERT INTO inventory.movements(id,tenant_id,outlet_id,product_id,command_id,movement_type,quantity_delta,unit_cost_minor,value_minor,reference_id)
        VALUES($1,$2,$3,$4,$5,'RECEIPT',2,400,800,NULL),($6,$2,$3,$4,$7,'SALE',-1,400,400,$8)`, [randomUUID(), tenant, outlet, paid, receiveCommand, randomUUID(), saleCommand, order]);
      for (const entry of [{ type: 'INVENTORY_RECEIPT', source: receiveCommand, debit: 'INVENTORY', credit: 'GOODS_RECEIVED_NOT_INVOICED', amount: 800 }, { type: 'SALE', source: order, debit: 'CASH_TILL', credit: 'SALES_REVENUE', amount: 500 }, { type: 'SALE_COGS', source: order, debit: 'COST_OF_GOODS_SOLD', credit: 'INVENTORY', amount: 400 }]) {
        const id = randomUUID();
        await client.query("INSERT INTO finance.journal_entries(id,tenant_id,source_type,source_id,currency,created_by) VALUES($1,$2,$3,$4,'KES',$5)", [id, tenant, entry.type, entry.source, operator]);
        await client.query('INSERT INTO finance.journal_lines(id,tenant_id,journal_entry_id,account_code,debit_minor,credit_minor) VALUES($1,$2,$3,$4,$5,0),($6,$2,$3,$7,0,$5)', [randomUUID(), tenant, id, entry.debit, entry.amount, randomUUID(), entry.credit]);
      }
      for (const [id, type] of [[createCommand, 'catalog.product.create'], [saleCommand, 'sales.order.settle'], [credentialCommand, 'staff.password.set']] as const) {
        await client.query(`INSERT INTO system.commands(tenant_id,command_id,actor_id,device_id,command_type,request_hash,status,response,completed_at)
          VALUES($1,$2,$3,$4,$5,$6,'CONFIRMED',$7::jsonb,now())`, [tenant, id, operator, device, type, Buffer.from('legacy-exact-fingerprint-' + id), JSON.stringify({ status: 'CONFIRMED', value: { originalReference: id } })]);
      }
      await client.query('COMMIT');
      const snapshot = async () => {
        const result: Record<string, unknown> = {};
        for (const table of ['catalog.products', 'catalog.categories', 'inventory.balances', 'inventory.movements', 'commerce.orders', 'commerce.order_lines', 'commerce.payments', 'commerce.shifts', 'finance.journal_entries', 'finance.journal_lines', 'system.commands', 'system.audit_events', 'system.transactional_outbox']) {
          const expression = table === 'catalog.products' ? "to_jsonb(x)-'item_kind'" : table === 'commerce.order_lines' ? "to_jsonb(x)-'item_kind_snapshot'" : table === 'system.commands' ? "to_jsonb(x)-'authority_version'-'required_capabilities'" : 'to_jsonb(x)';
          result[table] = (await client!.query(`SELECT ${expression} AS evidence FROM ${table} x ORDER BY (${expression})::text`)).rows;
        }
        return result;
      };
      const before = await snapshot();
      await t.test('all original fields remain identical and rerun checks all 25 migration checksums', async () => {
        migrate(); const rerun = migrate();
        assert.deepEqual(await snapshot(), before);
        assert.equal((rerun.match(/already applied; checksum matches/g) ?? []).length, 25);
        assert.equal((await client!.query('SELECT count(*)::int n FROM system.schema_migrations')).rows[0].n, 25);
        assert.deepEqual((await client!.query('SELECT DISTINCT item_kind FROM catalog.products')).rows, [{ item_kind: 'STOCKED_GOOD' }]);
        assert.deepEqual((await client!.query('SELECT item_kind_snapshot FROM commerce.order_lines')).rows, [{ item_kind_snapshot: 'STOCKED_GOOD' }]);
      });
      await t.test('populated legacy command backfill preserves original requirements and recovery gates', async () => {
        const descriptors = (await client!.query('SELECT actor_id,$1::uuid AS outlet_id,command_type,authority_version,required_capabilities FROM system.commands ORDER BY command_type', [outlet])).rows;
        const caps: Record<string, string[]> = { 'catalog.product.create': ['inventory'], 'sales.order.settle': ['commerce', 'inventory'], 'staff.password.set': [] };
        for (const row of descriptors) {
          assert.equal(row.authority_version, 0); assert.deepEqual(row.required_capabilities, caps[row.command_type]);
          requireStoredCommandAuthority({ role: 'admin', capabilities: ['commerce', 'inventory'] } as ApiSession, row);
          if (row.command_type !== 'staff.password.set') assert.throws(() => requireStoredCommandAuthority({ role: 'admin', capabilities: ['commerce'] } as ApiSession, row), error => error instanceof DomainError && error.code === 'CAPABILITY_DISABLED');
        }
        assert.deepEqual(await snapshot(), before, 'capability backfill cannot change original command hashes or canonical responses');
      });
      await t.test('database guards reject nonstock physical evidence and stocked reclassification with carrying stock', async () => {
        const baseline = await snapshot();
        await assert.rejects(client!.query("UPDATE catalog.products SET item_kind='SERVICE' WHERE id=$1", [paid]), { code: '23514' });
        assert.deepEqual(await snapshot(), baseline);
        const balance = (await client!.query('SELECT * FROM inventory.balances WHERE product_id=$1', [zero])).rows[0];
        await client!.query("UPDATE catalog.products SET item_kind='SERVICE' WHERE id=$1", [zero]);
        assert.deepEqual((await client!.query('SELECT * FROM inventory.balances WHERE product_id=$1', [zero])).rows[0], balance, 'legacy zero balance survives explicit classification');
        await assert.rejects(client!.query('UPDATE inventory.balances SET quantity=1,inventory_value_minor=400 WHERE product_id=$1', [zero]), { code: '23514' });
        await assert.rejects(client!.query('UPDATE inventory.balances SET quantity=0,inventory_value_minor=400 WHERE product_id=$1', [zero]), { code: '23514' });
        await assert.rejects(client!.query("INSERT INTO inventory.movements(id,tenant_id,outlet_id,product_id,command_id,movement_type,quantity_delta,unit_cost_minor,value_minor) VALUES($1,$2,$3,$4,$5,'RECEIPT',1,400,400)", [randomUUID(), tenant, outlet, zero, randomUUID()]), { code: '23514' });
        assert.deepEqual((await client!.query('SELECT * FROM inventory.balances WHERE product_id=$1', [zero])).rows[0], balance);
        assert.deepEqual(await snapshot(), baseline, 'only additive classification differs; every original column stays unchanged');
      });
    } finally {
      await client?.end();
      try { if (created) await admin.query(`DROP DATABASE "${name}"`); } finally { await admin.end(); }
    }
  });
}
