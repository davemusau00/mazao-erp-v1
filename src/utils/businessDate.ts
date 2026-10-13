/** Calendar helpers for report filters. Keys are outlet-local YYYY-MM-DD values. */
export function businessDateKey(value: Date | string, timeZone: string): string {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function shiftBusinessDate(key: string, days: number): string {
  const date = new Date(`${key}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function formatBusinessDateLabel(key: string, timeZone: string): string {
  const date = new Date(`${key}T12:00:00.000Z`);
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
  }).format(date);
}
