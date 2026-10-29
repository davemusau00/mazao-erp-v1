import type { CatalogItemKind } from './catalog.js';

export type CountEvidenceCoverage = 'COMPLETE' | 'LEGACY_CHECKPOINT';
export interface CountMovementPage {
  coverage: 'SINCE_BASELINE' | 'FULL_LEGACY_HISTORY';
  lowerExclusive: string;
  upperInclusive: string;
  totalCount: number;
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
}
export interface CountReviewMovement {
  id: string;
  sequence: string;
  timestamp: string;
  type: string;
  quantity: string;
  unitCostMinor?: string;
  valueMinor?: string;
  commandId: string;
  referenceId: string | null;
  documentReference: string | null;
}
export interface CountReviewPrevious {
  expectedQuantity: string | null;
  expectedBalanceVersion: number | null;
  baselineRevision: number | null;
  reviewedProductVersion: number | null;
  referenceCostMinor?: string;
  inventoryValueMinor?: string;
  countedQuantity: string | null;
  varianceReason: string | null;
  countedBy: string | null;
  countedAt: string | null;
  countedRevision: number | null;
}
export interface CountReviewLine {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  newItem: boolean;
  reviewable: boolean;
  changeReasons: string[];
  previous: CountReviewPrevious;
  current: {
    quantity: string | null;
    balanceVersion: number | null;
    productVersion: number;
    itemKind: CatalogItemKind;
    active: boolean;
    movementThrough: string;
    referenceCostMinor?: string;
    inventoryValueMinor?: string;
  };
  movements: CountReviewMovement[];
  movementPage: CountMovementPage;
}
export interface CountReview {
  countId: string;
  status: 'OPEN' | 'POSTED' | 'CANCELLED';
  countVersion: number;
  revision: number;
  fingerprint: string;
  coverage: CountEvidenceCoverage;
  canReview: boolean;
  blockers: string[];
  unchangedLineCount: number;
  changedLines: CountReviewLine[];
}

export interface CountLineEvidence {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  expectedQuantity: string | null;
  expectedBalanceVersion: number;
  baselineRevision: number;
  reviewedProductVersion: number | null;
  referenceCostMinor?: string;
  inventoryValueMinor?: string;
  countedQuantity: string | null;
  varianceReason: string | null;
  countedBy: string | null;
  countedAt: string | null;
  countedRevision: number | null;
  movementAfter: string | null;
  requiresRecount: boolean;
}
export interface CountEvidenceEvent {
  id: string;
  eventType: 'LEGACY_CHECKPOINT' | 'OPENED' | 'SAVED' | 'REVIEWED' | 'POSTED' | 'CANCELLED';
  countVersion: number;
  revision: number;
  status: 'OPEN' | 'POSTED' | 'CANCELLED';
  actorId: string | null;
  actorName: string;
  reason: string | null;
  createdAt: string;
  commandId: string | null;
  lineCount: number;
}
export interface CountEvidenceDetail {
  event: CountEvidenceEvent;
  lines: Array<{productId: string; before: CountLineEvidence | null; after: CountLineEvidence}>;
}
