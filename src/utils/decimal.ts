function parts(value: string): { sign: bigint; whole: bigint; fraction: string } | null {
  const match = value.trim().replace(',', '.').match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  return { sign: match[1] === '-' ? -1n : 1n, whole: BigInt(match[2]), fraction: match[3] ?? '' };
}

function atScale(value: string, scale: number): bigint {
  const parsed = parts(value);
  if (!parsed) return 0n;
  return parsed.sign * (parsed.whole * 10n ** BigInt(scale) + BigInt((parsed.fraction + '0'.repeat(scale)).slice(0, scale) || '0'));
}

function fromScaled(value: bigint, scale: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = value < 0 ? -value : value;
  if (!scale) return `${sign}${abs}`;
  const digits = 10n ** BigInt(scale);
  const whole = abs / digits;
  const fraction = (abs % digits).toString().padStart(scale, '0').replace(/0+$/, '');
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}

export function sumDecimalStrings(values: string[]): string {
  const scale = Math.max(0, ...values.map(value => parts(value)?.fraction.length ?? 0));
  return fromScaled(values.reduce((sum, value) => sum + atScale(value, scale), 0n), scale);
}

export function subtractDecimalStrings(left: string, right: string): string {
  const scale = Math.max(parts(left)?.fraction.length ?? 0, parts(right)?.fraction.length ?? 0);
  return fromScaled(atScale(left, scale) - atScale(right, scale), scale);
}

export function decimalStringsEqual(left: string, right: string): boolean {
  return subtractDecimalStrings(left, right) === '0';
}
