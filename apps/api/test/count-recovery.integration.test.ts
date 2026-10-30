import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import type { ApiRole, CommandEnvelope } from '../src/contracts.js';
import type { CountReview } from '../../../src/types/countRecovery.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) test('movement-aware count review and physical recount acceptance', { skip: 'Requires disposable TEST_DATABASE_URL.' }, () => {});
else {
  process.env.DATABASE_URL = databaseUrl; process.env.APP_ORIGINS ??= 'http://localhost:3000';
  process.env.CREDENTIAL_FINGERPRINT_KEY ??= 'c'.repeat(64);
  const [{ buildApp }, { hashPassword }, db, { hashCommand }] = await Promise.all([import('../src/app.js'), import('../src/security.js'), import('../src/db.js'), import('../src/commands.js')]);
  const password = `Disposable-count-${randomUUID()}`, passwordHash = await hashPassword(password);
  type Actor = { tenantId: string; outletId: string; userId: string; deviceId: string; headers: Record<string, string> };
  let address = 0;
  test('count review preserves movements, physical evidence, authority and exact valuation', { timeout: 240_000 }, async t => {
    const app = buildApp({ logger: { level: 'silent' } }); await app.ready();
    t.after(async () => { await app.close(); await db.pool.end(); });
    async function actor(scope?: Actor, role: ApiRole = 'admin'): Promise<Actor> {
      const tenantId = scope?.tenantId ?? randomUUID(), outletId = scope?.outletId ?? randomUUID(), userId = randomUUID(), deviceId = randomUUID(), email = `count-${userId}@example.invalid`;
      if (!scope) {
        await db.pool.query("INSERT INTO core.tenants(id,name,currency,time_zone,business_profile) VALUES($1,'Disposable count business','KES','Africa/Nairobi',$2::jsonb)", [tenantId, JSON.stringify({ taxPolicy: { calculation: 'exclusive', defaultRateBps: 0, label: 'Tax', reviewed: true } })]);
        await db.pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Count outlet','Africa/Nairobi')", [outletId, tenantId]);
        await db.pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'commerce'),($1,'inventory'),($1,'retail')", [tenantId]);
      }
      await db.pool.query("INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,'Count operator')", [userId, email, passwordHash]);
      await db.pool.query('INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [tenantId, userId, role]);
      await db.pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Disposable count assignment')", [deviceId, tenantId, outletId, userId]);
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `198.51.110.${++address}`, payload: { email, password, deviceId } });
      assert.equal(login.statusCode, 200, login.body);
      const cookies = login.headers['set-cookie'], cookie = (Array.isArray(cookies) ? cookies : [cookies]).filter((value): value is string => typeof value === 'string').map(value => value.split(';', 1)[0]).join('; ');
      return { tenantId, outletId, userId, deviceId, headers: { cookie, origin: process.env.APP_ORIGINS!.split(',')[0], 'x-csrf-token': login.json().csrfToken } };
    }
    const command = (owner: Actor, type: string, payload: Record<string, unknown>, expectedVersions: Record<string, number> = {}): CommandEnvelope => ({ protocolVersion: 1, commandId: randomUUID(), tenantId: owner.tenantId, deviceId: owner.deviceId, type, occurredAt: new Date().toISOString(), expectedVersions, payload });
    const send = (owner: Actor, envelope: CommandEnvelope) => app.inject({ method: 'POST', url: '/api/v1/commands', headers: owner.headers, payload: envelope });
    async function confirmed(owner: Actor, envelope: CommandEnvelope) { const response = await send(owner, envelope); assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().status, 'CONFIRMED', response.body); return response.json(); }
    const execute = async (owner: Actor, type: string, payload: Record<string, unknown>, versions: Record<string, number> = {}) => (await confirmed(owner, command(owner, type, payload, versions))).value;
    async function read(owner: Actor, path: string) { const response = await app.inject({ url: '/api/v1' + path, headers: owner.headers }); assert.equal(response.statusCode, 200, response.body); return response.json(); }
    const count = async (owner: Actor, countId: string) => (await read(owner, '/inventory/counts/' + countId)).count;
    const review = async (owner: Actor, countId: string): Promise<CountReview> => (await read(owner, '/inventory/counts/' + countId + '/review')).review;
    function reviewCommand(owner: Actor, value: CountReview) {
      return command(owner, 'inventory.count.review', { countId: value.countId, reason: 'Reviewed intervening stock evidence; physical recount required', reviewFingerprint: value.fingerprint, affectedProductIds: value.changedLines.map(line => line.productId) },
        Object.fromEntries([[`count:${value.countId}`, value.countVersion], ...value.changedLines.flatMap(line => [[`product:${line.productId}`, line.current.productVersion], [`balance:${line.productId}`, line.current.balanceVersion!]])]));
    }
    async function item(owner: Actor, sku: string, quantity: string, cost: number) {
      const created = await execute(owner, 'catalog.product.create', { sku, name: sku + ' goods', baseUnit: 'each', currency: 'KES', sellingPriceMinor: 1000, costPriceMinor: cost, taxRateBps: 0 });
      if (quantity !== '0') await execute(owner, 'inventory.receive', { lines: [{ productId: created.productId, quantity, unitCostMinor: cost }] });
      return created.productId as string;
    }
    async function save(owner: Actor, current: any, quantities: Record<string, string | null>, reasons: Record<string, string> = {}) {
      return execute(owner, 'inventory.count.save', { countId: current.id, lines: current.lines.map((line: any) => ({ productId: line.productId, countedQuantity: Object.hasOwn(quantities, line.productId) ? quantities[line.productId] : line.countedQuantity, varianceReason: reasons[line.productId] ?? line.varianceReason })) }, { [`count:${current.id}`]: current.version });
    }
    async function sale(owner: Actor, shiftId: string, productId: string, quantity = '1') {
      const current = (await read(owner, '/shifts/current')).shift;
      const [whole, fraction = ''] = quantity.split('.'), minor = Number((BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))) / 1000n);
      const value = await execute(owner, 'sales.order.settle', { shiftId, lines: [{ productId, quantity }], tenders: [{ method: 'CASH', amountMinor: minor, currency: 'KES' }] }, { [`shift:${shiftId}`]: current.version });
      const receipt = await read(owner, '/sales/orders/' + value.saleId + '/receipt'); return { value, lineId: receipt.lines[0].lineId };
    }
    async function evidence(owner: Actor) {
      const result: Record<string, unknown> = {};
      for (const table of ['inventory.stock_counts', 'inventory.stock_count_lines', 'inventory.stock_count_events', 'inventory.stock_count_line_events', 'inventory.balances', 'inventory.movements', 'commerce.orders', 'commerce.order_lines', 'commerce.refunds', 'commerce.refund_lines', 'commerce.shifts', 'finance.journal_entries', 'finance.journal_lines']) result[table] = (await db.pool.query(`SELECT to_jsonb(e)::text evidence FROM ${table} e WHERE tenant_id=$1 ORDER BY to_jsonb(e)::text`, [owner.tenantId])).rows;
      return result;
    }
    const conflict = (response: any, code: string) => { assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().status, 'CONFLICT', response.body); assert.equal(response.json().code, code, response.body); };

    await t.test('selected blind counts isolate saved scope and keep baseline evidence private to approvers', async () => {
      const owner = await actor(), counter = await actor(owner, 'storekeeper');
      const selected = await item(owner, 'SPOT-A', '5', 100), outside = await item(owner, 'SPOT-B', '7', 200);
      const opened = await execute(counter, 'inventory.count.open', { scope: 'SELECTED', productIds: [selected], blind: true, areaLabel: 'Dry goods spot check' });
      let hidden = await count(counter, opened.countId);
      assert.equal(hidden.scope, 'SELECTED'); assert.equal(hidden.blind, true); assert.equal(hidden.lineCount, 1);
      assert.deepEqual(hidden.lines.map((line: any) => line.productId), [selected]);
      assert.equal(hidden.lines[0].expectedQuantity, null); assert.equal(hidden.lines[0].referenceCostMinor, undefined); assert.equal(hidden.lines[0].inventoryValueMinor, undefined);
      assert.equal((await read(counter, '/inventory/counts')).counts[0].scope, 'SELECTED');
      assert.equal((await read(counter, '/inventory/counts')).counts[0].blind, true);
      const openEvents = await read(counter, `/inventory/counts/${opened.countId}/events`);
      const openedEvidence = await read(counter, `/inventory/counts/${opened.countId}/events/${openEvents.events[0].id}`);
      assert.equal(openedEvidence.lines[0].after.expectedQuantity, null);
      assert.equal((await app.inject({ url: `/api/v1/inventory/counts/${opened.countId}/review`, headers: counter.headers })).statusCode, 403);

      const leakedLine = { productId: outside, countedQuantity: '0', varianceReason: 'Must not enter a selected count' };
      const forgedSave = await send(counter, command(counter, 'inventory.count.save', { countId: opened.countId, lines: [...hidden.lines.map((line: any) => ({ productId: line.productId, countedQuantity: '5', varianceReason: null })), leakedLine] }, { [`count:${opened.countId}`]: hidden.version }));
      assert.equal(forgedSave.json().status, 'REJECTED'); assert.equal(forgedSave.json().code, 'VALIDATION_FAILED');

      const invalidSelection = await send(counter, command(counter, 'inventory.count.open', { scope: 'SELECTED', productIds: [outside, randomUUID()] }));
      assert.equal(invalidSelection.json().status, 'REJECTED'); assert.equal(invalidSelection.json().code, 'VALIDATION_FAILED');
      await execute(owner, 'inventory.receive', { lines: [{ productId: outside, quantity: '1', unitCostMinor: 250 }] });
      const createdOutside = await item(owner, 'SPOT-NEW-AFTER-OPEN', '3', 50);
      const managerView = await count(owner, opened.countId);
      assert.equal(managerView.lines[0].expectedQuantity, '5.000000');
      await save(counter, hidden, { [selected]: '5' });
      hidden = await count(counter, opened.countId);
      const post = await execute(owner, 'inventory.count.post', { countId: opened.countId }, { [`count:${opened.countId}`]: hidden.version });
      assert.equal(post.adjustedLineCount, 0);
      const balances = (await db.pool.query('SELECT product_id,quantity::text FROM inventory.balances WHERE tenant_id=$1 ORDER BY product_id', [owner.tenantId])).rows;
      assert.equal(balances.find((row: any) => row.product_id === selected).quantity, '5.000000');
      assert.equal(balances.find((row: any) => row.product_id === outside).quantity, '8.000000');
      assert.equal(balances.find((row: any) => row.product_id === createdOutside).quantity, '3.000000');
    });

    await t.test('sale review clears only affected physical counts and original-ID replay creates one event', async () => {
      const owner = await actor(), a = await item(owner, 'COUNT-A', '10', 100), b = await item(owner, 'COUNT-B', '5', 200);
      const shift = await execute(owner, 'shift.open', { openingFloatMinor: 0 }), opened = await execute(owner, 'inventory.count.open', { areaLabel: 'Explicit recount' });
      let current = await count(owner, opened.countId);
      await save(owner, current, { [a]: '9', [b]: '5' }, { [a]: 'Earlier physical shortage', [b]: 'Unaffected saved explanation' });
      await sale(owner, shift.shiftId, a);
      const preview = await review(owner, opened.countId);
      assert.equal(preview.changedLines.length, 1); assert.equal(preview.changedLines[0].productId, a);
      assert.equal(preview.changedLines[0].previous.countedQuantity, '9.000000'); assert.equal(preview.changedLines[0].current.quantity, '9.000000');
      assert.ok(preview.changedLines[0].movements.some(line => line.type === 'SALE'));
      const before = await evidence(owner);
      conflict(await send(owner, command(owner, 'inventory.count.post', { countId: opened.countId }, { [`count:${opened.countId}`]: 2 })), 'COUNT_REVIEW_REQUIRED');
      assert.deepEqual(await evidence(owner), before);
      const envelope = reviewCommand(owner, preview), [first, duplicate] = await Promise.all([send(owner, envelope), send(owner, envelope)]);
      assert.equal(first.json().status, 'CONFIRMED', first.body); assert.deepEqual(duplicate.json(), first.json());
      current = await count(owner, opened.countId);
      const changed = current.lines.find((line: any) => line.productId === a), unchanged = current.lines.find((line: any) => line.productId === b);
      assert.equal(current.version, 3); assert.equal(current.revision, 2); assert.equal(changed.countedQuantity, null); assert.equal(changed.requiresRecount, true);
      assert.equal(changed.varianceReason, null); assert.equal(unchanged.countedQuantity, '5.000000'); assert.equal(unchanged.varianceReason, 'Unaffected saved explanation'); assert.equal(unchanged.baselineRevision, 1);
      const detail = await read(owner, `/inventory/counts/${opened.countId}/events/${first.json().value.reviewId}`);
      assert.equal(detail.lines[0].before.countedQuantity, '9.000000'); assert.equal(detail.lines[0].before.varianceReason, 'Earlier physical shortage'); assert.equal(detail.lines[0].after.countedQuantity, null);
      await save(owner, current, { [a]: '9' }); current = await count(owner, opened.countId);
      const post = command(owner, 'inventory.count.post', { countId: current.id }, { [`count:${current.id}`]: current.version });
      const posted = await confirmed(owner, post); assert.equal(posted.value.totalVarianceMinor, 0);
      assert.deepEqual((await read(owner, '/commands/' + envelope.commandId)).response, { status: 'CONFIRMED', value: first.json().value });
      assert.deepEqual((await confirmed(owner, envelope)), first.json());
      const events = await read(owner, `/inventory/counts/${opened.countId}/events`);
      assert.deepEqual(events.events.map((event: any) => event.eventType), ['POSTED', 'SAVED', 'REVIEWED', 'SAVED', 'OPENED']);
      assert.equal(events.events.filter((event: any) => event.commandId === envelope.commandId).length, 1);
      assert.doesNotMatch(JSON.stringify([preview, current, detail, events, first.json()]), /review_nonce/);
    });

    await t.test('decimal receipt and restocked refund review preserves gross valuation and later COGS', async () => {
      const owner = await actor(), a = await item(owner, 'DECIMAL-A', '2.5', 100), b = await item(owner, 'DECIMAL-B', '1', 200);
      const shift = await execute(owner, 'shift.open', { openingFloatMinor: 10000 });
      const firstSale = await sale(owner, shift.shiftId, a, '0.5'), secondSale = await sale(owner, shift.shiftId, a, '0.5');
      const opened = await execute(owner, 'inventory.count.open', {}); let current = await count(owner, opened.countId);
      await save(owner, current, { [a]: '1.5', [b]: '1.5' }, { [b]: 'Count gain observed' });
      await execute(owner, 'inventory.receive', { lines: [{ productId: a, quantity: '0.5', unitCostMinor: 200 }] });
      async function refund(original: typeof firstSale, restock: boolean) {
        const s = (await read(owner, '/shifts/current')).shift;
        return execute(owner, 'sales.order.refund', { orderId: original.value.saleId, shiftId: shift.shiftId, reason: 'Reviewed original decimal return', lines: [{ orderLineId: original.lineId, quantity: '0.5', restock }] }, { [`shift:${shift.shiftId}`]: s.version });
      }
      await refund(firstSale, true);
      const beforeNonstock = await review(owner, opened.countId); await refund(secondSale, false);
      const preview = await review(owner, opened.countId);
      assert.equal(preview.fingerprint, beforeNonstock.fingerprint, 'a refund without stock return does not change the physical review');
      assert.equal(preview.changedLines[0].current.quantity, '2.500000'); assert.equal(preview.changedLines[0].current.inventoryValueMinor, '300');
      assert.deepEqual(preview.changedLines[0].movements.map(line => line.type), ['RECEIPT', 'REFUND']);
      await confirmed(owner, reviewCommand(owner, preview)); current = await count(owner, opened.countId);
      await save(owner, current, { [a]: '2.25' }, { [a]: 'Recount confirms quarter-unit shortage' }); current = await count(owner, opened.countId);
      const posted = await execute(owner, 'inventory.count.post', { countId: current.id }, { [`count:${current.id}`]: current.version });
      assert.equal(posted.gainMinor, 100); assert.equal(posted.shrinkMinor, 30); assert.equal(posted.totalVarianceMinor, 130);
      const later = await sale(owner, shift.shiftId, a, '0.25');
      const balances = (await db.pool.query('SELECT product_id,quantity::text,inventory_value_minor::text FROM inventory.balances WHERE tenant_id=$1 ORDER BY product_id', [owner.tenantId])).rows;
      assert.deepEqual(balances.find(row => row.product_id === a), { product_id: a, quantity: '2.000000', inventory_value_minor: '240' });
      assert.deepEqual(balances.find(row => row.product_id === b), { product_id: b, quantity: '1.500000', inventory_value_minor: '300' });
      const laterCost = (await db.pool.query('SELECT cogs_minor::text FROM commerce.order_lines WHERE tenant_id=$1 AND order_id=$2', [owner.tenantId, later.value.saleId])).rows[0]; assert.equal(laterCost.cogs_minor, '30');
      const ledger = (await db.pool.query("SELECT (sum(debit_minor)-sum(credit_minor))::text value FROM finance.journal_lines WHERE tenant_id=$1 AND account_code='INVENTORY'", [owner.tenantId])).rows[0]; assert.equal(ledger.value, '540');
      const unbalanced = await db.pool.query('SELECT j.id FROM finance.journal_entries j JOIN finance.journal_lines l ON l.journal_entry_id=j.id WHERE j.tenant_id=$1 GROUP BY j.id HAVING sum(debit_minor)<>sum(credit_minor)', [owner.tenantId]); assert.equal(unbalanced.rowCount, 0);
    });

    await t.test('preview drift and competing reviews or posts never overwrite fresh stock or evidence', async () => {
      const owner = await actor(), a = await item(owner, 'RACE-A', '10', 100), opened = await execute(owner, 'inventory.count.open', {});
      await save(owner, await count(owner, opened.countId), { [a]: '9' }, { [a]: 'Initial discrepancy' });
      await execute(owner, 'inventory.receive', { lines: [{ productId: a, quantity: '1', unitCostMinor: 100 }] });
      const stale = reviewCommand(owner, await review(owner, opened.countId));
      await execute(owner, 'inventory.receive', { lines: [{ productId: a, quantity: '1', unitCostMinor: 100 }] });
      let before = await evidence(owner); conflict(await send(owner, stale), 'VERSION_CONFLICT'); assert.deepEqual(await evidence(owner), before);
      const preview = await review(owner, opened.countId), left = reviewCommand(owner, preview), right = reviewCommand(owner, preview);
      const outcomes = await Promise.all([send(owner, left), send(owner, right)]); assert.deepEqual(outcomes.map(result => result.json().status).sort(), ['CONFIRMED', 'CONFLICT']);
      let current = await count(owner, opened.countId); await save(owner, current, { [a]: '12' }); current = await count(owner, opened.countId);
      await execute(owner, 'inventory.receive', { lines: [{ productId: a, quantity: '1', unitCostMinor: 100 }] });
      before = await evidence(owner); conflict(await send(owner, command(owner, 'inventory.count.post', { countId: current.id }, { [`count:${current.id}`]: current.version })), 'COUNT_REVIEW_REQUIRED'); assert.deepEqual(await evidence(owner), before);
      await confirmed(owner, reviewCommand(owner, await review(owner, opened.countId))); current = await count(owner, opened.countId);
      await save(owner, current, { [a]: '12' }, { [a]: 'Recount after receipt confirms one shortage' }); current = await count(owner, opened.countId);
      const posts = await Promise.all([1, 2].map(() => send(owner, command(owner, 'inventory.count.post', { countId: current.id }, { [`count:${current.id}`]: current.version }))));
      assert.deepEqual(posts.map(result => result.json().status).sort(), ['CONFIRMED', 'CONFLICT']);
      const postedEvents = await db.pool.query("SELECT id FROM inventory.stock_count_events WHERE tenant_id=$1 AND event_type='POSTED'", [owner.tenantId]); assert.equal(postedEvents.rowCount, 1);
      const journals = await db.pool.query("SELECT id FROM finance.journal_entries WHERE tenant_id=$1 AND source_type='INVENTORY_COUNT'", [owner.tenantId]); assert.equal(journals.rowCount, 1);
    });

    await t.test('ordinal evidence reaches every movement beyond the first page and survives the transaction timestamp trap', async () => {
      await db.pool.query("SELECT setval(pg_get_serial_sequence('inventory.movements','movement_seq'),'9007199254740992'::bigint,true)");
      const owner = await actor(), a = await item(owner, 'ORDINAL-A', '1', 100), delayed = await db.pool.connect();
      try {
        await delayed.query('BEGIN'); const started = (await delayed.query('SELECT now()::text stamp')).rows[0].stamp;
        const opened = await execute(owner, 'inventory.count.open', {});
        // A disposable DB writer follows the supported admission/product/balance
        // order. Its now() remains the start preceding the count snapshot.
        await delayed.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('catalog:'||$1::text||':'||$2::text,0))", [owner.tenantId, owner.outletId]);
        await delayed.query('SELECT id FROM catalog.products WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3 FOR UPDATE', [owner.tenantId, owner.outletId, a]);
        await delayed.query('SELECT product_id FROM inventory.balances WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3 FOR UPDATE', [owner.tenantId, owner.outletId, a]);
        const movementId = randomUUID(), delayedCommand = command(owner, 'inventory.receive', { lines: [{ productId: a, quantity: '1', unitCostMinor: 100 }] }), commandId = delayedCommand.commandId;
        const outcome = { status: 'CONFIRMED', value: { receiptId: commandId, lineCount: 1, totalMinor: 100, currency: 'KES', documentReference: null, supplierName: null } };
        await delayed.query("INSERT INTO system.commands(tenant_id,command_id,actor_id,device_id,command_type,request_hash,status,response,completed_at,authority_version,required_capabilities) VALUES($1,$2,$3,$4,'inventory.receive',$5,'CONFIRMED',$6::jsonb,clock_timestamp(),1,ARRAY['inventory'])", [owner.tenantId, commandId, owner.userId, owner.deviceId, hashCommand(delayedCommand), JSON.stringify(outcome)]);
        await delayed.query('UPDATE inventory.balances SET quantity=quantity+1,inventory_value_minor=inventory_value_minor+100,version=version+1 WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3', [owner.tenantId, owner.outletId, a]);
        await delayed.query("INSERT INTO inventory.movements(id,tenant_id,outlet_id,product_id,command_id,movement_type,quantity_delta,unit_cost_minor,value_minor) VALUES($1,$2,$3,$4,$5,'RECEIPT',1,100,100)", [movementId, owner.tenantId, owner.outletId, a, commandId]);
        const journalId = randomUUID();
        await delayed.query("INSERT INTO finance.journal_entries(id,tenant_id,source_type,source_id,currency,created_by) VALUES($1,$2,'INVENTORY_RECEIPT',$3,'KES',$4)", [journalId, owner.tenantId, commandId, owner.userId]);
        await delayed.query("INSERT INTO finance.journal_lines(id,tenant_id,journal_entry_id,account_code,debit_minor,credit_minor) VALUES($1,$2,$3,'INVENTORY',100,0),($4,$2,$3,'GOODS_RECEIVED_NOT_INVOICED',0,100)", [randomUUID(), owner.tenantId, journalId, randomUUID()]);
        await delayed.query("INSERT INTO system.audit_events(id,tenant_id,outlet_id,actor_id,command_id,event_type,payload) VALUES($1,$2,$3,$4,$5,'inventory.receive',$6::jsonb)", [randomUUID(), owner.tenantId, owner.outletId, owner.userId, commandId, JSON.stringify(outcome.value)]);
        await delayed.query("INSERT INTO system.transactional_outbox(id,tenant_id,command_id,event_type,payload) VALUES($1,$2,$3,'inventory.receive',$4::jsonb)", [randomUUID(), owner.tenantId, commandId, JSON.stringify(outcome.value)]);
        await delayed.query('COMMIT');
        assert.equal((await db.pool.query('SELECT m.created_at<c.baseline_at earlier FROM inventory.movements m JOIN inventory.stock_counts c ON c.tenant_id=m.tenant_id AND c.outlet_id=m.outlet_id WHERE m.id=$1 AND c.id=$2', [movementId, opened.countId])).rows[0].earlier, true);
        for (let index = 0; index < 24; index++) await execute(owner, 'inventory.receive', { lines: [{ productId: a, quantity: '1', unitCostMinor: 100 }] });
        const preview = await review(owner, opened.countId), changed = preview.changedLines[0];
        assert.equal(changed.movementPage.totalCount, 25); assert.equal(changed.movements.length, 10); assert.ok(changed.movementPage.nextCursor);
        await execute(owner, 'inventory.receive', { lines: [{ productId: a, quantity: '1', unitCostMinor: 100 }] });
        for (const field of [5, 6]) {
          const token = JSON.parse(Buffer.from(changed.movementPage.nextCursor!, 'base64url').toString('utf8'));
          token[field] = field === 5 ? (BigInt(token[5]) + 1n).toString() : token[4];
          const tampered = Buffer.from(JSON.stringify(token)).toString('base64url');
          const rejected = await app.inject({ url: `/api/v1/inventory/counts/${opened.countId}/review/movements?after=${tampered}`, headers: owner.headers });
          assert.equal(rejected.statusCode, 400); assert.equal(rejected.json().error.code, 'VALIDATION_FAILED');
        }
        const all = [...changed.movements]; let page = changed.movementPage;
        while (page.nextCursor) { const next = await read(owner, `/inventory/counts/${opened.countId}/review/movements?after=${page.nextCursor}`); assert.equal(next.page.upperInclusive, changed.movementPage.upperInclusive); assert.equal(next.page.totalCount, 25); all.push(...next.movements); page = next.page; }
        assert.equal(all.length, 25); assert.equal(new Set(all.map(line => line.id)).size, 25); assert.ok(all.some(line => line.id === movementId));
        assert.ok(all.every(line => BigInt(line.sequence) > 9_007_199_254_740_991n));
        assert.ok(Date.parse(started) <= Date.parse(opened.baselineAt));
        const oldCursor = changed.movementPage.nextCursor!; await confirmed(owner, reviewCommand(owner, await review(owner, opened.countId)));
        const rejectedCursor = await app.inject({ url: `/api/v1/inventory/counts/${opened.countId}/review/movements?after=${oldCursor}`, headers: owner.headers });
        assert.equal(rejectedCursor.statusCode, 409); assert.equal(rejectedCursor.json().error.code, 'VERSION_CONFLICT');
      } finally { try { await delayed.query('ROLLBACK'); } catch {} delayed.release(); }
    });

    await t.test('physical membership and reference-cost review preserve harmless metadata and ordinary catalogue gates', async () => {
      const owner = await actor(), a = await item(owner, 'METADATA-A', '2', 100), opened = await execute(owner, 'inventory.count.open', {});
      const original = await count(owner, opened.countId); await save(owner, original, { [a]: '2' });
      const catalog = (await read(owner, '/catalog/items')).items.find((row: any) => row.id === a);
      const metadata = { productId: a, name: 'Future metadata name', sellingPriceMinor: 2000, costPriceMinor: 100, taxRateBps: 0, category: '', barcode: null, reorderLevel: '0', reason: 'Price and display metadata only' };
      await execute(owner, 'catalog.product.update', metadata, { [`product:${a}`]: catalog.productVersion });
      assert.equal((await review(owner, opened.countId)).changedLines.length, 0); assert.equal((await count(owner, opened.countId)).lines[0].name, 'METADATA-A goods');
      const blocked = await send(owner, command(owner, 'catalog.product.update', { ...metadata, costPriceMinor: 200 }, { [`product:${a}`]: catalog.productVersion + 1 })); conflict(blocked, 'OPEN_COUNT_CONFLICT');
      const blockedCreate = await send(owner, command(owner, 'catalog.product.create', { sku: 'BLOCKED-GOODS', name: 'Blocked goods', baseUnit: 'each', currency: 'KES', sellingPriceMinor: 1, costPriceMinor: 1 })); conflict(blockedCreate, 'OPEN_COUNT_CONFLICT');
      await execute(owner, 'catalog.product.create', { sku: 'ALLOWED-SERVICE', name: 'Service during count', itemKind: 'SERVICE', baseUnit: 'hour', currency: 'KES', sellingPriceMinor: 100, costPriceMinor: 0 });
      assert.equal((await review(owner, opened.countId)).changedLines.length, 0);
      const added = randomUUID();
      await db.pool.query("INSERT INTO catalog.products(id,tenant_id,outlet_id,sku,name,base_unit,currency,selling_price_minor,cost_price_minor,tax_rate_bps) VALUES($1,$2,$3,'LEGACY-ADDED','Legacy writer new goods','each','KES',1,100,0)", [added, owner.tenantId, owner.outletId]);
      await db.pool.query('INSERT INTO inventory.balances(tenant_id,outlet_id,product_id) VALUES($1,$2,$3)', [owner.tenantId, owner.outletId, added]);
      const preview = await review(owner, opened.countId); assert.deepEqual(preview.changedLines.map(line => line.productId), [added]); assert.equal(preview.changedLines[0].newItem, true);
      const omitted = reviewCommand(owner, preview); omitted.payload.affectedProductIds = [a];
      const before = await evidence(owner); conflict(await send(owner, omitted), 'VERSION_CONFLICT'); assert.deepEqual(await evidence(owner), before);
      await confirmed(owner, reviewCommand(owner, preview)); const current = await count(owner, opened.countId);
      assert.equal(current.lines.find((line: any) => line.productId === a).countedQuantity, '2.000000'); assert.equal(current.lines.find((line: any) => line.productId === added).countedQuantity, null);
      await db.pool.query('UPDATE catalog.products SET cost_price_minor=150,version=version+1 WHERE tenant_id=$1 AND id=$2', [owner.tenantId, a]);
      const costReview = await review(owner, opened.countId); assert.deepEqual(costReview.changedLines.map(line => line.productId), [a]); assert.ok(costReview.changedLines[0].changeReasons.includes('REFERENCE_COST_CHANGED'));
    });

    await t.test('review and immutable history retain current authority, cost redaction and strict request intent', async () => {
      const owner = await actor(), a = await item(owner, 'SCOPED-A', '1', 100), counter = await actor(owner, 'storekeeper'), foreign = await actor();
      const opened = await execute(owner, 'inventory.count.open', {}); await save(owner, await count(owner, opened.countId), { [a]: '1' });
      await execute(owner, 'inventory.receive', { lines: [{ productId: a, quantity: '1', unitCostMinor: 200 }] });
      const preview = await review(owner, opened.countId), valid = reviewCommand(owner, preview), before = await evidence(owner);
      for (const patch of [{ reviewFingerprint: '0'.repeat(64) }, { affectedProductIds: [a, a.toUpperCase()] }, { affectedProductIds: [] }, { unsupported: true }]) {
        const response = await send(owner, { ...valid, commandId: randomUUID(), payload: { ...valid.payload, ...patch } });
        assert.ok(['REJECTED', 'CONFLICT'].includes(response.json().status), response.body); assert.notEqual(response.json().status, 'CONFIRMED');
      }
      const staleVersion = { ...valid, commandId: randomUUID(), expectedVersions: { ...valid.expectedVersions, [`balance:${a}`]: 999 } }; conflict(await send(owner, staleVersion), 'VERSION_CONFLICT');
      assert.deepEqual(await evidence(owner), before);
      const counterPreview = await app.inject({ url: `/api/v1/inventory/counts/${opened.countId}/review`, headers: counter.headers }); assert.equal(counterPreview.statusCode, 200); assert.equal(counterPreview.json().review.canReview, false);
      assert.doesNotMatch(counterPreview.body, /referenceCostMinor|inventoryValueMinor|unitCostMinor|valueMinor|review_nonce/);
      const counterDenied = await send(counter, { ...valid, commandId: randomUUID(), deviceId: counter.deviceId }); assert.equal(counterDenied.json().code, 'FORBIDDEN');
      assert.equal((await app.inject({ url: `/api/v1/inventory/counts/${opened.countId}/review`, headers: foreign.headers })).statusCode, 404);
      assert.equal((await app.inject({ url: `/api/v1/inventory/counts/${opened.countId}/review?unknown=1`, headers: owner.headers })).statusCode, 400);
      assert.equal((await app.inject({ url: '/api/v1/inventory/counts/not-a-uuid/review', headers: owner.headers })).statusCode, 400);
      const first = await confirmed(owner, valid), after = await evidence(owner);
      assert.equal((await app.inject({ url: '/api/v1/commands/' + valid.commandId, headers: counter.headers })).statusCode, 404);
      const detail = await app.inject({ url: `/api/v1/inventory/counts/${opened.countId}/events/${first.value.reviewId}`, headers: counter.headers }); assert.equal(detail.statusCode, 200); assert.doesNotMatch(detail.body, /referenceCostMinor|inventoryValueMinor|review_nonce/);
      await db.pool.query("DELETE FROM core.tenant_capabilities WHERE tenant_id=$1 AND capability='inventory'", [owner.tenantId]);
      assert.equal((await app.inject({ url: '/api/v1/commands/' + valid.commandId, headers: owner.headers })).statusCode, 403); assert.equal((await send(owner, valid)).statusCode, 403);
      await db.pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'inventory')", [owner.tenantId]); assert.deepEqual(await confirmed(owner, valid), first); assert.deepEqual(await evidence(owner), after);
    });

    await t.test('zero-baseline estimate requires a reason and reconciles movement, balance, journal and later sale COGS', async () => {
      const owner = await actor(), productId = await item(owner, 'ZERO-BASELINE-ESTIMATE', '0', 123);
      const shift = await execute(owner, 'shift.open', { openingFloatMinor: 0 });
      const opened = await execute(owner, 'inventory.count.open', { areaLabel: 'Known valuation fixture' });
      let current = await count(owner, opened.countId);
      const line = current.lines.find((entry: any) => entry.productId === productId);
      assert.equal(line.expectedQuantity, '0.000000'); assert.equal(line.referenceCostMinor, '123'); assert.equal(line.inventoryValueMinor, '0');
      await save(owner, current, { [productId]: '2.5' }, { [productId]: 'Physical stock found during count' });
      current = await count(owner, opened.countId);
      const before = await evidence(owner);
      const missingReason = command(owner, 'inventory.count.post', { countId: current.id }, { [`count:${current.id}`]: current.version });
      const rejected = await send(owner, missingReason);
      assert.equal(rejected.json().status, 'REJECTED', rejected.body); assert.equal(rejected.json().code, 'VALIDATION_FAILED', rejected.body);
      assert.deepEqual(await evidence(owner), before, 'missing valuation approval cannot change stock, movements or journals');
      assert.equal((await db.pool.query('SELECT count(*)::int total FROM system.audit_events WHERE tenant_id=$1 AND command_id=$2', [owner.tenantId, missingReason.commandId])).rows[0].total, 0);

      const reason = 'Catalog opening cost is the reviewed estimate until a supplier invoice verifies purchase cost';
      const post = command(owner, 'inventory.count.post', { countId: current.id, valuationReason: reason }, { [`count:${current.id}`]: current.version });
      const posted = await confirmed(owner, post);
      assert.equal(posted.value.gainMinor, 308); assert.equal(posted.value.shrinkMinor, 0); assert.equal(posted.value.totalVarianceMinor, 308);
      assert.deepEqual(await confirmed(owner, post), posted, 'exact retry returns the canonical posted result');
      const movement = (await db.pool.query("SELECT movement_type,quantity_delta::text,unit_cost_minor::text,value_minor::text FROM inventory.movements WHERE tenant_id=$1 AND command_id=$2", [owner.tenantId, post.commandId])).rows;
      assert.deepEqual(movement, [{ movement_type: 'COUNT_ADJUSTMENT', quantity_delta: '2.500000', unit_cost_minor: '123', value_minor: '308' }]);
      let balance = (await db.pool.query('SELECT quantity::text,inventory_value_minor::text FROM inventory.balances WHERE tenant_id=$1 AND product_id=$2', [owner.tenantId, productId])).rows[0];
      assert.deepEqual(balance, { quantity: '2.500000', inventory_value_minor: '308' });
      const journal = (await db.pool.query('SELECT l.account_code,l.debit_minor::text debit,l.credit_minor::text credit FROM finance.journal_entries e JOIN finance.journal_lines l ON l.tenant_id=e.tenant_id AND l.journal_entry_id=e.id WHERE e.tenant_id=$1 AND e.source_id=$2 ORDER BY l.account_code,l.debit_minor', [owner.tenantId, post.commandId])).rows;
      assert.deepEqual(journal, [
        { account_code: 'INVENTORY', debit: '308', credit: '0' },
        { account_code: 'INVENTORY_COUNT_GAIN', debit: '0', credit: '308' },
      ]);
      const audit = (await db.pool.query('SELECT payload FROM system.audit_events WHERE tenant_id=$1 AND command_id=$2', [owner.tenantId, post.commandId])).rows[0].payload;
      assert.deepEqual(audit.valuationReview, { reason, policy: 'COUNT_OPENING_REFERENCE_COST_ESTIMATE; ZERO_REFERENCE_COST_REQUIRES_MANAGER_REASON', gainLineCount: 1 });
      assert.deepEqual(audit.lines[0].valuation, { origin: 'COUNT_OPENING_REFERENCE_COST_ESTIMATE', unitCostMinor: '123', proposedValueMinor: '308', status: 'ESTIMATE' });
      const history = await read(owner, `/inventory/counts/${opened.countId}/events`);
      assert.equal(history.events.filter((event: any) => event.eventType === 'POSTED').length, 1);
      assert.equal(history.events.find((event: any) => event.eventType === 'POSTED').reason, reason);

      const laterSale = await sale(owner, shift.shiftId, productId, '1.5');
      const saleCogs = (await db.pool.query('SELECT cogs_minor::text FROM commerce.order_lines WHERE tenant_id=$1 AND order_id=$2', [owner.tenantId, laterSale.value.saleId])).rows[0].cogs_minor;
      assert.equal(saleCogs, '185', 'later COGS must allocate the rounded count carrying value');
      balance = (await db.pool.query('SELECT quantity::text,inventory_value_minor::text FROM inventory.balances WHERE tenant_id=$1 AND product_id=$2', [owner.tenantId, productId])).rows[0];
      assert.deepEqual(balance, { quantity: '1.000000', inventory_value_minor: '123' });
      const inventoryControl = (await db.pool.query("SELECT (sum(debit_minor)-sum(credit_minor))::text value FROM finance.journal_lines WHERE tenant_id=$1 AND account_code='INVENTORY'", [owner.tenantId])).rows[0].value;
      assert.equal(inventoryControl, '123');
      const unbalanced = await db.pool.query('SELECT e.id FROM finance.journal_entries e JOIN finance.journal_lines l ON l.tenant_id=e.tenant_id AND l.journal_entry_id=e.id WHERE e.tenant_id=$1 GROUP BY e.id HAVING sum(l.debit_minor)<>sum(l.credit_minor)', [owner.tenantId]);
      assert.equal(unbalanced.rowCount, 0);
    });

    await t.test('zero reference cost stays zero-valued only with explicit manager reason', async () => {
      const owner = await actor(), productId = await item(owner, 'ZERO-REFERENCE-COST', '0', 0);
      const opened = await execute(owner, 'inventory.count.open', {}); let current = await count(owner, opened.countId);
      await save(owner, current, { [productId]: '1' }, { [productId]: 'One unit physically found' }); current = await count(owner, opened.countId);
      const reason = 'Reference cost is unknown; retain the unit at zero until supplier documentation verifies value';
      const post = command(owner, 'inventory.count.post', { countId: current.id, valuationReason: reason }, { [`count:${current.id}`]: current.version });
      const result = await confirmed(owner, post);
      assert.equal(result.value.gainMinor, 0); assert.equal(result.value.shrinkMinor, 0); assert.equal(result.value.adjustedLineCount, 1);
      const movement = (await db.pool.query("SELECT quantity_delta::text,unit_cost_minor::text,value_minor::text FROM inventory.movements WHERE tenant_id=$1 AND command_id=$2", [owner.tenantId, post.commandId])).rows;
      assert.deepEqual(movement, [{ quantity_delta: '1.000000', unit_cost_minor: '0', value_minor: '0' }]);
      const balance = (await db.pool.query('SELECT quantity::text,inventory_value_minor::text FROM inventory.balances WHERE tenant_id=$1 AND product_id=$2', [owner.tenantId, productId])).rows[0];
      assert.deepEqual(balance, { quantity: '1.000000', inventory_value_minor: '0' });
      assert.equal((await db.pool.query('SELECT count(*)::int total FROM finance.journal_entries WHERE tenant_id=$1 AND source_id=$2', [owner.tenantId, post.commandId])).rows[0].total, 0);
      const audit = (await db.pool.query('SELECT payload FROM system.audit_events WHERE tenant_id=$1 AND command_id=$2', [owner.tenantId, post.commandId])).rows[0].payload;
      assert.equal(audit.lines[0].valuation.status, 'ZERO_REFERENCE_COST'); assert.equal(audit.lines[0].valuation.proposedValueMinor, '0'); assert.equal(audit.valuationReview.reason, reason);
    });

    await t.test('full-count capacity is explicit and rejects membership beyond the complete draft limit', async () => {
      const owner = await actor();
      await db.pool.query("INSERT INTO catalog.products(id,tenant_id,outlet_id,sku,name,base_unit,currency,selling_price_minor,cost_price_minor,tax_rate_bps) SELECT gen_random_uuid(),$1,$2,'CAP-'||n,'Capacity item '||n,'each','KES',1,1,0 FROM generate_series(1,5001) n", [owner.tenantId, owner.outletId]);
      await db.pool.query('INSERT INTO inventory.balances(tenant_id,outlet_id,product_id) SELECT tenant_id,outlet_id,id FROM catalog.products WHERE tenant_id=$1', [owner.tenantId]);
      const response = await send(owner, command(owner, 'inventory.count.open', {})); conflict(response, 'COUNT_CAPACITY_EXCEEDED'); assert.equal(response.json().details.lineCount, 5001);
      assert.equal((await db.pool.query('SELECT count(*)::int total FROM inventory.stock_counts WHERE tenant_id=$1', [owner.tenantId])).rows[0].total, 0);
      assert.equal((await db.pool.query('SELECT count(*)::int total FROM inventory.stock_count_events WHERE tenant_id=$1', [owner.tenantId])).rows[0].total, 0);
    });
  });
}
