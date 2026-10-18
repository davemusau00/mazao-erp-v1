import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, test, type Page } from '@playwright/test';
import { hashPassword } from '../../apps/api/src/security';

test.use({ extraHTTPHeaders: { 'x-forwarded-for': '198.51.100.3' } });

const pool = new Pool({ connectionString: process.env.MAZAO_E2E_DATABASE_URL });
const tenantId = randomUUID();
const outletId = randomUUID();
const userId = randomUUID();
const deviceId = randomUUID();
const email = `staff-admin-${userId}@example.invalid`;
const password = `Disposable-browser-${randomUUID()}`;

test.beforeAll(async () => {
  await pool.query('INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,$2,$3,$4)', [tenantId, 'Staff access browser business', 'KES', 'Africa/Nairobi']);
  await pool.query('INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,$3,$4)', [outletId, tenantId, 'Staff access outlet', 'Africa/Nairobi']);
  for (const capability of ['commerce', 'inventory', 'retail']) await pool.query('INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,$2)', [tenantId, capability]);
  await pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)', [userId, email, await hashPassword(password), 'Staff Browser Admin']);
  await pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')", [tenantId, userId]);
  await pool.query('INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,$5)', [deviceId, tenantId, outletId, userId, 'Staff access browser device']);
});
test.afterAll(async () => { await pool.end(); });

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Signed in as Staff Browser Admin')).toBeVisible();
}

test('guided staff setup confirms membership, protected password, workspace assignment and first sign-in', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Manage your business' })).toBeVisible();
  const grid = page.locator('.manage-grid');
  await expect(grid.getByRole('button', { name: /Staff/ })).toBeEnabled();
  await expect(grid.getByRole('button', { name: /Workspace assignments/ })).toBeEnabled();
  await grid.getByRole('button', { name: /^Staff/ }).click();
  await expect(page.getByRole('heading', { name: 'Staff access' })).toBeVisible();
  await page.getByRole('button', { name: 'Add operator' }).click();
  const operatorEmail = `new-operator-${randomUUID()}@example.invalid`;
  await page.getByLabel('Display name', { exact: true }).fill('Browser Provisioned Operator');
  await page.getByLabel('Email', { exact: true }).fill(operatorEmail);
  await page.getByRole('button', { name: 'Create staff membership' }).click();
  await expect(page.getByText('Access change completed.', { exact: true })).toBeVisible();
  await expect(page.getByText(/Step 2 of 4/)).toBeVisible();
  const created = await pool.query(`SELECT u.id,m.role,m.active,m.version,u.password_hash
    FROM identity.users u JOIN identity.memberships m ON m.user_id=u.id WHERE m.tenant_id=$1 AND lower(u.email)=lower($2)`, [tenantId, operatorEmail]);
  expect(created.rowCount).toBe(1);
  expect(created.rows[0].role).toBe('cashier');
  expect(created.rows[0].active).toBe(true);
  expect(created.rows[0].password_hash).toBeNull();

  await page.getByRole('textbox', { name: 'New password', exact: true }).fill('A-long-browser-test-password-46!');
  await page.getByLabel('Confirm new password').fill('A-long-browser-test-password-46!');
  await page.getByRole('button', { name: 'Set initial password' }).click();
  await expect(page.getByText(/Password change confirmed/)).toBeVisible();
  await expect(page.getByText(/Step 3 of 4/)).toBeVisible();
  const credential = await pool.query('SELECT password_hash,credential_version FROM identity.users WHERE id=$1', [created.rows[0].id]);
  expect(credential.rows[0].password_hash).toBeTruthy();
  expect(Number(credential.rows[0].credential_version)).toBe(2);

  await page.getByLabel('Workspace label').fill('Browser workstation');
  await page.getByRole('button', { name: 'Create operator workspace assignment' }).click();
  await expect(page.getByText('Access change completed.', { exact: true })).toBeVisible();
  const assignment = await pool.query('SELECT outlet_id,assigned_user_id,active,version FROM identity.devices WHERE tenant_id=$1 AND label=$2', [tenantId, 'Browser workstation']);
  expect(assignment.rowCount).toBe(1);
  expect(assignment.rows[0]).toMatchObject({ outlet_id: outletId, assigned_user_id: created.rows[0].id, active: true });
  expect(Number(assignment.rows[0].version)).toBe(1);
  await expect(page.getByText(/Step 4 of 4/)).toBeVisible();
  const guide = await page.evaluate(() => sessionStorage.getItem(Object.keys(sessionStorage).find(key => key.startsWith('mazao-staff-setup:')) ?? ''));
  expect(guide).not.toContain('A-long-browser-test-password-46!');

  const browser = page.context().browser();
  if (!browser) throw new Error('The browser context is unavailable.');
  const operatorContext = await browser.newContext();
  try {
    const operatorPage = await operatorContext.newPage();
    await operatorPage.goto(new URL(page.url()).origin);
    await operatorPage.getByLabel('Email', { exact: true }).fill(operatorEmail);
    await operatorPage.getByLabel('Password', { exact: true }).fill('A-long-browser-test-password-46!');
    await operatorPage.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(operatorPage.getByLabel('Signed in as Browser Provisioned Operator')).toBeVisible();
  } finally {
    await operatorContext.close();
  }

  await page.getByRole('button', { name: 'Check first sign-in' }).click();
  await expect(page.getByRole('region', { name: 'Guided operator setup' }).getByRole('status')).toContainText('First sign-in confirmed. Staff setup is complete.');
  const verified = await pool.query('SELECT count(*)::int AS sessions FROM identity.sessions WHERE user_id=$1 AND revoked_at IS NULL', [created.rows[0].id]);
  expect(verified.rows[0].sessions).toBeGreaterThan(0);
});
