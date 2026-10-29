import { expect, test, type Page } from '@playwright/test';

const productId = '00000000-0000-4000-8000-000000000101';
const emptyId = '00000000-0000-4000-8000-000000000102';
const foodId = '00000000-0000-4000-8000-000000000201';
const lowerFoodId = '00000000-0000-4000-8000-000000000202';
const newCategoryId = '00000000-0000-4000-8000-000000000203';
const tenantId = '00000000-0000-4000-8000-000000000301';
const deviceId = '00000000-0000-4000-8000-000000000302';
const userId = '00000000-0000-4000-8000-000000000303';
type Command = { commandId: string; type: string; payload: Record<string, any>; expectedVersions: Record<string, number> };

async function fixture(page: Page, permissions = ['catalog.manage', 'inventory.receive']) {
  const items = [
    { id: productId, name: 'Original item', sku: 'ORIGINAL-1', unit: 'each', currency: 'KES', sellingPriceMinor: 12500, costPriceMinor: 8000, taxRateBps: 1600, quantity: '3', inventoryValueMinor: '24000', productVersion: 7, version: 3, category: 'Food', categoryId: foodId, barcode: '0012345', reorderLevel: '2', active: true },
    { id: emptyId, name: 'Empty item', sku: 'EMPTY-1', unit: 'each', currency: 'KES', sellingPriceMinor: 1000, costPriceMinor: 400, taxRateBps: 0, quantity: '0', inventoryValueMinor: '0', productVersion: 2, version: 1, category: 'food', categoryId: lowerFoodId, barcode: null, reorderLevel: '0', active: true },
  ];
  const categories = [
    { id: foodId, name: 'Food', active: true, version: 4, mergedInto: null as string | null, productCount: 1, activeProductCount: 1 },
    { id: lowerFoodId, name: 'food', active: true, version: 6, mergedInto: null as string | null, productCount: 1, activeProductCount: 1 },
  ];
  const posts: Command[] = [], reads: string[] = [];
  const confirmed = new Map<string, Record<string, unknown>>();
  const state = { mode: 'normal' as 'normal' | 'lost-after-commit' | 'never-arrived' | 'conflict' };
  const apply = (command: Command) => {
    const p = command.payload;
    let value: Record<string, unknown>;
    if (command.type === 'catalog.product.update') {
      const item = items.find(row => row.id === p.productId)!;
      Object.assign(item, { name: p.name, sellingPriceMinor: p.sellingPriceMinor, costPriceMinor: p.costPriceMinor, taxRateBps: p.taxRateBps, category: p.category, categoryId: categories.find(row => row.name === p.category)?.id ?? null, barcode: p.barcode, reorderLevel: p.reorderLevel, productVersion: item.productVersion + 1 });
      value = { productId: item.id, version: item.productVersion, active: item.active };
    } else if (command.type === 'catalog.product.set_active') {
      const item = items.find(row => row.id === p.productId)!;
      item.active = p.active; item.productVersion++;
      categories.find(row => row.id === item.categoryId)!.activeProductCount = item.active ? 1 : 0;
      value = { productId: item.id, version: item.productVersion, active: item.active };
    } else if (command.type === 'catalog.category.create') {
      categories.push({ id: newCategoryId, name: p.name, active: true, version: 1, mergedInto: null, productCount: 0, activeProductCount: 0 });
      value = { categoryId: newCategoryId, version: 1, active: true };
    } else if (command.type === 'catalog.category.merge') {
      const source = categories.find(row => row.id === p.sourceCategoryId)!, target = categories.find(row => row.id === p.targetCategoryId)!;
      let updatedProducts = 0;
      for (const item of items.filter(row => row.categoryId === source.id)) { item.categoryId = target.id; item.category = target.name; item.productVersion++; updatedProducts++; }
      target.productCount += source.productCount; target.activeProductCount += source.activeProductCount;
      source.productCount = 0; source.activeProductCount = 0; source.active = false; source.mergedInto = target.id; source.version++; target.version++;
      value = { sourceCategoryId: source.id, targetCategoryId: target.id, sourceVersion: source.version, targetVersion: target.version, updatedProducts };
    } else if (command.type === 'catalog.category.update' || command.type === 'catalog.category.set_active') {
      const category = categories.find(row => row.id === p.categoryId)!;
      if (command.type === 'catalog.category.update') { category.name = p.name; for (const item of items.filter(row => row.categoryId === category.id)) { item.category = p.name; item.productVersion++; } }
      else category.active = p.active;
      category.version++;
      value = { categoryId: category.id, version: category.version, active: category.active };
    } else {
      const id = '00000000-0000-4000-8000-000000000104';
      items.push({ id, name: p.name, sku: p.sku, unit: p.baseUnit, currency: p.currency, sellingPriceMinor: p.sellingPriceMinor, costPriceMinor: p.costPriceMinor, taxRateBps: p.taxRateBps ?? 1600, quantity: '0', inventoryValueMinor: '0', productVersion: 1, version: 1, category: p.category, categoryId: categories.find(category => category.name === p.category)?.id ?? '', barcode: p.barcode, reorderLevel: p.reorderLevel, active: true });
      value = { productId: id, sku: p.sku };
    }
    const result = { commandId: command.commandId, status: 'CONFIRMED', value };
    confirmed.set(command.commandId, result);
    return result;
  };
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/me') return route.fulfill({ json: { user: { id: userId, name: 'Catalog operator', email: 'catalog@example.invalid', role: 'manager', permissions }, tenant: { id: tenantId, name: 'Catalog business', currency: 'KES', timeZone: 'Africa/Nairobi', capabilities: ['inventory', 'commerce'] }, outlet: { id: '00000000-0000-4000-8000-000000000304', name: 'Catalog outlet', timeZone: 'Africa/Nairobi' }, deviceId, csrfToken: 'catalog-csrf' } });
    if (path === '/catalog/items') { reads.push(url.pathname + url.search); return route.fulfill({ json: { items: items.filter(row => row.active || url.searchParams.get('includeArchived') === 'true') } }); }
    if (path === '/catalog/categories') return route.fulfill({ json: { categories: categories.filter(row => row.active || url.searchParams.get('includeArchived') === 'true') } });
    if (path === '/inventory/movements') return route.fulfill({ json: { movements: [] } });
    if (path.startsWith('/commands/')) {
      const id = path.split('/').at(-1)!;
      return confirmed.has(id) ? route.fulfill({ json: { commandId: id, status: 'CONFIRMED', response: confirmed.get(id) } }) : route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND' } } });
    }
    if (path === '/commands') {
      const command: Command = route.request().postDataJSON(); posts.push(command);
      if (state.mode === 'never-arrived') { state.mode = 'normal'; return route.abort('failed'); }
      if (state.mode === 'conflict') {
        state.mode = 'normal'; items[0].name = 'Updated elsewhere'; items[0].productVersion = 9;
        return route.fulfill({ json: { commandId: command.commandId, status: 'CONFLICT', code: 'VERSION_CONFLICT' } });
      }
      const result = apply(command);
      if (state.mode === 'lost-after-commit') { state.mode = 'normal'; return route.abort('failed'); }
      return route.fulfill({ json: result });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND' } } });
  });
  return { items, categories, posts, reads, state };
}

async function openMaintenance(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Stock', exact: true }).last().click();
  const open = page.getByRole('button', { name: 'Manage items and categories', exact: true });
  if (await open.isVisible()) await open.click();
  await expect(page.getByRole('heading', { name: 'Manage items and categories' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit Original item', exact: true })).toBeEnabled();
}

for (const viewport of [{ width: 1024, height: 600 }, { width: 390, height: 844 }]) {
  test(`item metadata uses the product version and keeps confirmation reachable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport); const { posts, items } = await fixture(page);
    await openMaintenance(page);
    await expect(page.getByRole('button', { name: 'Archive Original item', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Edit Original item', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit item', exact: true });
    await dialog.getByLabel('Item name', { exact: true }).fill('Reviewed item');
    await dialog.getByLabel('Selling price (KES)', { exact: true }).fill('150.25');
    await dialog.getByLabel('Reference cost per unit (KES)', { exact: true }).fill('91.10');
    await dialog.getByLabel('Tax rate (%)', { exact: true }).fill('7.50');
    await dialog.getByLabel('Barcode', { exact: true }).fill('000987654');
    await dialog.getByLabel('Reorder level', { exact: true }).fill('2.125');
    await dialog.getByRole('combobox', { name: 'Category', exact: true }).selectOption('food');
    await dialog.getByLabel('Reason for change', { exact: true }).fill('Reviewed supplier price and category');
    const save = dialog.getByRole('button', { name: 'Save item changes', exact: true });
    await expect(save).toBeInViewport(); expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await save.click(); await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Reviewed item', exact: true })).toBeVisible();
    expect(posts[0]).toMatchObject({ type: 'catalog.product.update', expectedVersions: { [`product:${productId}`]: 7 }, payload: { productId, name: 'Reviewed item', sellingPriceMinor: 15025, costPriceMinor: 9110, taxRateBps: 750, barcode: '000987654', reorderLevel: '2.125', category: 'food', reason: 'Reviewed supplier price and category' } });
    expect(Object.keys(posts[0].payload).sort()).toEqual(['productId', 'name', 'sellingPriceMinor', 'costPriceMinor', 'taxRateBps', 'barcode', 'reorderLevel', 'category', 'reason'].sort());
    expect(items[0].quantity).toBe('3'); expect(items[0].inventoryValueMinor).toBe('24000');
  });
}

test('zero-stock archive and restore require reasons and read archived records explicitly', async ({ page }) => {
  const { posts, reads } = await fixture(page); await openMaintenance(page);
  await page.getByRole('button', { name: 'Archive Empty item', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Change item availability' });
  await dialog.getByLabel('Reason for change').fill('   '); await dialog.getByRole('button', { name: 'Archive item', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Give a reason for this change.'); expect(posts).toHaveLength(0);
  await dialog.getByLabel('Reason for change').fill('R'); await dialog.getByRole('button', { name: 'Archive item', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Empty item', exact: true })).toHaveCount(0);
  await page.getByLabel('Include archived', { exact: true }).check();
  await page.getByRole('button', { name: 'Restore Empty item', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Change item availability' });
  await dialog.getByLabel('Reason for change').fill('Resume current listing'); await dialog.getByRole('button', { name: 'Restore item', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Archive Empty item', exact: true })).toBeEnabled();
  expect(posts.map(command => [command.payload.active, command.expectedVersions[`product:${emptyId}`]])).toEqual([[false, 2], [true, 3]]);
  expect(posts[0].payload.reason).toBe('R');
  expect(reads).toContain('/api/v1/catalog/items?includeArchived=true');
});

test('category labels remain distinct and create rename archive restore and merge use their exact versions', async ({ page }) => {
  const { posts } = await fixture(page); await openMaintenance(page); await page.getByRole('button', { name: 'Categories', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Food', exact: true })).toBeVisible(); await expect(page.getByRole('heading', { name: 'food', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Archive Food', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Add category', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Create category', exact: true }); await dialog.getByLabel('Category name').fill('FOOD'); await dialog.getByRole('button', { name: 'Create category', exact: true }).click();
  await page.getByRole('button', { name: 'Rename FOOD', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Rename category', exact: true }); await dialog.getByLabel('Category name').fill('General goods'); await dialog.getByLabel('Reason for change').fill('Reviewed display label'); await dialog.getByRole('button', { name: 'Rename category', exact: true }).click();
  await page.getByRole('button', { name: 'Archive General goods', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Change category availability' }); await dialog.getByLabel('Reason for change').fill('Retire unused category'); await dialog.getByRole('button', { name: 'Archive category', exact: true }).click();
  await page.getByLabel('Include archived', { exact: true }).check(); await page.getByRole('button', { name: 'Rename General goods', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Rename category', exact: true }); await dialog.getByLabel('Category name').fill('Reviewed goods'); await dialog.getByLabel('Reason for change').fill('R'); await dialog.getByRole('button', { name: 'Rename category', exact: true }).click();
  await page.getByRole('button', { name: 'Restore Reviewed goods', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Change category availability' }); await dialog.getByLabel('Reason for change').fill('Use category again'); await dialog.getByRole('button', { name: 'Restore category', exact: true }).click();
  await page.getByRole('button', { name: 'Merge food', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Merge categories', exact: true }); await dialog.getByLabel('Destination category').selectOption(foodId); await dialog.getByLabel('Reason for change').fill('Reviewed duplicate case variant'); await dialog.getByRole('button', { name: 'Merge categories', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restore food', exact: true })).toBeDisabled();
  expect(posts.map(command => command.type)).toEqual(['catalog.category.create', 'catalog.category.update', 'catalog.category.set_active', 'catalog.category.update', 'catalog.category.set_active', 'catalog.category.merge']);
  expect(posts[1].expectedVersions).toEqual({ [`category:${newCategoryId}`]: 1 });
  expect(posts[3]).toMatchObject({ payload: { categoryId: newCategoryId, name: 'Reviewed goods', reason: 'R' }, expectedVersions: { [`category:${newCategoryId}`]: 3 } });
  expect(posts[4].expectedVersions).toEqual({ [`category:${newCategoryId}`]: 4 });
  expect(posts[5]).toMatchObject({ payload: { sourceCategoryId: lowerFoodId, targetCategoryId: foodId, reason: 'Reviewed duplicate case variant' }, expectedVersions: { [`category:${lowerFoodId}`]: 6, [`category:${foodId}`]: 4 } });
});

for (const mode of ['lost-after-commit', 'never-arrived'] as const) {
  test(`${mode} item change restores values after restart and resolves the original command`, async ({ page }) => {
    const { posts, state } = await fixture(page); await openMaintenance(page); state.mode = mode;
    await page.getByRole('button', { name: 'Edit Original item', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Edit item', exact: true });
    await dialog.getByLabel('Selling price (KES)', { exact: true }).fill('199.95'); await dialog.getByLabel('Reason for change').fill('Reviewed retained change');
    await dialog.getByRole('button', { name: 'Save item changes', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Check change status', exact: true })).toBeEnabled();
    const original = structuredClone(posts[0]);
    await page.reload(); await page.getByRole('button', { name: 'Stock', exact: true }).last().click();
    dialog = page.getByRole('dialog', { name: 'Edit item', exact: true });
    await expect(dialog.getByLabel('Selling price (KES)', { exact: true })).toHaveValue('199.95'); await expect(dialog.getByLabel('Selling price (KES)', { exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Check change status', exact: true }).click();
    await expect(dialog).toHaveCount(0); await expect(page.getByRole('status').filter({ hasText: 'Item change confirmed' })).toBeVisible();
    expect(posts).toHaveLength(mode === 'never-arrived' ? 2 : 1);
    if (mode === 'never-arrived') expect(posts[1]).toEqual(original);
    const retained = await page.evaluate(async () => new Promise<any[]>((resolve, reject) => { const request = indexedDB.open('mazao-v1-command-journal', 1); request.onerror = () => reject(request.error); request.onsuccess = () => { const read = request.result.transaction('commands').objectStore('commands').getAll(); read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error); }; }));
    expect(retained).toEqual([]);
  });
}

test('a version conflict keeps entered values until explicit reload and the next edit uses the new version', async ({ page }) => {
  const { posts, state } = await fixture(page); await openMaintenance(page); state.mode = 'conflict';
  await page.getByRole('button', { name: 'Edit Original item', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Edit item', exact: true }); await dialog.getByLabel('Item name', { exact: true }).fill('Desired name'); await dialog.getByLabel('Reason for change').fill('Reviewed desired change'); await dialog.getByRole('button', { name: 'Save item changes', exact: true }).click();
  await expect(dialog.getByLabel('Item name', { exact: true })).toHaveValue('Desired name'); await expect(dialog.getByLabel('Item name', { exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Discard edits and reload latest data' }).click();
  await page.getByRole('button', { name: 'Edit Updated elsewhere', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'Edit item', exact: true });
  await expect(dialog.getByLabel('Item name', { exact: true })).toHaveValue('Updated elsewhere'); await dialog.getByLabel('Reason for change').fill('Reviewed current server values'); await dialog.getByRole('button', { name: 'Save item changes', exact: true }).click();
  await expect.poll(() => posts.length).toBe(2); expect(posts[1].expectedVersions[`product:${productId}`]).toBe(9); expect(posts[1].commandId).not.toBe(posts[0].commandId);
});

test('the original Add item entry supports category barcode and reorder defaults and returns to Stock', async ({ page }) => {
  const { posts } = await fixture(page); await page.goto('/'); await page.getByRole('button', { name: 'Stock', exact: true }).click(); await page.getByRole('button', { name: 'Add item', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create item', exact: true });
  await dialog.getByLabel('Item name', { exact: true }).fill('Created item'); await dialog.getByLabel('SKU', { exact: true }).fill('000-CREATED'); await dialog.getByLabel('Selling price (KES)', { exact: true }).fill('45.50'); await dialog.getByLabel('Reference cost per unit (KES)', { exact: true }).fill('31.25'); await dialog.getByLabel('Barcode', { exact: true }).fill('000123456789'); await dialog.getByLabel('Reorder level', { exact: true }).fill('1.5'); await dialog.getByRole('combobox', { name: 'Category', exact: true }).selectOption('Food');
  await dialog.getByRole('button', { name: 'Create item', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Items and stock', exact: true })).toBeVisible(); await expect(page.getByRole('status').filter({ hasText: 'Item created' })).toBeVisible();
  expect(posts[0]).toMatchObject({ type: 'catalog.product.create', payload: { name: 'Created item', sku: '000-CREATED', baseUnit: 'each', sellingPriceMinor: 4550, costPriceMinor: 3125, barcode: '000123456789', reorderLevel: '1.5', category: 'Food', currency: 'KES' } });
  expect(posts[0].payload).not.toHaveProperty('taxRateBps');
});

test('receiving access does not expose catalog management or archived catalog reads', async ({ page }) => {
  const { reads } = await fixture(page, ['inventory.receive']); await page.goto('/'); await page.getByRole('button', { name: 'Stock', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Items and stock' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Manage items and categories' })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Add item', exact: true })).toHaveCount(0);
  expect(reads.some(path => path.includes('includeArchived'))).toBe(false);
});

async function holdDialogFocusFrames(page:Page) {
  await page.evaluate(()=>{
    const testWindow=window as typeof window & {
      queuedDialogFocusFrames:()=>number;
      releaseDialogFocusFrames:()=>void;
    };
    const requestFrame=window.requestAnimationFrame.bind(window);
    const cancelFrame=window.cancelAnimationFrame.bind(window);
    const queued=new Map<number,FrameRequestCallback>();
    let holding=true,nextId=1_000_000_000;
    window.requestAnimationFrame=callback=>{
      if(!holding)return requestFrame(callback);
      const id=nextId++;queued.set(id,callback);return id;
    };
    window.cancelAnimationFrame=id=>{queued.delete(id);cancelFrame(id);};
    testWindow.queuedDialogFocusFrames=()=>queued.size;
    testWindow.releaseDialogFocusFrames=()=>{
      holding=false;const callbacks=[...queued.values()];queued.clear();
      for(const callback of callbacks)callback(performance.now());
    };
  });
}
const queuedDialogFocusFrames=(page:Page)=>page.evaluate(()=>(window as typeof window & {queuedDialogFocusFrames:()=>number}).queuedDialogFocusFrames());
const releaseDialogFocusFrames=(page:Page)=>page.evaluate(()=>(window as typeof window & {releaseDialogFocusFrames:()=>void}).releaseDialogFocusFrames());

test('queued dialog focus preserves an operator already typing their first field',async({page})=>{
  await fixture(page);await openMaintenance(page);await holdDialogFocusFrames(page);
  try {
    await page.getByRole('button',{name:'Add item',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Create item',exact:true});
    const name=dialog.getByLabel('Item name',{exact:true});
    await expect.poll(()=>queuedDialogFocusFrames(page)).toBeGreaterThan(0);
    await name.focus();await page.keyboard.insertText('First');
    await releaseDialogFocusFrames(page);
    const retainedFocus=await name.evaluate(element=>document.activeElement===element);
    await page.keyboard.insertText(' entry');
    expect.soft(retainedFocus).toBe(true);
    await expect(name).toHaveValue('First entry');
  }finally{await releaseDialogFocusFrames(page);}
});

test('dialog initial focus and close restoration cancel a still queued focus callback',async({page})=>{
  await fixture(page);await openMaintenance(page);
  const add=page.getByRole('button',{name:'Add item',exact:true});
  await add.click();
  let dialog=page.getByRole('dialog',{name:'Create item',exact:true});
  await expect(dialog.getByRole('button',{name:'Close dialog',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(add).toBeFocused();
  await holdDialogFocusFrames(page);
  try {
    await add.click();dialog=page.getByRole('dialog',{name:'Create item',exact:true});
    await expect.poll(()=>queuedDialogFocusFrames(page)).toBeGreaterThan(0);
    await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
    await expect(add).toBeFocused();await expect.poll(()=>queuedDialogFocusFrames(page)).toBe(0);
    await releaseDialogFocusFrames(page);await expect(add).toBeFocused();
  }finally{await releaseDialogFocusFrames(page);}
});
