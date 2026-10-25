import { DomainError } from './contracts.js';
import { isRecord } from './contractValidation.js';
import { normalizeItemKind, type ItemKind } from './itemKinds.js';

const controls = /[\u0000-\u001f\u007f]/;
const scientific = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)[eE][+-]?\d+$/;
const maxMinor = BigInt(Number.MAX_SAFE_INTEGER);
export interface CatalogProductDefaults { currency: string; taxRateBps: number }
export interface CatalogMetadata { category: string; barcode: string | null; reorderLevel: string }
export interface CatalogProductEdit extends CatalogMetadata {
  name: string; sellingPriceMinor: number; costPriceMinor: number; taxRateBps: number;
}
export interface CatalogProductCreate extends CatalogProductEdit { sku: string; baseUnit: string; currency: string; itemKind: ItemKind }

function fail(message: string): never { throw new DomainError('VALIDATION_FAILED', message); }
function text(value: unknown, field: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || controls.test(value)) fail(`${field} must be text without control characters.`);
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > max) fail(`${field} must contain ${allowEmpty ? '0' : '1'} to ${max} characters after trimming.`);
  return normalized;
}
function fields(payload: Record<string, unknown>, allowed: readonly string[], required: readonly string[]) {
  if (!isRecord(payload) || Object.keys(payload).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(payload, key))) {
    fail('Provide the complete supported product metadata without immutable or unsupported fields.');
  }
}

export function normalizeCatalogSku(value: unknown): string {
  const sku = text(value, 'SKU', 64);
  if (!/^[\w.-]{1,64}$/.test(sku) || scientific.test(sku)) fail('Use a SKU of 1 to 64 letters, digits, underscore, dot or hyphen; scientific notation is ambiguous.');
  return sku;
}
export function normalizeCatalogName(value: unknown): string { return text(value, 'Item name', 160); }
export function normalizeCatalogBaseUnit(value: unknown): string {
  const unit = text(value, 'Base unit', 24);
  if (!/^[\w.-]{1,24}$/.test(unit)) fail('Base unit must contain 1 to 24 letters, digits, underscore, dot or hyphen.');
  return unit;
}
export function normalizeCatalogCurrency(value: unknown, tenantCurrency: string): string {
  const currency = text(value, 'Currency', 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency) || currency !== tenantCurrency) fail('Product currency must match the tenant currency.');
  return currency;
}
export function normalizeCatalogMinor(value: unknown, field = 'Price'): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail(`${field} must be a non-negative safe integer in minor units.`);
  return value;
}
export function normalizeCatalogTaxRateBps(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 10_000) fail('taxRateBps must be from 0 through 10000.');
  return value;
}
export function normalizeCatalogQuantity(value: unknown): string {
  if (typeof value !== 'string' || controls.test(value)) fail('Use a non-negative base-unit decimal quantity with at most six decimal places.');
  const normalized = value.trim();
  if (!/^\d{1,14}(?:\.\d{1,6})?$/.test(normalized)) fail('Use a non-negative base-unit decimal quantity with at most six decimal places.');
  const [whole, fraction = ''] = normalized.split('.');
  const decimals = fraction.replace(/0+$/, '');
  return BigInt(whole).toString() + (decimals ? '.' + decimals : '');
}
export function normalizeCatalogCategoryName(value: unknown, allowEmpty = false): string { return text(value, 'Category', 80, allowEmpty); }
export function normalizeCatalogReason(value: unknown): string { return text(value, 'Reason', 500); }
export function normalizeCatalogBarcode(value: unknown): string | null {
  const barcode = value === null || value === undefined ? '' : text(value, 'Barcode', 64, true);
  if (barcode && (!/^[A-Za-z0-9._/-]{1,64}$/.test(barcode) || scientific.test(barcode))) fail('Barcode must be an identifier of up to 64 characters, without scientific notation.');
  return barcode || null;
}
export function normalizeCatalogMetadata(payload: Record<string, unknown>): CatalogMetadata {
  return {
    category: normalizeCatalogCategoryName(payload.category === undefined ? '' : payload.category, true),
    barcode: normalizeCatalogBarcode(payload.barcode),
    reorderLevel: normalizeCatalogQuantity(payload.reorderLevel === undefined ? '0' : payload.reorderLevel),
  };
}

const mutableFields = ['name','sellingPriceMinor','costPriceMinor','taxRateBps','category','barcode','reorderLevel'] as const;
export function normalizeCatalogProductCreate(payload: Record<string, unknown>, defaults: CatalogProductDefaults): CatalogProductCreate {
  fields(payload, ['sku','baseUnit','currency','itemKind',...mutableFields], ['sku','name','baseUnit','currency','sellingPriceMinor','costPriceMinor']);
  return {
    sku: normalizeCatalogSku(payload.sku), name: normalizeCatalogName(payload.name), baseUnit: normalizeCatalogBaseUnit(payload.baseUnit),
    currency: normalizeCatalogCurrency(payload.currency, defaults.currency),
    itemKind: normalizeItemKind(payload.itemKind),
    sellingPriceMinor: normalizeCatalogMinor(payload.sellingPriceMinor, 'sellingPriceMinor'), costPriceMinor: normalizeCatalogMinor(payload.costPriceMinor, 'costPriceMinor'),
    taxRateBps: normalizeCatalogTaxRateBps(payload.taxRateBps === undefined ? defaults.taxRateBps : payload.taxRateBps),
    ...normalizeCatalogMetadata(payload),
  };
}
export function normalizeCatalogProductUpdate(payload: Record<string, unknown>): CatalogProductEdit {
  fields(payload, ['productId','reason',...mutableFields], mutableFields);
  return {
    name: normalizeCatalogName(payload.name), sellingPriceMinor: normalizeCatalogMinor(payload.sellingPriceMinor, 'sellingPriceMinor'),
    costPriceMinor: normalizeCatalogMinor(payload.costPriceMinor, 'costPriceMinor'), taxRateBps: normalizeCatalogTaxRateBps(payload.taxRateBps),
    ...normalizeCatalogMetadata(payload),
  };
}

/** CSV decimal prices convert with integer arithmetic before sharing the same
 * direct-command minor-unit validation. Currency fraction digits remain exact. */
export function catalogMinorFromDecimal(value: string, currency: string): number {
  if (typeof value !== 'string' || controls.test(value)) fail('Use a non-negative decimal price; scientific notation and thousands separators are not accepted.');
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) fail('Use a non-negative decimal price; scientific notation and thousands separators are not accepted.');
  const digits = new Intl.NumberFormat('en', {style:'currency',currency}).resolvedOptions().maximumFractionDigits ?? 2;
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > digits) fail(`Use at most ${digits} decimal places for ${currency}.`);
  const amount = BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || '0');
  if (amount > maxMinor) fail('The amount exceeds the supported integer minor-unit range.');
  return normalizeCatalogMinor(Number(amount));
}
export function catalogTaxFromPercent(value: string): number {
  if (typeof value !== 'string' || controls.test(value) || !/^\d{1,3}(?:\.\d{1,2})?$/.test(value.trim())) fail('Use a tax percentage from 0 to 100 with at most two decimal places.');
  const [whole, fraction = ''] = value.trim().split('.');
  const rate = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (rate > 10_000n) fail('The tax percentage cannot exceed 100.');
  return normalizeCatalogTaxRateBps(Number(rate));
}
