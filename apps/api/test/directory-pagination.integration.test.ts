import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { COMMAND_CATALOGUE } from '../src/commandCatalogue.js';
import { assertContract } from '../src/contractValidation.js';

if (!process.env.TEST_DATABASE_URL) {
  test('complete customer, staff, assignment, session and reservation navigation', { skip: 'Requires disposable TEST_DATABASE_URL.' }, () => {});
} else {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.APP_ORIGINS ??= 'http://localhost:3000';
  const [{ buildApp }, { pool }, { hashPassword }] = await Promise.all([import('../src/app.js'), import('../src/db.js'), import('../src/security.js')]);
  test('directory navigation reaches former caps while preserving scope, totals and continuation', async t => {
    const app = buildApp({ logger: { level: 'error' } });
    const tenantId = randomUUID(), outletId = randomUUID(), userId = randomUUID(), deviceId = randomUUID(), roomId = randomUUID();
    const email = `directory-${userId}@example.invalid`, password = `Directory-${randomUUID()}`;
    try {
      await app.ready();
      await pool.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Directory fixtures','KES','Africa/Nairobi')", [tenantId]);
      await pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Directory outlet','Africa/Nairobi')", [outletId, tenantId]);
      await pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'commerce'),($1,'inventory'),($1,'hospitality')", [tenantId]);
      await pool.query("INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,'Directory owner')", [userId, email, await hashPassword(password)]);
      await pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role,display_name) VALUES($1,$2,'owner','Directory owner')", [tenantId, userId]);
      await pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Owner assignment')", [deviceId, tenantId, outletId, userId]);
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password, deviceId } });
      assert.equal(login.statusCode, 200, login.body);
      const cookies = login.headers['set-cookie'];
      const headers = { cookie: (Array.isArray(cookies) ? cookies : [cookies]).filter((value): value is string => typeof value === 'string').map(value => value.split(';', 1)[0]).join('; ') };
      const read = async (path: string) => { const response = await app.inject({ url: '/api/v1' + path, headers }); assert.equal(response.statusCode, 200, response.body); return response.json(); };

      await pool.query(`INSERT INTO finance.customer_accounts(id,tenant_id,display_name,phone,credit_limit_minor,created_at)
        SELECT gen_random_uuid(),$1,CASE WHEN g=1 THEN 'oldest-customer-target' ELSE 'Customer '||g END,'+254700'||g,100,
          '2000-01-01'::timestamptz+floor(g/2)*interval '1 microsecond' FROM generate_series(1,501) g`, [tenantId]);
      await pool.query(`WITH inserted AS (INSERT INTO identity.users(id,email,password_hash,full_name,created_at)
        SELECT gen_random_uuid(),'staff-'||gen_random_uuid()||'@example.invalid',NULL,CASE WHEN g=1 THEN 'oldest-staff-target' ELSE 'Staff '||g END,
          '2000-01-01'::timestamptz+floor(g/2)*interval '1 microsecond' FROM generate_series(1,501) g RETURNING id,full_name)
        INSERT INTO identity.memberships(tenant_id,user_id,role,display_name) SELECT $1,id,'cashier',full_name FROM inserted`, [tenantId]);
      await pool.query(`INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label,created_at)
        SELECT gen_random_uuid(),$1,$2,$3,CASE WHEN g=1 THEN 'oldest-assignment-target' ELSE 'Assignment '||g END,
          '2000-01-01'::timestamptz+floor(g/2)*interval '1 microsecond' FROM generate_series(1,501) g`, [tenantId, outletId, userId]);
      await pool.query(`INSERT INTO identity.sessions(id,token_hash,csrf_hash,user_id,tenant_id,outlet_id,device_id,created_at,expires_at)
        SELECT gen_random_uuid(),decode(md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text),'hex'),decode(md5(gen_random_uuid()::text),'hex'),
          $1,$2,$3,$4,'2000-01-01'::timestamptz+floor(g/2)*interval '1 microsecond',now()+interval '12 hours' FROM generate_series(1,101) g`, [userId, tenantId, outletId, deviceId]);
      await pool.query("INSERT INTO hospitality.rooms(id,tenant_id,outlet_id,room_number,room_type,nightly_rate_minor,tax_rate_bps,currency) VALUES($1,$2,$3,'101','Standard',1000,0,'KES')", [roomId, tenantId, outletId]);
      await pool.query(`INSERT INTO hospitality.reservations(id,tenant_id,outlet_id,room_id,guest_name,check_in_date,check_out_date,nightly_rate_minor,tax_rate_bps,currency,status,created_by,created_at)
        SELECT gen_random_uuid(),$1,$2,$3,CASE WHEN g=1 THEN 'oldest-reservation-target' ELSE 'Guest '||g END,
          DATE '2030-01-01'+g*2,DATE '2030-01-02'+g*2,1000,0,'KES','CONFIRMED',$4,
          '2000-01-01'::timestamptz+floor(g/2)*interval '1 microsecond' FROM generate_series(1,251) g`, [tenantId, outletId, roomId, userId]);

      await t.test('all directories traverse equal timestamps to records beyond prior caps without duplicates', async () => {
        for (const [path, key, idKey, total] of [['/customers','customers','id',501],['/staff','staff','userId',502],['/devices','devices','id',502],['/auth/sessions','sessions','id',102],['/hospitality/reservations','reservations','id',251]] as const) {
          let response = await read(path + '?limit=37'); const ids = new Set<string>();
          assert.equal(response.page.totalCount, total, path);
          while (true) {
            for (const row of response[key]) { assert.ok(!ids.has(row[idKey]), `${path} duplicate`); ids.add(row[idKey]); }
            if (!response.page.nextCursor) break;
            response = await read(path + '?limit=37&after=' + response.page.nextCursor);
          }
          assert.equal(ids.size, total, path);
        }
      });
      await t.test('server search reaches the oldest directory entry and customer totals cover the whole business', async () => {
        for (const [path,key,term] of [['/customers','customers','oldest-customer-target'],['/staff','staff','oldest-staff-target'],['/devices','devices','oldest-assignment-target'],['/hospitality/reservations','reservations','oldest-reservation-target']] as const) {
          const response = await read(path + '?q=' + term); assert.equal(response[key].length, 1); assert.equal(response.page.totalCount, 1);
        }
        const customers = await read('/customers?limit=1&q=oldest-customer-target');
        assert.equal(customers.summary.accountCount, 501); assert.equal(customers.summary.totalCreditLimitMinor, '50100');
        const staff = await read('/staff?q=oldest-staff-target'); assert.equal((await read('/staff?q=' + staff.staff[0].userId)).staff[0].userId, staff.staff[0].userId);
      });
      await t.test('new rows do not enter an existing continuation and filters cannot be swapped', async () => {
        const first = await read('/customers?limit=250');
        await pool.query("INSERT INTO finance.customer_accounts(id,tenant_id,display_name,phone,credit_limit_minor) VALUES($1,$2,'New customer','+254700000000',100)", [randomUUID(), tenantId]);
        const second = await read('/customers?limit=250&after=' + first.page.nextCursor);
        const third = await read('/customers?after=' + second.page.nextCursor);
        assert.equal(second.page.totalCount, 501); assert.equal(third.customers.length, 1);
        assert.equal((await read('/customers')).page.totalCount, 502);
        for (const path of ['/staff?after='+first.page.nextCursor,'/customers?q=changed&after='+first.page.nextCursor,'/customers?limit=251','/staff?unexpected=1']) {
          const response = await app.inject({ url:'/api/v1'+path,headers }); assert.equal(response.statusCode,400,response.body);
        }
      });
      await t.test('foreign tenants remain absent and reservation cursors cannot cross outlet assignments', async () => {
        const foreignTenant=randomUUID(),foreignOutlet=randomUUID(),foreignDevice=randomUUID();
        await pool.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Foreign directory','KES','Africa/Nairobi')",[foreignTenant]);
        await pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'FOREIGN_DIRECTORY_TARGET','Africa/Nairobi')",[foreignOutlet,foreignTenant]);
        await pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role,display_name) VALUES($1,$2,'owner','FOREIGN_DIRECTORY_TARGET')",[foreignTenant,userId]);
        await pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'FOREIGN_DIRECTORY_TARGET')",[foreignDevice,foreignTenant,foreignOutlet,userId]);
        await pool.query("INSERT INTO finance.customer_accounts(id,tenant_id,display_name,phone,credit_limit_minor) VALUES($1,$2,'FOREIGN_DIRECTORY_TARGET','+254700000001',1)",[randomUUID(),foreignTenant]);
        for(const [path,key] of [['/customers','customers'],['/staff','staff'],['/devices','devices']] as const)assert.equal((await read(path+'?q=FOREIGN_DIRECTORY_TARGET'))[key].length,0,path);
        const first=await read('/hospitality/reservations?limit=1'),otherOutlet=randomUUID(),otherDevice=randomUUID();
        await pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Other directory outlet','Africa/Nairobi')",[otherOutlet,tenantId]);
        await pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Other directory assignment')",[otherDevice,tenantId,otherOutlet,userId]);
        const otherLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password,deviceId:otherDevice}});assert.equal(otherLogin.statusCode,200,otherLogin.body);
        const raw=otherLogin.headers['set-cookie'];
        const otherHeaders={cookie:(Array.isArray(raw)?raw:[raw]).filter((value):value is string=>typeof value==='string').map(value=>value.split(';',1)[0]).join('; ')};
        const empty=await app.inject({url:'/api/v1/hospitality/reservations',headers:otherHeaders});assert.equal(empty.statusCode,200,empty.body);assert.equal(empty.json().reservations.length,0);
        const swapped=await app.inject({url:'/api/v1/hospitality/reservations?after='+first.page.nextCursor,headers:otherHeaders});assert.equal(swapped.statusCode,400,swapped.body);
        // Tenant-wide directories remain available from another authorized outlet.
        const customers=await app.inject({url:'/api/v1/customers',headers:otherHeaders});assert.equal(customers.statusCode,200,customers.body);assert.equal(customers.json().page.totalCount,502);
      });
      await t.test('forged impossible-date cursors and NUL searches return controlled HTTP validation failures', async()=>{
        const first=await read('/customers?limit=1');
        const original=JSON.parse(Buffer.from(first.page.nextCursor,'base64url').toString('utf8')) as unknown[];
        for(const field of [1,2]){
          const forged=[...original];forged[field]='2000-02-30T00:00:00.000000Z';
          const after=Buffer.from(JSON.stringify(forged)).toString('base64url');
          const response=await app.inject({url:'/api/v1/customers?after='+after,headers});
          assert.equal(response.statusCode,400,response.body);assert.equal(response.json().error.code,'VALIDATION_FAILED');
        }
        for(const path of ['/customers?q=%00','/staff?q=prefix%00suffix','/hospitality/reservations?q=%0Aguest']){
          const response=await app.inject({url:'/api/v1'+path,headers});assert.equal(response.statusCode,400,response.body);assert.equal(response.json().error.code,'VALIDATION_FAILED');
        }
      });
      await t.test('all four migrated handlers return their declared schemas and preserve padded reason acceptance',async()=>{
        const submit=async(type:string,payload:Record<string,unknown>,expectedVersions:Record<string,number>={})=>{
          const response=await app.inject({method:'POST',url:'/api/v1/commands',headers:{...headers,origin:process.env.APP_ORIGINS!.split(',')[0],'x-csrf-token':login.json().csrfToken},payload:{protocolVersion:1,commandId:randomUUID(),tenantId,deviceId,type,occurredAt:new Date().toISOString(),expectedVersions,payload}});
          assert.equal(response.statusCode,200,response.body);assert.equal(response.json().status,'CONFIRMED',response.body);
          assertContract(response.json().value,COMMAND_CATALOGUE[type].outputSchema);
        };
        await submit('shift.open',{openingFloatMinor:0});
        await pool.query("UPDATE hospitality.rooms SET status='DIRTY' WHERE id=$1 AND tenant_id=$2",[roomId,tenantId]);
        await submit('hotel.room.mark_ready',{roomId},{['room:'+roomId]:1});
        const sessions=(await read('/auth/sessions')).sessions.filter((session:{current:boolean})=>!session.current);
        assert.ok(sessions.length>=2);
        await submit('auth.session.revoke',{sessionId:sessions[0].id,reason:' '+ 'a'.repeat(500)+' '},{['session:'+sessions[0].id]:1});
        await submit('staff.sessions.revoke',{userId,sessionId:sessions[1].id,reason:'\u00a0'+ 'a'.repeat(500)+'\u00a0'},{['session:'+sessions[1].id]:1});
      });
      await t.test('sessions bind their target and current role continues to authorize every directory page', async () => {
        const first = await read('/auth/sessions?limit=1'), member = (await read('/staff?q=oldest-staff-target')).staff[0];
        const swapped = await app.inject({url:`/api/v1/staff/${member.userId}/sessions?after=${first.page.nextCursor}`,headers}); assert.equal(swapped.statusCode,400,swapped.body);
        const staffPage = await read('/staff?limit=1');
        await pool.query("UPDATE identity.memberships SET role='cashier' WHERE tenant_id=$1 AND user_id=$2",[tenantId,userId]);
        for (const path of ['/staff?after='+staffPage.page.nextCursor,'/devices','/hospitality/reservations',`/staff/${member.userId}/sessions`]) {
          const response=await app.inject({url:'/api/v1'+path,headers});assert.equal(response.statusCode,403,response.body);
        }
        assert.equal((await read('/auth/sessions')).userId,userId);
        assert.equal((await read('/customers')).page.totalCount,502);
      });
    } finally { await app.close(); await pool.end(); }
  });
}
