import { expect, test, type Page } from '@playwright/test';
import type { BackendCommand } from '../src/services/apiClient';

const tenantId = '00000000-0000-4000-8000-000000000701';
const userId = '00000000-0000-4000-8000-000000000702';
const deviceId = '00000000-0000-4000-8000-000000000703';
const productId = '00000000-0000-4000-8000-000000000704';

async function savedCommands(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('mazao-v1-command-journal', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Array<{ command: BackendCommand; actorId?: string }>>((resolve, reject) => {
        const request = database.transaction('commands').objectStore('commands').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { database.close(); }
  });
}

async function fixture(page: Page) {
  const posts: BackendCommand[] = [];
  const item = { id: productId, name: 'Retained item', sku: 'KEEP-001', unit: 'each', currency: 'KES', sellingPriceMinor: 1000, costPriceMinor: 500, taxRateBps: 0, quantity: '0', inventoryValueMinor: '0', productVersion: 3, version: 1, category: '', categoryId: null, barcode: null, reorderLevel: '0', active: true };
  const state: { postResponse?: unknown; statusResponse: () => unknown; statusReads: number } = {
    statusResponse: () => null,
    statusReads: 0,
  };
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path === '/auth/me') return route.fulfill({ json: { user: { id: userId, name: 'Recovery operator', email: 'recovery@example.invalid', role: 'manager', permissions: ['catalog.manage'] }, tenant: { id: tenantId, name: 'Recovery business', currency: 'KES', timeZone: 'Africa/Nairobi', capabilities: ['inventory', 'commerce'] }, outlet: { id: '00000000-0000-4000-8000-000000000705', name: 'Recovery outlet', timeZone: 'Africa/Nairobi' }, deviceId, csrfToken: 'recovery-csrf' } });
    if (path === '/catalog/items') return route.fulfill({ json: { items: [item] } });
    if (path === '/catalog/categories') return route.fulfill({ json: { categories: [] } });
    if (path === '/inventory/movements') return route.fulfill({ json: { movements: [] } });
    if (path === '/commands') {
      posts.push(route.request().postDataJSON());
      return state.postResponse === undefined ? route.abort('failed') : route.fulfill({ json: { commandId: posts.at(-1)!.commandId, ...state.postResponse as object } });
    }
    if (path.startsWith('/commands/')) {
      state.statusReads++;
      return route.fulfill({ json: state.statusResponse() });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND' } } });
  });
  return { posts, state };
}

async function openEdit(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Stock', exact: true }).last().click();
  await page.getByRole('button', { name: 'Manage items and categories', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Retained item', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit item', exact: true });
  await dialog.getByLabel('Item name', { exact: true }).fill('Reviewed retained item');
  await dialog.getByLabel('Reason for change').fill('Reviewed original values');
  return dialog;
}

test('malformed lost-command status responses retain the original journal and block a replacement command', async ({ page }) => {
  const { posts, state } = await fixture(page);
  let dialog = await openEdit(page);
  await dialog.getByRole('button', { name: 'Save item changes', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Check change status' })).toBeEnabled();
  const original = structuredClone(posts[0]);
  const value = { productId, version: 4, active: true };
  const malformed = [
    null,
    { commandId: original.commandId, status: 'CONFIRMED', response: { commandId: 'different-command', status: 'CONFIRMED', value } },
    { commandId: original.commandId, status: 'CONFIRMED', response: { commandId: original.commandId, status: 'CONFIRMED', value: {} } },
    { commandId: original.commandId, status: 'REJECTED', response: { commandId: original.commandId, status: 'REJECTED', code: '' } },
    { commandId: original.commandId, status: 'REJECTED', response: { commandId: original.commandId, status: 'REJECTED', code: ' IDEMPOTENCY_MISMATCH ' } },
  ];
  for (const response of malformed) {
    const previousReads = state.statusReads;
    state.statusResponse = () => response;
    await dialog.getByRole('button', { name: 'Check change status' }).click();
    await expect.poll(() => state.statusReads).toBe(previousReads + 1);
    await expect(dialog.getByRole('button', { name: 'Check change status' })).toBeEnabled();
    await expect(dialog.getByLabel('Item name', { exact: true })).toBeDisabled();
    expect((await savedCommands(page)).map(record => record.command)).toEqual([original]);
    expect(posts).toHaveLength(1);
  }
  await page.reload();
  await page.getByRole('button', { name: 'Stock', exact: true }).last().click();
  dialog = page.getByRole('dialog', { name: 'Edit item', exact: true });
  await expect(dialog.getByLabel('Item name', { exact: true })).toHaveValue('Reviewed retained item');
  state.statusResponse = () => ({ commandId: original.commandId, status: 'CONFIRMED', response: { commandId: original.commandId, status: 'CONFIRMED', value } });
  await dialog.getByRole('button', { name: 'Check change status' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await savedCommands(page)).toEqual([]);
  expect(posts).toHaveLength(1);
});

for (const code of ['', 'IDEMPOTENCY_MISMATCH']) {
  test(`a ${code || 'missing-code'} submission rejection retains the original command until a valid status result`, async ({ page }) => {
    const { posts, state } = await fixture(page);
    state.postResponse = { status: 'REJECTED', code };
    const dialog = await openEdit(page);
    await dialog.getByRole('button', { name: 'Save item changes', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Check change status' })).toBeEnabled();
    const original = structuredClone(posts[0]);
    expect((await savedCommands(page)).map(record => record.command)).toEqual([original]);
    state.statusResponse = () => ({ commandId: original.commandId, status: 'REJECTED', response: { commandId: original.commandId, status: 'REJECTED', code: 'VALIDATION_FAILED' } });
    await dialog.getByRole('button', { name: 'Check change status' }).click();
    await expect(dialog.getByRole('button', { name: 'Save item changes', exact: true })).toBeEnabled();
    expect(await savedCommands(page)).toEqual([]);
    expect(posts).toHaveLength(1);
  });
}

test('a lost item creation keeps its original SKU and journal until a complete matching result is returned', async ({ page }) => {
  const { posts, state } = await fixture(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Stock', exact: true }).last().click();
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Create item', exact: true });
  await dialog.getByLabel('Item name', { exact: true }).fill('Created retained item');
  await dialog.getByLabel('SKU', { exact: true }).fill('  NEW-KEEP-001  ');
  await dialog.getByLabel('Selling price (KES)', { exact: true }).fill('15.00');
  state.postResponse = { status: 'CONFIRMED', value: {} };
  await dialog.getByRole('button', { name: 'Create item', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Check change status' })).toBeEnabled();
  const original = structuredClone(posts[0]);
  for (const value of [{}, { productId: 'created-product', sku: 'WRONG-SKU' }]) {
    const previousReads = state.statusReads;
    state.statusResponse = () => ({ commandId: original.commandId, status: 'CONFIRMED', response: { commandId: original.commandId, status: 'CONFIRMED', value } });
    await dialog.getByRole('button', { name: 'Check change status' }).click();
    await expect.poll(() => state.statusReads).toBe(previousReads + 1);
    await expect(dialog.getByRole('button', { name: 'Check change status' })).toBeEnabled();
    expect((await savedCommands(page)).map(record => record.command)).toEqual([original]);
  }
  await page.reload();
  await page.getByRole('button', { name: 'Stock', exact: true }).last().click();
  dialog = page.getByRole('dialog', { name: 'Create item', exact: true });
  await expect(dialog.getByLabel('SKU', { exact: true })).toHaveValue('NEW-KEEP-001');
  state.statusResponse = () => ({ commandId: original.commandId, status: 'CONFIRMED', response: { commandId: original.commandId, status: 'CONFIRMED', value: { productId: 'created-product', sku: 'NEW-KEEP-001' } } });
  await dialog.getByRole('button', { name: 'Check change status' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Item created' })).toBeVisible();
  expect(await savedCommands(page)).toEqual([]);
  expect(posts).toHaveLength(1);
});
