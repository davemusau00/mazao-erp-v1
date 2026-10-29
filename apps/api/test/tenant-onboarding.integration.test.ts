import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CommandEnvelope } from '../src/contracts.js';

const databaseUrl=process.env.TEST_DATABASE_URL;
if(!databaseUrl)test('tenant setup isolation and reviewed go-live gate',{skip:'Set TEST_DATABASE_URL to an isolated migrated PostgreSQL database.'},()=>{});
else {
  process.env.DATABASE_URL=databaseUrl;
  process.env.APP_ORIGINS??='http://localhost:3000';
  const [{buildApp},{hashPassword},db]=await Promise.all([import('../src/app.js'),import('../src/security.js'),import('../src/db.js')]);
  test('a bootstrapped owner can prepare only setup work until reviewed go-live',async()=>{
    const tenantId=randomUUID(),outletId=randomUUID(),ownerId=randomUUID(),deviceId=randomUUID(),requestId=randomUUID();
    const email=`onboarding-${ownerId}@example.invalid`,password='disposable-onboarding-password';
    await db.pool.query("INSERT INTO core.tenants(id,name,currency,time_zone,business_profile) VALUES($1,'Pending business','KES','Africa/Nairobi',$2::jsonb)",[tenantId,JSON.stringify({taxPolicy:{calculation:'exclusive',defaultRateBps:0,label:'Tax',reviewed:false}})]);
    await db.pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'First outlet','Africa/Nairobi')",[outletId,tenantId]);
    await db.pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'commerce'),($1,'inventory'),($1,'retail')",[tenantId]);
    await db.pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)',[ownerId,email,await hashPassword(password),'Setup Owner']);
    await db.pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role,display_name) VALUES($1,$2,'owner','Setup Owner')",[tenantId,ownerId]);
    await db.pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Initial setup workspace')",[deviceId,tenantId,outletId,ownerId]);
    await db.pool.query("INSERT INTO core.tenant_onboarding(tenant_id,bootstrap_key_hash,status) VALUES($1,$2,'SETUP')",[tenantId,createHash('sha256').update(requestId).digest('hex')]);
    const app=buildApp();await app.ready();
    try {
      const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password}});
      assert.equal(login.statusCode,200,login.body);assert.equal(login.json().onboardingStatus,'SETUP');
      const raw=login.headers['set-cookie'];
      const cookie=(Array.isArray(raw)?raw:[raw]).filter((item):item is string=>typeof item==='string').map(item=>item.split(';',1)[0]).join('; ');
      const headers={cookie,origin:'http://localhost:3000','x-csrf-token':login.json().csrfToken};
      const command=(type:string,payload:Record<string,unknown>,expectedVersions:Record<string,number>={}):CommandEnvelope=>({protocolVersion:1,commandId:randomUUID(),tenantId,deviceId,type,occurredAt:new Date().toISOString(),expectedVersions,payload});
      const submit=(envelope:CommandEnvelope)=>app.inject({method:'POST',url:'/api/v1/commands',headers,payload:envelope});
      const configuration=await app.inject({url:'/api/v1/configuration',headers});
      assert.equal(configuration.statusCode,200,configuration.body);assert.equal(configuration.json().configuration.onboarding.status,'SETUP');
      const ordinaryRead=await app.inject({url:'/api/v1/reports/account-catalog',headers});
      assert.equal(ordinaryRead.statusCode,403);assert.equal(ordinaryRead.json().error.code,'ONBOARDING_REQUIRED');
      const directSale=await submit(command('sales.order.settle',{}));
      assert.equal(directSale.statusCode,403);assert.equal(directSale.json().error.code,'ONBOARDING_REQUIRED');
      const incomplete=await submit(command('configuration.go_live.approve',{reason:'I checked the empty setup.'},{[`business:${tenantId}`]:1}));
      assert.equal(incomplete.json().status,'CONFLICT');assert.equal(incomplete.json().code,'ONBOARDING_INCOMPLETE');

      const initial=configuration.json().configuration;
      const business=initial.business;
      const configured=await submit(command('configuration.business.update',{
        name:business.name,currency:business.currency,timeZone:business.timeZone,legalName:business.legalName,registrationNumber:business.registrationNumber,taxRegistrationNumber:business.taxRegistrationNumber,
        address:business.address,phone:business.phone,email:business.email,website:business.website,logoUrl:'',receiptQrImage:'',showQrOnReceipt:business.showQrOnReceipt,receiptHeader:business.receiptHeader,receiptFooter:business.receiptFooter,
        taxPolicy:{...business.taxPolicy,reviewed:true},imageActions:{logo:{mode:'keep'},receiptQr:{mode:'keep'}},
      },{[`business:${tenantId}`]:1}));
      assert.equal(configured.json().status,'CONFIRMED',configured.body);
      const product=await submit(command('catalog.product.create',{sku:'ONBOARDING-1',name:'Onboarding stock',baseUnit:'each',currency:'KES',sellingPriceMinor:1000,costPriceMinor:500}));
      assert.equal(product.json().status,'CONFIRMED',product.body);
      const received=await submit(command('inventory.receive',{lines:[{productId:product.json().value.productId,quantity:'1',unitCostMinor:500}],documentReference:'ONBOARDING-RECEIPT'}));
      assert.equal(received.json().status,'CONFIRMED',received.body);
      const current=await app.inject({url:'/api/v1/configuration',headers});
      assert.equal(current.json().configuration.readiness.readyForFirstSale,true);
      const approved=await submit(command('configuration.go_live.approve',{reason:'Owner verified business identity, tax, initial stock and first operator.'},{[`business:${tenantId}`]:2}));
      assert.equal(approved.json().status,'CONFIRMED',approved.body);assert.equal(approved.json().value.status,'LIVE');
      assert.equal((await app.inject({url:'/api/v1/auth/me',headers})).json().onboardingStatus,'LIVE');
      assert.equal((await app.inject({url:'/api/v1/reports/account-catalog',headers})).statusCode,200);
      const evidence=await db.pool.query(`SELECT status,reviewed_by,reviewed_at,review_reason,go_live_command_id FROM core.tenant_onboarding WHERE tenant_id=$1`,[tenantId]);
      assert.equal(evidence.rows[0].status,'LIVE');assert.equal(evidence.rows[0].reviewed_by,ownerId);assert.ok(evidence.rows[0].reviewed_at);assert.ok(evidence.rows[0].review_reason);assert.equal(evidence.rows[0].go_live_command_id,approved.json().commandId);

      const foreignTenant=randomUUID(),foreignOutlet=randomUUID(),foreignUser=randomUUID(),foreignDevice=randomUUID(),foreignEmail=`foreign-${foreignUser}@example.invalid`;
      await db.pool.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Other business','KES','Africa/Nairobi')",[foreignTenant]);
      await db.pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Other outlet','Africa/Nairobi')",[foreignOutlet,foreignTenant]);
      await db.pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)',[foreignUser,foreignEmail,await hashPassword(password),'Other Owner']);
      await db.pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role,display_name) VALUES($1,$2,'owner','Other Owner')",[foreignTenant,foreignUser]);
      await db.pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Other workspace')",[foreignDevice,foreignTenant,foreignOutlet,foreignUser]);
      const foreignLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:foreignEmail,password}});
      assert.equal(foreignLogin.statusCode,200,foreignLogin.body);
      const foreignRaw=foreignLogin.headers['set-cookie'];
      const foreignCookie=(Array.isArray(foreignRaw)?foreignRaw:[foreignRaw]).filter((item):item is string=>typeof item==='string').map(item=>item.split(';',1)[0]).join('; ');
      const foreignHeaders={cookie:foreignCookie,origin:'http://localhost:3000','x-csrf-token':foreignLogin.json().csrfToken};
      const scoped=await app.inject({url:`/api/v1/configuration?tenantId=${tenantId}`,headers:foreignHeaders});
      assert.equal(scoped.statusCode,200);assert.equal(scoped.json().configuration.business.id,foreignTenant);assert.notEqual(scoped.json().configuration.onboarding.status,'SETUP');
    } finally { await app.close(); await db.pool.end(); }
  });
}
