import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { CommandEnvelope } from '../src/contracts.js';

if (!process.env.TEST_DATABASE_URL) {
  test('durable restaurant orders and immutable fire', { skip: 'Requires disposable PostgreSQL.' }, () => {});
} else {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.APP_ORIGINS ??= 'http://localhost:3000';
  const [{ buildApp }, security, db] = await Promise.all([import('../src/app.js'), import('../src/security.js'), import('../src/db.js')]);
  const origin = process.env.APP_ORIGINS.split(',')[0];
  test('restaurant orders retain quotes and source lines and fire once without trading or stock effects', async t => {
    const app = buildApp({ logger: { level: 'silent' } }); await app.ready();
    type Scope = { tenantId: string; outletId: string };
    type Actor = Scope & { userId: string; deviceId: string; headers: Record<string, string> };
    const password = `Disposable-restaurant-orders-${randomUUID()}`, hash = await security.hashPassword(password);
    const scope = async (tenantId: string = randomUUID()): Promise<Scope> => {
      await db.pool.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Disposable restaurant orders','KES','Africa/Nairobi') ON CONFLICT DO NOTHING", [tenantId]);
      const outletId = randomUUID();
      await db.pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Dining outlet','Africa/Nairobi')", [outletId, tenantId]);
      await db.pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'restaurant'),($1,'commerce'),($1,'inventory') ON CONFLICT DO NOTHING", [tenantId]);
      return { tenantId, outletId };
    };
    let logins = 0;
    const actor = async (context: Scope, role = 'admin'): Promise<Actor> => {
      const userId = randomUUID(), deviceId = randomUUID(), email = `restaurant-order-${userId}@example.invalid`;
      await db.pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)', [userId, email, hash, `Restaurant ${role}`]);
      await db.pool.query('INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [context.tenantId, userId, role]);
      await db.pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Dining logical assignment')", [deviceId, context.tenantId, context.outletId, userId]);
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `198.51.100.${++logins}`, payload: { email, password, deviceId } });
      assert.equal(login.statusCode, 200, login.body);
      const raw = login.headers['set-cookie'], cookie = (Array.isArray(raw) ? raw : [raw]).filter((value): value is string => typeof value === 'string').map(value => value.split(';', 1)[0]).join('; ');
      return { ...context, userId, deviceId, headers: { cookie, origin, 'x-csrf-token': login.json().csrfToken } };
    };
    const envelope = (a: Actor, type: string, payload: Record<string, unknown>, expectedVersions: Record<string, number> = {}): CommandEnvelope => ({ protocolVersion: 1, commandId: randomUUID(), deviceId: a.deviceId, tenantId: a.tenantId, type, occurredAt: new Date().toISOString(), payload, expectedVersions });
    const submit = (a: Actor, command: CommandEnvelope) => app.inject({ method: 'POST', url: '/api/v1/commands', headers: a.headers, payload: command });
    const save = async (a: Actor, type: string, payload: Record<string, unknown>, versions: Record<string, number> = {}) => {
      const response = await submit(a, envelope(a, type, payload, versions)); assert.equal(response.json().status, 'CONFIRMED', response.body); return response.json().value;
    };
    const reject = (response: { statusCode: number; body: string; json(): any }, code?: string) => {
      assert.ok(response.statusCode >= 400 || ['REJECTED', 'CONFLICT'].includes(response.json().status), response.body);
      if (code) assert.equal(response.json().error?.code ?? response.json().code, code, response.body);
    };
    const get = async (a: Actor, path: string) => { const response = await app.inject({ url: `/api/v1${path}`, headers: a.headers }); assert.equal(response.statusCode, 200, response.body); return response.json(); };
    const context = await scope(), admin = await actor(context), waiter = await actor(context, 'waiter'), second = await actor(context, 'waiter'), cook = await actor(context, 'cook');
    const foreign = await actor(await scope()), other = await actor(await scope(context.tenantId));
    const prep = (productId: string, quantity = '1', modifiers: string[] = [], instructions = '') => ({ productId, quantity, modifiers, instructions });
    const quoteVersions = (quotes: any[]) => {
      const versions: Record<string, number> = {};
      for (const q of quotes) { versions[`product:${q.productId}`] = q.productVersion; versions[`menu:${q.productId}`] = q.menuVersion; for (const station of q.stations) versions[`station:${station.id}`] = station.version; }
      return versions;
    };
    const versionsFor = (order: any, quotes: any[]) => ({ [`order:${order.id}`]: order.version, ...quoteVersions(quotes) });
    const details = (a: Actor, orderId: string) => get(a, `/restaurant/orders/${orderId}`);
    const businessEvidence = async () => Promise.all(['inventory.balances', 'inventory.movements', 'commerce.orders', 'commerce.order_lines', 'commerce.payments', 'commerce.shifts', 'finance.journal_entries', 'finance.journal_lines'].map(async table => (await db.pool.query(`SELECT to_jsonb(x)::text evidence FROM ${table} x WHERE tenant_id=$1 ORDER BY to_jsonb(x)::text`, [context.tenantId])).rows));
    let tableId: string, kitchen: string, bar: string, pass: string, meal: string, drink: string;
    let order: any, firstBatch: string, firstTickets: any[], originalLines: any[], originalSale: string, before: unknown, receiptBefore: unknown;
    try {
      tableId = (await save(admin, 'restaurant.table.save', { name: 'Garden 7', sectionId: null, seats: 4, active: true })).tableId;
      kitchen = (await save(admin, 'restaurant.station.save', { name: 'Hot kitchen', kind: 'KITCHEN', charactersPerLine: 42, active: true })).stationId;
      bar = (await save(admin, 'restaurant.station.save', { name: 'Service bar', kind: 'BAR', charactersPerLine: 48, active: true })).stationId;
      pass = (await save(admin, 'restaurant.station.save', { name: 'Pass', kind: 'EXPO', charactersPerLine: 42, active: true })).stationId;
      meal = (await save(admin, 'catalog.product.create', { sku: 'DISH', name: 'Lunch plate', itemKind: 'PREPARED', baseUnit: 'portion', currency: 'KES', sellingPriceMinor: 25000, costPriceMinor: 0, taxRateBps: 1600 })).productId;
      drink = (await save(admin, 'catalog.product.create', { sku: 'DRINK', name: 'Sealed drink', itemKind: 'STOCKED_GOOD', baseUnit: 'each', currency: 'KES', sellingPriceMinor: 10000, costPriceMinor: 5000, taxRateBps: 0 })).productId;
      for (const [productId, stationIds, label] of [[meal, [kitchen, pass], 'Lunch for pass'], [drink, [bar], 'Cold drink']] as const) await save(admin, 'restaurant.menu.save', { productId, stationIds, preparationLabel: label, instructions: 'Check preparation notes', available: true }, { [`product:${productId}`]: 1 });
      await save(admin, 'restaurant.station.assign', { deviceId: cook.deviceId, stationIds: [kitchen] }, { [`device:${cook.deviceId}`]: 1 });
      await save(admin, 'inventory.receive', { documentReference: 'DISPOSABLE-RESTAURANT-BASELINE', lines: [{ productId: drink, quantity: '10', unitCostMinor: 5000 }] });
      const shift = await save(admin, 'shift.open', { openingFloatMinor: 0 });
      originalSale = (await save(admin, 'sales.order.settle', { shiftId: shift.shiftId, lines: [{ productId: drink, quantity: '1' }], tenders: [{ method: 'CASH', amountMinor: 10000, currency: 'KES' }] }, { [`shift:${shift.shiftId}`]: 1, [`product:${drink}`]: 1 })).saleId;
      receiptBefore = await get(admin, `/sales/orders/${originalSale}/receipt`); before = await businessEvidence();
      await t.test('creates durable shared tabs, recovers original creation and enforces label and outlet identity', async () => {
        const command = envelope(waiter, 'restaurant.order.create', { tableId, serviceLabel: 'Lunch group' }, { [`table:${tableId}`]: 1 });
        const response = await submit(waiter, command); assert.equal(response.json().status, 'CONFIRMED', response.body);
        const created = response.json().value; assert.equal(created.status, 'DRAFT'); assert.equal(created.fireRevision, 0);
        assert.deepEqual((await submit(waiter, command)).json(), response.json());
        reject(await submit(waiter, { ...command, payload: { tableId, serviceLabel: 'Different content' } }), 'IDEMPOTENCY_MISMATCH');
        order = (await details(second, created.orderId)).order; assert.equal(order.ownerId, waiter.userId); assert.equal(order.serviceLabel, 'Lunch group');
        reject(await submit(second, envelope(second, 'restaurant.order.create', { tableId, serviceLabel: 'LUNCH GROUP' }, { [`table:${tableId}`]: 1 })), 'RESTAURANT_TAB_LABEL_EXISTS');
        for (const a of [foreign, other]) {
          reject(await app.inject({ url: `/api/v1/restaurant/orders/${order.id}`, headers: a.headers }), 'NOT_FOUND');
          reject(await submit(a, envelope(a, 'restaurant.order.create', { tableId, serviceLabel: 'Foreign table' }, { [`table:${tableId}`]: 1 })), 'NOT_FOUND');
        }
        reject(await app.inject({ url: '/api/v1/restaurant/orders/not-a-uuid', headers: waiter.headers }), 'VALIDATION_FAILED');
      });
      await t.test('saves duplicate-SKU preparation choices as distinct stable source lines', async () => {
        const quotes = (await get(waiter, '/restaurant/menu')).menu;
        await save(second, 'restaurant.order.save', { orderId: order.id, instructions: 'Serve this group together', lines: [prep(meal, '2', ['No salt'], 'Plate one'), prep(meal, '1', ['Extra hot'], 'Plate two'), prep(drink)] }, versionsFor(order, quotes));
        order = (await details(waiter, order.id)).order;
        assert.equal(order.lines.length, 3); assert.equal(new Set(order.lines.map((line: any) => line.id)).size, 3);
        assert.equal(order.lines.filter((line: any) => line.productId === meal).length, 2);
        assert.equal(order.totalMinor, 97000); assert.ok(order.lines.every((line: any) => line.fireRevision === null));
        const ids = order.lines.map((line: any) => line.id).sort();
        const current = (await details(waiter, order.id)).currentQuotes;
        await save(waiter, 'restaurant.order.save', { orderId: order.id, instructions: order.instructions, lines: order.lines.map((line: any) => ({ ...prep(line.productId, line.quantity, line.modifiers, line.instructions), lineId: line.id })) }, versionsFor(order, current));
        order = (await details(waiter, order.id)).order; assert.deepEqual(order.lines.map((line: any) => line.id).sort(), ids);
        for (const invalid of [prep(meal, '0'), prep(meal, '99999999999999'), prep(meal, '1', ['No salt', ' No salt ']), prep(meal, '1', ['Bad\nchoice'])]) {
          reject(await submit(waiter, envelope(waiter, 'restaurant.order.save', { orderId: order.id, instructions: '', lines: [invalid] }, versionsFor(order, current))), 'VALIDATION_FAILED');
        }
        assert.deepEqual((await details(waiter, order.id)).order, order, 'invalid draft saves must leave the reviewed source unchanged');
      });
      await t.test('hold and stale quotes block fire until explicit resume and saved quote review', async () => {
        const held = await save(waiter, 'restaurant.order.hold', { orderId: order.id, held: true, reason: 'Guest requests a pause' }, { [`order:${order.id}`]: order.version });
        order = (await details(waiter, order.id)).order; assert.equal(held.held, true);
        reject(await submit(waiter, envelope(waiter, 'restaurant.order.fire', { orderId: order.id }, versionsFor(order, (await details(waiter, order.id)).currentQuotes))), 'RESTAURANT_ORDER_HELD');
        await save(waiter, 'restaurant.order.hold', { orderId: order.id, held: false, reason: 'Guest ready' }, { [`order:${order.id}`]: order.version }); order = (await details(waiter, order.id)).order;
        await save(admin, 'restaurant.station.save', { stationId: pass, name: 'Pass', kind: 'EXPO', charactersPerLine: 43, active: true }, { [`station:${pass}`]: 1 });
        const changedStation = (await details(waiter, order.id)).currentQuotes;
        reject(await submit(waiter, envelope(waiter, 'restaurant.order.fire', { orderId: order.id }, versionsFor(order, changedStation))), 'VERSION_CONFLICT');
        const oldQuotes = (await details(waiter, order.id)).currentQuotes;
        await save(admin, 'catalog.product.update', { productId: meal, name: 'Lunch plate', sellingPriceMinor: 30000, costPriceMinor: 0, taxRateBps: 1600, category: '', barcode: null, reorderLevel: '0', reason: 'Reviewed new menu price' }, { [`product:${meal}`]: 1 });
        reject(await submit(waiter, envelope(waiter, 'restaurant.order.fire', { orderId: order.id }, versionsFor(order, oldQuotes))), 'VERSION_CONFLICT');
        const reviewed = await details(waiter, order.id); assert.equal(reviewed.order.lines.find((line: any) => line.productId === meal).unitPriceMinor, 25000); assert.equal(reviewed.currentQuotes.find((q: any) => q.productId === meal).sellingPriceMinor, 30000);
        reject(await submit(waiter, envelope(waiter, 'restaurant.order.fire', { orderId: order.id }, versionsFor(order, reviewed.currentQuotes))), 'VERSION_CONFLICT');
        await save(waiter, 'restaurant.order.save', { orderId: order.id, instructions: order.instructions, lines: order.lines.map((line: any) => ({ ...prep(line.productId, line.quantity, line.modifiers, line.instructions), lineId: line.id })) }, versionsFor(order, reviewed.currentQuotes));
        order = (await details(waiter, order.id)).order; assert.equal(order.totalMinor, 114400);
      });
      await t.test('ten fires across two waiters produce one immutable batch and one ticket per station', async () => {
        const quotes = (await details(waiter, order.id)).currentQuotes;
        const commands = Array.from({ length: 10 }, (_, index) => { const a = index % 2 ? second : waiter; return { a, command: envelope(a, 'restaurant.order.fire', { orderId: order.id }, versionsFor(order, quotes)) }; });
        const responses = await Promise.all(commands.map(({ a, command }) => submit(a, command)));
        assert.deepEqual(responses.map(response => response.json().status).sort(), ['CONFIRMED', ...Array(9).fill('CONFLICT')]);
        const winner = responses.findIndex(response => response.json().status === 'CONFIRMED'), confirmed = responses[winner].json();
        assert.equal(confirmed.value.ticketType, 'NEW'); assert.equal(confirmed.value.fireRevision, 1); assert.equal(confirmed.value.ticketIds.length, 3); firstBatch = confirmed.value.batchId;
        assert.deepEqual((await submit(commands[winner].a, commands[winner].command)).json(), confirmed);
        const recovered = await get(commands[winner].a, `/commands/${commands[winner].command.commandId}`); assert.deepEqual(recovered.response.value, confirmed.value);
        const detail = await details(waiter, order.id); order = detail.order; firstTickets = detail.tickets; originalLines = structuredClone(order.lines);
        assert.equal(firstTickets.length, 3); assert.equal(order.fireRevision, 1); assert.equal(order.status, 'FIRED');
        for (const ticket of firstTickets) {
          assert.equal(ticket.status,'NEW');assert.equal(ticket.stateVersion,1);assert.equal(ticket.stateActorName,'Restaurant waiter');
          assert.equal(ticket.batchId, firstBatch); assert.equal(ticket.snapshot.waiter.id, waiter.userId); assert.equal(ticket.snapshot.firedBy.id, commands[winner].a.userId);
          assert.equal(ticket.documentHash, createHash('sha256').update(security.stableStringify(ticket.snapshot)).digest('hex'));
          assert.doesNotMatch(JSON.stringify(ticket.snapshot), /unitPriceMinor|taxRateBps|totalMinor|costPriceMinor|payments/);
        }
        assert.equal(firstTickets.find((ticket: any) => ticket.stationId === kitchen).snapshot.lines.length, 2);
        assert.equal(firstTickets.find((ticket: any) => ticket.stationId === bar).snapshot.lines.length, 1);
        assert.equal((await db.pool.query('SELECT count(*)::int n FROM restaurant.fire_batches WHERE order_id=$1', [order.id])).rows[0].n, 1);
        assert.equal((await db.pool.query('SELECT count(*)::int n FROM restaurant.ticket_lines WHERE order_id=$1', [order.id])).rows[0].n, 5);
        reject(await submit(waiter, envelope(waiter, 'restaurant.order.fire', { orderId: order.id }, { [`order:${order.id}`]: order.version })), 'RESTAURANT_NO_UNFIRED_LINES');
      });
      await t.test('fired source rows and ticket evidence cannot be rewritten or cancelled', async () => {
        reject(await submit(waiter, envelope(waiter, 'restaurant.order.save', { orderId: order.id, instructions: '', lines: [{ ...prep(meal), lineId: originalLines[0].id }] }, { [`order:${order.id}`]: order.version })), 'RESTAURANT_FIRED_LINES_IMMUTABLE');
        reject(await submit(waiter, envelope(waiter, 'restaurant.order.cancel', { orderId: order.id, reason: 'Try to erase sent items' }, { [`order:${order.id}`]: order.version })), 'RESTAURANT_FIRED_LINES_IMMUTABLE');
        for (const sql of ['UPDATE restaurant.order_lines SET unit_price_minor=1 WHERE order_id=$1', 'DELETE FROM restaurant.order_lines WHERE order_id=$1', "UPDATE restaurant.tickets SET snapshot='{}'::jsonb WHERE order_id=$1", 'DELETE FROM restaurant.fire_batches WHERE order_id=$1']) await assert.rejects(db.pool.query(sql, [order.id]), { code: '23514' });
        reject(await submit(admin, envelope(admin, 'restaurant.table.save', { tableId, name: 'Garden 7', sectionId: null, seats: 4, active: false }, { [`table:${tableId}`]: 1 })), 'RESTAURANT_RESOURCE_IN_USE');
        assert.deepEqual((await details(waiter, order.id)).tickets, firstTickets);
      });
      await t.test('add-ons use new identities and batches while original quotes and tickets stay exact', async () => {
        await save(admin, 'catalog.product.update', { productId: meal, name: 'Later lunch label', sellingPriceMinor: 45000, costPriceMinor: 0, taxRateBps: 1600, category: '', barcode: null, reorderLevel: '0', reason: 'Later menu price' }, { [`product:${meal}`]: 2 });
        const menu = (await get(waiter, '/restaurant/menu')).menu;
        await save(second, 'restaurant.order.save', { orderId: order.id, instructions: 'Add-on only', lines: [prep(meal, '0.5', ['No salt'], 'Supplemental half portion')] }, versionsFor(order, menu));
        let detail = await details(waiter, order.id); order = detail.order;
        assert.deepEqual(order.lines.filter((line: any) => line.fireRevision !== null), originalLines);
        const addon = await save(waiter, 'restaurant.order.fire', { orderId: order.id }, versionsFor(order, detail.currentQuotes)); assert.equal(addon.ticketType, 'ADD_ON'); assert.equal(addon.fireRevision, 2); assert.equal(addon.ticketIds.length, 2);
        detail = await details(waiter, order.id); order = detail.order; assert.equal(order.totalMinor, 140500);
        for (const old of firstTickets) assert.deepEqual(detail.tickets.find((ticket: any) => ticket.id === old.id), old);
        for (const ticket of detail.tickets.filter((ticket: any) => ticket.fireRevision === 2)) { assert.equal(ticket.snapshot.originalBatchId, firstBatch); assert.equal(ticket.snapshot.lines.length, 1); assert.equal(ticket.snapshot.lines[0].quantity, '0.5'); }
      });
      await t.test('kitchen reads are restricted to current device-bound stations and contain no commercial quote', async () => {
        assert.deepEqual((await get(cook, '/restaurant/ticket-stations')).stations.map((station: any) => station.id), [kitchen]);
        const feed = await get(cook, `/restaurant/stations/${kitchen}/tickets?limit=1`); assert.equal(feed.tickets.length, 1); assert.equal(feed.page.totalCount, 2); assert.ok(feed.page.nextCursor);
        assert.doesNotMatch(JSON.stringify(feed), /unitPriceMinor|taxRateBps|lineSubtotalMinor|costPriceMinor/);
        reject(await app.inject({ url: `/api/v1/restaurant/orders/${order.id}`, headers: cook.headers }), 'FORBIDDEN');
        reject(await app.inject({ url: `/api/v1/restaurant/stations/${bar}/tickets`, headers: cook.headers }), 'FORBIDDEN');
        reject(await submit(cook, envelope(cook, 'restaurant.order.fire', { orderId: order.id }, { [`order:${order.id}`]: order.version })), 'FORBIDDEN');
        await db.pool.query('UPDATE identity.devices SET version=version+1 WHERE id=$1', [cook.deviceId]);
        assert.deepEqual((await get(cook, '/restaurant/ticket-stations')).stations, []);
        reject(await app.inject({ url: `/api/v1/restaurant/stations/${kitchen}/tickets`, headers: cook.headers }), 'FORBIDDEN');
        await save(admin, 'restaurant.station.assign', { deviceId: cook.deviceId, stationIds: [kitchen] }, { [`device:${cook.deviceId}`]: 2, [`stationAssignment:${cook.deviceId}`]: 1 });
        const next = await get(cook, `/restaurant/stations/${kitchen}/tickets?limit=1&after=${encodeURIComponent(feed.page.nextCursor)}`); assert.equal(next.tickets.length, 1); assert.notEqual(next.tickets[0].id, feed.tickets[0].id);
        reject(await app.inject({ url: `/api/v1/restaurant/stations/${bar}/tickets?after=${encodeURIComponent(feed.page.nextCursor)}`, headers: admin.headers }), 'VALIDATION_FAILED');
      });
      await t.test('assigned kitchen staff advance each ticket once through acknowledged, preparing and ready',async()=>{
        const kitchenTicket=firstTickets.find((ticket:any)=>ticket.stationId===kitchen)!;
        const command=(a:Actor,fromStatus:string,toStatus:string,version:number)=>envelope(a,'restaurant.ticket.advance',{ticketId:kitchenTicket.id,fromStatus,toStatus},{['ticket:'+kitchenTicket.id]:version});
        reject(await submit(waiter,command(waiter,'NEW','ACKNOWLEDGED',1)),'FORBIDDEN');
        const barTicket=firstTickets.find((ticket:any)=>ticket.stationId===bar)!;
        reject(await submit(cook,envelope(cook,'restaurant.ticket.advance',{ticketId:barTicket.id,fromStatus:'NEW',toStatus:'ACKNOWLEDGED'},{['ticket:'+barTicket.id]:1})),'FORBIDDEN');
        const first=command(cook,'NEW','ACKNOWLEDGED',1),acknowledged=await submit(cook,first);assert.equal(acknowledged.json().status,'CONFIRMED',acknowledged.body);
        assert.equal(acknowledged.json().value.status,'ACKNOWLEDGED');assert.equal(acknowledged.json().value.version,2);assert.deepEqual((await submit(cook,first)).json(),acknowledged.json());
        reject(await submit(cook,command(cook,'NEW','ACKNOWLEDGED',1)),'VERSION_CONFLICT');
        const preparing=await submit(cook,command(cook,'ACKNOWLEDGED','PREPARING',2));assert.equal(preparing.json().status,'CONFIRMED',preparing.body);
        reject(await submit(cook,command(cook,'PREPARING','READY',2)),'VERSION_CONFLICT');
        const ready=await submit(cook,command(cook,'PREPARING','READY',3));assert.equal(ready.json().status,'CONFIRMED',ready.body);
        const current=(await details(waiter,order.id)).tickets.find((ticket:any)=>ticket.id===kitchenTicket.id);assert.equal(current.status,'READY');assert.equal(current.stateVersion,4);assert.equal(current.stateActorName,'Restaurant cook');
        for(const sql of ['UPDATE restaurant.ticket_state_events SET status=\'NEW\' WHERE ticket_id=$1','DELETE FROM restaurant.ticket_state_events WHERE ticket_id=$1'])await assert.rejects(db.pool.query(sql,[kitchenTicket.id]),{code:'23514'});
        await assert.rejects(db.pool.query(`INSERT INTO restaurant.ticket_state_events(id,tenant_id,outlet_id,order_id,ticket_id,station_id,event_version,status,previous_status,command_id,actor_id,actor_name_snapshot,device_id)
          SELECT gen_random_uuid(),tenant_id,outlet_id,order_id,ticket_id,station_id,event_version+1,'PREPARING',status,command_id,actor_id,actor_name_snapshot,device_id
          FROM restaurant.ticket_state_events WHERE ticket_id=$1 ORDER BY event_version DESC LIMIT 1`,[kitchenTicket.id]),{code:'23514'});
        assert.equal((await db.pool.query('SELECT count(*)::int n FROM restaurant.ticket_state_events WHERE ticket_id=$1',[kitchenTicket.id])).rows[0].n,4);
        firstTickets=firstTickets.map((ticket:any)=>ticket.id===current.id?current:ticket);
      });
      await t.test('draft-only cancellation frees labels and order history remains complete and searchable', async () => {
        const created = await save(waiter, 'restaurant.order.create', { tableId: null, serviceLabel: 'Takeaway review' });
        await save(second, 'restaurant.order.cancel', { orderId: created.orderId, reason: 'Guest changed plans before fire' }, { [`order:${created.orderId}`]: 1 });
        const cancelled = (await details(waiter, created.orderId)).order; assert.equal(cancelled.status, 'CANCELLED');
        reject(await submit(waiter, envelope(waiter, 'restaurant.order.hold', { orderId: created.orderId, held: false, reason: 'Try to revive' }, { [`order:${created.orderId}`]: 2 })), 'RESTAURANT_ORDER_CANCELLED');
        await save(waiter, 'restaurant.order.create', { tableId: null, serviceLabel: 'Takeaway review' });
        for (let index = 0; index < 12; index++) await save(waiter, 'restaurant.order.create', { tableId: null, serviceLabel: `Older searchable tab ${index}` });
        const first = await get(waiter, '/restaurant/orders?limit=5'); assert.equal(first.orders.length, 5); assert.equal(first.page.totalCount, 15);
        const seen = new Set<string>(first.orders.map((row: any) => row.id)); let cursor = first.page.nextCursor;
        while (cursor) { const page = await get(waiter, `/restaurant/orders?limit=5&after=${encodeURIComponent(cursor)}`); for (const row of page.orders) { assert.ok(!seen.has(row.id)); seen.add(row.id); } cursor = page.page.nextCursor; }
        assert.equal(seen.size, 15);
        const search = await get(waiter, '/restaurant/orders?q=Older%20searchable%20tab%2011'); assert.equal(search.page.totalCount, 1);
        reject(await app.inject({ url: `/api/v1/restaurant/orders?after=${encodeURIComponent(first.page.nextCursor)}`, headers: other.headers }), 'VALIDATION_FAILED');
      });
      await t.test('operational source orders preserve all preexisting stock and posted monetary evidence', async () => {
        assert.deepEqual(await businessEvidence(), before); assert.deepEqual(await get(admin, `/sales/orders/${originalSale}/receipt`), receiptBefore);
        const ledgers = (await db.pool.query("SELECT authority_version,required_capabilities FROM system.commands WHERE tenant_id=$1 AND command_type LIKE 'restaurant.order.%' AND status='CONFIRMED'", [context.tenantId])).rows;
        assert.ok(ledgers.length > 0); for (const ledger of ledgers) { assert.equal(ledger.authority_version, 1); assert.deepEqual(ledger.required_capabilities, ['commerce', 'restaurant']); }
        const counts = (await db.pool.query(`SELECT (SELECT count(*)::int FROM system.audit_events WHERE tenant_id=$1 AND event_type='restaurant.order.fire') audits,
          (SELECT count(*)::int FROM system.transactional_outbox WHERE tenant_id=$1 AND event_type='restaurant.order.fire') events`, [context.tenantId])).rows[0];
        assert.deepEqual(counts, { audits: 2, events: 2 });
        const configuration = (await get(admin, '/configuration')).configuration;
        reject(await submit(admin, envelope(admin, 'configuration.capabilities.update', { capabilities: ['commerce', 'inventory'] }, { [`business:${context.tenantId}`]: configuration.business.version })), 'CAPABILITY_IN_USE');
      });
      await t.test('an empty durable order locks its currency and first-use setup cannot trade or read operational orders', async () => {
        const blank = await actor(await scope());
        const created = await save(blank, 'restaurant.order.create', { tableId: null, serviceLabel: 'Empty source draft' });
        const configuration = (await get(blank, '/configuration')).configuration;
        reject(await submit(blank, envelope(blank, 'configuration.business.update', { ...configuration.business, currency: 'USD' }, { [`business:${blank.tenantId}`]: configuration.business.version })), 'CURRENCY_LOCKED');
        await db.pool.query('INSERT INTO core.tenant_onboarding(tenant_id,bootstrap_key_hash) VALUES($1,$2)', [blank.tenantId, `setup-orders-${blank.tenantId}`]);
        const setup = (await get(blank, '/restaurant/configuration')).configuration;
        assert.equal(setup.availability.ordering, false); assert.equal(setup.availability.fire, false);
        for (const path of ['/restaurant/orders', `/restaurant/orders/${created.orderId}`, '/restaurant/menu', '/restaurant/ticket-stations']) {
          reject(await app.inject({ url: `/api/v1${path}`, headers: blank.headers }), 'ONBOARDING_REQUIRED');
        }
        reject(await submit(blank, envelope(blank, 'restaurant.order.create', { tableId: null, serviceLabel: 'Not a live order' })), 'ONBOARDING_REQUIRED');
      });
    } finally { await app.close(); await db.pool.end(); }
  });
}
