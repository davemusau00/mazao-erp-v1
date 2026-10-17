import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import type { PoolClient } from 'pg';
import type { CommandEnvelope } from '../src/contracts.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  test('customer statements keep one committed snapshot during concurrent sales and repayments', { skip: 'Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database.' }, () => {});
} else {
  process.env.DATABASE_URL = databaseUrl;
  process.env.APP_ORIGINS ??= 'http://localhost:3000';
  const [{ buildApp }, { hashPassword }, db] = await Promise.all([import('../src/app.js'), import('../src/security.js'), import('../src/db.js')]);

  async function fixture() {
    const tenantId = randomUUID(), outletId = randomUUID(), userId = randomUUID(), deviceId = randomUUID();
    const email = `statement-${userId}@example.invalid`, password = `Disposable-statement-${randomUUID()}`;
    await db.pool.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Statement snapshot business','KES','Africa/Nairobi')", [tenantId]);
    await db.pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Statement snapshot outlet','Africa/Nairobi')", [outletId, tenantId]);
    await db.pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'commerce'),($1,'inventory')", [tenantId]);
    await db.pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)', [userId, email, await hashPassword(password), 'Statement Admin']);
    await db.pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')", [tenantId, userId]);
    await db.pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Statement snapshot workspace')", [deviceId, tenantId, outletId, userId]);
    const app = buildApp(); await app.ready();
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    assert.equal(login.statusCode, 200, login.body);
    const raw = login.headers['set-cookie'];
    const cookie = (Array.isArray(raw) ? raw : [raw]).filter((value): value is string => typeof value === 'string').map(value => value.split(';', 1)[0]).join('; ');
    const headers = { cookie, origin: process.env.APP_ORIGINS!.split(',')[0], 'x-csrf-token': login.json().csrfToken };
    const submit = async (type: string, payload: Record<string, unknown>, expectedVersions: Record<string, number> = {}) => {
      const envelope: CommandEnvelope = { protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId, type, occurredAt: new Date().toISOString(), expectedVersions, payload };
      const response = await app.inject({ method: 'POST', url: '/api/v1/commands', headers, payload: envelope });
      assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().status, 'CONFIRMED', response.body);
      return response.json().value;
    };
    const product = await submit('catalog.product.create', { sku: 'STATEMENT-ITEM', name: 'Statement item', baseUnit: 'each', currency: 'KES', sellingPriceMinor: 101, costPriceMinor: 40, taxRateBps: 1600 });
    await submit('inventory.receive', { lines: [{ productId: product.productId, quantity: '10', unitCostMinor: 40 }] });
    const customer = await submit('customers.account.create', { name: 'Snapshot customer', phone: '+254700000039', creditLimitMinor: 100000 });
    const shift = await submit('shift.open', { openingFloatMinor: 0 });
    const shiftId = String(shift.shiftId), customerId = String(customer.customerId);
    const currentVersion = async () => Number((await db.pool.query('SELECT version FROM commerce.shifts WHERE tenant_id=$1 AND id=$2', [tenantId, shiftId])).rows[0].version);
    const sale = async () => submit('sales.order.settle', { shiftId, customerId, lines: [{ productId: product.productId, quantity: '1' }], tenders: [] }, { [`shift:${shiftId}`]: await currentVersion() });
    const repay = async () => submit('customers.repayment', { customerId, shiftId, amountMinor: 16, reference: 'SNAPSHOT-COLLECTION' }, { [`shift:${shiftId}`]: await currentVersion() });
    const statement = () => app.inject({ method: 'GET', url: `/api/v1/customers/${customerId}/statement`, headers });
    return { app, headers, tenantId, outletId, userId, shiftId, customerId, sale, repay, statement };
  }

  /** Interleave a real committed domain write after the account SELECT returns.
   * Both query entry points are wrapped so the regression also fails with the old
   * separate pool.query implementation. Production has no test hook or delay. */
  function interleaveAccountRead(context: TestContext, commit: () => Promise<unknown>) {
    const originalConnect = db.pool.connect, originalQuery = db.pool.query;
    let intercepted = 0;
    const modes: Array<{ transaction_isolation: string; transaction_read_only: string }> = [];
    const afterRead = async (sql: unknown, client?: PoolClient) => {
      if (intercepted || typeof sql !== 'string' || !sql.includes('FROM finance.customer_accounts WHERE id=$1 AND tenant_id=$2')) return;
      intercepted++;
      if (client) {
        const mode = await client.query("SELECT current_setting('transaction_isolation') transaction_isolation,current_setting('transaction_read_only') transaction_read_only");
        modes.push(mode.rows[0]);
      }
      await commit();
    };
    context.mock.method(db.pool, 'connect', function (...args: unknown[]) {
      const acquired = Reflect.apply(originalConnect, db.pool, args);
      if (args.length) return acquired; // Preserve pg's callback overload used by pool.query.
      return (acquired as Promise<PoolClient>).then(client => new Proxy(client, {
        get(target, property) {
          if (property === 'query') return async (...queryArgs: unknown[]) => {
            const result = await Reflect.apply(target.query, target, queryArgs);
            await afterRead(queryArgs[0], target);
            return result;
          };
          const value = Reflect.get(target, property);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }));
    } as typeof db.pool.connect);
    context.mock.method(db.pool, 'query', async function (...args: unknown[]) {
      const result = await Reflect.apply(originalQuery, db.pool, args);
      await afterRead(args[0]);
      return result;
    } as typeof db.pool.query);
    return { assertCommittedBetweenReads: () => { assert.equal(intercepted, 1); assert.deepEqual(modes, [{ transaction_isolation: 'repeatable read', transaction_read_only: 'on' }]); } };
  }

  test('concurrent credit sale cannot mix an old account balance with new charge events', async context => {
    const data = await fixture();
    try {
      const interleaving = interleaveAccountRead(context, data.sale);
      const response = await data.statement();
      assert.equal(response.statusCode, 200, response.body);
      interleaving.assertCommittedBetweenReads();
      assert.equal(response.json().customer.balanceMinor, '0');
      assert.equal(response.json().customer.version, 1);
      assert.deepEqual(response.json().entries, []);
      const refreshed = await data.statement();
      assert.equal(refreshed.statusCode, 200, refreshed.body);
      assert.equal(refreshed.json().customer.balanceMinor, '117');
      assert.equal(refreshed.json().customer.version, 2);
      assert.deepEqual(refreshed.json().entries.map((row: { amountMinor: string; balanceAfterMinor: string }) => [row.amountMinor, row.balanceAfterMinor]), [['117', '117']]);
    } finally { await data.app.close(); }
  });

  test('concurrent FIFO cash repayment cannot mix its events and allocations into a prior statement snapshot', async context => {
    const data = await fixture();
    try {
      await data.sale();
      const interleaving = interleaveAccountRead(context, data.repay);
      const response = await data.statement();
      assert.equal(response.statusCode, 200, response.body);
      interleaving.assertCommittedBetweenReads();
      assert.equal(response.json().customer.balanceMinor, '117');
      assert.equal(response.json().entries.length, 1);
      const refreshed = await data.statement();
      assert.equal(refreshed.statusCode, 200, refreshed.body);
      assert.equal(refreshed.json().customer.balanceMinor, '101');
      assert.deepEqual(refreshed.json().entries.map((row: { type: string; amountMinor: string; balanceAfterMinor: string }) => [row.type, row.amountMinor, row.balanceAfterMinor]), [['CHARGE', '117', '117'], ['REPAYMENT', '16', '101']]);
      assert.deepEqual(refreshed.json().entries[1].allocations.map((row: { amountMinor: string }) => row.amountMinor), ['16']);
    } finally { await data.app.close(); }
  });

  test('statement snapshots still reject genuine account and repayment allocation corruption', async () => {
    const data = await fixture();
    try {
      await data.sale();
      await db.pool.query('UPDATE finance.customer_accounts SET balance_minor=118 WHERE tenant_id=$1 AND id=$2', [data.tenantId, data.customerId]);
      const mismatch = await data.statement();
      assert.equal(mismatch.statusCode, 500);
      assert.equal(mismatch.json().error.code, 'CUSTOMER_LEDGER_INTEGRITY_FAILED');
      await db.pool.query('UPDATE finance.customer_accounts SET balance_minor=117 WHERE tenant_id=$1 AND id=$2', [data.tenantId, data.customerId]);
      await data.repay();
      await db.pool.query('UPDATE finance.customer_repayment_allocations SET amount_minor=15 WHERE tenant_id=$1 AND customer_account_id=$2', [data.tenantId, data.customerId]);
      const allocationMismatch = await data.statement();
      assert.equal(allocationMismatch.statusCode, 500);
      assert.equal(allocationMismatch.json().error.code, 'CUSTOMER_LEDGER_INTEGRITY_FAILED');
    } finally { await data.app.close(); }
  });

  test('statements preserve bigint minor-unit text and deny foreign tenants and unauthorized roles', async () => {
    const data = await fixture();
    try {
      const exactMinor = '9007199254740993', orderId = randomUUID();
      // Historical-read fixture deliberately exceeds JavaScript's safe integer
      // range; no conversion to Number is allowed in statement projections.
      await db.pool.query(`INSERT INTO commerce.orders(id,tenant_id,outlet_id,shift_id,operator_id,currency,subtotal_minor,tax_minor,total_minor,status,receipt_number,tenant_name_snapshot,outlet_name_snapshot,outlet_time_zone_snapshot,customer_account_id,customer_name_snapshot,customer_amount_due_minor)
        VALUES($1,$2,$3,$4,$5,'KES',$6,0,$6,'CONFIRMED','STATEMENT-BIGINT','Snapshot business','Snapshot outlet','Africa/Nairobi',$7,'Snapshot customer',$6)`, [orderId, data.tenantId, data.outletId, data.shiftId, data.userId, exactMinor, data.customerId]);
      await db.pool.query('INSERT INTO finance.customer_charges(id,tenant_id,outlet_id,customer_account_id,order_id,amount_minor,currency) VALUES($1,$2,$3,$4,$5,$6,\'KES\')', [randomUUID(), data.tenantId, data.outletId, data.customerId, orderId, exactMinor]);
      await db.pool.query('UPDATE finance.customer_accounts SET balance_minor=$3,credit_limit_minor=$3 WHERE tenant_id=$1 AND id=$2', [data.tenantId, data.customerId, exactMinor]);
      const response = await data.statement();
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().customer.balanceMinor, exactMinor);
      assert.equal(response.json().customer.creditLimitMinor, exactMinor);
      assert.equal(response.json().entries[0].amountMinor, exactMinor);
      assert.equal(response.json().entries[0].balanceAfterMinor, exactMinor);

      const foreign = await fixture();
      try {
        const denied = await foreign.app.inject({ method: 'GET', url: `/api/v1/customers/${data.customerId}/statement`, headers: foreign.headers });
        assert.equal(denied.statusCode, 404);
        assert.equal(denied.json().error.code, 'NOT_FOUND');
      } finally { await foreign.app.close(); }
      await db.pool.query("UPDATE identity.memberships SET role='storekeeper' WHERE tenant_id=$1 AND user_id=$2", [data.tenantId, data.userId]);
      assert.equal((await data.statement()).statusCode, 403);
      await db.pool.query("UPDATE identity.memberships SET role='admin' WHERE tenant_id=$1 AND user_id=$2", [data.tenantId, data.userId]);
      await db.pool.query("DELETE FROM core.tenant_capabilities WHERE tenant_id=$1 AND capability='commerce'", [data.tenantId]);
      assert.equal((await data.statement()).statusCode, 403);
    } finally { await data.app.close(); }
  });

  test('read-only snapshot rejects writes and releases the failed transaction for subsequent reads', async () => {
    await assert.rejects(db.inReadSnapshot(client => client.query("CREATE TABLE public.statement_snapshot_write_must_fail(id integer)")), (error: { code?: string }) => error.code === '25006');
    assert.equal(await db.inReadSnapshot(async client => (await client.query('SELECT 39::int value')).rows[0].value), 39);
    assert.equal((await db.pool.query("SELECT to_regclass('public.statement_snapshot_write_must_fail') relation")).rows[0].relation, null);
  });

  test('snapshot cleanup preserves the original failure and discards a connection when rollback fails', async context => {
    const originalFailure = new Error('Failed statement read');
    const released: boolean[] = [];
    const client = { query: async (sql: string) => { if (sql === 'ROLLBACK') throw new Error('Disconnected during rollback'); return { rows: [] }; }, release: (discard: boolean) => { released.push(discard); } };
    context.mock.method(db.pool, 'connect', (async () => client as unknown as PoolClient) as typeof db.pool.connect);
    await assert.rejects(db.inReadSnapshot(async () => { throw originalFailure; }), error => error === originalFailure);
    assert.deepEqual(released, [true]);
  });

  test.after(async () => { await db.pool.end(); });
}
