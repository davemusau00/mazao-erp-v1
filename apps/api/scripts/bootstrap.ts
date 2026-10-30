import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { pool, inTransaction } from '../src/db.js';
import { hashPassword } from '../src/security.js';
import { SUPPORTED_CAPABILITIES } from '../src/configuration.js';

if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== 'function') {
  throw new Error('Initial business setup must run in an interactive terminal so the owner password can be entered without echo.');
}
if (process.env.ADMIN_PASSWORD) throw new Error('Remove ADMIN_PASSWORD from the process environment and enter it at the hidden terminal prompt.');

const terminal = createInterface({ input: process.stdin, output: process.stdout });
const ask = (label: string, fallback = '') => terminal.question(`${label}${fallback ? ` [${fallback}]` : ''}: `).then(value => value.trim() || fallback);
async function secret(label: string): Promise<string> {
  process.stdout.write(`${label}: `);
  const input = process.stdin;
  const oldRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      input.removeListener('data', onData);
      input.setRawMode(oldRaw ?? false);
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') return finish(new Error('Bootstrap cancelled.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') value = Array.from(value).slice(0, -1).join('');
        else if (character >= ' ' && character !== '\u007f') value += character;
      }
    };
    input.on('data', onData);
  });
}
function validateTimeZone(value: string, label: string) {
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); }
  catch { throw new Error(`${label} must be a supported IANA time zone.`); }
}

const confirmation = await ask('Type CREATE_INITIAL_TENANT to continue');
if (confirmation !== 'CREATE_INITIAL_TENANT') throw new Error('Bootstrap was cancelled.');
const tenantName = await ask('Business name');
const currency = (await ask('Business currency (ISO 4217)', 'KES')).toUpperCase();
const tenantTimeZone = await ask('Business time zone', 'Africa/Nairobi');
const outletName = await ask('First outlet name', 'Main outlet');
const outletTimeZone = await ask('First outlet time zone', tenantTimeZone);
const ownerEmail = (await ask('Owner email')).toLowerCase();
const ownerName = await ask('Owner name');
const deviceLabel = await ask('Initial workspace label', 'Setup workspace');
const capabilitiesText = await ask('Capabilities (commerce, inventory, retail, hospitality)', 'commerce,inventory,retail');
terminal.close();

if (!tenantName || tenantName.length > 160) throw new Error('Business name must contain 1 to 160 characters.');
if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Business currency must be a three-letter uppercase ISO 4217 code.');
validateTimeZone(tenantTimeZone, 'Business time zone');
validateTimeZone(outletTimeZone, 'Outlet time zone');
if (!outletName || outletName.length > 160) throw new Error('Outlet name must contain 1 to 160 characters.');
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail) || ownerEmail.length > 254) throw new Error('Owner email is invalid.');
if (!ownerName || ownerName.length > 160) throw new Error('Owner name must contain 1 to 160 characters.');
if (!deviceLabel || deviceLabel.length > 120) throw new Error('Workspace label must contain 1 to 120 characters.');
const capabilities = [...new Set(capabilitiesText.split(',').map(value => value.trim()).filter(Boolean))];
if (!capabilities.length || capabilities.some(value => !(SUPPORTED_CAPABILITIES as readonly string[]).includes(value))) throw new Error(`Choose one or more supported capabilities: ${SUPPORTED_CAPABILITIES.join(', ')}.`);

let password = await secret('Owner password (12 to 256 characters)');
const passwordConfirmation = await secret('Confirm owner password');
if (password !== passwordConfirmation) throw new Error('Owner password confirmation does not match.');
if (password.length < 12 || password.length > 256) throw new Error('Owner password must contain 12 to 256 characters.');
const passwordHash = await hashPassword(password);
password = '';

const suppliedRequestId = process.env.BOOTSTRAP_REQUEST_ID;
if (suppliedRequestId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suppliedRequestId)) throw new Error('BOOTSTRAP_REQUEST_ID must be a UUID.');
const bootstrapRequestId = suppliedRequestId ?? randomUUID();
const bootstrapKeyHash = createHash('sha256').update(bootstrapRequestId).digest('hex');
if (!suppliedRequestId) process.stdout.write(`Save this bootstrap request ID and reuse it if the command response is lost: ${bootstrapRequestId}\n`);

const outcome = await inTransaction(async client => {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('initial-tenant-bootstrap',0))");
  const previous = await client.query(`SELECT o.tenant_id,t.name tenant_name,t.currency,t.time_zone tenant_time_zone,u.id owner_id,u.email owner_email,u.full_name owner_name,ou.id outlet_id,ou.name outlet_name,ou.time_zone outlet_time_zone,d.id device_id,d.label device_label,o.status,
      (SELECT array_agg(capability ORDER BY capability) FROM core.tenant_capabilities c WHERE c.tenant_id=t.id) capabilities
    FROM core.tenant_onboarding o JOIN core.tenants t ON t.id=o.tenant_id
    JOIN identity.memberships m ON m.tenant_id=t.id AND m.role='owner'
    JOIN identity.users u ON u.id=m.user_id
    JOIN core.outlets ou ON ou.tenant_id=t.id
    JOIN identity.devices d ON d.tenant_id=t.id AND d.outlet_id=ou.id AND d.assigned_user_id=u.id
    WHERE o.bootstrap_key_hash=$1 ORDER BY ou.id,d.id LIMIT 1`, [bootstrapKeyHash]);
  if (previous.rowCount) {
    const row = previous.rows[0];
    const expectedCapabilities=[...capabilities].sort();
    const existingCapabilities=[...(row.capabilities??[])].sort();
    if (row.tenant_name !== tenantName || row.currency !== currency || row.tenant_time_zone !== tenantTimeZone || row.owner_email !== ownerEmail || row.owner_name !== ownerName || row.outlet_name !== outletName || row.outlet_time_zone !== outletTimeZone || row.device_label !== deviceLabel || JSON.stringify(existingCapabilities)!==JSON.stringify(expectedCapabilities)) throw new Error('This bootstrap request ID belongs to a different business setup.');
    return { tenantId: row.tenant_id, outletId: row.outlet_id, ownerId: row.owner_id, deviceId: row.device_id, status: row.status, created: false };
  }
  const existingTenant = await client.query('SELECT id FROM core.tenants LIMIT 1');
  if (existingTenant.rowCount) throw new Error('This initial-tenant bootstrap only runs on an empty business database. Reuse the original request ID to recover its result.');
  const tenantId = randomUUID(), outletId = randomUUID(), ownerId = randomUUID(), deviceId = randomUUID();
  const profile = { taxPolicy: { calculation: 'exclusive', defaultRateBps: 0, label: 'Tax', reviewed: false } };
  await client.query('INSERT INTO core.tenants(id,name,currency,time_zone,business_profile) VALUES($1,$2,$3,$4,$5::jsonb)', [tenantId, tenantName, currency, tenantTimeZone, JSON.stringify(profile)]);
  await client.query('INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,$3,$4)', [outletId, tenantId, outletName, outletTimeZone]);
  for (const capability of capabilities) await client.query('INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,$2)', [tenantId, capability]);
  await client.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)', [ownerId, ownerEmail, passwordHash, ownerName]);
  await client.query("INSERT INTO identity.memberships(tenant_id,user_id,role,display_name) VALUES($1,$2,'owner',$3)", [tenantId, ownerId, ownerName]);
  await client.query('INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,$5)', [deviceId, tenantId, outletId, ownerId, deviceLabel]);
  await client.query("INSERT INTO core.tenant_onboarding(tenant_id,bootstrap_key_hash,status) VALUES($1,$2,'SETUP')", [tenantId, bootstrapKeyHash]);
  return { tenantId, outletId, ownerId, deviceId, status: 'SETUP', created: true };
});

process.stdout.write(`${outcome.created ? 'Initial business created' : 'Recovered the existing bootstrap result'}; status=${outcome.status}; ordinary sales remain locked until owner go-live review.\n`);
process.stdout.write(`tenantId=${outcome.tenantId} outletId=${outcome.outletId} ownerId=${outcome.ownerId} deviceId=${outcome.deviceId}\n`);
await pool.end();
