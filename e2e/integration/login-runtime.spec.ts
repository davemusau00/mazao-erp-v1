import { expect, test } from '@playwright/test';

test.use({ extraHTTPHeaders: { 'x-forwarded-for': '198.51.100.10' } });

test('real sign-in reports the ninth rejected attempt as rate limited while another client remains available', async ({ page, request }) => {
  await page.goto('/');
  for (let attempt = 1; attempt <= 9; attempt++) {
    await page.getByLabel('Email', { exact: true }).fill('unassigned-login-guard@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill('Disposable-invalid-login-password');
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(attempt < 9 ? 401 : 429);
    if (attempt < 9) await expect(page.getByRole('alert')).toContainText('The email or password was not accepted');
    else {
      expect(Number(response.headers()['retry-after'])).toBeGreaterThan(0);
      await expect(page.getByRole('alert')).toContainText('Too many sign-in attempts');
      await expect(page.getByRole('heading', { name: 'Sign in to Mazao' })).toBeVisible();
    }
  }
  const independent = await request.post('/api/v1/auth/login', {
    headers: { origin: 'http://127.0.0.1:3002', 'x-forwarded-for': '198.51.100.11' },
    data: { email: 'unassigned-login-guard@example.invalid', password: 'Disposable-invalid-login-password' },
  });
  expect(independent.status()).toBe(401);
  expect(independent.headers()['x-ratelimit-remaining']).toBe('7');
});
