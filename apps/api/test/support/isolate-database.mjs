import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Node runs --import preloads before each isolated test process. Never let
// unrelated files create false SSI dependencies through shared fixture tables.
// Deliberate Promise.all races inside a file still share the same database.
if (process.env.TEST_DATABASE_URL) {
  const source = new URL(process.env.TEST_DATABASE_URL);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname)) {
    throw new Error('API integration isolation requires a disposable localhost PostgreSQL server.');
  }
  const databaseName = `mazao_api_${randomUUID().replaceAll('-', '')}`;
  const maintenanceUrl = new URL(source); maintenanceUrl.pathname = '/postgres';
  const isolatedUrl = new URL(source); isolatedUrl.pathname = `/${databaseName}`;
  const admin = new pg.Pool({ connectionString: maintenanceUrl.href, max: 1, connectionTimeoutMillis: 5000 });
  try {
    // databaseName is generated solely from a fixed prefix and UUID hex.
    await admin.query(`CREATE DATABASE "${databaseName}"`);
  } finally { await admin.end(); }

  const environment = { ...process.env, DATABASE_URL: isolatedUrl.href, TEST_DATABASE_URL: isolatedUrl.href };
  delete environment.MIGRATION_TARGET;
  const migration = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../../src/migration.ts', import.meta.url))], {
    cwd: fileURLToPath(new URL('../../../../', import.meta.url)), env: environment, encoding: 'utf8', timeout: 60000,
  });
  if (migration.status !== 0) {
    const detail = String(migration.error?.message ?? migration.stderr ?? '').replaceAll(source.href, '[test database]').replaceAll(isolatedUrl.href, '[isolated test database]');
    throw new Error(`Disposable API test database migrations failed: ${detail}`);
  }
  process.env.DATABASE_URL = isolatedUrl.href;
  process.env.TEST_DATABASE_URL = isolatedUrl.href;
  // CI disposes its PostgreSQL service at job end. Local runs retain generated
  // databases for diagnosis in the explicitly disposable server; no cleanup
  // drops a caller-supplied database or races another file's open connections.
  process.stdout.write(`Isolated API test database: ${databaseName}\n`);
}
