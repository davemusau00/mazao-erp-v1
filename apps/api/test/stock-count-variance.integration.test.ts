import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { CommandEnvelope } from '../src/contracts.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  test('mixed stock-count valuation and journal acceptance', { skip: 'Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database.' }, () => {});
} else {
  process.env.DATABASE_URL = databaseUrl;
  process.env.APP_ORIGINS ??= 'http://localhost:3000';
  const [{ buildApp }, { hashPassword }, db] = await Promise.all([
    import('../src/app.js'), import('../src/security.js'), import('../src/db.js'),
  ]);

  async function fixture() {
    const tenantId = randomUUID(), outletId = randomUUID();
    const app = buildApp({ logger: { level: 'silent' } });
    await app.ready();
    await db.pool.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Disposable stock variance acceptance','KES','Africa/Nairobi')", [tenantId]);
    await db.pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Count outlet','Africa/Nairobi')", [outletId, tenantId]);
    await db.pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'inventory')", [tenantId]);

    async function actor(role: 'admin' | 'storekeeper') {
      const userId = randomUUID(), deviceId = randomUUID();
      const email = `stock-count-${userId}@example.invalid`, password = `Disposable-count-${randomUUID()}`;
      await db.pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)', [userId, email, await hashPassword(password), `Count ${role}`]);
      await db.pool.query('INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [tenantId, userId, role]);
      await db.pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Disposable count assignment')", [deviceId, tenantId, outletId, userId]);
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
      assert.equal(login.statusCode, 200, login.body);
      const cookies = login.headers['set-cookie'];
      const cookie = (Array.isArray(cookies) ? cookies : [cookies]).filter((value): value is string => typeof value === 'string').map(value => value.split(';', 1)[0]).join('; ');
      const headers = { cookie, origin: process.env.APP_ORIGINS!.split(',')[0], 'x-csrf-token': login.json().csrfToken };
      const command = (type: string, payload: Record<string, unknown>, expectedVersions: Record<string, number> = {}): CommandEnvelope => ({
        protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId, type, occurredAt: new Date().toISOString(), expectedVersions, payload,
      });
      const submit = (envelope: CommandEnvelope) => app.inject({ method: 'POST', url: '/api/v1/commands', headers, payload: envelope });
      return { userId, headers, command, submit };
    }

    const admin = await actor('admin'), storekeeper = await actor('storekeeper');
    const productIds: string[] = [];
    for (const sku of ['COUNT-A', 'COUNT-B']) {
      const created = await admin.submit(admin.command('catalog.product.create', { sku, name: sku, baseUnit: 'each', currency: 'KES', sellingPriceMinor: 2000, costPriceMinor: 999, taxRateBps: 0 }));
      assert.equal(created.json().status, 'CONFIRMED', created.body);
      productIds.push(created.json().value.productId);
    }
    for (const receipt of [
      [{ productId: productIds[0], quantity: '4', unitCostMinor: 100 }, { productId: productIds[1], quantity: '4', unitCostMinor: 100 }],
      [{ productId: productIds[0], quantity: '6', unitCostMinor: 200 }, { productId: productIds[1], quantity: '6', unitCostMinor: 350 }],
    ]) {
      const received = await admin.submit(admin.command('inventory.receive', { documentReference: 'COUNT-VALUATION-BASELINE', lines: receipt }));
      assert.equal(received.json().status, 'CONFIRMED', received.body);
    }
    // Both items have quantity 10. Their actual average costs are 160 and 250,
    // deliberately different from the setup reference cost of 999.
    const opened = await storekeeper.submit(storekeeper.command('inventory.count.open', { areaLabel: 'Full outlet acceptance' }));
    assert.equal(opened.json().status, 'CONFIRMED', opened.body);
    return { tenantId, outletId, app, admin, storekeeper, productIds, countId: opened.json().value.countId as string };
  }

  async function businessSnapshot(tenantId: string, countId: string) {
    const [balances, movements, journals, count] = await Promise.all([
      db.pool.query('SELECT product_id,quantity::text,inventory_value_minor::text,version::text FROM inventory.balances WHERE tenant_id=$1 ORDER BY product_id', [tenantId]),
      db.pool.query('SELECT id,command_id,movement_type,quantity_delta::text,value_minor::text FROM inventory.movements WHERE tenant_id=$1 ORDER BY id', [tenantId]),
      db.pool.query('SELECT e.id,e.source_type,e.source_id,l.id line_id,l.account_code,l.debit_minor::text,l.credit_minor::text FROM finance.journal_entries e JOIN finance.journal_lines l ON l.tenant_id=e.tenant_id AND l.journal_entry_id=e.id WHERE e.tenant_id=$1 ORDER BY e.id,l.id', [tenantId]),
      db.pool.query('SELECT status,version::text,posted_by,posted_at FROM inventory.stock_counts WHERE tenant_id=$1 AND id=$2', [tenantId, countId]),
    ]);
    return { balances: balances.rows, movements: movements.rows, journals: journals.rows, count: count.rows };
  }

  test('full counts conserve weighted-average value and balanced gross variance evidence', async t => {
    for (const scenario of [
      { name: 'gains only', quantities: ['12', '10'], values: ['1920', '2500'], gain: 320, shrink: 0 },
      { name: 'losses only', quantities: ['8', '10'], values: ['1280', '2500'], gain: 0, shrink: 320 },
      { name: 'unequal mixed gains exceed losses', quantities: ['12', '9'], values: ['1920', '2250'], gain: 320, shrink: 250 },
      { name: 'unequal mixed losses exceed gains', quantities: ['11', '8'], values: ['1760', '2000'], gain: 160, shrink: 500 },
      { name: 'equal mixed values with decimal quantity', quantities: ['15', '6.8'], values: ['2400', '1700'], gain: 800, shrink: 800 },
    ]) {
      await t.test(scenario.name, async () => {
        const f = await fixture();
        try {
          const baseline = await businessSnapshot(f.tenantId, f.countId);
          const saved = await f.storekeeper.submit(f.storekeeper.command('inventory.count.save', { countId: f.countId, lines: f.productIds.map((productId, i) => ({ productId, countedQuantity: scenario.quantities[i], varianceReason: 'Reviewed physical count' })) }, { [`count:${f.countId}`]: 1 }));
          assert.equal(saved.json().status, 'CONFIRMED', saved.body);
          const posting = f.admin.command('inventory.count.post', { countId: f.countId }, { [`count:${f.countId}`]: 2 });
          const [posted, duplicate] = await Promise.all([f.admin.submit(posting), f.admin.submit(posting)]);
          assert.equal(posted.statusCode, 200, posted.body);
          assert.equal(posted.json().status, 'CONFIRMED', posted.body);
          assert.deepEqual(duplicate.json(), posted.json(), 'concurrent exact replay must return the canonical original outcome');
          assert.deepEqual((await f.admin.submit(posting)).json(), posted.json(), 'later exact replay must remain canonical');
          assert.equal(posted.json().value.gainMinor, scenario.gain);
          assert.equal(posted.json().value.shrinkMinor, scenario.shrink);
          assert.equal(posted.json().value.totalVarianceMinor, scenario.gain + scenario.shrink);
          assert.equal(posted.json().value.version, 3);

          const state = await businessSnapshot(f.tenantId, f.countId);
          for (let i = 0; i < f.productIds.length; i++) {
            const balance = state.balances.find(row => row.product_id === f.productIds[i]);
            assert.ok(balance);
            assert.equal(Number(balance.quantity), Number(scenario.quantities[i]));
            assert.equal(balance.inventory_value_minor, scenario.values[i]);
          }
          assert.deepEqual(state.movements.filter(row => row.movement_type === 'RECEIPT'), baseline.movements, 'posted count must preserve all receiving history');
          const movements = state.movements.filter(row => row.command_id === posting.commandId);
          assert.equal(movements.length, scenario.quantities.filter(value => value !== '10').length);
          assert.ok(movements.every(row => row.movement_type === 'COUNT_ADJUSTMENT'));
          assert.equal(movements.reduce((sum, row) => sum + BigInt(row.value_minor), 0n), BigInt(scenario.gain + scenario.shrink));

          const lines = state.journals.filter(row => row.source_id === posting.commandId);
          assert.equal(new Set(lines.map(row => row.id)).size, 1, 'one command must post exactly one variance journal');
          assert.equal(lines.reduce((sum, row) => sum + BigInt(row.debit_minor) - BigInt(row.credit_minor), 0n), 0n);
          assert.ok(lines.every(row => (BigInt(row.debit_minor) > 0n) !== (BigInt(row.credit_minor) > 0n)), 'every journal line has exactly one positive side');
          const inventory = lines.filter(row => row.account_code === 'INVENTORY');
          assert.equal(inventory.reduce((sum, row) => sum + BigInt(row.debit_minor), 0n), BigInt(scenario.gain));
          assert.equal(inventory.reduce((sum, row) => sum + BigInt(row.credit_minor), 0n), BigInt(scenario.shrink));
          assert.equal(lines.filter(row => row.account_code === 'INVENTORY_COUNT_GAIN').reduce((sum, row) => sum + BigInt(row.credit_minor), 0n), BigInt(scenario.gain));
          assert.equal(lines.filter(row => row.account_code === 'INVENTORY_COUNT_SHRINKAGE').reduce((sum, row) => sum + BigInt(row.debit_minor), 0n), BigInt(scenario.shrink));
          assert.deepEqual(state.journals.filter(row => row.source_id !== posting.commandId), baseline.journals, 'prior financial evidence must remain unchanged');
          assert.equal(state.count[0].status, 'POSTED');
          assert.equal(state.count[0].posted_by, f.admin.userId);
          for (const table of ['audit_events', 'transactional_outbox']) {
            const evidence = await db.pool.query(`SELECT count(*)::int n FROM system.${table} WHERE tenant_id=$1 AND command_id=$2`, [f.tenantId, posting.commandId]);
            assert.equal(evidence.rows[0].n, 1, `${table} must contain one posting event despite replay`);
          }
          const projected = await f.app.inject({ url: `/api/v1/inventory/counts/${f.countId}`, headers: f.storekeeper.headers });
          assert.equal(projected.statusCode, 200, projected.body);
          assert.equal(projected.json().count.status, 'POSTED');
        } finally { await f.app.close(); }
      });
    }
  });

  test('mixed-count posting rejects unauthorized and invalid work without partial stock or financial effects', async () => {
    const f = await fixture();
    try {
      const ordered = [...f.productIds].sort();
      const draft = { countId: f.countId, lines: ordered.map((productId, i) => ({ productId, countedQuantity: i === 0 ? '12' : '8', varianceReason: i === 0 ? 'Reviewed gain' : null })) };
      const saved = await f.storekeeper.submit(f.storekeeper.command('inventory.count.save', draft, { [`count:${f.countId}`]: 1 }));
      assert.equal(saved.json().status, 'CONFIRMED', saved.body);
      const before = await businessSnapshot(f.tenantId, f.countId);
      const denied = await f.storekeeper.submit(f.storekeeper.command('inventory.count.post', { countId: f.countId }, { [`count:${f.countId}`]: 2 }));
      assert.equal(denied.json().code, 'FORBIDDEN', denied.body);
      assert.deepEqual(await businessSnapshot(f.tenantId, f.countId), before);

      const invalid = f.admin.command('inventory.count.post', { countId: f.countId }, { [`count:${f.countId}`]: 2 });
      const rejected = await f.admin.submit(invalid);
      assert.equal(rejected.json().status, 'REJECTED', rejected.body);
      assert.equal(rejected.json().code, 'VALIDATION_FAILED', rejected.body);
      assert.deepEqual(await businessSnapshot(f.tenantId, f.countId), before, 'validation after processing the first changed line must roll back its stock/value/movement changes');
      assert.deepEqual((await f.admin.submit(invalid)).json(), rejected.json());
      for (const table of ['audit_events', 'transactional_outbox']) {
        assert.equal((await db.pool.query(`SELECT count(*)::int n FROM system.${table} WHERE tenant_id=$1 AND command_id=$2`, [f.tenantId, invalid.commandId])).rows[0].n, 0);
      }
      const corrected = await f.storekeeper.submit(f.storekeeper.command('inventory.count.save', { ...draft, lines: draft.lines.map(line => ({ ...line, varianceReason: 'Reviewed physical variance' })) }, { [`count:${f.countId}`]: 2 }));
      assert.equal(corrected.json().status, 'CONFIRMED', corrected.body);
      const posted = await f.admin.submit(f.admin.command('inventory.count.post', { countId: f.countId }, { [`count:${f.countId}`]: 3 }));
      assert.equal(posted.json().status, 'CONFIRMED', posted.body);
      assert.equal(posted.json().value.version, 4, 'rejected posting leaves the durable draft available for a reviewed correction');
    } finally { await f.app.close(); }
  });

  test.after(async () => { await db.pool.end(); });
}
