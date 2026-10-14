/** Convert a currency amount string to integer minor units without binary float arithmetic. */
export function moneyInputToMinor(value:string):number {
  const match=/^(\d+)(?:\.(\d*))?$/.exec(value.trim());
  if(!match||match[2]?.length>2) throw new Error('Enter an amount with up to two decimal places.');
  const minor=BigInt(match[1])*100n+BigInt((match[2]??'').padEnd(2,'0')||'0');
  if(minor>BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount exceeds supported limit.');
  return Number(minor);
}

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
  return formatMinorMoneyText(BigInt(Math.trunc(amountMinor)), currency, locale);
}

/** Format a decimal-safe integer minor-unit value that arrived as a string or bigint. */
export function formatMinorMoneyText(amountMinor: string | bigint, currency: string, locale?: string): string {
  const digits = currencyMinorDigits(currency, locale);
  const amount = typeof amountMinor === 'bigint' ? amountMinor : BigInt(amountMinor);
  const scale = 10n ** BigInt(digits);
  const absolute = amount < 0n ? -amount : amount;
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(digits, '0');
  const grouped = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(whole);
  const symbol = new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(0).find(part => part.type === 'currency')?.value ?? currency;
  const sign = amount < 0n ? '-' : '';
  const decimal = new Intl.NumberFormat(locale).formatToParts(1.1).find(part => part.type === 'decimal')?.value ?? '.';
  return digits ? `${sign}${symbol}\u00a0${grouped}${decimal}${fraction}` : `${sign}${symbol}\u00a0${grouped}`;
}
