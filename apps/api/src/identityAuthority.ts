import type { PoolClient } from 'pg';
import { DomainError, ROLE_PERMISSIONS, type ApiPermission, type ApiSession } from './contracts.js';

export function requireIdentityPermission(session:ApiSession,permission:ApiPermission){
  if(!ROLE_PERMISSIONS[session.role].includes(permission))throw new DomainError('FORBIDDEN','Your role cannot perform this administration operation.',403);
}
export async function revalidateOperator(client:PoolClient,session:ApiSession):Promise<ApiSession>{
  const result=await client.query<{role:ApiSession['role'];display_name:string;credential_version:string}>(`SELECT m.role,m.display_name,u.credential_version
    FROM identity.sessions s JOIN identity.users u ON u.id=s.user_id
    JOIN identity.memberships m ON m.tenant_id=s.tenant_id AND m.user_id=s.user_id
    JOIN identity.devices d ON d.id=s.device_id AND d.tenant_id=s.tenant_id AND d.outlet_id=s.outlet_id
    JOIN core.outlets o ON o.id=s.outlet_id AND o.tenant_id=s.tenant_id
    WHERE s.id=$1 AND s.user_id=$2 AND s.tenant_id=$3 AND s.outlet_id=$4 AND s.device_id=$5
      AND s.revoked_at IS NULL AND s.expires_at>now() AND u.active AND m.active AND d.active AND o.active AND d.assigned_user_id=s.user_id
    FOR SHARE OF s,u,m,d,o`,[session.sessionId,session.userId,session.tenantId,session.outletId,session.deviceId]);
  if(!result.rowCount)throw new DomainError('UNAUTHENTICATED','The operator session or workspace assignment changed. Sign in again.',401);
  const caps=await client.query<{capability:string}>('SELECT capability FROM core.tenant_capabilities WHERE tenant_id=$1 ORDER BY capability',[session.tenantId]);
  return {...session,role:result.rows[0].role,fullName:result.rows[0].display_name,credentialVersion:Number(result.rows[0].credential_version),capabilities:caps.rows.map(row=>row.capability)};
}
