import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, test, type Page } from '@playwright/test';
import { hashPassword } from '../../apps/api/src/security';

// Keep this spec's sign-ins separate from the shared integration API rate-limit bucket.
test.use({ extraHTTPHeaders: { 'x-forwarded-for': '198.51.100.5' } });

const pool = new Pool({ connectionString: process.env.MAZAO_E2E_DATABASE_URL });
test.afterAll(async () => { await pool.end(); });

async function countWorkspace(page: Page) {
  await expect(page.getByLabel('Signed in as Recovery Count Admin')).toBeVisible();
  const navigation = page.getByRole('button', { name: 'Count stock', exact: true });
  if (!await navigation.isVisible()) await page.getByRole('button', { name: 'More', exact: true }).click();
  await navigation.last().click();
  await expect(page.getByRole('heading', { name: 'Count stock', exact: true })).toBeVisible();
}

test('real count retains the unsent save envelope, reloads its saved draft and recovers committed posting once', async ({ page }) => {
  const tenantId = randomUUID(), outletId = randomUUID(), userId = randomUUID(), deviceId = randomUUID();
  const email = `recovery-count-${userId}@example.invalid`, password = `Disposable-recovery-count-${randomUUID()}`;
  await pool.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Disposable count recovery','KES','Africa/Nairobi')", [tenantId]);
  await pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Recovery count outlet','Africa/Nairobi')", [outletId, tenantId]);
  await pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'inventory')", [tenantId]);
  await pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)', [userId, email, await hashPassword(password), 'Recovery Count Admin']);
  await pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')", [tenantId, userId]);
  await pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Disposable count recovery assignment')", [deviceId, tenantId, outletId, userId]);
  await page.setViewportSize({ width: 1024, height: 600 }); await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Signed in as Recovery Count Admin')).toBeVisible();
  await page.evaluate(async () => {
    const session = await (await fetch('/api/v1/auth/me')).json();
    const command = async (type: string, payload: Record<string, unknown>) => {
      const outcome = await (await fetch('/api/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken }, body: JSON.stringify({ protocolVersion: 1, commandId: crypto.randomUUID(), tenantId: session.tenant.id, deviceId: session.deviceId, type, occurredAt: new Date().toISOString(), expectedVersions: {}, payload }) })).json();
      if (outcome.status !== 'CONFIRMED') throw new Error(JSON.stringify(outcome));
      return outcome.value;
    };
    const product = await command('catalog.product.create', { sku: 'RECOVERY-COUNT', name: 'Recovery count item', baseUnit: 'each', currency: 'KES', sellingPriceMinor: 200, costPriceMinor: 100, taxRateBps: 0 });
    await command('inventory.receive', { lines: [{ productId: product.productId, quantity: '10', unitCostMinor: 100 }] });
  });
  await countWorkspace(page); await page.getByRole('button', { name: 'Start full count', exact: true }).click();
  await page.getByLabel('Counted quantity', { exact: true }).fill('9'); await page.getByLabel('Reason for difference').fill('One damaged unit');
  await page.evaluate(() => {
    const native = IDBObjectStore.prototype.put;
    (window as any).restoreCountJournal = () => { IDBObjectStore.prototype.put = native; };
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'commands') { (window as any).unsentCount = args[0].command; throw new DOMException('Disposable quota failure', 'QuotaExceededError'); }
      return native.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'not sent because recovery data could not be saved' })).toBeVisible();
  const original = await page.evaluate(() => (window as any).unsentCount);
  expect((await pool.query('SELECT count(*)::int n FROM system.commands WHERE tenant_id=$1 AND command_id=$2', [tenantId, original.commandId])).rows[0].n).toBe(0);
  await expect(page.getByLabel('Counted quantity', { exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).restoreCountJournal());
  await page.getByRole('button', { name: 'Check command status', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Server confirmed the original count command' })).toBeVisible();
  expect((await pool.query('SELECT status FROM system.commands WHERE tenant_id=$1 AND command_id=$2', [tenantId, original.commandId])).rows[0].status).toBe('CONFIRMED');
  await page.reload(); await countWorkspace(page);
  await expect(page.getByLabel('Counted quantity', { exact: true })).toHaveValue('9.000000');
  await expect(page.getByLabel('Reason for difference')).toHaveValue('One damaged unit');
  await page.getByRole('button', { name: 'Review and post', exact: true }).click();
  let postingId = '';
  await page.route('**/api/v1/commands', async route => {
    if (route.request().postDataJSON().type !== 'inventory.count.post') return route.continue();
    postingId = route.request().postDataJSON().commandId;
    await route.fetch(); await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Post reviewed count', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Check command status', exact: true })).toBeVisible();
  await page.unroute('**/api/v1/commands'); await page.reload(); await countWorkspace(page);
  await page.getByRole('button', { name: 'Check command status', exact: true }).click();
  // Global recovery can still report its own status while this count confirms.
  await expect(page.getByRole('status').filter({ hasText: 'Server confirmed the count command' })).toBeVisible();
  expect((await pool.query("SELECT count(*)::int n FROM inventory.movements WHERE tenant_id=$1 AND command_id=$2 AND movement_type='COUNT_ADJUSTMENT'", [tenantId, postingId])).rows[0].n).toBe(1);
  expect((await pool.query('SELECT count(*)::int n FROM system.audit_events WHERE tenant_id=$1 AND command_id=$2', [tenantId, postingId])).rows[0].n).toBe(1);
  expect((await pool.query('SELECT quantity::text,inventory_value_minor::text FROM inventory.balances WHERE tenant_id=$1', [tenantId])).rows[0]).toEqual({ quantity: '9.000000', inventory_value_minor: '900' });
});
