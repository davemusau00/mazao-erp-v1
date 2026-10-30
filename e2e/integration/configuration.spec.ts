import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, test, type Page } from '@playwright/test';
import { hashPassword } from '../../apps/api/src/security';

// Model this terminal through the explicitly trusted disposable test ingress.
test.use({ extraHTTPHeaders: { 'x-forwarded-for': '198.51.100.1' } });

const pool = new Pool({ connectionString: process.env.MAZAO_E2E_DATABASE_URL });
const tenantId = randomUUID();
const outletId = randomUUID();
const userId = randomUUID();
const deviceId = randomUUID();
const email = `browser-${userId}@example.invalid`;
const password = `Disposable-browser-${randomUUID()}`;

test.beforeAll(async () => {
  await pool.query('INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,$2,$3,$4)', [tenantId, 'Isolated browser business', 'KES', 'Africa/Nairobi']);
  await pool.query('INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,$3,$4)', [outletId, tenantId, 'Isolated browser outlet', 'Africa/Nairobi']);
  for (const capability of ['commerce', 'inventory', 'retail']) await pool.query('INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,$2)', [tenantId, capability]);
  await pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)', [userId, email, await hashPassword(password), 'Browser Admin']);
  await pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')", [tenantId, userId]);
  await pool.query('INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,$5)', [deviceId, tenantId, outletId, userId, 'Disposable browser device']);
});
test.afterAll(async () => { await pool.end(); });

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Signed in as Browser Admin')).toBeVisible();
}
async function manage(page: Page) {
  await expect(page.getByLabel('Signed in as Browser Admin')).toBeVisible();
  const settings = page.getByRole('button', { name: 'Manage', exact: true });
  if (!await settings.isVisible()) await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Manage', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Manage your business' })).toBeVisible();
  await page.getByRole('button', { name: /Business and outlets/ }).click();
  await expect(page.getByLabel('Business name', { exact: true })).toBeVisible();
}

test('real login, business/outlet saves, refresh and capabilities persist in PostgreSQL', async ({ page }) => {
  await signIn(page); await manage(page);
  await page.getByLabel('Business name', { exact: true }).fill('Configured browser business');
  await page.getByLabel('Legal business name', { exact: true }).fill('Configured Legal Business');
  await page.getByLabel('Contact phone', { exact: true }).fill('+254 700 000 001');
  await page.getByLabel('Receipt footer', { exact: true }).fill('Configured receipt footer');
  await page.getByLabel('Default tax rate (%)').fill('16.00');
  await page.getByLabel('I have reviewed this business tax policy').check();
  await page.getByRole('button', { name: 'Save business settings' }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved');
  const business = (await pool.query('SELECT name,business_profile,version FROM core.tenants WHERE id=$1', [tenantId])).rows[0];
  expect(business.name).toBe('Configured browser business');
  expect(business.business_profile.taxPolicy.defaultRateBps).toBe(1600);
  expect(Number(business.version)).toBe(2);
  await page.getByRole('button', { name: 'Outlet and receipts', exact: true }).click();
  await page.getByRole('group').getByLabel('Outlet name', { exact: true }).fill('Configured browser outlet');
  await page.getByRole('group').getByLabel('Outlet time zone', { exact: true }).fill('Pacific/Honolulu');
  await page.getByLabel('Outlet receipt header', { exact: true }).fill('Configured outlet receipt');
  await page.getByRole('button', { name: 'Save outlet settings' }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved');
  await page.reload(); await manage(page);
  await expect(page.getByLabel('Business name', { exact: true })).toHaveValue('Configured browser business');
  await expect(page.getByLabel('Default tax rate (%)')).toHaveValue('16.00');
  await page.getByRole('button', { name: 'Capabilities', exact: true }).click();
  await page.getByLabel('Rooms and guest stays', { exact: true }).check();
  await page.getByRole('button', { name: 'Save capabilities' }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved');
  expect((await pool.query("SELECT 1 FROM core.tenant_capabilities WHERE tenant_id=$1 AND capability='hospitality'", [tenantId])).rowCount).toBe(1);
  await page.reload();
  const refreshedSession = await page.evaluate(async () => (await fetch('/api/v1/auth/me')).json());
  expect(refreshedSession.tenant.capabilities).toContain('hospitality');
  const localKeys = await page.evaluate(() => Object.keys(localStorage));
  expect(localKeys.filter(key => /^mazao_(products|orders|ledger|tenants|staff|active_shift|customers|rooms|outbox)/.test(key))).toEqual([]);
});

test('a lost response after real server commit survives restart and resolves the original command once', async ({ page }) => {
  await signIn(page); await manage(page);
  let commandId = '';
  await page.route('**/api/v1/commands', async route => {
    commandId = route.request().postDataJSON().commandId;
    await route.fetch(); // Real API transaction commits; only its response is lost.
    await route.abort('failed');
  });
  await page.getByLabel('Contact phone', { exact: true }).fill('+254 700 000 002');
  await page.getByRole('button', { name: 'Save business settings' }).click();
  await expect(page.getByRole('heading', { name: 'Check settings save status' })).toBeVisible();
  await expect(page.getByLabel('Contact phone', { exact: true })).toBeDisabled();
  await page.unroute('**/api/v1/commands');
  await page.reload(); await manage(page);
  await expect(page.getByRole('heading', { name: 'Check settings save status' })).toBeVisible();
  await page.getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved');
  await expect(page.getByLabel('Contact phone', { exact: true })).toHaveValue('+254 700 000 002');
  expect((await pool.query('SELECT 1 FROM system.commands WHERE tenant_id=$1 AND command_id=$2', [tenantId, commandId])).rowCount).toBe(1);
  expect((await pool.query('SELECT 1 FROM system.audit_events WHERE tenant_id=$1 AND command_id=$2', [tenantId, commandId])).rowCount).toBe(1);
});

test('settings work across the specified desktop, tablet and mobile viewports', async ({ page }) => {
  await signIn(page); await manage(page);
  for (const [width, height] of [[1024,600],[1280,720],[1280,800],[800,1280],[1366,768],[1920,1080],[390,844]]) {
    await page.setViewportSize({ width, height });
    const save = page.getByRole('button', { name: 'Save business settings' });
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeInViewport();
    const bounds = await save.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('configured outlet adds and receives inventory, confirms a taxed sale and reconciles cash-up', async ({ page }) => {
  await signIn(page);
  await manage(page);
  await page.getByLabel('Legal business name', { exact: true }).fill('Configured Legal Business');
  await page.getByLabel('Receipt footer', { exact: true }).fill('Configured receipt footer for sale');
  await page.getByLabel('Default tax rate (%)').fill('16.00');
  await page.getByLabel('I have reviewed this business tax policy').check();
  await page.getByRole('button', { name: 'Save business settings' }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved');
  await page.getByRole('button', { name: 'Outlet and receipts', exact: true }).click();
  await page.getByRole('group').getByLabel('Outlet name', { exact: true }).fill('Configured browser outlet for sale');
  await page.getByRole('group').getByLabel('Outlet time zone', { exact: true }).fill('Pacific/Honolulu');
  await page.getByLabel('Outlet receipt header', { exact: true }).fill('Configured outlet receipt');
  await page.getByRole('button', { name: 'Save outlet settings' }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved');
  await page.getByRole('button', { name: 'Stock', exact: true }).first().click();
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await page.getByLabel('Item name', { exact: true }).fill('Browser sale item');
  await page.getByLabel('SKU', { exact: true }).fill('BROWSER-SALE-ITEM');
  await page.getByLabel('Selling price (KES)', { exact: true }).fill('10.00');
  await page.getByLabel('Reference cost per unit (KES)', { exact: true }).fill('5.00');
  await page.getByRole('button', { name: 'Create item', exact: true }).click();
  await expect(page.getByRole('status').filter({hasText:'Item created'})).toBeVisible();
  const product = (await pool.query("SELECT id,tax_rate_bps FROM catalog.products WHERE tenant_id=$1 AND sku='BROWSER-SALE-ITEM'", [tenantId])).rows[0];
  expect(product.tax_rate_bps).toBe(1600);
  await page.getByRole('button', { name: 'Receive stock', exact: true }).click();
  await page.getByLabel('Supplier name (receipt record)', { exact: true }).fill('Disposable browser supplier');
  await page.getByLabel('Delivery reference', { exact: true }).fill('DISPOSABLE-BROWSER-DELIVERY');
  await page.getByLabel('Item', { exact: true }).selectOption(product.id);
  await page.getByLabel('Quantity', { exact: true }).fill('3');
  await page.getByLabel('Cost per base unit (KES)', { exact: true }).fill('5.00');
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await page.getByRole('button', { name: 'Review delivery', exact: true }).click();
  await page.getByRole('button', { name: 'Post reviewed receipt', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Receipt confirmed:' })).toBeVisible();
  await page.getByRole('button', { name: 'Shifts', exact: true }).click();
  await page.getByLabel('Opening float (KES)').fill('100.00');
  await page.getByRole('button', { name: 'Open shift', exact: true }).click();
  await expect(page.getByLabel('Counted cash (KES)')).toBeVisible();
  await page.getByRole('button', { name: 'Sell', exact: true }).first().click();
  await page.getByRole('button', { name: /Browser sale item/ }).click();
  await page.getByRole('button', { name: 'Take payment', exact: true }).click();
  await page.getByLabel('Cash received (KES)', { exact: true }).fill('20.00');
  await page.getByRole('button', { name: 'Confirm payment', exact: true }).click();
  const receipt = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Close receipt' }) });
  await expect(receipt).toContainText('Configured Legal Business');
  await expect(receipt).toContainText('Configured outlet receipt');
  await expect(receipt).toContainText('Configured receipt footer');
  await expect(receipt).toContainText('11.60');
  await page.getByRole('button', { name: 'Close receipt', exact: true }).click();
  await page.getByRole('button', { name: 'Shifts', exact: true }).click();
  await page.getByLabel('Counted cash (KES)').fill('111.60');
  await page.getByRole('button', { name: 'Close shift', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Z report', exact: true })).toBeVisible();
  const reports = (await pool.query('SELECT expected_cash_minor,counted_cash_minor,variance_minor,time_zone_snapshot AS time_zone FROM commerce.shift_close_reports WHERE tenant_id=$1', [tenantId])).rows;
  expect(reports).toHaveLength(1);
  expect(String(reports[0].expected_cash_minor)).toBe('11160');
  expect(String(reports[0].counted_cash_minor)).toBe('11160');
  expect(String(reports[0].variance_minor)).toBe('0');
  expect(reports[0].time_zone).toBe('Pacific/Honolulu');
  expect((await pool.query('SELECT quantity FROM inventory.balances WHERE tenant_id=$1 AND product_id=$2', [tenantId, product.id])).rows[0].quantity).toBe('2.000000');
});
