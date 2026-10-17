import type { ApiSession } from './contracts.js';
import { DomainError } from './contracts.js';
import { inTransaction } from './db.js';
import { revalidateOperator } from './identityAuthority.js';
import { requireCommandAuthority, requireCommandRecoveryAuthority } from './commandAuthorization.js';
import { identityEvidence } from './staff.js';
import { credentialFingerprint, hashPassword, verifyPassword } from './security.js';

export interface CredentialInput {protocolVersion:1;commandId:string;expectedVersions:Record<string,number>;newPassword:string;currentPassword?:string}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function changeCredential(operator:ApiSession,input:CredentialInput,target?:unknown){
  const self=target===undefined;const userId=self?operator.userId:target;
  const type=self?'auth.password.change':'staff.password.set';
  if(!self&&userId===operator.userId)throw new DomainError('USE_SELF_PASSWORD_CHANGE','Use My account and verify your current password to change your own credential.',403);
  if(typeof userId!=='string'||!uuid.test(userId)||!input||input.protocolVersion!==1||!uuid.test(input.commandId??'')||!input.expectedVersions||typeof input.expectedVersions!=='object'||Array.isArray(input.expectedVersions)||typeof input.newPassword!=='string'||input.newPassword.length<12||input.newPassword.length>256||Object.keys(input).some(key=>!['protocolVersion','commandId','expectedVersions','newPassword',...(self?['currentPassword']:[])].includes(key)))throw new DomainError('VALIDATION_FAILED','Provide a command ID, expected credential version and a new password of 12 to 256 characters.');
  if(self&&(typeof input.currentPassword!=='string'||input.currentPassword.length>256))throw new DomainError('VALIDATION_FAILED','Enter your current password to change your account credential.');
  const expected=input.expectedVersions[`credential:${userId}`];if(!Number.isSafeInteger(expected)||expected<1)throw new DomainError('VALIDATION_FAILED','Expected credential version is required.');
  if(!process.env.CREDENTIAL_FINGERPRINT_KEY||!/^[a-f0-9]{64}$/i.test(process.env.CREDENTIAL_FINGERPRINT_KEY))throw new DomainError('CREDENTIAL_SERVICE_UNAVAILABLE','Credential management is not configured on this server.',503);
  // Session IDs and authentication cookies are excluded so the original command
  // remains recognizable after its successful self-change revoked the session.
  const digest=credentialFingerprint({tenantId:operator.tenantId,actorId:operator.userId,targetUserId:userId,type,input});
  const passwordHash=await hashPassword(input.newPassword);
  return inTransaction(async client=>{
    const session=await revalidateOperator(client,operator);
    requireCommandAuthority(session,type);
    await client.query('SELECT id FROM core.tenants WHERE id=$1 FOR UPDATE',[session.tenantId]);
    const inserted=await client.query(`INSERT INTO system.commands(tenant_id,command_id,actor_id,device_id,command_type,request_hash,status)
      VALUES($1,$2,$3,$4,$5,$6,'EXECUTING') ON CONFLICT DO NOTHING RETURNING command_id`,[session.tenantId,input.commandId,session.userId,session.deviceId,type,digest]);
    if(!inserted.rowCount){
      const stored=await client.query(`SELECT c.actor_id,c.request_hash,c.status,c.response,c.command_type,d.outlet_id
        FROM system.commands c JOIN identity.devices d ON d.tenant_id=c.tenant_id AND d.id=c.device_id
        WHERE c.tenant_id=$1 AND c.command_id=$2 FOR UPDATE OF c`,[session.tenantId,input.commandId]);
      if(stored.rows[0].actor_id!==session.userId)throw new DomainError('NOT_FOUND','Credential operation was not found in your operator scope.',404);
      requireCommandRecoveryAuthority(session,stored.rows[0],'replay');
      if(!Buffer.from(stored.rows[0].request_hash).equals(digest))return {commandId:input.commandId,status:'REJECTED',code:'IDEMPOTENCY_MISMATCH',message:'This operation ID was used with different content.'};
      return {commandId:input.commandId,...stored.rows[0].response};
    }
    await client.query('SAVEPOINT credential_change');
    let response:Record<string,unknown>;
    try{
      const member=await client.query('SELECT user_id FROM identity.memberships WHERE tenant_id=$1 AND user_id=$2 FOR SHARE',[session.tenantId,userId]);
      if(!member.rowCount)throw new DomainError('NOT_FOUND','Staff membership was not found for this business.',404);
      const user=await client.query('SELECT password_hash,credential_version FROM identity.users WHERE id=$1 FOR UPDATE',[userId]);
      if(!self){const shared=await client.query('SELECT 1 FROM identity.memberships WHERE user_id=$1 AND tenant_id<>$2 LIMIT 1 FOR SHARE',[userId,session.tenantId]);if(shared.rowCount)throw new DomainError('CREDENTIAL_SCOPE_RESTRICTED','This credential must be managed by the account holder through My account.',403);}
      if(Number(user.rows[0].credential_version)!==expected)throw new DomainError('VERSION_CONFLICT','The account credential changed. Refresh its current version before proceeding.',409,{currentVersion:Number(user.rows[0].credential_version)});
      if(self&&!(await verifyPassword(input.currentPassword!,user.rows[0].password_hash??'')))throw new DomainError('INVALID_CURRENT_PASSWORD','The current password is incorrect.',400);
      const updated=await client.query('UPDATE identity.users SET password_hash=$2,credential_version=credential_version+1 WHERE id=$1 RETURNING credential_version',[userId,passwordHash]);
      const revoked=await client.query('UPDATE identity.sessions SET revoked_at=now(),version=version+1 WHERE user_id=$1 AND revoked_at IS NULL RETURNING id',[userId]);
      const value={userId,credentialVersion:Number(updated.rows[0].credential_version),sessionsRevoked:revoked.rowCount??0,reauthenticate:self};
      await identityEvidence(client,session,input.commandId,type,value);response={status:'CONFIRMED',value};
    }catch(error){
      await client.query('ROLLBACK TO SAVEPOINT credential_change');if(!(error instanceof DomainError))throw error;
      response={status:error.code==='VERSION_CONFLICT'?'CONFLICT':'REJECTED',code:error.code,message:error.message,details:error.details};
    }
    await client.query('UPDATE system.commands SET status=$3,response=$4::jsonb,completed_at=now() WHERE tenant_id=$1 AND command_id=$2',[session.tenantId,input.commandId,response.status,JSON.stringify(response)]);
    return {commandId:input.commandId,...response};
  });
}
