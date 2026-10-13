import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:1/unused';
const [{ buildApp }, { hashCommand }, security, db] = await Promise.all([
  import('../src/app.js'), import('../src/commands.js'), import('../src/security.js'), import('../src/db.js'),
]);
const { moneyInputToMinor } = await import('../../../src/utils/money.js');

test('liveness is public while tenant catalog requires authentication', async () => {
  const app=buildApp(); await app.ready();
  const live=await app.inject({url:'/api/v1/health/live'});
  assert.equal(live.statusCode,200); assert.deepEqual(live.json(),{status:'live'});
  const protectedCatalog=await app.inject({url:'/api/v1/catalog/items'});
  assert.equal(protectedCatalog.statusCode,401);
  await app.close(); await db.pool.end();
});

test('password storage uses a salted, verifiable one-way hash', async()=>{
  const encoded=await security.hashPassword('a sufficiently long test password');
  assert.notEqual(encoded,'a sufficiently long test password');
  assert.equal(await security.verifyPassword('a sufficiently long test password',encoded),true);
  assert.equal(await security.verifyPassword('wrong password',encoded),false);
});

test('command hashing is order-independent for object keys and detects changed content',()=>{
  const base={protocolVersion:1 as const,commandId:'00000000-0000-4000-8000-000000000001',deviceId:'device',type:'shift.open',occurredAt:'2026-10-13T00:00:00Z',expectedVersions:{},payload:{openingFloatMinor:5000,metadata:{b:2,a:1}}};
  const reordered={...base,payload:{metadata:{a:1,b:2},openingFloatMinor:5000}};
  assert.deepEqual(hashCommand(base),hashCommand(reordered));
  assert.notDeepEqual(hashCommand(base),hashCommand({...base,payload:{openingFloatMinor:5001}}));
});

test('UI money boundary parses decimal text into integer minor units',()=>{
  assert.equal(moneyInputToMinor('1250.5'),125050);
  assert.equal(moneyInputToMinor('0.01'),1);
  assert.throws(()=>moneyInputToMinor('12.345'));
});
