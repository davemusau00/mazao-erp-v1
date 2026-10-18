import { expect, test, type Page } from '@playwright/test';

type Workspace = 'receiving' | 'count' | 'hotel' | 'shift';
const workspaces: Workspace[] = ['receiving', 'count', 'hotel', 'shift'];
const product = { id: 'readiness-product', sku: 'READY-1', name: 'Readiness item', unit: 'each', currency: 'KES', sellingPriceMinor: 1000, costPriceMinor: 100, taxRateBps: 0, quantity: '10', version: 1 };
const count = { id: 'readiness-count', status: 'OPEN', areaLabel: 'Saved baseline', version: 1, baselineAt: '2026-10-16T08:00:00Z', openedAt: '2026-10-16T08:00:00Z', openedBy: 'Readiness Manager', lineCount: 1, countedLineCount: 0, lines: [{ productId: product.id, sku: product.sku, name: product.name, unit: 'each', expectedQuantity: '10', expectedBalanceVersion: 1, countedQuantity: null, varianceReason: null }] };

async function session(page: Page, openCount = false) {
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    const bodies: Record<string, unknown> = {
      '/api/v1/auth/me': { user: { id: 'readiness-user', name: 'Readiness Manager', role: 'manager', email: 'readiness@example.invalid', permissions: ['inventory.receive', 'inventory.count', 'inventory.count.approve', 'catalog.manage', 'hotel.manage', 'hotel.frontdesk', 'hotel.housekeeping', 'shift.open', 'shift.close', 'shift.payout'] }, tenant: { id: 'readiness-tenant', name: 'Readiness Business', currency: 'KES', timeZone: 'Africa/Nairobi', capabilities: ['commerce', 'inventory', 'hospitality'] }, outlet: { id: 'readiness-outlet', name: 'Readiness Outlet', timeZone: 'Africa/Nairobi' }, deviceId: 'readiness-device', csrfToken: 'readiness-csrf' },
      '/api/v1/catalog/items': { items: [product] },
      '/api/v1/inventory/counts/current': { count: openCount ? count : null },
      '/api/v1/inventory/counts': { counts: [] },
      '/api/v1/shifts/current': { shift: null },
      '/api/v1/shifts/close-reports': { reports: [] },
      '/api/v1/hospitality/rooms': { rooms: [] },
      '/api/v1/hospitality/reservations': { reservations: [] },
      '/api/v1/hospitality/stays': { stays: [] },
    };
    return route.fulfill({ json: bodies[path] ?? {} });
  });
}

async function navigate(page: Page, workspace: Workspace) {
  await expect(page.getByLabel('Signed in as Readiness Manager')).toBeVisible();
  const label = { receiving: 'Purchasing', count: 'Count stock', hotel: 'Hotel', shift: 'Shifts' }[workspace];
  const name = new RegExp(`^${label}(?:, Limited)?$`);
  const button = page.getByRole('button', { name });
  if (!await button.isVisible()) await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name }).last().click();
}

function initialAction(page: Page, workspace: Workspace) {
  return workspace === 'receiving' ? page.getByLabel('Item', { exact: true }) : page.getByRole('button', { name: workspace === 'count' ? 'Start full count' : workspace === 'hotel' ? 'Add room' : 'Open shift', exact: true });
}

async function interceptJournalOpen(page: Page, mode: 'delay' | 'error', retained = false) {
  await page.addInitScript(({ mode, retained }) => {
    const state = window as typeof window & { recoveryMode: string; recoveryHeld?: boolean; releaseRecovery?: () => void };
    state.recoveryMode = mode;
    const original = indexedDB.open.bind(indexedDB);
    const success = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess')!;
    const upgrade = Object.getOwnPropertyDescriptor(IDBOpenDBRequest.prototype, 'onupgradeneeded')!;
    indexedDB.open = ((name: string, version?: number) => {
      const request = original(name, version);
      if (name !== 'mazao-v1-command-journal') return request;
      Object.defineProperty(request, 'onupgradeneeded', { set(callback) { upgrade.set!.call(request, (event: Event) => {
        callback.call(request, event);
        if (retained) request.transaction!.objectStore('commands').put({ command: { protocolVersion: 1, commandId: 'retained-receipt-readiness', tenantId: 'readiness-tenant', deviceId: 'readiness-device', type: 'inventory.receive', occurredAt: '2026-10-16T08:00:00Z', expectedVersions: {}, payload: { supplierName: 'Retained supplier', documentReference: 'RETAINED-DELIVERY', lines: [{ productId: 'readiness-product', quantity: '2', unitCostMinor: 100 }] } }, actorId: 'readiness-user', state: 'outcome_unknown', savedAt: '2026-10-16T08:00:00Z' });
      }); } });
      Object.defineProperty(request, 'onsuccess', { set(callback) { success.set!.call(request, (event: Event) => {
        if (state.recoveryMode === 'delay') { state.recoveryHeld = true; state.releaseRecovery = () => { state.recoveryMode = 'normal'; callback.call(request, event); }; }
        else if (state.recoveryMode === 'error') { request.result.close(); request.onerror?.call(request, new Event('error')); }
        else callback.call(request, event);
      }); } });
      return request;
    }) as typeof indexedDB.open;
  }, { mode, retained });
}

for (const workspace of workspaces) {
  test(`${workspace} waits for journal inspection before enabling writes`, async ({ page }) => {
    await interceptJournalOpen(page, 'delay'); await session(page); await page.goto('/'); await navigate(page, workspace);
    await expect(page.getByText('Checking for unfinished actions...')).toBeVisible();
    await expect(initialAction(page, workspace)).toBeDisabled();
    await expect.poll(() => page.evaluate(() => Boolean((window as any).recoveryHeld))).toBe(true);
    await page.evaluate(() => (window as any).releaseRecovery());
    await expect(initialAction(page, workspace)).toBeEnabled();
  });

  test(`${workspace} keeps writes blocked after journal open failure and supports retry`, async ({ page }) => {
    await interceptJournalOpen(page, 'error'); await session(page); await page.goto('/'); await navigate(page, workspace);
    await expect(page.getByRole('button', { name: 'Retry recovery check' })).toBeVisible();
    await expect(initialAction(page, workspace)).toBeDisabled();
    await page.evaluate(() => { (window as any).recoveryMode = 'normal'; });
    await page.getByRole('button', { name: 'Retry recovery check' }).click();
    await expect(initialAction(page, workspace)).toBeEnabled();
  });
}

test('retrying a failed journal open preserves the retained receipt and replays its exact original envelope', async ({ page }) => {
  await interceptJournalOpen(page, 'error', true); await session(page);
  const posts: any[] = [];
  await page.route('**/api/v1/commands/retained-receipt-readiness', route => route.fulfill({ status: 404, json: { error: { message: 'Original command not found.' } } }));
  await page.route('**/api/v1/commands', route => { posts.push(route.request().postDataJSON()); return route.fulfill({ json: { commandId: route.request().postDataJSON().commandId, status: 'CONFIRMED', value: { lineCount: 1, totalMinor: 200 } } }); });
  await page.goto('/'); await navigate(page, 'receiving');
  await page.evaluate(() => { (window as any).recoveryMode = 'normal'; });
  await page.getByRole('button', { name: 'Retry recovery check' }).click();
  const dialog = page.getByRole('dialog', { name: 'Review delivery receipt' });
  await expect(dialog).toContainText('Retained supplier');
  await expect(dialog).toContainText('RETAINED-DELIVERY');
  await expect(dialog.getByRole('button', { name: 'Post reviewed receipt', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Check receipt status', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toEqual({ protocolVersion: 1, commandId: 'retained-receipt-readiness', tenantId: 'readiness-tenant', deviceId: 'readiness-device', type: 'inventory.receive', occurredAt: '2026-10-16T08:00:00Z', expectedVersions: {}, payload: { supplierName: 'Retained supplier', documentReference: 'RETAINED-DELIVERY', lines: [{ productId: 'readiness-product', quantity: '2', unitCostMinor: 100 }] } });
});

async function prepareAction(page: Page, workspace: Workspace) {
  if (workspace === 'hotel') {
    await page.getByRole('button', { name: 'Add room', exact: true }).click();
    await page.getByLabel('Room number', { exact: true }).fill('101');
    await page.getByLabel('Nightly rate (KES)', { exact: true }).fill('10.00');
    return page.getByRole('button', { name: 'Create room', exact: true });
  }
  if (workspace === 'receiving') {
    await page.getByLabel('Item', { exact: true }).selectOption(product.id);
    await page.getByLabel('Cost per base unit (KES)', { exact: true }).fill('1.00');
    await page.getByRole('button', { name: 'Add item', exact: true }).click();
    await page.getByRole('button', { name: 'Review delivery', exact: true }).click();
    return page.getByRole('button', { name: 'Post reviewed receipt', exact: true });
  }
  return initialAction(page, workspace);
}

for (const workspace of workspaces) {
  test(`${workspace} retains one exact command through rapid activation and a failed local journal write`, async ({ page }) => {
    await session(page); const posts: any[] = [];
    await page.route('**/api/v1/commands/**', route => route.fulfill({ status: 404, json: { error: { message: 'Original command not found.' } } }));
    await page.route('**/api/v1/commands', route => { posts.push(route.request().postDataJSON()); return route.fulfill({ json: { commandId: route.request().postDataJSON().commandId, status: 'CONFIRMED', value: { lineCount: 1, totalMinor: 100, version: 1 } } }); });
    await page.goto('/'); await navigate(page, workspace); await expect(initialAction(page, workspace)).toBeEnabled();
    const action = await prepareAction(page, workspace);
    await page.evaluate(() => {
      const native = IDBObjectStore.prototype.put;
      (window as any).attemptedCommands = [];
      (window as any).restoreJournalWrite = () => { IDBObjectStore.prototype.put = native; };
      IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
        if (this.name === 'commands') { (window as any).attemptedCommands.push(args[0].command); throw new DOMException('Temporary storage quota failure', 'QuotaExceededError'); }
        return native.apply(this, args);
      };
    });
    await action.evaluate(element => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); element.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await expect(page.getByText(/This action was not sent because recovery details could not be saved/).first()).toBeVisible();
    expect(posts).toHaveLength(0);
    const attempted = await page.evaluate(() => (window as any).attemptedCommands);
    expect(attempted).toHaveLength(1);
    await page.evaluate(() => (window as any).restoreJournalWrite());
    const dialog = page.getByRole('dialog');
    const status = workspace === 'receiving' ? dialog.getByRole('button', { name: 'Check receipt status' }) : workspace === 'hotel' ? dialog.getByRole('button', { name: 'Check status' }) : page.getByRole('button', { name: 'Check status' });
    await expect(status).toBeEnabled();
    await status.evaluate(element => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); element.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual(attempted[0]);
    await expect(page.getByText(/This action was not sent because recovery details could not be saved/)).toHaveCount(0);
    expect(posts[0].type).toBe({ receiving: 'inventory.receive', count: 'inventory.count.open', hotel: 'hotel.room.create', shift: 'shift.open' }[workspace]);
    const remaining = await page.evaluate(async () => new Promise<number>((resolve, reject) => {
      const open = indexedDB.open('mazao-v1-command-journal', 1);
      open.onsuccess = () => { const db = open.result; const request = db.transaction('commands', 'readonly').objectStore('commands').count(); request.onsuccess = () => { db.close(); resolve(request.result); }; request.onerror = () => reject(request.error); };
    }));
    expect(remaining).toBe(0);
  });
}

test('unsaved count edits require leave confirmation and guard browser unload; saved draft remains available', async ({ page }) => {
  await session(page, true); await page.goto('/'); await navigate(page, 'count');
  await expect(page.getByLabel('Counted quantity', { exact: true })).toBeEnabled();
  await page.getByLabel('Counted quantity', { exact: true }).fill('9');
  await page.getByLabel('Reason for difference').fill('Damaged bag');
  expect(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); return !window.dispatchEvent(event); })).toBe(true);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Shifts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Outlet count in progress' })).toBeVisible();
  await expect(page.getByLabel('Counted quantity', { exact: true })).toHaveValue('9');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Shifts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cash control' })).toBeVisible();
  await navigate(page, 'count');
  await expect(page.getByRole('heading', { name: 'Outlet count in progress' })).toBeVisible();
  await expect(page.getByLabel('Counted quantity', { exact: true })).toHaveValue('');
});
