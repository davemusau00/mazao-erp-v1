import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

const databaseUrl=process.env.TEST_DATABASE_URL;
if(!databaseUrl)test('authenticated outlet context switching is authorized, atomic and audited',{skip:'Set TEST_DATABASE_URL to an isolated migrated PostgreSQL database.'},()=>{});
else {
  process.env.DATABASE_URL=databaseUrl;process.env.APP_ORIGINS??='http://localhost:3000';
  const [{buildApp},{hashPassword,hashToken},db]=await Promise.all([import('../src/app.js'),import('../src/security.js'),import('../src/db.js')]);
  test('active assignments change only the locked session context and retain authentication',async t=>{
    const userId=randomUUID(),tenantA=randomUUID(),tenantB=randomUUID(),outletA=randomUUID(),outletB=randomUUID(),deviceA=randomUUID(),deviceB=randomUUID(),foreignDevice=randomUUID();
    const email=`context-${userId}@example.invalid`,password='disposable-context-switch-password';
    await db.pool.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Context source','KES','Africa/Nairobi'),($2,'Context target','KES','Africa/Nairobi')",[tenantA,tenantB]);
    await db.pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Source outlet','Africa/Nairobi'),($3,$4,'Target outlet','Africa/Nairobi')",[outletA,tenantA,outletB,tenantB]);
    await db.pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)',[userId,email,await hashPassword(password),'Context operator']);
    await db.pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin'),($3,$2,'cashier')",[tenantA,userId,tenantB]);
    await db.pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Source terminal'),($5,$6,$7,$4,'Target terminal')",[deviceA,tenantA,outletA,userId,deviceB,tenantB,outletB]);
    const otherUser=randomUUID(),otherTenant=randomUUID(),otherOutlet=randomUUID();
    await db.pool.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Foreign context','KES','Africa/Nairobi')",[otherTenant]);
    await db.pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Foreign outlet','Africa/Nairobi')",[otherOutlet,otherTenant]);
    await db.pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)',[otherUser,`foreign-${otherUser}@example.invalid`,await hashPassword(password),'Foreign operator']);
    await db.pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[otherTenant,otherUser]);
    await db.pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Foreign terminal')",[foreignDevice,otherTenant,otherOutlet,otherUser]);

    const app=buildApp({logger:{level:'silent'}});await app.ready();t.after(async()=>{await app.close();await db.pool.end();});
    const login=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:'198.51.109.31',payload:{email,password,deviceId:deviceA}});
    assert.equal(login.statusCode,200,login.body);
    const raw=login.headers['set-cookie'];const cookies=(Array.isArray(raw)?raw:[raw]).filter((value):value is string=>typeof value==='string').map(value=>value.split(';',1)[0]).join('; ');
    const token=/maz_session=([^;]+)/.exec(cookies)?.[1];assert.ok(token);
    const headers={cookie:cookies,origin:'http://localhost:3000','x-csrf-token':login.json().csrfToken};
    const choices=await app.inject({url:'/api/v1/auth/assignments',headers});
    assert.equal(choices.statusCode,200,choices.body);
    assert.deepEqual(choices.json().assignments.map((row:{deviceId:string})=>row.deviceId).sort(),[deviceA,deviceB].sort());

    const missingCsrf=await app.inject({method:'POST',url:'/api/v1/auth/context',headers:{cookie:cookies,origin:'http://localhost:3000'},payload:{deviceId:deviceB}});
    assert.equal(missingCsrf.statusCode,403);assert.equal(missingCsrf.json().error.code,'CSRF_FAILED');
    const extraInput=await app.inject({method:'POST',url:'/api/v1/auth/context',headers,payload:{deviceId:deviceB,tenantId:tenantB}});
    assert.equal(extraInput.statusCode,400);assert.equal(extraInput.json().error.code,'VALIDATION_FAILED');
    const unauthorized=await app.inject({method:'POST',url:'/api/v1/auth/context',headers,payload:{deviceId:foreignDevice}});
    assert.equal(unauthorized.statusCode,409);assert.equal(unauthorized.json().error.code,'ASSIGNMENT_UNAVAILABLE');
    assert.equal((await app.inject({url:'/api/v1/auth/me',headers})).json().tenant.id,tenantA,'a rejected choice leaves the current context intact');

    const switched=await app.inject({method:'POST',url:'/api/v1/auth/context',headers,payload:{deviceId:deviceB}});
    assert.equal(switched.statusCode,200,switched.body);assert.equal(switched.json().tenant.id,tenantB);assert.equal(switched.json().user.role,'cashier');
    const restored=await app.inject({url:'/api/v1/auth/me',headers});
    assert.equal(restored.statusCode,200,restored.body);assert.equal(restored.json().tenant.id,tenantB);assert.equal(restored.json().outlet.id,outletB);assert.equal(restored.json().deviceId,deviceB);
    const persisted=await db.pool.query<{tenant_id:string;outlet_id:string;device_id:string;version:string}>('SELECT tenant_id,outlet_id,device_id,version::text FROM identity.sessions WHERE token_hash=$1',[hashToken(token)]);
    assert.equal(persisted.rowCount,1);assert.equal(persisted.rows[0].tenant_id,tenantB);assert.equal(persisted.rows[0].outlet_id,outletB);assert.equal(persisted.rows[0].device_id,deviceB);assert.equal(persisted.rows[0].version,'2');
    const audit=await db.pool.query<{tenant_id:string;outlet_id:string;event_type:string;payload:{to:{tenantId:string;outletId:string;deviceId:string}}}>("SELECT tenant_id,outlet_id,event_type,payload FROM system.audit_events WHERE actor_id=$1 AND event_type='AUTH_CONTEXT_SWITCHED' ORDER BY created_at DESC LIMIT 1",[userId]);
    assert.equal(audit.rowCount,1);assert.equal(audit.rows[0].tenant_id,tenantA);assert.equal(audit.rows[0].outlet_id,outletA);
    assert.equal(audit.rows[0].payload.to.tenantId,tenantB);assert.equal(audit.rows[0].payload.to.outletId,outletB);assert.equal(audit.rows[0].payload.to.deviceId,deviceB);
  });
}
