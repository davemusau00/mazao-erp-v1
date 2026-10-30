import { inReadSnapshot } from './db.js';
import { DomainError, ROLE_PERMISSIONS, type ApiSession } from './contracts.js';
import { readHistoryPage, type HistoryQuery } from './historyPagination.js';

export async function listInventoryMovements(session: ApiSession, query: HistoryQuery = {}) {
  if (!session.capabilities.includes('inventory')) throw new DomainError('CAPABILITY_DISABLED','Inventory is not enabled.',403);
  const permissions = ROLE_PERMISSIONS[session.role];
  if (!permissions.includes('inventory.receive')) throw new DomainError('FORBIDDEN','Your role cannot review stock movements.',403);
  const canReadCost = permissions.includes('catalog.manage') || permissions.includes('finance.view');
  return inReadSnapshot(async client => {
    const result = await readHistoryPage(client,session,'inventory.movements',query,`SELECT m.id,m.created_at sort_at,m.created_at,m.movement_type,m.quantity_delta,m.document_reference,
      CASE WHEN $3::boolean THEN m.value_minor::text END value_minor,p.sku,p.name,
      concat_ws(' ',p.sku,p.name,m.document_reference,m.movement_type) search_text,
      SUM(m.quantity_delta) OVER(PARTITION BY m.product_id ORDER BY m.created_at,m.id ROWS UNBOUNDED PRECEDING) balance_after
      FROM inventory.movements m JOIN catalog.products p ON p.id=m.product_id AND p.tenant_id=m.tenant_id AND p.outlet_id=m.outlet_id
      WHERE m.tenant_id=$1 AND m.outlet_id=$2`,[session.tenantId,session.outletId,canReadCost],250);
    return { page:result.page,movements:result.rows.map(r=>({id:r.id,timestamp:r.created_at,sku:r.sku,productName:r.name,
      type:r.movement_type==='SALE'?'sale':r.movement_type==='RECEIPT'||r.movement_type==='REFUND'?'restock':'adjustment',quantity:String(r.quantity_delta),
      balanceAfter:String(r.balance_after),note:r.document_reference??r.movement_type,reference:r.document_reference,...(canReadCost?{valueMinor:String(r.value_minor)}:{})})) };
  });
}

export async function listInventoryCounts(session: ApiSession, query: HistoryQuery = {}) {
  if (!session.capabilities.includes('inventory')) throw new DomainError('CAPABILITY_DISABLED','Inventory is not enabled.',403);
  if (!ROLE_PERMISSIONS[session.role].some(p=>p==='inventory.count'||p==='inventory.count.approve')) throw new DomainError('FORBIDDEN','Your role cannot access stock counts.',403);
  return inReadSnapshot(async client => {
    const result = await readHistoryPage(client,session,'inventory.counts',query,`SELECT c.id,c.opened_at sort_at,c.status,c.count_mode,c.blind_count,c.area_label,c.version,c.opened_at,c.posted_at,
      opened.full_name opened_by_name,posted.full_name posted_by_name,concat_ws(' ',c.area_label,c.status,opened.full_name) search_text,
      (SELECT count(*)::int FROM inventory.stock_count_lines l WHERE l.tenant_id=c.tenant_id AND l.outlet_id=c.outlet_id AND l.count_id=c.id) line_count,
      (SELECT count(*)::int FROM inventory.stock_count_lines l WHERE l.tenant_id=c.tenant_id AND l.outlet_id=c.outlet_id AND l.count_id=c.id AND l.counted_quantity IS NOT NULL) counted_line_count
      FROM inventory.stock_counts c JOIN identity.users opened ON opened.id=c.opened_by LEFT JOIN identity.users posted ON posted.id=c.posted_by
      WHERE c.tenant_id=$1 AND c.outlet_id=$2`,[session.tenantId,session.outletId]);
    return { page:result.page,counts:result.rows.map(r=>({id:r.id,status:r.status,scope:r.count_mode,blind:r.blind_count,areaLabel:r.area_label,version:Number(r.version),openedAt:r.opened_at,
      openedBy:r.opened_by_name,postedAt:r.posted_at,postedBy:r.posted_by_name,lineCount:r.line_count,countedLineCount:r.counted_line_count})) };
  });
}

export async function listShiftCashMovements(session: ApiSession, shiftId: string, query: HistoryQuery = {}) {
  const permissions = ROLE_PERMISSIONS[session.role];
  if (!session.capabilities.includes('commerce')) throw new DomainError('CAPABILITY_DISABLED','Commerce is not enabled.',403);
  if (!permissions.some(p=>p==='shift.open'||p==='shift.close'||p==='shift.payout'||p==='finance.view')) throw new DomainError('FORBIDDEN','Your role cannot view till shifts.',403);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(shiftId)) throw new DomainError('VALIDATION_FAILED','Choose a valid shift.');
  return inReadSnapshot(async client => {
    const shift = await client.query('SELECT id FROM commerce.shifts WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3 AND (operator_id=$4 OR $5::boolean)',[session.tenantId,session.outletId,shiftId,session.userId,permissions.includes('finance.view')]);
    if (!shift.rowCount) throw new DomainError('NOT_FOUND','Shift was not found.',404);
    const result = await readHistoryPage(client,session,'shift.cash:'+shiftId,query,`SELECT m.id,m.created_at sort_at,m.created_at,m.movement_type,m.amount_minor,m.reason,m.reference,u.full_name actor_name,
      concat_ws(' ',m.reason,m.reference,m.movement_type,u.full_name) search_text FROM commerce.shift_cash_movements m JOIN identity.users u ON u.id=m.actor_id
      WHERE m.tenant_id=$1 AND m.outlet_id=$2 AND m.shift_id=$3`,[session.tenantId,session.outletId,shiftId],100);
    return { page:result.page,movements:result.rows.map(m=>({id:m.id,movementType:m.movement_type,amountMinor:Number(m.amount_minor),reason:m.reason,reference:m.reference,actorName:m.actor_name,createdAt:m.created_at})) };
  });
}
