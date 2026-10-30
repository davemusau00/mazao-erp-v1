import { createHmac, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DomainError, ROLE_PERMISSIONS, type ApiSession, type CommandEnvelope } from './contracts.js';
import { inReadSnapshot } from './db.js';
import { lockCatalogOutlet } from './catalogMaintenance.js';
import { safeEqual, stableStringify } from './security.js';
import { readHistoryPage, type HistoryQuery } from './historyPagination.js';
import type { CountEvidenceEvent, CountLineEvidence, CountMovementPage, CountReview, CountReviewLine, CountReviewMovement } from '../../../src/types/countRecovery.js';

export const COUNT_CAPACITY = 5000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ordinal = /^(?:0|[1-9]\d{0,18})$/;
type Row = Record<string, any>;
export interface CountState { header: Row; lines: Row[]; products: Map<string, Row>; balances: Map<string, Row>; movements: Map<string, string> }
function id(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) throw new DomainError('VALIDATION_FAILED', 'Choose a valid stock count or item.');
  return value.toLowerCase();
}
function safeVersion(value: unknown): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new DomainError('INVENTORY_STATE_INVALID', 'A stock version is outside the supported range. Contact an administrator.', 409);
  return result;
}
function decimal(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
}
const time = (value: unknown) => value instanceof Date ? value.toISOString() : value === null || value === undefined ? null : String(value);
export function requireCountRead(session: ApiSession) {
  if (!session.capabilities.includes('inventory')) throw new DomainError('CAPABILITY_DISABLED', 'Inventory is not enabled.', 403);
  if (!ROLE_PERMISSIONS[session.role].some(permission => permission === 'inventory.count' || permission === 'inventory.count.approve')) throw new DomainError('FORBIDDEN', 'Your role cannot access stock counts.', 403);
}
function canReadCost(session: ApiSession) { return ROLE_PERMISSIONS[session.role].some(permission => permission === 'catalog.manage' || permission === 'finance.view'); }
function canApproveCount(session: ApiSession) { return ROLE_PERMISSIONS[session.role].includes('inventory.count.approve'); }
function assertBlindReviewAccess(session: ApiSession, header: Row) {
  if (header.blind_count && !canApproveCount(session)) throw new DomainError('FORBIDDEN', 'A count approver must review the baseline for a blind count.', 403);
}
function expected(envelope: CommandEnvelope, key: string, actual: unknown) {
  if (envelope.expectedVersions[key] !== safeVersion(actual)) throw new DomainError('VERSION_CONFLICT', 'The reviewed count or stock changed. Refresh the changed-item review before continuing.', 409, { key, currentVersion: safeVersion(actual) });
}

/** Call after exclusive outlet admission for writes. Product locks always precede balances. */
export async function loadCountState(client: PoolClient, session: ApiSession, countId: string, lock = false): Promise<CountState> {
  const header = await client.query(`SELECT c.*,opened.full_name opened_by_name,posted.full_name posted_by_name FROM inventory.stock_counts c
    JOIN identity.users opened ON opened.id=c.opened_by LEFT JOIN identity.users posted ON posted.id=c.posted_by
    WHERE c.tenant_id=$1 AND c.outlet_id=$2 AND c.id=$3${lock ? ' FOR UPDATE OF c' : ''}`, [session.tenantId, session.outletId, id(countId)]);
  if (!header.rowCount) throw new DomainError('NOT_FOUND', 'Stock count was not found at this outlet.', 404);
  const h = header.rows[0];
  const lines = await client.query(`SELECT l.*,to_jsonb(l)::text snapshot FROM inventory.stock_count_lines l WHERE tenant_id=$1 AND outlet_id=$2 AND count_id=$3 ORDER BY product_id`, [session.tenantId, session.outletId, h.id]);
  const products = await client.query(`SELECT p.* FROM catalog.products p WHERE p.tenant_id=$1 AND p.outlet_id=$2
    AND (($4::boolean AND p.active AND p.item_kind='STOCKED_GOOD') OR EXISTS(SELECT 1 FROM inventory.stock_count_lines l WHERE l.tenant_id=p.tenant_id AND l.outlet_id=p.outlet_id AND l.count_id=$3 AND l.product_id=p.id))
    ORDER BY p.id${lock ? ' FOR UPDATE OF p' : ''}`, [session.tenantId, session.outletId, h.id, h.status === 'OPEN']);
  const ids = products.rows.map(row => row.id);
  const balances = await client.query(`SELECT * FROM inventory.balances WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=ANY($3::uuid[]) ORDER BY product_id${lock ? ' FOR UPDATE' : ''}`, [session.tenantId, session.outletId, ids]);
  const movements = await client.query(`SELECT product_id,max(movement_seq)::text through FROM inventory.movements WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=ANY($3::uuid[]) GROUP BY product_id`, [session.tenantId, session.outletId, ids]);
  return { header: h, lines: lines.rows, products: new Map(products.rows.map(row => [row.id, row])), balances: new Map(balances.rows.map(row => [row.product_id, row])), movements: new Map(movements.rows.map(row => [row.product_id, row.through])) };
}
export function countBefore(state: CountState, productIds?: readonly string[]) {
  const selected = productIds ? new Set(productIds) : null;
  return new Map(state.lines.filter(line => !selected || selected.has(line.product_id)).map(line => [line.product_id, String(line.snapshot)]));
}
export async function appendCountEvent(client: PoolClient, session: ApiSession, envelope: CommandEnvelope | null, countId: string,
  eventType: CountEvidenceEvent['eventType'], version: number, revision: number, status: string, before: Map<string, string>, productIds: readonly string[], reason: string | null = null) {
  const eventId = randomUUID();
  await client.query(`INSERT INTO inventory.stock_count_events(id,tenant_id,outlet_id,count_id,count_version,revision,count_status,event_type,command_id,actor_id,actor_name_snapshot,reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [eventId, session.tenantId, session.outletId, countId, version, revision, status, eventType, envelope?.commandId ?? null, envelope ? session.userId : null, envelope ? session.fullName : 'Legacy checkpoint after migration 026', reason]);
  // Before snapshots remain JSON text across JS so decimal/bigint values never round.
  await client.query(`INSERT INTO inventory.stock_count_line_events(tenant_id,outlet_id,count_id,event_id,product_id,before_state,after_state)
    SELECT l.tenant_id,l.outlet_id,l.count_id,$4,l.product_id,CASE WHEN $6::jsonb ? l.product_id::text THEN ($6::jsonb->>l.product_id::text)::jsonb ELSE NULL END,to_jsonb(l)
    FROM inventory.stock_count_lines l WHERE l.tenant_id=$1 AND l.outlet_id=$2 AND l.count_id=$3 AND l.product_id=ANY($5::uuid[])`, [session.tenantId, session.outletId, countId, eventId, productIds, JSON.stringify(Object.fromEntries(before))]);
  return eventId;
}
export async function ensureCountCheckpoint(client: PoolClient, session: ApiSession, state: CountState) {
  if (state.header.last_event_id) return;
  const eventId = await appendCountEvent(client, session, null, state.header.id, 'LEGACY_CHECKPOINT', safeVersion(state.header.version), state.header.baseline_revision, state.header.status, new Map(), state.lines.map(line => line.product_id));
  await client.query('UPDATE inventory.stock_counts SET last_event_id=$4 WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3', [session.tenantId, session.outletId, state.header.id, eventId]);
  state.header.last_event_id = eventId;
}

interface Changed { product: Row; line?: Row; balance?: Row; through: string; reasons: string[]; reviewable: boolean }
export function changedCountLines(state: CountState): Changed[] {
  const old = new Map(state.lines.map(line => [line.product_id, line]));
  const scopedProducts = state.header.count_mode === 'SELECTED'
    ? state.lines.flatMap(line => { const product = state.products.get(line.product_id); return product ? [product] : []; })
    : [...state.products.values()];
  return scopedProducts.flatMap(product => {
    const line = old.get(product.id), balance = state.balances.get(product.id), through = state.movements.get(product.id) ?? '0';
    const reasons: string[] = [];
    if (!line) reasons.push('NEW_ITEM');
    else {
      if (state.header.recovery_coverage === 'LEGACY_CHECKPOINT' || line.movement_after === null || line.reviewed_product_version === null || line.baseline_item_kind === null) reasons.push('LEGACY_CHECKPOINT');
      if (balance && (String(balance.version) !== String(line.baseline_balance_version) || decimal(balance.quantity) !== decimal(line.baseline_quantity) || String(balance.inventory_value_minor) !== String(line.baseline_inventory_value_minor))) reasons.push('BALANCE_CHANGED');
      if (line.movement_after !== null && BigInt(through) !== BigInt(line.movement_after)) reasons.push('MOVEMENTS_CHANGED');
      if (String(product.cost_price_minor) !== String(line.baseline_unit_cost_minor)) reasons.push('REFERENCE_COST_CHANGED');
      if (line.baseline_item_kind !== null && product.item_kind !== line.baseline_item_kind) reasons.push('ITEM_KIND_CHANGED');
    }
    if (!balance) reasons.push('BALANCE_MISSING');
    if (product.item_kind !== 'STOCKED_GOOD' && !reasons.includes('ITEM_KIND_CHANGED')) reasons.push('ITEM_KIND_CHANGED');
    if (!product.active) reasons.push('ITEM_INACTIVE');
    return reasons.length ? [{ product, line, balance, through, reasons, reviewable: !!balance && product.active && product.item_kind === 'STOCKED_GOOD' }] : [];
  });
}
export function countReviewFacts(state: CountState) {
  const changed = changedCountLines(state), blockers: string[] = [];
  if (state.header.status !== 'OPEN') blockers.push('COUNT_NOT_OPEN');
  if ((state.header.count_mode !== 'SELECTED' && state.products.size > COUNT_CAPACITY) || state.lines.length > COUNT_CAPACITY) blockers.push('COUNT_CAPACITY_EXCEEDED');
  if (changed.some(line => !line.reviewable)) blockers.push('INELIGIBLE_ITEMS');
  if (!changed.length) blockers.push('NO_CHANGED_ITEMS');
  const fingerprint = createHmac('sha256', Buffer.from(String(state.header.review_nonce).replaceAll('-', ''), 'hex')).update(stableStringify({ countId: state.header.id, version: String(state.header.version), revision: state.header.baseline_revision, coverage: state.header.recovery_coverage, scope: state.header.count_mode, blind: state.header.blind_count,
    changed: changed.map(({ product, line, balance, through, reasons }) => ({ productId: product.id, productVersion: String(product.version), kind: product.item_kind, active: product.active, cost: String(product.cost_price_minor), before: line?.snapshot ?? null, quantity: balance?.quantity ?? null, value: balance ? String(balance.inventory_value_minor) : null, balanceVersion: balance ? String(balance.version) : null, through, reasons })) })).digest('hex');
  return { changed, blockers, fingerprint };
}
export function assertCountPostable(state: CountState) {
  const facts = countReviewFacts(state);
  if (facts.changed.length || facts.blockers.includes('COUNT_CAPACITY_EXCEEDED')) throw new DomainError('COUNT_REVIEW_REQUIRED', 'Stock or count membership changed. Review the changed items, establish fresh baselines and physically recount affected items before posting.', 409,
    { countId: state.header.id, currentVersion: safeVersion(state.header.version), changedProductIds: facts.changed.map(line => line.product.id), blockers: facts.blockers });
  if (state.header.recovery_protocol !== 1 || state.header.recovery_coverage !== 'COMPLETE') throw new DomainError('COUNT_REVIEW_REQUIRED', 'Review this legacy count before posting its physical quantities.', 409);
  if (state.lines.some(line => line.requires_recount || line.counted_quantity === null || line.counted_revision !== line.baseline_revision)) throw new DomainError('COUNT_RECOUNT_REQUIRED', 'Physically recount and save every affected item under its reviewed baseline before posting.', 409,
    { productIds: state.lines.filter(line => line.requires_recount || line.counted_quantity === null || line.counted_revision !== line.baseline_revision).map(line => line.product_id) });
}

const scope = (session: ApiSession, header: Row, productId: string, revision: number, lineRevision: number | null, lower: string, upper: string, after: string) => createHmac('sha256', Buffer.from(String(header.review_nonce).replaceAll('-', ''), 'hex'))
  .update(JSON.stringify([session.tenantId, session.outletId, session.userId, 'count-movements', header.id, productId, revision, lineRevision, lower, upper, after, 1])).digest('hex');
function cursor(session: ApiSession, state: CountState, change: Changed, lower: string, upper: string, after: string) {
  const lineRevision = change.line?.baseline_revision ?? null;
  return Buffer.from(JSON.stringify([scope(session, state.header, change.product.id, state.header.baseline_revision, lineRevision, lower, upper, after), change.product.id, state.header.baseline_revision, lineRevision, lower, upper, after, 1])).toString('base64url');
}
function movement(row: Row, cost: boolean): CountReviewMovement {
  return { id: row.id, sequence: String(row.movement_seq), timestamp: time(row.created_at)!, type: row.movement_type, quantity: String(row.quantity_delta), commandId: row.command_id, referenceId: row.reference_id ?? null, documentReference: row.document_reference ?? null,
    ...(cost ? { unitCostMinor: String(row.unit_cost_minor), valueMinor: String(row.value_minor) } : {}) };
}
function movementPage(session: ApiSession, state: CountState, change: Changed, rows: Row[], total: number, limit = 10) {
  const lower = change.line?.movement_after === null || change.line?.movement_after === undefined ? '0' : String(change.line.movement_after), upper = change.through;
  const hasMore = rows.length > limit, chosen = rows.slice(0, limit);
  const page: CountMovementPage = { coverage: change.line?.movement_after === null || !change.line ? 'FULL_LEGACY_HISTORY' : 'SINCE_BASELINE', lowerExclusive: lower, upperInclusive: upper, totalCount: total, limit, hasMore,
    nextCursor: hasMore ? cursor(session, state, change, lower, upper, String(chosen.at(-1)!.movement_seq)) : null };
  return { movements: chosen.map(row => movement(row, canReadCost(session))), page };
}
async function initialMovements(client: PoolClient, session: ApiSession, state: CountState, changed: Changed[]) {
  if (!changed.length) return new Map<string, { movements: CountReviewMovement[]; page: CountMovementPage }>();
  const bounds = changed.map(change => ({ product_id: change.product.id, low: String(change.line?.movement_after ?? '0'), high: change.through }));
  const result = await client.query(`WITH bounds AS (SELECT * FROM jsonb_to_recordset($3::jsonb) AS b(product_id uuid,low bigint,high bigint)), numbered AS (
    SELECT m.*,count(*) OVER(PARTITION BY m.product_id)::text total,row_number() OVER(PARTITION BY m.product_id ORDER BY m.movement_seq) position
    FROM bounds b JOIN inventory.movements m ON m.tenant_id=$1 AND m.outlet_id=$2 AND m.product_id=b.product_id AND m.movement_seq>b.low AND m.movement_seq<=b.high)
    SELECT * FROM numbered WHERE position<=11 ORDER BY product_id,movement_seq`, [session.tenantId, session.outletId, JSON.stringify(bounds)]);
  const groups = new Map<string, Row[]>();
  for (const row of result.rows) groups.set(row.product_id, [...(groups.get(row.product_id) ?? []), row]);
  return new Map(changed.map(change => { const rows = groups.get(change.product.id) ?? []; return [change.product.id, movementPage(session, state, change, rows, rows.length ? Number(rows[0].total) : 0)]; }));
}
export async function getCountReview(session: ApiSession, countId: string) {
  requireCountRead(session);
  return inReadSnapshot(async client => {
    const state = await loadCountState(client, session, countId);
    assertBlindReviewAccess(session, state.header);
    const facts = countReviewFacts(state), cost = canReadCost(session);
    const pages = await initialMovements(client, session, state, facts.changed);
    const changedLines: CountReviewLine[] = facts.changed.map(change => {
      const { product, line, balance, through } = change, evidence = pages.get(product.id)!;
      return { productId: product.id, sku: line?.sku_snapshot ?? product.sku, name: line?.name_snapshot ?? product.name, unit: line?.base_unit_snapshot ?? product.base_unit, newItem: !line, reviewable: change.reviewable, changeReasons: change.reasons,
        previous: { expectedQuantity: line?.baseline_quantity ?? null, expectedBalanceVersion: line ? safeVersion(line.baseline_balance_version) : null, baselineRevision: line?.baseline_revision ?? null, reviewedProductVersion: line?.reviewed_product_version ? safeVersion(line.reviewed_product_version) : null,
          countedQuantity: line?.counted_quantity ?? null, varianceReason: line?.variance_reason ?? null, countedBy: line?.counted_by ?? null, countedAt: time(line?.counted_at), countedRevision: line?.counted_revision ?? null,
          ...(cost && line ? { referenceCostMinor: String(line.baseline_unit_cost_minor), inventoryValueMinor: String(line.baseline_inventory_value_minor) } : {}) },
        current: { quantity: balance?.quantity ?? null, balanceVersion: balance ? safeVersion(balance.version) : null, productVersion: safeVersion(product.version), itemKind: product.item_kind, active: product.active, movementThrough: through,
          ...(cost ? { referenceCostMinor: String(product.cost_price_minor), ...(balance ? { inventoryValueMinor: String(balance.inventory_value_minor) } : {}) } : {}) }, movements: evidence.movements, movementPage: evidence.page };
    });
    const review: CountReview = { countId: state.header.id, status: state.header.status, countVersion: safeVersion(state.header.version), revision: state.header.baseline_revision, fingerprint: facts.fingerprint, coverage: state.header.recovery_coverage,
      canReview: !facts.blockers.length && ROLE_PERMISSIONS[session.role].includes('inventory.count.approve'), blockers: facts.blockers, unchangedLineCount: state.lines.length - facts.changed.filter(line => !!line.line).length, changedLines };
    return { review };
  });
}

export async function getCountReviewMovements(session: ApiSession, countId: string, query: { after?: string } = {}) {
  requireCountRead(session); countId = id(countId);
  if (!query || Object.keys(query).some(key => key !== 'after') || typeof query.after !== 'string' || query.after.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(query.after)) throw new DomainError('VALIDATION_FAILED', 'Choose a valid movement continuation.');
  let values: any[];
  try {
    values = JSON.parse(Buffer.from(query.after, 'base64url').toString('utf8'));
    if (!Array.isArray(values) || values.length !== 8 || values[7] !== 1 || typeof values[0] !== 'string' || !/^[a-f0-9]{64}$/.test(values[0]) || !uuid.test(values[1]) || !Number.isSafeInteger(values[2]) || values[2] < 1 || values[3] !== null && (!Number.isSafeInteger(values[3]) || values[3] < 1) || values.slice(4, 7).some(value => typeof value !== 'string' || !ordinal.test(value) || BigInt(value) > 9_223_372_036_854_775_807n) || BigInt(values[4]) > BigInt(values[6]) || BigInt(values[6]) > BigInt(values[5])) throw new Error();
  } catch { throw new DomainError('VALIDATION_FAILED', 'Movement continuation is invalid. Refresh the changed-item review.'); }
  return inReadSnapshot(async client => {
    const state = await loadCountState(client, session, countId);
    assertBlindReviewAccess(session, state.header);
    const productId = id(values[1]), line = state.lines.find(row => row.product_id === productId), product = state.products.get(productId);
    const [lower, upper, after] = values.slice(4, 7) as string[];
    if (!safeEqual(scope(session, state.header, productId, values[2], values[3], lower, upper, after), values[0])) throw new DomainError('VALIDATION_FAILED', 'Movement continuation is invalid for this operator and review window.');
    if (!product || state.header.baseline_revision !== values[2] || (line?.baseline_revision ?? null) !== values[3] || String(line?.movement_after ?? '0') !== values[4]) throw new DomainError('VERSION_CONFLICT', 'This movement review belongs to an earlier baseline. Refresh the review.', 409);
    const total = await client.query('SELECT count(*)::text total FROM inventory.movements WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3 AND movement_seq>$4::bigint AND movement_seq<=$5::bigint', [session.tenantId, session.outletId, productId, lower, upper]);
    const rows = await client.query('SELECT * FROM inventory.movements WHERE tenant_id=$1 AND outlet_id=$2 AND product_id=$3 AND movement_seq>$4::bigint AND movement_seq<=$5::bigint ORDER BY movement_seq LIMIT 11', [session.tenantId, session.outletId, productId, after, upper]);
    const change: Changed = { product, line, balance: state.balances.get(productId), through: upper, reasons: [], reviewable: true };
    const result = movementPage(session, state, change, rows.rows, Number(total.rows[0].total));
    return { productId, movements: result.movements, page: result.page };
  });
}

export async function reviewStockCount(client: PoolClient, session: ApiSession, envelope: CommandEnvelope) {
  requireCountRead(session);
  if (!ROLE_PERMISSIONS[session.role].includes('inventory.count.approve')) throw new DomainError('FORBIDDEN', 'A count approver must review changed items.', 403);
  const countId = id(envelope.payload.countId), rawIds = envelope.payload.affectedProductIds;
  if (!Array.isArray(rawIds) || rawIds.length < 1 || rawIds.length > COUNT_CAPACITY || typeof envelope.payload.reason !== 'string' || !envelope.payload.reason.trim() || envelope.payload.reason.trim().length > 500 || /[\u0000-\u001f\u007f]/.test(envelope.payload.reason) || typeof envelope.payload.reviewFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.payload.reviewFingerprint)) throw new DomainError('VALIDATION_FAILED', 'Review every affected item with a reason and a current review reference.');
  const ids = rawIds.map(id).sort();
  if (new Set(ids).size !== ids.length) throw new DomainError('VALIDATION_FAILED', 'Each affected item must appear once, including UUID aliases.');
  await lockCatalogOutlet(client, session);
  const state = await loadCountState(client, session, countId, true), facts = countReviewFacts(state);
  expected(envelope, `count:${countId}`, state.header.version);
  if (facts.blockers.length) throw new DomainError('COUNT_REVIEW_BLOCKED', 'This count cannot establish a reviewed baseline. Resolve unavailable items or preserve the evidence and cancel the count.', 409, { blockers: facts.blockers });
  if (!safeEqual(facts.fingerprint, envelope.payload.reviewFingerprint) || stableStringify(ids) !== stableStringify(facts.changed.map(change => change.product.id).sort())) throw new DomainError('VERSION_CONFLICT', 'Changed items or stock differ from the review. Refresh before confirming.', 409, { changedProductIds: facts.changed.map(change => change.product.id) });
  for (const change of facts.changed) { expected(envelope, `product:${change.product.id}`, change.product.version); expected(envelope, `balance:${change.product.id}`, change.balance!.version); }
  const allowedKeys = new Set([`count:${countId}`, ...ids.flatMap(productId => [`product:${productId}`, `balance:${productId}`])]);
  if (Object.keys(envelope.expectedVersions).some(key => !allowedKeys.has(key))) throw new DomainError('VALIDATION_FAILED', 'Review versions must describe exactly the affected count and items.');
  await ensureCountCheckpoint(client, session, state);
  const revision = state.header.baseline_revision + 1, version = safeVersion(state.header.version) + 1;
  for (const { product, line, balance, through } of facts.changed) {
    if (!line) await client.query(`INSERT INTO inventory.stock_count_lines(tenant_id,outlet_id,count_id,product_id,sku_snapshot,name_snapshot,base_unit_snapshot,baseline_quantity,baseline_balance_version,baseline_unit_cost_minor,baseline_inventory_value_minor,baseline_revision,reviewed_product_version,baseline_item_kind,baseline_active,movement_after,requires_recount)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,true)`, [session.tenantId, session.outletId, countId, product.id, product.sku, product.name, product.base_unit, balance!.quantity, balance!.version, product.cost_price_minor, balance!.inventory_value_minor, revision, product.version, product.item_kind, product.active, through]);
    else await client.query(`UPDATE inventory.stock_count_lines SET baseline_quantity=$5,baseline_balance_version=$6,baseline_unit_cost_minor=$7,baseline_inventory_value_minor=$8,baseline_revision=$9,reviewed_product_version=$10,baseline_item_kind=$11,baseline_active=$12,movement_after=$13,counted_quantity=NULL,variance_reason=NULL,counted_by=NULL,counted_at=NULL,counted_revision=NULL,requires_recount=true
      WHERE tenant_id=$1 AND outlet_id=$2 AND count_id=$3 AND product_id=$4`, [session.tenantId, session.outletId, countId, product.id, balance!.quantity, balance!.version, product.cost_price_minor, balance!.inventory_value_minor, revision, product.version, product.item_kind, product.active, through]);
  }
  const reviewId = await appendCountEvent(client, session, envelope, countId, 'REVIEWED', version, revision, 'OPEN', countBefore(state, ids), ids, envelope.payload.reason.trim());
  await client.query(`UPDATE inventory.stock_counts SET version=$4,baseline_revision=$5,recovery_protocol=1,recovery_coverage='COMPLETE',last_event_id=$6,last_reviewed_at=clock_timestamp(),last_reviewed_by=$7 WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3`, [session.tenantId, session.outletId, countId, version, revision, reviewId, session.userId]);
  const result = { countId, version, reviewId, revision, affectedProductIds: ids };
  for (const table of ['system.audit_events', 'system.transactional_outbox']) {
    if (table === 'system.audit_events') await client.query(`INSERT INTO system.audit_events(id,tenant_id,outlet_id,actor_id,command_id,event_type,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`, [randomUUID(), session.tenantId, session.outletId, session.userId, envelope.commandId, envelope.type, JSON.stringify({ ...result, reason: envelope.payload.reason.trim(), reviewedFingerprint: facts.fingerprint })]);
    else await client.query('INSERT INTO system.transactional_outbox(id,tenant_id,command_id,event_type,payload) VALUES($1,$2,$3,$4,$5::jsonb)', [randomUUID(), session.tenantId, envelope.commandId, envelope.type, JSON.stringify(result)]);
  }
  return result;
}

function lineEvidence(raw: Row, cost: boolean, revealBaseline = true): CountLineEvidence {
  return { productId: raw.product_id, sku: raw.sku_snapshot, name: raw.name_snapshot, unit: raw.base_unit_snapshot, expectedQuantity: revealBaseline ? String(raw.baseline_quantity) : null, expectedBalanceVersion: safeVersion(raw.baseline_balance_version), baselineRevision: Number(raw.baseline_revision), reviewedProductVersion: raw.reviewed_product_version === null ? null : safeVersion(raw.reviewed_product_version), countedQuantity: raw.counted_quantity === null ? null : String(raw.counted_quantity), varianceReason: raw.variance_reason, countedBy: raw.counted_by, countedAt: time(raw.counted_at), countedRevision: raw.counted_revision === null ? null : Number(raw.counted_revision), movementAfter: raw.movement_after === null ? null : String(raw.movement_after), requiresRecount: raw.requires_recount === true || raw.requires_recount === 'true',
    ...(cost && revealBaseline ? { referenceCostMinor: String(raw.baseline_unit_cost_minor), inventoryValueMinor: String(raw.baseline_inventory_value_minor) } : {}) };
}
function event(row: Row): CountEvidenceEvent {
  return { id: row.id, eventType: row.event_type, countVersion: safeVersion(row.count_version), revision: row.revision, status: row.count_status, actorId: row.actor_id, actorName: row.actor_name_snapshot, reason: row.reason, createdAt: time(row.created_at)!, commandId: row.command_id, lineCount: Number(row.line_count) };
}
export async function getCount(session: ApiSession, countId?: string) {
  requireCountRead(session);
  return inReadSnapshot(async client => {
    if (countId === undefined) {
      const found = await client.query("SELECT id FROM inventory.stock_counts WHERE tenant_id=$1 AND outlet_id=$2 AND status='OPEN' ORDER BY opened_at DESC LIMIT 1", [session.tenantId, session.outletId]);
      if (!found.rowCount) return { count: null };
      countId = found.rows[0].id;
    }
    const state = await loadCountState(client, session, id(countId)), h = state.header;
    const revealBaseline = !h.blind_count || canApproveCount(session);
    return { count: { id: h.id, status: h.status, areaLabel: h.area_label, version: safeVersion(h.version), baselineAt: time(h.baseline_at), openedAt: time(h.opened_at), openedBy: h.opened_by_name, postedAt: time(h.posted_at), postedBy: h.posted_by_name,
      scope: h.count_mode, blind: h.blind_count,
      lineCount: state.lines.length, countedLineCount: state.lines.filter(line => line.counted_quantity !== null).length, revision: h.baseline_revision, coverage: h.recovery_coverage,
      lines: state.lines.sort((a, b) => a.sku_snapshot.localeCompare(b.sku_snapshot) || a.product_id.localeCompare(b.product_id)).map(line => ({ ...lineEvidence(line, canReadCost(session), revealBaseline), requiresRecount: line.requires_recount || h.recovery_coverage === 'LEGACY_CHECKPOINT' })) } };
  });
}
export async function getCountEvents(session: ApiSession, countId: string, query: HistoryQuery = {}) {
  requireCountRead(session); countId = id(countId);
  return inReadSnapshot(async client => {
    const exists = await client.query('SELECT id FROM inventory.stock_counts WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3', [session.tenantId, session.outletId, countId]);
    if (!exists.rowCount) throw new DomainError('NOT_FOUND', 'Stock count was not found.', 404);
    const result = await readHistoryPage(client, session, 'count.events:' + countId, query, `SELECT e.*,e.created_at sort_at,concat_ws(' ',e.event_type,e.actor_name_snapshot,e.reason) search_text,
      (SELECT count(*)::int FROM inventory.stock_count_line_events l WHERE l.tenant_id=e.tenant_id AND l.outlet_id=e.outlet_id AND l.count_id=e.count_id AND l.event_id=e.id) line_count
      FROM inventory.stock_count_events e WHERE e.tenant_id=$1 AND e.outlet_id=$2 AND e.count_id=$3`, [session.tenantId, session.outletId, countId], 25);
    return { events: result.rows.map(event), page: result.page };
  });
}
export async function getCountEvent(session: ApiSession, countId: string, eventId: string) {
  requireCountRead(session); countId = id(countId); eventId = id(eventId);
  return inReadSnapshot(async client => {
    const found = await client.query(`SELECT e.*,c.count_mode,c.blind_count,(SELECT count(*)::int FROM inventory.stock_count_line_events l WHERE l.tenant_id=e.tenant_id AND l.outlet_id=e.outlet_id AND l.count_id=e.count_id AND l.event_id=e.id) line_count FROM inventory.stock_count_events e JOIN inventory.stock_counts c ON c.tenant_id=e.tenant_id AND c.outlet_id=e.outlet_id AND c.id=e.count_id WHERE e.tenant_id=$1 AND e.outlet_id=$2 AND e.count_id=$3 AND e.id=$4`, [session.tenantId, session.outletId, countId, eventId]);
    if (!found.rowCount) throw new DomainError('NOT_FOUND', 'Count evidence was not found at this outlet.', 404);
    const revealBaseline = !found.rows[0].blind_count || canApproveCount(session);
    // jsonb_each_text transports every numeric field losslessly as a string.
    const lines = await client.query(`SELECT l.product_id,(SELECT jsonb_object_agg(key,value) FROM jsonb_each_text(l.before_state)) before_values,(SELECT jsonb_object_agg(key,value) FROM jsonb_each_text(l.after_state)) after_values FROM inventory.stock_count_line_events l WHERE tenant_id=$1 AND outlet_id=$2 AND count_id=$3 AND event_id=$4 ORDER BY product_id`, [session.tenantId, session.outletId, countId, eventId]);
    return { event: event(found.rows[0]), lines: lines.rows.map(line => ({ productId: line.product_id, before: line.before_values ? lineEvidence(line.before_values, canReadCost(session), revealBaseline) : null, after: lineEvidence(line.after_values, canReadCost(session), revealBaseline) })) };
  });
}
