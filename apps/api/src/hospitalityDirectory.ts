import { inReadSnapshot } from './db.js';
import { DomainError, ROLE_PERMISSIONS, type ApiSession } from './contracts.js';
import { readHistoryPage, type HistoryQuery } from './historyPagination.js';

export async function listHotelReservations(session: ApiSession, query: HistoryQuery = {}) {
  if (!session.capabilities.includes('hospitality')) throw new DomainError('CAPABILITY_DISABLED', 'Hospitality is not enabled for this tenant.', 403);
  if (!ROLE_PERMISSIONS[session.role].some(permission => permission === 'hotel.frontdesk' || permission === 'hotel.manage')) throw new DomainError('FORBIDDEN', 'Your role cannot view reservations.', 403);
  return inReadSnapshot(async client => {
    const result = await readHistoryPage(client, session, 'hotel-reservations', query, `SELECT b.id,b.room_id,r.room_number,b.guest_name,b.guest_contact,
      to_char(b.check_in_date,'YYYY-MM-DD') check_in_date,to_char(b.check_out_date,'YYYY-MM-DD') check_out_date,
      b.nightly_rate_minor,b.tax_rate_bps,b.currency,b.status,b.version,b.created_at sort_at,
      concat_ws(' ',b.id::text,b.guest_name,b.guest_contact,r.room_number,b.check_in_date::text,b.check_out_date::text) search_text
      FROM hospitality.reservations b JOIN hospitality.rooms r ON r.id=b.room_id AND r.tenant_id=b.tenant_id AND r.outlet_id=b.outlet_id
      WHERE b.tenant_id=$1 AND b.outlet_id=$2 AND b.status='CONFIRMED'`, [session.tenantId, session.outletId], 100);
    return { page: result.page, reservations: result.rows.map(row => ({ id:row.id,roomId:row.room_id,roomNumber:row.room_number,guestName:row.guest_name,guestContact:row.guest_contact,checkInDate:row.check_in_date,checkOutDate:row.check_out_date,nightlyRateMinor:Number(row.nightly_rate_minor),taxRateBps:row.tax_rate_bps,currency:row.currency,status:row.status,version:Number(row.version) })) };
  });
}
