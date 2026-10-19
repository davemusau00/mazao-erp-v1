import Fastify, { type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { pool, inTransaction } from './db.js';
import type { ApiSession, CommandEnvelope } from './contracts.js';
import { DomainError } from './contracts.js';
import { executeCommand, hashCommand } from './commands.js';
import { hashToken, randomToken, safeEqual, verifyPassword } from './security.js';
import { ROLE_PERMISSIONS } from './contracts.js';
import { getJournalLines, getProfitLoss, getTrialBalance } from './financeReports.js';
import { getOperationalAnalytics } from './operationalAnalytics.js';
import { getItemReport, getItemReportCsv, getItemEvents } from './itemReports.js';
import { getJournalSource } from './journalSources.js';
import { getAccountingControls, listAccountingRecords } from './accounting.js';
import { getCustomerBalanceReport, getInventoryValueReport } from './controlReports.js';
import { getAccountCatalog } from './accountCatalog.js';
import { getSaleReceipt, getSaleReceiptAsset } from './receipts.js';
import { getCustomerStatement, listCustomerAccounts } from './customerAccounts.js';
import { listShiftCloseReports } from './shiftCloseReports.js';
import { getConfiguration, getConfigurationAsset, readTaxPolicy, stageConfigurationAsset } from './configuration.js';
import { getStockExceptionReport, getStockSalePolicy, getStockShortfallDetail, getStockShortfallEvidence, getStockShortfalls, getStockShortfallsCsv } from './stockShortfalls.js';
import { assertImportSourceSafe, getProductImport, listProductImports, productImportErrorsCsv } from './productImport.js';
import { changeCredential } from './credentials.js';
import type { CredentialInput } from './credentials.js';
import { listAssignments, listOperatorSessions, listStaff, STAFF_COMMANDS } from './staff.js';
import { revalidateOperator } from './identityAuthority.js';
import { readRuntimeConfig } from './runtimeConfig.js';
import { requireCommandRecoveryAuthority } from './commandAuthorization.js';
import { elapsedMs, milliseconds, requestMetricsStorage, type RequestMetrics } from './requestMetrics.js';

declare module 'fastify' { interface FastifyRequest { operator?: ApiSession; csrf?: string } }
const cookieName = 'maz_session';
const sessionHours = Number(process.env.SESSION_HOURS ?? 12);

export function buildApp(options: Pick<FastifyServerOptions, 'logger'> = {}) {
  const { production, allowedOrigins, trustedProxyIps } = readRuntimeConfig();
  const loggerOptions=options.logger&&typeof options.logger==='object'?options.logger:{};
  const app = Fastify({ logger: {...loggerOptions,redact:['req.body.payload.csv','req.body.csv']}, bodyLimit: 1_048_576,
    requestIdHeader: 'x-request-id',
    genReqId: request => {
      const candidate = request.headers['x-request-id'];
      return typeof candidate === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(candidate) ? candidate : randomUUID();
    },
    trustProxy: address => trustedProxyIps.includes(address.toLowerCase()) });
  app.register(cookie);
  app.register(rateLimit, { global: false });
  app.addHook('onRequest', (request, _reply, done) => {
    const metrics: RequestMetrics = {
      requestId: request.id,
      startedAt: performance.now(),
      poolWaitMs: 0,
      queryMs: 0,
      queryCount: 0,
    };
    requestMetricsStorage.run(metrics, done);
  });
  app.addHook('preHandler', async () => {
    const metrics = requestMetricsStorage.getStore();
    if (metrics && metrics.handlerStartedAt === undefined) metrics.handlerStartedAt = performance.now();
  });
  app.addHook('preSerialization', async (_request, _reply, payload) => {
    const metrics = requestMetricsStorage.getStore();
    if (metrics) {
      const now = performance.now();
      if (metrics.handlerStartedAt !== undefined) metrics.handlerMs = elapsedMs(metrics.handlerStartedAt, now);
      metrics.serializationStartedAt = now;
    }
    return payload;
  });
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    const metrics = requestMetricsStorage.getStore();
    if (metrics) {
      const now = performance.now();
      if (metrics.serializationStartedAt !== undefined) metrics.serializationMs = elapsedMs(metrics.serializationStartedAt, now);
      const length = Buffer.isBuffer(payload) || payload instanceof Uint8Array
        ? payload.byteLength
        : typeof payload === 'string' ? Buffer.byteLength(payload, 'utf8') : Number(reply.getHeader('content-length'));
      if (Number.isFinite(length) && length >= 0) metrics.responseBytes = length;
      reply.header('server-timing', [
        `app;dur=${milliseconds(elapsedMs(metrics.startedAt, now))}`,
        `handler;dur=${milliseconds(metrics.handlerMs)}`,
        `db;dur=${milliseconds(metrics.queryMs)}`,
        `dbpool;dur=${milliseconds(metrics.poolWaitMs)}`,
        `serialize;dur=${milliseconds(metrics.serializationMs)}`,
        `dbqueries;desc=${metrics.queryCount}`,
      ].join(', '));
    }
    return payload;
  });
  app.addHook('onResponse', async (request, reply) => {
    const metrics = requestMetricsStorage.getStore();
    if (metrics && process.env.MAZAO_REQUEST_METRICS_LOG === '1') {
      request.log.info({
        request_id: metrics.requestId,
        route: request.routeOptions.url ?? 'unmatched',
        method: request.method,
        status_code: reply.statusCode,
        duration_ms: Number(milliseconds(elapsedMs(metrics.startedAt))),
        response_bytes: metrics.responseBytes ?? null,
        db_pool_wait_ms: Number(milliseconds(metrics.poolWaitMs)),
        db_query_ms: Number(milliseconds(metrics.queryMs)),
        db_query_count: metrics.queryCount,
        handler_ms: Number(milliseconds(metrics.handlerMs)),
        serialization_ms: Number(milliseconds(metrics.serializationMs)),
      }, 'request performance');
    }
  });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff').header('referrer-policy', 'same-origin');
    if (reply.getHeader('cache-control') === undefined) reply.header('cache-control', 'no-store');
    return payload;
  });
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    const unsafe=['POST','PUT','PATCH','DELETE'].includes(request.method);
    const productionOriginMissing=production&&unsafe&&(!origin||!allowedOrigins.includes(origin));
    const configuredOriginDenied=unsafe&&!!origin&&allowedOrigins.length>0&&!allowedOrigins.includes(origin);
    if (productionOriginMissing||configuredOriginDenied) {
      return reply.code(403).send({ error: { code: 'ORIGIN_DENIED', message: 'Request origin is not allowed.' } });
    }
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) return reply.code(error.statusCode).send({ error:{code:error.code,message:error.message,details:error.details} });
    if ((error as { statusCode?: number }).statusCode === 429) return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Try again shortly.' } });
    if((error as {code?:string}).code==='FST_ERR_CTP_BODY_TOO_LARGE')return reply.code(413).send({error:{code:'PAYLOAD_TOO_LARGE',message:'The request exceeds the upload limit. CSV source must be 512 KiB or smaller.'}});
    request.log.error({ err: error }, 'request failed');
    if ((error as { validation?: unknown }).validation) return reply.code(400).send({ error: { code: 'VALIDATION_FAILED', message: 'Request fields are invalid.' } });
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' } });
  });

  app.get('/api/v1/health/live', async () => ({ status: 'live' }));
  app.get('/api/v1/health/ready', async (_request, reply) => {
    try { await pool.query('SELECT 1'); return { status: 'ready', database: 'available' }; }
    catch { return reply.code(503).send({ status: 'not_ready', database: 'unavailable' }); }
  });

  const registerLogin = () => app.post<{ Body: { email: string; password: string; deviceId?: string } }>('/api/v1/auth/login', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (request, reply) => {
    const email = request.body?.email?.trim().toLowerCase();
    const password = request.body?.password;
    if (!email || typeof password !== 'string') throw new DomainError('VALIDATION_FAILED', 'Email and password are required.');
    const identity=await pool.query('SELECT u.id,u.email,u.full_name,u.password_hash FROM identity.users u WHERE lower(u.email)=lower($1) AND u.active',[email]);
    const validPassword=await verifyPassword(password,identity.rows[0]?.password_hash??'');
    if(identity.rowCount!==1||!validPassword)throw new DomainError('UNAUTHENTICATED','Email or password is incorrect, or the account has no unique active device assignment.',401);
    const assignments=await pool.query(`SELECT u.id user_id,u.email,m.display_name operator_name,u.password_hash,m.tenant_id,m.role,t.name tenant_name,t.currency,t.time_zone,t.business_profile->'taxPolicy' AS tax_policy,o.time_zone outlet_time_zone,o.id outlet_id,o.name outlet_name,d.id device_id,d.label device_label,
      COALESCE((SELECT array_agg(capability ORDER BY capability) FROM core.tenant_capabilities c WHERE c.tenant_id=t.id),'{}') capabilities
      FROM identity.users u JOIN identity.memberships m ON m.user_id=u.id JOIN core.tenants t ON t.id=m.tenant_id
      JOIN identity.devices d ON d.tenant_id=m.tenant_id AND d.assigned_user_id=u.id AND d.active
      JOIN core.outlets o ON o.id=d.outlet_id AND o.tenant_id=d.tenant_id AND o.active
      WHERE u.id=$1 AND u.active AND m.active ORDER BY t.name,o.name,d.label,d.id`,[identity.rows[0].id]);
    if(!assignments.rowCount)throw new DomainError('UNAUTHENTICATED','Email or password is incorrect, or the account has no unique active device assignment.',401);
    const selectedDevice=request.body.deviceId;
    let row;
    if(selectedDevice!==undefined){
      row=assignments.rows.find(assignment=>assignment.device_id===selectedDevice);
      if(!row)throw new DomainError('UNAUTHENTICATED','Email or password is incorrect, or the account has no unique active device assignment.',401);
    }else if(assignments.rowCount>1){
      throw new DomainError('ASSIGNMENT_REQUIRED','Choose an authorized workspace assignment to continue.',409,{assignments:assignments.rows.map(({device_id,device_label,tenant_id,tenant_name,outlet_id,outlet_name})=>({deviceId:device_id,deviceLabel:device_label,tenantId:tenant_id,tenantName:tenant_name,outletId:outlet_id,outletName:outlet_name}))});
    }else row=assignments.rows[0];
    const sessionToken = randomToken(); const csrfToken = randomToken(24); const sessionId = randomUUID();
    await pool.query(`INSERT INTO identity.sessions(id,token_hash,csrf_hash,user_id,tenant_id,outlet_id,device_id,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,now()+($8::text||' hours')::interval)`, [sessionId,hashToken(sessionToken),hashToken(csrfToken),row.user_id,row.tenant_id,row.outlet_id,row.device_id,sessionHours]);
    const secure = production ? '; Secure' : '';
    reply.header('set-cookie', [`${cookieName}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionHours*3600}${secure}`, `maz_csrf=${csrfToken}; SameSite=Strict; Path=/; Max-Age=${sessionHours*3600}${secure}`]);
    return { user: { id:row.user_id,name:row.operator_name,email:row.email,role:row.role,permissions:ROLE_PERMISSIONS[row.role as keyof typeof ROLE_PERMISSIONS] }, tenant: { id:row.tenant_id,name:row.tenant_name,currency:row.currency,timeZone:row.time_zone,taxPolicy:readTaxPolicy(row.tax_policy),capabilities:row.capabilities }, outlet: { id:row.outlet_id,name:row.outlet_name,timeZone:row.outlet_time_zone }, deviceId:row.device_id, csrfToken };
  });
  // The plugin installs an onRoute hook during boot. Defer route registration
  // until then, while keeping buildApp's synchronous public interface.
  app.after(error => {
    if (error) throw error;
    registerLogin();
  });

  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/api/v1/') || ['/api/v1/auth/login','/api/v1/health/live','/api/v1/health/ready'].includes(request.url)) return;
    const token = request.cookies?.[cookieName];
    if (!token) return reply.code(401).send({ error:{ code:'UNAUTHENTICATED',message:'Sign in to continue.' } });
    const result = await pool.query(`SELECT s.id session_id,s.user_id,m.display_name operator_name,u.email,s.tenant_id,t.name tenant_name,t.currency,t.time_zone tenant_time_zone,t.business_profile->'taxPolicy' AS tax_policy,o.id outlet_id,o.name outlet_name,o.time_zone,s.device_id,m.role,s.expires_at,s.csrf_hash,
      COALESCE((SELECT array_agg(capability ORDER BY capability) FROM core.tenant_capabilities c WHERE c.tenant_id=t.id),'{}') capabilities
      FROM identity.sessions s JOIN identity.users u ON u.id=s.user_id JOIN identity.memberships m ON m.tenant_id=s.tenant_id AND m.user_id=s.user_id
      JOIN core.tenants t ON t.id=s.tenant_id JOIN core.outlets o ON o.id=s.outlet_id AND o.tenant_id=s.tenant_id
      JOIN identity.devices d ON d.id=s.device_id AND d.tenant_id=s.tenant_id AND d.outlet_id=s.outlet_id
      WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.active AND m.active AND d.active AND o.active AND d.assigned_user_id=s.user_id`, [hashToken(token)]);
    if (!result.rowCount) return reply.code(401).send({ error:{ code:'UNAUTHENTICATED',message:'Session is expired or access was revoked.' } });
    const r = result.rows[0];
    request.operator = { sessionId:r.session_id,userId:r.user_id,fullName:r.operator_name,email:r.email,tenantId:r.tenant_id,tenantName:r.tenant_name,currency:r.currency,outletId:r.outlet_id,outletName:r.outlet_name,tenantTimeZone:r.tenant_time_zone,taxPolicy:readTaxPolicy(r.tax_policy),timeZone:r.time_zone,deviceId:r.device_id,role:r.role,capabilities:r.capabilities,expiresAt:r.expires_at };
    request.csrf = Buffer.from(r.csrf_hash).toString('base64url');
    if (['POST','PUT','PATCH','DELETE'].includes(request.method)) {
      const csrfCookie = request.cookies?.maz_csrf; const csrfHeader = request.headers['x-csrf-token'];
      if (!csrfCookie || typeof csrfHeader !== 'string' || !safeEqual(csrfCookie,csrfHeader) || !safeEqual(hashToken(csrfHeader).toString('base64url'),Buffer.from(r.csrf_hash).toString('base64url'))) return reply.code(403).send({ error:{ code:'CSRF_FAILED',message:'Refresh the session before submitting this action.' } });
    }
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const token = request.cookies?.[cookieName]; if (token) await pool.query('UPDATE identity.sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL',[hashToken(token)]);
    reply.header('set-cookie',[`${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`, 'maz_csrf=; SameSite=Strict; Path=/; Max-Age=0']); return { status:'signed_out' };
  });
  app.get('/api/v1/auth/me', async request => ({ user:{ id:request.operator!.userId,name:request.operator!.fullName,email:request.operator!.email,role:request.operator!.role,permissions:ROLE_PERMISSIONS[request.operator!.role] }, tenant:{ id:request.operator!.tenantId,name:request.operator!.tenantName,currency:request.operator!.currency,timeZone:request.operator!.tenantTimeZone ?? request.operator!.timeZone,taxPolicy:request.operator!.taxPolicy,capabilities:request.operator!.capabilities },outlet:{ id:request.operator!.outletId,name:request.operator!.outletName,timeZone:request.operator!.timeZone },deviceId:request.operator!.deviceId,csrfToken:request.cookies?.maz_csrf ?? '' }));
  app.get('/api/v1/staff',async request=>listStaff(request.operator!));
  app.get('/api/v1/devices',async request=>listAssignments(request.operator!));
  app.get('/api/v1/auth/sessions',async request=>listOperatorSessions(request.operator!));
  app.get<{Params:{userId:string}}>('/api/v1/staff/:userId/sessions',async request=>listOperatorSessions(request.operator!,request.params.userId));
  app.post<{Body:CredentialInput;Params:{userId:string}}>('/api/v1/staff/:userId/password',async request=>changeCredential(request.operator!,request.body,request.params.userId));
  app.post<{Body:CredentialInput}>('/api/v1/auth/password',async request=>changeCredential(request.operator!,request.body));
  app.get('/api/v1/configuration', async request => getConfiguration(request.operator!));
  app.get('/api/v1/configuration/stock-sale-policy', async request => {requireEnabledCapability(request.operator!,'inventory');return getStockSalePolicy(request.operator!);});
  app.get<{ Params:{ assetId:string } }>('/api/v1/configuration/assets/:assetId', async (request, reply) => {
    const image = await getConfigurationAsset(request.operator!, request.params.assetId);
    if (!image) throw new DomainError('NOT_FOUND', 'Configuration image was not found.', 404);
    return reply.type('image/png').header('cache-control','private, no-store').header('x-content-type-options','nosniff').send(image);
  });
  app.get<{ Params:{ kind:string } }>('/api/v1/configuration/assets/legacy/:kind', async (request, reply) => {
    if (request.params.kind !== 'logo' && request.params.kind !== 'receipt_qr') throw new DomainError('NOT_FOUND', 'Configuration image was not found.', 404);
    const image = await getConfigurationAsset(request.operator!, undefined, request.params.kind);
    if (!image) throw new DomainError('NOT_FOUND', 'Configuration image was not found.', 404);
    return reply.type('image/png').header('cache-control','private, no-store').header('x-content-type-options','nosniff').send(image);
  });
  app.post<{ Body:unknown }>('/api/v1/configuration/assets', async request => inTransaction(client => stageConfigurationAsset(client,request.operator!,request.body)));
  app.get('/api/v1/catalog/imports',async request=>listProductImports(request.operator!));
  app.get<{Params:{batchId:string}}>('/api/v1/catalog/imports/:batchId',async request=>getProductImport(request.operator!,request.params.batchId));
  app.get<{Params:{batchId:string}}>('/api/v1/catalog/imports/:batchId/errors.csv',async (request,reply)=>{
    const csv=await productImportErrorsCsv(request.operator!,request.params.batchId);
    reply.header('content-type','text/csv; charset=utf-8').header('content-disposition','attachment; filename="product-import-errors.csv"');
    return csv;
  });
  const requireEnabledCapability = (operator: ApiSession, capability: string) => {
    if (!operator.capabilities.includes(capability)) throw new DomainError('CAPABILITY_DISABLED', `The ${capability} capability is not enabled for this tenant.`, 403);
  };
  app.get('/api/v1/catalog/items', async request => {
    const operator=request.operator!;
    requireEnabledCapability(operator, 'inventory');
    const permissions=ROLE_PERMISSIONS[operator.role];
    if (!permissions.some(permission=>['commerce.sell','catalog.manage','inventory.receive','inventory.count'].includes(permission))) throw new DomainError('FORBIDDEN','Your role cannot view the item catalog.',403);
    const canReadCost=permissions.includes('catalog.manage')||permissions.includes('finance.view');
    const result=await pool.query(`SELECT p.id,p.sku,p.name,p.base_unit,p.currency,p.selling_price_minor,p.category,p.barcode,p.reorder_level::text,p.version product_version,CASE WHEN $3::boolean THEN p.cost_price_minor END cost_price_minor,CASE WHEN $3::boolean THEN b.inventory_value_minor::text END inventory_value_minor,p.tax_rate_bps,b.quantity,b.version
      FROM catalog.products p JOIN inventory.balances b ON b.tenant_id=p.tenant_id AND b.outlet_id=p.outlet_id AND b.product_id=p.id
      WHERE p.tenant_id=$1 AND p.outlet_id=$2 AND p.active ORDER BY p.name`,[operator.tenantId,operator.outletId,canReadCost]);
    return { items:result.rows.map(r=>({id:r.id,sku:r.sku,name:r.name,unit:r.base_unit,currency:r.currency,sellingPriceMinor:Number(r.selling_price_minor),category:r.category,barcode:r.barcode,reorderLevel:r.reorder_level,productVersion:Number(r.product_version),...(canReadCost?{costPriceMinor:Number(r.cost_price_minor),inventoryValueMinor:String(r.inventory_value_minor)}:{}),taxRateBps:r.tax_rate_bps,quantity:String(r.quantity),version:Number(r.version)})) };
  });
  app.get('/api/v1/inventory/movements', async request => {
    const operator=request.operator!;
    requireEnabledCapability(operator, 'inventory');
    const permissions=ROLE_PERMISSIONS[operator.role];
    if(!permissions.includes('inventory.receive')) throw new DomainError('FORBIDDEN','Your role cannot review stock movements.',403);
    const canReadCost=permissions.includes('catalog.manage')||permissions.includes('finance.view');
    const result=await pool.query(`SELECT m.id,m.created_at,m.movement_type,m.quantity_delta,m.document_reference,CASE WHEN $3::boolean THEN m.value_minor::text END value_minor,p.sku,p.name,
        SUM(m.quantity_delta) OVER(PARTITION BY m.product_id ORDER BY m.created_at,m.id ROWS UNBOUNDED PRECEDING) balance_after
      FROM inventory.movements m JOIN catalog.products p ON p.id=m.product_id AND p.tenant_id=m.tenant_id AND p.outlet_id=m.outlet_id
      WHERE m.tenant_id=$1 AND m.outlet_id=$2 ORDER BY m.created_at DESC,m.id DESC LIMIT 250`,[operator.tenantId,operator.outletId,canReadCost]);
    return {movements:result.rows.map(r=>({id:r.id,timestamp:r.created_at,sku:r.sku,productName:r.name,type:r.movement_type==='SALE'?'sale':r.movement_type==='RECEIPT'?'restock':r.movement_type==='REFUND'?'restock':'adjustment',quantity:String(r.quantity_delta),balanceAfter:String(r.balance_after),note:r.document_reference??r.movement_type,reference:r.document_reference,...(canReadCost?{valueMinor:String(r.value_minor)}:{})}))};
  });
  app.get<{Querystring:{from?:string;to?:string;status?:string;productId?:string;operatorId?:string;outletId?:string;reasonCode?:string;limit?:string;after?:string}}>(
    '/api/v1/inventory/shortfalls', async request => {requireEnabledCapability(request.operator!,'inventory');return getStockShortfalls(request.operator!, request.query);});
  app.get<{Params:{shortfallId:string}}>('/api/v1/inventory/shortfalls/:shortfallId', async request => {requireEnabledCapability(request.operator!,'inventory');return getStockShortfallDetail(request.operator!, request.params.shortfallId);});
  app.get<{Params:{shortfallId:string}}>('/api/v1/inventory/shortfalls/:shortfallId/evidence', async request => {requireEnabledCapability(request.operator!,'inventory');return getStockShortfallEvidence(request.operator!, request.params.shortfallId);});
  const requireInventoryCountAccess = (operator: ApiSession) => {
    requireEnabledCapability(operator, 'inventory');
    if (!ROLE_PERMISSIONS[operator.role].some(permission => permission === 'inventory.count' || permission === 'inventory.count.approve')) {
      throw new DomainError('FORBIDDEN', 'Your role cannot access stock counts.', 403);
    }
  };
  const readInventoryCount = async (operator: ApiSession, countId: string) => {
    const count = await pool.query(`SELECT c.id,c.status,c.area_label,c.version,c.baseline_at,c.opened_at,c.posted_at,
        opened.full_name opened_by_name,posted.full_name posted_by_name,
        (SELECT count(*)::int FROM inventory.stock_count_lines l WHERE l.tenant_id=c.tenant_id AND l.outlet_id=c.outlet_id AND l.count_id=c.id) line_count,
        (SELECT count(*)::int FROM inventory.stock_count_lines l WHERE l.tenant_id=c.tenant_id AND l.outlet_id=c.outlet_id AND l.count_id=c.id AND l.counted_quantity IS NOT NULL) counted_line_count
      FROM inventory.stock_counts c JOIN identity.users opened ON opened.id=c.opened_by
      LEFT JOIN identity.users posted ON posted.id=c.posted_by
      WHERE c.id=$1 AND c.tenant_id=$2 AND c.outlet_id=$3`, [countId, operator.tenantId, operator.outletId]);
    if (!count.rowCount) return null;
    const lineResult = await pool.query(`SELECT product_id,sku_snapshot,name_snapshot,base_unit_snapshot,baseline_quantity::text baseline_quantity,
        baseline_balance_version::text baseline_balance_version,counted_quantity::text counted_quantity,variance_reason,counted_by,counted_at
      FROM inventory.stock_count_lines WHERE tenant_id=$1 AND outlet_id=$2 AND count_id=$3 ORDER BY sku_snapshot,product_id`, [operator.tenantId, operator.outletId, countId]);
    const c = count.rows[0];
    return { id:c.id,status:c.status,areaLabel:c.area_label,version:Number(c.version),baselineAt:c.baseline_at,openedAt:c.opened_at,openedBy:c.opened_by_name,
      postedAt:c.posted_at,postedBy:c.posted_by_name,lineCount:c.line_count,countedLineCount:c.counted_line_count,
      lines:lineResult.rows.map(line=>({productId:line.product_id,sku:line.sku_snapshot,name:line.name_snapshot,unit:line.base_unit_snapshot,
        expectedQuantity:String(line.baseline_quantity),expectedBalanceVersion:Number(line.baseline_balance_version),countedQuantity:line.counted_quantity===null?null:String(line.counted_quantity),
        varianceReason:line.variance_reason,countedBy:line.counted_by,countedAt:line.counted_at}))};
  };
  app.get('/api/v1/inventory/counts', async request => {
    const operator=request.operator!; requireInventoryCountAccess(operator);
    const result=await pool.query(`SELECT c.id,c.status,c.area_label,c.version,c.opened_at,c.posted_at,opened.full_name opened_by_name,posted.full_name posted_by_name,
        (SELECT count(*)::int FROM inventory.stock_count_lines l WHERE l.tenant_id=c.tenant_id AND l.outlet_id=c.outlet_id AND l.count_id=c.id) line_count,
        (SELECT count(*)::int FROM inventory.stock_count_lines l WHERE l.tenant_id=c.tenant_id AND l.outlet_id=c.outlet_id AND l.count_id=c.id AND l.counted_quantity IS NOT NULL) counted_line_count
      FROM inventory.stock_counts c JOIN identity.users opened ON opened.id=c.opened_by LEFT JOIN identity.users posted ON posted.id=c.posted_by
      WHERE c.tenant_id=$1 AND c.outlet_id=$2 ORDER BY c.opened_at DESC,c.id DESC LIMIT 50`,[operator.tenantId,operator.outletId]);
    return {counts:result.rows.map(row=>({id:row.id,status:row.status,areaLabel:row.area_label,version:Number(row.version),openedAt:row.opened_at,openedBy:row.opened_by_name,postedAt:row.posted_at,postedBy:row.posted_by_name,lineCount:row.line_count,countedLineCount:row.counted_line_count}))};
  });
  app.get('/api/v1/inventory/counts/current', async request => {
    const operator=request.operator!; requireInventoryCountAccess(operator);
    const current=await pool.query<{id:string}>('SELECT id FROM inventory.stock_counts WHERE tenant_id=$1 AND outlet_id=$2 AND status=\'OPEN\' ORDER BY opened_at DESC LIMIT 1',[operator.tenantId,operator.outletId]);
    return {count:current.rowCount?await readInventoryCount(operator,current.rows[0].id):null};
  });
  app.get<{Params:{countId:string}}>('/api/v1/inventory/counts/:countId', async request => {
    const operator=request.operator!; requireInventoryCountAccess(operator);
    const count=await readInventoryCount(operator,request.params.countId);
    if(!count)throw new DomainError('NOT_FOUND','Stock count was not found.',404);
    return {count};
  });
  app.get('/api/v1/shifts/current', async request => {
    const s=request.operator!;
    requireEnabledCapability(s, 'commerce');
    if (!ROLE_PERMISSIONS[s.role].some(permission=>permission==='shift.open'||permission==='shift.close'||permission==='shift.payout')) throw new DomainError('FORBIDDEN','Your role cannot view till shifts.',403);
    const result=await pool.query(`SELECT id,status,opening_float_minor,cash_sales_minor,customer_collections_minor,cash_refunds_minor,mpesa_sales_minor,expected_cash_minor,version,opened_at,
        COALESCE((SELECT sum(amount_minor) FROM commerce.shift_cash_movements m WHERE m.tenant_id=shifts.tenant_id AND m.outlet_id=shifts.outlet_id AND m.shift_id=shifts.id AND m.movement_type='PAID_IN'),0)::text cash_paid_in_minor,
        COALESCE((SELECT sum(amount_minor) FROM commerce.shift_cash_movements m WHERE m.tenant_id=shifts.tenant_id AND m.outlet_id=shifts.outlet_id AND m.shift_id=shifts.id AND m.movement_type='PAYOUT'),0)::text cash_payout_minor
      FROM commerce.shifts WHERE tenant_id=$1 AND outlet_id=$2 AND operator_id=$3 AND status='OPEN'`,[s.tenantId,s.outletId,s.userId]);
    const r=result.rows[0];
    if(!r)return {shift:null};
    const movements=await pool.query(`SELECT m.id,m.movement_type,m.amount_minor,m.reason,m.reference,m.created_at,u.full_name actor_name
      FROM commerce.shift_cash_movements m JOIN identity.users u ON u.id=m.actor_id
      WHERE m.tenant_id=$1 AND m.outlet_id=$2 AND m.shift_id=$3 ORDER BY m.created_at DESC,m.id DESC LIMIT 100`,[s.tenantId,s.outletId,r.id]);
    return { shift:{id:r.id,status:r.status,openingFloatMinor:Number(r.opening_float_minor),cashSalesMinor:Number(r.cash_sales_minor),mpesaSalesMinor:Number(r.mpesa_sales_minor),customerCollectionsMinor:Number(r.customer_collections_minor),cashRefundsMinor:Number(r.cash_refunds_minor),cashPaidInMinor:Number(r.cash_paid_in_minor),cashPayoutMinor:Number(r.cash_payout_minor),expectedCashMinor:Number(r.expected_cash_minor),version:Number(r.version),openedAt:r.opened_at,cashMovements:movements.rows.map(m=>({id:m.id,movementType:m.movement_type,amountMinor:Number(m.amount_minor),reason:m.reason,reference:m.reference,actorName:m.actor_name,createdAt:m.created_at}))} };
  });
  app.get('/api/v1/shifts/close-reports', async request => listShiftCloseReports(request.operator!));
  app.get<{Querystring:{after?:string;asOf?:string;limit?:string;q?:string}}>('/api/v1/sales/orders', async request => {
    const operator=request.operator!;
    const permissions=ROLE_PERMISSIONS[operator.role];
    if(!permissions.some(permission=>permission==='commerce.sell'||permission==='commerce.refund'||permission==='finance.view')) throw new DomainError('FORBIDDEN','Your role cannot review sales.',403);
    const canReadCost=permissions.includes('finance.view');
    const limit=request.query.limit===undefined?250:Number(request.query.limit);
    if(!Number.isSafeInteger(limit)||limit<1||limit>250)throw new DomainError('VALIDATION_FAILED','Choose a page size between 1 and 250.');
    let afterTime:string|null=null,afterId:string|null=null;
    if(request.query.after){try{const value=JSON.parse(Buffer.from(request.query.after,'base64url').toString('utf8'));if(!Array.isArray(value)||value.length!==2||typeof value[0]!=='string'||!Number.isFinite(Date.parse(value[0]))||!/^\d{4}-\d\d-\d\dT/.test(value[0])||typeof value[1]!=='string'||!/^[0-9a-f-]{36}$/i.test(value[1]))throw new Error();[afterTime,afterId]=value;}catch{throw new DomainError('VALIDATION_FAILED','The next-page reference is invalid. Refresh the history.');}}
    const asOf=request.query.asOf??new Date().toISOString();
    if(!Number.isFinite(Date.parse(asOf))||Date.parse(asOf)>Date.now()+5_000)throw new DomainError('VALIDATION_FAILED','The history date is invalid.');
    const search=request.query.q?.trim()??'';if(search.length>128)throw new DomainError('VALIDATION_FAILED','Search text is too long.');
    const pattern=search?`%${search.replace(/[\\%_]/g,'\\$&')}%`:null;
    const result=await pool.query(`SELECT o.id,o.created_at,to_char(o.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_time,o.operator_id,o.operator_name_snapshot cashier_name,o.currency,o.subtotal_minor,o.tax_minor,o.total_minor,o.status,o.customer_account_id,o.customer_name_snapshot,o.customer_amount_due_minor,
        COALESCE((SELECT SUM(p.amount_minor) FROM commerce.payments p WHERE p.tenant_id=o.tenant_id AND p.outlet_id=o.outlet_id AND p.order_id=o.id),0)::text paid_minor,
        COALESCE((SELECT SUM(r.total_minor) FROM commerce.refunds r WHERE r.tenant_id=o.tenant_id AND r.outlet_id=o.outlet_id AND r.order_id=o.id),0)::text refunded_minor,
        COALESCE((SELECT SUM(ol.discount_minor) FROM commerce.order_lines ol WHERE ol.tenant_id=o.tenant_id AND ol.outlet_id=o.outlet_id AND ol.order_id=o.id),0)::text discount_minor,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('method',p.method,'amountMinor',p.amount_minor::text,'currency',p.currency,'status',p.status,'reference',p.reference,'confirmation',CASE WHEN p.method='MANUAL_MPESA' THEN 'CASHIER_CONFIRMED' ELSE 'CASH' END,'confirmedBy',p.confirmed_operator_name_snapshot,'confirmedAt',p.manually_confirmed_at) ORDER BY p.created_at,p.id) FROM commerce.payments p WHERE p.tenant_id=o.tenant_id AND p.outlet_id=o.outlet_id AND p.order_id=o.id),'[]'::jsonb) payments,
        COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('lineId',ol.id,'productId',ol.product_id,'sku',ol.sku_snapshot,'name',ol.name_snapshot,'quantity',ol.quantity::text,'unitPriceMinor',ol.unit_price_minor::text,'costPriceMinor',CASE WHEN $3::boolean THEN ol.cost_price_minor::text END,'cogsMinor',CASE WHEN $3::boolean THEN ol.cogs_minor::text END,'taxRateBps',ol.tax_rate_bps,'originalSubtotalMinor',(ol.line_subtotal_minor+ol.discount_minor)::text,'discountMinor',ol.discount_minor::text,'discountReason',ol.discount_reason,'subtotalMinor',ol.line_subtotal_minor::text,'taxMinor',ol.line_tax_minor::text,'refundedQuantity',COALESCE((SELECT SUM(rl.quantity) FROM commerce.refund_lines rl WHERE rl.tenant_id=ol.tenant_id AND rl.outlet_id=ol.outlet_id AND rl.order_line_id=ol.id),0)::text)) ORDER BY ol.id)
          FROM commerce.order_lines ol WHERE ol.tenant_id=o.tenant_id AND ol.outlet_id=o.outlet_id AND ol.order_id=o.id),'[]'::jsonb) lines
      FROM commerce.orders o
      WHERE o.tenant_id=$1 AND o.outlet_id=$2 AND o.created_at<=$6::timestamptz
        AND ($4::timestamptz IS NULL OR (o.created_at,o.id)<($4::timestamptz,$5::uuid))
        AND ($7::text IS NULL OR o.id::text ILIKE $7 OR o.receipt_number ILIKE $7 OR o.operator_name_snapshot ILIKE $7 OR o.customer_name_snapshot ILIKE $7)
      ORDER BY o.created_at DESC,o.id DESC LIMIT $8`,[operator.tenantId,operator.outletId,canReadCost,afterTime,afterId,asOf,pattern,limit+1]);
    const page=result.rows.slice(0,limit),last=page.at(-1);
    return {asOf,nextAfter:result.rows.length>limit&&last?Buffer.from(JSON.stringify([last.cursor_time,last.id])).toString('base64url'):null,orders:page.map(r=>({id:r.id,orderNumber:String(r.id).slice(0,8).toUpperCase(),timestamp:r.created_at,cashierName:r.cashier_name,currency:r.currency,originalSubtotalMinor:(BigInt(r.subtotal_minor)+BigInt(r.discount_minor)).toString(),discountMinor:r.discount_minor,subtotalMinor:Number(r.subtotal_minor),taxMinor:Number(r.tax_minor),totalMinor:Number(r.total_minor),paidMinor:Number(r.paid_minor),amountDueMinor:Number(r.customer_amount_due_minor),customerName:r.customer_name_snapshot,refundedMinor:Number(r.refunded_minor),status:r.status==='REFUNDED'?'refunded':r.status==='PARTIALLY_REFUNDED'?'partially_refunded':'completed',paymentMethod:r.customer_account_id?'customer_credit':r.payments.some((payment:{method:string})=>payment.method==='MANUAL_MPESA')?'manual_mpesa':'cash',payments:r.payments,lines:r.lines}))};
  });
  app.get<{ Params: { orderId: string } }>('/api/v1/sales/orders/:orderId/receipt', async request =>
    getSaleReceipt(request.operator!, request.params.orderId));
  app.get<{ Params: { orderId: string; kind: string } }>('/api/v1/sales/orders/:orderId/receipt/assets/:kind', async (request, reply) => {
    const image = await getSaleReceiptAsset(request.operator!, request.params.orderId, request.params.kind);
    if (!image) throw new DomainError('NOT_FOUND', 'Historical receipt image was not found for this outlet.', 404);
    return reply.type('image/png').header('cache-control', 'private, no-store').header('x-content-type-options', 'nosniff').send(image);
  });
  app.get('/api/v1/customers', async request => listCustomerAccounts(request.operator!));
  app.get<{ Params: { customerId: string } }>('/api/v1/customers/:customerId/statement', async request =>
    getCustomerStatement(request.operator!, request.params.customerId));
  app.get<{ Querystring: { asOf?: string } }>('/api/v1/reports/trial-balance', async request =>
    getTrialBalance(request.operator!, request.query.asOf));
  app.get<{ Querystring: { from?: string; to?: string } }>('/api/v1/reports/profit-loss', async request =>
    getProfitLoss(request.operator!, request.query.from, request.query.to));
  app.get<{ Querystring: { from?: string; to?: string } }>('/api/v1/reports/operational-analytics', async request =>
    getOperationalAnalytics(request.operator!, request.query.from, request.query.to));
  app.get<{Querystring:{from?:string;to?:string}}>('/api/v1/reports/stock-exceptions', async request => {requireEnabledCapability(request.operator!,'inventory');return getStockExceptionReport(request.operator!, request.query);});
  app.get<{Querystring:{from?:string;to?:string;status?:string;productId?:string;operatorId?:string;outletId?:string;reasonCode?:string;limit?:string}}>(
    '/api/v1/reports/stock-exceptions.csv', async (request, reply) => {requireEnabledCapability(request.operator!,'inventory');return reply.type('text/csv; charset=utf-8')
      .header('content-disposition','attachment; filename="stock-exceptions.csv"').send(await getStockShortfallsCsv(request.operator!, request.query));});
  app.get<{Querystring:{from?:string;to?:string;limit?:string;after?:string;asOf?:string}}>('/api/v1/reports/items',async request=>getItemReport(request.operator!,request.query));
  app.get<{Querystring:{productId?:string;from?:string;to?:string;limit?:string;after?:string;asOf?:string}}>('/api/v1/reports/item-events',async request=>getItemEvents(request.operator!,request.query));
  app.get<{Querystring:{from?:string;to?:string;limit?:string;after?:string;asOf?:string}}>('/api/v1/reports/items.csv',async(request,reply)=>reply.type('text/csv; charset=utf-8').header('content-disposition','attachment; filename="item-performance.csv"').send(await getItemReportCsv(request.operator!,request.query)));
  app.get<{Params:{journalEntryId:string}}>('/api/v1/reports/journal-source/:journalEntryId',async request=>getJournalSource(request.operator!,request.params.journalEntryId));
  app.get('/api/v1/finance/controls',async request=>getAccountingControls(request.operator!));
  app.get('/api/v1/reports/account-catalog',async request=>getAccountCatalog(request.operator!));
  app.get<{Querystring:{asOf?:string;limit?:string;after?:string}}>('/api/v1/reports/customer-balances',async request=>getCustomerBalanceReport(request.operator!,request.query));
  app.get<{Querystring:{limit?:string;after?:string;revision?:string}}>('/api/v1/reports/inventory-value',async request=>getInventoryValueReport(request.operator!,request.query));
  app.get<{Params:{kind:string};Querystring:{limit?:string;after?:string;reference?:string}}>('/api/v1/finance/records/:kind',async request=>listAccountingRecords(request.operator!,request.params.kind,request.query));
  app.get<{ Querystring: { accountCode?: string; from?: string; to?: string; asOf?: string; limit?: string; offset?: string } }>('/api/v1/reports/journal-lines', async request =>
    getJournalLines(request.operator!, {
      accountCode: request.query.accountCode,
      from: request.query.from,
      to: request.query.to,
      asOf: request.query.asOf,
      limit: request.query.limit,
      offset: request.query.offset,
    }));
  app.get('/api/v1/hospitality/rooms', async request => {
    const operator=request.operator!;if(!operator.capabilities.includes('hospitality'))throw new DomainError('CAPABILITY_DISABLED','Hospitality is not enabled for this tenant.',403);
    if(!ROLE_PERMISSIONS[operator.role].some(permission=>permission==='hotel.frontdesk'||permission==='hotel.manage'||permission==='hotel.housekeeping'))throw new DomainError('FORBIDDEN','Your role cannot view rooms.',403);
    const result=await pool.query(`SELECT r.id,r.room_number,r.room_type,r.nightly_rate_minor,r.tax_rate_bps,r.currency,r.status,r.version,
      (SELECT jsonb_build_object('id',s.id,'guestName',s.guest_name,'checkInDate',s.check_in_date,'checkOutDate',s.expected_check_out_date,'version',s.version) FROM hospitality.stays s WHERE s.tenant_id=r.tenant_id AND s.outlet_id=r.outlet_id AND s.room_id=r.id AND s.status='CHECKED_IN' LIMIT 1) active_stay
      FROM hospitality.rooms r WHERE r.tenant_id=$1 AND r.outlet_id=$2 ORDER BY r.room_number`,[operator.tenantId,operator.outletId]);
    return {rooms:result.rows.map(r=>({id:r.id,roomNumber:r.room_number,roomType:r.room_type,nightlyRateMinor:Number(r.nightly_rate_minor),taxRateBps:r.tax_rate_bps,currency:r.currency,status:r.status,version:Number(r.version),activeStay:r.active_stay}))};
  });
  app.get('/api/v1/hospitality/reservations',async request=>{
    const operator=request.operator!;if(!operator.capabilities.includes('hospitality'))throw new DomainError('CAPABILITY_DISABLED','Hospitality is not enabled for this tenant.',403);
    if(!ROLE_PERMISSIONS[operator.role].some(permission=>permission==='hotel.frontdesk'||permission==='hotel.manage'))throw new DomainError('FORBIDDEN','Your role cannot view reservations.',403);
    const result=await pool.query(`SELECT b.id,b.room_id,r.room_number,b.guest_name,b.guest_contact,to_char(b.check_in_date,'YYYY-MM-DD') check_in_date,to_char(b.check_out_date,'YYYY-MM-DD') check_out_date,b.nightly_rate_minor,b.tax_rate_bps,b.currency,b.status,b.version
      FROM hospitality.reservations b JOIN hospitality.rooms r ON r.id=b.room_id AND r.tenant_id=b.tenant_id AND r.outlet_id=b.outlet_id
      WHERE b.tenant_id=$1 AND b.outlet_id=$2 AND b.status='CONFIRMED' ORDER BY b.check_in_date,b.room_id LIMIT 250`,[operator.tenantId,operator.outletId]);
    return {reservations:result.rows.map(r=>({id:r.id,roomId:r.room_id,roomNumber:r.room_number,guestName:r.guest_name,guestContact:r.guest_contact,checkInDate:r.check_in_date,checkOutDate:r.check_out_date,nightlyRateMinor:Number(r.nightly_rate_minor),taxRateBps:r.tax_rate_bps,currency:r.currency,status:r.status,version:Number(r.version)}))};
  });
  app.get('/api/v1/hospitality/stays',async request=>{
    const operator=request.operator!;if(!operator.capabilities.includes('hospitality'))throw new DomainError('CAPABILITY_DISABLED','Hospitality is not enabled for this tenant.',403);
    if(!ROLE_PERMISSIONS[operator.role].some(permission=>permission==='hotel.frontdesk'||permission==='hotel.manage'))throw new DomainError('FORBIDDEN','Your role cannot view guest stays.',403);
    const result=await pool.query(`SELECT s.id,s.room_id,r.room_number,r.version room_version,s.guest_name,s.guest_contact,to_char(s.check_in_date,'YYYY-MM-DD') check_in_date,to_char(s.expected_check_out_date,'YYYY-MM-DD') expected_check_out_date,s.checked_in_at,s.nightly_rate_minor,s.tax_rate_bps,s.currency,s.status,s.version,(s.expected_check_out_date-s.check_in_date)::int nights
      FROM hospitality.stays s JOIN hospitality.rooms r ON r.id=s.room_id AND r.tenant_id=s.tenant_id AND r.outlet_id=s.outlet_id WHERE s.tenant_id=$1 AND s.outlet_id=$2 AND s.status='CHECKED_IN' ORDER BY s.checked_in_at`,[operator.tenantId,operator.outletId]);
    return {stays:result.rows.map(r=>{const subtotal=BigInt(r.nightly_rate_minor)*BigInt(r.nights);const tax=(subtotal*BigInt(r.tax_rate_bps)+5000n)/10000n;if(subtotal+tax>BigInt(Number.MAX_SAFE_INTEGER))throw new DomainError('VALIDATION_FAILED','Stay estimate exceeds the supported money range.');return {id:r.id,roomId:r.room_id,roomNumber:r.room_number,roomVersion:Number(r.room_version),guestName:r.guest_name,guestContact:r.guest_contact,checkInDate:r.check_in_date,checkOutDate:r.expected_check_out_date,checkedInAt:r.checked_in_at,nightlyRateMinor:Number(r.nightly_rate_minor),taxRateBps:r.tax_rate_bps,currency:r.currency,status:r.status,version:Number(r.version),nights:r.nights,estimatedSubtotalMinor:Number(subtotal),estimatedTaxMinor:Number(tax),estimatedTotalMinor:Number(subtotal+tax)}})};
  });
  app.post<{ Body: CommandEnvelope }>('/api/v1/commands',{bodyLimit:2_097_152}, async (request, reply) => {
    const envelope=request.body; const s=request.operator!;
    if (!envelope || envelope.protocolVersion!==1 || !/^[0-9a-f-]{36}$/i.test(envelope.commandId ?? '') || typeof envelope.type!=='string' || typeof envelope.deviceId!=='string' || !Number.isFinite(Date.parse(envelope.occurredAt)) || !envelope.expectedVersions || typeof envelope.expectedVersions!=='object' || !envelope.payload || typeof envelope.payload!=='object') throw new DomainError('VALIDATION_FAILED','Command envelope is invalid.');
    if (envelope.tenantId && envelope.tenantId!==s.tenantId) throw new DomainError('FORBIDDEN','Command tenant differs from authenticated tenant.',403);
    if(envelope.deviceId!==s.deviceId)throw new DomainError('FORBIDDEN','Command device differs from the authenticated assignment.',403);
    assertImportSourceSafe(envelope);
    envelope.tenantId=s.tenantId;
    const digest=hashCommand(envelope); const hashText=digest.toString('hex');
    const outcome=await inTransaction(async client=>{
      const inserted=await client.query(`INSERT INTO system.commands(tenant_id,command_id,actor_id,device_id,command_type,request_hash,status)
        VALUES($1,$2,$3,$4,$5,$6,'EXECUTING') ON CONFLICT DO NOTHING RETURNING command_id`,[s.tenantId,envelope.commandId,s.userId,s.deviceId,envelope.type,digest]);
      if (!inserted.rowCount) {
        const old=await client.query(`SELECT c.request_hash,c.status,c.response,c.actor_id,c.command_type,d.outlet_id
          FROM system.commands c JOIN identity.devices d ON d.tenant_id=c.tenant_id AND d.id=c.device_id
          WHERE c.tenant_id=$1 AND c.command_id=$2 FOR UPDATE OF c`,[s.tenantId,envelope.commandId]);
        if ((STAFF_COMMANDS as readonly string[]).includes(old.rows[0].command_type)) {
          await client.query('SELECT id FROM core.tenants WHERE id=$1 FOR UPDATE',[s.tenantId]);
        }
        const fresh=await revalidateOperator(client,s);
        try { requireCommandRecoveryAuthority(fresh,old.rows[0],'replay'); }
        catch(error) {
          // Preserve import's existing definite rejected-envelope contract.
          if(!(error instanceof DomainError)||!old.rows[0].command_type.startsWith('catalog.import.'))throw error;
          return {status:'REJECTED',code:error.code,message:error.message};
        }
        if (old.rows[0].request_hash.toString('hex')!==hashText) return {status:'REJECTED',message:'Command ID was already used with different content.',code:'IDEMPOTENCY_MISMATCH'};
        const stored=old.rows[0].response;
        if(stored&&typeof stored==='object'&&!Array.isArray(stored))return stored;
        return {status:old.rows[0].status};
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
        const status=['VERSION_CONFLICT','IMPORT_STALE','OPEN_COUNT_CONFLICT'].includes(error.code)?'CONFLICT':'REJECTED';
        const response={status,code:error.code,message:error.message,details:error.details};
        await client.query('UPDATE system.commands SET status=$3,response=$4::jsonb,completed_at=now() WHERE tenant_id=$1 AND command_id=$2',[s.tenantId,envelope.commandId,status,JSON.stringify(response)]);
        return response;
      }
    });
    return reply.code(200).send({commandId:envelope.commandId,...outcome});
  });
  app.get<{ Params:{ commandId:string } }>('/api/v1/commands/:commandId', async request => inTransaction(async client => {
    const operator=await revalidateOperator(client,request.operator!);
    const r=await client.query(`SELECT c.status,c.response,c.created_at,c.completed_at,c.command_type,c.actor_id,d.outlet_id
      FROM system.commands c JOIN identity.devices d ON d.id=c.device_id AND d.tenant_id=c.tenant_id
      WHERE c.tenant_id=$1 AND c.command_id=$2 FOR SHARE OF c,d`,[operator.tenantId,request.params.commandId]);
    if (!r.rowCount) throw new DomainError('NOT_FOUND','Command was not found.',404);
    requireCommandRecoveryAuthority(operator,r.rows[0],'status');
    const {command_type:_,actor_id:__,outlet_id:___,...status}=r.rows[0];
    return {commandId:request.params.commandId,...status};
  }));
  return app;
}
