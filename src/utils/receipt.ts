import { formatDecimalQuantity, formatMinorMoneyText } from './money.js';
import { catalogItemKind, catalogItemKindLabel, type CatalogItemKind } from '../types/catalog.js';

/** The immutable fields needed to present a sale receipt; no transport or browser dependencies. */
export interface ReceiptPresentation {
  receiptId: string; tenantName: string; outletName: string; currency: string; createdAt: string; timeZone: string; operatorName: string;
  receiptProfile?: Partial<{ legalName: string; registrationNumber: string; taxRegistrationNumber: string; address: string; phone: string; email: string; website: string; receiptHeader: string; receiptFooter: string; taxLabel: string }>;
  lines: Array<{ name: string; quantity: string; itemKind?:CatalogItemKind;unrecordedQuantity?:string; unitPriceMinor: string; subtotalMinor: string; originalSubtotalMinor?: string; discountMinor?: string; discountReason?: string | null }>;
  payments: Array<{ method: string; amountMinor: string; currency: string; reference?: string | null }>;
  originalSubtotalMinor?: string; discountMinor?: string; subtotalMinor: string; taxMinor: string; totalMinor: string; amountPaidMinor: string;
  customerAccountCharge: { customerName: string; amountDueMinor: string } | null; cashTenderedMinor: string | null; changeMinor: string | null;
}

const money = formatMinorMoneyText;

export function formatReceiptDate(value: string, timeZone: string) {
  try { return new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
  catch { return value; }
}

export function displayOrderNumber(receipt: ReceiptPresentation): string {
  return receipt.receiptId.slice(0, 8).toUpperCase();
}

const displayQuantity = formatDecimalQuantity;

export function textReceipt(receipt: ReceiptPresentation) {
  const profile = receipt.receiptProfile ?? {};
  return [
    receipt.tenantName,
    receipt.outletName,
    ...(profile.legalName ? [profile.legalName] : []),
    ...(profile.registrationNumber ? [`Registration: ${profile.registrationNumber}`] : []),
    ...(profile.taxRegistrationNumber ? [`Tax registration: ${profile.taxRegistrationNumber}`] : []),
    ...[profile.address, profile.phone, profile.email, profile.website, profile.receiptHeader].filter(Boolean),
    `Order: #${displayOrderNumber(receipt)}`,
    `Date: ${formatReceiptDate(receipt.createdAt, receipt.timeZone)}`,
    `Cashier: ${receipt.operatorName}`,
    '',
    ...receipt.lines.flatMap(line => [
      ...(catalogItemKind(line) !== 'STOCKED_GOOD' ? [catalogItemKindLabel(catalogItemKind(line))] : []),
      `${line.name} | ${displayQuantity(line.quantity)} x ` +
      `${money(line.unitPriceMinor, receipt.currency)} | ` +
      `${money(line.subtotalMinor, receipt.currency)}`,
      ...(line.unrecordedQuantity&&line.unrecordedQuantity!=='0'?[`  Recorded stock short by ${displayQuantity(line.unrecordedQuantity)}; physical availability was confirmed.`]:[]),
      ...(BigInt(line.discountMinor ?? '0') > 0n ? [`  Original value: ${money(line.originalSubtotalMinor ?? (BigInt(line.subtotalMinor) + BigInt(line.discountMinor ?? '0')).toString(), receipt.currency)}`, `  Item discount: ${money(line.discountMinor!, receipt.currency)}${line.discountReason ? ` (${line.discountReason})` : ''}`] : []),
    ]),
    '',
    ...(BigInt(receipt.discountMinor ?? '0') > 0n ? [`Items before discounts: ${money(receipt.originalSubtotalMinor ?? (BigInt(receipt.subtotalMinor) + BigInt(receipt.discountMinor ?? '0')).toString(), receipt.currency)}`, `Item discounts: ${money(receipt.discountMinor!, receipt.currency)}`] : []),
    `Subtotal: ${money(receipt.subtotalMinor, receipt.currency)}`,
    `${profile.taxLabel || 'Tax'}: ${money(receipt.taxMinor, receipt.currency)}`,
    `Total: ${money(receipt.totalMinor, receipt.currency)}`,
    `Paid: ${money(receipt.amountPaidMinor, receipt.currency)}`,
    ...receipt.payments.map(payment => `${payment.method === 'MANUAL_MPESA' ? 'M-Pesa (cashier confirmed)' : payment.method.toUpperCase() === 'CASH' ? 'Cash' : 'Payment'}: ${money(payment.amountMinor, payment.currency)}${payment.reference ? ` | Reference: ${payment.reference}` : ''}`),
    ...(receipt.customerAccountCharge ? [`Charged to account: ${receipt.customerAccountCharge.customerName}`, `Amount due: ${money(receipt.customerAccountCharge.amountDueMinor, receipt.currency)}`] : []),
    ...(receipt.cashTenderedMinor === null ? [] : [`Cash received: ${money(receipt.cashTenderedMinor, receipt.currency)}`, `Change: ${money(receipt.changeMinor ?? '0', receipt.currency)}`]),
    '',
    ...(profile.receiptFooter ? [profile.receiptFooter] : []),
    'Sale receipt. This is not an electronic tax invoice.',
  ].join('\n');
}

