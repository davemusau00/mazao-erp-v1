import { expect, test, type Page } from '@playwright/test';
import type { BackendCommand, BackendProduct } from '../src/services/apiClient';

const stockedId = '00000000-0000-4000-8000-000000001001';
const serviceId = '00000000-0000-4000-8000-000000001002';
const preparedId = '00000000-0000-4000-8000-000000001003';
const tenantId = '00000000-0000-4000-8000-000000001004';
const deviceId = '00000000-0000-4000-8000-000000001005';
const userId = '00000000-0000-4000-8000-000000001006';
const shift = { id: 'kind-shift', status: 'OPEN', openingFloatMinor: 10000, cashSalesMinor: 0, customerCollectionsMinor: 0, cashRefundsMinor: 0, cashPaidInMinor: 0, cashPayoutMinor: 0, expectedCashMinor: 10000, version: 2, openedAt: '2026-10-25T08:00:00Z', cashMovements: [] };

async function fixture(page: Page, inventory = true, commerce = true) {
  const base = { unit: 'each', currency: 'KES', sellingPriceMinor: 1000, costPriceMinor: 500, taxRateBps: 0, category: '', categoryId: null, barcode: null, reorderLevel: '0', active: true };
  const items: BackendProduct[] = [
    { ...base, id: stockedId, sku: 'STOCKED', name: 'Stocked item', itemKind: 'STOCKED_GOOD', stockTracked: true, quantity: '0', inventoryValueMinor: '0', version: 3, balanceVersion: 3, productVersion: 7 },
    { ...base, id: serviceId, sku: 'SERVICE', name: 'Consultation', itemKind: 'SERVICE', stockTracked: false, quantity: null, inventoryValueMinor: null, version: null, balanceVersion: null, productVersion: 4 },
    { ...base, id: preparedId, sku: 'PREPARED', name: 'Prepared meal', itemKind: 'PREPARED', stockTracked: false, quantity: null, inventoryValueMinor: null, version: null, balanceVersion: null, productVersion: 6 },
  ];
  if (!inventory) { items[0].quantity = null; items[0].inventoryValueMinor = null; items[0].version = null; }
  const posts: BackendCommand[] = [], reads: string[] = [], saleSearches: string[] = [];
  const confirmed = new Map<string, object>();
  const inventoryRefunds=new Set<string>();
  const state = { mode: 'normal' as 'normal' | 'lost' | 'open-count', inventoryEnabled: inventory, hideSaleFromFirstPage: false };
  const receipt = { status: 'CONFIRMED', fiscalDocumentStatus: 'NOT_INTEGRATED', receiptId: 'service-sale', receiptNumber: 'SERVICE-001', tenantName: 'Services business', outletName: 'Services outlet', timeZone: 'Africa/Nairobi', currency: 'KES', createdAt: '2026-10-25T09:00:00Z', operatorName: 'Kind operator', saleStatus: 'CONFIRMED', lines: [{ lineId: 'service-line', sku: 'SERVICE', name: 'Consultation', itemKind: 'SERVICE', quantity: '1', unitPriceMinor: '1000', taxRateBps: 0, subtotalMinor: '1000', taxMinor: '0', totalMinor: '1000' }], payments: [{ method: 'CASH', amountMinor: '1000', currency: 'KES', status: 'confirmed' }], subtotalMinor: '1000', taxMinor: '0', totalMinor: '1000', amountPaidMinor: '1000', customerAccountCharge: null, cashTenderedMinor: '1000', changeMinor: '0' };
  const order = { id: 'service-sale', orderNumber: 'SERVICE-001', timestamp: '2026-10-25T09:00:00Z', cashierName: 'Kind operator', currency: 'KES', subtotalMinor: 1000, taxMinor: 0, totalMinor: 1000, paidMinor: 1000, amountDueMinor: 0, customerName: null, refundedMinor: 0, status: 'completed', paymentMethod: 'cash', lines: [{ ...receipt.lines[0], productId: serviceId, refundedQuantity: '0' }] };
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname.replace('/api/v1', '');
    if (route.request().method() === 'GET') reads.push(path);
    if (path === '/auth/me') return route.fulfill({ json: { user: { id: userId, name: 'Kind operator', email: 'kinds@example.invalid', role: 'admin', permissions: ['catalog.manage', 'commerce.sell', 'commerce.refund', 'inventory.receive', 'shift.open', 'shift.close', 'config.view', 'config.manage'] }, tenant: { id: tenantId, name: 'Services business', currency: 'KES', timeZone: 'Africa/Nairobi', capabilities: [...(commerce ? ['commerce'] : []), ...(state.inventoryEnabled ? ['inventory'] : [])] }, outlet: { id: 'kind-outlet', name: 'Services outlet', timeZone: 'Africa/Nairobi' }, deviceId, csrfToken: 'kind-csrf' } });
    if (path === '/catalog/items') return route.fulfill({ json: { items } });
    if (path === '/catalog/categories') return route.fulfill({ json: { categories: [] } });
    if (path === '/inventory/movements') return route.fulfill({ json: { movements: [] } });
    if (path === '/catalog/imports') return route.fulfill({ json: { batches: [] } });
    if (path === '/configuration') return route.fulfill({ json: { configuration: { business: { id: tenantId, name: 'Services business', currency: 'KES', timeZone: 'Africa/Nairobi', version: 3, legalName: '', registrationNumber: '', taxRegistrationNumber: '', address: '', phone: '', email: '', website: '', logoUrl: '', receiptQrImage: '', showQrOnReceipt: false, receiptHeader: '', receiptFooter: '', taxPolicy: { calculation: 'exclusive', defaultRateBps: 0, label: 'Tax', reviewed: true } }, outlet: { id: 'kind-outlet', name: 'Services outlet', timeZone: 'Africa/Nairobi', version: 1, address: '', phone: '', email: '', receiptHeader: '', receiptFooter: '' }, capabilities: inventory ? ['commerce', 'inventory'] : ['commerce'], supportedCapabilities: ['commerce', 'inventory', 'retail', 'hospitality'], currencyLocked: true, readiness: { readyForFirstSale: true, checks: [{ key: 'catalog', label: 'Sellable service available', complete: true, detail: 'Service pricing is ready without inventory.' }] } } } });
    if (path === '/shifts/current') return route.fulfill({ json: { shift } });
    if (path === '/configuration/stock-sale-policy') return state.inventoryEnabled
      ?route.fulfill({ json: { policy: { enabled: true, requirePhysicalConfirmation: true, requireReason: true, allowZeroReferenceCost: true, version: 1 } } })
      :route.fulfill({status:403,json:{error:{code:'CAPABILITY_DISABLED',message:'Inventory is required for stock-sale policy.'}}});
    if (path === '/sales/orders') {
      const search=url.searchParams.get('q')??'';saleSearches.push(search);
      return route.fulfill({ json: { orders: state.hideSaleFromFirstPage&&search!==order.id?[]:[order] } });
    }
    if (path === '/sales/orders/service-sale/receipt') return route.fulfill({ json: receipt });
    if (path.startsWith('/commands/')) {
      const commandId = path.split('/').at(-1)!;
      if(inventoryRefunds.has(commandId)&&!state.inventoryEnabled)return route.fulfill({status:403,json:{error:{code:'CAPABILITY_DISABLED',message:'Inventory is required to recover this original stocked refund.'}}});
      return confirmed.has(commandId) ? route.fulfill({ json: { commandId, status: 'CONFIRMED', response: confirmed.get(commandId) } }) : route.fulfill({ status: 404, json: { code: 'NOT_FOUND' } });
    }
    if (path === '/commands') {
      const command: BackendCommand = route.request().postDataJSON(); posts.push(command);
      const p = command.payload;
      if (state.mode === 'open-count') { state.mode = 'normal'; return route.fulfill({ json: { commandId: command.commandId, status: 'REJECTED', code: 'OPEN_COUNT_CONFLICT' } }); }
      if(command.type==='sales.order.refund'&&(p.lines as Array<{orderLineId:string}>).some(entry=>{
        const original=order.lines.find(line=>line.lineId===entry.orderLineId);
        return original&&(original.itemKind===undefined||original.itemKind==='STOCKED_GOOD');
      }))inventoryRefunds.add(command.commandId);
      let value: object;
      if (command.type === 'catalog.product.change_kind') {
        const item = items.find(row => row.id === p.productId)!;
        item.itemKind = p.itemKind as BackendProduct['itemKind']; item.stockTracked = p.itemKind === 'STOCKED_GOOD'; item.productVersion!++;
        item.quantity = item.stockTracked ? '0' : null; item.inventoryValueMinor = item.stockTracked ? '0' : null;
        item.balanceVersion = item.stockTracked ? item.balanceVersion ?? 1 : item.balanceVersion; item.version = item.stockTracked ? item.balanceVersion! : null;
        value = { productId: item.id, itemKind: item.itemKind, stockTracked: item.stockTracked, version: item.productVersion };
      } else if (command.type === 'catalog.product.create') value = { productId: '00000000-0000-4000-8000-000000001007', sku: p.sku };
      else if (command.type === 'sales.order.settle') value = { saleId: 'service-sale' };
      else {
        for (const entry of p.lines as Array<{ orderLineId: string; quantity: string }>) {
          const line = order.lines.find(row => row.lineId === entry.orderLineId)!;
          line.refundedQuantity = entry.quantity;
        }
        order.refundedMinor = 1000; order.status = order.lines.every(line => line.refundedQuantity === line.quantity) ? 'refunded' : 'partially_refunded';
        value = { refundId: 'kind-refund', totalMinor: '1000' };
      }
      const result = { commandId: command.commandId, status: 'CONFIRMED', value }; confirmed.set(command.commandId, result);
      if (state.mode === 'lost') { state.mode = 'normal'; return route.abort('failed'); }
      return route.fulfill({ json: result });
    }
    return route.fulfill({ status: 404, json: { code: 'UNEXPECTED_ENDPOINT' } });
  });
  return { items, posts, reads, saleSearches, state, order };
}

async function savedRefundCommands(page: Page) {
  return page.evaluate(async () => {
    const database=await new Promise<IDBDatabase>((resolve,reject)=>{
      const request=indexedDB.open('mazao-v1-command-journal',1);
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    try{return await new Promise<BackendCommand[]>((resolve,reject)=>{
      const request=database.transaction('commands').objectStore('commands').getAll();
      request.onsuccess=()=>resolve(request.result.map((record:{command:BackendCommand})=>record.command));
      request.onerror=()=>reject(request.error);
    });}finally{database.close();}
  });
}

async function navigateCatalog(page: Page) {
  await expect(page.getByLabel('Signed in as Kind operator')).toBeVisible();
  if (!await page.getByRole('button', { name: 'Items and services', exact: true }).isVisible()) await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Items and services', exact: true }).last().click();
}
async function openCatalog(page: Page) {
  await page.goto('/'); await navigateCatalog(page);
  await expect(page.getByRole('button', { name: 'Edit Consultation', exact: true })).toBeEnabled();
}

test('commerce-only manager reaches catalog and creates a service without inventory reads or invented stock', async ({ page }) => {
  const { reads, posts } = await fixture(page, false); await openCatalog(page);
  await expect(page.getByRole('button', { name: 'Stock, Not enabled', exact: true })).toBeDisabled();
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Consultation', exact: true }) });
  await expect(card.getByText('No category · No stock tracking')).toBeVisible();
  await expect(card.getByText(/recorded/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create item', exact: true });
  await expect(dialog.getByRole('combobox', { name: 'Item type', exact: true })).toHaveValue('SERVICE');
  await dialog.getByLabel('Item name', { exact: true }).fill('Reviewed consultation'); await dialog.getByLabel('SKU', { exact: true }).fill('000SERVICE'); await dialog.getByLabel('Selling price (KES)').fill('25');
  await dialog.getByRole('button', { name: 'Create item', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1); expect(posts[0].payload).toMatchObject({ sku: '000SERVICE', itemKind: 'SERVICE', sellingPriceMinor: 2500 });
  await expect(page.getByRole('status').filter({ hasText: 'Service created for future sales.' })).toBeVisible();
  expect(reads.filter(path => path.startsWith('/inventory/') || path === '/configuration/stock-sale-policy')).toEqual([]);
});

test('services sell without inventory or shortfall confirmation while prepared items remain unavailable', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  const { reads, posts } = await fixture(page, false); await page.goto('/'); await page.getByRole('button', { name: 'Sell', exact: true }).first().click();
  await expect(page.getByRole('button', { name: /Prepared meal.*recipe consumption required/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Stocked item.*Inventory required/ })).toBeDisabled();
  const service = page.getByRole('button', { name: /Consultation.*no stock tracking/ }); await expect(service).toBeEnabled(); expect(await service.textContent()).not.toMatch(/on hand|recorded stock/); await service.click();
  const serviceLine = page.getByRole('region', { name: 'Basket' }).getByRole('article').filter({ hasText: 'Consultation' });
  await expect(serviceLine.locator('p').filter({ hasText: 'KES' })).toHaveText(/^KES\s*10(?:\.00)?$/);
  await page.getByRole('button', { name: 'Take payment', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Stock exception confirmation' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirm payment', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('Service', { exact: true })).toBeVisible();
  expect(posts[0]).toMatchObject({ type: 'sales.order.settle', expectedVersions: { [`product:${serviceId}`]: 4 }, payload: { lines: [{ productId: serviceId, quantity: '1' }] } });
  expect(posts[0].payload).not.toHaveProperty('stockException'); expect(reads).not.toContain('/configuration/stock-sale-policy');
});

test('mixed baskets acknowledge only stocked shortfalls and receiving excludes nonstock items', async ({ page }) => {
  const { posts } = await fixture(page); await page.goto('/'); await page.getByRole('button', { name: 'Sell', exact: true }).first().click();
  await page.getByRole('button', { name: /Consultation.*no stock tracking/ }).click(); await page.getByRole('button', { name: /Stocked item.*on hand/ }).click(); await page.getByRole('button', { name: 'Take payment', exact: true }).click();
  const confirmation = page.getByRole('region', { name: 'Stock exception confirmation' });
  await expect(confirmation.getByText(/Stocked item: 1 each beyond/)).toBeVisible(); await expect(confirmation.getByText('Consultation', { exact: false })).toHaveCount(0);
  await confirmation.getByRole('combobox', { name: 'Reason', exact: true }).selectOption('SUSPECTED_OUTDATED_COUNT'); await confirmation.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Confirm payment', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1); expect((posts[0].payload.stockException as { lines: Array<{ productId: string }> }).lines.map(line => line.productId)).toEqual([stockedId]);
  await page.getByRole('button', { name: 'Close receipt', exact: true }).click(); await page.getByRole('button', { name: 'Purchasing, Limited', exact: true }).click();
  const picker = page.getByLabel('Item', { exact: true }); await expect(picker.getByRole('option', { name: 'Stocked item · each' })).toHaveCount(1); await expect(picker.getByRole('option', { name: /Consultation|Prepared meal/ })).toHaveCount(0);
});

test('reviewed type change retains product and stored zero-balance versions through lost-response recovery', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { posts, state } = await fixture(page); await openCatalog(page); state.mode = 'lost';
  await page.getByRole('button', { name: 'Change type Stocked item', exact: true }).click(); let dialog = page.getByRole('dialog', { name: 'Change item type' });
  await dialog.getByRole('combobox', { name: 'Item type', exact: true }).selectOption('SERVICE'); await dialog.getByLabel('Reason for change').fill('Reviewed service identity'); await expect(dialog.getByRole('button', { name: 'Confirm item type change' })).toBeInViewport(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); await dialog.getByRole('button', { name: 'Confirm item type change' }).click();
  await expect(dialog.getByRole('button', { name: 'Check change status' })).toBeEnabled(); const original = structuredClone(posts[0]);
  expect(original).toMatchObject({ type: 'catalog.product.change_kind', expectedVersions: { [`product:${stockedId}`]: 7, [`balance:${stockedId}`]: 3 }, payload: { productId: stockedId, itemKind: 'SERVICE', reason: 'Reviewed service identity' } });
  await page.reload(); await navigateCatalog(page); dialog = page.getByRole('dialog', { name: 'Change item type' });
  await expect(dialog.getByRole('combobox', { name: 'Item type', exact: true })).toHaveValue('SERVICE'); await expect(dialog.getByRole('combobox', { name: 'Item type', exact: true })).toBeDisabled(); await dialog.getByRole('button', { name: 'Check change status' }).click(); await expect(dialog).toHaveCount(0); expect(posts).toHaveLength(1);
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Stocked item', exact: true }) }); await expect(card.getByText('No category · No stock tracking')).toBeVisible();
});

test('new nonstock type change omits absent balance version and a count rejection preserves entered intent', async ({ page }) => {
  const { posts, state } = await fixture(page); await openCatalog(page); state.mode = 'open-count';
  await page.getByRole('button', { name: 'Change type Consultation', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Change item type' });
  await dialog.getByRole('combobox', { name: 'Item type', exact: true }).selectOption('STOCKED_GOOD'); await dialog.getByLabel('Reason for change').fill('Reviewed stocked identity'); await dialog.getByRole('button', { name: 'Confirm item type change' }).click();
  await expect(dialog.getByRole('alert')).toContainText(/count/i); await expect(dialog.getByRole('combobox', { name: 'Item type', exact: true })).toHaveValue('STOCKED_GOOD');
  expect(posts[0].expectedVersions).toEqual({ [`product:${serviceId}`]: 4 });
  expect(posts[0].payload).toMatchObject({ productId: serviceId, itemKind: 'STOCKED_GOOD' });
});

test('recorded stock and missing balance evidence disable type changes with a correction explanation', async ({ page }) => {
  const { items, posts } = await fixture(page); items[0].quantity = '2'; items[0].inventoryValueMinor = '1000'; delete items[1].balanceVersion;
  await openCatalog(page); await expect(page.getByRole('button', { name: 'Change type Stocked item', exact: true })).toBeDisabled(); await expect(page.getByText(/Correct recorded stock through receiving or a reviewed count/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change type Consultation', exact: true })).toBeDisabled(); await expect(page.getByText('Refresh this item to obtain its balance version before changing its type.')).toBeVisible(); expect(posts).toHaveLength(0);
});

test('historical service refunds always send no stock return even if the current item is now stocked', async ({ page }) => {
  const { items, posts } = await fixture(page); items[1].itemKind = 'STOCKED_GOOD'; items[1].stockTracked = true;
  await page.goto('/'); await page.getByRole('button', { name: 'Sales history', exact: true }).click(); await page.getByRole('button', { name: 'Refund remaining items', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review returned quantities' }); await expect(dialog.getByLabel('Service refund: no stock return')).toBeDisabled(); await expect(dialog.getByLabel('Service refund: no stock return')).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Confirm cash refund', exact: true }).click(); await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ type: 'sales.order.refund', payload: { lines: [{ orderLineId: 'service-line', quantity: '1', restock: false }] } });
});

test('commerce-only CSV maps item types and previews services without opening-stock claims', async ({ page }) => {
  const { reads } = await fixture(page, false);
  const csv = 'sku,name,baseUnit,sellingPrice,costPrice,itemKind\nCSV-SERVICE,Imported consultation,each,25,0,SERVICE';
  const batch = { id: 'service-import', fileName: 'services.csv', mode: 'CREATE_ONLY', status: 'READY', version: 1, sourceHash: 'a'.repeat(64), sourceBytes: csv.length, businessVersion: 3, currency: 'KES', defaultTaxRateBps: 0, createdAt: '2026-10-25T09:00:00Z', createdBy: userId, appliedAt: null, source: { csv, mapping: { sku: 'sku', name: 'name', baseUnit: 'baseUnit', sellingPrice: 'sellingPrice', costPrice: 'costPrice', itemKind: 'itemKind' } }, summary: { rowCount: 1, createCount: 1, updateCount: 0, unchangedCount: 0, errorCount: 0, warningCount: 0, openingQuantityLines: 0, openingValueMinor: '0' }, errors: [], warnings: [], rows: [{ rowNumber: 2, action: 'CREATE', sku: 'CSV-SERVICE', normalized: { sku: 'CSV-SERVICE', name: 'Imported consultation', baseUnit: 'each', currency: 'KES', sellingPriceMinor: 2500, costPriceMinor: 0, taxRateBps: 0, itemKind: 'SERVICE', barcode: null, category: '', reorderLevel: '0', openingQuantity: '0', openingUnitCostMinor: null, openingValueMinor: '0' }, changes: [{ field: 'itemKind', before: null, after: 'SERVICE' }], defaults: { currency: 'TENANT_DEFAULT', tax: 'BUSINESS_DEFAULT' } }] };
  let validation: BackendCommand | undefined;
  await page.route('**/api/v1/commands', route => { validation = route.request().postDataJSON(); return route.fulfill({ json: { commandId: validation!.commandId, status: 'CONFIRMED', value: { batchId: batch.id } } }); });
  await page.route('**/api/v1/catalog/imports/service-import', route => route.fulfill({ json: { batch } }));
  await openCatalog(page); await page.getByRole('button', { name: 'Import products', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Back to items and services' })).toBeVisible();
  await page.getByLabel('Product CSV file').setInputFiles({ name: 'services.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: 'Validate all rows' }).click();
  await expect(page.getByRole('heading', { name: 'Review validated import' })).toBeVisible();
  expect((validation!.payload.mapping as Record<string, string>).itemKind).toBe('itemKind');
  const preview = page.getByRole('article').filter({ hasText: 'Imported consultation' }); await expect(preview).toContainText('Service'); await expect(preview).toContainText('No stock tracking or inventory COGS'); await expect(preview.getByText(/Opening quantity|Opening value/)).toHaveCount(0);
  expect(reads.filter(path => path.startsWith('/inventory/'))).toEqual([]);
});

test('sales capability remains selected when inventory is unchecked and service readiness is shown', async ({ page }) => {
  await fixture(page); await page.goto('/'); await page.getByRole('button', { name: 'Manage', exact: true }).click();
  await page.getByRole('button', { name: /^Business capabilities/ }).click();
  await page.getByLabel('Inventory', { exact: true }).uncheck(); await expect(page.getByLabel('Sales and customer accounts')).toBeChecked();
  await expect(page.getByText('Sales supports services without inventory.', { exact: false })).toBeVisible(); await expect(page.getByText('Sales requires inventory.', { exact: false })).toHaveCount(0);
});

test('inventory-only catalog keeps service actions and nonstock creation unavailable until sales is enabled', async ({ page }) => {
  const { posts, reads } = await fixture(page, true, false); await page.goto('/'); await navigateCatalog(page);
  await expect(page.getByRole('button', { name: 'Edit Consultation', exact: true })).toBeDisabled(); await expect(page.getByRole('button', { name: 'Change type Consultation', exact: true })).toBeDisabled();
  await expect(page.getByText('Enable sales before changing this service or prepared item.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Add item', exact: true }).click(); const type = page.getByRole('dialog').getByRole('combobox', { name: 'Item type', exact: true });
  await expect(type).toHaveValue('STOCKED_GOOD'); await expect(type.getByRole('option', { name: /^Service/ })).toHaveAttribute('disabled', ''); await expect(type.getByRole('option', { name: /^Prepared/ })).toHaveAttribute('disabled', '');
  expect(posts).toHaveLength(0); expect(reads).not.toContain('/shifts/current');
});

test('inventory-disabled mixed refunds leave stocked quantities unavailable while services remain refundable', async ({ page }) => {
  const { order, posts } = await fixture(page, false);
  const stocked = { ...order.lines[0], lineId: 'stocked-line', productId: stockedId, sku: 'STOCKED', name: 'Historical stocked item', itemKind: 'STOCKED_GOOD' };
  order.lines.push(stocked); order.subtotalMinor = order.totalMinor = order.paidMinor = 2000;
  await page.goto('/'); await page.getByRole('button', { name: 'Sales history', exact: true }).click(); await page.getByRole('button', { name: 'Refund remaining items', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review returned quantities' });
  const stockRow = dialog.getByRole('group', { name: 'Refund Historical stocked item' }); await expect(stockRow.getByLabel('Qty')).toHaveValue('0'); await expect(stockRow.getByLabel('Qty')).toBeDisabled(); await expect(stockRow.getByLabel('Inventory required to refund this stocked good')).not.toBeChecked();
  await expect(dialog.getByRole('group', { name: 'Refund Consultation' }).getByLabel('Qty')).toHaveValue('1');
  await dialog.getByRole('button', { name: 'Confirm cash refund', exact: true }).click(); await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].payload.lines).toEqual([{ orderLineId: 'service-line', quantity: '1', restock: false }]);
  await expect(dialog).toHaveCount(0); await expect(page.getByRole('button', { name: 'Refund remaining items', exact: true })).toBeDisabled(); await expect(page.getByText('Enable inventory to refund remaining stocked goods.')).toBeVisible();
});

for (const committed of ['full', 'partial'] as const) for(const outsidePage of [false,true]) test(`a ${committed} committed lost stocked refund retains its original stock disposition after inventory is disabled${outsidePage?' beyond the first history page':''}`, async ({ page }) => {
  const { order, state, posts, reads, saleSearches } = await fixture(page); Object.assign(order.lines[0], { itemKind: 'STOCKED_GOOD', productId: stockedId }); state.mode = 'lost';
  if (committed === 'partial') { order.lines[0].quantity = '3'; order.subtotalMinor = order.totalMinor = order.paidMinor = 3000; }
  await page.goto('/'); await page.getByRole('button', { name: 'Sales history', exact: true }).click(); await page.getByRole('button', { name: 'Refund remaining items', exact: true }).click(); await page.getByRole('dialog').getByLabel('Qty').fill('1'); await page.getByRole('button', { name: 'Confirm cash refund', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check status', exact: true })).toBeEnabled(); const original = structuredClone(posts[0]); expect((original.payload.lines as Array<{ restock: boolean }>)[0].restock).toBe(true);
  state.inventoryEnabled = false; state.hideSaleFromFirstPage=outsidePage; await page.reload(); await page.getByRole('button', { name: 'Sales history', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review returned quantities' }); const disposition = dialog.getByLabel('Original request: return to stock. Inventory is disabled.'); await expect(disposition).toBeChecked(); await expect(disposition).toBeDisabled();
  await expect(dialog.getByLabel('Qty')).toHaveValue('1'); await expect(dialog.getByLabel('Qty')).toBeDisabled(); await expect(dialog.getByText(`Remaining ${committed === 'full' ? '0' : '2'}`, { exact: false })).toBeVisible();
  expect(await savedRefundCommands(page)).toEqual([original]);
  if(outsidePage){expect(saleSearches).toContain(order.id);await expect(page.getByText('No receipts match this search.')).toBeVisible();}
  await dialog.getByRole('button',{name:'Check status',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Check status',exact:true})).toBeEnabled();
  await expect(disposition).toBeChecked();await expect(dialog.getByLabel('Qty')).toHaveValue('1');
  expect(await savedRefundCommands(page)).toEqual([original]);expect(posts).toEqual([original]);
  const priorAuthReads=reads.filter(path=>path==='/auth/me').length;
  state.inventoryEnabled=true;await page.reload();await page.getByRole('button',{name:'Sales history',exact:true}).click();
  expect(reads.filter(path=>path==='/auth/me').length).toBeGreaterThan(priorAuthReads);
  await expect(page.getByRole('button',{name:'Stock',exact:true})).toBeEnabled();
  const restored=page.getByRole('dialog',{name:'Review returned quantities'});
  await expect(restored.getByLabel('Return to stock',{exact:true})).toBeChecked();
  await expect(restored.getByLabel('Return to stock',{exact:true})).toBeDisabled();
  await expect(restored.getByLabel('Qty')).toHaveValue('1');expect(await savedRefundCommands(page)).toEqual([original]);
  await restored.getByRole('button', { name: 'Check status', exact: true }).click(); await expect(restored).toHaveCount(0); expect(posts).toEqual([original]);expect(await savedRefundCommands(page)).toEqual([]);
});
