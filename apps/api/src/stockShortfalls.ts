import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DomainError, ROLE_PERMISSIONS, type ApiSession, type CommandEnvelope } from './contracts.js';
import { inReadSnapshot, pool } from './db.js';
import { csvExportCell } from './csvParser.js';
import { readHistoryPage, type HistoryQuery } from './historyPagination.js';

const scale = 1_000_000n;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type ReasonCode = 'SUSPECTED_UNRECORDED_DELIVERY' | 'SUSPECTED_OUTDATED_COUNT' | 'UNKNOWN';
type ResolutionType = 'OMITTED_RECEIPT' | 'VERIFIED_COUNT_ADJUSTMENT';

function permission(session: ApiSession, value: 'inventory.shortfall.view' | 'inventory.shortfall.configure' | 'inventory.shortfall.resolve') {
  if (!ROLE_PERMISSIONS[session.role].includes(value)) throw new DomainError('FORBIDDEN', 'Your role cannot access stock exception records.', 403);
}
function exactRecord(value: unknown, allowed: readonly string[], label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    throw new DomainError('VALIDATION_FAILED', `${label} contains an unsupported or invalid field.`);
  }
  return value as Record<string, unknown>;
}
function decimal(value: unknown, label = 'Quantity'): bigint {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,6})?$/.test(value)) throw new DomainError('VALIDATION_FAILED', `${label} must use a positive decimal with at most 6 decimal places.`);
  const [whole, fraction = ''] = value.split('.');
  const result = BigInt(whole) * scale + BigInt((fraction + '000000').slice(0, 6));
  if (result <= 0n) throw new DomainError('VALIDATION_FAILED', `${label} must be greater than zero.`);
  return result;
}
function decimalText(value: bigint) {
  const fraction = (value % scale).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${value / scale}.${fraction}` : (value / scale).toString();
}
function decimalMicros(value: string) {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * scale + BigInt(fraction.padEnd(6, '0'));
}
function moneyText(value: bigint, label: string) {
  if (value < 0n || value > 9_223_372_036_854_775_807n) throw new DomainError('VALIDATION_FAILED', `${label} exceeds the supported money range.`);
  return value.toString();
}
function signedMoneyText(value: bigint, label: string) {
  if (value < -9_223_372_036_854_775_807n || value > 9_223_372_036_854_775_807n) throw new DomainError('VALIDATION_FAILED', `${label} exceeds the supported money range.`);
  return value.toString();
}
function alloc(value: bigint, baseQuantity: bigint, quantity: bigint) {
  if (value < 0n || baseQuantity <= 0n || quantity < 0n) throw new DomainError('INTERNAL_ERROR', 'Stock exception value allocation is invalid.', 500);
  if (quantity === baseQuantity) return value;
  return (value * quantity + baseQuantity / 2n) / baseQuantity;
}
function expected(envelope: CommandEnvelope, key: string) {
  const value = envelope.expectedVersions[key];
  if (!Number.isSafeInteger(value) || value < 1) throw new DomainError('VALIDATION_FAILED', `Refresh this stock exception before continuing; ${key} is required.`);
  return value;
}
function text(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new DomainError('VALIDATION_FAILED', `${label} must contain ${min} to ${max} characters.`);
  }
  return value.trim();
}
function date(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DomainError('VALIDATION_FAILED', `${field} must use YYYY-MM-DD.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new DomainError('VALIDATION_FAILED', `${field} must be a real calendar date.`);
  return value;
}
function cursor(value: unknown): { at: string; id: string } | null {
  if (value === undefined || value === null || value === '') return null;
  try {
    if (typeof value !== 'string' || value.length > 400) throw new Error();
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== 'string' || !Number.isFinite(Date.parse(parsed[0])) || typeof parsed[1] !== 'string' || !uuid.test(parsed[1])) throw new Error();
    return { at: parsed[0], id: parsed[1] };
  } catch { throw new DomainError('VALIDATION_FAILED', 'The stock exception page reference is invalid. Refresh the list.'); }
}
function status(quantity: string, resolved: string) {
  const original = decimalMicros(quantity), current = decimalMicros(resolved);
  return current === original ? 'RESOLVED' : current === 0n ? 'OPEN' : 'PARTIALLY_RESOLVED';
}
async function audit(client: PoolClient, session: ApiSession, envelope: CommandEnvelope, value: unknown) {
  const payload = JSON.stringify(value);
  await client.query('INSERT INTO system.audit_events(id,tenant_id,outlet_id,actor_id,command_id,event_type,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',
    [randomUUID(), session.tenantId, session.outletId, session.userId, envelope.commandId, envelope.type, payload]);
  await client.query('INSERT INTO system.transactional_outbox(id,tenant_id,command_id,event_type,payload) VALUES($1,$2,$3,$4,$5::jsonb)',
    [randomUUID(), session.tenantId, envelope.commandId, envelope.type, payload]);
}
async function postJournal(client: PoolClient, session: ApiSession, commandId: string, currency: string, lines: Array<{ account: string; debit: bigint; credit: bigint }>) {
  const included = lines.filter(line => line.debit !== 0n || line.credit !== 0n);
  const debits = included.reduce((sum, line) => sum + line.debit, 0n);
  const credits = included.reduce((sum, line) => sum + line.credit, 0n);
  if (debits === 0n || debits !== credits) throw new DomainError('INTERNAL_ERROR', 'Stock reconciliation journal did not balance.', 500);
  const entryId = randomUUID();
  await client.query('INSERT INTO finance.journal_entries(id,tenant_id,source_type,source_id,currency,created_by) VALUES($1,$2,\'SALE_SHORTFALL_RESOLUTION\',$3,$4,$5)',
    [entryId, session.tenantId, commandId, currency, session.userId]);
  for (const line of included) await client.query('INSERT INTO finance.journal_lines(id,tenant_id,journal_entry_id,account_code,debit_minor,credit_minor) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), session.tenantId, entryId, line.account, moneyText(line.debit, 'Journal debit'), moneyText(line.credit, 'Journal credit')]);
}

export async function getStockSalePolicy(session: ApiSession) {
  if (!ROLE_PERMISSIONS[session.role].some(item => ['commerce.sell', 'inventory.shortfall.configure', 'inventory.shortfall.view'].includes(item))) {
    throw new DomainError('FORBIDDEN', 'Your role cannot review this outlet policy.', 403);
  }
  const result = await pool.query(`SELECT p.enabled,p.allow_zero_reference_cost,p.version,p.updated_by,u.full_name updated_by_name,p.updated_at
    FROM core.outlets o LEFT JOIN inventory.outlet_stock_sale_policies p ON p.tenant_id=o.tenant_id AND p.outlet_id=o.id
    LEFT JOIN identity.users u ON u.id=p.updated_by WHERE o.tenant_id=$1 AND o.id=$2 AND o.active`, [session.tenantId, session.outletId]);
  if (!result.rowCount) throw new DomainError('NOT_FOUND', 'The current outlet was not found.', 404);
  const row = result.rows[0];
  return { policy: { enabled: row.enabled === true, requirePhysicalConfirmation: true, requireReason: true,
    allowZeroReferenceCost: row.allow_zero_reference_cost ?? true, version: Number(row.version ?? 1), updatedBy: row.updated_by ?? null,
    updatedByName: row.updated_by_name ?? null, updatedAt: row.updated_at ?? null } };
}

export async function executeStockExceptionCommand(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  if (envelope.type === 'configuration.stock_exception_policy.update') return updatePolicy(client, session, envelope);
  if (envelope.type === 'inventory.sale_shortfall.resolve') return resolveShortfall(client, session, envelope);
  throw new DomainError('VALIDATION_FAILED', `Unsupported stock exception command: ${envelope.type}`);
}

async function updatePolicy(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  permission(session, 'inventory.shortfall.configure');
  const input = exactRecord(envelope.payload, ['enabled', 'allowZeroReferenceCost'], 'Stock sale policy');
  if (typeof input.enabled !== 'boolean' || (input.allowZeroReferenceCost !== undefined && typeof input.allowZeroReferenceCost !== 'boolean')) {
    throw new DomainError('VALIDATION_FAILED', 'Choose whether confirmed stock exception sales are enabled and whether zero reference cost is allowed.');
  }
  const wantedVersion = expected(envelope, `stock-sale-policy:${session.outletId}`);
  const outlet = await client.query('SELECT id FROM core.outlets WHERE tenant_id=$1 AND id=$2 AND active FOR UPDATE', [session.tenantId, session.outletId]);
  if (!outlet.rowCount) throw new DomainError('NOT_FOUND', 'The current outlet was not found.', 404);
  const current = await client.query<{ enabled: boolean; allow_zero_reference_cost: boolean; version: string; updated_by: string | null; updated_at: Date | null }>(
    'SELECT enabled,allow_zero_reference_cost,version::text,updated_by,updated_at FROM inventory.outlet_stock_sale_policies WHERE tenant_id=$1 AND outlet_id=$2 FOR UPDATE',
    [session.tenantId, session.outletId]);
  const before = current.rowCount ? current.rows[0] : { enabled: false, allow_zero_reference_cost: true, version: '1', updated_by: null, updated_at: null };
  if (Number(before.version) !== wantedVersion) throw new DomainError('VERSION_CONFLICT', 'The stock sale policy changed. Review the current outlet setting before saving.', 409, { currentVersion: Number(before.version) });
  const nextVersion = wantedVersion + 1;
  const allowZero = input.allowZeroReferenceCost === undefined ? before.allow_zero_reference_cost : input.allowZeroReferenceCost;
  await client.query(`INSERT INTO inventory.outlet_stock_sale_policies(tenant_id,outlet_id,enabled,require_physical_confirmation,require_reason,allow_zero_reference_cost,version,updated_by,updated_at)
    VALUES($1,$2,$3,true,true,$4,$5,$6,clock_timestamp())
    ON CONFLICT(tenant_id,outlet_id) DO UPDATE SET enabled=EXCLUDED.enabled,require_physical_confirmation=true,require_reason=true,
      allow_zero_reference_cost=EXCLUDED.allow_zero_reference_cost,version=EXCLUDED.version,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at`,
  [session.tenantId, session.outletId, input.enabled, allowZero, nextVersion, session.userId]);
  const after = { enabled: input.enabled, requirePhysicalConfirmation: true, requireReason: true, allowZeroReferenceCost: allowZero,
    version: nextVersion, updatedBy: session.userId, updatedByName: session.fullName };
  await audit(client, session, envelope, { before, after });
  return { ...after, updatedAt: new Date().toISOString() };
}

async function resolveShortfall(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  permission(session, 'inventory.shortfall.resolve');
  const input = exactRecord(envelope.payload, ['shortfallId', 'quantity', 'resolutionType', 'supportingMovementId', 'supportingDocumentReference', 'reason'], 'Stock exception resolution');
  if (typeof input.shortfallId !== 'string' || !uuid.test(input.shortfallId) || typeof input.supportingMovementId !== 'string' || !uuid.test(input.supportingMovementId)) {
    throw new DomainError('VALIDATION_FAILED', 'Choose a valid stock exception and supporting inventory record.');
  }
  if (input.resolutionType !== 'OMITTED_RECEIPT' && input.resolutionType !== 'VERIFIED_COUNT_ADJUSTMENT') throw new DomainError('VALIDATION_FAILED', 'Choose a supported inventory evidence type.');
  const quantity = decimal(input.quantity);
  const reason = text(input.reason, 'Manager explanation', 3, 500);
  const document = input.supportingDocumentReference === undefined || input.supportingDocumentReference === null || input.supportingDocumentReference === ''
    ? null : text(input.supportingDocumentReference, 'Supporting document reference', 1, 160);
  const expectedShortfall = expected(envelope, `shortfall:${input.shortfallId}`);
  const shortfallResult = await client.query(`SELECT id,product_id,order_id,order_line_id,quantity::text quantity,resolved_quantity::text resolved_quantity,
      provisional_cogs_minor::text provisional_cogs_minor,version::text version
    FROM inventory.sale_shortfalls WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 FOR UPDATE`, [input.shortfallId, session.tenantId, session.outletId]);
  if (!shortfallResult.rowCount) throw new DomainError('NOT_FOUND', 'Stock exception was not found at this outlet.', 404);
  const shortfall = shortfallResult.rows[0];
  if (Number(shortfall.version) !== expectedShortfall) throw new DomainError('VERSION_CONFLICT', 'This stock exception changed. Refresh its history before resolving it.', 409, { currentVersion: Number(shortfall.version) });
  const originalQuantity = decimalMicros(shortfall.quantity), alreadyResolved = decimalMicros(shortfall.resolved_quantity), unresolved = originalQuantity - alreadyResolved;
  if (quantity > unresolved) throw new DomainError('SHORTFALL_QUANTITY_EXCEEDED', 'The resolution quantity exceeds the outstanding stock discrepancy.', 409, { remainingQuantity: decimalText(unresolved) });

  const sourceResult = await client.query<{ product_id: string; movement_type: string; quantity_delta: string; document_reference: string | null }>(
    `SELECT product_id,movement_type,quantity_delta::text quantity_delta,document_reference FROM inventory.movements
     WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 FOR UPDATE`, [input.supportingMovementId, session.tenantId, session.outletId]);
  if (!sourceResult.rowCount || sourceResult.rows[0].product_id !== shortfall.product_id) throw new DomainError('INVALID_STOCK_EVIDENCE', 'The supporting inventory record does not match this item and outlet.', 409);
  const source = sourceResult.rows[0];
  const expectedMovement = input.resolutionType === 'OMITTED_RECEIPT' ? 'RECEIPT' : 'COUNT_ADJUSTMENT';
  const sourceQuantity = decimalMicros(source.quantity_delta);
  if (source.movement_type !== expectedMovement || sourceQuantity <= 0n) throw new DomainError('INVALID_STOCK_EVIDENCE', 'Choose a positive receipt or verified stock count adjustment that supports this resolution.', 409);
  const priorSourceUse = await client.query<{ quantity: string }>(`SELECT COALESCE(sum(quantity),0)::text quantity FROM inventory.sale_shortfall_resolutions
    WHERE tenant_id=$1 AND outlet_id=$2 AND supporting_movement_id=$3`, [session.tenantId, session.outletId, input.supportingMovementId]);
  const remainingEvidence = sourceQuantity - decimalMicros(priorSourceUse.rows[0].quantity);
  if (quantity > remainingEvidence) throw new DomainError('INVALID_STOCK_EVIDENCE', 'This inventory record does not have enough unallocated quantity to support the resolution.', 409, { availableQuantity: decimalText(remainingEvidence) });

  const product = await client.query('SELECT id FROM catalog.products WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 FOR UPDATE', [shortfall.product_id, session.tenantId, session.outletId]);
  if (!product.rowCount) throw new DomainError('NOT_FOUND', 'The stock item is no longer available at this outlet.', 404);
  const balanceResult = await client.query<{ quantity: string; inventory_value_minor: string; version: string }>(
    'SELECT quantity::text quantity,inventory_value_minor::text inventory_value_minor,version::text version FROM inventory.balances WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3 FOR UPDATE',
    [session.tenantId, session.outletId, shortfall.product_id]);
  if (!balanceResult.rowCount) throw new DomainError('NOT_FOUND', 'Current stock was not found for this item.', 404);
  const balance = balanceResult.rows[0], currentQuantity = decimalMicros(balance.quantity);
  const currentValue = BigInt(balance.inventory_value_minor), expectedBalance = expected(envelope, `balance:${shortfall.product_id}`);
  if (Number(balance.version) !== expectedBalance) throw new DomainError('VERSION_CONFLICT', 'Current stock changed. Refresh the stock exception and supporting record before resolving it.', 409, { currentVersion: Number(balance.version) });
  if (quantity > currentQuantity) throw new DomainError('INSUFFICIENT_STOCK', 'There is not enough recorded stock available to reconcile this discrepancy.', 409, { availableQuantity: decimalText(currentQuantity) });

  const provisionalTotal = BigInt(shortfall.provisional_cogs_minor);
  const resolutionsBefore = await client.query<{ released: string }>('SELECT COALESCE(sum(provisional_cogs_released_minor),0)::text released FROM inventory.sale_shortfall_resolutions WHERE tenant_id=$1 AND outlet_id=$2 AND shortfall_id=$3',
    [session.tenantId, session.outletId, shortfall.id]);
  const releasedBefore = BigInt(resolutionsBefore.rows[0].released), stillProvisional = provisionalTotal - releasedBefore;
  const release = quantity === unresolved ? stillProvisional : alloc(provisionalTotal, originalQuantity, quantity);
  if (release > stillProvisional) throw new DomainError('INTERNAL_ERROR', 'Stock exception provisional cost allocation exceeds its remaining estimate.', 500);
  const actual = quantity === currentQuantity ? currentValue : alloc(currentValue, currentQuantity, quantity);
  const adjustment = actual - release;
  const nextInventoryValue = currentValue - actual;
  const currencyResult = await client.query<{ currency: string }>('SELECT currency FROM core.tenants WHERE id=$1', [session.tenantId]);
  const currency = currencyResult.rows[0]?.currency;
  if (!currency) throw new DomainError('NOT_FOUND', 'Business currency was not found.', 404);

  await client.query(`INSERT INTO inventory.sale_shortfall_resolutions(id,tenant_id,outlet_id,shortfall_id,command_id,resolved_by,resolved_by_name_snapshot,
      quantity,provisional_cogs_released_minor,actual_cogs_minor,cogs_adjustment_minor,resolution_type,supporting_movement_id,supporting_document_reference,reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9,$10,$11,$12,$13,$14,$15)`,
  [randomUUID(), session.tenantId, session.outletId, shortfall.id, envelope.commandId, session.userId, session.fullName, decimalText(quantity), moneyText(release, 'Released provisional cost'), moneyText(actual, 'Verified stock cost'), signedMoneyText(adjustment, 'Cost adjustment'), input.resolutionType, input.supportingMovementId, document ?? source.document_reference, reason]);
  await client.query(`UPDATE inventory.balances SET quantity=quantity-$4::numeric,inventory_value_minor=$5,version=version+1
    WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3 AND version=$6`,
  [session.tenantId, session.outletId, shortfall.product_id, decimalText(quantity), moneyText(nextInventoryValue, 'Remaining inventory value'), expectedBalance]);
  await client.query(`INSERT INTO inventory.movements(id,tenant_id,outlet_id,product_id,command_id,movement_type,quantity_delta,unit_cost_minor,value_minor,reference_id,document_reference)
    VALUES($1,$2,$3,$4,$5,'SHORTFALL_RECONCILIATION',-$6::numeric,$7,$8,$9,$10)`,
  [randomUUID(), session.tenantId, session.outletId, shortfall.product_id, envelope.commandId, decimalText(quantity),
    quantity > 0n ? moneyText((actual * scale + quantity / 2n) / quantity, 'Verified unit cost') : '0', moneyText(actual, 'Verified stock cost'), shortfall.id, document ?? source.document_reference]);
  const nextResolved = alreadyResolved + quantity;
  await client.query(`UPDATE inventory.sale_shortfalls SET resolved_quantity=$4::numeric,version=version+1
    WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3 AND version=$5`,
  [shortfall.id, session.tenantId, session.outletId, decimalText(nextResolved), expectedShortfall]);

  const journalLines: Array<{ account: string; debit: bigint; credit: bigint }> = [
    { account: 'UNRECORDED_STOCK_CLEARING', debit: release, credit: 0n },
    { account: 'INVENTORY', debit: 0n, credit: actual },
    { account: 'COST_OF_GOODS_SOLD', debit: adjustment > 0n ? adjustment : 0n, credit: adjustment < 0n ? -adjustment : 0n },
  ];
  if (release > 0n || actual > 0n) await postJournal(client, session, envelope.commandId, currency, journalLines);
  const result = { shortfallId: shortfall.id, resolutionType: input.resolutionType, quantity: decimalText(quantity), resolvedQuantity: decimalText(nextResolved),
    remainingQuantity: decimalText(unresolved - quantity), provisionalCogsReleasedMinor: moneyText(release, 'Released provisional cost'),
    actualCogsMinor: moneyText(actual, 'Verified stock cost'), cogsAdjustmentMinor: signedMoneyText(adjustment, 'Cost adjustment'),
    currency, version: expectedShortfall + 1, balanceVersion: expectedBalance + 1 };
  await audit(client, session, envelope, result);
  return result;
}

function queryInput(session: ApiSession, query: Record<string, unknown>) {
  permission(session, 'inventory.shortfall.view');
  const from = date(query.from, 'from'), to = date(query.to, 'to');
  if (from && to && from > to) throw new DomainError('VALIDATION_FAILED', 'from must be on or before to.');
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new DomainError('VALIDATION_FAILED', 'Choose a page size between 1 and 100.');
  const after = cursor(query.after);
  const productId = query.productId === undefined ? null : query.productId;
  const operatorId = query.operatorId === undefined ? null : query.operatorId;
  if (productId !== null && (typeof productId !== 'string' || !uuid.test(productId))) throw new DomainError('VALIDATION_FAILED', 'Choose a valid stock item.');
  if (operatorId !== null && (typeof operatorId !== 'string' || !uuid.test(operatorId))) throw new DomainError('VALIDATION_FAILED', 'Choose a valid staff member.');
  const statuses = ['OPEN', 'PARTIALLY_RESOLVED', 'RESOLVED'];
  const statusFilter = query.status === undefined || query.status === '' ? null : query.status;
  if (statusFilter !== null && (typeof statusFilter !== 'string' || !statuses.includes(statusFilter))) throw new DomainError('VALIDATION_FAILED', 'Choose a valid stock exception status.');
  const reasonCode = query.reasonCode === undefined || query.reasonCode === '' ? null : query.reasonCode;
  if (reasonCode !== null && !['SUSPECTED_UNRECORDED_DELIVERY', 'SUSPECTED_OUTDATED_COUNT', 'UNKNOWN'].includes(String(reasonCode))) throw new DomainError('VALIDATION_FAILED', 'Choose a valid stock exception reason.');
  if (query.outletId !== undefined && query.outletId !== session.outletId) throw new DomainError('FORBIDDEN', 'This outlet is outside your assigned scope.', 403);
  return { from, to, limit, after, productId: productId as string | null, operatorId: operatorId as string | null,
    status: statusFilter as string | null, reasonCode: reasonCode as string | null, canReadCosts: ROLE_PERMISSIONS[session.role].includes('finance.view') };
}

async function listRows(session: ApiSession, query: Record<string, unknown>, exportAll = false) {
  const parsed = queryInput(session, query);
  return inReadSnapshot(async client => {
    const stamp = await client.query<{ now: Date }>('SELECT statement_timestamp() now');
    const result = await client.query(`SELECT s.id,s.created_at,to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_at,
        s.order_id,o.receipt_number,s.order_line_id,s.product_id,l.sku_snapshot,l.name_snapshot,s.operator_id,s.operator_name_snapshot,
        s.quantity::text quantity,s.resolved_quantity::text resolved_quantity,s.requested_quantity::text requested_quantity,
        s.recorded_quantity_before::text recorded_quantity_before,s.reason_code,s.reason_note,s.version::text version,
        CASE WHEN $9::boolean THEN s.recorded_cogs_minor::text END recorded_cogs_minor,
        CASE WHEN $9::boolean THEN s.provisional_cogs_minor::text END provisional_cogs_minor,
        CASE WHEN $9::boolean THEN (s.provisional_cogs_minor-COALESCE((SELECT sum(r.provisional_cogs_released_minor) FROM inventory.sale_shortfall_resolutions r WHERE r.tenant_id=s.tenant_id AND r.outlet_id=s.outlet_id AND r.shortfall_id=s.id),0))::text END unresolved_cogs_minor,
        (SELECT COALESCE(sum(r.actual_cogs_minor),0)::text FROM inventory.sale_shortfall_resolutions r WHERE r.tenant_id=s.tenant_id AND r.outlet_id=s.outlet_id AND r.shortfall_id=s.id) actual_cogs_minor,
        (SELECT COALESCE(sum(r.cogs_adjustment_minor),0)::text FROM inventory.sale_shortfall_resolutions r WHERE r.tenant_id=s.tenant_id AND r.outlet_id=s.outlet_id AND r.shortfall_id=s.id) cogs_adjustment_minor
      FROM inventory.sale_shortfalls s JOIN commerce.orders o ON o.tenant_id=s.tenant_id AND o.outlet_id=s.outlet_id AND o.id=s.order_id
      JOIN commerce.order_lines l ON l.tenant_id=s.tenant_id AND l.outlet_id=s.outlet_id AND l.id=s.order_line_id
      WHERE s.tenant_id=$1 AND s.outlet_id=$2
        AND ($3::date IS NULL OR (s.created_at AT TIME ZONE $8)::date >= $3::date)
        AND ($4::date IS NULL OR (s.created_at AT TIME ZONE $8)::date <= $4::date)
        AND ($5::uuid IS NULL OR s.product_id=$5) AND ($6::uuid IS NULL OR s.operator_id=$6)
        AND ($7::text IS NULL OR s.reason_code=$7)
        AND ($10::text IS NULL OR ($10='OPEN' AND s.resolved_quantity=0) OR ($10='PARTIALLY_RESOLVED' AND s.resolved_quantity>0 AND s.resolved_quantity<s.quantity) OR ($10='RESOLVED' AND s.resolved_quantity=s.quantity))
        AND ($11::timestamptz IS NULL OR (s.created_at,s.id)<($11::timestamptz,$12::uuid))
      ORDER BY s.created_at DESC,s.id DESC LIMIT $13`,
    [session.tenantId, session.outletId, parsed.from, parsed.to, parsed.productId, parsed.operatorId, parsed.reasonCode, session.timeZone,
      parsed.canReadCosts, parsed.status, exportAll ? null : parsed.after?.at ?? null, exportAll ? null : parsed.after?.id ?? null,
      exportAll ? 10_001 : parsed.limit + 1]);
    if (exportAll && result.rows.length > 10_000) throw new DomainError('EXPORT_TOO_LARGE', 'This export contains more than 10,000 stock exceptions. Choose a shorter date range; no partial file was produced.', 413);
    const page = exportAll ? result.rows : result.rows.slice(0, parsed.limit);
    const hasMore = !exportAll && result.rows.length > parsed.limit;
    const last = page.at(-1);
    return { parsed, asOf: stamp.rows[0].now.toISOString(), totalPageCount: page.length, nextAfter: hasMore && last ? Buffer.from(JSON.stringify([last.cursor_at, last.id])).toString('base64url') : null,
      items: page.map(row => ({ id: row.id, createdAt: row.created_at, orderId: row.order_id, receiptNumber: row.receipt_number,
        orderLineId: row.order_line_id, productId: row.product_id, sku: row.sku_snapshot, productName: row.name_snapshot,
        operatorId: row.operator_id, operatorName: row.operator_name_snapshot, quantity: row.quantity, resolvedQuantity: row.resolved_quantity,
        remainingQuantity: decimalText(decimalMicros(row.quantity) - decimalMicros(row.resolved_quantity)),
        requestedQuantity: row.requested_quantity, recordedQuantityBefore: row.recorded_quantity_before, reasonCode: row.reason_code, reasonNote: row.reason_note,
        status: status(row.quantity, row.resolved_quantity), version: Number(row.version), ...(parsed.canReadCosts ? { recordedCogsMinor: row.recorded_cogs_minor,
          provisionalCogsMinor: row.provisional_cogs_minor, unresolvedCogsMinor: row.unresolved_cogs_minor, actualCogsMinor: row.actual_cogs_minor, cogsAdjustmentMinor: row.cogs_adjustment_minor } : {}) })) };
  });
}

export async function getStockShortfalls(session: ApiSession, query: Record<string, unknown>) {
  const page = await listRows(session, query);
  return { scope: 'OUTLET', outletId: session.outletId, asOf: page.asOf, limit: page.parsed.limit, nextAfter: page.nextAfter, totalOnPage: page.totalPageCount, items: page.items };
}

export async function getStockShortfallDetail(session: ApiSession, shortfallId: string) {
  permission(session, 'inventory.shortfall.view');
  if (!uuid.test(shortfallId)) throw new DomainError('VALIDATION_FAILED', 'Choose a valid stock exception.');
  const canReadCosts = ROLE_PERMISSIONS[session.role].includes('finance.view');
  const found = await inReadSnapshot(async client => {
    const result = await client.query(`SELECT s.id,s.created_at,s.order_id,o.receipt_number,o.created_at sale_at,s.order_line_id,s.product_id,l.sku_snapshot,l.name_snapshot,
        s.operator_id,s.operator_name_snapshot,s.quantity::text quantity,s.resolved_quantity::text resolved_quantity,s.requested_quantity::text requested_quantity,
        s.recorded_quantity_before::text recorded_quantity_before,s.recorded_cogs_minor::text recorded_cogs_minor,s.provisional_cogs_minor::text provisional_cogs_minor,
        s.reason_code,s.reason_note,s.version::text version,CASE WHEN $4::boolean THEN (s.provisional_cogs_minor-COALESCE((SELECT sum(r.provisional_cogs_released_minor) FROM inventory.sale_shortfall_resolutions r WHERE r.tenant_id=s.tenant_id AND r.outlet_id=s.outlet_id AND r.shortfall_id=s.id),0))::text END unresolved_cogs_minor,
        b.quantity::text current_stock,b.version::text balance_version
      FROM inventory.sale_shortfalls s JOIN commerce.orders o ON o.tenant_id=s.tenant_id AND o.outlet_id=s.outlet_id AND o.id=s.order_id
      JOIN commerce.order_lines l ON l.tenant_id=s.tenant_id AND l.outlet_id=s.outlet_id AND l.id=s.order_line_id
      JOIN inventory.balances b ON b.tenant_id=s.tenant_id AND b.outlet_id=s.outlet_id AND b.product_id=s.product_id
      WHERE s.id=$1 AND s.tenant_id=$2 AND s.outlet_id=$3`, [shortfallId, session.tenantId, session.outletId, canReadCosts]);
    if (!result.rowCount) throw new DomainError('NOT_FOUND', 'Stock exception was not found at this outlet.', 404);
    const history = await client.query(`SELECT r.id,r.created_at,r.resolved_by_name_snapshot,r.quantity::text quantity,r.provisional_cogs_released_minor::text provisional_cogs_released_minor,
        r.actual_cogs_minor::text actual_cogs_minor,r.cogs_adjustment_minor::text cogs_adjustment_minor,r.resolution_type,r.supporting_movement_id,
        r.supporting_document_reference,r.reason,m.movement_type,m.document_reference
      FROM inventory.sale_shortfall_resolutions r JOIN inventory.movements m ON m.tenant_id=r.tenant_id AND m.outlet_id=r.outlet_id AND m.id=r.supporting_movement_id
      WHERE r.tenant_id=$1 AND r.outlet_id=$2 AND r.shortfall_id=$3 ORDER BY r.created_at,r.id`, [session.tenantId, session.outletId, shortfallId]);
    const row = result.rows[0];
    return { ...row, resolutions: history.rows };
  });
  const q = decimalMicros(found.quantity);
  const resolved = decimalMicros(found.resolved_quantity);
  const costsAllowed = canReadCosts;
  return { exception: { id: found.id, createdAt: found.created_at, sale: { orderId: found.order_id, receiptNumber: found.receipt_number, soldAt: found.sale_at },
    product: { id: found.product_id, sku: found.sku_snapshot, name: found.name_snapshot }, operator: { id: found.operator_id, name: found.operator_name_snapshot },
    recordedQuantityBefore: found.recorded_quantity_before, requestedQuantity: found.requested_quantity, quantity: found.quantity,
    resolvedQuantity: found.resolved_quantity, remainingQuantity: decimalText(q - resolved), currentStock: found.current_stock,
    reasonCode: found.reason_code, reasonNote: found.reason_note, status: status(found.quantity, found.resolved_quantity), version: Number(found.version), balanceVersion: Number(found.balance_version),
    ...(costsAllowed ? { recordedCogsMinor: found.recorded_cogs_minor, provisionalCogsMinor: found.provisional_cogs_minor, unresolvedCogsMinor: found.unresolved_cogs_minor } : {}),
    resolutions: found.resolutions.map((item: Record<string, unknown>) => ({ id: item.id, createdAt: item.created_at, resolvedBy: item.resolved_by_name_snapshot,
      quantity: item.quantity, resolutionType: item.resolution_type, supportingMovementId: item.supporting_movement_id, supportingMovementType: item.movement_type,
      supportingDocumentReference: item.supporting_document_reference ?? item.document_reference, reason: item.reason,
      ...(costsAllowed ? { provisionalCogsReleasedMinor: item.provisional_cogs_released_minor, actualCogsMinor: item.actual_cogs_minor, cogsAdjustmentMinor: item.cogs_adjustment_minor } : {}) })) } };
}

export async function getStockShortfallEvidence(session: ApiSession, shortfallId: string, query: HistoryQuery = {}) {
  permission(session, 'inventory.shortfall.resolve');
  if (!uuid.test(shortfallId)) throw new DomainError('VALIDATION_FAILED', 'Choose a valid stock exception.');
  return inReadSnapshot(async client => {
    const found = await client.query<{ product_id: string }>(
      'SELECT product_id FROM inventory.sale_shortfalls WHERE id=$1 AND tenant_id=$2 AND outlet_id=$3',
      [shortfallId, session.tenantId, session.outletId]);
    if (!found.rowCount) throw new DomainError('NOT_FOUND', 'Stock exception was not found at this outlet.', 404);
    const rows = await readHistoryPage(client,session,'shortfall.evidence:'+shortfallId,query,`SELECT m.id,m.created_at sort_at,m.created_at,m.movement_type,m.quantity_delta::text quantity,m.document_reference,
        concat_ws(' ',m.document_reference,m.movement_type,m.id::text) search_text,
        (m.quantity_delta-COALESCE(sum(r.quantity),0))::text available_quantity
      FROM inventory.movements m LEFT JOIN inventory.sale_shortfall_resolutions r
        ON r.tenant_id=m.tenant_id AND r.outlet_id=m.outlet_id AND r.supporting_movement_id=m.id
      WHERE m.tenant_id=$1 AND m.outlet_id=$2 AND m.product_id=$3 AND m.movement_type IN ('RECEIPT','COUNT_ADJUSTMENT') AND m.quantity_delta>0
      GROUP BY m.id HAVING m.quantity_delta>COALESCE(sum(r.quantity),0)`, [session.tenantId, session.outletId, found.rows[0].product_id],100);
    return { page:rows.page,evidence: rows.rows.map(row => ({ id: row.id, createdAt: row.created_at, type: row.movement_type,
      quantity: row.quantity, availableQuantity: row.available_quantity, documentReference: row.document_reference })) };
  });
}

export async function getStockExceptionReport(session: ApiSession, query: Record<string, unknown>) {
  permission(session, 'inventory.shortfall.view');
  const from = date(query.from, 'from'), to = date(query.to, 'to');
  if (!from || !to || from > to) throw new DomainError('VALIDATION_FAILED', 'Choose a valid reporting date range.');
  const canReadCosts = ROLE_PERMISSIONS[session.role].includes('finance.view');
  return inReadSnapshot(async client => {
    const totals = await client.query(`SELECT count(*)::text event_count,COALESCE(sum(s.quantity),0)::text quantity,
        count(DISTINCT s.order_id)::text sale_count,count(DISTINCT s.product_id)::text product_count,
        COALESCE(sum(s.quantity-s.resolved_quantity),0)::text unresolved_quantity,
        min(s.created_at) FILTER(WHERE s.resolved_quantity<s.quantity) oldest_open_at,
        COALESCE(sum(s.provisional_cogs_minor-COALESCE(r.released,0)),0)::text unresolved_cogs_minor
      FROM inventory.sale_shortfalls s LEFT JOIN LATERAL (SELECT sum(x.provisional_cogs_released_minor) released FROM inventory.sale_shortfall_resolutions x WHERE x.tenant_id=s.tenant_id AND x.outlet_id=s.outlet_id AND x.shortfall_id=s.id) r ON true
      WHERE s.tenant_id=$1 AND s.outlet_id=$2 AND (s.created_at AT TIME ZONE $5)::date BETWEEN $3::date AND $4::date`, [session.tenantId, session.outletId, from, to, session.timeZone]);
    const open = await client.query(`SELECT COALESCE(sum(s.quantity-s.resolved_quantity),0)::text quantity,
        COALESCE(sum(s.provisional_cogs_minor-COALESCE(r.released,0)),0)::text cogs,
        min(s.created_at) oldest_open_at FROM inventory.sale_shortfalls s
      LEFT JOIN LATERAL (SELECT sum(x.provisional_cogs_released_minor) released FROM inventory.sale_shortfall_resolutions x WHERE x.tenant_id=s.tenant_id AND x.outlet_id=s.outlet_id AND x.shortfall_id=s.id) r ON true
      WHERE s.tenant_id=$1 AND s.outlet_id=$2 AND s.resolved_quantity<s.quantity`, [session.tenantId, session.outletId]);
    const resolutions = await client.query(`SELECT count(*)::text count,COALESCE(sum(quantity),0)::text quantity,
        COALESCE(sum(actual_cogs_minor),0)::text actual_cogs_minor,COALESCE(sum(cogs_adjustment_minor),0)::text cogs_adjustment_minor
      FROM inventory.sale_shortfall_resolutions WHERE tenant_id=$1 AND outlet_id=$2 AND (created_at AT TIME ZONE $5)::date BETWEEN $3::date AND $4::date`, [session.tenantId, session.outletId, from, to, session.timeZone]);
    const operators = await client.query(`SELECT operator_id,operator_name_snapshot operator_name,count(*)::text event_count,count(*) OVER()::text total_groups,
        COALESCE(sum(quantity),0)::text quantity FROM inventory.sale_shortfalls WHERE tenant_id=$1 AND outlet_id=$2
        AND (created_at AT TIME ZONE $5)::date BETWEEN $3::date AND $4::date GROUP BY operator_id,operator_name_snapshot ORDER BY count(*) DESC,operator_name_snapshot LIMIT 100`, [session.tenantId, session.outletId, from, to, session.timeZone]);
    const products = await client.query(`SELECT s.product_id,l.sku_snapshot sku,l.name_snapshot name,count(*)::text event_count,count(*) OVER()::text total_groups,
        COALESCE(sum(s.quantity),0)::text quantity FROM inventory.sale_shortfalls s JOIN commerce.order_lines l ON l.tenant_id=s.tenant_id AND l.outlet_id=s.outlet_id AND l.id=s.order_line_id
        WHERE s.tenant_id=$1 AND s.outlet_id=$2 AND (s.created_at AT TIME ZONE $5)::date BETWEEN $3::date AND $4::date
        GROUP BY s.product_id,l.sku_snapshot,l.name_snapshot ORDER BY count(*) DESC,l.name_snapshot LIMIT 100`, [session.tenantId, session.outletId, from, to, session.timeZone]);
    const summary = totals.rows[0], current = open.rows[0], resolved = resolutions.rows[0];
    return { scope: 'OUTLET', outletId: session.outletId, outletName: session.outletName, currency: session.currency, timeZone: session.timeZone,
      from, to, generatedAt: new Date().toISOString(), totals: { createdEvents: summary.event_count, createdQuantity: summary.quantity,
        affectedSales: summary.sale_count, affectedProducts: summary.product_count, unresolvedQuantityNow: current.quantity,
        oldestOpenAt: current.oldest_open_at, resolutionsInPeriod: resolved.count, resolvedQuantityInPeriod: resolved.quantity,
        ...(canReadCosts ? { estimatedUnresolvedCogsMinor: current.cogs, unresolvedCogsMinor: current.cogs,
          unresolvedCogsFromSelectedCreationPeriodMinor: summary.unresolved_cogs_minor, actualCogsResolvedInPeriodMinor: resolved.actual_cogs_minor,
          cogsAdjustmentInPeriodMinor: resolved.cogs_adjustment_minor } : {}) },
      byOperator: operators.rows.map(row => ({ operatorId: row.operator_id, operatorName: row.operator_name, eventCount: row.event_count, quantity: row.quantity })),
      byProduct: products.rows.map(row => ({ productId: row.product_id, sku: row.sku, name: row.name, eventCount: row.event_count, quantity: row.quantity })),
      coverage: { completeTotals: true, costVisible: canReadCosts,
        operatorGroups:Number(operators.rows[0]?.total_groups??0),productGroups:Number(products.rows[0]?.total_groups??0),summaryLimit:100,
        policy: 'Unresolved quantity is current across all creation dates. Created and resolved totals use the selected business dates. Operator and product summaries show at most the top 100 groups; totals cover every matching event.' } };
  });
}

export async function getStockShortfallsCsv(session: ApiSession, query: Record<string, unknown>) {
  if (query.after !== undefined) throw new DomainError('VALIDATION_FAILED', 'Export the complete selected stock exception report without a page reference.');
  const report = await listRows(session, query, true);
  const columns = ['createdAt','receiptNumber','sku','productName','quantity','resolvedQuantity','remainingQuantity','operatorName','reasonCode','reasonNote','status','recordedCogsMinor','provisionalCogsMinor','unresolvedCogsMinor'];
  const header = ['Date','Receipt','SKU','Product','Quantity','Resolved','Outstanding','Cashier','Reason','Note','Status','Recorded cost','Estimated cost','Estimated outstanding cost'];
  const lines = [header.map(csvExportCell).join(',')];
  for (const item of report.items) lines.push(columns.map(column => csvExportCell((item as Record<string, unknown>)[column])).join(','));
  const csv = '\uFEFF' + lines.join('\r\n') + '\r\n';
  if (Buffer.byteLength(csv, 'utf8') > 5 * 1024 * 1024) throw new DomainError('EXPORT_TOO_LARGE', 'This export exceeds 5 MiB. Choose a shorter date range; no partial file was produced.', 413);
  await pool.query(`INSERT INTO system.audit_events(id,tenant_id,outlet_id,actor_id,event_type,payload) VALUES($1,$2,$3,$4,'REPORT_STOCK_EXCEPTIONS_EXPORTED',$5::jsonb)`,
    [randomUUID(), session.tenantId, session.outletId, session.userId, JSON.stringify({ from: report.parsed.from, to: report.parsed.to, asOf: report.asOf, rows: report.totalPageCount })]);
  return csv;
}
