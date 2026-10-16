import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, test, type Page } from '@playwright/test';
import { hashPassword } from '../../apps/api/src/security';

const pool = new Pool({ connectionString: process.env.MAZAO_E2E_DATABASE_URL });
const tenantId = randomUUID(), outletId = randomUUID(), userId = randomUUID(), deviceId = randomUUID();
const email = `account-cashier-${userId}@example.invalid`;
const initialPassword = `Disposable-account-${randomUUID()}`;
const changedPassword = `Changed-account-${randomUUID()}`;

test.beforeAll(async () => {
  await pool.query('INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,$2,$3,$4)', [tenantId, 'Account browser business', 'KES', 'Africa/Nairobi']);
  await pool.query('INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,$3,$4)', [outletId, tenantId, 'Account browser outlet', 'Africa/Nairobi']);
  for (const capability of ['commerce', 'inventory']) await pool.query('INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,$2)', [tenantId, capability]);
  await pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)', [userId, email, await hashPassword(initialPassword), 'Self Service Cashier']);
  await pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'cashier')", [tenantId, userId]);
  await pool.query('INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,$5)', [deviceId, tenantId, outletId, userId, 'Self service workspace']);
});
test.afterAll(async () => { await pool.end(); });

async function signIn(page: Page, password: string) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Signed in as Self Service Cashier' })).toBeVisible();
}

test('cashier revokes another own session and changes their password through the reachable account dialog', async ({ page, browser }) => {
  const otherContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const otherPage = await otherContext.newPage();
    await signIn(otherPage, initialPassword);
    await signIn(page, initialPassword);
    await expect(page.getByRole('button', { name: 'Manage', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Signed in as Self Service Cashier' }).click();
    const account = page.getByRole('dialog', { name: 'My account' });
    await expect(account.getByRole('heading', { name: 'My sessions' })).toBeVisible();
    const otherSession = account.locator('article').filter({ hasNotText: 'This session' });
    await expect(otherSession).toHaveCount(1);
    await otherSession.getByRole('button', { name: 'Sign out session Self service workspace' }).click();
    await account.getByLabel('Session sign-out reason').fill('End shared browser session');
    await account.getByRole('button', { name: 'Confirm session sign-out' }).click();
    await expect(otherSession.getByText('Signed out', { exact: true })).toBeVisible();
    const sessions = await pool.query('SELECT revoked_at FROM identity.sessions WHERE user_id=$1', [userId]);
    expect(sessions.rowCount).toBe(2);
    expect(sessions.rows.filter(row => row.revoked_at !== null)).toHaveLength(1);
    await otherPage.reload();
    await expect(otherPage.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();

    await account.getByLabel('Current password', { exact: true }).fill(initialPassword);
    await account.getByLabel('New password', { exact: true }).fill(changedPassword);
    await account.getByLabel('Confirm new password').fill(changedPassword);
    await account.getByRole('button', { name: 'Change my password', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    const credential = await pool.query('SELECT credential_version FROM identity.users WHERE id=$1', [userId]);
    expect(Number(credential.rows[0].credential_version)).toBe(2);
    const operations = await pool.query('SELECT command_type,status FROM system.commands WHERE tenant_id=$1 ORDER BY completed_at', [tenantId]);
    expect(operations.rows).toEqual([
      { command_type: 'auth.session.revoke', status: 'CONFIRMED' },
      { command_type: 'auth.password.change', status: 'CONFIRMED' },
    ]);
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(initialPassword);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Signed in as Self Service Cashier' })).toHaveCount(0);
    await signIn(page, changedPassword);
  } finally { await otherContext.close(); }
});
