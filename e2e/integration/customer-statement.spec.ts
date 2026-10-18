import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, test } from '@playwright/test';
import { hashPassword } from '../../apps/api/src/security';

// Keep this spec's sign-ins separate from the shared integration API rate-limit bucket.
test.use({ extraHTTPHeaders: { 'x-forwarded-for': '198.51.100.6' } });

const pool = new Pool({ connectionString: process.env.MAZAO_E2E_DATABASE_URL });
const tenantId = randomUUID(), outletId = randomUUID(), userId = randomUUID(), deviceId = randomUUID();
const email = `customer-browser-${userId}@example.invalid`, password = `Disposable-customer-${randomUUID()}`;

test.beforeAll(async () => {
  await pool.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Customer statement browser business','KES','Africa/Nairobi')", [tenantId]);
  await pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Customer statement browser outlet','Africa/Nairobi')", [outletId, tenantId]);
  for (const capability of ['commerce', 'inventory']) await pool.query('INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,$2)', [tenantId, capability]);
  await pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)', [userId, email, await hashPassword(password), 'Customer Statement Operator']);
  await pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')", [tenantId, userId]);
  await pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Customer statement browser workspace')", [deviceId, tenantId, outletId, userId]);
});
test.afterAll(async () => { await pool.end(); });

test('real customer statement shows an exact credit charge, cash repayment allocation and persisted refreshed balance', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Signed in as Customer Statement Operator')).toBeVisible();
  const session = await (await page.request.get('/api/v1/auth/me')).json();
  const submit = async (type: string, payload: Record<string, unknown>, expectedVersions: Record<string, number> = {}) => {
    const response = await page.request.post('/api/v1/commands', { headers: { origin: new URL(page.url()).origin, 'x-csrf-token': session.csrfToken }, data: { protocolVersion: 1, commandId: randomUUID(), tenantId, deviceId, type, occurredAt: new Date().toISOString(), expectedVersions, payload } });
    expect(response.ok()).toBe(true);
    const result = await response.json(); expect(result.status, JSON.stringify(result)).toBe('CONFIRMED'); return result.value;
  };
  const product = await submit('catalog.product.create', { sku: 'CUSTOMER-BROWSER-ITEM', name: 'Customer statement item', baseUnit: 'each', currency: 'KES', sellingPriceMinor: 101, costPriceMinor: 40, taxRateBps: 1600 });
  await submit('inventory.receive', { lines: [{ productId: product.productId, quantity: '3', unitCostMinor: 40 }] });
  const customer = await submit('customers.account.create', { name: 'Statement Browser Customer', phone: '+254700000039', creditLimitMinor: 100000 });
  const shift = await submit('shift.open', { openingFloatMinor: 0 });
  await submit('sales.order.settle', { shiftId: shift.shiftId, customerId: customer.customerId, lines: [{ productId: product.productId, quantity: '1' }], tenders: [] }, { [`shift:${shift.shiftId}`]: 1 });

  await page.getByRole('button', { name: 'Customers', exact: true }).click();
  const statement = page.locator('section').filter({ has: page.getByText('Customer statement', { exact: true }) });
  await expect(statement.getByRole('heading', { name: 'Statement Browser Customer', exact: true })).toBeVisible();
  await expect(statement.getByText('Credit sale', { exact: true })).toBeVisible();
  await expect(statement.getByText('Balance KES\u00a01.17', { exact: true })).toBeVisible();
  await statement.getByRole('button', { name: 'Record repayment', exact: true }).click();
  const repayment = page.getByRole('dialog', { name: 'Record repayment' });
  await repayment.getByLabel('Amount (KES)', { exact: true }).fill('0.16');
  await repayment.getByLabel('Cash receipt reference (optional)').fill('BROWSER-SNAPSHOT-COLLECTION');
  await repayment.getByRole('button', { name: 'Confirm cash repayment' }).click();
  await expect(repayment).toHaveCount(0);
  await expect(statement.getByText('Cash repayment', { exact: true })).toBeVisible();
  await expect(statement.getByText('Balance KES\u00a01.01', { exact: true })).toBeVisible();
  await expect(statement.getByText(/Allocated KES\s0\.16 to/)).toBeVisible();
  const persisted = await pool.query('SELECT balance_minor::text FROM finance.customer_accounts WHERE tenant_id=$1 AND id=$2', [tenantId, customer.customerId]);
  expect(persisted.rows[0].balance_minor).toBe('101');
  const allocations = await pool.query('SELECT amount_minor::text FROM finance.customer_repayment_allocations WHERE tenant_id=$1 AND customer_account_id=$2', [tenantId, customer.customerId]);
  expect(allocations.rows.map(row => row.amount_minor)).toEqual(['16']);
  await page.reload();
  await page.getByRole('button', { name: 'Customers', exact: true }).click();
  await expect(statement.getByText('Balance KES\u00a01.01', { exact: true })).toBeVisible();
  await expect(statement.getByText('Cash repayment', { exact: true })).toBeVisible();
  await statement.getByText('Cash repayment', { exact: true }).scrollIntoViewIfNeeded();
  const screenshot = testInfo.outputPath('customer-statement-1280x720.png');
  await page.screenshot({ path: screenshot });
  await testInfo.attach('customer-statement-1280x720', { path: screenshot, contentType: 'image/png' });
});
