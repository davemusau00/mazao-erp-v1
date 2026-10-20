import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { ApiRole } from '../src/contracts.js';

const databaseUrl=process.env.TEST_DATABASE_URL;
if(!databaseUrl){
  test('credential reconciliation fences never-received requests',{skip:'Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database.'},()=>{});
}else{
  process.env.DATABASE_URL=databaseUrl;
  process.env.APP_ORIGINS??='http://localhost:3000';
  process.env.CREDENTIAL_FINGERPRINT_KEY??='c'.repeat(64);
  const [{buildApp},db,security]=await Promise.all([import('../src/app.js'),import('../src/db.js'),import('../src/security.js')]);
  const origin=process.env.APP_ORIGINS.split(',')[0],password=`Disposable-fence-${randomUUID()}`;
  const passwordHash=await security.hashPassword(password);
  interface Scope {tenantId:string;outletId:string}
  interface Actor extends Scope {userId:string;deviceId:string;email:string;headers:Record<string,string>}
  let loginNumber=0;
  async function scope(tenantId:string=randomUUID()):Promise<Scope>{
    await db.pool.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Disposable credential business','KES','Africa/Nairobi') ON CONFLICT DO NOTHING",[tenantId]);
    const outletId=randomUUID();
    await db.pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Credential outlet','Africa/Nairobi')",[outletId,tenantId]);
    return {tenantId,outletId};
  }
  async function login(app:FastifyInstance,actor:Omit<Actor,'headers'>,secret=password):Promise<Actor>{
    const response=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin,'x-forwarded-for':`198.51.100.${++loginNumber}`},payload:{email:actor.email,password:secret,deviceId:actor.deviceId}});
    assert.equal(response.statusCode,200,response.body);
    const cookies=response.headers['set-cookie'];
    const cookie=(Array.isArray(cookies)?cookies:[cookies]).filter((value):value is string=>typeof value==='string').map(value=>value.split(';',1)[0]).join('; ');
    return {...actor,headers:{cookie,origin,'x-csrf-token':response.json().csrfToken}};
  }
  async function actor(app:FastifyInstance,context:Scope,role:ApiRole='admin',existing?:Actor):Promise<Actor>{
    const userId=existing?.userId??randomUUID(),email=existing?.email??`fence-${userId}@example.invalid`,deviceId=randomUUID();
    if(!existing)await db.pool.query("INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,'Credential operator')",[userId,email,passwordHash]);
    await db.pool.query('INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[context.tenantId,userId,role]);
    await db.pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Disposable credential assignment')",[deviceId,context.tenantId,context.outletId,userId]);
    return login(app,{...context,userId,email,deviceId});
  }
  async function fixture(t:TestContext){
    const app=buildApp({logger:{level:'silent'}});
    let pendingRace:(()=>Promise<unknown>)|undefined;
    app.addHook('preHandler',async request=>{if(request.headers['x-credential-race']==='1'&&pendingRace){const change=pendingRace;pendingRace=undefined;await change();}});
    await app.ready();t.after(()=>app.close());
    const owner=await actor(app,await scope()),target=await actor(app,owner,'cashier');
    return {app,owner,target,race:(change:()=>Promise<unknown>)=>{pendingRace=change;}};
  }
  const metadata=(target:Actor,kind:'staff.password.set'|'auth.password.change'='staff.password.set')=>({protocolVersion:1,commandId:randomUUID(),kind,targetUserId:target.userId,expectedCredentialVersion:1});
  const reconcile=(app:FastifyInstance,owner:Actor,input:Record<string,unknown>,race=false)=>app.inject({method:'POST',url:'/api/v1/auth/password/reconcile',headers:{...owner.headers,...(race?{'x-credential-race':'1'}:{})},payload:input});
  const original=(app:FastifyInstance,owner:Actor,input:ReturnType<typeof metadata>,secret=`Disposable-next-${randomUUID()}`)=>app.inject({method:'POST',url:input.kind==='auth.password.change'?'/api/v1/auth/password':`/api/v1/staff/${input.targetUserId}/password`,headers:owner.headers,payload:{protocolVersion:1,commandId:input.commandId,expectedVersions:{['credential:'+input.targetUserId]:input.expectedCredentialVersion},newPassword:secret,...(input.kind==='auth.password.change'?{currentPassword:password}:{})}});
  const credential=async(target:Actor)=>(await db.pool.query('SELECT password_hash,credential_version FROM identity.users WHERE id=$1',[target.userId])).rows[0];
  const denied=(response:{statusCode:number;body:string;json():any},status:number,code:string)=>{assert.equal(response.statusCode,status,response.body);assert.equal(response.json().error.code,code,response.body);};
  test('credential fencing and recovery preserve authority, original IDs and secret privacy',{timeout:180_000},async t=>{
    t.after(()=>db.pool.end());
    await t.test('dropped-before-arrival request is fenced durably; late and old-browser originals cannot change it',async t=>{
      const {app,owner,target}=await fixture(t),input=metadata(target),before=await credential(target);
      const response=await reconcile(app,owner,input);
      assert.equal(response.statusCode,200,response.body);assert.equal(response.json().response.code,'CREDENTIAL_OPERATION_FENCED');
      assert.deepEqual((await reconcile(app,owner,input)).json(),response.json(),'repeated reconciliation is canonical');
      const late=await original(app,owner,input);
      assert.equal(late.json().code,'CREDENTIAL_OPERATION_FENCED',late.body);assert.deepEqual(await credential(target),before);
      const oldClient=await app.inject({url:`/api/v1/commands/${input.commandId}`,headers:owner.headers});
      assert.equal(oldClient.json().status,'REJECTED');assert.equal(oldClient.json().response.code,'CREDENTIAL_OPERATION_FENCED');
      denied(await reconcile(app,owner,{...input,expectedCredentialVersion:2}),409,'IDEMPOTENCY_MISMATCH');
      const stored=await db.pool.query('SELECT encode(request_hash,\'hex\') hash,response FROM system.commands WHERE tenant_id=$1 AND command_id=$2',[owner.tenantId,input.commandId]);
      assert.equal(stored.rows[0].hash,'','a fence stores no secret-derived fingerprint');
      assert.equal((await db.pool.query("SELECT count(*)::int n FROM system.audit_events WHERE tenant_id=$1 AND command_id=$2 AND event_type='credential.operation.fenced'",[owner.tenantId,input.commandId])).rows[0].n,1);
    });
    await t.test('commit with a lost response returns the original result, including commands from before the metadata migration',async t=>{
      const {app,owner,target}=await fixture(t),input=metadata(target),secret=`Lost-response-${randomUUID()}`;
      const accepted=await original(app,owner,input,secret);assert.equal(accepted.json().status,'CONFIRMED',accepted.body);
      const recovered=await reconcile(app,owner,input);assert.deepEqual({...recovered.json().response,commandId:input.commandId},accepted.json());
      await db.pool.query('DELETE FROM system.credential_operations WHERE tenant_id=$1 AND command_id=$2',[owner.tenantId,input.commandId]);
      assert.deepEqual((await reconcile(app,owner,input)).json(),recovered.json(),'pre-upgrade commands recover through persisted actor/outlet/type');
      assert.deepEqual((await original(app,owner,input,secret)).json(),accepted.json());
      assert.equal(Number((await credential(target)).credential_version),2);
      const evidence=(await db.pool.query(`SELECT jsonb_build_object('command',to_jsonb(c)-'request_hash','audit',(SELECT jsonb_agg(a) FROM system.audit_events a WHERE a.tenant_id=c.tenant_id AND a.command_id=c.command_id),'outbox',(SELECT jsonb_agg(o) FROM system.transactional_outbox o WHERE o.tenant_id=c.tenant_id AND o.command_id=c.command_id)) evidence FROM system.commands c WHERE c.tenant_id=$1 AND c.command_id=$2`,[owner.tenantId,input.commandId])).rows;
      assert.ok(!JSON.stringify(evidence).includes(secret));assert.doesNotMatch(JSON.stringify(evidence),/newPassword|currentPassword|password_hash/);
    });
    await t.test('simultaneous arrival and reconciliation have one terminal result and at most one credential change',async t=>{
      const {app,owner,target}=await fixture(t);
      for(let i=0;i<3;i++){
        const input={...metadata(target),expectedCredentialVersion:Number((await credential(target)).credential_version)};
        const [arrival,recovery]=await Promise.all([original(app,owner,input),reconcile(app,owner,input)]);
        assert.equal(arrival.statusCode,200,arrival.body);assert.equal(recovery.statusCode,200,recovery.body);
        assert.deepEqual({...recovery.json().response,commandId:input.commandId},arrival.json());
        const delta=arrival.json().status==='CONFIRMED'?1:0;
        assert.equal(Number((await credential(target)).credential_version),input.expectedCredentialVersion+delta);
        assert.equal((await db.pool.query('SELECT count(*)::int n FROM system.audit_events WHERE tenant_id=$1 AND command_id=$2',[owner.tenantId,input.commandId])).rows[0].n,1);
      }
    });
    await t.test('another actor, outlet or tenant cannot recover an existing operation',async t=>{
      const {app,owner,target}=await fixture(t),input=metadata(target);await reconcile(app,owner,input);
      const colleague=await actor(app,owner),otherOutlet=await actor(app,await scope(owner.tenantId),'admin',owner),foreign=await actor(app,await scope());
      denied(await reconcile(app,colleague,input),404,'NOT_FOUND');denied(await reconcile(app,otherOutlet,input),404,'NOT_FOUND');denied(await reconcile(app,foreign,input),404,'NOT_FOUND');
      assert.equal((await db.pool.query('SELECT count(*)::int n FROM system.commands WHERE command_id=$1',[input.commandId])).rows[0].n,1);
    });
    await t.test('permission and assignment revocation between HTTP authentication and transaction cannot fence',async t=>{
      const {app,owner,target,race}=await fixture(t),input=metadata(target);
      race(()=>db.pool.query("UPDATE identity.memberships SET role='cashier' WHERE tenant_id=$1 AND user_id=$2",[owner.tenantId,owner.userId]));
      denied(await reconcile(app,owner,input,true),403,'FORBIDDEN');
      await db.pool.query("UPDATE identity.memberships SET role='admin' WHERE tenant_id=$1 AND user_id=$2",[owner.tenantId,owner.userId]);
      race(()=>db.pool.query('UPDATE identity.devices SET active=false WHERE id=$1',[owner.deviceId]));
      denied(await reconcile(app,owner,input,true),401,'UNAUTHENTICATED');
      assert.equal((await db.pool.query('SELECT count(*)::int n FROM system.commands WHERE tenant_id=$1 AND command_id=$2',[owner.tenantId,input.commandId])).rows[0].n,0);
    });
    await t.test('self change can be fenced or recovered after reauthentication without retaining its secret',async t=>{
      const {app,target}=await fixture(t),input=metadata(target,'auth.password.change');
      assert.equal((await reconcile(app,target,input)).json().response.code,'CREDENTIAL_OPERATION_FENCED');
      assert.equal((await original(app,target,input)).json().code,'CREDENTIAL_OPERATION_FENCED');
      const next=metadata(target,'auth.password.change'),secret=`New-self-${randomUUID()}`;
      const accepted=await original(app,target,next,secret);assert.equal(accepted.json().status,'CONFIRMED',accepted.body);
      denied(await reconcile(app,target,next),401,'UNAUTHENTICATED');
      const restored=await login(app,target,secret),recovered=await reconcile(app,restored,next);
      assert.deepEqual({...recovered.json().response,commandId:next.commandId},accepted.json());
    });
    await t.test('malformed and secret-bearing metadata is rejected before a command is retained',async t=>{
      const {app,owner,target}=await fixture(t),input=metadata(target);
      for(const invalid of [null,[],{...input,newPassword:'Not-allowed-secret'},{...input,commandId:'invalid-id'},{...input,expectedCredentialVersion:0},{...input,targetUserId:owner.userId,kind:'auth.password.change',actorId:owner.userId}]){
        const response=await app.inject({method:'POST',url:'/api/v1/auth/password/reconcile',headers:owner.headers,payload:invalid as any});
        assert.equal(response.statusCode,400,response.body);
      }
      assert.equal((await db.pool.query('SELECT count(*)::int n FROM system.commands WHERE tenant_id=$1 AND command_id=$2',[owner.tenantId,input.commandId])).rows[0].n,0);
    });
    await t.test('original password envelopes reject arrays, coercible IDs and unrelated version keys',async t=>{
      const {app,owner,target}=await fixture(t),commandId=randomUUID();
      const valid={protocolVersion:1,commandId,expectedVersions:{['credential:'+target.userId]:1},newPassword:`Malformed-only-${randomUUID()}`};
      for(const payload of [[],{...valid,commandId:[commandId]},{...valid,expectedVersions:[]},{...valid,expectedVersions:{...valid.expectedVersions,unrelated:1}},{...valid,unknownField:true}]){
        const response=await app.inject({method:'POST',url:`/api/v1/staff/${target.userId}/password`,headers:owner.headers,payload});
        denied(response,400,'VALIDATION_FAILED');
      }
      assert.equal(Number((await credential(target)).credential_version),1);
      assert.equal((await db.pool.query('SELECT count(*)::int n FROM system.commands WHERE tenant_id=$1 AND command_id=$2',[owner.tenantId,commandId])).rows[0].n,0);
    });
  });
}
