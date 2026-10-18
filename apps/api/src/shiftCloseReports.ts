import { pool } from './db.js';
import { DomainError, ROLE_PERMISSIONS, type ApiSession } from './contracts.js';

export async function listShiftCloseReports(session: ApiSession) {
  const permissions = ROLE_PERMISSIONS[session.role];
  const canViewAll = permissions.includes('finance.view');
  if (!canViewAll && !permissions.includes('shift.close')) {
    throw new DomainError('FORBIDDEN', 'Your role cannot review shift close reports.', 403);
  }

  const result = await pool.query(`SELECT id,shift_id,command_id,operator_id,operator_name_snapshot,
      tenant_name_snapshot,outlet_name_snapshot,time_zone_snapshot,business_date::text business_date,
      currency,shift_version,opened_at,closed_at,opening_float_minor::text,
      cash_sales_minor::text,customer_collections_minor::text,cash_refunds_minor::text,
      cash_paid_in_minor::text,cash_payout_minor::text,expected_cash_minor::text,
      counted_cash_minor::text,variance_minor::text,mpesa_sales_minor::text
    FROM commerce.shift_close_reports
    WHERE tenant_id=$1 AND outlet_id=$2 AND ($3::boolean OR operator_id=$4)
    ORDER BY closed_at DESC,id DESC LIMIT 50`,
  [session.tenantId, session.outletId, canViewAll, session.userId]);

  return {
    reports: result.rows.map(row => ({
      id: row.id,
      shiftId: row.shift_id,
      commandId: row.command_id,
      operatorId: row.operator_id,
      operatorName: row.operator_name_snapshot,
      tenantName: row.tenant_name_snapshot,
      outletName: row.outlet_name_snapshot,
      timeZone: row.time_zone_snapshot,
      businessDate: row.business_date,
      currency: row.currency,
      shiftVersion: Number(row.shift_version),
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      openingFloatMinor: row.opening_float_minor,
      cashSalesMinor: row.cash_sales_minor,
      mpesaSalesMinor: row.mpesa_sales_minor,
      customerCollectionsMinor: row.customer_collections_minor,
      cashRefundsMinor: row.cash_refunds_minor,
      cashPaidInMinor: row.cash_paid_in_minor,
      cashPayoutMinor: row.cash_payout_minor,
      expectedCashMinor: row.expected_cash_minor,
      countedCashMinor: row.counted_cash_minor,
      varianceMinor: row.variance_minor,
    })),
  };
}
