import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const versions=['001_initial','002_receipt_document_reference','003_cash_refunds','004_hospitality'];
const client=await pool.connect();
try {
  await client.query('CREATE SCHEMA IF NOT EXISTS system');
  await client.query(`CREATE TABLE IF NOT EXISTS system.schema_migrations (
    version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  for(const version of versions) {
    const migrationPath=fileURLToPath(new URL(`../migrations/${version}.sql`,import.meta.url));
    const sql=await readFile(migrationPath,'utf8');
    const checksum=createHash('sha256').update(sql).digest('hex');
    await client.query('BEGIN');
    try {
      const existing=await client.query<{checksum:string}>('SELECT checksum FROM system.schema_migrations WHERE version=$1 FOR UPDATE',[version]);
      if(existing.rowCount) {
        if(existing.rows[0].checksum!==checksum) throw new Error(`Migration ${version} checksum differs from the applied checksum. Applied migrations are immutable.`);
        await client.query('COMMIT'); process.stdout.write(`Migration ${version} already applied; checksum matches.\n`);
      } else {
        await client.query(sql);
        await client.query('INSERT INTO system.schema_migrations(version,checksum) VALUES($1,$2)',[version,checksum]);
        await client.query('COMMIT'); process.stdout.write(`Applied ${version} (${checksum.slice(0,12)}).\n`);
      }
    } catch(error) { await client.query('ROLLBACK'); throw error; }
  }
} finally { client.release(); await pool.end(); }
