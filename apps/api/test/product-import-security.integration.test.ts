import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { CommandEnvelope } from '../src/contracts.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  test('product import tenant, precision, immutability, replay and bounded-batch acceptance', { skip: 'Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database.' }, () => {});
} else {
  process.env.DATABASE_URL = databaseUrl;
  process.env.APP_ORIGINS ??= 'http://localhost:3000';
  const [{ buildApp }, { hashPassword }, db] = await Promise.all([import('../src/app.js'), import('../src/security.js'), import('../src/db.js')]);
  const origin = process.env.APP_ORIGINS.split(',')[0];
  const password = `Disposable-csv-security-${randomUUID()}`;
  const passwordHash = await hashPassword(password);
  interface Actor { tenantId: string; outletId: string; userId: string; deviceId: string; email: string; headers: Record<string, string> }
  const columns = ['SKU', 'Name', 'Unit', 'Price', 'Cost', 'Tax', 'Currency', 'Barcode', 'Category', 'Reorder', 'Opening', 'Opening cost'];
  const mapping = { sku: 'SKU', name: 'Name', baseUnit: 'Unit', sellingPrice: 'Price', costPrice: 'Cost', taxRatePercent: 'Tax', currency: 'Currency', barcode: 'Barcode', category: 'Category', reorderLevel: 'Reorder', openingQuantity: 'Opening', openingUnitCost: 'Opening cost' };
  const row = (patch: Partial<Record<typeof columns[number], string>> = {}) => {
    const defaults: Record<string, string> = { SKU: 'CSV-ONE', Name: 'CSV item', Unit: 'each', Price: '10.00', Cost: '2.00', Tax: '0', Currency: 'KES', Barcode: '', Category: 'General', Reorder: '0', Opening: '0', 'Opening cost': '2.00' };
    return columns.map(column => patch[column] ?? defaults[column]);
  };
  const csv = (rows: string[][], headers = columns) => [headers, ...rows].map(cells => cells.map(cell => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n');
  async function tenant() {
    const tenantId = randomUUID(), outletId = randomUUID();
    const profile = { taxPolicy: { calculation: 'exclusive', defaultRateBps: 0, label: 'Tax', reviewed: true } };
    await db.pool.query('INSERT INTO core.tenants(id,name,currency,time_zone,business_profile) VALUES($1,$2,\'KES\',\'Africa/Nairobi\',$3::jsonb)', [tenantId, 'Disposable CSV security business', JSON.stringify(profile)]);
    await db.pool.query('INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,$3,\'Africa/Nairobi\')', [outletId, tenantId, 'Disposable CSV security outlet']);
    await db.pool.query('INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,\'inventory\'),($1,\'commerce\'),($1,\'retail\')', [tenantId]);
    return { tenantId, outletId };
  }
  async function actor(app: FastifyInstance, context: { tenantId: string; outletId: string }, role = 'admin'): Promise<Actor> {
    const userId = randomUUID(), deviceId = randomUUID(), email = `csv-security-${userId}@example.invalid`;
    await db.pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)', [userId, email, passwordHash, `CSV ${role}`]);
    await db.pool.query('INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [context.tenantId, userId, role]);
    await db.pool.query('INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,$5)', [deviceId, context.tenantId, context.outletId, userId, 'CSV security device']);
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { email, password } });
    assert.equal(login.statusCode, 200, login.body);
    const raw = login.headers['set-cookie'];
    const cookie = (Array.isArray(raw) ? raw : [raw]).filter((value): value is string => typeof value === 'string').map(value => value.split(';', 1)[0]).join('; ');
    return { ...context, userId, deviceId, email, headers: { cookie, origin, 'x-csrf-token': login.json().csrfToken } };
  }
  function envelope(owner: Actor, type: string, payload: Record<string, unknown>, expectedVersions: Record<string, number> = {}): CommandEnvelope {
    return { protocolVersion: 1, commandId: randomUUID(), tenantId: owner.tenantId, deviceId: owner.deviceId, type, occurredAt: new Date().toISOString(), expectedVersions, payload };
  }
  function submit(app: FastifyInstance, owner: Actor, command: CommandEnvelope) {
    return app.inject({ method: 'POST', url: '/api/v1/commands', headers: owner.headers, payload: command });
  }
  async function stage(app: FastifyInstance, owner: Actor, source: string, mode = 'CREATE_ONLY', overrides: Record<string, unknown> = {}) {
    const command = envelope(owner, 'catalog.import.validate', { fileName: 'security.csv', csv: source, mapping, mode, ...overrides });
    const result = await submit(app, owner, command);
    assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().status, 'CONFIRMED', result.body);
    const response = await app.inject({ url: `/api/v1/catalog/imports/${result.json().value.batchId}`, headers: owner.headers });
    assert.equal(response.statusCode, 200, response.body);
    return { command, outcome: result.json(), batch: response.json().batch };
  }
  function applyEnvelope(owner: Actor, batch: { id: string; version: number }, patch: Record<string, unknown> = {}) {
    return envelope(owner, 'catalog.import.apply', { batchId: batch.id, reviewed: true, acknowledgedWarnings: true, ...patch }, { [`import:${batch.id}`]: batch.version });
  }
  async function authority(owner: Actor) {
    const result = await db.pool.query(`SELECT
      (SELECT count(*)::int FROM catalog.products WHERE tenant_id=$1 AND outlet_id=$2) products,
      (SELECT count(*)::int FROM inventory.movements WHERE tenant_id=$1 AND outlet_id=$2) movements,
      (SELECT count(*)::int FROM finance.journal_entries WHERE tenant_id=$1) journals,
      (SELECT COALESCE(sum(quantity),0)::text FROM inventory.balances WHERE tenant_id=$1 AND outlet_id=$2) quantity,
      (SELECT COALESCE(sum(inventory_value_minor),0)::text FROM inventory.balances WHERE tenant_id=$1 AND outlet_id=$2) value`, [owner.tenantId, owner.outletId]);
    return result.rows[0];
  }
  async function setup() {
    const app = buildApp(); await app.ready();
    const owner = await actor(app, await tenant());
    return { app, owner };
  }
  test('independent adversarial product import acceptance', { timeout: 180_000 }, async t => {
    t.after(async () => { await db.pool.end(); });

    await t.test('staging is tenant/outlet scoped, manager authorized and cannot grant authority from foreign IDs', async () => {
      const { app, owner } = await setup();
      try {
        const foreign = await actor(app, await tenant());
        const cashier = await actor(app, owner, 'cashier');
        const peer = await actor(app, owner, 'admin');
        const otherOutletId = randomUUID();
        await db.pool.query('INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,$3,\'Africa/Nairobi\')', [otherOutletId, owner.tenantId, 'Other scoped outlet']);
        const otherOutlet = await actor(app, { tenantId: owner.tenantId, outletId: otherOutletId });
        const source = csv([row()]);
        const before = await authority(owner);
        const preview = await stage(app, owner, source);
        assert.equal(preview.batch.status, 'READY');
        assert.equal(preview.outcome.value.sourceHash, createHash('sha256').update(source).digest('hex'));
        assert.deepEqual(await authority(owner), before, 'staging must not create products, stock movements or finance');
        assert.equal((await app.inject({ url: `/api/v1/catalog/imports/${preview.batch.id}` })).statusCode, 401);
        for (const unauthorized of [foreign, otherOutlet]) {
          assert.equal((await app.inject({ url: `/api/v1/catalog/imports/${preview.batch.id}`, headers: unauthorized.headers })).statusCode, 404);
          const denied = await submit(app, unauthorized, applyEnvelope(unauthorized, preview.batch));
          assert.equal(denied.json().status, 'REJECTED'); assert.equal(denied.json().code, 'NOT_FOUND');
        }
        const peerDenied = await submit(app, peer, applyEnvelope(peer, preview.batch));
        assert.equal(peerDenied.json().status, 'REJECTED'); assert.equal(peerDenied.json().code, 'FORBIDDEN');
        const cashierDenied = await submit(app, cashier, envelope(cashier, 'catalog.import.validate', { fileName: 'denied.csv', csv: source, mapping, mode: 'CREATE_ONLY' }));
        assert.ok(cashierDenied.statusCode === 403 || cashierDenied.json().status === 'REJECTED');
        assert.equal(cashierDenied.json().error?.code ?? cashierDenied.json().code, 'FORBIDDEN');
        assert.equal((await app.inject({ url: `/api/v1/catalog/imports/${preview.batch.id}`, headers: cashier.headers })).statusCode, 403);
        for (const changed of [{ tenantId: foreign.tenantId }, { deviceId: foreign.deviceId }]) {
          const denied = await submit(app, owner, { ...applyEnvelope(owner, preview.batch), ...changed });
          assert.equal(denied.statusCode, 403);
        }
        const mappingDenied = await stage(app, owner, source, 'CREATE_ONLY', { mapping: { ...mapping, sellingPrice: 'Missing header' } });
        assert.equal(mappingDenied.batch.status, 'INVALID');
        assert.ok(mappingDenied.batch.errors.some((error: { code: string }) => error.code === 'MAPPING_HEADER'));
        assert.deepEqual(await authority(owner), before);
        assert.equal((await authority(foreign)).products, 0);
        await db.pool.query('UPDATE identity.memberships SET role=\'cashier\' WHERE tenant_id=$1 AND user_id=$2', [owner.tenantId, owner.userId]);
        const demotedReplay = await submit(app, owner, preview.command);
        assert.equal(demotedReplay.statusCode, 403);
        assert.equal(demotedReplay.json().error.code, 'FORBIDDEN', 'replaying a stored import validation cannot bypass a fresh permission denial');
        assert.equal(demotedReplay.json().status, undefined, 'access denial is not a terminal rejection of the original import');
        assert.equal(demotedReplay.json().commandId, undefined);
        assert.equal(demotedReplay.json().value, undefined, 'the cached authorized result must not be returned after role removal');
        assert.equal((await app.inject({url:`/api/v1/commands/${preview.command.commandId}`,headers:owner.headers})).statusCode,403);
        assert.equal((await app.inject({ url: `/api/v1/catalog/imports/${preview.batch.id}`, headers: owner.headers })).statusCode, 403);
        await db.pool.query('UPDATE identity.memberships SET role=\'admin\' WHERE tenant_id=$1 AND user_id=$2', [owner.tenantId, owner.userId]);
        await db.pool.query('DELETE FROM core.tenant_capabilities WHERE tenant_id=$1 AND capability=\'inventory\'', [owner.tenantId]);
        const disabledReplay = await submit(app, owner, preview.command);
        assert.equal(disabledReplay.statusCode, 403);
        assert.equal(disabledReplay.json().error.code, 'CAPABILITY_DISABLED', 'replaying an old validation cannot bypass a disabled capability');
        assert.equal(disabledReplay.json().status, undefined);
        assert.equal(disabledReplay.json().commandId, undefined);
        assert.equal(disabledReplay.json().value, undefined);
        assert.equal((await app.inject({url:`/api/v1/commands/${preview.command.commandId}`,headers:owner.headers})).statusCode,403);
        assert.equal((await db.pool.query('SELECT status FROM system.commands WHERE tenant_id=$1 AND command_id=$2',[owner.tenantId,preview.command.commandId])).rows[0].status,'CONFIRMED','denial must preserve the original confirmed command evidence');
        assert.deepEqual(await authority(owner), before);
      } finally { await app.close(); }
    });

    await t.test('unsafe encoding and invalid request types fail before a batch can be persisted', async () => {
      const { app, owner } = await setup();
      try {
        const source = csv([row()]);
        const before = await authority(owner);
        for (const csvSource of [source + '\u0000', source + '\uD800', source + '\uFFFD']) {
          const result = await submit(app, owner, envelope(owner, 'catalog.import.validate', { fileName: 'unsafe.csv', csv: csvSource, mapping, mode: 'CREATE_ONLY' }));
          assert.notEqual(result.statusCode, 500, result.body);
          assert.ok(result.statusCode === 400 || result.json().status === 'REJECTED');
          assert.equal(result.json().error?.code ?? result.json().code, 'VALIDATION_FAILED');
        }
        for (const mode of [['UPSERT'], { mode: 'CREATE_ONLY' }, null, true]) {
          const result = await submit(app, owner, envelope(owner, 'catalog.import.validate', { fileName: 'type.csv', csv: source, mapping, mode }));
          assert.notEqual(result.statusCode, 500, result.body);
          assert.ok(result.statusCode === 400 || result.json().status === 'REJECTED');
        }
        assert.equal((await db.pool.query('SELECT count(*)::int count FROM catalog.product_import_batches WHERE tenant_id=$1 AND outlet_id=$2', [owner.tenantId, owner.outletId])).rows[0].count, 0);
        assert.deepEqual(await authority(owner), before);
      } finally { await app.close(); }
    });

    await t.test('invalid decimal money, tax, quantity and scientific barcodes block every row atomically', async () => {
      const { app, owner } = await setup();
      try {
        const cases = [
          ['Price', '1e3'], ['Price', '1.001'], ['Price', '-1.00'], ['Cost', 'NaN'], ['Cost', '90071992547410.00'],
          ['Tax', '16.001'], ['Tax', '1e2'], ['Tax', '100.01'], ['Opening', '1e3'], ['Opening', '-1'], ['Opening', '0.0000001'],
          ['Opening cost', '0.001'], ['Barcode', '1.234E+11'], ['Barcode', '.123e4'], ['Barcode', '1.e4'], ['SKU', '1.234E+11'], ['Currency', 'USD'], ['Reorder', '-1'],
        ];
        for (const [field, value] of cases) {
          const preview = await stage(app, owner, csv([row({ SKU: 'VALID-ROW' }), row({ SKU: 'INVALID-ROW', ...(field === 'Opening cost' ? { Opening: '1' } : {}), [field]: value })]));
          assert.equal(preview.batch.status, 'INVALID', `${field}=${value} was accepted`);
          assert.ok(preview.batch.errors.length > 0);
          const failed = await submit(app, owner, applyEnvelope(owner, preview.batch));
          assert.equal(failed.json().status, 'REJECTED', failed.body); assert.equal(failed.json().code, 'IMPORT_INVALID');
          assert.equal((await authority(owner)).products, 0, 'valid peers of a rejected row cannot partly apply');
          assert.equal((await authority(owner)).movements, 0); assert.equal((await authority(owner)).journals, 0);
        }
        for (const rows of [[row({ SKU: 'DUPLICATE' }), row({ SKU: 'duplicate' })], [row({ SKU: 'A', Barcode: '000012340001' }), row({ SKU: 'B', Barcode: '000012340001' })]]) {
          const preview = await stage(app, owner, csv(rows)); assert.equal(preview.batch.status, 'INVALID');
          assert.equal((await submit(app, owner, applyEnvelope(owner, preview.batch))).json().code, 'IMPORT_INVALID');
        }
      } finally { await app.close(); }
    });

    await t.test('zero opening quantity is acknowledged metadata and creates no fictional inventory value or journal', async () => {
      const { app, owner } = await setup();
      try {
        const preview = await stage(app, owner, csv([row({ Cost: '0', Opening: '0', 'Opening cost': '0' })]));
        assert.equal(preview.batch.status, 'READY'); assert.ok(preview.batch.warnings.length > 0);
        assert.equal(preview.batch.summary.openingValueMinor, '0');
        assert.equal((await submit(app, owner, applyEnvelope(owner, preview.batch, { acknowledgedWarnings: false }))).json().code, 'WARNINGS_NOT_ACKNOWLEDGED');
        assert.equal((await submit(app, owner, applyEnvelope(owner, preview.batch))).json().status, 'CONFIRMED');
        const totals = await authority(owner);
        assert.equal(totals.products, 1); assert.equal(totals.movements, 0); assert.equal(totals.journals, 0); assert.equal(totals.value, '0'); assert.match(totals.quantity, /^0(?:\.0+)?$/);
        const missingOpeningCost = await stage(app, owner, csv([row({ SKU: 'MISSING-OPENING-COST', Cost: '1', Opening: '1', 'Opening cost': '' })]));
        assert.equal(missingOpeningCost.batch.status, 'INVALID');
        assert.ok(missingOpeningCost.batch.errors.some((error:{code:string})=>error.code==='OPENING_COST_REQUIRED'));
        assert.equal((await submit(app, owner, applyEnvelope(owner, missingOpeningCost.batch))).json().code, 'IMPORT_INVALID');
        assert.deepEqual(await authority(owner), totals);
        const zeroValueOpening = await stage(app, owner, csv([row({ SKU: 'ZERO-VALUE-OPENING', Cost: '0', Opening: '1', 'Opening cost': '0' })]));
        assert.equal(zeroValueOpening.batch.status, 'READY');
        assert.ok(zeroValueOpening.batch.warnings.some((warning:{code:string})=>warning.code==='ZERO_OPENING_VALUE'));
        assert.equal(zeroValueOpening.batch.summary.openingValueMinor,'0');
        assert.equal((await submit(app, owner, applyEnvelope(owner, zeroValueOpening.batch,{acknowledgedWarnings:false}))).json().code,'WARNINGS_NOT_ACKNOWLEDGED');
        assert.deepEqual(await authority(owner),totals,'zero-value stock must not apply before its evidence is acknowledged');
        assert.equal((await submit(app, owner, applyEnvelope(owner, zeroValueOpening.batch))).json().status,'CONFIRMED');
        const zeroValueTotals=await authority(owner);
        assert.equal(zeroValueTotals.products,2);assert.equal(zeroValueTotals.movements,1);assert.equal(zeroValueTotals.journals,0);assert.equal(zeroValueTotals.value,'0');assert.match(zeroValueTotals.quantity,/^1(?:\.0+)?$/);
        const zeroMovement=await db.pool.query('SELECT movement_type,quantity_delta::text,unit_cost_minor::text,value_minor::text,reference_id FROM inventory.movements WHERE tenant_id=$1 AND outlet_id=$2',[owner.tenantId,owner.outletId]);
        assert.deepEqual(zeroMovement.rows[0],{movement_type:'OPENING_IMPORT',quantity_delta:'1.000000',unit_cost_minor:'0',value_minor:'0',reference_id:zeroValueOpening.batch.id});
      } finally { await app.close(); }
    });

    await t.test('opening stock uses immutable exact value evidence and metadata updates never rewrite stock, units or currency', async () => {
      const { app, owner } = await setup();
      try {
        const source = csv([
          row({ SKU: '000001', Name: 'Tea, highlands', Unit: 'kg', Price: '12.34', Cost: '2.75', Tax: '16', Barcode: '000012340001', Reorder: '0.25', Opening: '1.125', 'Opening cost': '2.33' }),
          row({ SKU: 'HALF-UP', Name: 'Half minor unit', Price: '1.00', Cost: '0.01', Opening: '0.5', 'Opening cost': '0.01' }),
        ]);
        const preview = await stage(app, owner, source);
        assert.equal(preview.batch.status, 'READY'); assert.equal((await authority(owner)).products, 0);
        const command = applyEnvelope(owner, preview.batch);
        const [first, simultaneous] = await Promise.all([submit(app, owner, command), submit(app, owner, command)]);
        assert.equal(first.json().status, 'CONFIRMED', first.body); assert.deepEqual(simultaneous.json(), first.json());
        assert.deepEqual((await submit(app, owner, command)).json(), first.json(), 'exact replay returns the stored result');
        const products = await db.pool.query(`SELECT p.id,p.sku,p.name,p.base_unit,p.currency,p.barcode,p.category,p.reorder_level::text,p.selling_price_minor::text,p.cost_price_minor::text,p.version::text,
          b.quantity::text,b.inventory_value_minor::text FROM catalog.products p JOIN inventory.balances b ON b.tenant_id=p.tenant_id AND b.outlet_id=p.outlet_id AND b.product_id=p.id
          WHERE p.tenant_id=$1 AND p.outlet_id=$2 ORDER BY p.sku`, [owner.tenantId, owner.outletId]);
        const tea = products.rows.find(product => product.sku === '000001');
        assert.ok(tea); assert.equal(tea.barcode, '000012340001'); assert.equal(tea.quantity, '1.125000'); assert.equal(tea.inventory_value_minor, '262');
        assert.equal(tea.selling_price_minor, '1234'); assert.equal(tea.cost_price_minor, '275');
        const half = products.rows.find(product => product.sku === 'HALF-UP'); assert.equal(half.inventory_value_minor, '1');
        const movements = await db.pool.query('SELECT id,product_id,movement_type,quantity_delta::text,value_minor::text,unit_cost_minor::text FROM inventory.movements WHERE tenant_id=$1 AND outlet_id=$2 ORDER BY product_id', [owner.tenantId, owner.outletId]);
        assert.equal(movements.rowCount, 2); assert.ok(movements.rows.every(movement => movement.movement_type === 'OPENING_IMPORT'));
        assert.deepEqual(movements.rows.map(movement => movement.value_minor).sort(), ['1', '262']);
        const journal = await db.pool.query(`SELECT l.account_code,sum(l.debit_minor)::text debit,sum(l.credit_minor)::text credit
          FROM finance.journal_entries e JOIN finance.journal_lines l ON l.tenant_id=e.tenant_id AND l.journal_entry_id=e.id WHERE e.tenant_id=$1 AND e.source_id=$2 GROUP BY l.account_code`, [owner.tenantId, preview.batch.id]);
        assert.deepEqual(journal.rows.map(line => [line.account_code, line.debit, line.credit]).sort(), [['INVENTORY', '263', '0'], ['OPENING_BALANCE_CLEARING', '0', '263']]);
        const evidence = await db.pool.query(`SELECT
          (SELECT count(*)::int FROM system.audit_events WHERE tenant_id=$1 AND command_id=$2 AND event_type='catalog.import.apply') audit,
          (SELECT count(*)::int FROM system.transactional_outbox WHERE tenant_id=$1 AND command_id=$2 AND event_type='catalog.import.apply') outbox,
          (SELECT count(*)::int FROM system.audit_events WHERE tenant_id=$1 AND command_id=$2 AND event_type='catalog.category.created') category_audit,
          (SELECT count(*)::int FROM system.transactional_outbox WHERE tenant_id=$1 AND command_id=$2 AND event_type='catalog.category.created') category_outbox`, [owner.tenantId, command.commandId]);
        assert.deepEqual(evidence.rows[0], { audit: 1, outbox: 1, category_audit: 1, category_outbox: 1 });
        const after = await authority(owner);
        const newIdRepeat = await submit(app, owner, applyEnvelope(owner, preview.batch));
        assert.ok(['CONFIRMED', 'CONFLICT', 'REJECTED'].includes(newIdRepeat.json().status)); assert.deepEqual(await authority(owner), after, 'a new apply ID cannot duplicate the batch');
        const update = await stage(app, owner, csv([row({ SKU: '000001', Name: 'Updated tea', Unit: 'kg', Price: '15.00', Cost: '99.00', Barcode: '000012340001', Category: 'Pantry', Opening: '0' })]), 'UPSERT');
        assert.equal(update.batch.status, 'READY');
        assert.equal((await submit(app, owner, applyEnvelope(owner, update.batch))).json().status, 'CONFIRMED');
        const updated = await db.pool.query('SELECT name,base_unit,currency,selling_price_minor::text,cost_price_minor::text FROM catalog.products WHERE tenant_id=$1 AND id=$2', [owner.tenantId, tea.id]);
        assert.deepEqual(updated.rows[0], { name: 'Updated tea', base_unit: 'kg', currency: 'KES', selling_price_minor: '1500', cost_price_minor: '9900' });
        assert.deepEqual(await authority(owner), after, 'metadata updates preserve stock and journal control totals');
        assert.deepEqual((await db.pool.query('SELECT id,product_id,movement_type,quantity_delta::text,value_minor::text,unit_cost_minor::text FROM inventory.movements WHERE tenant_id=$1 AND outlet_id=$2 ORDER BY product_id', [owner.tenantId, owner.outletId])).rows, movements.rows);
        for (const patch of [{ Unit: 'g' }, { Currency: 'USD' }, { Opening: '1' }]) {
          const invalid = await stage(app, owner, csv([row({ SKU: '000001', Unit: 'kg', Barcode: '000012340001', ...patch })]), 'UPSERT');
          assert.equal(invalid.batch.status, 'INVALID'); assert.equal((await submit(app, owner, applyEnvelope(owner, invalid.batch))).json().code, 'IMPORT_INVALID');
          assert.deepEqual(await authority(owner), after);
        }
        const duplicateBarcode = await stage(app, owner, csv([row({ SKU: 'OTHER-ITEM', Barcode: '000012340001' })])); assert.equal(duplicateBarcode.batch.status, 'INVALID');
        const duplicateSku = await stage(app, owner, csv([row({ SKU: '000001', Unit: 'kg', Barcode: '000012340999' })])); assert.equal(duplicateSku.batch.status, 'INVALID');
      } finally { await app.close(); }
    });

    await t.test('parallel batches cannot create duplicate SKU or barcode identities', async () => {
      const { app, owner } = await setup();
      try {
        for (const kind of ['sku', 'barcode']) {
          const firstRows = [row({ SKU: kind === 'sku' ? 'RACE-IDENTITY' : 'BARCODE-RACE-A', Barcode: kind === 'barcode' ? '000099990001' : '' })];
          const secondRows = [row({ SKU: kind === 'sku' ? 'RACE-IDENTITY' : 'BARCODE-RACE-B', Barcode: kind === 'barcode' ? '000099990001' : '' })];
          const first = await stage(app, owner, csv(firstRows)), second = await stage(app, owner, csv(secondRows));
          assert.equal(first.batch.status, 'READY'); assert.equal(second.batch.status, 'READY');
          const results = await Promise.all([submit(app, owner, applyEnvelope(owner, first.batch)), submit(app, owner, applyEnvelope(owner, second.batch))]);
          assert.deepEqual(results.map(result => result.json().status).sort(), ['CONFIRMED', 'CONFLICT'], results.map(result => result.body).join('\n'));
          const condition = kind === 'sku' ? 'sku=\'RACE-IDENTITY\'' : 'barcode=\'000099990001\'';
          const count = await db.pool.query(`SELECT count(*)::int count FROM catalog.products WHERE tenant_id=$1 AND outlet_id=$2 AND ${condition}`, [owner.tenantId, owner.outletId]);
          assert.equal(count.rows[0].count, 1);
        }
      } finally { await app.close(); }
    });

    await t.test('tampered source or validation evidence rejects apply without authority effects', async () => {
      const { app, owner } = await setup();
      try {
        for (const kind of ['source', 'report']) {
          const preview = await stage(app, owner, csv([row({ SKU: `TAMPER-${kind}` })]));
          const before = await authority(owner);
          if (kind === 'source') await db.pool.query('UPDATE catalog.product_import_batches SET raw_source=raw_source||\'changed\' WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3', [owner.tenantId, owner.outletId, preview.batch.id]);
          else await db.pool.query('UPDATE catalog.product_import_batches SET validation_report=jsonb_set(validation_report,\'{summary,openingValueMinor}\',\'"999999"\'::jsonb) WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3', [owner.tenantId, owner.outletId, preview.batch.id]);
          const result = await submit(app, owner, applyEnvelope(owner, preview.batch));
          assert.equal(result.json().status, 'CONFLICT', result.body); assert.equal(result.json().code, 'IMPORT_STALE');
          assert.deepEqual(await authority(owner), before);
        }
      } finally { await app.close(); }
    });

    await t.test('apply requires review, warning acknowledgement and an unchanged versioned baseline', async () => {
      const { app, owner } = await setup();
      try {
        const preview = await stage(app, owner, csv([row()]));
        assert.equal((await submit(app, owner, applyEnvelope(owner, preview.batch, { reviewed: false }))).json().code, 'REVIEW_REQUIRED');
        const noVersion = applyEnvelope(owner, preview.batch); noVersion.expectedVersions = {};
        assert.notEqual((await submit(app, owner, noVersion)).json().status, 'CONFIRMED');
        const warning = await stage(app, owner, csv([row({ SKU: 'WARNING', Cost: '0', 'Opening cost': '0' })]));
        assert.equal(warning.batch.status, 'READY'); assert.ok(warning.batch.warnings.length > 0);
        assert.equal((await submit(app, owner, applyEnvelope(owner, warning.batch, { acknowledgedWarnings: false }))).json().code, 'WARNINGS_NOT_ACKNOWLEDGED');
        await db.pool.query('UPDATE core.tenants SET version=version+1 WHERE id=$1', [owner.tenantId]);
        const stale = await submit(app, owner, applyEnvelope(owner, preview.batch));
        assert.equal(stale.json().status, 'CONFLICT', stale.body); assert.equal(stale.json().code, 'IMPORT_STALE');
        assert.equal((await authority(owner)).products, 0);
        const countItem = await submit(app, owner, envelope(owner, 'catalog.product.create', { sku: 'COUNT-BASELINE', name: 'Count baseline item', baseUnit: 'each', currency: 'KES', sellingPriceMinor: 10000, costPriceMinor: 1000, taxRateBps: 0 }));
        assert.equal(countItem.json().status, 'CONFIRMED', countItem.body);
        const refreshed = await stage(app, owner, csv([row({ SKU: 'COUNT-BLOCKED' })]));
        const beforeCount = await authority(owner);
        const count = await submit(app, owner, envelope(owner, 'inventory.count.open', { areaLabel: 'CSV conflict evidence' })); assert.equal(count.json().status, 'CONFIRMED');
        const countBlocked = await submit(app, owner, applyEnvelope(owner, refreshed.batch));
        assert.notEqual(countBlocked.json().status, 'CONFIRMED'); assert.equal(countBlocked.json().code, 'OPEN_COUNT_CONFLICT');
        assert.deepEqual(await authority(owner), beforeCount, 'an import blocked by a count cannot mutate its stock baseline');
        const countId = count.json().value.countId;
        assert.equal((await submit(app, owner, envelope(owner, 'inventory.count.cancel', { countId }, { [`count:${countId}`]: 1 }))).json().status, 'CONFIRMED');
        const base = await stage(app, owner, csv([row({ SKU: 'RACE-ITEM' })])); assert.equal((await submit(app, owner, applyEnvelope(owner, base.batch))).json().status, 'CONFIRMED');
        const first = await stage(app, owner, csv([row({ SKU: 'RACE-ITEM', Name: 'First change' })]), 'UPSERT');
        const second = await stage(app, owner, csv([row({ SKU: 'RACE-ITEM', Name: 'Second change' })]), 'UPSERT');
        assert.equal((await submit(app, owner, applyEnvelope(owner, first.batch))).json().status, 'CONFIRMED');
        const staleProduct = await submit(app, owner, applyEnvelope(owner, second.batch));
        assert.equal(staleProduct.json().status, 'CONFLICT', staleProduct.body); assert.equal(staleProduct.json().code, 'IMPORT_STALE');
        assert.equal((await db.pool.query('SELECT name FROM catalog.products WHERE tenant_id=$1 AND outlet_id=$2 AND sku=\'RACE-ITEM\'', [owner.tenantId, owner.outletId])).rows[0].name, 'First change');
      } finally { await app.close(); }
    });

    await t.test('a full 1000-row bounded import applies within the proxy budget with one audited batch', { timeout: 120_000 }, async measured => {
      const { app, owner } = await setup();
      try {
        const source = csv(Array.from({ length: 1000 }, (_, index) => row({ SKU: `BULK-${String(index).padStart(4, '0')}`, Name: `Bounded import item ${index}`, Cost: '1.00', Opening: index === 0 ? '0.125' : '0', 'Opening cost': '1.00' })));
        const validationStarted = performance.now(); const preview = await stage(app, owner, source); const validationMs = performance.now() - validationStarted;
        assert.equal(preview.batch.status, 'READY'); assert.equal(preview.batch.errors.length, 0);
        assert.equal((await authority(owner)).products, 0);
        const command = applyEnvelope(owner, preview.batch), applyStarted = performance.now();
        const result = await submit(app, owner, command); const applyMs = performance.now() - applyStarted;
        measured.diagnostic(`1000-row CSV validation ${validationMs.toFixed(1)} ms; apply ${applyMs.toFixed(1)} ms.`);
        assert.equal(result.json().status, 'CONFIRMED', result.body);
        assert.ok(validationMs < 55_000, 'validation must leave headroom within the 60-second proxy timeout');
        assert.ok(applyMs < 55_000, 'apply must leave headroom within the 60-second proxy timeout');
        const totals = await authority(owner); assert.equal(totals.products, 1000); assert.equal(totals.movements, 1); assert.equal(totals.value, '13'); assert.equal(totals.journals, 1);
        const evidence = await db.pool.query(`SELECT
          (SELECT count(*)::int FROM system.audit_events WHERE tenant_id=$1 AND command_id=$2 AND event_type='catalog.import.apply') audit,
          (SELECT count(*)::int FROM system.transactional_outbox WHERE tenant_id=$1 AND command_id=$2 AND event_type='catalog.import.apply') outbox,
          (SELECT count(*)::int FROM system.audit_events WHERE tenant_id=$1 AND command_id=$2 AND event_type='catalog.category.created') category_audit,
          (SELECT count(*)::int FROM system.transactional_outbox WHERE tenant_id=$1 AND command_id=$2 AND event_type='catalog.category.created') category_outbox`, [owner.tenantId, command.commandId]); assert.deepEqual(evidence.rows[0], { audit: 1, outbox: 1, category_audit: 1, category_outbox: 1 });
        assert.deepEqual((await submit(app, owner, command)).json(), result.json()); assert.deepEqual(await authority(owner), totals);
      } finally { await app.close(); }
    });
  });
}
