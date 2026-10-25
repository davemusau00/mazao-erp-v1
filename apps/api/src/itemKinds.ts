import { DomainError, type ApiSession } from './contracts.js';

export const ITEM_KINDS = ['STOCKED_GOOD', 'SERVICE', 'PREPARED'] as const;
export type ItemKind = typeof ITEM_KINDS[number];

/** Omitted kinds preserve earlier clients' stocked-good semantics. */
export function normalizeItemKind(value: unknown): ItemKind {
  if (value === undefined) return 'STOCKED_GOOD';
  if (typeof value !== 'string' || !(ITEM_KINDS as readonly string[]).includes(value)) {
    throw new DomainError('VALIDATION_FAILED', 'Choose a stocked good, service or prepared item explicitly.');
  }
  return value as ItemKind;
}

export function isStockTracked(kind: ItemKind): boolean { return kind === 'STOCKED_GOOD'; }

export function requireItemKindCapability(session: ApiSession, kind: ItemKind): void {
  const capability = isStockTracked(kind) ? 'inventory' : 'commerce';
  if (!session.capabilities.includes(capability)) {
    throw new DomainError('CAPABILITY_DISABLED', `${capability === 'inventory' ? 'Inventory' : 'Commerce'} is required for this item type.`, 403);
  }
}

export function requireCatalogCapability(session: ApiSession): void {
  if (!session.capabilities.some(capability => capability === 'commerce' || capability === 'inventory')) {
    throw new DomainError('CAPABILITY_DISABLED', 'Enable commerce or inventory before managing items.', 403);
  }
}
