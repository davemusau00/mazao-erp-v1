import { defineConfig } from '@playwright/test';

const databaseUrl = process.env.MAZAO_E2E_DATABASE_URL;
if (!databaseUrl) throw new Error('MAZAO_E2E_DATABASE_URL must identify a disposable, migrated local test database.');
const database = new URL(databaseUrl);
if (!['127.0.0.1', 'localhost'].includes(database.hostname) || !['/mazao_test', '/mazao_configuration_test'].includes(database.pathname)) {
  throw new Error('Browser integration fixtures may only use the named disposable localhost test databases.');
}

export default defineConfig({
  testDir: './e2e/integration',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3002', browserName: 'chromium', headless: true, actionTimeout: 15_000, serviceWorkers: 'block', trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'npm run api:dev',
      url: 'http://127.0.0.1:4102/api/v1/health/ready',
      // This test-only loopback ingress forwards the explicit client fixtures.
      // Production must verify its own exact socket ingress, never trust a CIDR.
      env: { DATABASE_URL: databaseUrl, API_HOST: '127.0.0.1', API_PORT: '4102', APP_ORIGINS: 'http://127.0.0.1:3002', NODE_ENV: 'development', CREDENTIAL_FINGERPRINT_KEY: 'c'.repeat(64), TRUSTED_PROXY_IPS: '127.0.0.1,::1,::ffff:127.0.0.1' },
      reuseExistingServer: false,
    },
    {
      command: 'npm run preview -- --host 127.0.0.1 --port 3002 --strictPort',
      url: 'http://127.0.0.1:3002',
      env: { MAZAO_PROXY_TARGET: 'http://127.0.0.1:4102' },
      reuseExistingServer: false,
    },
  ],
});
