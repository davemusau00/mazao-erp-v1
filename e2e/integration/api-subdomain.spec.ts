import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, test, type Page } from '@playwright/test';
import { hashPassword } from '../../apps/api/src/security';

const pool = new Pool({ connectionString: process.env.MAZAO_E2E_DATABASE_URL });
const tenantId = randomUUID();
const outletId = randomUUID();
const userId = randomUUID();
const deviceId = randomUUID();
const email = `api-origin-${userId}@example.invalid`;
const password = `Disposable-origin-${randomUUID()}`;
const apiOrigin = process.env.VITE_API_BASE_URL;
const appOrigin = 'http://127.0.0.1:3002';
const logoPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/xR8AAAAASUVORK5CYII=', 'base64');

test.beforeAll(async () => {
  expect(apiOrigin).toBe('http://127.0.0.1:4102');
  await pool.query('INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,$2,$3,$4)', [tenantId, 'API origin browser business', 'KES', 'Africa/Nairobi']);
  await pool.query('INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,$3,$4)', [outletId, tenantId, 'API origin outlet', 'Africa/Nairobi']);
  for (const capability of ['commerce', 'inventory', 'retail']) await pool.query('INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,$2)', [tenantId, capability]);
  await pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)', [userId, email, await hashPassword(password), 'API Origin Admin']);
  await pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')", [tenantId, userId]);
  await pool.query('INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,$5)', [deviceId, tenantId, outletId, userId, 'API origin test device']);

  const assetId = randomUUID(), draftId = randomUUID();
  await pool.query(`INSERT INTO core.configuration_assets(id,tenant_id,kind,draft_id,uploaded_by,content,sha256,byte_length,status,activated_at)
    VALUES($1,$2,'logo',$3,$4,$5,$6,$7,'ACTIVE',now())`, [assetId, tenantId, draftId, userId, logoPng, createHash('sha256').update(logoPng).digest(), logoPng.length]);
});

test.afterAll(async () => { await pool.end(); });

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Signed in as API Origin Admin')).toBeVisible();
}

test('PWA auth, CSRF writes, private assets, CSV downloads and session restore use the API origin', async ({ page }) => {
  const apiRequests: Array<{ method: string; path: string }> = [];
  const apiResponses: Array<{ method: string; path: string; status: number; allowOrigin?: string; credentials?: string }> = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === apiOrigin) apiRequests.push({ method: request.method(), path: url.pathname });
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin === apiOrigin) apiResponses.push({ method: response.request().method(), path: url.pathname, status: response.status(), allowOrigin: response.headers()['access-control-allow-origin'], credentials: response.headers()['access-control-allow-credentials'] });
  });

  await signIn(page);
  expect(apiResponses.find(response => response.method === 'POST' && response.path === '/api/v1/auth/login')).toMatchObject({ status: 200, allowOrigin: appOrigin, credentials: 'true' });

  const restored = await page.evaluate(async api => {
    const response = await fetch(`${api}/api/v1/auth/me`, { credentials: 'include', headers: { 'x-request-id': crypto.randomUUID() } });
    return { status: response.status, body: await response.json() };
  }, apiOrigin);
  expect(restored.status).toBe(200);
  expect(restored.body.user.email).toBe(email);
  expect(restored.body.tenant.id).toBe(tenantId);

  await page.reload();
  await expect(page.getByLabel('Signed in as API Origin Admin')).toBeVisible();

  const manage = page.getByRole('button', { name: 'Manage', exact: true });
  if (!await manage.isVisible()) await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Manage', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Manage your business' })).toBeVisible();
  await page.getByRole('button', { name: /Business and outlets/ }).click();
  const logoPreview = page.getByAltText('Business logo preview');
  await expect(logoPreview).toBeVisible();
  await expect.poll(() => logoPreview.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(apiRequests.some(request => request.method === 'GET' && /^\/api\/v1\/configuration\/assets\//.test(request.path))).toBe(true);
  await page.getByLabel('Contact phone', { exact: true }).fill('+254 700 000 044');
  await page.getByRole('button', { name: 'Save business settings' }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved');
  expect(apiResponses.find(response => response.method === 'POST' && response.path === '/api/v1/commands')).toMatchObject({ status: 200, allowOrigin: appOrigin, credentials: 'true' });
  expect((await pool.query('SELECT business_profile->>\'phone\' phone FROM core.tenants WHERE id=$1', [tenantId])).rows[0].phone).toBe('+254 700 000 044');

  const transport = await page.evaluate(async api => {
    const configResponse = await fetch(`${api}/api/v1/configuration`, { credentials: 'include', headers: { 'x-request-id': crypto.randomUUID() } });
    const config = await configResponse.json();
    const imageUrl = new URL(config.configuration.business.logoUrl, api).toString();
    const image = await fetch(imageUrl, { credentials: 'include', headers: { 'x-request-id': crypto.randomUUID() } });
    const imageBytes = [...new Uint8Array(await image.arrayBuffer())];
    const date = new Date().toISOString().slice(0, 10);
    const csv = await fetch(`${api}/api/v1/reports/items.csv?from=${date}&to=${date}`, { credentials: 'include', headers: { 'x-request-id': crypto.randomUUID() } });
    return { configStatus: configResponse.status, imageStatus: image.status, imageType: image.headers.get('content-type'), imageBytes, csvStatus: csv.status, csvType: csv.headers.get('content-type'), csv: await csv.text() };
  }, apiOrigin);
  expect(transport.configStatus).toBe(200);
  expect(transport.imageStatus).toBe(200);
  expect(transport.imageType).toContain('image/png');
  expect(transport.imageBytes).toEqual([...logoPng]);
  expect(transport.csvStatus).toBe(200);
  expect(transport.csvType).toContain('text/csv');
  expect(transport.csv.length).toBeGreaterThan(0);

  const logout = await page.evaluate(async api => {
    const session = await (await fetch(`${api}/api/v1/auth/me`, { credentials: 'include', headers: { 'x-request-id': crypto.randomUUID() } })).json();
    const response = await fetch(`${api}/api/v1/auth/logout`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken, 'x-request-id': crypto.randomUUID() }, body: '{}' });
    return { status: response.status, body: await response.json() };
  }, apiOrigin);
  expect(logout).toEqual({ status: 200, body: { status: 'signed_out' } });
  await page.reload();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
});

test('a foreign web origin cannot preflight credentialed API actions', async ({ browser }) => {
  const page = await browser.newPage();
  try {
    await page.goto('http://localhost:3002');
    const preflight = await page.request.fetch(`${apiOrigin}/api/v1/auth/login`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:3002',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-csrf-token',
      },
    });
    expect(preflight.status()).toBe(403);
    expect(preflight.headers()['access-control-allow-origin']).toBeUndefined();

    const blocked = await page.evaluate(async api => {
      try {
        await fetch(`${api}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': 'untrusted' }, body: '{}' });
        return false;
      } catch { return true; }
    }, apiOrigin);
    expect(blocked).toBe(true);
  } finally { await page.close(); }
});
