import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool } from './db.js';

const migrationPath = fileURLToPath(new URL('../migrations/001_initial.sql', import.meta.url));
const sql = await readFile(migrationPath, 'utf8');
const checksum = createHash('sha256').update(sql).digest('hex');
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('CREATE SCHEMA IF NOT EXISTS system');
  await client.query(`CREATE TABLE IF NOT EXISTS system.schema_migrations (
    version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const existing = await client.query<{ checksum: string }>('SELECT checksum FROM system.schema_migrations WHERE version = $1 FOR UPDATE', ['001_initial']);
  if (existing.rowCount) {
    if (existing.rows[0].checksum !== checksum) throw new Error('Migration 001_initial checksum differs from the applied checksum. Applied migrations are immutable.');
    await client.query('COMMIT');
    process.stdout.write('Migration 001_initial already applied; checksum matches.\n');
  } else {
    await client.query(sql);
    await client.query('INSERT INTO system.schema_migrations(version, checksum) VALUES ($1, $2)', ['001_initial', checksum]);
    await client.query('COMMIT');
    process.stdout.write(`Applied 001_initial (${checksum.slice(0, 12)}).\n`);
  }
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
