import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DomainError, type ApiSession } from '../src/contracts.js';
import { parseHistoryQuery } from '../src/historyPagination.js';

const session = { tenantId:randomUUID(),outletId:randomUUID(),userId:randomUUID() } as ApiSession;
const rejected=(error:unknown)=>error instanceof DomainError&&error.code==='VALIDATION_FAILED'&&error.statusCode===400;
const encode=(cursor:unknown)=>Buffer.from(JSON.stringify(cursor)).toString('base64url');

test('forged history cursors reject impossible calendar dates and times without losing genuine microseconds',()=>{
  const base=parseHistoryQuery(session,'test-history');
  const cursor=[base.scope,'2000-01-03T00:00:00.000Z','2000-01-02T00:00:00.123456Z',randomUUID(),1];
  assert.equal(parseHistoryQuery(session,'test-history',{after:encode(cursor)}).afterTime,'2000-01-02T00:00:00.123456Z');
  for(const invalid of ['0000-01-01T00:00:00.000Z','2000-02-30T00:00:00.000Z','2000-01-02T24:00:00.000Z','2000-01-02T12:60:00.000Z','2000-01-02T12:00:60.000Z']) {
    for(const field of [1,2]) {
      const forged=[...cursor];forged[field]=invalid;
      assert.throws(()=>parseHistoryQuery(session,'test-history',{after:encode(forged)}),rejected,invalid);
    }
  }
});

test('history search rejects all control characters before parameter construction',()=>{
  for(const q of ['\u0000','prefix\u0000suffix','\nsearch','search\t','search\u007f'])assert.throws(()=>parseHistoryQuery(session,'test-history',{q}),rejected);
  assert.equal(parseHistoryQuery(session,'test-history',{q:'  plain search  '}).search,'plain search');
});
