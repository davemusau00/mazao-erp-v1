import { expect, test, type Page } from '@playwright/test';

const tenantId = '81000000-0000-4000-8000-000000000001';
const outletId = '81000000-0000-4000-8000-000000000002';
const actorId = '81000000-0000-4000-8000-000000000003';
const deviceId = '81000000-0000-4000-8000-000000000004';
const countId = '82000000-0000-4000-8000-000000000001';
const productId = '83000000-0000-4000-8000-000000000001';

async function fixture(page: Page, referenceCostMinor = '123') {
  const state = {
    count: {
      id: countId, status: 'OPEN', areaLabel: 'Count valuation shelf', version: 2,
      baselineAt: '2026-10-29T07:00:00Z', openedAt: '2026-10-29T07:00:00Z', openedBy: 'Valuation Manager',
      lineCount: 1, countedLineCount: 1, coverage: 'COMPLETE', revision: 1,
      lines: [{ productId, sku: 'VALUE-1', name: 'Zero-baseline item', unit: 'each', expectedQuantity: '0.000000',
        expectedBalanceVersion: 1, countedQuantity: '2.5', varianceReason: 'Physical stock found', countedBy: actorId,
        countedAt: '2026-10-29T07:10:00Z', baselineRevision: 1, countedRevision: 1, requiresRecount: false,
        referenceCostMinor, inventoryValueMinor: '0' }],
    } as Record<string, any>,
    posts: [] as Array<Record<string, any>>,
  };
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/api/v1/auth/me') return route.fulfill({ json: { user: { id: actorId, name: 'Valuation Manager', role: 'manager', email: 'valuation@example.invalid', permissions: ['inventory.count', 'inventory.count.approve', 'catalog.manage', 'finance.view'] }, tenant: { id: tenantId, name: 'Valuation Business', currency: 'KES', timeZone: 'Africa/Nairobi', capabilities: ['inventory', 'commerce'] }, outlet: { id: outletId, name: 'Valuation Outlet', timeZone: 'Africa/Nairobi' }, deviceId, csrfToken: 'valuation-csrf' } });
    if (path === '/api/v1/shifts/current') return route.fulfill({ json: { shift: null } });
    if (path === '/api/v1/catalog/items') return route.fulfill({ json: { items: [{ id: productId, sku: 'VALUE-1', name: 'Zero-baseline item', unit: 'each', currency: 'KES', sellingPriceMinor: 1000, costPriceMinor: Number(referenceCostMinor), taxRateBps: 0, itemKind: 'STOCKED_GOOD', stockTracked: true, quantity: '0', version: 1, productVersion: 1, balanceVersion: 1, inventoryValueMinor: '0' }] } });
    if (path === '/api/v1/inventory/counts/current') return route.fulfill({ json: { count: state.count.status === 'OPEN' ? state.count : null } });
    if (path === '/api/v1/inventory/counts') return route.fulfill({ json: { counts: [{ id: countId, status: state.count.status, areaLabel: state.count.areaLabel, version: state.count.version, openedAt: state.count.openedAt, openedBy: state.count.openedBy, postedAt: null, postedBy: null, lineCount: 1, countedLineCount: 1 }] } });
    if (path === '/api/v1/commands' && request.method() === 'POST') {
      const command = request.postDataJSON() as Record<string, any>;
      state.posts.push(structuredClone(command));
      if (command.type === 'inventory.count.post') {
        state.count.status = 'POSTED'; state.count.version += 1;
        return route.fulfill({ json: { commandId: command.commandId, status: 'CONFIRMED', value: { countId, status: 'POSTED', lineCount: 1, adjustedLineCount: 1, gainMinor: referenceCostMinor === '0' ? 0 : 308, shrinkMinor: 0, totalVarianceMinor: referenceCostMinor === '0' ? 0 : 308, currency: 'KES', version: state.count.version } } });
      }
    }
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND' } } });
  });
  await page.goto('/');
  await expect(page.getByLabel('Signed in as Valuation Manager')).toBeVisible();
  const nav = page.getByRole('button', { name: 'Count stock', exact: true });
  if (!await nav.isVisible()) await page.getByRole('button', { name: 'More', exact: true }).click();
  await nav.last().click();
  await expect(page.getByRole('heading', { name: 'Outlet count in progress' })).toBeVisible();
  return state;
}

test('zero-baseline gain shows exact opening-cost estimate and requires acknowledged reason', async ({ page }) => {
  const state = await fixture(page);
  await expect(page.getByRole('button', { name: 'Review and post', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Review and post', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review full stock count' });
  await expect(dialog).toContainText('reference cost captured when this count opened');
  await expect(dialog).toContainText('Unit'); await expect(dialog).toContainText('1.23'); await expect(dialog).toContainText('3.08');
  const post = dialog.getByRole('button', { name: 'Post reviewed count', exact: true });
  await expect(post).toBeDisabled();
  await dialog.getByLabel('Valuation approval reason').fill('Opening reference estimate reviewed pending supplier invoice');
  await expect(post).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await expect(post).toBeEnabled();
  await post.click();
  await expect(dialog).toHaveCount(0);
  expect(state.posts).toHaveLength(1);
  expect(state.posts[0].type).toBe('inventory.count.post');
  expect(state.posts[0].payload).toEqual({ countId, valuationReason: 'Opening reference estimate reviewed pending supplier invoice' });
});

test('zero reference cost is clearly shown and still needs a review reason', async ({ page }) => {
  const state = await fixture(page, '0');
  await page.getByRole('button', { name: 'Review and post', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review full stock count' });
  await expect(dialog).toContainText('Opening reference cost is zero; policy keeps this gain at zero value after manager review.');
  await expect(dialog.getByRole('button', { name: 'Post reviewed count', exact: true })).toBeDisabled();
  await dialog.getByLabel('Valuation approval reason').fill('Unknown purchase cost; keep zero until supplier documentation arrives');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Post reviewed count', exact: true }).click();
  expect(state.posts[0].payload.valuationReason).toBe('Unknown purchase cost; keep zero until supplier documentation arrives');
});
