import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { DomainError } from '../src/contracts.js';
import { parseCommandEnvelope, parseLoginInput, UUID_ROUTE_PARAMETERS } from '../src/publicInputs.js';

process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:1/unused';
const [{ buildApp }, { pool }] = await Promise.all([import('../src/app.js'), import('../src/db.js')]);
after(async () => { await pool.end(); });

const invalid = (error: unknown) => error instanceof DomainError && error.code === 'VALIDATION_FAILED' && error.statusCode === 400;
const envelope = () => ({ protocolVersion: 1, commandId: randomUUID(), deviceId: randomUUID(), type: 'shift.open', occurredAt: '2026-10-20T11:00:00.000Z', expectedVersions: {}, payload: { openingFloatMinor: 0 } });

test('actual sign-in route rejects malformed values before issuing any database query', async t => {
  let queries = 0;
  t.mock.method(pool, 'query', () => { queries++; throw new Error('Database must not be reached'); });
  const app = buildApp({ logger: { level: 'silent' } });
  try {
    const invalidEmails = [123, [], ['operator@example.invalid'], {}, null, true, '', 'a'.repeat(255) + '@example.invalid', 'not-an-email', 'a\n@example.invalid'];
    const bodies: unknown[] = [null, [], true, 123, ...invalidEmails.map(email => ({ email, password: 'example-invalid-password' })),
      { email: 'operator@example.invalid', password: null }, { email: 'operator@example.invalid', password: [] },
      { email: 'operator@example.invalid', password: 'a'.repeat(257) },
      { email: 'operator@example.invalid', password: 'password', deviceId: '------------------------------------' },
      { email: 'operator@example.invalid', password: 'password', tenantId: randomUUID() }];
    for (const [index, body] of bodies.entries()) {
      const result = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `192.0.2.${index + 1}`, headers: { 'content-type': 'application/json' }, payload: JSON.stringify(body) });
      assert.equal(result.statusCode, 400, `${JSON.stringify(body)}: ${result.body}`);
      assert.equal(result.json().error.code, 'VALIDATION_FAILED');
      assert.ok(!result.body.includes('Database must not be reached'));
    }
    assert.equal(queries, 0);
  } finally { await app.close(); }
});

test('sign-in normalizes email after validation and preserves password bytes', () => {
  assert.deepEqual(parseLoginInput({ email: ' Operator@Example.Invalid ', password: ' password ' }), { email: 'operator@example.invalid', password: ' password ' });
});

test('actual routes reject malformed UUID paths and repeated query values before authentication/database work', async t => {
  let queries = 0, connections = 0;
  t.mock.method(pool, 'query', () => { queries++; throw new Error('Database query must not be reached'); });
  t.mock.method(pool, 'connect', () => { connections++; throw new Error('Database connection must not be reached'); });
  const app = buildApp({logger:{level:'silent'}});
  try {
    for (const url of ['/staff/bad-id/sessions','/configuration/assets/bad-id','/catalog/imports/bad-id','/inventory/shortfalls/bad-id',
      '/inventory/counts/bad-id','/shifts/bad-id/cash-movements','/sales/orders/bad-id/receipt','/customers/bad-id/statement',
      '/inventory/counts/bad-id/events/bad-id','/reports/journal-source/bad-id','/commands/bad-id','/sales/orders?q=a&q=b','/inventory/movements?limit=1&limit=2',
      '/sales/orders?q=prefix%00suffix','/inventory/movements?q=%0Asearch']) {
      const result = await app.inject({url:'/api/v1'+url});
      assert.equal(result.statusCode,400,`${url}: ${result.body}`);
      assert.equal(result.json().error.code,'VALIDATION_FAILED');
    }
    for (const url of ['/configuration/assets/legacy/logo','/finance/records/expenses',`/sales/orders/${randomUUID()}/receipt/assets/logo`]) {
      const result = await app.inject({url:'/api/v1'+url});
      assert.equal(result.statusCode,401,`${url}: valid route values continue to authentication`);
    }
    assert.equal(queries,0); assert.equal(connections,0);
  } finally {await app.close();}
});

test('every identifier route is covered while opaque kind parameters remain outside UUID validation',()=>{
  const source=readFileSync(new URL('../src/app.ts',import.meta.url),'utf8');
  const identifiers=new Set<string>();
  for(const route of source.matchAll(/['"]\/api\/v1\/[^'"\r\n]+['"]/g))for(const parameter of route[0].matchAll(/:([A-Za-z][A-Za-z0-9]*)/g))if(parameter[1]!=='kind')identifiers.add(parameter[1]);
  assert.deepEqual([...identifiers].sort(),[...UUID_ROUTE_PARAMETERS].sort());
});

test('malformed and empty JSON produce controlled 400 responses', async () => {
  const app = buildApp({ logger: { level: 'silent' } });
  try {
    for (const payload of ['{', '']) {
      const result = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'content-type': 'application/json' }, payload });
      assert.equal(result.statusCode, 400, result.body);
      assert.equal(result.json().error.code, 'VALIDATION_FAILED');
    }
  } finally { await app.close(); }
});

test('envelope requires genuine UUIDs, plain object shapes and positive safe versions', () => {
  const valid = envelope();
  assert.equal(parseCommandEnvelope(valid), valid, 'validation never rewrites hashed command content');
  const cases: unknown[] = [null, [], 'command', { ...valid, commandId: '------------------------------------' },
    { ...valid, commandId: '00000000-0000-0000-0000-000000000000' },
    { ...valid, deviceId: 'device' }, { ...valid, tenantId: '' }, { ...valid, tenantId: [] },
    { ...valid, protocolVersion: '1' }, { ...valid, payload: [] }, { ...valid, payload: null },
    { ...valid, expectedVersions: [] }, { ...valid, expectedVersions: null },
    ...[0, -1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 1].map(version => ({ ...valid, expectedVersions: { [`shift:${randomUUID()}`]: version } })),
    { ...valid, payload: new Date() }, { ...valid, type: ['shift.open'] }, { ...valid, extra: true },
    JSON.parse(JSON.stringify(valid).replace('"expectedVersions":{}', '"expectedVersions":{"__proto__":1}'))];
  for (const input of cases) assert.throws(() => parseCommandEnvelope(input), invalid, JSON.stringify(input));
});

test('envelope timestamps require a real ISO calendar date, time and explicit timezone', () => {
  for (const occurredAt of [123, null, '', '2026-10-20', '2026-02-30T12:00:00Z', '2026-10-20T24:00:00Z', '2026-10-20T12:00:00', '2026-10-20T12:00:00+25:00']) {
    assert.throws(() => parseCommandEnvelope({ ...envelope(), occurredAt }), invalid, String(occurredAt));
  }
  parseCommandEnvelope({ ...envelope(), occurredAt: '2026-10-20T14:00:00+03:00' });
});
