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

  test('fresh migrations support authenticated commands, stock-count recovery, canonical replay, and role-scoped cost projections', async () => {
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
      const postCommand = (payload: unknown) => app.inject({ method: 'POST', url: '/api/v1/commands', headers: { ...headers, 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
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
      const first = await postCommand(createProduct);
      assert.equal(first.statusCode, 200, first.body);
      assert.equal(first.json().status, 'CONFIRMED');

      const replay = await postCommand(createProduct);
      assert.equal(replay.statusCode, 200, replay.body);
      assert.deepEqual(replay.json(), first.json(), 'same command ID and payload must have the same response shape and value');

      const catalog = await app.inject({ method: 'GET', url: '/api/v1/catalog/items', headers });
      assert.equal(catalog.statusCode, 200, catalog.body);
      const items = catalog.json().items as Array<{ id: string; sku: string; quantity: string; costPriceMinor?: number }>;
      assert.equal(items.length, 1);
      assert.equal(items[0].sku, 'GAP-530CDBF');
      assert.equal(items[0].quantity, '0.000000');
      assert.equal(items[0].costPriceMinor, 15000, 'catalog managers may read unit cost');
      const productId = String(first.json().value.productId);

      const persisted = await db.pool.query<{ command_count: string; product_count: string }>(`SELECT
        (SELECT count(*) FROM system.commands WHERE tenant_id=$1 AND command_id=$2)::text command_count,
        (SELECT count(*) FROM catalog.products WHERE tenant_id=$1 AND outlet_id=$3 AND sku='GAP-530CDBF')::text product_count`, [tenantId, commandId, outletId]);
      assert.equal(persisted.rows[0].command_count, '1');
      assert.equal(persisted.rows[0].product_count, '1');

      const roomCommandId = randomUUID();
      const roomResult = await postCommand({
        protocolVersion: 1, commandId: roomCommandId, tenantId, deviceId,
        type: 'hotel.room.create', occurredAt: new Date().toISOString(), expectedVersions: {},
        payload: { roomNumber: '101', roomType: 'Standard', nightlyRateMinor: 12000, taxRateBps: 1600 },
      });
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
      const reservationResponses = await Promise.all(reservations.map(payload => postCommand(payload)));
      assert.deepEqual(reservationResponses.map(response => response.json().status).sort(), ['CONFIRMED', 'CONFLICT']);
      const confirmedReservations = await db.pool.query<{ count: string }>(`SELECT count(*)::text count FROM hospitality.reservations WHERE tenant_id=$1 AND outlet_id=$2 AND room_id=$3 AND status='CONFIRMED' AND check_in_date<'2030-01-12' AND check_out_date>'2030-01-10'`, [tenantId, outletId, roomId]);
      assert.equal(confirmedReservations.rows[0].count, '1');

      const lifecycleRoomCommand = await postCommand({
        protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId,
        type: 'hotel.room.create', occurredAt: new Date().toISOString(), expectedVersions: {},
        payload: { roomNumber: '102', roomType: 'Standard', nightlyRateMinor: 10000, taxRateBps: 1600 },
      });
      assert.equal(lifecycleRoomCommand.json().status, 'CONFIRMED');
      const lifecycleRoomId = String(lifecycleRoomCommand.json().value.roomId);
      const businessDateResult = await db.pool.query<{ business_date: string }>(`SELECT to_char(now() AT TIME ZONE time_zone, 'YYYY-MM-DD') business_date FROM core.outlets WHERE id=$1`, [outletId]);
      const arrivalDate = businessDateResult.rows[0].business_date;
      const departureDate = new Date(Date.parse(`${arrivalDate}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
      const lifecycleReservation = await postCommand({
        protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId,
        type: 'hotel.reservation.create', occurredAt: new Date().toISOString(), expectedVersions: { [`room:${lifecycleRoomId}`]: 1 },
        payload: { roomId: lifecycleRoomId, guestName: 'Lifecycle Guest', guestContact: '+254700000001', checkInDate: arrivalDate, checkOutDate: departureDate },
      });
      assert.equal(lifecycleReservation.json().status, 'CONFIRMED');
      const lifecycleReservationId = String(lifecycleReservation.json().value.reservationId);
      const lifecycleCheckIn = await postCommand({
        protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId,
        type: 'hotel.checkin', occurredAt: new Date().toISOString(),
        expectedVersions: { [`room:${lifecycleRoomId}`]: 2, [`reservation:${lifecycleReservationId}`]: 1 },
        payload: { reservationId: lifecycleReservationId },
      });
      assert.equal(lifecycleCheckIn.json().status, 'CONFIRMED');
      const lifecycleStayId = String(lifecycleCheckIn.json().value.stayId);
      const lifecycleFolioId = String(lifecycleCheckIn.json().value.folioId);

      const checkedInState = await db.pool.query<{ room_status: string; stay_status: string; folio_status: string }>(`SELECT r.status room_status,s.status stay_status,f.status folio_status FROM hospitality.rooms r JOIN hospitality.stays s ON s.room_id=r.id AND s.tenant_id=r.tenant_id AND s.outlet_id=r.outlet_id JOIN hospitality.folios f ON f.stay_id=s.id AND f.tenant_id=s.tenant_id AND f.outlet_id=s.outlet_id WHERE s.id=$1 AND s.tenant_id=$2 AND s.outlet_id=$3`, [lifecycleStayId, tenantId, outletId]);
      assert.deepEqual(checkedInState.rows[0], { room_status: 'OCCUPIED', stay_status: 'CHECKED_IN', folio_status: 'OPEN' });

      const foreignTenantId = randomUUID();
      const foreignOutletId = randomUUID();
      const foreignProductId = randomUUID();
      const foreignUserId = randomUUID();
      const foreignShiftId = randomUUID();
      const foreignOrderId = randomUUID();
      const foreignJournalEntryId = randomUUID();
      await db.pool.query('INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,$2,$3,$4)', [foreignTenantId, 'Foreign integration tenant', 'KES', 'Africa/Nairobi']);
      await db.pool.query('INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,$3,$4)', [foreignOutletId, foreignTenantId, 'Foreign outlet', 'Africa/Nairobi']);
      await db.pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)', [foreignUserId, `foreign-${foreignUserId}@example.invalid`, await hashPassword('foreign-tenant-integration-password'), 'Foreign integration user']);
      await db.pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')", [foreignTenantId, foreignUserId]);
      await db.pool.query(`INSERT INTO catalog.products(id,tenant_id,outlet_id,sku,name,base_unit,currency,selling_price_minor,cost_price_minor,tax_rate_bps)
        VALUES($1,$2,$3,'FOREIGN-ITEM','Foreign item','each','KES',25000,15000,1600)`, [foreignProductId, foreignTenantId, foreignOutletId]);
      await db.pool.query('INSERT INTO inventory.balances(tenant_id,outlet_id,product_id,quantity) VALUES($1,$2,$3,5)', [foreignTenantId, foreignOutletId, foreignProductId]);
      await db.pool.query(`INSERT INTO commerce.shifts(id,tenant_id,outlet_id,operator_id,status,opening_float_minor,expected_cash_minor)
        VALUES($1,$2,$3,$4,'OPEN',0,0)`, [foreignShiftId, foreignTenantId, foreignOutletId, foreignUserId]);
      await db.pool.query(`INSERT INTO commerce.orders(id,tenant_id,outlet_id,shift_id,operator_id,currency,subtotal_minor,tax_minor,total_minor,status,receipt_number,tenant_name_snapshot,outlet_name_snapshot,outlet_time_zone_snapshot)
        VALUES($1,$2,$3,$4,$5,'KES',100,0,100,'CONFIRMED','MZ-'||upper(replace($1::uuid::text,'-','')),(SELECT name FROM core.tenants WHERE id=$2),(SELECT name FROM core.outlets WHERE tenant_id=$2 AND id=$3),(SELECT time_zone FROM core.outlets WHERE tenant_id=$2 AND id=$3))`, [foreignOrderId, foreignTenantId, foreignOutletId, foreignShiftId, foreignUserId]);
      await db.pool.query(`INSERT INTO finance.journal_entries(id,tenant_id,source_type,source_id,currency,created_by)
        VALUES($1,$2,'INTEGRATION_FIXTURE',$3,'KES',$4)`, [foreignJournalEntryId, foreignTenantId, randomUUID(), foreignUserId]);

      const expectForeignKeyViolation = async (query: string, values: unknown[], label: string) => {
        await assert.rejects(db.pool.query(query, values), (error: unknown) => (error as { code?: string }).code === '23503', label);
      };
      await expectForeignKeyViolation(
        'INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,$5)',
        [randomUUID(), foreignTenantId, foreignOutletId, userId, 'Cross-tenant assignment must fail'],
        'device assignment must reference a user membership in the same tenant',
      );
      await expectForeignKeyViolation(`INSERT INTO commerce.orders(id,tenant_id,outlet_id,shift_id,operator_id,currency,subtotal_minor,tax_minor,total_minor,status,receipt_number,tenant_name_snapshot,outlet_name_snapshot,outlet_time_zone_snapshot)
        VALUES($1,$2,$3,$4,$5,'KES',100,0,100,'CONFIRMED','MZ-'||upper(replace($1::uuid::text,'-','')),(SELECT name FROM core.tenants WHERE id=$2),(SELECT name FROM core.outlets WHERE tenant_id=$2 AND id=$3),(SELECT time_zone FROM core.outlets WHERE tenant_id=$2 AND id=$3))`,
      [randomUUID(), tenantId, outletId, foreignShiftId, userId],
      'an order must reference a shift from the same tenant and outlet');
      await expectForeignKeyViolation(`INSERT INTO commerce.order_lines(id,tenant_id,outlet_id,order_id,product_id,sku_snapshot,name_snapshot,quantity,unit_price_minor,cost_price_minor,tax_rate_bps,line_subtotal_minor,line_tax_minor)
        VALUES($1,$2,$3,$4,$5,'SKU','Item',1,1,0,0,1,0)`,
      [randomUUID(), tenantId, outletId, foreignOrderId, productId],
      'an order line must reference an order from the same tenant and outlet');
      await expectForeignKeyViolation(`INSERT INTO commerce.payments(id,tenant_id,outlet_id,order_id,method,amount_minor,currency,status)
        VALUES($1,$2,$3,$4,'CASH',1,'KES','CONFIRMED')`,
      [randomUUID(), tenantId, outletId, foreignOrderId],
      'a payment must reference an order from the same tenant and outlet');
      await expectForeignKeyViolation(`INSERT INTO finance.journal_lines(id,tenant_id,journal_entry_id,account_code,debit_minor,credit_minor)
        VALUES($1,$2,$3,'TEST-CROSS-TENANT',1,0)`,
      [randomUUID(), tenantId, foreignJournalEntryId],
      'a journal line must reference an entry from the same tenant');

      const receipt = await postCommand({
        protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId, type: 'inventory.receive',
        occurredAt: new Date().toISOString(), expectedVersions: {},
        payload: { documentReference: 'CI-GRN-1', supplierName: 'Integration supplier', lines: [{ productId, quantity: '4', unitCostMinor: 15000 }] },
      });
      assert.equal(receipt.statusCode, 200, receipt.body);
      assert.equal(receipt.json().status, 'CONFIRMED');
      const higherCostReceipt = await postCommand({
        protocolVersion:1,commandId:randomUUID(),tenantId,deviceId,type:'inventory.receive',occurredAt:new Date().toISOString(),expectedVersions:{},
        payload:{documentReference:'CI-GRN-2',lines:[{productId,quantity:'2',unitCostMinor:30000}]},
      });
      assert.equal(higherCostReceipt.json().status,'CONFIRMED',higherCostReceipt.body);
      const receivedValue = await db.pool.query<{quantity:string;inventory_value_minor:string}>('SELECT quantity::text quantity,inventory_value_minor::text inventory_value_minor FROM inventory.balances WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3',[tenantId,outletId,productId]);
      assert.deepEqual(receivedValue.rows[0],{quantity:'6.000000',inventory_value_minor:'120000'},'receipt layers must build exact outlet carrying value');
      const valuedCatalog=await app.inject({method:'GET',url:'/api/v1/catalog/items',headers});
      const valuedItem=(valuedCatalog.json().items as Array<{sku:string;inventoryValueMinor?:string}>).find(item=>item.sku==='GAP-530CDBF');
      assert.equal(valuedItem?.inventoryValueMinor,'120000','cost-authorized catalog reads expose carrying value');
      const valuedMovements=await app.inject({method:'GET',url:'/api/v1/inventory/movements',headers});
      const secondReceiptMovement=(valuedMovements.json().movements as Array<{reference?:string;valueMinor?:string}>).find(movement=>movement.reference==='CI-GRN-2');
      assert.equal(secondReceiptMovement?.valueMinor,'60000','cost-authorized movement reads expose immutable receipt value');

      const countOpen = await postCommand({
        protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId, type: 'inventory.count.open',
        occurredAt: new Date().toISOString(), expectedVersions: {}, payload: { areaLabel: 'Main store' },
      });
      assert.equal(countOpen.json().status, 'CONFIRMED', countOpen.body);
      const countId = String(countOpen.json().value.countId);
      const currentCountResponse = await app.inject({ method: 'GET', url: '/api/v1/inventory/counts/current', headers });
      assert.equal(currentCountResponse.statusCode, 200, currentCountResponse.body);
      const currentCount = currentCountResponse.json().count as { id:string;version:number;lineCount:number;lines:Array<{productId:string;expectedQuantity:string;expectedBalanceVersion:number;countedQuantity:string|null}> };
      assert.equal(currentCount.id, countId);
      assert.equal(currentCount.lineCount, 1);
      assert.equal(currentCount.lines[0].expectedQuantity, '6.000000');
      assert.equal(currentCount.lines[0].expectedBalanceVersion, 3);

      const incompletePost = await postCommand({
        protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId, type: 'inventory.count.post',
        occurredAt: new Date().toISOString(), expectedVersions: { [`count:${countId}`]: 1 }, payload: { countId },
      });
      assert.equal(incompletePost.json().status, 'REJECTED');

      const storekeeperId = randomUUID();
      const storekeeperDeviceId = randomUUID();
      const storekeeperEmail = `storekeeper-${storekeeperId}@example.invalid`;
      const storekeeperPassword = 'storekeeper-count-integration-password';
      await db.pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)', [storekeeperId, storekeeperEmail, await hashPassword(storekeeperPassword), 'Integration Storekeeper']);
      await db.pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'storekeeper')", [tenantId, storekeeperId]);
      await db.pool.query('INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,$5)', [storekeeperDeviceId, tenantId, outletId, storekeeperId, 'Disposable count device']);
      const storekeeperLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: storekeeperEmail, password: storekeeperPassword } });
      assert.equal(storekeeperLogin.statusCode, 200, storekeeperLogin.body);
      const storekeeperSession = storekeeperLogin.json() as { csrfToken:string;user:{permissions:string[]} };
      assert.ok(storekeeperSession.user.permissions.includes('inventory.count'));
      assert.ok(!storekeeperSession.user.permissions.includes('inventory.count.approve'));
      const storekeeperRawCookies = storekeeperLogin.headers['set-cookie'];
      const storekeeperCookies = (Array.isArray(storekeeperRawCookies) ? storekeeperRawCookies : [storekeeperRawCookies])
        .filter((value): value is string => typeof value === 'string')
        .map(value => value.split(';', 1)[0])
        .join('; ');
      const storekeeperHeaders = { cookie: storekeeperCookies, origin: 'http://localhost:3000', 'x-csrf-token': storekeeperSession.csrfToken };
      const storekeeperDraftCommand = {
        protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId: storekeeperDeviceId, type: 'inventory.count.save',
        occurredAt: new Date().toISOString(), expectedVersions: { [`count:${countId}`]: 1 },
        payload: { countId, lines: [{ productId, countedQuantity: '5', varianceReason: null }] },
      };
      const savedCount = await app.inject({ method: 'POST', url: '/api/v1/commands', headers: { ...storekeeperHeaders, 'content-type':'application/json' }, payload: JSON.stringify(storekeeperDraftCommand) });
      assert.equal(savedCount.statusCode, 200, savedCount.body);
      assert.equal(savedCount.json().status, 'CONFIRMED');
      assert.equal(savedCount.json().value.version, 2);
      const savedCountReplay = await app.inject({ method: 'POST', url: '/api/v1/commands', headers: { ...storekeeperHeaders, 'content-type':'application/json' }, payload: JSON.stringify(storekeeperDraftCommand) });
      assert.deepEqual(savedCountReplay.json(), savedCount.json(), 'count draft replay must not advance its version twice');
      const storekeeperPost = await app.inject({
        method:'POST',url:'/api/v1/commands',headers:{...storekeeperHeaders,'content-type':'application/json'},
        payload:JSON.stringify({protocolVersion:1,commandId:randomUUID(),tenantId,deviceId:storekeeperDeviceId,type:'inventory.count.post',occurredAt:new Date().toISOString(),expectedVersions:{[`count:${countId}`]:2},payload:{countId}}),
      });
      assert.equal(storekeeperPost.json().status,'REJECTED');
      assert.equal(storekeeperPost.json().code,'FORBIDDEN');

      const varianceWithoutReason = await postCommand({
        protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId, type: 'inventory.count.post',
        occurredAt: new Date().toISOString(), expectedVersions: { [`count:${countId}`]: 2 }, payload: { countId },
      });
      assert.equal(varianceWithoutReason.json().status, 'REJECTED');
      assert.match(varianceWithoutReason.json().message, /reason is required/i);

      const correctedCountDraft = await app.inject({
        method: 'POST', url: '/api/v1/commands', headers: { ...storekeeperHeaders, 'content-type':'application/json' },
        payload: JSON.stringify({ ...storekeeperDraftCommand, commandId: randomUUID(), expectedVersions: { [`count:${countId}`]: 2 }, payload: { countId, lines: [{ productId, countedQuantity: '5', varianceReason: 'Damaged during storage' }] } }),
      });
      assert.equal(correctedCountDraft.json().status, 'CONFIRMED', correctedCountDraft.body);
      assert.equal(correctedCountDraft.json().value.version, 3);

      const postedCount = await postCommand({
        protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId, type: 'inventory.count.post',
        occurredAt: new Date().toISOString(), expectedVersions: { [`count:${countId}`]: 3 }, payload: { countId },
      });
      assert.equal(postedCount.json().status, 'CONFIRMED', postedCount.body);
      assert.equal(postedCount.json().value.adjustedLineCount, 1);
      assert.equal(postedCount.json().value.shrinkMinor, 20000,'count shrinkage uses the moving average, not the setup cost');
      const postedCountState = await db.pool.query<{quantity:string;inventory_value_minor:string;movement_count:string;movement_value_minor:string;status:string;unbalanced_count_journals:string}>(`SELECT
        (SELECT quantity::text FROM inventory.balances WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3) quantity,
        (SELECT inventory_value_minor::text FROM inventory.balances WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3) inventory_value_minor,
        (SELECT count(*)::text FROM inventory.movements WHERE tenant_id=$1 AND outlet_id=$2 AND reference_id=$4 AND movement_type='COUNT_ADJUSTMENT') movement_count,
        (SELECT value_minor::text FROM inventory.movements WHERE tenant_id=$1 AND outlet_id=$2 AND reference_id=$4 AND movement_type='COUNT_ADJUSTMENT') movement_value_minor,
        (SELECT status FROM inventory.stock_counts WHERE tenant_id=$1 AND outlet_id=$2 AND id=$4) status,
        (SELECT count(*)::text FROM finance.journal_entries je LEFT JOIN finance.journal_lines jl ON jl.journal_entry_id=je.id WHERE je.tenant_id=$1 AND je.source_type='INVENTORY_COUNT' GROUP BY je.id HAVING coalesce(sum(jl.debit_minor),0)<>coalesce(sum(jl.credit_minor),0)) unbalanced_count_journals`, [tenantId, outletId, productId, countId]);
      assert.equal(postedCountState.rows[0].quantity, '5.000000');
      assert.equal(postedCountState.rows[0].inventory_value_minor, '100000');
      assert.equal(postedCountState.rows[0].movement_count, '1');
      assert.equal(postedCountState.rows[0].movement_value_minor, '20000');
      assert.equal(postedCountState.rows[0].status, 'POSTED');
      assert.equal(postedCountState.rows[0].unbalanced_count_journals ?? '0', '0');
      const postedCountHistory = await app.inject({ method:'GET',url:'/api/v1/inventory/counts',headers });
      assert.equal(postedCountHistory.statusCode,200,postedCountHistory.body);
      assert.equal((postedCountHistory.json().counts as Array<{id:string;status:string}>).find(item=>item.id===countId)?.status,'POSTED');
      const postedCountDetails = await app.inject({ method:'GET',url:`/api/v1/inventory/counts/${countId}`,headers });
      assert.equal(postedCountDetails.statusCode,200,postedCountDetails.body);
      assert.equal(postedCountDetails.json().count.lines[0].varianceReason,'Damaged during storage');
      const foreignCountDetails = await app.inject({ method:'GET',url:`/api/v1/inventory/counts/${randomUUID()}`,headers });
      assert.equal(foreignCountDetails.statusCode,404);

      const secondCountOpen = await postCommand({
        protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId, type: 'inventory.count.open',
        occurredAt: new Date().toISOString(), expectedVersions: {}, payload: { areaLabel: 'Main store recount' },
      });
      assert.equal(secondCountOpen.json().status, 'CONFIRMED', secondCountOpen.body);
      const conflictedCountId = String(secondCountOpen.json().value.countId);
      const secondCountDraft = {
        protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId: storekeeperDeviceId, type: 'inventory.count.save',
        occurredAt: new Date().toISOString(), expectedVersions: { [`count:${conflictedCountId}`]: 1 },
        payload: { countId: conflictedCountId, lines: [{ productId, countedQuantity: '3', varianceReason: null }] },
      };
      const savedSecondCount = await app.inject({ method: 'POST', url: '/api/v1/commands', headers: { ...storekeeperHeaders, 'content-type':'application/json' }, payload: JSON.stringify(secondCountDraft) });
      assert.equal(savedSecondCount.json().status, 'CONFIRMED', savedSecondCount.body);
      const concurrentReceipt = await postCommand({
        protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId, type: 'inventory.receive',
        occurredAt: new Date().toISOString(), expectedVersions: {},
       payload: { documentReference: 'CI-DURING-COUNT', lines: [{ productId, quantity: '1', unitCostMinor: 15000 }] },
      });
      assert.equal(concurrentReceipt.json().status, 'CONFIRMED', concurrentReceipt.body);
      const staleCountPost = await postCommand({
        protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId, type: 'inventory.count.post',
        occurredAt: new Date().toISOString(), expectedVersions: { [`count:${conflictedCountId}`]: 2 }, payload: { countId: conflictedCountId },
      });
      assert.equal(staleCountPost.json().status, 'CONFLICT');
      assert.equal(staleCountPost.json().code, 'VERSION_CONFLICT');
      const conflictedCountState = await db.pool.query<{status:string;quantity:string;inventory_value_minor:string;movement_count:string}>(`SELECT
        (SELECT status FROM inventory.stock_counts WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3) status,
        (SELECT quantity::text FROM inventory.balances WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$4) quantity,
        (SELECT inventory_value_minor::text FROM inventory.balances WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$4) inventory_value_minor,
        (SELECT count(*)::text FROM inventory.movements WHERE tenant_id=$1 AND outlet_id=$2 AND reference_id=$3 AND movement_type='COUNT_ADJUSTMENT') movement_count`, [tenantId, outletId, conflictedCountId, productId]);
      assert.equal(conflictedCountState.rows[0].status, 'OPEN', 'conflict must preserve the count draft');
      assert.equal(conflictedCountState.rows[0].quantity, '6.000000', 'conflict must not overwrite the concurrent receipt');
      assert.equal(conflictedCountState.rows[0].inventory_value_minor, '115000', 'conflict preserves receipt carrying value as well as quantity');
      assert.equal(conflictedCountState.rows[0].movement_count, '0');
      const cancelCount = await postCommand({
        protocolVersion:1,commandId:randomUUID(),tenantId,deviceId,type:'inventory.count.cancel',occurredAt:new Date().toISOString(),
        expectedVersions:{[`count:${conflictedCountId}`]:2},payload:{countId:conflictedCountId},
      });
      assert.equal(cancelCount.json().status,'CONFIRMED',cancelCount.body);
      const noCurrentCount = await app.inject({method:'GET',url:'/api/v1/inventory/counts/current',headers});
      assert.equal(noCurrentCount.statusCode,200,noCurrentCount.body);
      assert.equal(noCurrentCount.json().count,null);

      const shiftOpen = await postCommand({
        protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId, type: 'shift.open',
        occurredAt: new Date().toISOString(), expectedVersions: {}, payload: { openingFloatMinor: 50000 },
      });
      assert.equal(shiftOpen.json().status, 'CONFIRMED');
      const shiftId = String(shiftOpen.json().value.shiftId);
      await expectForeignKeyViolation(`INSERT INTO commerce.orders(id,tenant_id,outlet_id,shift_id,operator_id,currency,subtotal_minor,tax_minor,total_minor,status,receipt_number,tenant_name_snapshot,outlet_name_snapshot,outlet_time_zone_snapshot)
        VALUES($1,$2,$3,$4,$5,'KES',100,0,100,'CONFIRMED','MZ-'||upper(replace($1::uuid::text,'-','')),(SELECT name FROM core.tenants WHERE id=$2),(SELECT name FROM core.outlets WHERE tenant_id=$2 AND id=$3),(SELECT time_zone FROM core.outlets WHERE tenant_id=$2 AND id=$3))`,
      [randomUUID(), tenantId, outletId, shiftId, foreignUserId],
      'an order operator must be a member of the same tenant');

      const paidIn = await postCommand({
        protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId, type: 'shift.cash.movement',
        occurredAt: new Date().toISOString(), expectedVersions: { [`shift:${shiftId}`]: 1 },
        payload: { shiftId, movementType: 'PAID_IN', amountMinor: 5000, reason: 'Opening change float', reference: 'VOUCHER-PI-1' },
      });
      assert.equal(paidIn.json().status, 'CONFIRMED', paidIn.body);
      assert.equal(paidIn.json().value.expectedCashMinor, 55000);
      assert.equal(paidIn.json().value.version, 2);

      const payout = await postCommand({
        protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId, type: 'shift.cash.movement',
        occurredAt: new Date().toISOString(), expectedVersions: { [`shift:${shiftId}`]: 2 },
        payload: { shiftId, movementType: 'PAYOUT', amountMinor: 3000, reason: 'Petty cash delivery', reference: 'VOUCHER-PO-1' },
      });
      assert.equal(payout.json().status, 'CONFIRMED', payout.body);
      assert.equal(payout.json().value.expectedCashMinor, 52000);
      assert.equal(payout.json().value.version, 3);

      const overdrawnPayout = await postCommand({
        protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId, type: 'shift.cash.movement',
        occurredAt: new Date().toISOString(), expectedVersions: { [`shift:${shiftId}`]: 3 },
        payload: { shiftId, movementType: 'PAYOUT', amountMinor: 60000, reason: 'Must be rejected' },
      });
      assert.equal(overdrawnPayout.json().status, 'REJECTED');

      const tillState = await app.inject({ method: 'GET', url: '/api/v1/shifts/current', headers });
      assert.equal(tillState.statusCode, 200, tillState.body);
      const currentTill = tillState.json().shift as { version: number; expectedCashMinor: number; cashMovements: Array<{ movementType: string; amountMinor: number; reference: string|null }> };
      assert.equal(currentTill.version, 3);
      assert.equal(currentTill.expectedCashMinor, 52000);
      assert.deepEqual(currentTill.cashMovements.map(movement => [movement.movementType, movement.amountMinor, movement.reference]), [
        ['PAYOUT', 3000, 'VOUCHER-PO-1'], ['PAID_IN', 5000, 'VOUCHER-PI-1'],
      ]);

      // Advance the test stay by one booked night without waiting for a real calendar day.
      const previousDate = new Date(Date.parse(`${arrivalDate}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);
      await db.pool.query(`UPDATE hospitality.stays SET check_in_date=$2::date,expected_check_out_date=$3::date WHERE id=$1 AND tenant_id=$4 AND outlet_id=$5`, [lifecycleStayId, previousDate, arrivalDate, tenantId, outletId]);
      await db.pool.query(`UPDATE hospitality.reservations SET check_in_date=$2::date,check_out_date=$3::date WHERE id=$1 AND tenant_id=$4 AND outlet_id=$5`, [lifecycleReservationId, previousDate, arrivalDate, tenantId, outletId]);
      const underpaidCheckout = await postCommand({
        protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId,
        type: 'hotel.checkout', occurredAt: new Date().toISOString(),
        expectedVersions: { [`room:${lifecycleRoomId}`]: 3, [`stay:${lifecycleStayId}`]: 1, [`shift:${shiftId}`]: 3 },
        payload: { stayId: lifecycleStayId, shiftId, currency: 'KES', tenderedMinor: 11599 },
      });
      assert.equal(underpaidCheckout.json().status, 'REJECTED');
      const noCashOnRejectedCheckout = await db.pool.query<{ entries: string; expected_cash_minor: string }>(`SELECT
        (SELECT count(*)::text FROM hospitality.folio_entries WHERE tenant_id=$1 AND outlet_id=$2 AND folio_id=$3) entries,
        (SELECT expected_cash_minor::text FROM commerce.shifts WHERE tenant_id=$1 AND outlet_id=$2 AND id=$4) expected_cash_minor`, [tenantId, outletId, lifecycleFolioId, shiftId]);
      assert.equal(noCashOnRejectedCheckout.rows[0].entries, '0');
      assert.equal(noCashOnRejectedCheckout.rows[0].expected_cash_minor, '52000');

      const checkout = await postCommand({
        protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId,
        type: 'hotel.checkout', occurredAt: new Date().toISOString(),
        expectedVersions: { [`room:${lifecycleRoomId}`]: 3, [`stay:${lifecycleStayId}`]: 1, [`shift:${shiftId}`]: 3 },
        payload: { stayId: lifecycleStayId, shiftId, currency: 'KES', tenderedMinor: 12000 },
      });
      assert.equal(checkout.json().status, 'CONFIRMED');
      assert.equal(checkout.json().value.subtotalMinor, 10000);
      assert.equal(checkout.json().value.taxMinor, 1600);
      assert.equal(checkout.json().value.totalMinor, 11600);
      assert.equal(checkout.json().value.changeMinor, 400);
      const housekeeping = await postCommand({
        protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId,
        type: 'hotel.room.mark_ready', occurredAt: new Date().toISOString(), expectedVersions: { [`room:${lifecycleRoomId}`]: 4 },
        payload: { roomId: lifecycleRoomId },
      });
      assert.equal(housekeeping.json().status, 'CONFIRMED');
      const completedStay = await db.pool.query<{ room_status: string; stay_status: string; folio_status: string; folio_entries: string; housekeeping_events: string }>(`SELECT r.status room_status,s.status stay_status,f.status folio_status,
        (SELECT count(*)::text FROM hospitality.folio_entries WHERE tenant_id=$1 AND outlet_id=$2 AND folio_id=$3) folio_entries,
        (SELECT count(*)::text FROM hospitality.housekeeping_events WHERE tenant_id=$1 AND outlet_id=$2 AND room_id=$4) housekeeping_events
        FROM hospitality.rooms r JOIN hospitality.stays s ON s.room_id=r.id AND s.tenant_id=r.tenant_id AND s.outlet_id=r.outlet_id JOIN hospitality.folios f ON f.stay_id=s.id AND f.tenant_id=s.tenant_id AND f.outlet_id=s.outlet_id WHERE s.id=$5 AND s.tenant_id=$1 AND s.outlet_id=$2`, [tenantId, outletId, lifecycleFolioId, lifecycleRoomId, lifecycleStayId]);
      assert.deepEqual(completedStay.rows[0], { room_status: 'READY', stay_status: 'CHECKED_OUT', folio_status: 'SETTLED', folio_entries: '2', housekeeping_events: '2' });

      const foreignSale = await postCommand({
        protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId, type: 'sales.order.settle',
        occurredAt: new Date().toISOString(), expectedVersions: { [`shift:${shiftId}`]: 4 },
        payload: { shiftId, lines: [{ productId: foreignProductId, quantity: '1' }], tenders: [{ method: 'CASH', amountMinor: 30000, currency: 'KES' }] },
      });
      assert.equal(foreignSale.json().status, 'REJECTED');

      const saleCommand = {
        protocolVersion: 1,
        commandId: randomUUID(),
        tenantId,
        deviceId,
        type: 'sales.order.settle',
        occurredAt: new Date().toISOString(),
        expectedVersions: { [`shift:${shiftId}`]: 4 },
        payload: { shiftId, lines: [{ productId, quantity: '2' }], tenders: [{ method: 'CASH', amountMinor: 60000, currency: 'KES' }] },
      };
      const sale = await postCommand(saleCommand);
      assert.equal(sale.statusCode, 200, sale.body);
      assert.equal(sale.json().status, 'CONFIRMED');
      assert.equal(sale.json().value.subtotalMinor, 50000);
      assert.equal(sale.json().value.taxMinor, 8000);
      assert.equal(sale.json().value.totalMinor, 58000);
      assert.equal(sale.json().value.changeMinor, 2000);
      const saleReplay = await postCommand(saleCommand);
      assert.deepEqual(saleReplay.json(), sale.json());
      const saleId = String(sale.json().value.saleId);

      const managerOrders = await app.inject({ method: 'GET', url: '/api/v1/sales/orders', headers });
      assert.equal(managerOrders.statusCode, 200, managerOrders.body);
      const managerOrder = (managerOrders.json().orders as Array<{ id: string; lines: Array<{ costPriceMinor?: number | string;cogsMinor?:string }> }>).find(order => order.id === saleId);
      assert.ok(managerOrder, 'manager should see the confirmed sale');
      assert.equal(Number(managerOrder.lines[0].costPriceMinor), 15000, 'finance users may read historical unit cost');
      assert.equal(managerOrder.lines[0].cogsMinor,'38333','sale snapshots exact weighted-average COGS in minor units');
      const saleReceiptResponse = await app.inject({ method: 'GET', url: `/api/v1/sales/orders/${saleId}/receipt`, headers });
      assert.equal(saleReceiptResponse.statusCode, 200, saleReceiptResponse.body);
      const saleReceipt = saleReceiptResponse.json() as {
        status: string; fiscalDocumentStatus: string; receiptNumber: string; tenantName: string; outletName: string; timeZone: string; currency: string;
        subtotalMinor: string; taxMinor: string; totalMinor: string; amountPaidMinor: string; cashTenderedMinor: string; changeMinor: string;
        lines: Array<{ taxRateBps: number; subtotalMinor: string; taxMinor: string; totalMinor: string }>;
      };
      assert.equal(saleReceipt.status, 'CONFIRMED');
      assert.equal(saleReceipt.fiscalDocumentStatus, 'NOT_INTEGRATED');
      assert.match(saleReceipt.receiptNumber, /^MZ-[0-9A-F]{32}$/);
      assert.equal(saleReceipt.tenantName, 'Disposable API integration tenant');
      assert.equal(saleReceipt.outletName, 'Integration outlet');
      assert.equal(saleReceipt.timeZone, 'Africa/Nairobi');
      assert.equal(saleReceipt.currency, 'KES');
      assert.equal(saleReceipt.subtotalMinor, '50000');
      assert.equal(saleReceipt.taxMinor, '8000');
      assert.equal(saleReceipt.totalMinor, '58000');
      assert.equal(saleReceipt.amountPaidMinor, '58000');
      assert.equal(saleReceipt.cashTenderedMinor, '60000');
      assert.equal(saleReceipt.changeMinor, '2000');
      assert.deepEqual(saleReceipt.lines.map(line => ({ taxRateBps: line.taxRateBps, subtotalMinor: line.subtotalMinor, taxMinor: line.taxMinor, totalMinor: line.totalMinor })), [
        { taxRateBps: 1600, subtotalMinor: '50000', taxMinor: '8000', totalMinor: '58000' },
      ]);
      const saleCogsJournal=await db.pool.query<{debit_minor:string;credit_minor:string}>(`SELECT coalesce(sum(jl.debit_minor),0)::text debit_minor,coalesce(sum(jl.credit_minor),0)::text credit_minor FROM finance.journal_entries je JOIN finance.journal_lines jl ON jl.journal_entry_id=je.id WHERE je.tenant_id=$1 AND je.source_type='SALE_COGS' AND je.source_id=$2`,[tenantId,saleCommand.commandId]);
      assert.deepEqual(saleCogsJournal.rows[0],{debit_minor:'38333',credit_minor:'38333'},'sale journal must use the same weighted-average COGS snapshot');

      const reportBusinessDateResult = await db.pool.query<{ business_date: string }>("SELECT (now() AT TIME ZONE 'Africa/Nairobi')::date::text business_date");
      const reportBusinessDate = reportBusinessDateResult.rows[0].business_date;
      const trialBalance = await app.inject({ method: 'GET', url: `/api/v1/reports/trial-balance?asOf=${reportBusinessDate}`, headers });
      assert.equal(trialBalance.statusCode, 200, trialBalance.body);
      const trialBalanceBody = trialBalance.json() as {
        reportType: string; scope: string; timeZone: string;
        totals: { debitMinor: string; creditMinor: string; differenceMinor: string; balanced: boolean };
        accounts: Array<{ accountCode: string; netDebitMinor: string; netCreditMinor: string }>;
        coverage: { status: string; sourceTypes: Array<{ sourceType: string }> };
      };
      assert.equal(trialBalanceBody.reportType, 'TRIAL_BALANCE');
      assert.equal(trialBalanceBody.scope, 'TENANT');
      assert.equal(trialBalanceBody.timeZone, 'Africa/Nairobi');
      assert.equal(trialBalanceBody.totals.balanced, true);
      assert.equal(trialBalanceBody.totals.debitMinor, trialBalanceBody.totals.creditMinor);
      assert.equal(trialBalanceBody.totals.differenceMinor, '0');
      assert.equal(trialBalanceBody.totals.debitMinor, trialBalanceBody.accounts.reduce((sum, account) => sum + BigInt(account.netDebitMinor), 0n).toString());
      assert.equal(trialBalanceBody.totals.creditMinor, trialBalanceBody.accounts.reduce((sum, account) => sum + BigInt(account.netCreditMinor), 0n).toString());
      assert.ok(trialBalanceBody.accounts.some(account => account.accountCode === 'SALES_REVENUE' && BigInt(account.netCreditMinor) > 0n));
      assert.equal(trialBalanceBody.coverage.status, 'POSTED_JOURNAL_ONLY');

      const partialSummary = await app.inject({ method: 'GET', url: `/api/v1/reports/profit-loss?from=${reportBusinessDate}&to=${reportBusinessDate}`, headers });
      assert.equal(partialSummary.statusCode, 200, partialSummary.body);
      const partialSummaryBody = partialSummary.json() as {
        reportType: string; totals: Record<string, string>; coverage: { status: string; omittedSources: string[] };
      };
      assert.equal(partialSummaryBody.reportType, 'PARTIAL_OPERATING_SUMMARY');
      assert.equal(partialSummaryBody.coverage.status, 'PARTIAL');
      assert.ok(BigInt(partialSummaryBody.totals.revenueMinor) > 0n);
      assert.ok(partialSummaryBody.coverage.omittedSources.length > 0);
      assert.equal(Object.hasOwn(partialSummaryBody.totals, 'netProfitMinor'), false);

      const accountDrilldown = await app.inject({ method: 'GET', url: `/api/v1/reports/journal-lines?accountCode=SALES_REVENUE&asOf=${reportBusinessDate}&limit=10`, headers });
      assert.equal(accountDrilldown.statusCode, 200, accountDrilldown.body);
      assert.ok(BigInt(accountDrilldown.json().total) >= 1n);
      assert.ok(accountDrilldown.json().entries.some((line: { sourceType: string; sourceId: string }) => line.sourceType === 'SALE' && line.sourceId === saleCommand.commandId));
      const invalidReportDate = await app.inject({ method: 'GET', url: '/api/v1/reports/trial-balance?asOf=2026-02-30', headers });
      assert.equal(invalidReportDate.statusCode, 400);

      const cashierId = randomUUID();
      const cashierDeviceId = randomUUID();
      const cashierEmail = `cashier-${cashierId}@example.invalid`;
      const cashierPassword = 'cashier-only-integration-password';
      await db.pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)', [cashierId, cashierEmail, await hashPassword(cashierPassword), 'Integration Cashier']);
      await db.pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'cashier')", [tenantId, cashierId]);
      await db.pool.query('INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,$5)', [cashierDeviceId, tenantId, outletId, cashierId, 'Disposable cashier device']);
      const cashierLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: cashierEmail, password: cashierPassword } });
      assert.equal(cashierLogin.statusCode, 200, cashierLogin.body);
      const cashierSession = cashierLogin.json() as { csrfToken: string; user: { permissions: string[] } };
      assert.ok(cashierSession.user.permissions.includes('commerce.sell'));
      assert.ok(!cashierSession.user.permissions.includes('catalog.manage'));
      assert.ok(!cashierSession.user.permissions.includes('finance.view'));
      assert.ok(!cashierSession.user.permissions.includes('shift.payout'));
      const cashierRawCookies = cashierLogin.headers['set-cookie'];
      const cashierCookies = (Array.isArray(cashierRawCookies) ? cashierRawCookies : [cashierRawCookies])
        .filter((value): value is string => typeof value === 'string')
        .map(value => value.split(';', 1)[0])
        .join('; ');
      const cashierHeaders = { cookie: cashierCookies, origin: 'http://localhost:3000', 'x-csrf-token': cashierSession.csrfToken };

      const cashierSaleReceipt = await app.inject({ method: 'GET', url: `/api/v1/sales/orders/${saleId}/receipt`, headers: cashierHeaders });
      assert.equal(cashierSaleReceipt.statusCode, 200, cashierSaleReceipt.body);
      assert.equal(cashierSaleReceipt.json().receiptId, saleId);
      const cashierTrialBalance = await app.inject({ method: 'GET', url: `/api/v1/reports/trial-balance?asOf=${reportBusinessDate}`, headers: cashierHeaders });
      assert.equal(cashierTrialBalance.statusCode, 403);
      const cashierOperatingSummary = await app.inject({ method: 'GET', url: `/api/v1/reports/profit-loss?from=${reportBusinessDate}&to=${reportBusinessDate}`, headers: cashierHeaders });
      assert.equal(cashierOperatingSummary.statusCode, 403);

      const cashierPayout = await app.inject({
        method: 'POST', url: '/api/v1/commands', headers: { ...cashierHeaders, 'content-type': 'application/json' },
        payload: JSON.stringify({
          protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId: cashierDeviceId, type: 'shift.cash.movement',
          occurredAt: new Date().toISOString(), expectedVersions: { [`shift:${shiftId}`]: 5 },
          payload: { shiftId, movementType: 'PAYOUT', amountMinor: 1000, reason: 'Unauthorized cashier payout' },
        }),
      });
      assert.equal(cashierPayout.statusCode, 200, cashierPayout.body);
      assert.equal(cashierPayout.json().status, 'REJECTED');
      assert.equal(cashierPayout.json().code, 'FORBIDDEN');

      const cashierCountAccess = await app.inject({ method:'GET',url:'/api/v1/inventory/counts',headers:cashierHeaders });
      assert.equal(cashierCountAccess.statusCode,403);
      const cashierCountCancel = await app.inject({
        method:'POST',url:'/api/v1/commands',headers:{...cashierHeaders,'content-type':'application/json'},
        payload:JSON.stringify({protocolVersion:1,commandId:randomUUID(),tenantId,deviceId:cashierDeviceId,type:'inventory.count.cancel',occurredAt:new Date().toISOString(),expectedVersions:{[`count:${conflictedCountId}`]:2},payload:{countId:conflictedCountId}}),
      });
      assert.equal(cashierCountCancel.statusCode,200,cashierCountCancel.body);
      assert.equal(cashierCountCancel.json().status,'REJECTED');
      assert.equal(cashierCountCancel.json().code,'FORBIDDEN');

      const cashierCatalog = await app.inject({ method: 'GET', url: '/api/v1/catalog/items', headers: cashierHeaders });
      assert.equal(cashierCatalog.statusCode, 200, cashierCatalog.body);
      const cashierItem = (cashierCatalog.json().items as Array<Record<string, unknown>>).find(item => item.sku === 'GAP-530CDBF');
      assert.ok(cashierItem, 'cashier should see sellable catalog items');
      assert.equal(Object.hasOwn(cashierItem, 'costPriceMinor'), false, 'cashier catalog response must omit cost');
      assert.equal(Object.hasOwn(cashierItem, 'inventoryValueMinor'), false, 'cashier catalog response must omit carrying value');

      const cashierOrders = await app.inject({ method: 'GET', url: '/api/v1/sales/orders', headers: cashierHeaders });
      assert.equal(cashierOrders.statusCode, 200, cashierOrders.body);
      const cashierOrder = (cashierOrders.json().orders as Array<{ id: string; lines: Array<Record<string, unknown>> }>).find(order => order.id === saleId);
      assert.ok(cashierOrder, 'cashier may review sales history');
      assert.equal(Object.hasOwn(cashierOrder.lines[0], 'costPriceMinor'), false, 'cashier sales response must omit historical cost');
      assert.equal(Object.hasOwn(cashierOrder.lines[0], 'cogsMinor'), false, 'cashier sales response must omit COGS');

      const line = await db.pool.query<{ id: string }>('SELECT id FROM commerce.order_lines WHERE tenant_id=$1 AND outlet_id=$2 AND order_id=$3', [tenantId, outletId, saleId]);
      assert.equal(line.rowCount, 1);

      const refundCommand = {
        protocolVersion: 1,
        commandId: randomUUID(),
        tenantId,
        deviceId,
        type: 'sales.order.refund',
        occurredAt: new Date().toISOString(),
        expectedVersions: { [`shift:${shiftId}`]: 5 },
        payload: { orderId: saleId, shiftId, reason: 'CI partial return', lines: [{ orderLineId: line.rows[0].id, quantity: '1', restock: true }] },
      };
      const refund = await postCommand(refundCommand);
      assert.equal(refund.statusCode, 200, refund.body);
      assert.equal(refund.json().status, 'CONFIRMED');
      assert.equal(refund.json().value.totalMinor, 29000);
      assert.equal(refund.json().value.status,'PARTIALLY_REFUNDED');
      const refundValue=await db.pool.query<{cogs_minor:string;movement_value_minor:string;inventory_value_minor:string}>(`SELECT
        (SELECT sum(cogs_minor)::text FROM commerce.refund_lines WHERE tenant_id=$1 AND outlet_id=$2 AND order_id=$3) cogs_minor,
        (SELECT value_minor::text FROM inventory.movements WHERE tenant_id=$1 AND command_id=$4 AND movement_type='REFUND') movement_value_minor,
        (SELECT inventory_value_minor::text FROM inventory.balances WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$5) inventory_value_minor`,[tenantId,outletId,saleId,refundCommand.commandId,productId]);
      assert.deepEqual(refundValue.rows[0],{cogs_minor:'19167',movement_value_minor:'19167',inventory_value_minor:'95834'},'restocked refund restores the original sale COGS value');
      const refundReplay = await postCommand(refundCommand);
      assert.deepEqual(refundReplay.json(), refund.json());

      const close = await postCommand({
        protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId, type: 'shift.close',
        occurredAt: new Date().toISOString(), expectedVersions: { [`shift:${shiftId}`]: 6 },
        payload: { shiftId, countedCashMinor: 92600 },
      });
      assert.equal(close.statusCode, 200, close.body);
      assert.equal(close.json().status, 'CONFIRMED');
      assert.equal(close.json().value.varianceMinor, 0);

      const balances = await db.pool.query<{ quantity: string;inventory_value_minor:string;movement_quantity:string;movement_value_minor:string; unbalanced_journals: string; refunds: string; shift_status: string; expected_cash_minor: string; variance_minor: string }>(`SELECT
        (SELECT quantity::text FROM inventory.balances WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3) quantity,
        (SELECT inventory_value_minor::text FROM inventory.balances WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3) inventory_value_minor,
        (SELECT coalesce(sum(quantity_delta),0)::text FROM inventory.movements WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3) movement_quantity,
        (SELECT coalesce(sum(CASE WHEN quantity_delta<0 THEN -value_minor ELSE value_minor END),0)::text FROM inventory.movements WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3) movement_value_minor,
        (SELECT count(*)::text FROM (SELECT je.id FROM finance.journal_entries je LEFT JOIN finance.journal_lines jl ON jl.journal_entry_id=je.id WHERE je.tenant_id=$1 GROUP BY je.id HAVING coalesce(sum(jl.debit_minor),0)<>coalesce(sum(jl.credit_minor),0) OR coalesce(sum(jl.debit_minor),0)=0) unbalanced) unbalanced_journals,
        (SELECT count(*)::text FROM commerce.refunds WHERE tenant_id=$1 AND outlet_id=$2 AND order_id=$4) refunds,
        (SELECT status FROM commerce.shifts WHERE tenant_id=$1 AND outlet_id=$2 AND id=$5) shift_status,
        (SELECT expected_cash_minor::text FROM commerce.shifts WHERE tenant_id=$1 AND outlet_id=$2 AND id=$5) expected_cash_minor,
        (SELECT variance_minor::text FROM commerce.shifts WHERE tenant_id=$1 AND outlet_id=$2 AND id=$5) variance_minor`, [tenantId, outletId, productId, saleId, shiftId]);
      assert.equal(balances.rows[0].quantity, '5.000000');
      assert.equal(balances.rows[0].inventory_value_minor, '95834','sale and partial refund conserve the remaining moving-average carrying value');
      assert.equal(balances.rows[0].movement_quantity,balances.rows[0].quantity,'movement quantities reconcile to the stock balance');
      assert.equal(balances.rows[0].movement_value_minor,balances.rows[0].inventory_value_minor,'immutable movement values reconcile to the stock carrying value');
      assert.equal(balances.rows[0].unbalanced_journals, '0');
      assert.equal(balances.rows[0].refunds, '1');
      assert.equal(balances.rows[0].shift_status, 'CLOSED');
      assert.equal(balances.rows[0].expected_cash_minor, '92600');
      assert.equal(balances.rows[0].variance_minor, '0');
    } finally {
      await app.close();
      await db.pool.end();
    }
  });
}

