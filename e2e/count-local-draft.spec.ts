import { expect, test, type Page } from '@playwright/test';

const tenantId = 'local-draft-tenant';
const outletId = 'local-draft-outlet';
const countId = 'local-draft-count';
const productId = 'local-draft-product';

function makeCount(version = 1) {
  return {
    id: countId, status: 'OPEN', areaLabel: 'Local draft test', version, baselineAt: '2026-10-28T08:00:00Z', openedAt: '2026-10-28T08:00:00Z', openedBy: 'Draft Manager',
    lineCount: 1, countedLineCount: 0,
    lines: [{ productId, sku: 'LOCAL-1', name: 'Local recovery item', unit: 'each', expectedQuantity: '10', expectedBalanceVersion: 1, countedQuantity: null, varianceReason: null, countedBy: null, countedAt: null, baselineRevision: 1, countedRevision: null, requiresRecount: false }],
  };
}

async function fixture(page: Page, options: { actorId?: string; version?: number; saveMode?: 'normal' | 'lost'; cancelMode?: 'normal' | 'lost' } = {}) {
  const state = { actorId: options.actorId ?? 'local-draft-actor', count: makeCount(options.version ?? 1) as any, saveMode: options.saveMode ?? 'normal', cancelMode: options.cancelMode ?? 'normal', posts: [] as Array<Record<string, any>>, outcomes: new Map<string, Record<string, any>>() };
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/v1/auth/me') return route.fulfill({ json: { user: { id: state.actorId, name: 'Draft Manager', role: 'manager', email: 'draft@example.invalid', permissions: ['inventory.count', 'inventory.count.approve', 'catalog.manage'] }, tenant: { id: tenantId, name: 'Draft Business', currency: 'KES', timeZone: 'Africa/Nairobi', capabilities: ['inventory', 'commerce'] }, outlet: { id: outletId, name: 'Draft Outlet', timeZone: 'Africa/Nairobi' }, deviceId: 'local-draft-device', csrfToken: 'local-draft-csrf' } });
    if (path === '/api/v1/shifts/current') return route.fulfill({ json: { shift: null } });
    if (path === '/api/v1/catalog/items') return route.fulfill({ json: { items: [{ id: productId, sku: 'LOCAL-1', name: 'Local recovery item', unit: 'each', currency: 'KES', sellingPriceMinor: 1000, costPriceMinor: 100, taxRateBps: 0, quantity: '10', version: 1 }] } });
    if (path === '/api/v1/inventory/counts/current') return route.fulfill({ json: { count: state.count } });
    if (path === '/api/v1/inventory/counts') return route.fulfill({ json: { counts: [] } });
    if (path.startsWith('/api/v1/commands/') && request.method() === 'GET') {
      const commandId = path.split('/').at(-1)!;
      const outcome = state.outcomes.get(commandId);
      if (!outcome) return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Command has not arrived.' } } });
      return route.fulfill({ json: { commandId, status: 'CONFIRMED', response: outcome } });
    }
    if (path === '/api/v1/commands' && request.method() === 'POST') {
      const command = request.postDataJSON() as Record<string, any>;
      state.posts.push(structuredClone(command));
      if (command.type === 'inventory.count.save') {
        if (state.count) {
          state.count.version += 1;
          state.count.countedLineCount = command.payload.lines.filter((line: Record<string, unknown>) => line.countedQuantity !== null).length;
          state.count.lines = state.count.lines.map((line: any) => {
            const saved = command.payload.lines.find((item: Record<string, unknown>) => item.productId === line.productId)!;
            return { ...line, countedQuantity: saved.countedQuantity, varianceReason: saved.varianceReason, countedBy: state.actorId, countedAt: new Date().toISOString(), countedRevision: line.baselineRevision, requiresRecount: saved.countedQuantity === null };
          });
        }
        const outcome = { status: 'CONFIRMED', value: { countId, version: state.count?.version ?? 2, status: 'OPEN', lineCount: 1 } };
        state.outcomes.set(command.commandId, outcome);
        if (state.saveMode === 'lost') { state.saveMode = 'normal'; return route.abort('failed'); }
        return route.fulfill({ json: { commandId: command.commandId, ...outcome } });
      }
      if (command.type === 'inventory.count.cancel') {
        const outcome = { status: 'CONFIRMED', value: { countId, version: state.count?.version ?? 1, status: 'CANCELLED' } };
        state.outcomes.set(command.commandId, outcome);
        state.count = null;
        if (state.cancelMode === 'lost') { state.cancelMode = 'normal'; return route.abort('failed'); }
        return route.fulfill({ json: { commandId: command.commandId, ...outcome } });
      }
      return route.fulfill({ json: { commandId: command.commandId, status: 'REJECTED', message: 'Unexpected command.' } });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND' } } });
  });
  await page.goto('/');
  await expect(page.getByLabel('Signed in as Draft Manager')).toBeVisible();
  await openCountWorkspace(page);
  return state;
}

async function openCountWorkspace(page: Page) {
  const navigation = page.getByRole('button', { name: 'Count stock', exact: true });
  if (!await navigation.isVisible()) await page.getByRole('button', { name: 'More', exact: true }).click();
  await navigation.last().click();
  await expect(page.getByRole('heading', { name: 'Outlet count in progress' })).toBeVisible();
}

async function localDraftCount(page: Page): Promise<number> {
  return page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('mazao-v1-count-drafts', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const count = db.transaction('drafts', 'readonly').objectStore('drafts').count();
      count.onsuccess = () => { db.close(); resolve(count.result); };
      count.onerror = () => { db.close(); reject(count.error); };
    };
  }));
}

async function seedLocalDraft(page: Page, version: number, quantity: string, reason: string) {
  await page.evaluate(({ tenantId, actorId, outletId, countId, productId, version, quantity, reason }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('mazao-v1-count-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'key' });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('drafts', 'readwrite');
      tx.objectStore('drafts').put({ key: `${tenantId}:${actorId}:${outletId}:${countId}`, tenantId, actorId, outletId, countId, countVersion: version, revision: 1, updatedAt: new Date().toISOString(), lines: [{ productId, countedQuantity: quantity, varianceReason: reason }] });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), { tenantId, actorId: 'local-draft-actor', outletId, countId, productId, version, quantity, reason });
}

test('reload restores unsent edits; confirmed server save moves them out of the local draft', async ({ page }) => {
  const state = await fixture(page);
  await page.getByLabel('Counted quantity', { exact: true }).fill('8');
  await page.getByLabel('Reason for difference').fill('Damaged in storage');
  await expect(page.getByText(/Unsent changes are saved on this device/)).toBeVisible();
  expect(state.posts).toHaveLength(0);
  expect(await localDraftCount(page)).toBe(1);
  await page.reload();
  await openCountWorkspace(page);
  await expect(page.getByLabel('Counted quantity', { exact: true })).toHaveValue('8');
  await expect(page.getByLabel('Reason for difference')).toHaveValue('Damaged in storage');
  await expect(page.getByText(/Unsent count edits were restored from this device/)).toBeVisible();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Count draft saved.')).toBeVisible();
  expect(state.posts.map(command => command.type)).toEqual(['inventory.count.save']);
  expect(await localDraftCount(page)).toBe(0);
});

test('a stale server version opens review and never posts recovered edits automatically', async ({ page }) => {
  const state = await fixture(page, { version: 2 });
  await seedLocalDraft(page, 1, '7', 'Earlier shortage');
  await page.reload();
  await openCountWorkspace(page);
  const dialog = page.getByRole('dialog', { name: 'Review recovered count edits' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Saved for count version 1; current server version 2');
  await expect(dialog).toContainText('Earlier shortage');
  expect(state.posts).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Restore edits for review', exact: true }).click();
  await expect(page.getByLabel('Counted quantity', { exact: true })).toHaveValue('7');
  expect(state.posts).toHaveLength(0);
  expect(await localDraftCount(page)).toBe(1);
});

test('quota failure keeps edits visible, reports they are not durable, and supports a retry', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    const native = IDBObjectStore.prototype.put;
    (window as any).restoreCountDraftWrite = () => { IDBObjectStore.prototype.put = native; };
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'drafts') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return native.apply(this, args);
    };
  });
  await page.getByLabel('Counted quantity', { exact: true }).fill('6');
  await expect(page.getByRole('alert')).toContainText('not durably saved on this device');
  await expect(page.getByLabel('Counted quantity', { exact: true })).toHaveValue('6');
  await page.evaluate(() => (window as any).restoreCountDraftWrite());
  await page.getByRole('button', { name: 'Retry saving on this device', exact: true }).click();
  await expect(page.getByText(/Unsent changes are saved on this device/)).toBeVisible();
  expect(await localDraftCount(page)).toBe(1);
});

test('a blocked local store is retryable without losing on-screen edits', async ({ page }) => {
  await page.addInitScript(() => {
    const original = indexedDB.open.bind(indexedDB);
    (window as any).blockCountDraftOpen = true;
    (window as any).restoreCountDraftOpen = () => { (window as any).blockCountDraftOpen = false; };
    indexedDB.open = ((name: string, version?: number) => {
      if (name === 'mazao-v1-count-drafts' && (window as any).blockCountDraftOpen) throw new DOMException('Blocked storage', 'InvalidStateError');
      return original(name, version);
    }) as typeof indexedDB.open;
  });
  await fixture(page);
  await page.getByLabel('Counted quantity', { exact: true }).fill('5');
  await expect(page.getByRole('alert')).toContainText('not durably saved on this device');
  await page.evaluate(() => (window as any).restoreCountDraftOpen());
  await page.getByRole('button', { name: 'Retry saving on this device', exact: true }).click();
  await expect(page.getByText(/Unsent changes are saved on this device/)).toBeVisible();
  expect(await localDraftCount(page)).toBe(1);
});

test('two tabs compare revisions and require review before using another tab’s edits', async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await fixture(first);
  await fixture(second);
  await first.getByLabel('Counted quantity', { exact: true }).fill('8');
  await expect(first.getByText(/Unsent changes are saved on this device/)).toBeVisible();
  await second.getByLabel('Counted quantity', { exact: true }).fill('6');
  await expect(second.getByRole('alert')).toContainText('Another tab saved count edits first');
  await expect(second.getByLabel('Counted quantity', { exact: true })).toHaveValue('6');
  await second.getByRole('button', { name: 'Load latest edits from other tab', exact: true }).click();
  await expect(second.getByLabel('Counted quantity', { exact: true })).toHaveValue('8');
  await expect(second.getByText(/Loaded the latest edits saved by the other tab/)).toBeVisible();
});

test('actor change cannot read the prior actor’s local count draft', async ({ page }) => {
  const state = await fixture(page);
  await page.getByLabel('Counted quantity', { exact: true }).fill('4');
  await expect(page.getByText(/Unsent changes are saved on this device/)).toBeVisible();
  state.actorId = 'different-local-draft-actor';
  await page.reload();
  await openCountWorkspace(page);
  await expect(page.getByLabel('Counted quantity', { exact: true })).toHaveValue('');
  expect(await localDraftCount(page)).toBe(1);
});

test('an unknown save keeps the local draft until the original command is confirmed', async ({ page }) => {
  const state = await fixture(page, { saveMode: 'lost' });
  await page.getByLabel('Counted quantity', { exact: true }).fill('9');
  await expect(page.getByText(/Unsent changes are saved on this device/)).toBeVisible();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check status', exact: true })).toBeVisible();
  expect(await localDraftCount(page)).toBe(1);
  await page.getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Outlet count in progress' })).toBeVisible();
  await expect.poll(() => localDraftCount(page)).toBe(0);
  expect(state.posts.filter(command => command.type === 'inventory.count.save')).toHaveLength(1);
});

test('cancellation stays unavailable while unsent edits exist, then clears only after the server confirms', async ({ page }) => {
  const state = await fixture(page, { cancelMode: 'lost' });
  await page.getByLabel('Counted quantity', { exact: true }).fill('3');
  await expect(page.getByText(/Unsent changes are saved on this device/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel count', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Count draft saved.')).toBeVisible();
  expect(await localDraftCount(page)).toBe(0);
  await page.getByRole('button', { name: 'Cancel count', exact: true }).click();
  await page.getByRole('dialog', { name: 'Cancel this count?' }).getByRole('button', { name: 'Cancel count', exact: true }).click();
  const pendingDialog = page.getByRole('dialog', { name: 'Cancel this count?' });
  const check = pendingDialog.getByRole('button', { name: 'Check status', exact: true });
  await expect(check).toBeVisible();
  expect(state.posts.filter(command => command.type === 'inventory.count.cancel')).toHaveLength(1);
  await check.click();
  await expect(page.getByRole('heading', { name: 'No open outlet count' })).toBeVisible();
  expect(await localDraftCount(page)).toBe(0);
});
