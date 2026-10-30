import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, test } from '@playwright/test';
import { hashPassword } from '../../apps/api/src/security';

// A distinct disposable terminal retains the integration API's real login limit.
test.use({ extraHTTPHeaders: { 'x-forwarded-for': '198.51.100.19' } });
const pool = new Pool({ connectionString: process.env.MAZAO_E2E_DATABASE_URL });
test.afterAll(async () => { await pool.end(); });

test('real catalog edits categories and archive restore preserve posted sales and inventory evidence', async ({ page }) => {
  const tenantId = randomUUID(), outletId = randomUUID(), userId = randomUUID(), deviceId = randomUUID();
  const email = `catalog-browser-${userId}@example.invalid`, password = `Disposable-catalog-browser-${randomUUID()}`;
  await pool.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Disposable catalog browser','KES','Africa/Nairobi')", [tenantId]);
  await pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Catalog browser outlet','Africa/Nairobi')", [outletId, tenantId]);
  await pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'inventory'),($1,'commerce')", [tenantId]);
  await pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)', [userId, email, await hashPassword(password), 'Catalog Browser Admin']);
  await pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')", [tenantId, userId]);
  await pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Disposable catalog browser assignment')", [deviceId, tenantId, outletId, userId]);
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto('/'); await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Signed in as Catalog Browser Admin')).toBeVisible();

  // Populate posted evidence through the authenticated API, then exercise every
  // maintenance operation through the real UI and PostgreSQL-backed commands.
  const fixture = await page.evaluate(async () => {
    const session = await (await fetch('/api/v1/auth/me')).json();
    const command = async (type: string, payload: Record<string, unknown>, expectedVersions: Record<string, number> = {}) => {
      const response = await fetch('/api/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken }, body: JSON.stringify({ protocolVersion: 1, commandId: crypto.randomUUID(), tenantId: session.tenant.id, deviceId: session.deviceId, type, occurredAt: new Date().toISOString(), expectedVersions, payload }) });
      const result = await response.json();
      if (!response.ok || result.status !== 'CONFIRMED') throw new Error(`Disposable fixture command failed: ${JSON.stringify(result)}`);
      return result.value;
    };
    const product = await command('catalog.product.create', { sku: 'CATALOG-POSTED', name: 'Posted catalog item', baseUnit: 'each', currency: 'KES', sellingPriceMinor: 1000, costPriceMinor: 500, taxRateBps: 1600, category: 'Food' });
    const empty = await command('catalog.product.create', { sku: 'CATALOG-EMPTY', name: 'Empty maintenance item', baseUnit: 'each', currency: 'KES', sellingPriceMinor: 500, costPriceMinor: 200, taxRateBps: 0, category: 'food' });
    await command('inventory.receive', { documentReference: 'DISPOSABLE-CATALOG-RECEIPT', lines: [{ productId: product.productId, quantity: '4', unitCostMinor: 500 }] });
    const shift = await command('shift.open', { openingFloatMinor: 10000 });
    const sale = await command('sales.order.settle', { shiftId: shift.shiftId, lines: [{ productId: product.productId, quantity: '1' }], tenders: [{ method: 'CASH', amountMinor: 2000, currency: 'KES' }] }, { [`shift:${shift.shiftId}`]: shift.version, [`product:${product.productId}`]: 1 });
    const receipt = await (await fetch(`/api/v1/sales/orders/${sale.saleId}/receipt`)).json();
    return { productId: product.productId as string, emptyId: empty.productId as string, saleId: sale.saleId as string, receipt };
  });
  const unchangedEvidence = async () => {
    const queries = [
      'SELECT product_id,quantity::text,inventory_value_minor::text,version::text FROM inventory.balances WHERE tenant_id=$1 ORDER BY product_id',
      'SELECT to_jsonb(m) record FROM inventory.movements m WHERE tenant_id=$1 ORDER BY id',
      'SELECT to_jsonb(o) record FROM commerce.orders o WHERE tenant_id=$1 ORDER BY id',
      'SELECT to_jsonb(l) record FROM commerce.order_lines l WHERE tenant_id=$1 ORDER BY id',
      'SELECT to_jsonb(p) record FROM commerce.payments p WHERE tenant_id=$1 ORDER BY id',
      'SELECT to_jsonb(e) record FROM finance.journal_entries e WHERE tenant_id=$1 ORDER BY id',
      'SELECT to_jsonb(l) record FROM finance.journal_lines l WHERE tenant_id=$1 ORDER BY id',
    ];
    return Promise.all(queries.map(async sql => (await pool.query(sql, [tenantId])).rows));
  };
  const baseline = await unchangedEvidence();
  const categoryIds = (await pool.query('SELECT id,name FROM catalog.categories WHERE tenant_id=$1 ORDER BY name', [tenantId])).rows;
  const foodId = String(categoryIds.find(row => row.name === 'Food')!.id), lowerFoodId = String(categoryIds.find(row => row.name === 'food')!.id);
  const commands: Array<{ type: string; expectedVersions: Record<string, number> }> = [];
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/commands') commands.push(request.postDataJSON()); });

  await page.getByRole('button', { name: 'Stock', exact: true }).click(); await page.getByRole('button', { name: 'Manage items and categories', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Posted catalog item', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Edit item', exact: true });
  await dialog.getByLabel('Item name', { exact: true }).fill('Updated catalog item'); await dialog.getByLabel('Selling price (KES)', { exact: true }).fill('15.25'); await dialog.getByLabel('Reference cost per unit (KES)', { exact: true }).fill('7.10'); await dialog.getByLabel('Tax rate (%)', { exact: true }).fill('7.50'); await dialog.getByLabel('Barcode', { exact: true }).fill('000250001'); await dialog.getByLabel('Reorder level', { exact: true }).fill('2.125'); await dialog.getByLabel('Reason for change').fill('Reviewed current catalog metadata');
  await dialog.getByRole('button', { name: 'Save item changes', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Updated catalog item', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Categories', exact: true }).click(); await page.getByRole('button', { name: 'Rename Food', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Rename category', exact: true }); await dialog.getByLabel('Category name').fill('Meals'); await dialog.getByLabel('Reason for change').fill('Reviewed category display label'); await dialog.getByRole('button', { name: 'Rename category', exact: true }).click();
  await page.getByRole('button', { name: 'Merge food', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'Merge categories', exact: true }); await dialog.getByLabel('Destination category').selectOption(foodId); await dialog.getByLabel('Reason for change').fill('Reviewed exact case category merge'); await dialog.getByRole('button', { name: 'Merge categories', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Items', exact: true }).click(); await page.getByRole('button', { name: 'Archive Empty maintenance item', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'Change item availability' }); await dialog.getByLabel('Reason for change').fill('Retire zero-stock listing'); await dialog.getByRole('button', { name: 'Archive item', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Empty maintenance item', exact: true })).toHaveCount(0);
  await page.getByLabel('Include archived', { exact: true }).check(); await page.getByRole('button', { name: 'Restore Empty maintenance item', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'Change item availability' }); await dialog.getByLabel('Reason for change').fill('Resume reviewed listing'); await dialog.getByRole('button', { name: 'Restore item', exact: true }).click(); await expect(page.getByRole('button', { name: 'Archive Empty maintenance item', exact: true })).toBeEnabled();

  expect(commands.map(command => command.type)).toEqual(['catalog.product.update', 'catalog.category.update', 'catalog.category.merge', 'catalog.product.set_active', 'catalog.product.set_active']);
  expect(commands.map(command => command.expectedVersions)).toEqual([{ [`product:${fixture.productId}`]: 1 }, { [`category:${foodId}`]: 1 }, { [`category:${foodId}`]: 2, [`category:${lowerFoodId}`]: 1 }, { [`product:${fixture.emptyId}`]: 2 }, { [`product:${fixture.emptyId}`]: 3 }]);
  const products = (await pool.query('SELECT id,name,sku,category_id,category,barcode,reorder_level::text,selling_price_minor::text,cost_price_minor::text,tax_rate_bps,version::text,active FROM catalog.products WHERE tenant_id=$1 ORDER BY id', [tenantId])).rows;
  expect(products.find(row => row.id === fixture.productId)).toMatchObject({ name: 'Updated catalog item', sku: 'CATALOG-POSTED', category_id: foodId, category: 'Meals', barcode: '000250001', reorder_level: '2.125000', selling_price_minor: '1525', cost_price_minor: '710', tax_rate_bps: 750, version: '3', active: true });
  expect(products.find(row => row.id === fixture.emptyId)).toMatchObject({ category_id: foodId, category: 'Meals', version: '4', active: true });
  const categories = (await pool.query('SELECT id,name,active,version::text,merged_into FROM catalog.categories WHERE tenant_id=$1', [tenantId])).rows;
  expect(categories.find(row => row.id === foodId)).toMatchObject({ name: 'Meals', active: true, version: '3', merged_into: null }); expect(categories.find(row => row.id === lowerFoodId)).toMatchObject({ name: 'food', active: false, version: '2', merged_into: foodId });
  expect(await unchangedEvidence()).toEqual(baseline);
  const receiptAfter = await page.evaluate(async saleId => (await fetch(`/api/v1/sales/orders/${saleId}/receipt`)).json(), fixture.saleId);
  expect(receiptAfter).toEqual(fixture.receipt);
});
