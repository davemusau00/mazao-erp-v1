import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const sourceDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!sourceDatabaseUrl) {
  test('historical weighted-average valuation migrations preserve old stock evidence', { skip: 'Set TEST_DATABASE_URL to an isolated PostgreSQL database with permission to create a temporary database.' }, () => {});
} else {
  test('migrations 007-009 reconcile legacy receipt, sale, refund, and open-count values', async () => {
    const scratchDatabase = `mazao_valuation_upgrade_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: sourceDatabaseUrl });
    let scratchCreated = false;
    const scratchUrl = new URL(sourceDatabaseUrl);
    scratchUrl.pathname = `/${scratchDatabase}`;

    try {
      await admin.query(`CREATE DATABASE "${scratchDatabase}"`);
      scratchCreated = true;

      const migrationScript = fileURLToPath(new URL('../src/migration.ts', import.meta.url));
      const migrateThrough = (version: string) => {
        const child = spawnSync(process.execPath, ['--import', 'tsx', migrationScript], {
          cwd: process.cwd(),
          encoding: 'utf8',
          env: { ...process.env, DATABASE_URL: scratchUrl.href, MIGRATION_TARGET: version },
        });
        assert.ifError(child.error);
        assert.equal(child.status, 0, `migration through ${version} failed:\n${child.stdout}\n${child.stderr}`);
      };

      migrateThrough('006_inventory_counts');

      const db = new Pool({ connectionString: scratchUrl.href });
      const tenantId = randomUUID();
      const outletId = randomUUID();
      const userId = randomUUID();
      const deviceId = randomUUID();
      const shiftId = randomUUID();
      const productId = randomUUID();
      const orderId = randomUUID();
      const orderLineId = randomUUID();
      const refundId = randomUUID();
      const refundLineId = randomUUID();
      const countId = randomUUID();
      const receiptCommandId = randomUUID();
      const saleCommandId = randomUUID();
      const refundCommandId = randomUUID();
      const receiptMovementId = randomUUID();
      const saleMovementId = randomUUID();
      const refundMovementId = randomUUID();

      try {
        await db.query('INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,$2,$3,$4)', [tenantId, 'Historical migration tenant', 'KES', 'Africa/Nairobi']);
        await db.query('INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,$3,$4)', [outletId, tenantId, 'Historical outlet', 'Africa/Nairobi']);
        await db.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)', [userId, `${userId}@example.invalid`, 'fixture-hash', 'Migration Fixture']);
        await db.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')", [tenantId, userId]);
        await db.query('INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,$5)', [deviceId, tenantId, outletId, userId, 'Historical fixture device']);
        await db.query(`INSERT INTO commerce.shifts(id,tenant_id,outlet_id,operator_id,status,opening_float_minor,expected_cash_minor)
          VALUES($1,$2,$3,$4,'CLOSED',0,0)`, [shiftId, tenantId, outletId, userId]);
        await db.query(`INSERT INTO catalog.products(id,tenant_id,outlet_id,sku,name,base_unit,currency,selling_price_minor,cost_price_minor,tax_rate_bps)
          VALUES($1,$2,$3,'HIST-ROUND','Historical rounding item','each','KES',250,100,0)`, [productId, tenantId, outletId]);
        await db.query('INSERT INTO inventory.balances(tenant_id,outlet_id,product_id,quantity,version) VALUES($1,$2,$3,1.333333,3)', [tenantId, outletId, productId]);

        await db.query(`INSERT INTO commerce.orders(id,tenant_id,outlet_id,shift_id,operator_id,currency,subtotal_minor,tax_minor,total_minor,status)
          VALUES($1,$2,$3,$4,$5,'KES',500,0,500,'CONFIRMED')`, [orderId, tenantId, outletId, shiftId, userId]);
        await db.query(`INSERT INTO commerce.order_lines(id,tenant_id,outlet_id,order_id,product_id,sku_snapshot,name_snapshot,quantity,unit_price_minor,cost_price_minor,tax_rate_bps,line_subtotal_minor,line_tax_minor)
          VALUES($1,$2,$3,$4,$5,'HIST-ROUND','Historical rounding item',2,250,101,0,500,0)`, [orderLineId, tenantId, outletId, orderId, productId]);
        await db.query(`INSERT INTO commerce.payments(id,tenant_id,outlet_id,order_id,method,amount_minor,currency,status)
          VALUES($1,$2,$3,$4,'CASH',500,'KES','CONFIRMED')`, [randomUUID(), tenantId, outletId, orderId]);
        await db.query(`INSERT INTO inventory.movements(id,tenant_id,outlet_id,product_id,command_id,movement_type,quantity_delta,unit_cost_minor,reference_id)
          VALUES($1,$2,$3,$4,$5,'RECEIPT',3,101,NULL),($6,$2,$3,$4,$7,'SALE',-2,101,$8),($9,$2,$3,$4,$10,'REFUND',0.333333,101,$8)`,
        [receiptMovementId, tenantId, outletId, productId, receiptCommandId, saleMovementId, saleCommandId, orderId, refundMovementId, refundCommandId]);

        await db.query(`INSERT INTO commerce.refunds(id,tenant_id,outlet_id,order_id,shift_id,command_id,actor_id,currency,reason,subtotal_minor,tax_minor,total_minor)
          VALUES($1,$2,$3,$4,$5,$6,$7,'KES','Historical partial return',83,0,83)`, [refundId, tenantId, outletId, orderId, shiftId, refundCommandId, userId]);
        await db.query(`INSERT INTO commerce.refund_lines(id,tenant_id,outlet_id,refund_id,order_id,order_line_id,product_id,quantity,subtotal_minor,tax_minor,cogs_minor,restocked)
          VALUES($1,$2,$3,$4,$5,$6,$7,0.333333,83,0,33,true)`, [refundLineId, tenantId, outletId, refundId, orderId, orderLineId, productId]);
        await db.query(`INSERT INTO inventory.stock_counts(id,tenant_id,outlet_id,status,opened_by)
          VALUES($1,$2,$3,'OPEN',$4)`, [countId, tenantId, outletId, userId]);
        await db.query(`INSERT INTO inventory.stock_count_lines(tenant_id,outlet_id,count_id,product_id,sku_snapshot,name_snapshot,base_unit_snapshot,baseline_quantity,baseline_balance_version,baseline_unit_cost_minor)
          VALUES($1,$2,$3,$4,'HIST-ROUND','Historical rounding item','each',1.333333,3,100)`, [tenantId, outletId, countId, productId]);

        migrateThrough('007_weighted_average_inventory_cost');
        const after007 = await db.query<{ inventory_value_minor: string; cogs_minor: string; baseline_inventory_value_minor: string }>(`SELECT b.inventory_value_minor::text,
            ol.cogs_minor::text,
            scl.baseline_inventory_value_minor::text
          FROM inventory.balances b JOIN commerce.order_lines ol ON ol.product_id=b.product_id
          JOIN inventory.stock_count_lines scl ON scl.product_id=b.product_id
          WHERE b.tenant_id=$1 AND b.product_id=$2`, [tenantId, productId]);
        assert.equal(after007.rows[0].inventory_value_minor, '133', 'migration 007 should seed the legacy balance from the current product-cost fallback before history reconciliation');
        assert.equal(after007.rows[0].cogs_minor, '202', 'historical sale COGS should be backfilled from its cost snapshot');
        assert.equal(after007.rows[0].baseline_inventory_value_minor, '133', 'a matching open count baseline should receive the initial migrated carrying value');
        const movementValues007 = await db.query<{ movement_type: string; value_minor: string }>(`SELECT movement_type,value_minor::text FROM inventory.movements WHERE tenant_id=$1 ORDER BY movement_type`, [tenantId]);
        assert.deepEqual(movementValues007.rows, [
          { movement_type: 'RECEIPT', value_minor: '303' },
          { movement_type: 'REFUND', value_minor: '34' },
          { movement_type: 'SALE', value_minor: '202' },
        ]);

        migrateThrough('008_reconcile_inventory_value_from_movements');
        const after008 = await db.query<{ inventory_value_minor: string }>('SELECT inventory_value_minor::text FROM inventory.balances WHERE tenant_id=$1 AND product_id=$2', [tenantId, productId]);
        assert.equal(after008.rows[0].inventory_value_minor, '135', 'migration 008 should prefer consistent signed movement values over the current product-cost fallback');

        migrateThrough('009_reconcile_restocked_refund_values');
        const finalValue = await db.query<{ inventory_value_minor: string; count_baseline_value_minor: string }>(`SELECT b.inventory_value_minor::text,
            scl.baseline_inventory_value_minor::text count_baseline_value_minor
          FROM inventory.balances b JOIN inventory.stock_count_lines scl ON scl.product_id=b.product_id
          WHERE b.tenant_id=$1 AND b.product_id=$2`, [tenantId, productId]);
        assert.equal(finalValue.rows[0].inventory_value_minor, '134', 'migration 009 should replace rounded refund unit cost with exact refund-line COGS');
        assert.equal(finalValue.rows[0].count_baseline_value_minor, '134', 'the matching open count baseline should follow corrected carrying value');
        const correctedRefund = await db.query<{ value_minor: string }>(`SELECT value_minor::text FROM inventory.movements
          WHERE tenant_id=$1 AND movement_type='REFUND' AND command_id=$2`, [tenantId, refundCommandId]);
        assert.equal(correctedRefund.rows[0].value_minor, '33');

        migrateThrough('010_composite_tenant_foreign_keys');
        migrateThrough('011_receipt_identity_snapshots');
        const legacyReceipt = await db.query<{ receipt_number: string; tenant_name_snapshot: string; outlet_name_snapshot: string; outlet_time_zone_snapshot: string; cash_tendered_minor: string | null; change_minor: string | null }>(`SELECT receipt_number,tenant_name_snapshot,outlet_name_snapshot,outlet_time_zone_snapshot,
            cash_tendered_minor::text,change_minor::text FROM commerce.orders WHERE tenant_id=$1 AND id=$2`, [tenantId, orderId]);
        assert.deepEqual(legacyReceipt.rows[0], {
          receipt_number: `MZ-${orderId.replaceAll('-', '').toUpperCase()}`,
          tenant_name_snapshot: 'Historical migration tenant',
          outlet_name_snapshot: 'Historical outlet',
          outlet_time_zone_snapshot: 'Africa/Nairobi',
          cash_tendered_minor: null,
          change_minor: null,
        }, 'legacy receipt migration should backfill server identity but leave unrecoverable cash handover evidence unknown');
      } finally {
        await db.end();
      }
    } finally {
      if (scratchCreated) await admin.query(`DROP DATABASE "${scratchDatabase}" WITH (FORCE)`);
      await admin.end();
    }
  });
}
