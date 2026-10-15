import { pool } from './db.js';
import type { ApiSession } from './contracts.js';
import { DomainError } from './contracts.js';
import { reportRange, requireOperationalAnalytics } from './operationalAnalyticsPolicy.js';

export async function getOperationalAnalytics(session: ApiSession, fromValue: unknown, toValue: unknown) {
  requireOperationalAnalytics(session);
  const { from, to } = reportRange(fromValue, toValue);
  try { new Intl.DateTimeFormat('en', { timeZone: session.timeZone }); }
  catch { throw new DomainError('INVALID_OUTLET_TIME_ZONE', 'The outlet time zone is invalid; analytics cannot calculate business dates.', 500); }

  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await client.query(`WITH scoped_orders AS (
        SELECT o.id,o.total_minor,o.subtotal_minor,o.tax_minor,o.customer_amount_due_minor,o.created_at
        FROM commerce.orders o
        WHERE o.tenant_id=$1 AND o.outlet_id=$2
          AND o.created_at >= ($3::date::timestamp AT TIME ZONE $5)
          AND o.created_at < (($4::date + 1)::timestamp AT TIME ZONE $5)
      ), scoped_refunds AS (
        SELECT r.id,r.order_id,r.total_minor,r.created_at
        FROM commerce.refunds r
        WHERE r.tenant_id=$1 AND r.outlet_id=$2
          AND r.created_at >= ($3::date::timestamp AT TIME ZONE $5)
          AND r.created_at < (($4::date + 1)::timestamp AT TIME ZONE $5)
      ), tender_totals AS (
        SELECT coalesce(sum(p.amount_minor),0)::text cash_minor,count(p.id)::text cash_payment_count
        FROM commerce.payments p JOIN scoped_orders o ON o.id=p.order_id
        WHERE p.tenant_id=$1 AND p.outlet_id=$2 AND p.method='CASH' AND p.status='CONFIRMED'
      ), daily_sales AS (
        SELECT (created_at AT TIME ZONE $5)::date business_date,sum(total_minor)::text gross_minor,count(*)::text order_count
        FROM scoped_orders GROUP BY 1
      ), daily_refunds AS (
        SELECT (created_at AT TIME ZONE $5)::date business_date,sum(total_minor)::text refund_minor,count(*)::text refund_count
        FROM scoped_refunds GROUP BY 1
      ), product_sales AS (
        SELECT l.product_id,l.sku_snapshot,l.name_snapshot,
          sum(l.quantity)::text quantity,
          sum(l.line_subtotal_minor)::text revenue_minor,
          count(DISTINCT o.id)::text order_count
        FROM scoped_orders o
        JOIN commerce.order_lines l ON l.tenant_id=$1 AND l.outlet_id=$2 AND l.order_id=o.id
        GROUP BY l.product_id,l.sku_snapshot,l.name_snapshot
      ), coverage AS (
        SELECT (SELECT count(*)::text FROM scoped_orders) order_count,
          (SELECT count(*)::text FROM scoped_refunds) refund_count,
          (SELECT count(*)::text FROM commerce.customer_charges c JOIN scoped_orders o ON o.id=c.order_id WHERE c.tenant_id=$1 AND c.outlet_id=$2) account_charge_count
      )
      SELECT
        coalesce((SELECT sum(total_minor)::text FROM scoped_orders),'0') gross_sales_minor,
        coalesce((SELECT sum(subtotal_minor)::text FROM scoped_orders),'0') subtotal_minor,
        coalesce((SELECT sum(tax_minor)::text FROM scoped_orders),'0') tax_minor,
        coalesce((SELECT sum(customer_amount_due_minor)::text FROM scoped_orders),'0') account_credit_minor,
        coalesce((SELECT sum(total_minor)::text FROM scoped_refunds),'0') refunds_minor,
        (SELECT cash_minor FROM tender_totals) cash_collected_minor,
        (SELECT cash_payment_count FROM tender_totals) cash_payment_count,
        (SELECT order_count FROM coverage) order_count,
        (SELECT refund_count FROM coverage) refund_count,
        (SELECT account_charge_count FROM coverage) account_charge_count,
        coalesce((SELECT jsonb_agg(jsonb_build_object('date',days.day::date::text,'grossMinor',coalesce(s.gross_minor,'0'),'orderCount',coalesce(s.order_count,'0'),'refundMinor',coalesce(r.refund_minor,'0'),'refundCount',coalesce(r.refund_count,'0')) ORDER BY days.day) FROM generate_series($3::date,$4::date,interval '1 day') AS days(day) LEFT JOIN daily_sales s ON s.business_date=days.day::date LEFT JOIN daily_refunds r ON r.business_date=days.day::date),'[]'::jsonb) daily,
        coalesce((SELECT jsonb_agg(jsonb_build_object('productId',product_id,'sku',sku_snapshot,'name',name_snapshot,'quantity',quantity,'revenueMinor',revenue_minor,'orderCount',order_count) ORDER BY revenue_minor::numeric DESC,product_id) FROM (SELECT * FROM product_sales WHERE revenue_minor::numeric > 0 ORDER BY revenue_minor::numeric DESC,product_id LIMIT 10) top_products),'[]'::jsonb) top_products,
        statement_timestamp() generated_at`, [session.tenantId, session.outletId, from, to, session.timeZone]);
    const row = result.rows[0];
    await client.query('COMMIT');
    return {
      reportType:'OUTLET_OPERATIONAL_ANALYTICS', scope:'OUTLET', tenantId:session.tenantId, outletId:session.outletId,
      currency:session.currency, timeZone:session.timeZone, from, to, generatedAt:row.generated_at,
      totals:{grossSalesMinor:row.gross_sales_minor,subtotalMinor:row.subtotal_minor,taxMinor:row.tax_minor,refundsMinor:row.refunds_minor,cashCollectedMinor:row.cash_collected_minor,accountCreditMinor:row.account_credit_minor},
      daily:row.daily ?? [], topProducts:row.top_products ?? [],
      coverage:{status:'CONFIRMED_CASH_AND_ACCOUNT_CREDIT',orderCount:row.order_count,refundCount:row.refund_count,cashPaymentCount:row.cash_payment_count,accountChargeCount:row.account_charge_count,scope:'This outlet only. Sales are confirmed server orders; collections include confirmed cash payments, and credit sales are customer account charges. Product totals are before refunds; refunds are shown separately.',excludedMethods:['card','mobile money','provider settlements'],excludedSources:['unposted orders','external payment provider confirmations']},
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* release failed read transaction */ }
    throw error;
  } finally { client.release(); }
}
