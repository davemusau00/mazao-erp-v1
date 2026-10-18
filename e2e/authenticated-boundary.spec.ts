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

  await expect(page.getByRole('heading', { name: 'We could not check your sign-in' })).toBeVisible();
  await expect(page.getByText('Local demo workspace')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Good day' })).toHaveCount(0);

  await expect(page.getByRole('button', { name: 'Open local preview only' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Local preview (online|offline)/ })).toHaveCount(0);
});

test('authenticated shell uses server identity and hides local operator, sync and diagnostics controls', async ({ page }) => {
  await page.route('**/api/v1/auth/me', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } }) }));
  await page.unroute('**/api/v1/auth/login');
  await page.route('**/api/v1/auth/login', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(managerSession) }));
  await page.route('**/api/v1/shifts/current', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ shift: null }) }));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in to Mazao' })).toBeVisible();
  await expect(page.getByText('Local demo workspace')).toHaveCount(0);
  await page.getByLabel('Email').fill('david@example.invalid');
  await page.getByLabel('Password').fill('test-password-only');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByLabel('Signed in as David Kibet')).toBeVisible();
  await expect(page.getByText('Apex Supermarket', { exact: true })).toBeVisible();
  await expect(page.getByText('Nairobi Central · David Kibet · Manager')).toBeVisible();
  await expect(page.getByText('Local demo workspace')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Local preview (online|offline)/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open diagnostics' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /DEMO OPERATOR/i })).toHaveCount(0);
  await expect(page.getByText('Local preview workspace.')).toHaveCount(0);
  await expect(page.getByText('Check the outlet shown above before starting work.')).toBeVisible();
});

test('sign-in submits password-manager autofill values without React change events', async ({ page }) => {
  await page.route('**/api/v1/auth/me', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/v1/shifts/current', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"shift":null}' }));
  let credentials: { email: string; password: string } | undefined;
  await page.route('**/api/v1/auth/login', route => {
    credentials = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(managerSession) });
  });
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).evaluate((input: HTMLInputElement) => { input.value = 'david@example.invalid'; });
  await page.getByLabel('Password', { exact: true }).evaluate((input: HTMLInputElement) => { input.value = ' literal-$-and-&-password '; });
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Signed in as David Kibet')).toBeVisible();
  expect(credentials).toEqual({ email: 'david@example.invalid', password: ' literal-$-and-&-password ' });
});

test('rejected sign-in and sign-out keep production outside the demo workspace', async ({ page }) => {
  let acceptLogin = false;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/auth/me', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/v1/auth/login', route => acceptLogin
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(managerSession) })
    : route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Credentials rejected.' } }) }));
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('david@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('incorrect-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('The email or password was not accepted');
  await expect(page.getByText('Local demo workspace')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open local preview only' })).toHaveCount(0);
  acceptLogin = true;
  await page.getByLabel('Email', { exact: true }).fill('david@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('valid-test-password');
  await page.route('**/api/v1/shifts/current', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"shift":null}' }));
  await page.route('**/api/v1/auth/logout', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"signed_out"}' }));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to Mazao' })).toBeVisible();
  await expect(page.getByText('Local demo workspace')).toHaveCount(0);
});
