import { expect, test, type Page } from '@playwright/test';

const tenantId = 'readiness-count-tenant';
const outletId = 'readiness-count-outlet';
const actorId = 'readiness-count-actor';
const countId = 'readiness-count-session';
const productIds = ['readiness-count-a', 'readiness-count-b'];
const products = productIds.map((id, index) => ({ id, sku: `READINESS-${index + 1}`, name: `Readiness item ${index + 1}`, unit: 'each', currency: 'KES', sellingPriceMinor: 1000, costPriceMinor: 100, taxRateBps: 0, quantity: '10', version: 1, barcode: `616400000000${index + 1}` }));

function makeCount(complete = false) {
  return {
    id: countId, status: 'OPEN', areaLabel: 'Readiness shelf', version: 1, baselineAt: '2026-10-28T08:00:00Z', openedAt: '2026-10-28T08:00:00Z', openedBy: 'Readiness Manager',
    lineCount: 2, countedLineCount: complete ? 2 : 0,
    lines: products.map((product, index) => ({ productId: product.id, sku: product.sku, name: product.name, unit: product.unit, expectedQuantity: '10', expectedBalanceVersion: 1, countedQuantity: complete ? index === 0 ? '0' : '10' : null, varianceReason: complete && index === 0 ? 'Confirmed empty shelf' : null, countedBy: complete ? actorId : null, countedAt: complete ? '2026-10-28T08:01:00Z' : null, baselineRevision: 1, countedRevision: complete ? 1 : null, requiresRecount: false })),
  };
}

async function fixture(page: Page, options: { complete?: boolean; width?: number; height?: number } = {}) {
  const state = { count: makeCount(options.complete) as any, posts: [] as Array<Record<string, any>> };
  if (options.width && options.height) await page.setViewportSize({ width: options.width, height: options.height });
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/auth/me') return route.fulfill({ json: { user: { id: actorId, name: 'Readiness Manager', role: 'manager', email: 'readiness@example.invalid', permissions: ['inventory.count', 'inventory.count.approve', 'catalog.manage'] }, tenant: { id: tenantId, name: 'Readiness Business', currency: 'KES', timeZone: 'Africa/Nairobi', capabilities: ['inventory', 'commerce'] }, outlet: { id: outletId, name: 'Readiness Outlet', timeZone: 'Africa/Nairobi' }, deviceId: 'readiness-count-device', csrfToken: 'readiness-count-csrf' } });
    if (path === '/api/v1/shifts/current') return route.fulfill({ json: { shift: null } });
    if (path === '/api/v1/catalog/items') return route.fulfill({ json: { items: products.map(item => ({ ...item, inventoryValueMinor: '1000' })) } });
    if (path === '/api/v1/inventory/counts/current') return route.fulfill({ json: { count: state.count } });
    if (path === '/api/v1/inventory/counts') return route.fulfill({ json: { counts: [] } });
    if (path === '/api/v1/commands' && request.method() === 'POST') {
      const command = request.postDataJSON() as Record<string, any>;
      state.posts.push(structuredClone(command));
      if (command.type === 'inventory.count.save') {
        state.count.version += 1;
        state.count.lines = state.count.lines.map((line: any) => {
          const saved = command.payload.lines.find((item: Record<string, unknown>) => item.productId === line.productId)!;
          return { ...line, countedQuantity: saved.countedQuantity, varianceReason: saved.varianceReason, countedBy: actorId, countedAt: new Date().toISOString(), countedRevision: line.baselineRevision, requiresRecount: saved.countedQuantity === null };
        });
        state.count.countedLineCount = state.count.lines.filter((line: any) => line.countedQuantity !== null).length;
        return route.fulfill({ json: { commandId: command.commandId, status: 'CONFIRMED', value: { countId, version: state.count.version, status: 'OPEN', lineCount: 2 } } });
      }
      return route.fulfill({ json: { commandId: command.commandId, status: 'REJECTED' } });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND' } } });
  });
  await page.goto('/');
  await expect(page.getByLabel('Signed in as Readiness Manager')).toBeVisible();
  await openCount(page);
  return state;
}

async function openCount(page: Page) {
  const button = page.getByRole('button', { name: 'Count stock', exact: true });
  if (!await button.isVisible()) await page.getByRole('button', { name: 'More', exact: true }).click();
  await button.last().click();
  await expect(page.getByRole('heading', { name: 'Outlet count in progress' })).toBeVisible();
}

test('missing quantities and reasons link to the right inputs; zero is a counted value', async ({ page }) => {
  const state = await fixture(page, { width: 390, height: 844 });
  const readiness = page.getByRole('region', { name: 'Prepare this full count' });
  await expect(readiness).toContainText('2 quantities still needed');
  await expect(readiness).toContainText('0 variance reasons still needed');
  const first = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Readiness item 1', exact: true }) });
  await readiness.getByRole('button', { name: 'READINESS-1 · Readiness item 1', exact: true }).click();
  await expect(first.getByLabel('Counted quantity', { exact: true })).toBeFocused();
  await first.getByLabel('Counted quantity', { exact: true }).fill('0');
  await expect(readiness).toContainText('1 quantity still needed');
  await expect(readiness).toContainText('1 variance reason still needed');
  await expect(first.getByLabel('Counted quantity', { exact: true })).toHaveValue('0');
  await readiness.getByRole('button', { name: 'READINESS-1 · Readiness item 1', exact: true }).click();
  await expect(first.getByLabel('Reason for difference')).toBeFocused();
  await first.getByLabel('Reason for difference').fill('Confirmed empty shelf');

  await page.getByLabel('Scan barcode or search count items', { exact: true }).fill(products[1].barcode);
  const secondMatch = page.getByRole('option', { name: /Readiness item 2.*6164000000002/ });
  await expect(secondMatch).toBeVisible();
  await secondMatch.click();
  const second = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Readiness item 2', exact: true }) });
  await expect(second.getByLabel('Counted quantity', { exact: true })).toBeFocused();
  await second.getByLabel('Counted quantity', { exact: true }).fill('10');
  await expect(readiness).toContainText('0 quantities still needed');
  await expect(readiness).toContainText('0 variance reasons still needed');
  await expect(page.getByRole('button', { name: 'Review and post', exact: true })).toBeDisabled();

  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Count draft saved.')).toBeVisible();
  await expect(readiness).toContainText('2 of 2 counts saved to the server');
  await page.reload();
  await openCount(page);
  const restoredFirst = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Readiness item 1', exact: true }) });
  await expect(restoredFirst.getByLabel('Counted quantity', { exact: true })).toHaveValue('0');
  await expect(restoredFirst.getByLabel('Reason for difference')).toHaveValue('Confirmed empty shelf');
  await expect(page.getByRole('button', { name: 'Review and post', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Review and post', exact: true }).click();
  const postButton = page.getByRole('button', { name: 'Post reviewed count', exact: true });
  await expect(postButton).toBeInViewport();
  expect((await postButton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(state.posts.map(command => command.type)).toEqual(['inventory.count.save']);
});

test('search keeps saved totals and reports the number of hidden baseline items', async ({ page }) => {
  await fixture(page, { complete: true });
  await expect(page.getByText('2 baseline items · 2 saved counts')).toBeVisible();
  await page.getByLabel('Scan barcode or search count items', { exact: true }).fill('READINESS-1');
  await expect(page.getByText('1 shown · 1 hidden by search')).toBeVisible();
  await expect(page.locator('article')).toHaveCount(1);
  await page.getByLabel('Scan barcode or search count items', { exact: true }).clear();
  await expect(page.getByText('2 shown · 0 hidden by search')).toBeVisible();
  await expect(page.getByText('2 baseline items · 2 saved counts')).toBeVisible();
});

for (const viewport of [{ width: 1024, height: 600 }, { width: 390, height: 844 }]) {
  test(`review confirmation remains reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await fixture(page, { complete: true, ...viewport });
    await expect(page.getByRole('button', { name: 'Review and post', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Review and post', exact: true }).click();
    const confirm = page.getByRole('button', { name: 'Post reviewed count', exact: true });
    await expect(confirm).toBeInViewport();
    expect((await confirm.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
