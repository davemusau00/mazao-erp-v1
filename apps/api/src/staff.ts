import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from './db.js';
import { DomainError, ROLE_PERMISSIONS, type ApiRole, type ApiSession, type CommandEnvelope } from './contracts.js';
import { requireIdentityPermission } from './identityAuthority.js';
import { requireCommandAuthority } from './commandAuthorization.js';

export const STAFF_COMMANDS=['staff.member.create','staff.member.update','staff.member.set_active','devices.assignment.create','devices.assignment.update','devices.assignment.revoke','staff.sessions.revoke','auth.session.revoke'] as const;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const roleLabels:Record<ApiRole,string>={admin:'Administrator',owner:'Owner',manager:'Manager',accountant:'Accountant',cashier:'Cashier',storekeeper:'Storekeeper',receptionist:'Receptionist',housekeeper:'Housekeeper',waiter:'Waiter',cook:'Cook',bartender:'Bartender'};
export function roleAssignable(role:unknown,capabilities:string[]):role is ApiRole {
  if(typeof role!=='string'||!(role in ROLE_PERMISSIONS)||['waiter','cook','bartender'].includes(role))return false;
  return !['receptionist','housekeeper'].includes(role)||capabilities.includes('hospitality');
}
function id(value:unknown,field:string):string{if(typeof value!=='string'||!uuid.test(value))throw new DomainError('VALIDATION_FAILED',`${field} must be a valid identifier.`);return value;}
function text(value:unknown,field:string,max=160):string{if(typeof value!=='string'||!value.trim()||value.trim().length>max||/[\u0000-\u001f\u007f]/.test(value))throw new DomainError('VALIDATION_FAILED',`${field} requires 1 to ${max} characters without control characters.`);return value.trim();}
function expected(envelope:CommandEnvelope,key:string):number{const value=envelope.expectedVersions[key];if(!Number.isSafeInteger(value)||value<1)throw new DomainError('VALIDATION_FAILED',`Expected ${key} version is required.`);return value;}
function matchVersion(current:unknown,wanted:number){if(Number(current)!==wanted)throw new DomainError('VERSION_CONFLICT','This administration record changed. Review the current server state before submitting again.',409,{currentVersion:Number(current)});}
function validateRole(value:unknown,session:ApiSession):ApiRole{if(!roleAssignable(value,session.capabilities))throw new DomainError('VALIDATION_FAILED','Choose a role supported by the currently enabled server workflows.');return value;}
export function assertStaffMetadataInput(envelope:CommandEnvelope){
  const fields:Record<string,string[]>={
    'staff.member.create':['email','displayName','role'],'staff.member.update':['userId','displayName','role'],'staff.member.set_active':['userId','active','reason'],
    'devices.assignment.create':['label','outletId','assignedUserId'],'devices.assignment.update':['deviceId','label','assignedUserId'],'devices.assignment.revoke':['deviceId','reason'],
    'staff.sessions.revoke':['userId','sessionId','reason'],'auth.session.revoke':['sessionId','reason'],
  };
  const allowed=fields[envelope.type];
  if(allowed&&Object.keys(envelope.payload).some(key=>!allowed.includes(key)))throw new DomainError('VALIDATION_FAILED','Administration metadata contains an unsupported field. Passwords require the dedicated credential endpoint.');
}
export async function identityEvidence(client:PoolClient,session:ApiSession,commandId:string,type:string,value:unknown){
  const json=JSON.stringify(value);
  await client.query('INSERT INTO system.audit_events(id,tenant_id,outlet_id,actor_id,command_id,event_type,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[randomUUID(),session.tenantId,session.outletId,session.userId,commandId,type,json]);
  await client.query('INSERT INTO system.transactional_outbox(id,tenant_id,command_id,event_type,payload) VALUES($1,$2,$3,$4,$5::jsonb)',[randomUUID(),session.tenantId,commandId,type,json]);
}
async function member(client:PoolClient,session:ApiSession,userId:string,lock=true){
  const result=await client.query(`SELECT m.user_id,m.display_name,m.role,m.active,m.version,u.email,u.active user_active,u.password_hash IS NOT NULL has_credential,u.credential_version
    FROM identity.memberships m JOIN identity.users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.user_id=$2${lock?' FOR UPDATE OF m':''}`,[session.tenantId,userId]);
  if(!result.rowCount)throw new DomainError('NOT_FOUND','Staff membership was not found for this business.',404);return result.rows[0];
}
async function noOpenShifts(client:PoolClient,tenantId:string,userId:string){
  const result=await client.query('SELECT s.id,s.outlet_id,o.name outlet_name FROM commerce.shifts s JOIN core.outlets o ON o.id=s.outlet_id AND o.tenant_id=s.tenant_id WHERE s.tenant_id=$1 AND s.operator_id=$2 AND s.status=\'OPEN\' FOR SHARE OF s',[tenantId,userId]);
  if(result.rowCount)throw new DomainError('OPEN_SHIFT_CONFLICT','Close this operator’s open tills before changing their access.',409,{shifts:result.rows.map(row=>({shiftId:row.id,outletId:row.outlet_id,outletName:row.outlet_name}))});
}
async function usableAdministrator(client:PoolClient,tenantId:string){
  const result=await client.query(`SELECT m.user_id FROM identity.memberships m JOIN identity.users u ON u.id=m.user_id
    WHERE m.tenant_id=$1 AND m.active AND m.role IN ('owner','admin') AND u.active AND u.password_hash IS NOT NULL
      AND EXISTS(SELECT 1 FROM identity.devices d JOIN core.outlets o ON o.id=d.outlet_id AND o.tenant_id=d.tenant_id WHERE d.tenant_id=m.tenant_id AND d.assigned_user_id=m.user_id AND d.active AND o.active) LIMIT 1`,[tenantId]);
  if(!result.rowCount)throw new DomainError('LAST_ADMINISTRATOR','Keep an active owner or administrator with a usable password and workspace assignment.',409);
}
async function revokeUserSessions(client:PoolClient,tenantId:string,userId:string){
  const result=await client.query('UPDATE identity.sessions SET revoked_at=now(),version=version+1 WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id',[tenantId,userId]);return result.rowCount??0;
}
export function requireStaffCommandPermission(session:ApiSession,type:string){
  if(!(STAFF_COMMANDS as readonly string[]).includes(type))throw new DomainError('VALIDATION_FAILED','Unsupported staff or assignment command.');
  requireCommandAuthority(session,type);
}
export async function executeStaffCommand(client:PoolClient,session:ApiSession,envelope:CommandEnvelope){
  requireStaffCommandPermission(session,envelope.type);assertStaffMetadataInput(envelope);
  // Serialize tenant-wide access changes, including simultaneous administrator
  // removals and enrollment against membership/credential changes.
  await client.query('SELECT id FROM core.tenants WHERE id=$1 FOR UPDATE',[session.tenantId]);
  const p=envelope.payload;
  if(envelope.type==='staff.member.create'){
    const email=text(p.email,'email',254).toLowerCase();const displayName=text(p.displayName,'displayName');const role=validateRole(p.role,session);
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new DomainError('VALIDATION_FAILED','Provide a valid operator email address.');
    const userId=randomUUID();
    const inserted=await client.query('INSERT INTO identity.users(id,email,password_hash,full_name) SELECT $1,$2,NULL,$3 WHERE NOT EXISTS(SELECT 1 FROM identity.users WHERE lower(email)=lower($2)) ON CONFLICT DO NOTHING RETURNING id',[userId,email,displayName]);
    if(!inserted.rowCount)throw new DomainError('EMAIL_UNAVAILABLE','This email cannot be provisioned as a new business operator. Use another email or ask the account holder to manage access.',409);
    await client.query('INSERT INTO identity.memberships(tenant_id,user_id,role,display_name) VALUES($1,$2,$3,$4)',[session.tenantId,userId,role,displayName]);
    const value={userId,version:1,credentialVersion:1,hasCredential:false};await identityEvidence(client,session,envelope.commandId,envelope.type,{...value,role});return value;
  }
  if(envelope.type==='staff.member.update'||envelope.type==='staff.member.set_active'){
    const userId=id(p.userId,'userId');const current=await member(client,session,userId);matchVersion(current.version,expected(envelope,`staff:${userId}`));
    let displayName=current.display_name as string;let role=current.role as ApiRole;let active=current.active as boolean;
    if(envelope.type==='staff.member.update'){
      displayName=text(p.displayName,'displayName');
      if(p.role!==current.role)role=validateRole(p.role,session);
      else if(typeof p.role!=='string')throw new DomainError('VALIDATION_FAILED','Provide the current or supported staff role.');
    }else{if(typeof p.active!=='boolean')throw new DomainError('VALIDATION_FAILED','active must be a boolean.');active=p.active;text(p.reason,'reason',500);}
    if(userId===session.userId&&(role!==current.role||!active))throw new DomainError('SELF_ACCESS_CHANGE_FORBIDDEN','Use another administrator to change your role or deactivate your account.',409);
    if(role!==current.role||!active)await noOpenShifts(client,session.tenantId,userId);
    const changed=await client.query('UPDATE identity.memberships SET display_name=$3,role=$4,active=$5,version=version+1 WHERE tenant_id=$1 AND user_id=$2 RETURNING version',[session.tenantId,userId,displayName,role,active]);
    const revokedSessionCount=role!==current.role||active!==current.active?await revokeUserSessions(client,session.tenantId,userId):0;
    await usableAdministrator(client,session.tenantId);
    const value={userId,version:Number(changed.rows[0].version),revokedSessionCount};
    await identityEvidence(client,session,envelope.commandId,envelope.type,{before:{userId,displayName:current.display_name,role:current.role,active:current.active,version:Number(current.version)},after:{...value,displayName,role,active},reason:p.reason});return value;
  }
  if(envelope.type.startsWith('devices.assignment.')){
    if(envelope.type==='devices.assignment.create'){
      const outletId=id(p.outletId,'outletId');const assignedUserId=id(p.assignedUserId,'assignedUserId');const label=text(p.label,'label');const target=await member(client,session,assignedUserId);
      if(!target.active||!target.user_active)throw new DomainError('VALIDATION_FAILED','Choose an active staff membership.');
      const outlet=await client.query('SELECT id FROM core.outlets WHERE tenant_id=$1 AND id=$2 AND active FOR SHARE',[session.tenantId,outletId]);if(!outlet.rowCount)throw new DomainError('NOT_FOUND','Active outlet was not found for this business.',404);
      const deviceId=randomUUID();await client.query('INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,$5)',[deviceId,session.tenantId,outletId,assignedUserId,label]);
      const value={deviceId,version:1,kind:'WORKSPACE_ASSIGNMENT'};await identityEvidence(client,session,envelope.commandId,envelope.type,{...value,outletId,assignedUserId,label});return value;
    }
    const deviceId=id(p.deviceId,'deviceId');const result=await client.query('SELECT * FROM identity.devices WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[session.tenantId,deviceId]);if(!result.rowCount)throw new DomainError('NOT_FOUND','Workspace assignment was not found.',404);
    const current=result.rows[0];matchVersion(current.version,expected(envelope,`device:${deviceId}`));
    if(!current.active)throw new DomainError('ASSIGNMENT_REVOKED','This assignment is revoked. Create a new assignment to restore access.',409);
    let assignedUserId=current.assigned_user_id as string;let label=current.label as string;let active=true;
    if(envelope.type==='devices.assignment.update'){
      label=text(p.label,'label');assignedUserId=id(p.assignedUserId,'assignedUserId');const target=await member(client,session,assignedUserId);
      if(!target.active||!target.user_active)throw new DomainError('VALIDATION_FAILED','Choose an active staff membership.');
    }else{active=false;text(p.reason,'reason',500);}
    const accessChanged=!active||assignedUserId!==current.assigned_user_id;
    if(accessChanged&&deviceId===session.deviceId)throw new DomainError('SELF_ACCESS_CHANGE_FORBIDDEN','Use another administrator session to revoke or reassign your current workspace access.',409);
    if(accessChanged)await noOpenShifts(client,session.tenantId,current.assigned_user_id);
    const changed=await client.query('UPDATE identity.devices SET label=$3,assigned_user_id=$4,active=$5,revoked_at=CASE WHEN $5::boolean THEN NULL ELSE now() END,version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING version',[session.tenantId,deviceId,label,assignedUserId,active]);
    const revoked=accessChanged?await client.query('UPDATE identity.sessions SET revoked_at=now(),version=version+1 WHERE tenant_id=$1 AND device_id=$2 AND revoked_at IS NULL RETURNING id',[session.tenantId,deviceId]):null;
    await usableAdministrator(client,session.tenantId);
    const value={deviceId,version:Number(changed.rows[0].version),revokedSessionCount:revoked?.rowCount??0};
    await identityEvidence(client,session,envelope.commandId,envelope.type,{before:{deviceId,label:current.label,assignedUserId:current.assigned_user_id,active:current.active,version:Number(current.version)},after:{...value,label,assignedUserId,active},reason:p.reason});return value;
  }
  const sessionId=id(p.sessionId,'sessionId');const userId=envelope.type==='auth.session.revoke'?session.userId:id(p.userId,'userId');text(p.reason,'reason',500);
  await member(client,session,userId,false);
  const result=await client.query('SELECT id,version,revoked_at FROM identity.sessions WHERE tenant_id=$1 AND user_id=$2 AND id=$3 FOR UPDATE',[session.tenantId,userId,sessionId]);
  if(!result.rowCount)throw new DomainError('NOT_FOUND','Operator session was not found.',404);matchVersion(result.rows[0].version,expected(envelope,`session:${sessionId}`));
  if(result.rows[0].revoked_at)throw new DomainError('SESSION_REVOKED','This session has already been revoked.',409);
  const changed=await client.query('UPDATE identity.sessions SET revoked_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING version',[session.tenantId,sessionId]);
  const value={sessionId,version:Number(changed.rows[0].version),reauthenticate:sessionId===session.sessionId};await identityEvidence(client,session,envelope.commandId,envelope.type,{...value,userId,reason:p.reason});return value;
}
export async function listStaff(session:ApiSession){
  requireIdentityPermission(session,'staff.view');
  const result=await pool.query(`SELECT m.user_id,m.display_name,m.role,m.active,m.version,u.email,u.credential_version,u.password_hash IS NOT NULL has_credential,
    (SELECT count(*)::int FROM identity.devices d WHERE d.tenant_id=m.tenant_id AND d.assigned_user_id=m.user_id AND d.active) assignment_count,
    (SELECT count(*)::int FROM identity.sessions s WHERE s.tenant_id=m.tenant_id AND s.user_id=m.user_id AND s.revoked_at IS NULL AND s.expires_at>now()) active_session_count
    FROM identity.memberships m JOIN identity.users u ON u.id=m.user_id WHERE m.tenant_id=$1 ORDER BY m.display_name,m.user_id LIMIT 500`,[session.tenantId]);
  const outlets=await pool.query('SELECT id,name,time_zone,active FROM core.outlets WHERE tenant_id=$1 ORDER BY name,id',[session.tenantId]);
  return {staff:result.rows.map(row=>({userId:row.user_id,displayName:row.display_name,email:row.email,role:row.role,active:row.active,version:Number(row.version),credentialVersion:Number(row.credential_version),hasCredential:row.has_credential,assignmentCount:row.assignment_count,activeSessionCount:row.active_session_count})),roles:Object.entries(ROLE_PERMISSIONS).map(([role,permissions])=>({role,label:roleLabels[role as ApiRole],permissions,assignable:roleAssignable(role,session.capabilities)})),outlets:outlets.rows.map(row=>({id:row.id,name:row.name,timeZone:row.time_zone,active:row.active})),authorizationModel:'COARSE_ROLE_MAP'};
}
export async function listAssignments(session:ApiSession){
  requireIdentityPermission(session,'devices.view');
  const result=await pool.query(`SELECT d.*,o.name outlet_name,m.display_name assigned_user_name FROM identity.devices d
    JOIN core.outlets o ON o.id=d.outlet_id AND o.tenant_id=d.tenant_id JOIN identity.memberships m ON m.tenant_id=d.tenant_id AND m.user_id=d.assigned_user_id
    WHERE d.tenant_id=$1 ORDER BY d.created_at DESC,d.id LIMIT 500`,[session.tenantId]);
  return {devices:result.rows.map(row=>({id:row.id,kind:'WORKSPACE_ASSIGNMENT',label:row.label,outletId:row.outlet_id,outletName:row.outlet_name,assignedUserId:row.assigned_user_id,assignedUserName:row.assigned_user_name,active:row.active,version:Number(row.version),createdAt:row.created_at,revokedAt:row.revoked_at}))};
}
export async function listOperatorSessions(session:ApiSession,target?:unknown){
  const userId=target===undefined?session.userId:id(target,'userId');if(target!==undefined)requireIdentityPermission(session,'staff.view');
  const client=await pool.connect();try{
    const staff=await member(client,session,userId,false);
    const result=await client.query(`SELECT s.id,s.device_id,s.outlet_id,s.created_at,s.expires_at,s.revoked_at,s.version,d.label device_label,o.name outlet_name
      FROM identity.sessions s JOIN identity.devices d ON d.id=s.device_id AND d.tenant_id=s.tenant_id JOIN core.outlets o ON o.id=s.outlet_id AND o.tenant_id=s.tenant_id
      WHERE s.tenant_id=$1 AND s.user_id=$2 ORDER BY s.created_at DESC,s.id LIMIT 100`,[session.tenantId,userId]);
    return {userId,credentialVersion:Number(staff.credential_version),sessions:result.rows.map(row=>({id:row.id,deviceId:row.device_id,deviceLabel:row.device_label,outletId:row.outlet_id,outletName:row.outlet_name,createdAt:row.created_at,expiresAt:row.expires_at,revokedAt:row.revoked_at,version:Number(row.version),current:row.id===session.sessionId}))};
  }finally{client.release();}
}
