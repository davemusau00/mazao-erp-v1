import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { test, type TestContext } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { CommandEnvelope } from '../src/contracts.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  test('configuration images are staged separately, private, and retained by receipt references', { skip: 'Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database.' }, () => {});
} else {
  process.env.DATABASE_URL = databaseUrl;
  process.env.APP_ORIGINS ??= 'http://localhost:3000';
  const [{ buildApp }, security, db] = await Promise.all([
    import('../src/app.js'), import('../src/security.js'), import('../src/db.js'),
  ]);
  const origin = process.env.APP_ORIGINS.split(',')[0];
  const password = `Disposable-asset-${randomUUID()}`;
  const passwordHash = await security.hashPassword(password);
  let terminal = 0;

  function crc32(value: Buffer) {
    let crc = 0xffffffff;
    for (const byte of value) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function pngChunk(type: string, data: Buffer) {
    const typeBytes = Buffer.from(type, 'ascii'); const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0); typeBytes.copy(chunk, 4); data.copy(chunk, 8); chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
    return chunk;
  }
  function maximumPngDataUrl(marker=65) {
    const signature = Buffer.from([137,80,78,71,13,10,26,10]);
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1,0); ihdr.writeUInt32BE(1,4); ihdr[8]=8; ihdr[9]=6;
    const header = pngChunk('IHDR',ihdr); const data = pngChunk('IDAT',deflateSync(Buffer.from([0, 20, 40, 60, 255]))); const end = pngChunk('IEND',Buffer.alloc(0));
    const ancillaryDataLength = 512*1024 - signature.length - header.length - data.length - end.length - 12;
    const metadata = Buffer.concat([Buffer.from('Description\0','ascii'),Buffer.alloc(ancillaryDataLength-'Description\0'.length,marker)]);
    const content = Buffer.concat([signature,header,data,pngChunk('tEXt',metadata),end]);
    assert.equal(content.length,512*1024);
    return `data:image/png;base64,${content.toString('base64')}`;
  }
  async function createBusiness() {
    const tenantId=randomUUID();const outletId=randomUUID();const userId=randomUUID();const deviceId=randomUUID();const email=`asset-${userId}@example.invalid`;
    await db.pool.query('INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,$2,$3,$4)',[tenantId,'Disposable asset business','KES','Africa/Nairobi']);
    await db.pool.query('INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,$3,$4)',[outletId,tenantId,'Asset outlet','Africa/Nairobi']);
    await db.pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'commerce'),($1,'inventory'),($1,'retail')",[tenantId]);
    await db.pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)',[userId,email,passwordHash,'Asset Administrator']);
    await db.pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[tenantId,userId]);
    await db.pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Asset test device')",[deviceId,tenantId,outletId,userId]);
    return {tenantId,outletId,userId,deviceId,email};
  }
  async function login(app:FastifyInstance,actor:Awaited<ReturnType<typeof createBusiness>>) {
    const response=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:`198.51.100.${++terminal}`,headers:{origin},payload:{email:actor.email,password,deviceId:actor.deviceId}});
    assert.equal(response.statusCode,200,response.body);const cookies=response.headers['set-cookie'];
    const cookie=(Array.isArray(cookies)?cookies:[cookies]).filter((value):value is string=>typeof value==='string').map(value=>value.split(';',1)[0]).join('; ');
    return {cookie,origin,'x-csrf-token':response.json().csrfToken};
  }
  function command(actor:Awaited<ReturnType<typeof createBusiness>>,type:string,payload:Record<string,unknown>,expectedVersions:Record<string,number>={}):CommandEnvelope {
    return {protocolVersion:1,commandId:randomUUID(),tenantId:actor.tenantId,deviceId:actor.deviceId,type,occurredAt:new Date().toISOString(),expectedVersions,payload};
  }
  async function submit(app:FastifyInstance,headers:Record<string,string>,envelope:CommandEnvelope) {
    const response=await app.inject({method:'POST',url:'/api/v1/commands',headers,payload:envelope});assert.equal(response.statusCode,200,response.body);return response.json();
  }

  test('maximum PNGs use separate idempotent uploads, strict metadata reads, and immutable receipt asset references', { timeout: 180_000 }, async (t:TestContext) => {
    t.after(async()=>{await db.pool.end();});
    const actor=await createBusiness();const app=buildApp({logger:{level:'error'}});await app.ready();t.after(async()=>{await app.close();});
    const headers=await login(app,actor);const dataUrl=maximumPngDataUrl();
    const stage=async(kind:'logo'|'receipt_qr',draftId:string,value=dataUrl)=>app.inject({method:'POST',url:'/api/v1/configuration/assets',headers,payload:{kind,draftId,dataUrl:value}});
    const logoDraft=randomUUID();const qrDraft=randomUUID();
    const firstLogo=await stage('logo',logoDraft);assert.equal(firstLogo.statusCode,200,firstLogo.body);
    const replayLogo=await stage('logo',logoDraft);assert.deepEqual(replayLogo.json(),firstLogo.json(),'repeating the same draft and bytes is idempotent');
    assert.equal(firstLogo.json().asset.byteLength,512*1024);
    const changedDraft=await stage('logo',logoDraft,maximumPngDataUrl(66));
    assert.equal(changedDraft.statusCode,409,`a reused draft ID cannot silently change its bytes: ${changedDraft.body}`);
    const firstQr=await stage('receipt_qr',qrDraft);assert.equal(firstQr.statusCode,200,firstQr.body);
    const logoId=firstLogo.json().asset.id as string;const qrId=firstQr.json().asset.id as string;
    const initial=await app.inject({url:'/api/v1/configuration',headers});assert.equal(initial.statusCode,200,initial.body);
    assert.ok(initial.body.length<32*1024,'configuration metadata stays below 32 KiB before and after image activation');
    assert.doesNotMatch(initial.body,/data:image\/png;base64,/);

    const payload={name:'Disposable asset business',currency:'KES',timeZone:'Africa/Nairobi',legalName:'',registrationNumber:'',taxRegistrationNumber:'',address:'',phone:'',email:'',website:'',logoUrl:'',receiptQrImage:'',showQrOnReceipt:true,receiptHeader:'',receiptFooter:'',taxPolicy:{calculation:'exclusive',defaultRateBps:0,label:'Tax',reviewed:false},imageActions:{logo:{mode:'replace',assetId:logoId},receiptQr:{mode:'replace',assetId:qrId}}};
    const saved=await submit(app,headers,command(actor,'configuration.business.update',payload,{[`business:${actor.tenantId}`]:1}));assert.equal(saved.status,'CONFIRMED');
    const configuration=await app.inject({url:'/api/v1/configuration',headers});assert.equal(configuration.body.length<32*1024,true);
    const logoUrl=configuration.json().configuration.business.logoUrl as string;const qrUrl=configuration.json().configuration.business.receiptQrImage as string;
    assert.equal(logoUrl,`/api/v1/configuration/assets/${logoId}`);assert.equal(qrUrl,`/api/v1/configuration/assets/${qrId}`);
    for(const path of [logoUrl,qrUrl]){
      const image=await app.inject({url:path,headers});assert.equal(image.statusCode,200,image.body);
      assert.equal(image.headers['content-type'],'image/png');assert.equal(image.headers['cache-control'],'private, no-store');assert.equal(image.headers['x-content-type-options'],'nosniff');assert.equal(image.rawPayload.length,512*1024);
    }
    const evidence=await db.pool.query(`SELECT max(octet_length(payload::text))::int max_audit_bytes FROM system.audit_events WHERE tenant_id=$1`,[actor.tenantId]);
    assert.ok(evidence.rows[0].max_audit_bytes<10_000,'image bytes are not copied into business audit events');
    const replay=await submit(app,headers,command(actor,'configuration.business.update',payload,{[`business:${actor.tenantId}`]:2}));
    assert.equal(replay.status,'REJECTED','a new command cannot reuse consumed staged assets');
  });
}
