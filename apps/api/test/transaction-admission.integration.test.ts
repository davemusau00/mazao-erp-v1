import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

if(!process.env.TEST_DATABASE_URL) {
  test('transaction admission releases PostgreSQL session locks',{skip:'Requires disposable TEST_DATABASE_URL.'},()=>{});
} else {
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
  const {pool,inTransaction}=await import('../src/db.js');
  const admission=()=>({sharedLockKey:`admission-shared:${randomUUID()}`,exclusiveLockKey:`admission-exclusive:${randomUUID()}`});
  async function locks(pid:number) {
    return Number((await pool.query("SELECT count(*)::int total FROM pg_locks WHERE locktype='advisory' AND pid=$1 AND granted",[pid])).rows[0].total);
  }
  test('pre-transaction admission cleans up its PostgreSQL locks and pooled clients',async t=>{
    t.after(()=>pool.end());
    await t.test('commit and domain failure release session and reentrant transaction locks',async()=>{
      const scope=admission();
      const pid=await inTransaction(async client=>{
        await client.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1::text,0))',[scope.sharedLockKey]);
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))',[scope.exclusiveLockKey]);
        const result=await client.query('SELECT pg_backend_pid() pid');
        const held=await client.query("SELECT count(*)::int total FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid() AND granted");
        assert.ok(held.rows[0].total>=2,'Both admission locks must be held during the business transaction.');
        return result.rows[0].pid as number;
      },scope);
      assert.equal(await locks(pid),0,'No session lock may return to the pool after commit.');
      let failedPid=0;
      await assert.rejects(inTransaction(async client=>{
        failedPid=(await client.query('SELECT pg_backend_pid() pid')).rows[0].pid;
        throw new Error('Intentional domain failure');
      },scope),/Intentional domain failure/);
      assert.equal(await locks(failedPid),0,'No session lock may return to the pool after rollback.');
    });
    await t.test('an unlock failure discards the client and releases remaining locks',async()=>{
      const scope=admission();
      const pid=await inTransaction(async client=>{
        const backendPid=(await client.query('SELECT pg_backend_pid() pid')).rows[0].pid as number;
        const original=client.query.bind(client) as (...args:any[])=>any;
        Object.defineProperty(client,'query',{configurable:true,value:(...args:any[])=>{
          if(typeof args[0]==='string'&&args[0].startsWith('SELECT pg_advisory_unlock('))return Promise.reject(new Error('Simulated unlock transport failure'));
          return original(...args);
        }});
        return backendPid;
      },scope);
      // Closing the discarded connection releases locks at the database even
      // when the unlock acknowledgement is unavailable.
      for(let attempt=0;attempt<20&&await locks(pid)>0;attempt++)await new Promise(resolve=>setTimeout(resolve,10));
      assert.equal(await locks(pid),0);
      assert.equal((await pool.query('SELECT 1 value')).rows[0].value,1,'The pool remains usable after discarding the failed client.');
    });
  });
}
