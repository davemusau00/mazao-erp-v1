import type { ApiSession } from './contracts.js';
import { DomainError, ROLE_PERMISSIONS } from './contracts.js';

export function reportRange(fromValue: unknown, toValue: unknown) {
  const parse = (value: unknown, key: string) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DomainError('VALIDATION_FAILED', `${key} must use YYYY-MM-DD.`);
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new DomainError('VALIDATION_FAILED', `${key} must be a real calendar date.`);
    return value;
  };
  const from = parse(fromValue, 'from');
  const to = parse(toValue, 'to');
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (days < 0 || days > 366) throw new DomainError('VALIDATION_FAILED', 'Choose an ordered date range of at most 367 days.');
  return { from, to };
}

export function requireOperationalAnalytics(session: ApiSession) {
  if (!session.capabilities.includes('commerce')) throw new DomainError('CAPABILITY_DISABLED', 'Commerce analytics are not enabled for this tenant.', 403);
  if (!ROLE_PERMISSIONS[session.role].includes('finance.view')) throw new DomainError('FORBIDDEN', 'Your role cannot access operational analytics.', 403);
}
