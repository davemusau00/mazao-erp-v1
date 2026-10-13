export function currencyMinorDigits(currency: string, locale?: string): number {
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2; }
  catch { return 2; }
}

/** Parse a decimal string without using binary floating point. */
export function parseMoneyToMinor(value: string, currency: string): number | null {
  const digits = currencyMinorDigits(currency);
  const normalized = value.trim().replace(/,/g, '');
  if (!normalized || !/^\d+(?:\.\d*)?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > digits || !Number.isSafeInteger(Number(whole))) return null;
  const scale = 10n ** BigInt(digits);
  const frac = BigInt((fraction + '0'.repeat(digits)).slice(0, digits) || '0');
  const result = BigInt(whole) * scale + frac;
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : null;
}

export function formatMinorMoney(amountMinor: number, currency: string, locale?: string): string {
  const digits = currencyMinorDigits(currency, locale);
  const amount = BigInt(Math.trunc(amountMinor));
  const scale = 10n ** BigInt(digits);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(digits, '0');
  const numeric = digits ? `${whole}.${fraction}` : whole.toString();
  const [integer, decimal] = numeric.split('.');
  const grouped = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Number(integer));
  const symbol = new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(0).find(part => part.type === 'currency')?.value ?? currency;
  return digits ? `${symbol}\u00a0${grouped}${new Intl.NumberFormat(locale).formatToParts(1.1).find(part => part.type === 'decimal')?.value ?? '.'}${decimal}` : `${symbol}\u00a0${grouped}`;
}
