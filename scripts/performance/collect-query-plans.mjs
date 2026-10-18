import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import pg from 'pg';

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;
const outputPath = process.env.MAZAO_QUERY_PLAN_OUTPUT ?? 'docs/performance/evidence/query-plans-2026-10-18.json';
if (!databaseUrl) throw new Error('Set DATABASE_URL to the disposable local mazao_perf_* database.');
const parsedUrl = new URL(databaseUrl);
if (!['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname) || !/^\/mazao_perf_/.test(parsedUrl.pathname)) {
  throw new Error('Query plans may only be collected from a localhost mazao_perf_* database.');
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  const fixture = await client.query(`SELECT t.id tenant_id,o.id outlet_id,u.id operator_id,
      (SELECT id FROM inventory.stock_counts WHERE tenant_id=t.id AND outlet_id=o.id AND status='OPEN' ORDER BY opened_at DESC LIMIT 1) count_id,
      (SELECT id FROM commerce.orders WHERE tenant_id=t.id AND outlet_id=o.id ORDER BY created_at LIMIT 1) oldest_order_id,
      (SELECT id FROM finance.customer_accounts WHERE tenant_id=t.id ORDER BY display_name LIMIT 1) customer_id
    FROM core.tenants t JOIN core.outlets o ON o.tenant_id=t.id
    JOIN identity.users u ON u.email='performance-operator@mazao-perf.invalid' LIMIT 1`);
  if (!fixture.rowCount) throw new Error('The production-shaped performance fixture is missing.');
  const { tenant_id: tenantId, outlet_id: outletId, operator_id: operatorId, count_id: countId, oldest_order_id: orderId, customer_id: customerId } = fixture.rows[0];
  const rangeFrom = '2026-01-01';
  const rangeTo = '2026-10-17';
  const timeZone = 'Africa/Nairobi';
  const queries = [
    ['configuration-metadata', `SELECT t.id tenant_id,t.name tenant_name,t.currency,t.time_zone tenant_time_zone,t.version tenant_version,
        t.business_profile-'logoUrl'-'receiptQrImage' business_profile,
        CASE WHEN t.business_profile->>'logoUrl' LIKE 'data:image/png;base64,%' THEN NULL ELSE t.business_profile->>'logoUrl' END business_logo_url,
        logo.id logo_asset_id,receipt_qr.id receipt_qr_asset_id,
        o.id outlet_id,o.name outlet_name,o.time_zone outlet_time_zone,o.version outlet_version,o.outlet_profile
      FROM core.tenants t JOIN core.outlets o ON o.tenant_id=t.id
      LEFT JOIN LATERAL (SELECT id FROM core.configuration_assets WHERE tenant_id=t.id AND kind='logo' AND status='ACTIVE' LIMIT 1) logo ON true
      LEFT JOIN LATERAL (SELECT id FROM core.configuration_assets WHERE tenant_id=t.id AND kind='receipt_qr' AND status='ACTIVE' LIMIT 1) receipt_qr ON true
      WHERE t.id=$1 AND o.id=$2`, [tenantId, outletId]],
    ['configuration-readiness-counts', `SELECT
        (SELECT count(*)::int FROM catalog.products WHERE tenant_id=$1 AND outlet_id=$2 AND active) products,
        (SELECT count(*)::int FROM inventory.balances WHERE tenant_id=$1 AND outlet_id=$2 AND quantity>0) stocked,
        (SELECT count(*)::int FROM identity.memberships m JOIN identity.users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.active AND u.active) staff,
        (SELECT count(*)::int FROM identity.devices WHERE tenant_id=$1 AND outlet_id=$2 AND active) devices`, [tenantId, outletId]],
    ['catalog-items', `SELECT p.id,p.sku,p.name,p.base_unit,p.currency,p.selling_price_minor,p.category,p.barcode,p.reorder_level::text,p.version product_version,
        CASE WHEN $3::boolean THEN p.cost_price_minor END cost_price_minor,CASE WHEN $3::boolean THEN b.inventory_value_minor::text END inventory_value_minor,p.tax_rate_bps,b.quantity,b.version
      FROM catalog.products p JOIN inventory.balances b ON b.tenant_id=p.tenant_id AND b.outlet_id=p.outlet_id AND b.product_id=p.id
      WHERE p.tenant_id=$1 AND p.outlet_id=$2 AND p.active ORDER BY p.name`, [tenantId, outletId, true]],
    ['inventory-movements-window', `SELECT m.id,m.created_at,m.movement_type,m.quantity_delta,m.document_reference,m.value_minor,p.sku,p.name,
        SUM(m.quantity_delta) OVER(PARTITION BY m.product_id ORDER BY m.created_at,m.id ROWS UNBOUNDED PRECEDING) balance_after
      FROM inventory.movements m JOIN catalog.products p ON p.id=m.product_id AND p.tenant_id=m.tenant_id AND p.outlet_id=m.outlet_id
      WHERE m.tenant_id=$1 AND m.outlet_id=$2 ORDER BY m.created_at DESC,m.id DESC LIMIT 250`, [tenantId, outletId]],
    ['stock-count-current-selection', `SELECT id FROM inventory.stock_counts WHERE tenant_id=$1 AND outlet_id=$2 AND status='OPEN' ORDER BY opened_at DESC LIMIT 1`, [tenantId, outletId]],
    ['stock-count-lines', `SELECT product_id,sku_snapshot,name_snapshot,base_unit_snapshot,baseline_quantity::text baseline_quantity,
        baseline_balance_version::text baseline_balance_version,counted_quantity::text counted_quantity,variance_reason,counted_by,counted_at
      FROM inventory.stock_count_lines WHERE tenant_id=$1 AND outlet_id=$2 AND count_id=$3 ORDER BY sku_snapshot,product_id`, [tenantId, outletId, countId]],
    ['sales-history', `SELECT o.id,o.created_at,o.operator_id,o.operator_name_snapshot cashier_name,o.currency,o.subtotal_minor,o.tax_minor,o.total_minor,o.status,o.customer_account_id,o.customer_name_snapshot,o.customer_amount_due_minor,
        COALESCE((SELECT SUM(p.amount_minor) FROM commerce.payments p WHERE p.tenant_id=o.tenant_id AND p.outlet_id=o.outlet_id AND p.order_id=o.id),0)::text paid_minor,
        COALESCE((SELECT SUM(r.total_minor) FROM commerce.refunds r WHERE r.tenant_id=o.tenant_id AND r.outlet_id=o.outlet_id AND r.order_id=o.id),0)::text refunded_minor,
        COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('lineId',ol.id,'productId',ol.product_id,'sku',ol.sku_snapshot,'name',ol.name_snapshot,'quantity',ol.quantity::text,'unitPriceMinor',ol.unit_price_minor::text,'costPriceMinor',CASE WHEN $3::boolean THEN ol.cost_price_minor::text END,'cogsMinor',CASE WHEN $3::boolean THEN ol.cogs_minor::text END,'taxRateBps',ol.tax_rate_bps,'subtotalMinor',ol.line_subtotal_minor::text,'taxMinor',ol.line_tax_minor::text,'refundedQuantity',COALESCE((SELECT SUM(rl.quantity) FROM commerce.refund_lines rl WHERE rl.tenant_id=ol.tenant_id AND rl.outlet_id=ol.outlet_id AND rl.order_line_id=ol.id),0)::text)) ORDER BY ol.id)
          FROM commerce.order_lines ol WHERE ol.tenant_id=o.tenant_id AND ol.outlet_id=o.outlet_id AND ol.order_id=o.id),'[]'::jsonb) lines
      FROM commerce.orders o WHERE o.tenant_id=$1 AND o.outlet_id=$2 ORDER BY o.created_at DESC LIMIT 250`, [tenantId, outletId, true]],
    ['historical-receipt-profile-read', `SELECT o.id,o.receipt_profile_snapshot-'logoUrl'-'receiptQrImage' receipt_profile_snapshot,
        o.receipt_profile_snapshot ? 'logoUrl' has_logo,o.receipt_profile_snapshot ? 'receiptQrImage' has_receipt_qr,
        COALESCE(o.receipt_profile_snapshot->>'logoUrl' LIKE 'data:image/png;base64,%',false) embedded_logo,
        COALESCE(o.receipt_profile_snapshot->>'receiptQrImage' LIKE 'data:image/png;base64,%',false) embedded_receipt_qr
      FROM commerce.orders o WHERE o.id=$1 AND o.tenant_id=$2 AND o.outlet_id=$3`, [orderId, tenantId, outletId]],
    ['customer-directory', `SELECT id,display_name,phone,email,credit_limit_minor::text,balance_minor::text,status,version,created_at,updated_at
      FROM finance.customer_accounts WHERE tenant_id=$1 ORDER BY lower(display_name),id LIMIT 500`, [tenantId]],
    ['customer-statement-activity', `SELECT event_id,event_type,created_at,amount_minor::text,reference,order_id,receipt_number,allocations
      FROM (
        SELECT c.id event_id,'CHARGE'::text event_type,c.created_at,c.amount_minor,NULL::text reference,o.id order_id,o.receipt_number,'[]'::jsonb allocations
        FROM finance.customer_charges c JOIN commerce.orders o ON o.id=c.order_id AND o.tenant_id=c.tenant_id AND o.outlet_id=c.outlet_id
        WHERE c.tenant_id=$1 AND c.customer_account_id=$2
        UNION ALL SELECT r.id event_id,'REPAYMENT'::text event_type,r.created_at,r.amount_minor,r.reference,NULL::uuid,NULL::text,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('amountMinor',a.amount_minor::text,'receiptNumber',o.receipt_number,'orderId',o.id) ORDER BY o.created_at,o.id)
            FROM finance.customer_repayment_allocations a JOIN finance.customer_charges c ON c.tenant_id=a.tenant_id AND c.id=a.charge_id
            JOIN commerce.orders o ON o.tenant_id=c.tenant_id AND o.outlet_id=c.outlet_id AND o.id=c.order_id
            WHERE a.tenant_id=r.tenant_id AND a.repayment_id=r.id),'[]'::jsonb) allocations
        FROM finance.customer_repayments r WHERE r.tenant_id=$1 AND r.customer_account_id=$2
      ) events ORDER BY created_at,event_id`, [tenantId, customerId]],
    ['shift-close-reports', `SELECT id,shift_id,command_id,operator_id,operator_name_snapshot,tenant_name_snapshot,outlet_name_snapshot,time_zone_snapshot,
        business_date::text business_date,currency,shift_version,opened_at,closed_at,opening_float_minor::text,cash_sales_minor::text,
        customer_collections_minor::text,cash_refunds_minor::text,cash_paid_in_minor::text,cash_payout_minor::text,expected_cash_minor::text,
        counted_cash_minor::text,variance_minor::text FROM commerce.shift_close_reports
      WHERE tenant_id=$1 AND outlet_id=$2 AND ($3::boolean OR operator_id=$4) ORDER BY closed_at DESC,id DESC LIMIT 50`, [tenantId, outletId, true, operatorId]],
    ['staff-directory', `SELECT m.user_id,m.display_name,m.role,m.active,m.version,u.email,u.credential_version,u.password_hash IS NOT NULL has_credential,
        (SELECT count(*)::int FROM identity.devices d WHERE d.tenant_id=m.tenant_id AND d.assigned_user_id=m.user_id AND d.active) assignment_count,
        (SELECT count(*)::int FROM identity.sessions s WHERE s.tenant_id=m.tenant_id AND s.user_id=m.user_id AND s.revoked_at IS NULL AND s.expires_at>now()) active_session_count
      FROM identity.memberships m JOIN identity.users u ON u.id=m.user_id WHERE m.tenant_id=$1 ORDER BY m.display_name,m.user_id LIMIT 500`, [tenantId]],
    ['workspace-assignments', `SELECT d.*,o.name outlet_name,m.display_name assigned_user_name FROM identity.devices d
        JOIN core.outlets o ON o.id=d.outlet_id AND o.tenant_id=d.tenant_id JOIN identity.memberships m ON m.tenant_id=d.tenant_id AND m.user_id=d.assigned_user_id
      WHERE d.tenant_id=$1 ORDER BY d.created_at DESC,d.id LIMIT 500`, [tenantId]],
    ['operational-analytics', `WITH scoped_orders AS (
        SELECT o.id,o.total_minor,o.subtotal_minor,o.tax_minor,o.customer_amount_due_minor,o.created_at FROM commerce.orders o
        WHERE o.tenant_id=$1 AND o.outlet_id=$2 AND o.created_at>=($3::date::timestamp AT TIME ZONE $5) AND o.created_at<(($4::date+1)::timestamp AT TIME ZONE $5)
      ), scoped_refunds AS (
        SELECT r.id,r.order_id,r.total_minor,r.created_at FROM commerce.refunds r
        WHERE r.tenant_id=$1 AND r.outlet_id=$2 AND r.created_at>=($3::date::timestamp AT TIME ZONE $5) AND r.created_at<(($4::date+1)::timestamp AT TIME ZONE $5)
      ), tender_totals AS (
        SELECT coalesce(sum(p.amount_minor),0)::text cash_minor,count(p.id)::text cash_payment_count FROM commerce.payments p JOIN scoped_orders o ON o.id=p.order_id
        WHERE p.tenant_id=$1 AND p.outlet_id=$2 AND p.method='CASH' AND p.status='CONFIRMED'
      ), daily_sales AS (
        SELECT (created_at AT TIME ZONE $5)::date business_date,sum(total_minor)::text gross_minor,count(*)::text order_count FROM scoped_orders GROUP BY 1
      ), daily_refunds AS (
        SELECT (created_at AT TIME ZONE $5)::date business_date,sum(total_minor)::text refund_minor,count(*)::text refund_count FROM scoped_refunds GROUP BY 1
      ), product_sales AS (
        SELECT l.product_id,l.sku_snapshot,l.name_snapshot,sum(l.quantity)::text quantity,sum(l.line_subtotal_minor)::text revenue_minor,count(DISTINCT o.id)::text order_count
        FROM scoped_orders o JOIN commerce.order_lines l ON l.tenant_id=$1 AND l.outlet_id=$2 AND l.order_id=o.id GROUP BY l.product_id,l.sku_snapshot,l.name_snapshot
      ), coverage AS (
        SELECT (SELECT count(*)::text FROM scoped_orders) order_count,(SELECT count(*)::text FROM scoped_refunds) refund_count,
          (SELECT count(*)::text FROM finance.customer_charges c JOIN scoped_orders o ON o.id=c.order_id WHERE c.tenant_id=$1 AND c.outlet_id=$2) account_charge_count
      )
      SELECT coalesce((SELECT sum(total_minor)::text FROM scoped_orders),'0') gross_sales_minor,
        coalesce((SELECT sum(subtotal_minor)::text FROM scoped_orders),'0') subtotal_minor,coalesce((SELECT sum(tax_minor)::text FROM scoped_orders),'0') tax_minor,
        coalesce((SELECT sum(customer_amount_due_minor)::text FROM scoped_orders),'0') account_credit_minor,coalesce((SELECT sum(total_minor)::text FROM scoped_refunds),'0') refunds_minor,
        (SELECT cash_minor FROM tender_totals) cash_collected_minor,(SELECT cash_payment_count FROM tender_totals) cash_payment_count,
        (SELECT order_count FROM coverage) order_count,(SELECT refund_count FROM coverage) refund_count,(SELECT account_charge_count FROM coverage) account_charge_count,
        coalesce((SELECT jsonb_agg(jsonb_build_object('date',days.day::date::text,'grossMinor',coalesce(s.gross_minor,'0'),'orderCount',coalesce(s.order_count,'0'),'refundMinor',coalesce(r.refund_minor,'0'),'refundCount',coalesce(r.refund_count,'0')) ORDER BY days.day)
          FROM generate_series($3::date,$4::date,interval '1 day') AS days(day) LEFT JOIN daily_sales s ON s.business_date=days.day::date LEFT JOIN daily_refunds r ON r.business_date=days.day::date),'[]'::jsonb) daily,
        coalesce((SELECT jsonb_agg(jsonb_build_object('productId',product_id,'sku',sku_snapshot,'name',name_snapshot,'quantity',quantity,'revenueMinor',revenue_minor,'orderCount',order_count) ORDER BY revenue_minor::numeric DESC,product_id)
          FROM (SELECT * FROM product_sales WHERE revenue_minor::numeric>0 ORDER BY revenue_minor::numeric DESC,product_id LIMIT 10) top_products),'[]'::jsonb) top_products`, [tenantId, outletId, rangeFrom, rangeTo, timeZone]],
  ];

  const results = [];
  for (const [name, sql, values] of queries) {
    const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, values);
    const explain = result.rows[0]['QUERY PLAN'][0];
    let serialized = JSON.stringify(explain);
    for (const value of [tenantId, outletId, operatorId, countId, orderId, customerId]) if (value) serialized = serialized.replaceAll(value, '<fixture-id>');
    results.push({ name, planningMs: explain['Planning Time'], executionMs: explain['Execution Time'], plan: JSON.parse(serialized) });
  }
  const output = {
    collectedAt: new Date().toISOString(),
    dataset: { products: 5000, orders: 5000, customers: 5000, staff: 500, movements: 40000, openCountLines: 5000, rooms: 300, reservations: 1200 },
    method: 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) against the seeded disposable PostgreSQL 16 database after ANALYZE. No data changes are performed.',
    plans: results,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(output, null, 2));
  process.stdout.write(JSON.stringify({ outputPath, plans: results.length, slowestMs: Math.max(...results.map(plan => plan.executionMs)) }) + '\n');
} finally {
  await client.end();
}
