import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {inReadSnapshot} from './db.js';
import {DomainError,ROLE_PERMISSIONS,type ApiSession,type CommandEnvelope} from './contracts.js';
import {REPORT_ACCOUNTS} from './reportMetadata.js';

export async function readAccountLabels(client:PoolClient,tenantId:string){
  const tenant=await client.query<{account_catalog_version:string}>('SELECT account_catalog_version::text FROM core.tenants WHERE id=$1',[tenantId]);
  if(!tenant.rowCount)throw new DomainError('NOT_FOUND','The business could not be found.',404);
  const version=Number(tenant.rows[0].account_catalog_version);
  const labels=await client.query<{account_code:string;label:string}>(`SELECT DISTINCT ON(account_code) account_code,label
    FROM finance.account_label_revisions WHERE tenant_id=$1 AND catalog_version<=$2 ORDER BY account_code,catalog_version DESC`,[tenantId,version]);
  return{version,labels:new Map(labels.rows.map(row=>[row.account_code,row.label]))};
}
export async function getAccountCatalog(session:ApiSession){
  if(!ROLE_PERMISSIONS[session.role].includes('finance.view'))throw new DomainError('FORBIDDEN','Your account cannot review the account catalogue.',403);
  return inReadSnapshot(async client=>{
    const catalog=await readAccountLabels(client,session.tenantId);
    return{version:catalog.version,generatedAt:new Date().toISOString(),labelPolicy:'CURRENT_VERSIONED_LABELS',
      accounts:Object.entries(REPORT_ACCOUNTS).map(([accountCode,metadata])=>({accountCode,label:catalog.labels.get(accountCode)??metadata.name,classification:metadata.classification,systemDefined:true})),
      permissions:{manage:ROLE_PERMISSIONS[session.role].includes('finance.manage')},
      coverage:'Display names use the stated catalogue version. Account classes and control-account identities are fixed. Renaming does not reclassify or change posted amounts. Economic remapping and additional custom posting accounts require a separate versioned accounting policy.'};
  });
}
/** Runs exclusively inside the existing idempotent command transaction. */
export async function executeAccountCatalogCommand(client:PoolClient,session:ApiSession,envelope:CommandEnvelope){
  if(envelope.type!=='finance.account.label')throw new DomainError('VALIDATION_FAILED','This account catalogue action is unsupported.');
  if(!ROLE_PERMISSIONS[session.role].includes('finance.manage'))throw new DomainError('FORBIDDEN','Your account cannot rename accounts.',403);
  const payload=envelope.payload;
  if(!payload||Object.keys(payload).some(key=>!['accountCode','label'].includes(key))||typeof payload.accountCode!=='string'||!Object.hasOwn(REPORT_ACCOUNTS,payload.accountCode)||typeof payload.label!=='string'||payload.label.trim().length<1||payload.label.trim().length>120||/[\u0000-\u001f\u007f]/.test(payload.label))throw new DomainError('VALIDATION_FAILED','Choose an existing account and a display name of 1 to 120 characters. Account classes cannot be changed here.');
  const expected=envelope.expectedVersions[`account-catalog:${session.tenantId}`];
  if(!Number.isSafeInteger(expected)||expected<1)throw new DomainError('VALIDATION_FAILED','Refresh the account catalogue before renaming an account.');
  const tenant=await client.query<{account_catalog_version:string}>('SELECT account_catalog_version::text FROM core.tenants WHERE id=$1 FOR UPDATE',[session.tenantId]);
  if(!tenant.rowCount)throw new DomainError('NOT_FOUND','The business could not be found.',404);
  const current=Number(tenant.rows[0].account_catalog_version);
  if(current!==expected)throw new DomainError('VERSION_CONFLICT','The account catalogue changed. Refresh and review its latest names.',409,{currentVersion:current});
  const next=current+1,label=payload.label.trim();
  await client.query(`INSERT INTO finance.account_label_revisions(id,tenant_id,account_code,label,catalog_version,command_id,actor_id,operator_name_snapshot)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[randomUUID(),session.tenantId,payload.accountCode,label,next,envelope.commandId,session.userId,session.fullName]);
  await client.query('UPDATE core.tenants SET account_catalog_version=$2 WHERE id=$1',[session.tenantId,next]);
  const result={accountCode:payload.accountCode,label,catalogVersion:next};
  await client.query('INSERT INTO system.audit_events(id,tenant_id,outlet_id,actor_id,command_id,event_type,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[randomUUID(),session.tenantId,session.outletId,session.userId,envelope.commandId,envelope.type,JSON.stringify(result)]);
  await client.query('INSERT INTO system.transactional_outbox(id,tenant_id,command_id,event_type,payload) VALUES($1,$2,$3,$4,$5::jsonb)',[randomUUID(),session.tenantId,envelope.commandId,envelope.type,JSON.stringify(result)]);
  return result;
}
