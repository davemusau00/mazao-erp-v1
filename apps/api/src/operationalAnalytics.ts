import { inReadSnapshot } from './db.js';
import type { ApiSession } from './contracts.js';
import { DomainError } from './contracts.js';
import { reportRange, requireOperationalAnalytics } from './operationalAnalyticsPolicy.js';

/** All totals use complete persisted sources. Lists below are labelled previews only. */
export async function getOperationalAnalytics(session:ApiSession,fromValue:unknown,toValue:unknown){
  requireOperationalAnalytics(session);
  const {from,to}=reportRange(fromValue,toValue);
  try{new Intl.DateTimeFormat('en',{timeZone:session.timeZone});}
  catch{throw new DomainError('INVALID_OUTLET_TIME_ZONE','The outlet business time zone needs review.',500);}
  return inReadSnapshot(async client=>{
    const result=await client.query(`WITH scoped_orders AS (
      SELECT o.id,o.total_minor,o.subtotal_minor,o.tax_minor,o.customer_amount_due_minor,o.created_at
      FROM commerce.orders o WHERE o.tenant_id=$1 AND o.outlet_id=$2
        AND o.created_at>=($3::date::timestamp AT TIME ZONE $5)
        AND o.created_at<(($4::date+1)::timestamp AT TIME ZONE $5)
    ), scoped_refunds AS (
      SELECT r.id,r.order_id,r.total_minor,r.subtotal_minor,r.tax_minor,r.created_at
      FROM commerce.refunds r WHERE r.tenant_id=$1 AND r.outlet_id=$2
        AND r.created_at>=($3::date::timestamp AT TIME ZONE $5)
        AND r.created_at<(($4::date+1)::timestamp AT TIME ZONE $5)
    ), scoped_payments AS (
      SELECT p.method,p.amount_minor FROM commerce.payments p
      WHERE p.tenant_id=$1 AND p.outlet_id=$2 AND p.status='CONFIRMED'
        AND p.created_at>=($3::date::timestamp AT TIME ZONE $5)
        AND p.created_at<(($4::date+1)::timestamp AT TIME ZONE $5)
    ), collections AS (
      SELECT amount_minor FROM finance.customer_repayments WHERE tenant_id=$1 AND outlet_id=$2
        AND created_at>=($3::date::timestamp AT TIME ZONE $5)
        AND created_at<(($4::date+1)::timestamp AT TIME ZONE $5)
    ), room_payments AS (
      SELECT amount_minor FROM hospitality.folio_entries WHERE tenant_id=$1 AND outlet_id=$2 AND entry_type='CASH_PAYMENT'
        AND created_at>=($3::date::timestamp AT TIME ZONE $5)
        AND created_at<(($4::date+1)::timestamp AT TIME ZONE $5)
    ), cash_movements AS (
      SELECT movement_type,amount_minor FROM commerce.shift_cash_movements WHERE tenant_id=$1 AND outlet_id=$2
        AND created_at>=($3::date::timestamp AT TIME ZONE $5)
        AND created_at<(($4::date+1)::timestamp AT TIME ZONE $5)
    ), daily_sales AS (
      SELECT (created_at AT TIME ZONE $5)::date business_date,sum(total_minor)::text gross_minor,count(*)::text order_count
      FROM scoped_orders GROUP BY 1
    ), daily_refunds AS (
      SELECT (created_at AT TIME ZONE $5)::date business_date,sum(total_minor)::text refund_minor,count(*)::text refund_count
      FROM scoped_refunds GROUP BY 1
    ), product_sales AS (
      SELECT l.product_id,(array_agg(l.sku_snapshot ORDER BY o.created_at DESC,o.id DESC))[1] sku,
        (array_agg(l.name_snapshot ORDER BY o.created_at DESC,o.id DESC))[1] name,
        sum(l.quantity)::text quantity,sum(l.line_subtotal_minor)::text revenue_minor,
        count(DISTINCT o.id)::text order_count
      FROM scoped_orders o JOIN commerce.order_lines l ON l.tenant_id=$1 AND l.outlet_id=$2 AND l.order_id=o.id
      GROUP BY l.product_id
    ) SELECT
      coalesce((SELECT sum(total_minor)::text FROM scoped_orders),'0') gross_sales_minor,
      coalesce((SELECT sum(subtotal_minor)::text FROM scoped_orders),'0') subtotal_minor,
      coalesce((SELECT sum(tax_minor)::text FROM scoped_orders),'0') tax_minor,
      coalesce((SELECT sum(customer_amount_due_minor)::text FROM scoped_orders),'0') account_credit_minor,
      coalesce((SELECT sum(l.discount_minor)::text FROM commerce.order_lines l JOIN scoped_orders o ON o.id=l.order_id WHERE l.tenant_id=$1 AND l.outlet_id=$2),'0') discount_minor,
      coalesce((SELECT sum(total_minor)::text FROM scoped_refunds),'0') refunds_minor,
      coalesce((SELECT sum(subtotal_minor)::text FROM scoped_refunds),'0') refund_subtotal_minor,
      coalesce((SELECT sum(tax_minor)::text FROM scoped_refunds),'0') refund_tax_minor,
      coalesce((SELECT sum(amount_minor)::text FROM scoped_payments WHERE method='CASH'),'0') cash_minor,
      coalesce((SELECT sum(amount_minor)::text FROM scoped_payments WHERE method='MANUAL_MPESA'),'0') mpesa_minor,
      coalesce((SELECT sum(amount_minor)::text FROM collections),'0') customer_collections_minor,
      coalesce((SELECT sum(amount_minor)::text FROM room_payments),'0') room_cash_minor,
      coalesce((SELECT sum(amount_minor)::text FROM cash_movements WHERE movement_type='PAID_IN'),'0') cash_paid_in_minor,
      coalesce((SELECT sum(amount_minor)::text FROM cash_movements WHERE movement_type='PAYOUT'),'0') cash_payout_minor,
      (SELECT count(*)::text FROM scoped_orders) order_count,(SELECT count(*)::text FROM scoped_refunds) refund_count,
      (SELECT count(*)::text FROM scoped_payments WHERE method='CASH') cash_payment_count,
      (SELECT count(*)::text FROM scoped_payments WHERE method='MANUAL_MPESA') mpesa_payment_count,
      (SELECT count(*)::text FROM collections) collection_count,(SELECT count(*)::text FROM room_payments) room_payment_count,
      (SELECT count(*)::text FROM product_sales) product_count,
      (SELECT count(*)::text FROM finance.customer_charges c JOIN scoped_orders o ON o.id=c.order_id WHERE c.tenant_id=$1 AND c.outlet_id=$2) account_charge_count,
      coalesce((SELECT jsonb_agg(jsonb_build_object('date',days.day::date::text,'grossMinor',coalesce(s.gross_minor,'0'),'orderCount',coalesce(s.order_count,'0'),'refundMinor',coalesce(r.refund_minor,'0'),'refundCount',coalesce(r.refund_count,'0')) ORDER BY days.day)
        FROM generate_series($3::date,$4::date,interval '1 day') AS days(day)
        LEFT JOIN daily_sales s ON s.business_date=days.day::date LEFT JOIN daily_refunds r ON r.business_date=days.day::date),'[]'::jsonb) daily,
      coalesce((SELECT jsonb_agg(jsonb_build_object('productId',product_id,'sku',sku,'name',name,'quantity',quantity,'revenueMinor',revenue_minor,'orderCount',order_count) ORDER BY revenue_minor::numeric DESC,product_id)
        FROM (SELECT * FROM product_sales ORDER BY revenue_minor::numeric DESC,product_id LIMIT 10) top_products),'[]'::jsonb) top_products,
      statement_timestamp() generated_at`,[session.tenantId,session.outletId,from,to,session.timeZone]);
    const r=result.rows[0];
    const cash=BigInt(r.cash_minor),room=BigInt(r.room_cash_minor),collections=BigInt(r.customer_collections_minor);
    return {
      reportType:'OUTLET_OPERATIONAL_ANALYTICS',scope:'OUTLET',tenantId:session.tenantId,outletId:session.outletId,outletName:session.outletName,
      currency:session.currency,timeZone:session.timeZone,from,to,generatedAt:r.generated_at,
      totals:{grossSalesMinor:r.gross_sales_minor,subtotalMinor:r.subtotal_minor,taxMinor:r.tax_minor,refundsMinor:r.refunds_minor,
        cashCollectedMinor:r.cash_minor,accountCreditMinor:r.account_credit_minor,discountMinor:r.discount_minor,
        originalSubtotalMinor:(BigInt(r.subtotal_minor)+BigInt(r.discount_minor)).toString(),
        refundSubtotalMinor:r.refund_subtotal_minor,refundTaxMinor:r.refund_tax_minor,
        netRevenueMinor:(BigInt(r.subtotal_minor)-BigInt(r.refund_subtotal_minor)).toString(),
        netTaxMinor:(BigInt(r.tax_minor)-BigInt(r.refund_tax_minor)).toString(),
        netInvoiceMinor:(BigInt(r.gross_sales_minor)-BigInt(r.refunds_minor)).toString(),
        manualMpesaMinor:r.mpesa_minor,customerCollectionsMinor:r.customer_collections_minor,roomCashCollectionsMinor:r.room_cash_minor,
        totalCashCollectionsMinor:(cash+room+collections).toString(),cashRefundsMinor:r.refunds_minor,cashPaidInMinor:r.cash_paid_in_minor,cashPayoutMinor:r.cash_payout_minor,
        netDrawerMovementMinor:(cash+room+collections+BigInt(r.cash_paid_in_minor)-BigInt(r.refunds_minor)-BigInt(r.cash_payout_minor)).toString()},
      daily:r.daily??[],topProducts:r.top_products??[],
      coverage:{status:'CONFIRMED_SALES_AND_COLLECTIONS',orderCount:r.order_count,refundCount:r.refund_count,cashPaymentCount:r.cash_payment_count,
        manualMpesaPaymentCount:r.mpesa_payment_count,accountChargeCount:r.account_charge_count,customerCollectionCount:r.collection_count,
        roomCashPaymentCount:r.room_payment_count,productCount:r.product_count,topProductsComplete:BigInt(r.product_count)<=10n,
        scope:'This outlet only. Item sales and returns use their own business dates. Collections use their receipt dates, including collections for older sales. Room cash is shown separately from item sales. Product ranking is after item discounts and before returns.',
        drawerMovementExplanation:'Cash sale receipts + customer collections + room cash + paid-ins − cash refunds − payouts. Opening floats and cash-up differences are excluded. This is movement during the selected dates, not a closing drawer balance.',
        excludedMethods:['card','automatic provider verification'],excludedSources:['unposted sales','external settlement statements','room revenue from item sales totals']},
    };
  });
}
