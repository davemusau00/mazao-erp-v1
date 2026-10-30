import type { PoolClient } from 'pg';
import { pool } from './db.js';
import type { ApiSession } from './contracts.js';
import { DomainError, ROLE_PERMISSIONS } from './contracts.js';
import { decodePngDataUrl } from './configuration.js';

function quantityMicros(value: string) {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
}

function requireReceiptAccess(session: ApiSession) {
  if (!ROLE_PERMISSIONS[session.role].some(permission => ['commerce.sell', 'commerce.refund', 'finance.view'].includes(permission))) {
    throw new DomainError('FORBIDDEN', 'Your role cannot view sale receipts.', 403);
  }
}

async function inReadSnapshot<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* release the failed connection */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function getSaleReceipt(session: ApiSession, orderIdValue: unknown) {
  requireReceiptAccess(session);
  if (typeof orderIdValue !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderIdValue)) {
    throw new DomainError('VALIDATION_FAILED', 'orderId must be a valid order identifier.');
  }

  return inReadSnapshot(async client => {
    const orderResult = await client.query<{
      id: string; receipt_number: string; tenant_name_snapshot: string; outlet_name_snapshot: string;
      outlet_time_zone_snapshot: string; currency: string; created_at: Date; operator_name: string;
      subtotal_minor: string; tax_minor: string; total_minor: string; status: string;
      cash_tendered_minor: string | null; change_minor: string | null;
      customer_account_id: string | null; customer_name_snapshot: string | null; customer_amount_due_minor: string;
      receipt_profile_snapshot: Record<string, unknown>; has_logo: boolean; has_receipt_qr: boolean;
      embedded_logo: boolean; embedded_receipt_qr: boolean; logo_value: unknown; receipt_qr_value: unknown;
    }>(`SELECT o.id,o.receipt_number,o.tenant_name_snapshot,o.outlet_name_snapshot,o.outlet_time_zone_snapshot,
        o.currency,o.created_at,o.subtotal_minor::text,o.tax_minor::text,o.total_minor::text,o.status,
        o.cash_tendered_minor::text,o.change_minor::text,o.customer_account_id,o.customer_name_snapshot,o.customer_amount_due_minor::text,
        o.receipt_profile_snapshot-'logoUrl'-'receiptQrImage' receipt_profile_snapshot,
        o.receipt_profile_snapshot ? 'logoUrl' has_logo,o.receipt_profile_snapshot ? 'receiptQrImage' has_receipt_qr,
        COALESCE(o.receipt_profile_snapshot->>'logoUrl' LIKE 'data:image/png;base64,%',false) embedded_logo,
        COALESCE(o.receipt_profile_snapshot->>'receiptQrImage' LIKE 'data:image/png;base64,%',false) embedded_receipt_qr,
        CASE WHEN o.receipt_profile_snapshot->>'logoUrl' LIKE 'data:image/png;base64,%' THEN NULL ELSE o.receipt_profile_snapshot->'logoUrl' END logo_value,
        CASE WHEN o.receipt_profile_snapshot->>'receiptQrImage' LIKE 'data:image/png;base64,%' THEN NULL ELSE o.receipt_profile_snapshot->'receiptQrImage' END receipt_qr_value,
        o.operator_name_snapshot operator_name
      FROM commerce.orders o
      WHERE o.id=$1 AND o.tenant_id=$2 AND o.outlet_id=$3`, [orderIdValue, session.tenantId, session.outletId]);
    if (!orderResult.rowCount) throw new DomainError('NOT_FOUND', 'Sale receipt was not found for this outlet.', 404);
    const order = orderResult.rows[0];

    const lineResult = await client.query<{
      id: string; sku_snapshot: string; name_snapshot: string; quantity: string;
      unit_price_minor: string; tax_rate_bps: number; line_subtotal_minor: string; line_tax_minor: string;
      discount_minor: string; discount_reason: string | null; unrecorded_quantity:string; provisional_cogs_minor:string;item_kind_snapshot:string;
    }>(`SELECT id,sku_snapshot,name_snapshot,quantity::text,unit_price_minor::text,tax_rate_bps,
        line_subtotal_minor::text,line_tax_minor::text,discount_minor::text,discount_reason,unrecorded_quantity::text,provisional_cogs_minor::text,item_kind_snapshot
      FROM commerce.order_lines WHERE tenant_id=$1 AND outlet_id=$2 AND order_id=$3 ORDER BY id`,
    [session.tenantId, session.outletId, orderIdValue]);
    const paymentResult = await client.query<{ method: string; amount_minor: string; currency: string; status: string; reference: string | null; confirmed_operator_name_snapshot: string | null; manually_confirmed_at: Date | null }>(`SELECT method,amount_minor::text,currency,status,reference,confirmed_operator_name_snapshot,manually_confirmed_at
      FROM commerce.payments WHERE tenant_id=$1 AND outlet_id=$2 AND order_id=$3 ORDER BY created_at,id`,
    [session.tenantId, session.outletId, orderIdValue]);

    const subtotal = BigInt(order.subtotal_minor);
    const tax = BigInt(order.tax_minor);
    const total = BigInt(order.total_minor);
    const amountDue = BigInt(order.customer_amount_due_minor);
    const lineSubtotal = lineResult.rows.reduce((sum, line) => sum + BigInt(line.line_subtotal_minor), 0n);
    const lineTax = lineResult.rows.reduce((sum, line) => sum + BigInt(line.line_tax_minor), 0n);
    const discount = lineResult.rows.reduce((sum, line) => sum + BigInt(line.discount_minor), 0n);
    const paid = paymentResult.rows.reduce((sum, payment) => sum + BigInt(payment.amount_minor), 0n);
    if (lineSubtotal !== subtotal || lineTax !== tax || subtotal + tax !== total || paid + amountDue !== total || (amountDue > 0n) !== (order.customer_account_id !== null) || ((order.customer_account_id === null) !== (order.customer_name_snapshot === null))) {
      throw new DomainError('RECEIPT_INTEGRITY_FAILED', 'Stored sale lines, payment or customer charge evidence do not reconcile to the confirmed order.', 500);
    }
    if ((order.cash_tendered_minor === null) !== (order.change_minor === null)) {
      throw new DomainError('RECEIPT_INTEGRITY_FAILED', 'Stored cash tender evidence is incomplete.', 500);
    }

    const receiptProfile = { ...order.receipt_profile_snapshot };
    if (order.has_logo) receiptProfile.logoUrl = order.embedded_logo
      ? `/api/v1/sales/orders/${order.id}/receipt/assets/logo`
      : order.logo_value;
    if (order.has_receipt_qr) receiptProfile.receiptQrImage = order.embedded_receipt_qr
      ? `/api/v1/sales/orders/${order.id}/receipt/assets/receipt_qr`
      : order.receipt_qr_value;

    return {
      status: 'CONFIRMED',
      fiscalDocumentStatus: 'NOT_INTEGRATED',
      receiptId: order.id,
      receiptNumber: order.receipt_number,
      tenantName: order.tenant_name_snapshot,
      outletName: order.outlet_name_snapshot,
      timeZone: order.outlet_time_zone_snapshot,
      receiptProfile,
      currency: order.currency,
      createdAt: order.created_at,
      operatorName: order.operator_name,
      saleStatus: order.status,
      lines: lineResult.rows.map(line => {
        const unrecordedQuantity = quantityMicros(line.unrecorded_quantity);
        return {
          lineId: line.id,
          sku: line.sku_snapshot,
          name: line.name_snapshot,
          itemKind: line.item_kind_snapshot,
          quantity: line.quantity,
          ...(unrecordedQuantity > 0n ? { unrecordedQuantity: line.unrecorded_quantity } : {}),
          ...(unrecordedQuantity > 0n && ROLE_PERMISSIONS[session.role].includes('finance.view') ? { provisionalCogsMinor: line.provisional_cogs_minor } : {}),
          unitPriceMinor: line.unit_price_minor,
          taxRateBps: line.tax_rate_bps,
          originalSubtotalMinor: (BigInt(line.line_subtotal_minor) + BigInt(line.discount_minor)).toString(),
          discountMinor: line.discount_minor,
          discountReason: line.discount_reason,
          subtotalMinor: line.line_subtotal_minor,
          taxMinor: line.line_tax_minor,
          totalMinor: (BigInt(line.line_subtotal_minor) + BigInt(line.line_tax_minor)).toString(),
        };
      }),
      payments: paymentResult.rows.map(payment => ({ method: payment.method, amountMinor: payment.amount_minor, currency: payment.currency, status: payment.status, reference: payment.reference, confirmation: payment.method === 'MANUAL_MPESA' ? 'CASHIER_CONFIRMED' : 'CASH', confirmedBy: payment.confirmed_operator_name_snapshot, confirmedAt: payment.manually_confirmed_at })),
      originalSubtotalMinor: (subtotal + discount).toString(),
      discountMinor: discount.toString(),
      subtotalMinor: order.subtotal_minor,
      taxMinor: order.tax_minor,
      totalMinor: order.total_minor,
      amountPaidMinor: paid.toString(),
      customerAccountCharge: order.customer_account_id ? {
        customerId: order.customer_account_id,
        customerName: order.customer_name_snapshot,
        amountDueMinor: amountDue.toString(),
      } : null,
      cashTenderedMinor: order.cash_tendered_minor,
      changeMinor: order.change_minor,
    };
  });
}

export async function getSaleReceiptAsset(session: ApiSession, orderIdValue: unknown, kindValue: unknown): Promise<Buffer | null> {
  requireReceiptAccess(session);
  if (typeof orderIdValue !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderIdValue)) {
    throw new DomainError('VALIDATION_FAILED', 'orderId must be a valid order identifier.');
  }
  if (kindValue !== 'logo' && kindValue !== 'receipt_qr') return null;
  const field = kindValue === 'logo' ? 'logoUrl' : 'receiptQrImage';
  const result = await pool.query<{ image: string | null }>(`SELECT receipt_profile_snapshot->>$4 AS image
    FROM commerce.orders WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3`,
  [orderIdValue, session.tenantId, session.outletId, field]);
  if (!result.rowCount || !result.rows[0].image?.startsWith('data:image/png;base64,')) return null;
  try { return decodePngDataUrl(result.rows[0].image, field); } catch { return null; }
}
