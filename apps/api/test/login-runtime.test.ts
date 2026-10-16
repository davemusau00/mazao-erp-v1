import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { readRuntimeConfig } from '../src/runtimeConfig.js';

process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:1/unused';
const [{ buildApp }, { pool }] = await Promise.all([import('../src/app.js'), import('../src/db.js')]);
after(async () => { await pool.end(); });

const origin = 'https://erp.example.invalid';
const testKey = 'c'.repeat(64);
function application(trustedProxyIps = '') {
  process.env.NODE_ENV = 'production';
  process.env.APP_ORIGINS = origin;
  process.env.CREDENTIAL_FINGERPRINT_KEY = testKey;
  process.env.TRUSTED_PROXY_IPS = trustedProxyIps;
  return buildApp({ logger: { level: 'silent' } });
}
const attempt = (app: FastifyInstance, remoteAddress: string, forwardedFor?: string) => app.inject({
  method: 'POST', url: '/api/v1/auth/login', remoteAddress,
  headers: { origin, ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}) },
  // Rejected before DB work, while exercising the actual login route/hooks.
  payload: {},
});

test('production configuration rejects absent/malformed keys without exposing supplied values', () => {
  const environment = { NODE_ENV: 'production', APP_ORIGINS: origin };
  for (const key of [undefined, '', 'a'.repeat(63), 'secret-invalid-' + 'g'.repeat(64)]) {
    assert.throws(() => readRuntimeConfig({ ...environment, CREDENTIAL_FINGERPRINT_KEY: key }), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /CREDENTIAL_FINGERPRINT_KEY must be configured/);
      if (key) assert.ok(!error.message.includes(key));
      return true;
    });
  }
  assert.equal(readRuntimeConfig({ ...environment, CREDENTIAL_FINGERPRINT_KEY: testKey }).production, true);
  assert.equal(readRuntimeConfig({ NODE_ENV: 'development' }).production, false);
  process.env.NODE_ENV = 'production'; process.env.APP_ORIGINS = origin;
  delete process.env.CREDENTIAL_FINGERPRINT_KEY;
  assert.throws(() => buildApp(), /CREDENTIAL_FINGERPRINT_KEY must be configured/);
});

test('proxy configuration accepts only bounded literal ingress addresses and defaults to none', () => {
  assert.deepEqual(readRuntimeConfig({}).trustedProxyIps, []);
  assert.deepEqual(readRuntimeConfig({ TRUSTED_PROXY_IPS: '127.0.0.1, ::1' }).trustedProxyIps, ['127.0.0.1', '::1']);
  for (const value of ['true', '*', '127.0.0.0/8', '0.0.0.0/0', 'ingress.internal', '127.0.0.1,', Array(17).fill('127.0.0.1').join(',')]) {
    assert.throws(() => readRuntimeConfig({ TRUSTED_PROXY_IPS: value }), /TRUSTED_PROXY_IPS must contain/);
  }
});

test('the actual login route allows eight requests, then returns canonical 429 and retry metadata', async () => {
  const app = application();
  try {
    await app.ready();
    for (let index = 0; index < 8; index++) {
      const result = await attempt(app, '192.0.2.1');
      assert.equal(result.statusCode, 400, result.body);
      assert.equal(result.headers['x-ratelimit-limit'], '8');
      assert.equal(Number(result.headers['x-ratelimit-remaining']), 7 - index);
    }
    const blocked = await attempt(app, '192.0.2.1');
    assert.equal(blocked.statusCode, 429, blocked.body);
    assert.equal(blocked.json().error.code, 'RATE_LIMITED');
    assert.ok(Number(blocked.headers['retry-after']) > 0);
    assert.equal(blocked.headers['cache-control'], 'no-store');
    assert.equal((await attempt(app, '192.0.2.2')).statusCode, 400, 'independent client has its own limit');
    assert.equal((await app.inject({ url: '/api/v1/health/live', remoteAddress: '192.0.2.1' })).statusCode, 200);
  } finally { await app.close(); }
});

test('untrusted peers cannot rotate forwarding headers to bypass their socket-IP limit', async () => {
  for (const trusted of ['', '192.0.2.10']) {
    const app = application(trusted);
    try {
      await app.ready();
      for (let index = 0; index < 9; index++) {
        const result = await attempt(app, '192.0.2.11', `198.51.100.${index + 1}`);
        assert.equal(result.statusCode, index < 8 ? 400 : 429, result.body);
      }
    } finally { await app.close(); }
  }
});

test('verified ingress separates real clients and ignores prepended spoofed addresses', async () => {
  const app = application('192.0.2.10');
  try {
    await app.ready();
    for (let index = 0; index < 9; index++) {
      // Nginx appends the real peer after any header supplied by that client.
      const result = await attempt(app, '192.0.2.10', `203.0.113.${index + 1}, 198.51.100.1`);
      assert.equal(result.statusCode, index < 8 ? 400 : 429, result.body);
    }
    const otherClient = await attempt(app, '192.0.2.10', '198.51.100.2');
    assert.equal(otherClient.statusCode, 400, 'a different real client behind the same ingress is not blocked');
    assert.equal(otherClient.headers['x-ratelimit-remaining'], '7');
  } finally { await app.close(); }
});
