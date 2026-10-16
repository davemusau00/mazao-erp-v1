import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, test, type Page } from '@playwright/test';
import { hashPassword } from '../../apps/api/src/security';

const pool = new Pool({ connectionString: process.env.MAZAO_E2E_DATABASE_URL });
test.afterAll(async () => { await pool.end(); });

async function openCountWorkspace(page: Page) {
  const count = page.getByRole('button', { name: 'Count stock', exact: true });
  if (!await count.isVisible()) await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Count stock', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Count stock', exact: true })).toBeVisible();
}

for (const scenario of [
  { name: 'unequal mixed count recovers the original posting after a lost response', firstQuantity: '13', gain: 300, lostResponse: true },
  { name: 'equal mixed values retain both gross stock adjustments', firstQuantity: '12', gain: 200, lostResponse: false },
]) {
  test(scenario.name, async ({ page }) => {
    const tenantId = randomUUID(), outletId = randomUUID(), userId = randomUUID(), deviceId = randomUUID();
    const email = `count-browser-${userId}@example.invalid`, password = `Disposable-count-browser-${randomUUID()}`;
    await pool.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Disposable count browser','KES','Africa/Nairobi')", [tenantId]);
    await pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Count browser outlet','Africa/Nairobi')", [outletId, tenantId]);
    await pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'inventory')", [tenantId]);
    await pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)', [userId, email, await hashPassword(password), 'Count Browser Admin']);
    await pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')", [tenantId, userId]);
    await pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Disposable count browser assignment')", [deviceId, tenantId, outletId, userId]);
    await page.setViewportSize({ width: 1024, height: 600 });
    await page.goto('/');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByLabel('Signed in as Count Browser Admin')).toBeVisible();

    // Set up known baseline through the authenticated API; the count journey
    // below uses the operator UI and the actual PostgreSQL-backed commands.
    await page.evaluate(async () => {
      const session = await (await fetch('/api/v1/auth/me')).json();
      const command = async (type: string, payload: Record<string, unknown>) => {
        const response = await fetch('/api/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken }, body: JSON.stringify({
          protocolVersion: 1, commandId: crypto.randomUUID(), tenantId: session.tenant.id, deviceId: session.deviceId, type, occurredAt: new Date().toISOString(), expectedVersions: {}, payload,
        }) });
        const outcome = await response.json();
        if (!response.ok || outcome.status !== 'CONFIRMED') throw new Error(`Fixture command failed: ${JSON.stringify(outcome)}`);
        return outcome.value;
      };
      const products: string[] = [];
      for (const sku of ['BROWSER-COUNT-A', 'BROWSER-COUNT-B']) {
        const created = await command('catalog.product.create', { sku, name: sku, baseUnit: 'each', currency: 'KES', sellingPriceMinor: 1000, costPriceMinor: 999, taxRateBps: 0 });
        products.push(created.productId);
      }
      await command('inventory.receive', { documentReference: 'BROWSER-COUNT-BASELINE', lines: products.map((productId, i) => ({ productId, quantity: '10', unitCostMinor: i === 0 ? 100 : 200 })) });
    });

    await openCountWorkspace(page);
    await page.getByLabel('Area label').fill('Mixed browser count');
    await page.getByRole('button', { name: 'Start full count', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Outlet count in progress' })).toBeVisible();
    const first = page.locator('article').filter({ has: page.getByRole('heading', { name: 'BROWSER-COUNT-A', exact: true }) });
    const second = page.locator('article').filter({ has: page.getByRole('heading', { name: 'BROWSER-COUNT-B', exact: true }) });
    await first.getByLabel('Counted quantity', { exact: true }).fill(scenario.firstQuantity);
    await first.getByLabel('Reason for difference').fill('Reviewed physical gain');
    await second.getByLabel('Counted quantity', { exact: true }).fill('9');
    await second.getByLabel('Reason for difference').fill('Reviewed damaged stock');
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Count draft is saved on the server');
    await page.reload();
    await expect(page.getByLabel('Signed in as Count Browser Admin')).toBeVisible();
    await openCountWorkspace(page);
    await expect(first.getByLabel('Counted quantity', { exact: true })).toHaveValue(scenario.firstQuantity + '.000000');
    await expect(second.getByLabel('Counted quantity', { exact: true })).toHaveValue('9.000000');
    await page.getByRole('button', { name: 'Review and post', exact: true }).click();
    const confirm = page.getByRole('button', { name: 'Post reviewed count', exact: true });
    await expect(confirm).toBeInViewport();
    let postingId = '';
    if (scenario.lostResponse) {
      await page.route('**/api/v1/commands', async route => {
        if (route.request().postDataJSON().type !== 'inventory.count.post') return route.continue();
        postingId = route.request().postDataJSON().commandId;
        await route.fetch();
        await route.abort('failed');
      });
    }
    await confirm.click();
    if (scenario.lostResponse) {
      await expect(page.getByRole('button', { name: 'Check command status', exact: true })).toBeVisible();
      await page.unroute('**/api/v1/commands');
      await page.reload();
      await expect(page.getByLabel('Signed in as Count Browser Admin')).toBeVisible();
      await openCountWorkspace(page);
      await page.getByRole('button', { name: 'Check command status', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('Server confirmed the count command');
    } else {
      await expect(page.getByRole('status')).toContainText('Count posted: 2 stock adjustments');
    }
    await expect(page.getByRole('heading', { name: 'No open outlet count' })).toBeVisible();
    await page.getByRole('button', { name: 'View details', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Mixed browser count');
    await expect(page.getByRole('dialog')).toContainText('Reviewed physical gain');
    await expect(page.getByRole('dialog')).toContainText('Reviewed damaged stock');

    const journal = await pool.query(`SELECT e.source_id,l.account_code,l.debit_minor::text,l.credit_minor::text FROM finance.journal_entries e
      JOIN finance.journal_lines l ON l.tenant_id=e.tenant_id AND l.journal_entry_id=e.id WHERE e.tenant_id=$1 AND e.source_type='INVENTORY_COUNT'`, [tenantId]);
    expect(new Set(journal.rows.map(row => row.source_id)).size).toBe(1);
    if (postingId) expect(journal.rows[0].source_id).toBe(postingId);
    const inventory = journal.rows.filter(row => row.account_code === 'INVENTORY');
    expect(inventory.map(row => [row.debit_minor, row.credit_minor]).sort()).toEqual([['0', '200'], [String(scenario.gain), '0']].sort());
    expect(journal.rows.reduce((sum, row) => sum + BigInt(row.debit_minor) - BigInt(row.credit_minor), 0n)).toBe(0n);
    expect((await pool.query("SELECT count(*)::int n FROM inventory.movements WHERE tenant_id=$1 AND movement_type='COUNT_ADJUSTMENT'", [tenantId])).rows[0].n).toBe(2);
    expect((await pool.query("SELECT count(*)::int n FROM system.audit_events WHERE tenant_id=$1 AND event_type='inventory.count.post'", [tenantId])).rows[0].n).toBe(1);
    expect((await pool.query('SELECT status FROM inventory.stock_counts WHERE tenant_id=$1', [tenantId])).rows[0].status).toBe('POSTED');
  });
}
