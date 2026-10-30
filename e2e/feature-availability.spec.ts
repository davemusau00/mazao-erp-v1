import { expect, test, type Page } from '@playwright/test';

// This verifies authenticated navigation and read-only boundaries against HTTP
// fixtures. Domain posting and tenant isolation remain API/PostgreSQL acceptance.
async function connect(page: Page, permissions: string[], manage = true) {
  const reads: string[] = [];
  const business = { id: 'availability-tenant', name: 'Availability business', currency: 'KES', timeZone: 'Africa/Nairobi', version: 1, legalName: '', registrationNumber: '', taxRegistrationNumber: '', address: '', phone: '', email: '', website: '', logoUrl: '', receiptHeader: '', receiptFooter: '', taxPolicy: { calculation: 'exclusive', defaultRateBps: 0, label: 'VAT', reviewed: true } };
  const outlet = { id: 'availability-outlet', name: 'Current outlet', timeZone: 'Africa/Nairobi', version: 1, address: '', phone: '', email: '', receiptHeader: '', receiptFooter: '' };
  const capabilities = ['commerce', 'inventory', 'hospitality'];
  const check = { ledgerMinor: '0', subledgerMinor: '0', differenceMinor: '0', balanced: true };
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    reads.push(path);
    if (path === '/auth/me') return route.fulfill({ headers: { 'x-request-id': route.request().headers()['x-request-id'] ?? 'availability-response' }, json: { user: { id: 'availability-user', name: 'Availability operator', email: 'availability@example.invalid', role: permissions.includes('config.manage') ? 'admin' : 'manager', permissions }, tenant: { id: business.id, name: business.name, currency: business.currency, timeZone: business.timeZone, capabilities }, outlet, deviceId: 'availability-device', csrfToken: 'availability-csrf' } });
    if (path === '/configuration') return route.fulfill({ headers: { 'x-request-id': route.request().headers()['x-request-id'] ?? 'availability-response' }, json: { configuration: { business, outlet, capabilities, supportedCapabilities: capabilities, currencyLocked: true, readiness: { readyForFirstSale: true, checks: [] } } } });
    if (path === '/catalog/items') return route.fulfill({ headers: { 'x-request-id': route.request().headers()['x-request-id'] ?? 'availability-response' }, json: { items: [] } });
    if (path === '/finance/controls') return route.fulfill({ headers: { 'x-request-id': route.request().headers()['x-request-id'] ?? 'availability-response' }, json: { generatedAt: '2026-10-20T09:00:00Z', businessDate: '2026-10-20', currency: 'KES', timeZone: business.timeZone, controls: { receivables: check, inventory: check, payables: check, stockExceptionClearing: check }, incomingMpesa: { recordedMinor: '0', matchedMinor: '0', unmatchedMinor: '0', recordedCount: '0', matchedCount: '0', unmatchedCount: '0', unmatchedStatementMinor: '0', unmatchedStatementCount: '0' }, coverage: { status: 'PARTIAL', exclusions: [], negativeNoncashAccounts: [] }, categories: [{ code: 'OPERATING_EXPENSE', label: 'Operating expense' }], paymentAccounts: [{ code: 'BANK_CONTROL', label: 'Bank' }], permissions: { manage, close: manage } } });
    if (path.startsWith('/finance/records/')) return route.fulfill({ headers: { 'x-request-id': route.request().headers()['x-request-id'] ?? 'availability-response' }, json: { records: [], pageInfo: { limit: 100, hasMore: false, nextCursor: null } } });
    return route.fulfill({ status: 404, json: { code: 'UNEXPECTED_TEST_ENDPOINT', message: path } });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Signed in as Availability operator' })).toBeVisible();
  return reads;
}

async function openWorkspace(page: Page, label: RegExp) {
  const navigation = page.getByRole('button', { name: label });
  if (!await navigation.first().isVisible()) await page.getByRole('button', { name: 'More', exact: true }).click();
  await navigation.last().click();
}

for (const viewport of [{ width: 1024, height: 600 }, { width: 390, height: 844 }]) {
  test(`Manage and Purchasing open real supplier accounting at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const reads = await connect(page, ['config.view', 'config.manage', 'finance.view', 'finance.manage', 'finance.close', 'inventory.receive']);
    await openWorkspace(page, /^Manage$/);
    const supplierCard = page.getByRole('button', { name: /^Supplier accounts and payables/ });
    await expect(supplierCard).toBeEnabled();
    await expect(supplierCard).toContainText('full value of one stock delivery');
    await expect(page.getByRole('button', { name: /^Connection and recovery/ })).toBeDisabled();
    await page.evaluate(() => {
      (window as any).moneyReady = [];
      window.addEventListener('mazao:workspace-first-usable', event => (window as any).moneyReady.push((event as CustomEvent).detail));
    });
    await supplierCard.click();
    await expect(page.getByRole('button', { name: 'Supplier bills', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Add supplier', exact: true })).toBeEnabled();
    await expect.poll(() => page.evaluate(() => (window as any).moneyReady.some((entry: any) => entry.workspace === 'money' && entry.outcome === 'ready' && entry.blockingReadCount === 4))).toBe(true);
    await page.getByRole('button', { name: 'Record supplier bill', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Record supplier bill' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await openWorkspace(page, /^Purchasing(?:,? Limited)?$/);
    await expect(page.getByRole('heading', { name: 'Receive a delivery' })).toBeVisible();
    await page.getByRole('button', { name: 'Open supplier bills and payments' }).click();
    await expect(page.getByRole('button', { name: 'Supplier bills', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(/Purchase orders, partial delivery matching and supplier credits are unavailable/)).toBeVisible();
    expect(reads).toContain('/finance/records/invoices');
    expect(reads).not.toContain('/reports/trial-balance');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test('Manage opens implemented expense, period and manual M-Pesa areas with their limits', async ({ page }) => {
  await connect(page, ['config.view', 'finance.view'], false);
  for (const [card, area, action, limitation] of [
    [/^Expenses/, 'Expenses', 'Record paid expense', /This does not send money/],
    [/^Accounting periods/, 'Periods', 'Create accounting period', /A closed period cannot be reopened/],
    [/^Payment reconciliation/, 'M-Pesa matching', 'Add incoming statement', /prove statement completeness/],
  ] as const) {
    await openWorkspace(page, /^Manage$/);
    await page.getByRole('button', { name: card }).click();
    await expect(page.getByRole('button', { name: area, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: action, exact: true })).toBeDisabled();
    await expect(page.getByText(limitation)).toBeVisible();
  }
});

test('receiving and configuration access cannot expose finance actions or restaurant operation', async ({ page }) => {
  const reads = await connect(page, ['config.view', 'config.manage', 'inventory.receive']);
  await openWorkspace(page, /^Manage$/);
  for (const card of [/^Supplier accounts and payables/, /^Expenses/, /^Accounting periods/, /^Payment reconciliation/, /^Connection and recovery/]) {
    await expect(page.getByRole('button', { name: card })).toBeDisabled();
  }
  await expect(page.getByRole('button', { name: /Tables & kitchen/ })).toBeDisabled();
  await openWorkspace(page, /^Purchasing(?:,? Limited)?$/);
  await expect(page.getByText(/Viewing supplier bills and payments requires finance access/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open supplier bills and payments' })).toHaveCount(0);
  expect(reads.some(path => path.startsWith('/finance/'))).toBe(false);
});
