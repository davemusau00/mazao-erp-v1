import { expect, test } from '@playwright/test';

const managerSession = {
  user: {
    id: 'user-server-1',
    name: 'David Kibet',
    email: 'david@example.invalid',
    role: 'manager',
    permissions: [
      'catalog.manage', 'inventory.receive', 'inventory.count', 'inventory.count.approve',
      'commerce.sell', 'commerce.refund', 'shift.open', 'shift.payout', 'shift.close',
      'finance.view', 'customers.view', 'customers.charge', 'customers.manage', 'customers.settle',
    ],
  },
  tenant: {
    id: 'tenant-server-1', name: 'Apex Supermarket', currency: 'KES', timeZone: 'Africa/Nairobi',
    capabilities: ['retail', 'inventory', 'commerce'],
  },
  outlet: { id: 'outlet-server-1', name: 'Nairobi Central' },
  deviceId: 'device-server-1',
  csrfToken: 'csrf-server-test',
};

test('server session restore failure blocks automatic demo fallback', async ({ page }) => {
  await page.route('**/api/v1/auth/me', route => route.abort('failed'));
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Server session could not be verified' })).toBeVisible();
  await expect(page.getByText('Local demo workspace')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Good day' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Open local preview only' }).click();
  await expect(page.getByText('Local demo workspace')).toBeVisible();
  await expect(page.getByRole('button', { name: /Local preview (online|offline)/ })).toBeVisible();
});

test('authenticated shell uses server identity and hides local operator, sync and diagnostics controls', async ({ page }) => {
  await page.route('**/api/v1/auth/me', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } }) }));
  await page.route('**/api/v1/auth/login', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(managerSession) }));
  await page.route('**/api/v1/shifts/current', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ shift: null }) }));

  await page.goto('/');
  await page.getByRole('button', { name: 'Connect backend' }).click();
  await page.getByLabel('Email').fill('david@example.invalid');
  await page.getByLabel('Password').fill('test-password-only');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByLabel('Signed in as David Kibet')).toBeVisible();
  await expect(page.getByText('Apex Supermarket', { exact: true })).toBeVisible();
  await expect(page.getByText('Nairobi Central · David Kibet · manager')).toBeVisible();
  await expect(page.getByText('Local demo workspace')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Local preview (online|offline)/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open diagnostics' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /DEMO OPERATOR/i })).toHaveCount(0);
  await expect(page.getByText('Local preview workspace.')).toHaveCount(0);
  await expect(page.getByText('This workspace is using the authenticated server outlet.')).toBeVisible();
});
