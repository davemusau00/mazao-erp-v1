import { expect, test } from '@playwright/test';

const controls = {
  generatedAt: '2026-10-18T09:00:00.000Z', businessDate: '2026-10-18', currency: 'KES', timeZone: 'Africa/Nairobi',
  controls: {
    receivables: { ledgerMinor: '0', subledgerMinor: '0', differenceMinor: '0', balanced: true },
    inventory: { ledgerMinor: '0', subledgerMinor: '0', differenceMinor: '0', balanced: true },
    payables: { ledgerMinor: '0', subledgerMinor: '0', differenceMinor: '0', balanced: true },
  },
  incomingMpesa: { recordedMinor: '2000', matchedMinor: '0', unmatchedMinor: '2000', recordedCount: '2', matchedCount: '0', unmatchedCount: '2', unmatchedStatementMinor: '2000', unmatchedStatementCount: '2' },
  coverage: { status: 'PARTIAL', exclusions: [], negativeNoncashAccounts: [] },
  categories: [{ code: 'OPERATING_EXPENSE', label: 'Operating expense' }],
  paymentAccounts: [{ code: 'MOBILE_MONEY_CONTROL', label: 'M-Pesa' }], permissions: { manage: true, close: true },
};
const trialBalance = {
  reportType: 'TRIAL_BALANCE', scope: 'TENANT', tenantId: 'tenant-a', tenantName: 'Business A', currency: 'KES', timeZone: 'Africa/Nairobi',
  asOf: '2026-10-18', generatedAt: '2026-10-18T09:00:00.000Z', latestJournalAt: null,
  coverage: { status: 'POSTED_JOURNAL_ONLY', journalEntryCount: '0', emptyJournalEntryCount: '0', unbalancedJournalEntryCount: '0', sourceTypes: [], explanation: 'Recorded journal entries only.' },
  totals: { debitMinor: '0', creditMinor: '0', differenceMinor: '0', balanced: true }, accounts: [],
};

const statementLines = ['STATEMENT-A', 'STATEMENT-B'].map((reference, index) => ({
  id: `line-${index}`, createdAt: '2026-10-18T08:00:00.000Z', statementId: 'statement-1', statementReference: 'STMT-1',
  reference, occurredOn: '2026-10-18', amountMinor: '1000', currency: 'KES', paymentId: null, matchedAt: null,
  originalReference: reference, originalAmountMinor: '1000', originalOccurredOn: '2026-10-18', correctionReason: null, version: 1,
}));

test('a late M-Pesa lookup cannot replace the currently selected statement line', async ({ page }) => {
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/me') return route.fulfill({ json: { user: { id: 'finance-owner', name: 'Finance owner', email: 'finance@example.test', role: 'accountant', permissions: ['finance.view', 'finance.manage', 'finance.close'] }, tenant: { id: 'tenant-a', name: 'Business A', currency: 'KES', timeZone: 'Africa/Nairobi', capabilities: ['commerce', 'inventory'] }, outlet: { id: 'outlet-a', name: 'Outlet A', timeZone: 'Africa/Nairobi' }, deviceId: 'device-a', csrfToken: 'csrf-a' } });
    if (path === '/finance/controls') return route.fulfill({ json: controls });
    if (path === '/reports/trial-balance') return route.fulfill({ json: trialBalance });
    if (path === '/finance/records/statement-lines') return route.fulfill({ json: { records: statementLines, pageInfo: { limit: 100, hasMore: false, nextCursor: null } } });
    if (path === '/finance/records/mpesa-payments') {
      const reference = url.searchParams.get('reference');
      if (reference === 'STATEMENT-A') await new Promise(resolve => setTimeout(resolve, 800));
      const suffix = reference === 'STATEMENT-A' ? 'A' : 'B';
      return route.fulfill({ json: { records: [{ id: `payment-${suffix}`, createdAt: '2026-10-18T08:00:00.000Z', reference: `PAYMENT-${suffix}`, amountMinor: '1000', currency: 'KES', outletName: 'Outlet A', operatorName: 'Cashier', matched: false }], pageInfo: { limit: 100, hasMore: false, nextCursor: null } } }).catch(() => {});
    }
    if (path.startsWith('/finance/records/')) return route.fulfill({ json: { records: [], pageInfo: { limit: 100, hasMore: false, nextCursor: null } } });
    return route.fulfill({ json: {} });
  });

  await page.goto('/');
  let moneyNav = page.getByRole('button', { name: /^Money/ }).filter({ visible: true });
  if (await moneyNav.count() === 0) { await page.getByRole('button', { name: 'More', exact: true }).click(); moneyNav = page.getByRole('button', { name: /^Money/ }).filter({ visible: true }); }
  await moneyNav.last().click();
  await page.getByRole('button', { name: 'Accounting and reconciliation' }).click();
  await page.getByRole('button', { name: 'M-Pesa matching' }).click();

  const firstLine = page.locator('article').filter({ hasText: 'STATEMENT-A' }).last();
  const firstLookup = page.waitForRequest(request => request.url().includes('/finance/records/mpesa-payments?') && request.url().includes('reference=STATEMENT-A'));
  await firstLine.getByRole('button', { name: 'Find recorded payment' }).click();
  await firstLookup;
  await page.getByRole('button', { name: 'Close dialog' }).click();

  const secondLine = page.locator('article').filter({ hasText: 'STATEMENT-B' }).last();
  await secondLine.getByRole('button', { name: 'Find recorded payment' }).click();
  await expect(page.getByText('PAYMENT-B')).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.getByText('PAYMENT-B')).toBeVisible();
  await expect(page.getByText('PAYMENT-A')).toHaveCount(0);
});
