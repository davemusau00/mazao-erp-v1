import { expect, test, type Page } from '@playwright/test';

const permissions = ['commerce.sell', 'commerce.discount', 'commerce.refund', 'catalog.manage', 'inventory.receive',
  'inventory.count', 'inventory.count.approve', 'shift.open', 'shift.close', 'shift.payout', 'customers.view',
  'customers.manage', 'customers.settle', 'customers.charge', 'config.view', 'config.manage', 'staff.view',
  'staff.manage', 'devices.view', 'devices.manage', 'hotel.frontdesk', 'hotel.manage', 'hotel.housekeeping'];
const session = {
  user: { id: 'language-user', name: 'Language Operator', email: 'language@example.test', role: 'admin', permissions },
  tenant: { id: 'language-tenant', name: 'Language Business', currency: 'KES', timeZone: 'Africa/Nairobi', capabilities: ['commerce', 'inventory', 'hospitality'] },
  outlet: { id: 'language-outlet', name: 'Main outlet', timeZone: 'Africa/Nairobi' }, deviceId: 'language-device', csrfToken: 'language-csrf',
};
const configuration = {
  business: { ...session.tenant, version: 1, legalName: '', registrationNumber: '', taxRegistrationNumber: '', address: '', phone: '', email: '', website: '', logoUrl: '', receiptHeader: '', receiptFooter: '', taxPolicy: { calculation: 'exclusive', defaultRateBps: 1600, label: 'VAT', reviewed: true } },
  outlet: { ...session.outlet, version: 1, address: '', phone: '', email: '', receiptHeader: '', receiptFooter: '' },
  capabilities: session.tenant.capabilities, supportedCapabilities: ['commerce', 'inventory', 'hospitality', 'retail'], currencyLocked: true,
  readiness: { readyForFirstSale: true, checks: [{ key: 'tax', label: 'Tax rate reviewed', complete: true, detail: 'The tax rate has been reviewed.' }] },
};

async function fixtureReads(page: Page) {
  const reads: Record<string, unknown> = {
    '/auth/me': session,
    '/shifts/current': { shift: { id: 'language-shift', status: 'OPEN', openingFloatMinor: 120000, cashSalesMinor: 0, customerCollectionsMinor: 0, cashRefundsMinor: 0, cashPaidInMinor: 0, cashPayoutMinor: 0, expectedCashMinor: 120000, mpesaSalesMinor: 120050, version: 1, openedAt: '2026-10-18T08:00:00Z', cashMovements: [] } },
    '/shifts/close-reports': { reports: [] },
    '/catalog/items': { items: [{ id: 'language-item', sku: 'ITEM-1', name: 'Test item', unit: 'each', currency: 'KES', sellingPriceMinor: 120000, inventoryValueMinor: '120000', costPriceMinor: 10000, taxRateBps: 1600, quantity: '12.000000', reorderLevel: '1.250000', version: 1 }] },
    '/inventory/movements': { movements: [] }, '/inventory/counts': { counts: [] }, '/inventory/counts/current': { count: null },
    '/catalog/imports': { batches: [] }, '/customers': { customers: [] },
    '/hospitality/rooms': { rooms: [] }, '/hospitality/reservations': { reservations: [] }, '/hospitality/stays': { stays: [] },
    '/configuration': { configuration },
    '/staff': { staff: [], roles: [{ role: 'admin', label: 'Administrator', permissions, assignable: true }], outlets: [{ ...session.outlet, active: true }], authorizationModel: 'COARSE_ROLE_MAP' },
    '/devices': { assignments: [] },
  };
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    return route.fulfill({ json: reads[path] ?? {}, headers: { 'x-request-id': 'language-fixture' } });
  });
}

async function navigate(page: Page, label: string) {
  const name = new RegExp(`^${label}(?:,? Limited)?$`);
  const sidebarButton = page.getByRole('complementary', { name: 'Main navigation' }).getByRole('button', { name });
  if (await sidebarButton.count() > 0 && await sidebarButton.last().isVisible()) {
    await sidebarButton.last().click();
    return;
  }
  const quickNav = page.getByRole('navigation', { name: 'Quick navigation' });
  const quickButton = quickNav.getByRole('button', { name });
  if (await quickButton.count() > 0 && await quickButton.last().isVisible()) {
    await quickButton.last().click();
    return;
  }
  await quickNav.getByRole('button', { name: 'More', exact: true }).click();
  const mobileButton = page.locator('.mobile-more-panel').getByRole('button', { name });
  await expect(mobileButton.last()).toBeVisible();
  await mobileButton.last().click();
}

async function expectCustomerLanguage(page: Page) {
  const visibleText = await page.locator('body').innerText();
  expect(visibleText).not.toMatch(/\b(server|backend|frontend|payload|command|commands|tenant|basis points|revision|snapshot|coarse)\b/i);
  const accessibleCopy = await page.locator('[aria-label], [title]').evaluateAll(elements =>
    elements.flatMap(element => [element.getAttribute('aria-label') ?? '', element.getAttribute('title') ?? '']).join(' '));
  expect(accessibleCopy).not.toMatch(/\b(server|backend|payload|command|commands|tenant|basis points|revision|coarse)\b/i);
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`business workspaces use customer language at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await fixtureReads(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Good day, Language' })).toBeVisible();
    await expectCustomerLanguage(page);

    for (const [workspace, heading] of [['Stock', 'Items and stock'], ['Count stock', 'Count stock'], ['Purchasing', 'Receive a delivery'],
      ['Customers', 'Customer Directory & Credit Accounts'], ['Shifts', 'Cash control'], ['Hotel', 'Rooms and guest stays'],
      ['Reservations', 'Rooms and guest stays'], ['Help', 'Help with your daily work'], ['Manage', 'Manage your business']]) {
      await navigate(page, workspace);
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await expectCustomerLanguage(page);
      if (workspace === 'Stock') {
        await expect(page.getByText('12 each', { exact: true })).toBeVisible();
        await expect(page.getByText('Reorder at 1.25 each', { exact: true })).toBeVisible();
        await expect(page.getByText('Tax 16%', { exact: true })).toBeVisible();
        await expect(page.getByText(/12\.000000|1,200\.00|16\.00%/)).toHaveCount(0);
      }
      if (workspace === 'Shifts') await expect(page.getByText(/M-Pesa sales KES\s1,200\.50.*separate from drawer cash/)).toBeVisible();
    }
    await page.getByRole('button').filter({ has: page.getByRole('heading', { name: 'Staff', exact: true }) }).click();
    await expect(page.getByRole('heading', { name: 'Staff access', exact: true })).toBeVisible();
    await expectCustomerLanguage(page);
    await page.getByText('Staff roles and access', { exact: true }).click();
    await expect(page.getByRole('cell', { name: /Make sales/ })).toBeVisible();
    await expectCustomerLanguage(page);
    await testInfo.attach(`customer-language-${viewport.width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });
}
