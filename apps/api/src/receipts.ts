import type { PoolClient } from 'pg';
import { pool } from './db.js';
import type { ApiSession } from './contracts.js';
import { DomainError, ROLE_PERMISSIONS } from './contracts.js';

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
    }>(`SELECT o.id,o.receipt_number,o.tenant_name_snapshot,o.outlet_name_snapshot,o.outlet_time_zone_snapshot,
        o.currency,o.created_at,o.subtotal_minor::text,o.tax_minor::text,o.total_minor::text,o.status,
        o.cash_tendered_minor::text,o.change_minor::text,u.full_name operator_name
      FROM commerce.orders o JOIN identity.users u ON u.id=o.operator_id
      WHERE o.id=$1 AND o.tenant_id=$2 AND o.outlet_id=$3`, [orderIdValue, session.tenantId, session.outletId]);
    if (!orderResult.rowCount) throw new DomainError('NOT_FOUND', 'Sale receipt was not found for this outlet.', 404);
    const order = orderResult.rows[0];

    const lineResult = await client.query<{
      id: string; sku_snapshot: string; name_snapshot: string; quantity: string;
      unit_price_minor: string; tax_rate_bps: number; line_subtotal_minor: string; line_tax_minor: string;
    }>(`SELECT id,sku_snapshot,name_snapshot,quantity::text,unit_price_minor::text,tax_rate_bps,
        line_subtotal_minor::text,line_tax_minor::text
      FROM commerce.order_lines WHERE tenant_id=$1 AND outlet_id=$2 AND order_id=$3 ORDER BY id`,
    [session.tenantId, session.outletId, orderIdValue]);
    const paymentResult = await client.query<{ method: string; amount_minor: string; currency: string; status: string }>(`SELECT method,amount_minor::text,currency,status
      FROM commerce.payments WHERE tenant_id=$1 AND outlet_id=$2 AND order_id=$3 ORDER BY created_at,id`,
    [session.tenantId, session.outletId, orderIdValue]);

    const subtotal = BigInt(order.subtotal_minor);
    const tax = BigInt(order.tax_minor);
    const total = BigInt(order.total_minor);
    const lineSubtotal = lineResult.rows.reduce((sum, line) => sum + BigInt(line.line_subtotal_minor), 0n);
    const lineTax = lineResult.rows.reduce((sum, line) => sum + BigInt(line.line_tax_minor), 0n);
    const paid = paymentResult.rows.reduce((sum, payment) => sum + BigInt(payment.amount_minor), 0n);
    if (lineSubtotal !== subtotal || lineTax !== tax || subtotal + tax !== total || paid !== total) {
      throw new DomainError('RECEIPT_INTEGRITY_FAILED', 'Stored sale lines or payment evidence do not reconcile to the confirmed order.', 500);
    }
    if ((order.cash_tendered_minor === null) !== (order.change_minor === null)) {
      throw new DomainError('RECEIPT_INTEGRITY_FAILED', 'Stored cash tender evidence is incomplete.', 500);
    }

    return {
      status: 'CONFIRMED',
      fiscalDocumentStatus: 'NOT_INTEGRATED',
      receiptId: order.id,
      receiptNumber: order.receipt_number,
      tenantName: order.tenant_name_snapshot,
      outletName: order.outlet_name_snapshot,
      timeZone: order.outlet_time_zone_snapshot,
      currency: order.currency,
      createdAt: order.created_at,
      operatorName: order.operator_name,
      saleStatus: order.status,
      lines: lineResult.rows.map(line => ({
        lineId: line.id,
        sku: line.sku_snapshot,
        name: line.name_snapshot,
        quantity: line.quantity,
        unitPriceMinor: line.unit_price_minor,
        taxRateBps: line.tax_rate_bps,
        subtotalMinor: line.line_subtotal_minor,
        taxMinor: line.line_tax_minor,
        totalMinor: (BigInt(line.line_subtotal_minor) + BigInt(line.line_tax_minor)).toString(),
      })),
      payments: paymentResult.rows.map(payment => ({ method: payment.method, amountMinor: payment.amount_minor, currency: payment.currency, status: payment.status })),
      subtotalMinor: order.subtotal_minor,
      taxMinor: order.tax_minor,
      totalMinor: order.total_minor,
      amountPaidMinor: paid.toString(),
      cashTenderedMinor: order.cash_tendered_minor,
      changeMinor: order.change_minor,
    };
  });
}
