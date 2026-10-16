import { Pool, type PoolClient } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required by the API process.');

export const pool = new Pool({
  connectionString,
  max: Number(process.env.DB_POOL_SIZE ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: process.env.DATABASE_SSL === 'require' ? { rejectUnauthorized: true } : undefined,
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
