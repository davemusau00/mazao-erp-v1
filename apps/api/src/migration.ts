import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const versions=['001_initial','002_receipt_document_reference','003_cash_refunds','004_hospitality','005_shift_cash_movements','006_inventory_counts','007_weighted_average_inventory_cost','008_reconcile_inventory_value_from_movements','009_reconcile_restocked_refund_values','010_composite_tenant_foreign_keys','011_receipt_identity_snapshots'];
const migrationTarget=process.env.MIGRATION_TARGET;
if(migrationTarget&&!versions.includes(migrationTarget))throw new Error(`MIGRATION_TARGET must be a known migration version; received ${migrationTarget}.`);
const client=await pool.connect();

/**
 * Preserve the published SQL file checksums while normalizing two known defects
 * before their not-yet-applied migrations run. Already-applied migrations skip
 * this preparation entirely and remain checksum-verified by the runner.
 */
async function prepareKnownMigrationCompatibility(version:string){
  if(version==='003_cash_refunds'){
    const result=await client.query<{conname:string;definition:string}>(`SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='commerce.orders'::regclass AND contype='c'`);
    const generated=result.rows.find(row=>row.conname==='orders_status_check'&&row.definition.includes('CONFIRMED')&&row.definition.includes('REFUNDED'));
    const expected=result.rows.some(row=>row.conname==='commerce_orders_status_check');
    if(generated){
      if(expected)await client.query('ALTER TABLE commerce.orders DROP CONSTRAINT orders_status_check');
      else await client.query('ALTER TABLE commerce.orders RENAME CONSTRAINT orders_status_check TO commerce_orders_status_check');
    }else if(!expected){
      await client.query("ALTER TABLE commerce.orders ADD CONSTRAINT commerce_orders_status_check CHECK(status IN ('CONFIRMED','REFUNDED'))");
    }
  }
  if(version==='004_hospitality')await client.query('CREATE SCHEMA IF NOT EXISTS hospitality');
}

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
        await prepareKnownMigrationCompatibility(version);
        await client.query(sql);
        await client.query('INSERT INTO system.schema_migrations(version,checksum) VALUES($1,$2)',[version,checksum]);
        await client.query('COMMIT'); process.stdout.write(`Applied ${version} (${checksum.slice(0,12)}).\n`);
      }
    } catch(error) { await client.query('ROLLBACK'); throw error; }
    if(version===migrationTarget)break;
  }
} finally { client.release(); await pool.end(); }
