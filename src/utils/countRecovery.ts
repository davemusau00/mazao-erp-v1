import type { CountEvidenceEvent, CountLineEvidence, CountMovementPage, CountReview, CountReviewMovement } from '../types/countRecovery.js';
import type { HistoryPage } from '../types/history.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const version = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const decimal = (value: unknown) => typeof value === 'string' && /^\d+(?:\.\d{1,6})?$/.test(value);
const ordinal = (value: unknown): value is string => typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value);
const nullable = (value: unknown, check: (item: unknown) => boolean) => value === null || check(value);
const text = (value: unknown) => typeof value === 'string';
const money = (value: unknown) => value === undefined || typeof value === 'string' && /^\d+$/.test(value);

export function isCountMovementPage(value: unknown): value is CountMovementPage {
  return record(value) && ['SINCE_BASELINE', 'FULL_LEGACY_HISTORY'].includes(String(value.coverage))
    && ordinal(value.lowerExclusive) && ordinal(value.upperInclusive) && BigInt(value.lowerExclusive) <= BigInt(value.upperInclusive)
    && count(value.totalCount) && version(value.limit) && value.limit <= 250
    && typeof value.hasMore === 'boolean' && nullable(value.nextCursor, text)
    && (value.hasMore ? typeof value.nextCursor === 'string' && value.nextCursor.length > 0 : value.nextCursor === null);
}

export function isCountReviewMovement(value: unknown): value is CountReviewMovement {
  return record(value) && typeof value.id === 'string' && uuid.test(value.id) && ordinal(value.sequence) && value.sequence !== '0'
    && typeof value.timestamp === 'string' && Number.isFinite(Date.parse(value.timestamp)) && typeof value.type === 'string' && value.type.length > 0
    && typeof value.quantity === 'string' && /^-?\d+(?:\.\d{1,6})?$/.test(value.quantity)
    && money(value.unitCostMinor) && money(value.valueMinor) && typeof value.commandId === 'string' && uuid.test(value.commandId)
    && nullable(value.referenceId, item => typeof item === 'string' && uuid.test(item)) && nullable(value.documentReference, text);
}

export function isCountReview(value: unknown, countId: string): value is CountReview {
  if (!record(value) || value.countId !== countId || !['OPEN', 'POSTED', 'CANCELLED'].includes(String(value.status))
    || !version(value.countVersion) || !version(value.revision) || typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint)
    || !['COMPLETE', 'LEGACY_CHECKPOINT'].includes(String(value.coverage)) || typeof value.canReview !== 'boolean'
    || !Array.isArray(value.blockers) || !value.blockers.every(text) || !count(value.unchangedLineCount) || !Array.isArray(value.changedLines)) return false;
  const ids = new Set<string>();
  for (const line of value.changedLines) {
    if (!record(line) || typeof line.productId !== 'string' || !uuid.test(line.productId) || ids.has(line.productId.toLowerCase())
      || !text(line.sku) || !text(line.name) || !text(line.unit) || typeof line.newItem !== 'boolean' || typeof line.reviewable !== 'boolean'
      || !Array.isArray(line.changeReasons) || !line.changeReasons.every(text) || !record(line.previous) || !record(line.current)
      || !isCountMovementPage(line.movementPage) || !Array.isArray(line.movements) || !line.movements.every(isCountReviewMovement)) return false;
    ids.add(line.productId.toLowerCase());
    const before = line.previous, current = line.current, page = line.movementPage;
    if (!nullable(before.expectedQuantity, decimal) || !nullable(before.expectedBalanceVersion, version) || !nullable(before.baselineRevision, version)
      || !nullable(before.reviewedProductVersion, version) || !money(before.referenceCostMinor) || !money(before.inventoryValueMinor)
      || !nullable(before.countedQuantity, decimal) || !nullable(before.varianceReason, text) || !nullable(before.countedBy, text)
      || !nullable(before.countedAt, text) || !nullable(before.countedRevision, version)
      || !nullable(current.quantity, decimal) || !nullable(current.balanceVersion, version) || !version(current.productVersion)
      || !['STOCKED_GOOD', 'SERVICE', 'PREPARED'].includes(String(current.itemKind)) || typeof current.active !== 'boolean'
      || !ordinal(current.movementThrough) || current.movementThrough !== page.upperInclusive
      || !money(current.referenceCostMinor) || !money(current.inventoryValueMinor)
      || line.movements.length > page.limit || line.movements.length > page.totalCount
      || line.movements.some(movement => BigInt(movement.sequence) <= BigInt(page.lowerExclusive) || BigInt(movement.sequence) > BigInt(page.upperInclusive))) return false;
  }
  return !value.canReview || value.status === 'OPEN' && value.changedLines.length > 0 && value.blockers.length === 0
    && value.changedLines.every(line => line.reviewable && line.current.active && line.current.itemKind === 'STOCKED_GOOD' && line.current.quantity !== null && version(line.current.balanceVersion));
}

export function isCountEventPage(value: unknown): value is HistoryPage {
  return record(value) && typeof value.asOf==='string' && Number.isFinite(Date.parse(value.asOf)) && count(value.totalCount)
    && version(value.limit) && value.limit<=250 && typeof value.hasMore==='boolean' && nullable(value.nextCursor,text)
    && (value.hasMore?typeof value.nextCursor==='string'&&value.nextCursor.length>0:value.nextCursor===null);
}

export function isCountEvidenceEvent(value: unknown): value is CountEvidenceEvent {
  return record(value) && typeof value.id === 'string' && uuid.test(value.id)
    && ['LEGACY_CHECKPOINT','OPENED','SAVED','REVIEWED','POSTED','CANCELLED'].includes(String(value.eventType))
    && version(value.countVersion) && version(value.revision) && ['OPEN','POSTED','CANCELLED'].includes(String(value.status))
    && nullable(value.actorId,item=>typeof item==='string'&&uuid.test(item)) && text(value.actorName) && nullable(value.reason,text)
    && typeof value.createdAt==='string' && Number.isFinite(Date.parse(value.createdAt))
    && nullable(value.commandId,item=>typeof item==='string'&&uuid.test(item)) && count(value.lineCount);
}

export function isCountLineEvidence(value: unknown): value is CountLineEvidence {
  return record(value) && typeof value.productId==='string' && uuid.test(value.productId) && text(value.sku) && text(value.name) && text(value.unit)
    && nullable(value.expectedQuantity,decimal) && version(value.expectedBalanceVersion) && version(value.baselineRevision)
    && nullable(value.reviewedProductVersion,version) && money(value.referenceCostMinor) && money(value.inventoryValueMinor)
    && nullable(value.countedQuantity,decimal) && nullable(value.varianceReason,text) && nullable(value.countedBy,text)
    && nullable(value.countedAt,text) && nullable(value.countedRevision,version) && nullable(value.movementAfter,ordinal)
    && typeof value.requiresRecount==='boolean';
}
