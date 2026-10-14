import { test } from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  test('serializable transaction retry and attempt limit', { skip: 'Set TEST_DATABASE_URL to a disposable PostgreSQL database.' }, () => {});
} else {
  process.env.DATABASE_URL = databaseUrl;
  const db = await import('../src/db.js');

  test('serializable transaction retries 40001 and 40P01 and stops after three attempts', async () => {
    const failureSql: Record<'40001' | '40P01', string> = {
      '40001': "DO $$ BEGIN RAISE EXCEPTION 'serialization retry acceptance' USING ERRCODE='40001'; END $$",
      '40P01': "DO $$ BEGIN RAISE EXCEPTION 'deadlock retry acceptance' USING ERRCODE='40P01'; END $$",
    };

    for (const code of ['40001', '40P01'] as const) {
      let attempts = 0;
      const value = await db.inTransaction(async client => {
        attempts += 1;
        if (attempts === 1) await client.query(failureSql[code]);
        return 'committed after retry';
      });
      assert.equal(value, 'committed after retry');
      assert.equal(attempts, 2, `${code} should cause exactly one retry`);
    }

    let failedAttempts = 0;
    await assert.rejects(
      db.inTransaction(async client => {
        failedAttempts += 1;
        await client.query(failureSql['40001']);
      }),
      (error: { code?: string }) => error.code === '40001',
    );
    assert.equal(failedAttempts, 3, 'retryable failures should stop after the configured third attempt');
  });

  test.after(async () => { await db.pool.end(); });
}
