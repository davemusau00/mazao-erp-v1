import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { pool, inTransaction } from './db.js';
import type { ApiSession, CommandEnvelope } from './contracts.js';
import { DomainError } from './contracts.js';
import { executeCommand, hashCommand } from './commands.js';
import { hashToken, randomToken, verifyPassword } from './security.js';

declare module 'fastify' { interface FastifyRequest { operator?: ApiSession; csrf?: string } }
const cookieName = 'maz_session';
const sessionHours = Number(process.env.SESSION_HOURS ?? 12);

export function buildApp() {
  const app = Fastify({ logger: true, bodyLimit: 1_048_576 });
  app.register(cookie);
  app.register(rateLimit, { global: false });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff').header('referrer-policy', 'same-origin').header('cache-control', 'no-store');
    return payload;
  });
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    const allowed = (process.env.APP_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (['POST','PUT','PATCH','DELETE'].includes(request.method) && origin && allowed.length && !allowed.includes(origin)) {
      return reply.code(403).send({ error: { code: 'ORIGIN_DENIED', message: 'Request origin is not allowed.' } });
    }
  });
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'request failed');
    if ((error as { validation?: unknown }).validation) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED', message: 'Request fields are invalid.' } });
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' } });
  });

  app.get('/api/v1/health/live', async () => ({ status: 'live' }));
  app.get('/api/v1/health/ready', async (_request, reply) => {
    try { await pool.query('SELECT 1'); return { status: 'ready', database: 'available' }; }
    catch { return reply.code(503).send({ status: 'not_ready', database: 'unavailable' }); }
  });

  app.post<{ Body: { email: string; password: string } }>('/api/v1/auth/login', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (request, reply) => {
    const email = request.body?.email?.trim().toLowerCase();
    const password = request.body?.password;
    if (!email || typeof password !== 'string') throw new DomainError('VALIDATION_FAILED', 'Email and password are required.');
    const result = await pool.query(`SELECT u.id user_id,u.email,u.full_name,u.password_hash,m.tenant_id,m.role,t.name tenant_name,t.currency,t.time_zone,o.id outlet_id,o.name outlet_name,d.id device_id
      FROM identity.users u JOIN identity.memberships m ON m.user_id=u.id JOIN core.tenants t ON t.id=m.tenant_id
      JOIN identity.devices d ON d.tenant_id=m.tenant_id AND d.assigned_user_id=u.id AND d.active
      JOIN core.outlets o ON o.id=d.outlet_id AND o.tenant_id=d.tenant_id AND o.active
      WHERE lower(u.email)=lower($1) AND u.active AND m.active ORDER BY d.created_at`, [email]);
    if (result.rowCount !== 1 || !(await verifyPassword(password, result.rows[0]?.password_hash ?? ''))) throw new DomainError('UNAUTHENTICATED', 'Email or password is incorrect, or the account has no unique active device assignment.', 401);
    const row = result.rows[0];
    const sessionToken = randomToken(); const csrfToken = randomToken(24); const sessionId = randomUUID();
    await pool.query(`INSERT INTO identity.sessions(id,token_hash,csrf_hash,user_id,tenant_id,outlet_id,device_id,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,now()+($8::text||' hours')::interval)`, [sessionId,hashToken(sessionToken),hashToken(csrfToken),row.user_id,row.tenant_id,row.outlet_id,row.device_id,sessionHours]);
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    reply.header('set-cookie', [`${cookieName}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionHours*3600}${secure}`, `maz_csrf=${csrfToken}; SameSite=Strict; Path=/; Max-Age=${sessionHours*3600}${secure}`]);
    return { user: { id:row.user_id,name:row.full_name,email:row.email,role:row.role }, tenant: { id:row.tenant_id,name:row.tenant_name,currency:row.currency,timeZone:row.time_zone }, outlet: { id:row.outlet_id,name:row.outlet_name }, deviceId:row.device_id, csrfToken };
  });

  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/api/v1/') || request.url === '/api/v1/auth/login') return;
    const token = request.cookies?.[cookieName];
    if (!token) return reply.code(401).send({ error:{ code:'UNAUTHENTICATED',message:'Sign in to continue.' } });
    const result = await pool.query(`SELECT s.id session_id,s.user_id,u.full_name,u.email,s.tenant_id,t.name tenant_name,t.currency,o.id outlet_id,o.name outlet_name,o.time_zone,s.device_id,m.role,s.expires_at,s.csrf_hash
      FROM identity.sessions s JOIN identity.users u ON u.id=s.user_id JOIN identity.memberships m ON m.tenant_id=s.tenant_id AND m.user_id=s.user_id
      JOIN core.tenants t ON t.id=s.tenant_id JOIN core.outlets o ON o.id=s.outlet_id AND o.tenant_id=s.tenant_id
      JOIN identity.devices d ON d.id=s.device_id AND d.tenant_id=s.tenant_id AND d.outlet_id=s.outlet_id
      WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.active AND m.active AND d.active`, [hashToken(token)]);
    if (!result.rowCount) return reply.code(401).send({ error:{ code:'UNAUTHENTICATED',message:'Session is expired or access was revoked.' } });
    const r = result.rows[0];
    request.operator = { sessionId:r.session_id,userId:r.user_id,fullName:r.full_name,email:r.email,tenantId:r.tenant_id,tenantName:r.tenant_name,currency:r.currency,outletId:r.outlet_id,outletName:r.outlet_name,timeZone:r.time_zone,deviceId:r.device_id,role:r.role,expiresAt:r.expires_at };
    request.csrf = Buffer.from(r.csrf_hash).toString('base64url');
    if (['POST','PUT','PATCH','DELETE'].includes(request.method)) {
      const csrfCookie = request.cookies?.maz_csrf; const csrfHeader = request.headers['x-csrf-token'];
      if (!csrfCookie || typeof csrfHeader !== 'string' || csrfCookie !== csrfHeader || !Buffer.from(hashToken(csrfHeader)).equals(Buffer.from(r.csrf_hash))) return reply.code(403).send({ error:{ code:'CSRF_FAILED',message:'Refresh the session before submitting this action.' } });
    }
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const token = request.cookies?.[cookieName]; if (token) await pool.query('UPDATE identity.sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL',[hashToken(token)]);
    reply.header('set-cookie',[`${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`, 'maz_csrf=; SameSite=Strict; Path=/; Max-Age=0']); return { status:'signed_out' };
  });
  app.get('/api/v1/auth/me', async request => ({ user:{ id:request.operator!.userId,name:request.operator!.fullName,email:request.operator!.email,role:request.operator!.role }, tenant:{ id:request.operator!.tenantId,name:request.operator!.tenantName,currency:request.operator!.currency,timeZone:request.operator!.timeZone },outlet:{ id:request.operator!.outletId,name:request.operator!.outletName },deviceId:request.operator!.deviceId,csrfToken:request.cookies?.maz_csrf ?? '' }));
  app.get('/api/v1/catalog/items', async request => {
    const operator=request.operator!;
    const result=await pool.query(`SELECT p.id,p.sku,p.name,p.base_unit,p.currency,p.selling_price_minor,p.cost_price_minor,p.tax_rate_bps,b.quantity,b.version
      FROM catalog.products p JOIN inventory.balances b USING(tenant_id,outlet_id,product_id)
      WHERE p.tenant_id=$1 AND p.outlet_id=$2 AND p.active ORDER BY p.name`,[operator.tenantId,operator.outletId]);
    return { items:result.rows.map(r=>({id:r.id,sku:r.sku,name:r.name,unit:r.base_unit,currency:r.currency,sellingPriceMinor:Number(r.selling_price_minor),costPriceMinor:Number(r.cost_price_minor),taxRateBps:r.tax_rate_bps,quantity:String(r.quantity),version:Number(r.version)})) };
  });
  app.get('/api/v1/shifts/current', async request => {
    const s=request.operator!;
    const result=await pool.query(`SELECT id,status,opening_float_minor,cash_sales_minor,expected_cash_minor,version,opened_at FROM commerce.shifts WHERE tenant_id=$1 AND outlet_id=$2 AND operator_id=$3 AND status='OPEN'`,[s.tenantId,s.outletId,s.userId]);
    const r=result.rows[0]; return { shift:r?{id:r.id,status:r.status,openingFloatMinor:Number(r.opening_float_minor),cashSalesMinor:Number(r.cash_sales_minor),expectedCashMinor:Number(r.expected_cash_minor),version:Number(r.version),openedAt:r.opened_at}:null };
  });
  app.post<{ Body: CommandEnvelope }>('/api/v1/commands', async (request, reply) => {
    const envelope=request.body; const s=request.operator!;
    if (!envelope || envelope.protocolVersion!==1 || !/^[0-9a-f-]{36}$/i.test(envelope.commandId ?? '') || typeof envelope.type!=='string' || typeof envelope.deviceId!=='string' || !Number.isFinite(Date.parse(envelope.occurredAt)) || !envelope.expectedVersions || typeof envelope.expectedVersions!=='object' || !envelope.payload || typeof envelope.payload!=='object') throw new DomainError('VALIDATION_FAILED','Command envelope is invalid.');
    if (envelope.tenantId && envelope.tenantId!==s.tenantId) throw new DomainError('FORBIDDEN','Command tenant differs from authenticated tenant.',403);
    envelope.tenantId=s.tenantId;
    const digest=hashCommand(envelope); const hashText=digest.toString('hex');
    const outcome=await inTransaction(async client=>{
      const inserted=await client.query(`INSERT INTO system.commands(tenant_id,command_id,actor_id,device_id,command_type,request_hash,status)
        VALUES($1,$2,$3,$4,$5,$6,'EXECUTING') ON CONFLICT DO NOTHING RETURNING command_id`,[s.tenantId,envelope.commandId,s.userId,s.deviceId,envelope.type,digest]);
      if (!inserted.rowCount) {
        const old=await client.query('SELECT request_hash,status,response FROM system.commands WHERE tenant_id=$1 AND command_id=$2 FOR UPDATE',[s.tenantId,envelope.commandId]);
        if (old.rows[0].request_hash.toString('hex')!==hashText) return {status:'REJECTED',message:'Command ID was already used with different content.',code:'IDEMPOTENCY_MISMATCH'};
        return {status:old.rows[0].status,response:old.rows[0].response};
      }
      await client.query('SAVEPOINT business_command');
      try {
        const value=await executeCommand(client,s,envelope);
        const response={status:'CONFIRMED',value};
        await client.query("UPDATE system.commands SET status='CONFIRMED',response=$3::jsonb,completed_at=now() WHERE tenant_id=$1 AND command_id=$2",[s.tenantId,envelope.commandId,JSON.stringify(response)]);
        return response;
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT business_command');
        if (!(error instanceof DomainError)) throw error;
        const status=error.code==='VERSION_CONFLICT'?'CONFLICT':'REJECTED';
        const response={status,code:error.code,message:error.message,details:error.details};
        await client.query('UPDATE system.commands SET status=$3,response=$4::jsonb,completed_at=now() WHERE tenant_id=$1 AND command_id=$2',[s.tenantId,envelope.commandId,status,JSON.stringify(response)]);
        return response;
      }
    });
    return reply.code(200).send({commandId:envelope.commandId,...outcome});
  });
  app.get<{ Params:{ commandId:string } }>('/api/v1/commands/:commandId', async (request,reply) => {
    const r=await pool.query('SELECT status,response,created_at,completed_at FROM system.commands WHERE tenant_id=$1 AND command_id=$2',[request.operator!.tenantId,request.params.commandId]);
    if (!r.rowCount) return reply.code(404).send({error:{code:'NOT_FOUND',message:'Command was not found.'}});
    return {commandId:request.params.commandId,...r.rows[0]};
  });
  return app;
}
