import assert from 'node:assert/strict';
import test from 'node:test';
import type { ApiSession } from '../src/contracts.js';
import { getOperationalAnalytics } from '../src/operationalAnalytics.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  test('operational analytics SQL runs against PostgreSQL', { skip: 'Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database.' }, () => {});
} else {
  process.env.DATABASE_URL ??= databaseUrl;
  test('operational analytics SQL runs against PostgreSQL with finance customer charges', async () => {
    const session: ApiSession = {
      sessionId: 'analytics-test-session', userId: '00000000-0000-0000-0000-000000000001', fullName: 'Analytics Test',
      email: 'analytics@example.test', tenantId: '00000000-0000-0000-0000-000000000002', tenantName: 'Analytics Test',
      currency: 'KES', outletId: '00000000-0000-0000-0000-000000000003', outletName: 'Analytics Test',
      timeZone: 'Africa/Nairobi', deviceId: 'analytics-test-device', role: 'manager', capabilities: ['commerce'], expiresAt: new Date(),
    };
    const result = await getOperationalAnalytics(session, '2026-10-09', '2026-10-15');
    assert.equal(result.totals.grossSalesMinor, '0');
    assert.equal(result.coverage.accountChargeCount, '0');
  });
}
