export type CatalogItemKind = 'STOCKED_GOOD' | 'SERVICE' | 'PREPARED';

/** Legacy rows and saved receipt fixtures predate explicit item kinds. */
export function catalogItemKind(item: { itemKind?: CatalogItemKind }): CatalogItemKind {
  return item.itemKind ?? 'STOCKED_GOOD';
}
export function isStockTracked(item: { itemKind?: CatalogItemKind; stockTracked?: boolean }): boolean {
  return item.itemKind ? item.itemKind === 'STOCKED_GOOD' : item.stockTracked !== false;
}
export function catalogItemKindLabel(kind: CatalogItemKind): string {
  return kind === 'SERVICE' ? 'Service' : kind === 'PREPARED' ? 'Prepared item' : 'Stocked good';
}
