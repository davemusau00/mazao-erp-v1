import { Pool, type PoolClient } from 'pg';
import { recordDatabaseQuery, recordPoolWait, requestMetricsStorage, type RequestMetrics } from './requestMetrics.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required by the API process.');

export const pool = new Pool({
  connectionString,
  max: Number(process.env.DB_POOL_SIZE ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: process.env.DATABASE_SSL === 'require' ? { rejectUnauthorized: true } : undefined,
});

// Instrument checked-out clients instead of wrapping domain query sites. This
// captures pool acquisition separately from PostgreSQL execution, including
// pool.query() calls, without recording SQL text or parameter values.
const instrumentedClients = new WeakSet<object>();
const checkoutMetrics = new WeakMap<object, RequestMetrics | undefined>();
function instrumentClient(client: PoolClient) {
  if (instrumentedClients.has(client)) return;
  instrumentedClients.add(client);
  const originalQuery = client.query.bind(client) as (...args: any[]) => any;
  const originalRelease = client.release.bind(client) as (...args: any[]) => any;
  Object.defineProperty(client, 'query', {
    configurable: true,
    value: (...args: any[]) => {
      const startedAt = performance.now();
      const metrics = checkoutMetrics.has(client) ? checkoutMetrics.get(client) : requestMetricsStorage.getStore();
      const callbackIndex = args.length - 1;
      if (callbackIndex >= 0 && typeof args[callbackIndex] === 'function') {
        const callback = args[callbackIndex];
        args[callbackIndex] = (...callbackArgs: unknown[]) => {
          recordDatabaseQuery(performance.now() - startedAt, metrics);
          return (callback as (...values: unknown[]) => unknown)(...callbackArgs);
        };
        try { return originalQuery(...args); }
        catch (error) { recordDatabaseQuery(performance.now() - startedAt, metrics); throw error; }
      }
      let result: any;
      try { result = originalQuery(...args); }
      catch (error) { recordDatabaseQuery(performance.now() - startedAt, metrics); throw error; }
      if (result && typeof result.then === 'function') {
        return result.then(
          (value: unknown) => { recordDatabaseQuery(performance.now() - startedAt, metrics); return value; },
          (error: unknown) => { recordDatabaseQuery(performance.now() - startedAt, metrics); throw error; },
        );
      }
      return result;
    },
  });
  Object.defineProperty(client, 'release', {
    configurable: true,
    value: (...args: any[]) => {
      checkoutMetrics.delete(client);
      return originalRelease(...args);
    },
  });
}

const originalConnect = pool.connect.bind(pool) as (...args: any[]) => any;
Object.defineProperty(pool, 'connect', {
  configurable: true,
  value: (...args: any[]) => {
    const startedAt = performance.now();
    const metrics = requestMetricsStorage.getStore();
    const callbackIndex = args.length - 1;
    if (callbackIndex >= 0 && typeof args[callbackIndex] === 'function') {
      const callback = args[callbackIndex];
      args[callbackIndex] = (...callbackArgs: any[]) => {
        recordPoolWait(performance.now() - startedAt, metrics);
        if (!callbackArgs[0] && callbackArgs[1]) {
          const client = callbackArgs[1] as PoolClient;
          instrumentClient(client);
          checkoutMetrics.set(client, metrics);
        }
        return (callback as (...values: any[]) => unknown)(...callbackArgs);
      };
      try { return originalConnect(...args); }
      catch (error) { recordPoolWait(performance.now() - startedAt, metrics); throw error; }
    }
    return originalConnect(...args).then((client: PoolClient) => {
      recordPoolWait(performance.now() - startedAt, metrics);
      instrumentClient(client);
      checkoutMetrics.set(client, metrics);
      return client;
    }, (error: unknown) => {
      recordPoolWait(performance.now() - startedAt, metrics);
      throw error;
    });
  },
});

/** All queries in a multi-query read observe one committed database snapshot. */
export async function inReadSnapshot<T>(read: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const value = await read(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    try { await client.query('ROLLBACK'); }
    catch { discard = true; }
    throw error;
  } finally {
    client.release(discard);
  }
}

export async function inTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  // Callbacks must contain database work only. Retrying must never repeat an
  // external payment, print, email, or other effect before the transaction commits.
  const retryable = new Set(['40001', '40P01']);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const value = await run(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* connection will be released */ }
      const code = (error as { code?: string }).code;
      if (!retryable.has(code ?? '') || attempt === 3) throw error;
    } finally {
      client.release();
    }
    await new Promise(resolve => setTimeout(resolve, attempt * 15));
  }
  throw new Error('Transaction retry loop ended unexpectedly.');
}
