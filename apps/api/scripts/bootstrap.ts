import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { pool, inTransaction } from '../src/db.js';
import { hashPassword } from '../src/security.js';

if (process.env.BOOTSTRAP_CONFIRM !== 'CREATE_INITIAL_TENANT') throw new Error('Set BOOTSTRAP_CONFIRM=CREATE_INITIAL_TENANT to create the initial tenant.');
const required = ['TENANT_NAME','TENANT_CURRENCY','TENANT_TIME_ZONE','OUTLET_NAME','OUTLET_TIME_ZONE','ADMIN_EMAIL','ADMIN_NAME','ADMIN_PASSWORD','DEVICE_LABEL'] as const;
for (const key of required) if (!process.env[key]) throw new Error(`${key} is required.`);
const passwordHash = await hashPassword(process.env.ADMIN_PASSWORD!);
const tenantId=randomUUID(), outletId=randomUUID(), userId=randomUUID(), deviceId=randomUUID();
await inTransaction(async client=>{
  await client.query('INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,$2,$3,$4)',[tenantId,process.env.TENANT_NAME,process.env.TENANT_CURRENCY,process.env.TENANT_TIME_ZONE]);
  await client.query('INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,$3,$4)',[outletId,tenantId,process.env.OUTLET_NAME,process.env.OUTLET_TIME_ZONE]);
  const capabilities=(process.env.TENANT_CAPABILITIES??'retail,inventory,commerce').split(',').map(value=>value.trim()).filter(Boolean);
  for(const capability of capabilities)await client.query('INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,$2)',[tenantId,capability]);
  await client.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,lower($2),$3,$4)',[userId,process.env.ADMIN_EMAIL,passwordHash,process.env.ADMIN_NAME]);
  await client.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[tenantId,userId]);
  await client.query('INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,$5)',[deviceId,tenantId,outletId,userId,process.env.DEVICE_LABEL]);
});
process.stdout.write(`Initial tenant created. tenantId=${tenantId} outletId=${outletId} deviceId=${deviceId}\n`);
await pool.end();
