import { expect, test } from '@playwright/test';

for (const kind of ['count', 'import'] as const) {
  test(`${kind} history reaches review 51, retries the same page and searches on the server`, async ({ page }) => {
    const calls: string[] = [];
    let olderAttempts = 0;
    const base = { createdAt: '2026-10-20T09:00:00Z', status: 'CANCELLED', version: 1, openedAt: '2026-10-20T09:00:00Z', openedBy: 'History operator', postedAt: null, postedBy: null, lineCount: 1, countedLineCount: 0 };
    const row = (index: number) => kind === 'count'
      ? { ...base, id: `count-${index}`, areaLabel: `Count review ${index}` }
      : { ...base, id: `import-${index}`, fileName: `Import review ${index}.csv`, status: 'INVALID', summary: { rowCount: 1, errorCount: 1 } };
    const endpoint = kind === 'count' ? '/inventory/counts' : '/catalog/imports';
    await page.route('**/api/v1/**', async route => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace('/api/v1', '');
      if (path === '/auth/me') return route.fulfill({ json: { user: { id: 'history-user', name: 'History operator', email: 'history@example.invalid', role: 'manager', permissions: ['catalog.manage', 'inventory.count'] }, tenant: { id: 'history-tenant', name: 'History business', currency: 'KES', timeZone: 'Africa/Nairobi', capabilities: ['inventory'] }, outlet: { id: 'history-outlet', name: 'History outlet', timeZone: 'Africa/Nairobi' }, deviceId: 'history-device', csrfToken: 'history-csrf' } });
      if (path === '/catalog/items') return route.fulfill({ json: { items: [] } });
      if (path === '/inventory/movements') return route.fulfill({ json: { movements: [] } });
      if (path === '/inventory/counts/current') return route.fulfill({ json: { count: null } });
      if (path === endpoint) {
        calls.push(url.search);
        if (url.searchParams.has('after') && ++olderAttempts === 1) return route.fulfill({ status: 503, json: { code: 'DATABASE_UNAVAILABLE', message: 'History interrupted. Retry this page.' } });
        const searched = url.searchParams.get('q') === 'review 51';
        const older = !!url.searchParams.get('after');
        const records = searched || older ? [row(51)] : Array.from({ length: 50 }, (_, index) => row(index + 1));
        return route.fulfill({ json: { [kind === 'count' ? 'counts' : 'batches']: records, page: { asOf: '2026-10-20T10:00:00Z', totalCount: searched ? 1 : 51, limit: 50, nextCursor: searched || older ? null : 'older-reviews', hasMore: !(searched || older) } } });
      }
      if (path === `${endpoint}/${kind}-51`) return route.fulfill({ status: 404, json: { code: 'NOT_FOUND', message: 'Details retry fixture reached.' } });
      return route.fulfill({ status: 404, json: { code: 'UNEXPECTED_ENDPOINT', message: path } });
    });
    await page.goto('/');
    const workspace = page.getByRole('button', { name: kind === 'count' ? 'Count stock' : 'Stock', exact: true });
    await workspace.click();
    if (kind === 'import') await page.getByRole('button', { name: 'Import products', exact: true }).click();
    await expect(page.getByText('50 shown of 51 matching records', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Load older records', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Mazao is temporarily unavailable.' })).toBeVisible();
    await page.getByRole('button', { name: kind === 'count' ? 'Retry count history' : 'Retry import history' }).click();
    await expect(page.getByText('51 shown of 51 matching records', { exact: false })).toBeVisible();
    const title = kind === 'count' ? 'Count review 51' : 'Import review 51.csv';
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: `Search ${kind} history` }).fill('review 51');
    await page.getByRole('button', { name: 'Search records', exact: true }).click();
    await expect(page.getByText('1 shown of 1 matching records', { exact: true })).toBeVisible();
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await expect(page.getByText(kind === 'count' ? 'Count review 1' : 'Import review 1.csv', { exact: true })).toHaveCount(0);
    expect(calls.filter(query => query === '?after=older-reviews')).toHaveLength(2);
    expect(calls).toContain('?q=review+51');
    if (kind === 'count') await page.getByRole('button', { name: 'View details', exact: true }).click();
    else await page.getByRole('button', { name: `Review import ${title}`, exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'This record could not be found in your workspace.' })).toBeVisible();
  });
}
