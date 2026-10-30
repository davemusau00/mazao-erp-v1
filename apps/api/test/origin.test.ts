import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL ?? 'postgres://test:test@127.0.0.1:1/unused';
process.env.NODE_ENV = 'production';
process.env.APP_ORIGINS = '';
process.env.CREDENTIAL_FINGERPRINT_KEY = 'c'.repeat(64);

const [{ buildApp }, db] = await Promise.all([
  import('../src/app.js'),
  import('../src/db.js'),
]);

test('production unsafe requests fail closed unless the exact configured origin is sent', async () => {
  assert.throws(() => buildApp(), /APP_ORIGINS must contain the exact public application origin in production/);

  process.env.APP_ORIGINS = 'https://erp.example.invalid';
  const app = buildApp();
  await app.ready();
  try {
    const missingOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'operator@example.invalid' },
    });
    assert.equal(missingOrigin.statusCode, 403);
    assert.equal(missingOrigin.json().error.code, 'ORIGIN_DENIED');

    const disallowedOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://attacker.example.invalid' },
      payload: { email: 'operator@example.invalid' },
    });
    assert.equal(disallowedOrigin.statusCode, 403);
    assert.equal(disallowedOrigin.json().error.code, 'ORIGIN_DENIED');

    const allowedOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://erp.example.invalid' },
      payload: { email: 'operator@example.invalid' },
    });
    assert.equal(allowedOrigin.statusCode, 400);
    assert.equal(allowedOrigin.json().error.code, 'VALIDATION_FAILED');
    assert.equal(allowedOrigin.headers['access-control-allow-origin'], 'https://erp.example.invalid');
    assert.equal(allowedOrigin.headers['access-control-allow-credentials'], 'true');

    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/login',
      headers: {
        origin: 'https://erp.example.invalid',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type, x-request-id, x-csrf-token',
      },
    });
    assert.equal(preflight.statusCode, 204, preflight.body);
    assert.equal(preflight.headers['access-control-allow-origin'], 'https://erp.example.invalid');
    assert.equal(preflight.headers['access-control-allow-credentials'], 'true');
    assert.match(preflight.headers['access-control-allow-headers'] ?? '', /x-csrf-token/i);

    const rejectedOriginPreflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://attacker.example.invalid', 'access-control-request-method': 'POST' },
    });
    assert.equal(rejectedOriginPreflight.statusCode, 403);
    assert.equal(rejectedOriginPreflight.headers['access-control-allow-origin'], undefined);

    const rejectedHeaderPreflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://erp.example.invalid', 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-unapproved' },
    });
    assert.equal(rejectedHeaderPreflight.statusCode, 403);
  } finally {
    await app.close();
    await db.pool.end();
  }
});
