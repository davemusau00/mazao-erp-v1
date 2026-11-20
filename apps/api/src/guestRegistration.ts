import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DomainError, ROLE_PERMISSIONS, type ApiSession, type CommandEnvelope } from './contracts.js';
import { inTransaction } from './db.js';
import { revalidateOperator } from './identityAuthority.js';
import { requireCommandAuthority, requireCommandRecoveryAuthority } from './commandAuthorization.js';
import { credentialFingerprint, stableStringify } from './security.js';
import { isRecord } from './contractValidation.js';
import { GUEST_COUNTRY_CODES } from './guestRegistrationTypes.js';
import type { GuestBooker, GuestDocumentType, GuestEmergencyContact, GuestIdentityView, GuestOccupantFields, GuestRegistrationInput, GuestRegistrationOperation, GuestRegistrationPolicy, GuestRegistrationResult, GuestRegistrationSave, GuestRegistrationView } from './guestRegistrationTypes.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const documentTypes:GuestDocumentType[]=['NATIONAL_ID','PASSPORT','RESIDENT_ID','OTHER'];
const operationKinds=['hotel.registration.save','hotel.registration.correct'];
const emptyBooker:GuestBooker={fullName:'',phone:'',email:'',alternativePhone:'',company:'',bookingReference:'',arrivalTime:'',purpose:'',notes:'',noContactReason:''};
const emptyEmergency:GuestEmergencyContact={name:'',phone:'',relationship:''};
const emptyOccupantDetails={fullName:'',phone:'',email:'',nationality:'',residenceCountry:'',residenceCity:'',dateOfBirth:'',ageBand:''};
const defaultPolicy:GuestRegistrationPolicy={version:1,reviewed:false,requireIdentityForAllAdults:true,acceptedDocumentTypes:documentTypes,requireNationality:false,requireResidence:false,requirePassportExpiry:false,draftRetentionDays:7,identityRetentionDays:null,privacyNotice:''};
const fencedResponse={status:'REJECTED',code:'GUEST_REGISTRATION_OPERATION_FENCED',message:'The earlier private guest save was safely stopped. Re-enter the private details to continue.'};
type Row=Record<string,any>;
function invalid(field:string):never {throw new DomainError('VALIDATION_FAILED',`${field} is invalid.`,400,{field});}
function record(value:unknown,keys:string[],field:string,required=keys):Record<string,unknown>{
  if(!isRecord(value)||Object.keys(value).some(key=>!keys.includes(key))||required.some(key=>!Object.hasOwn(value,key)))return invalid(field);
  return value;
}
function text(value:unknown,field:string,max=160,required=false){if(typeof value!=='string'||value.length>max||/[\u0000-\u001f\u007f]/u.test(value))return invalid(field);const result=value.trim();if(required&&!result)return invalid(field);return result;}
function integer(value:unknown,field:string,min=0,max=100){if(!Number.isSafeInteger(value)||(value as number)<min||(value as number)>max)return invalid(field);return value as number;}
function id(value:unknown,field:string){if(typeof value!=='string'||!uuid.test(value))return invalid(field);return value;}
function date(value:unknown,field:string){const result=text(value,field,10);if(result&&(!/^\d{4}-\d{2}-\d{2}$/.test(result)||!Number.isFinite(Date.parse(result+'T00:00:00Z'))||new Date(result+'T00:00:00Z').toISOString().slice(0,10)!==result))return invalid(field);return result;}
function country(value:unknown,field:string){const result=text(value,field,2).toUpperCase();if(result&&!GUEST_COUNTRY_CODES.includes(result))return invalid(field);return result;}
function phone(value:unknown,field:string){const result=text(value,field,40);if(result&&!/^\+?[0-9][0-9 ()-]{4,38}$/.test(result))return invalid(field);return result;}
function email(value:unknown,field:string){const result=text(value,field,254);if(result&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))return invalid(field);return result;}
function boolean(value:unknown,field:string){if(typeof value!=='boolean')return invalid(field);return value;}
function owner(session:ApiSession){if(!['owner','admin'].includes(session.role))throw new DomainError('FORBIDDEN','Only an owner or administrator can approve guest registration policy.',403);}
function privateAccess(session:ApiSession){requireCommandAuthority(session,'hotel.registration.save');}
function managerAccess(session:ApiSession){if(!ROLE_PERMISSIONS[session.role].includes('hotel.guest.reveal'))throw new DomainError('FORBIDDEN','Your role cannot reveal guest identity numbers.',403);if(!session.capabilities.includes('hospitality'))throw new DomainError('CAPABILITY_DISABLED','Hospitality is not enabled.',403);}
export async function lockGuestRegistrationScope(client:PoolClient,session:ApiSession){
  // Same lock is taken by private saves/fences and all registration allocations.
  // Tenant FK checks already hold KEY SHARE, which is compatible with NO KEY UPDATE.
  await client.query('SELECT id FROM core.tenants WHERE id=$1 FOR NO KEY UPDATE',[session.tenantId]);
}
function keyring(){
  let keys:unknown;try{keys=JSON.parse(process.env.GUEST_IDENTITY_KEYS??'null');}catch{keys=null;}
  const active=process.env.GUEST_IDENTITY_ACTIVE_KEY;
  if(!isRecord(keys)||!active||!Object.hasOwn(keys,active)||Object.entries(keys).some(([name,key])=>!/^[-A-Za-z0-9_]{1,40}$/.test(name)||typeof key!=='string'||!/^[a-f0-9]{64}$/i.test(key)))throw new DomainError('GUEST_IDENTITY_UNAVAILABLE','Protected guest identity storage is not configured.',503);
  return {active,keys:keys as Record<string,string>};
}
function aad(session:ApiSession,registrationId:string,occupantId:string){return Buffer.from(`guest-id:v1:${session.tenantId}:${session.outletId}:${registrationId}:${occupantId}`);}
function protect(number:string,session:ApiSession,registrationId:string,occupantId:string){const ring=keyring(),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(ring.keys[ring.active],'hex'),iv);cipher.setAAD(aad(session,registrationId,occupantId));const ciphertext=Buffer.concat([cipher.update(number,'utf8'),cipher.final()]);return {ciphertext:[iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),ciphertext.toString('base64url')].join('.'),keyVersion:ring.active,suffix:number.length>4?number.slice(-4):''};}
function unprotect(row:Row,session:ApiSession,registrationId:string){
  const ring=keyring();if(!ring.keys[row.document_key_version])throw new DomainError('GUEST_IDENTITY_UNAVAILABLE','The protected identity key is unavailable.',503);
  try{const [iv,tag,encrypted]=row.document_ciphertext.split('.');const decipher=createDecipheriv('aes-256-gcm',Buffer.from(ring.keys[row.document_key_version],'hex'),Buffer.from(iv,'base64url'));decipher.setAAD(aad(session,registrationId,row.id));decipher.setAuthTag(Buffer.from(tag,'base64url'));return Buffer.concat([decipher.update(Buffer.from(encrypted,'base64url')),decipher.final()]).toString('utf8');}catch{throw new DomainError('GUEST_IDENTITY_UNAVAILABLE','The protected identity could not be read.',503);}
}
function assertDistinctAdultIdentities(occupants:Row[],session:ApiSession,registrationId:string){
  const documents=new Set<string>();
  for(const occupant of occupants){
    if(!occupant.document_ciphertext)continue;
    const number=unprotect(occupant,session,registrationId);
    if(occupant.kind!=='ADULT')continue;
    // Comparison is local to this party. Original formatting and leading zeros
    // remain encrypted unchanged; this is not a global identity uniqueness rule.
    const tuple=JSON.stringify([occupant.document_type,occupant.issuing_country.trim(),number.trim().replace(/\s+/gu,'').toUpperCase()]);
    if(documents.has(tuple))throw new DomainError('DUPLICATE_GUEST_IDENTITY','Each adult occupant must have their own identity document.',409);
    documents.add(tuple);
  }
}
function operation(value:unknown,withDetails=false):GuestRegistrationOperation|GuestRegistrationSave{
  const keys=['protocolVersion','commandId','registrationId','expectedVersion','kind','scope','reservationId','expectedReservationVersion',...(withDetails?['details','reason']:[])];
  const input=record(value,keys,'Guest registration operation',['protocolVersion','commandId','registrationId','expectedVersion','kind','scope',...(withDetails?['details']:[])]);
  if(input.protocolVersion!==1||!operationKinds.includes(input.kind as string))return invalid('Guest registration operation');
  id(input.commandId,'commandId');id(input.registrationId,'registrationId');integer(input.expectedVersion,'expectedVersion',0,Number.MAX_SAFE_INTEGER);
  const scope=record(input.scope,['tenantId','actorId','outletId','deviceId'],'Guest operation scope');for(const [key,value] of Object.entries(scope))id(value,'scope.'+key);
  if(input.reservationId!==undefined){id(input.reservationId,'reservationId');integer(input.expectedReservationVersion,'expectedReservationVersion',1,Number.MAX_SAFE_INTEGER);}else if(input.expectedReservationVersion!==undefined)return invalid('reservationId');
  if(withDetails&&input.reason!==undefined)text(input.reason,'reason',500,true);
  return input as unknown as GuestRegistrationOperation|GuestRegistrationSave;
}
function assertOperationScope(input:GuestRegistrationOperation,session:ApiSession,rawSave=false){
  const scope=input.scope;
  if(scope.tenantId!==session.tenantId||scope.actorId!==session.userId||scope.outletId!==session.outletId||(rawSave&&scope.deviceId!==session.deviceId))throw new DomainError(rawSave?'FORBIDDEN':'NOT_FOUND',rawSave?'Guest registration belongs to a different signed-in workspace. Reopen the form before continuing.':'Guest operation was not found in this operator/outlet scope.',rawSave?403:404);
}
export async function readGuestRegistrationPolicy(client:PoolClient,session:ApiSession):Promise<GuestRegistrationPolicy>{
  const result=await client.query('SELECT version,policy FROM hospitality.guest_registration_policies WHERE tenant_id=$1 AND outlet_id=$2',[session.tenantId,session.outletId]);
  return result.rowCount?{...defaultPolicy,...result.rows[0].policy,version:Number(result.rows[0].version),requireIdentityForAllAdults:true}:{...defaultPolicy,acceptedDocumentTypes:[...documentTypes]};
}
export async function guestRegistrationPolicy(operator:ApiSession){return inTransaction(async client=>{const session=await revalidateOperator(client,operator);privateAccess(session);return {policy:await readGuestRegistrationPolicy(client,session)};});}
async function load(client:PoolClient,session:ApiSession,registrationId:string,lock=false){
  const result=await client.query(`SELECT g.*,(SELECT r.version FROM hospitality.reservations r WHERE r.tenant_id=g.tenant_id AND r.outlet_id=g.outlet_id AND r.id=g.reservation_id) reservation_version FROM hospitality.guest_registrations g WHERE g.tenant_id=$1 AND g.outlet_id=$2 AND g.id=$3${lock?' FOR UPDATE OF g':''}`,[session.tenantId,session.outletId,registrationId]);
  if(!result.rowCount)throw new DomainError('NOT_FOUND','Guest registration was not found at this outlet.',404);
  const occupants=await client.query(`SELECT *,to_char(document_expires_on,'YYYY-MM-DD') expires_on FROM hospitality.guest_registration_occupants WHERE tenant_id=$1 AND outlet_id=$2 AND registration_id=$3 ORDER BY is_primary DESC,kind,id`,[session.tenantId,session.outletId,registrationId]);
  return {row:result.rows[0] as Row,occupants:occupants.rows as Row[]};
}
function masked(row:Row):GuestIdentityView{return {documentType:row.document_type??null,issuingCountry:row.issuing_country?.trim()??null,expiresOn:row.expires_on??null,maskedNumber:row.document_ciphertext?'••••'+row.document_suffix:null,verified:Boolean(row.verified_at),verifiedAt:row.verified_at?new Date(row.verified_at).toISOString():null};}
function missing(row:Row,occupants:Row[],policy:GuestRegistrationPolicy,today:string){
  const fields:string[]=[];if(!policy.reviewed)fields.push('policy.reviewed');
  if(row.data_erased_at)fields.push('registration.retainedData');
  for(const o of occupants){const prefix=`occupants.${o.id}`;const d=o.details as GuestOccupantFields;
    if(!d.fullName)fields.push(prefix+'.fullName');
    if(o.kind==='ADULT'){
      if(!o.document_ciphertext||!o.document_type||!o.issuing_country)fields.push(prefix+'.identity');
      else if(!policy.acceptedDocumentTypes.includes(o.document_type))fields.push(prefix+'.identity.documentType');
      if(!o.verified_at)fields.push(prefix+'.identity.verified');
      if(o.expires_on&&o.expires_on<today)fields.push(prefix+'.identity.expiresOn');
      if(policy.requirePassportExpiry&&o.document_type==='PASSPORT'&&!o.expires_on)fields.push(prefix+'.identity.expiresOn');
      if(policy.requireNationality&&!d.nationality)fields.push(prefix+'.nationality');
      if(policy.requireResidence&&(!d.residenceCountry||!d.residenceCity))fields.push(prefix+'.residence');
    }
  }
  return fields;
}
async function localToday(client:PoolClient,session:ApiSession){const result=await client.query("SELECT to_char(now() AT TIME ZONE time_zone,'YYYY-MM-DD') today FROM core.outlets WHERE tenant_id=$1 AND id=$2",[session.tenantId,session.outletId]);return result.rows[0].today as string;}
async function view(client:PoolClient,session:ApiSession,registrationId:string):Promise<GuestRegistrationView>{
  const {row,occupants}=await load(client,session,registrationId),policy=await readGuestRegistrationPolicy(client,session);
  return {id:row.id,version:Number(row.version),status:row.status,reservationId:row.reservation_id,reservationVersion:row.reservation_version===null?null:Number(row.reservation_version),stayId:row.stay_id,policyVersion:Number(row.policy_version),adultCount:row.adult_count,childCount:row.child_count,booker:{...emptyBooker,...row.booker},emergencyContact:{...emptyEmergency,...row.emergency_contact},occupants:occupants.map(o=>({...emptyOccupantDetails,...o.details,id:o.id,kind:o.kind,primary:o.is_primary,guardianId:o.guardian_id,identity:masked(o)})),missingFields:missing(row,occupants,policy,await localToday(client,session)),dataErasedAt:row.data_erased_at?new Date(row.data_erased_at).toISOString():null};
}
export async function getGuestRegistration(operator:ApiSession,registrationId:string){id(registrationId,'registrationId');return inTransaction(async client=>{const session=await revalidateOperator(client,operator);privateAccess(session);return {registration:await view(client,session,registrationId)};});}
function normalizeDetails(value:unknown):GuestRegistrationInput{
  const input=record(value,['adultCount','childCount','booker','emergencyContact','occupants'],'Guest details');
  const adultCount=integer(input.adultCount,'adultCount',1),childCount=integer(input.childCount,'childCount');if(adultCount+childCount>100)return invalid('occupants');
  const b=record(input.booker,Object.keys(emptyBooker),'booker');const booker:GuestBooker={fullName:text(b.fullName,'booker.fullName'),phone:phone(b.phone,'booker.phone'),email:email(b.email,'booker.email'),alternativePhone:phone(b.alternativePhone,'booker.alternativePhone'),company:text(b.company,'booker.company'),bookingReference:text(b.bookingReference,'booker.bookingReference',100),arrivalTime:text(b.arrivalTime,'booker.arrivalTime',5),purpose:text(b.purpose,'booker.purpose',100),notes:text(b.notes,'booker.notes',1000),noContactReason:text(b.noContactReason,'booker.noContactReason',500)};
  if(booker.arrivalTime&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(booker.arrivalTime))return invalid('booker.arrivalTime');
  if(!booker.phone&&!booker.email&&!booker.noContactReason)return invalid('booker.noContactReason');
  const e=record(input.emergencyContact,Object.keys(emptyEmergency),'emergencyContact');const emergencyContact={name:text(e.name,'emergencyContact.name'),phone:phone(e.phone,'emergencyContact.phone'),relationship:text(e.relationship,'emergencyContact.relationship',80)};
  if(Boolean(emergencyContact.name)!==Boolean(emergencyContact.phone))return invalid('emergencyContact');
  if(!Array.isArray(input.occupants)||input.occupants.length!==adultCount+childCount)return invalid('occupants');
  const occupantKeys=['id','kind','primary','fullName','phone','email','nationality','residenceCountry','residenceCity','dateOfBirth','ageBand','guardianId','identity'];
  const occupants=input.occupants.map((raw,index)=>{const p=`occupants[${index}]`,o=record(raw,occupantKeys,p);if(!['ADULT','CHILD'].includes(o.kind as string))return invalid(p+'.kind');
    const fields:GuestOccupantFields={id:id(o.id,p+'.id'),kind:o.kind as 'ADULT'|'CHILD',primary:boolean(o.primary,p+'.primary'),fullName:text(o.fullName,p+'.fullName'),phone:phone(o.phone,p+'.phone'),email:email(o.email,p+'.email'),nationality:country(o.nationality,p+'.nationality'),residenceCountry:country(o.residenceCountry,p+'.residenceCountry'),residenceCity:text(o.residenceCity,p+'.residenceCity'),dateOfBirth:date(o.dateOfBirth,p+'.dateOfBirth'),ageBand:text(o.ageBand,p+'.ageBand',40),guardianId:o.guardianId===null?null:id(o.guardianId,p+'.guardianId')};
    if(fields.primary&&(fields.kind!=='ADULT'||!fields.fullName))return invalid(p+'.primary');
    const i=record(o.identity,['action','documentType','number','issuingCountry','expiresOn','verified'],p+'.identity',['action','verified']);if(!['KEEP','REPLACE','REMOVE'].includes(i.action as string))return invalid(p+'.identity.action');
    const identity:any={action:i.action,verified:boolean(i.verified,p+'.identity.verified')};
    if(i.action==='REMOVE'&&identity.verified)return invalid(p+'.identity.verified');
    if(i.action==='REPLACE'){
      if(!documentTypes.includes(i.documentType as GuestDocumentType))return invalid(p+'.identity.documentType');
      const number=text(i.number,p+'.identity.number',64,true);if(!/^[\p{L}\p{N} ._/-]+$/u.test(number)||number.includes('••')||/^\*+$/.test(number))return invalid(p+'.identity.number');
      identity.documentType=i.documentType;identity.number=number;identity.issuingCountry=country(i.issuingCountry,p+'.identity.issuingCountry');if(!identity.issuingCountry)return invalid(p+'.identity.issuingCountry');identity.expiresOn=date(i.expiresOn??'',p+'.identity.expiresOn');
    }else if(['documentType','number','issuingCountry','expiresOn'].some(key=>i[key]!==undefined))return invalid(p+'.identity');
    if(fields.kind==='CHILD'&&i.action==='REPLACE')return invalid(p+'.identity');
    if((fields.kind==='ADULT'&&fields.guardianId!==null)||(fields.kind==='CHILD'&&!fields.guardianId))return invalid(p+'.guardianId');
    return {...fields,identity};
  });
  if(new Set(occupants.map(o=>o.id)).size!==occupants.length||occupants.filter(o=>o.primary).length!==1||occupants.filter(o=>o.kind==='ADULT').length!==adultCount||occupants.filter(o=>o.kind==='CHILD').length!==childCount)return invalid('occupants');
  for(const o of occupants)if(o.kind==='CHILD'&&!occupants.some(a=>a.id===o.guardianId&&a.kind==='ADULT'))return invalid('occupants.guardianId');
  return {adultCount,childCount,booker,emergencyContact,occupants};
}
async function evidence(client:PoolClient,session:ApiSession,commandId:string,type:string,value:unknown){
  await client.query('INSERT INTO system.audit_events(id,tenant_id,outlet_id,actor_id,command_id,event_type,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[randomUUID(),session.tenantId,session.outletId,session.userId,commandId,type,JSON.stringify(value)]);
  await client.query('INSERT INTO system.transactional_outbox(id,tenant_id,command_id,event_type,payload) VALUES($1,$2,$3,$4,$5::jsonb)',[randomUUID(),session.tenantId,commandId,type,JSON.stringify(value)]);
}
async function snapshot(client:PoolClient,session:ApiSession,registrationId:string,commandId:string,reason:string){
  const {row,occupants}=await load(client,session,registrationId);
  await client.query('INSERT INTO hospitality.guest_registration_revisions(tenant_id,outlet_id,registration_id,version,command_id,actor_id,reason,private_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[session.tenantId,session.outletId,registrationId,row.version,commandId,session.userId,reason,JSON.stringify({registration:{booker:row.booker,emergencyContact:row.emergency_contact,adultCount:row.adult_count,childCount:row.child_count,status:row.status,policyVersion:Number(row.policy_version),reservationId:row.reservation_id,stayId:row.stay_id,finalizedAt:row.finalized_at},occupants})]);
}
async function storedOperation(client:PoolClient,session:ApiSession,input:GuestRegistrationOperation,mode:'status'|'replay'){
  const stored=await client.query(`SELECT c.*,d.outlet_id,m.registration_id,m.expected_version,m.reservation_id,m.expected_reservation_version,m.fenced
    FROM system.commands c JOIN identity.devices d ON d.tenant_id=c.tenant_id AND d.id=c.device_id
    LEFT JOIN system.guest_registration_operations m ON m.tenant_id=c.tenant_id AND m.command_id=c.command_id
    WHERE c.tenant_id=$1 AND c.command_id=$2 FOR UPDATE OF c`,[session.tenantId,input.commandId]);
  const row=stored.rows[0];if(!row)return null;
  requireCommandRecoveryAuthority(session,row,mode);
  if(row.command_type!==input.kind||row.registration_id!==input.registrationId||Number(row.expected_version)!==input.expectedVersion||(row.reservation_id??null)!==(input.reservationId??null)||(row.expected_reservation_version===null?null:Number(row.expected_reservation_version))!==(input.expectedReservationVersion??null))throw new DomainError('IDEMPOTENCY_MISMATCH','Recovery metadata differs from the original guest operation.',409);
  return row;
}
async function operationMetadata(client:PoolClient,session:ApiSession,input:GuestRegistrationOperation,fenced:boolean){await client.query('INSERT INTO system.guest_registration_operations(tenant_id,command_id,outlet_id,registration_id,expected_version,reservation_id,expected_reservation_version,fenced) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[session.tenantId,input.commandId,session.outletId,input.registrationId,input.expectedVersion,input.reservationId??null,input.expectedReservationVersion??null,fenced]);}
export async function reconcileGuestRegistration(operator:ApiSession,value:unknown){
  const input=operation(value) as GuestRegistrationOperation;
  return inTransaction(async client=>{const session=await revalidateOperator(client,operator);assertOperationScope(input,session);requireCommandAuthority(session,input.kind);await lockGuestRegistrationScope(client,session);
    const old=await storedOperation(client,session,input,'status');if(old)return {commandId:input.commandId,status:old.status,response:old.response};
    // A scope descriptor is checked even for a missing command before fencing.
    if(input.expectedVersion>0)await load(client,session,input.registrationId);
    if(input.reservationId){const res=await client.query('SELECT id FROM hospitality.reservations WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3',[session.tenantId,session.outletId,input.reservationId]);if(!res.rowCount)throw new DomainError('NOT_FOUND','Reservation was not found at this outlet.',404);}
    await client.query(`INSERT INTO system.commands(tenant_id,command_id,actor_id,device_id,command_type,request_hash,status,response,completed_at,authority_version,required_capabilities) VALUES($1,$2,$3,$4,$5,$6,'REJECTED',$7::jsonb,now(),1,ARRAY['hospitality'])`,[session.tenantId,input.commandId,session.userId,session.deviceId,input.kind,Buffer.alloc(0),JSON.stringify(fencedResponse)]);
    await operationMetadata(client,session,input,true);await evidence(client,session,input.commandId,'hotel.registration.operation.fenced',{registrationId:input.registrationId,expectedVersion:input.expectedVersion});
    return {commandId:input.commandId,status:'REJECTED',response:fencedResponse};
  });
}
export async function saveGuestRegistration(operator:ApiSession,value:unknown){
  const input=operation(value,true) as GuestRegistrationSave;
  assertOperationScope(input,operator,true);
  // Bind the keyed fingerprint to the original operator/outlet and full content,
  // without retaining the request or a brute-forceable document-only hash.
  let digest:Buffer;try{digest=credentialFingerprint({type:input.kind,tenantId:operator.tenantId,outletId:operator.outletId,actorId:operator.userId,deviceId:operator.deviceId,input});}catch{throw new DomainError('GUEST_IDENTITY_UNAVAILABLE','Protected guest operation recovery is not configured.',503);}
  return inTransaction(async client=>{
    const session=await revalidateOperator(client,operator);assertOperationScope(input,session,true);requireCommandAuthority(session,input.kind);await lockGuestRegistrationScope(client,session);
    const old=await storedOperation(client,session,input,'replay');if(old){if(old.fenced)return {commandId:input.commandId,...old.response};if(!Buffer.from(old.request_hash).equals(digest))throw new DomainError('IDEMPOTENCY_MISMATCH','This private operation ID was used with different content.',409);return {commandId:input.commandId,...old.response};}
    await client.query(`INSERT INTO system.commands(tenant_id,command_id,actor_id,device_id,command_type,request_hash,status,authority_version,required_capabilities) VALUES($1,$2,$3,$4,$5,$6,'EXECUTING',1,ARRAY['hospitality'])`,[session.tenantId,input.commandId,session.userId,session.deviceId,input.kind,digest]);
    await operationMetadata(client,session,input,false);await client.query('SAVEPOINT guest_registration_save');let response:Row;
    try{
      const details=normalizeDetails(input.details),policy=await readGuestRegistrationPolicy(client,session);
      const today=await localToday(client,session);if(details.occupants.some(o=>o.dateOfBirth&&o.dateOfBirth>today))return invalid('occupants.dateOfBirth');
      const existing=input.expectedVersion>0?await load(client,session,input.registrationId,true):null;
      if(existing&&Number(existing.row.version)!==input.expectedVersion)throw new DomainError('VERSION_CONFLICT','Guest registration changed. Refresh before saving.',409,{currentVersion:Number(existing.row.version)});
      if(!existing){const found=await client.query('SELECT id FROM hospitality.guest_registrations WHERE id=$1',[input.registrationId]);if(found.rowCount)throw new DomainError('VERSION_CONFLICT','Guest registration ID is already in use.',409);}
      if(existing?.row.data_erased_at)throw new DomainError('GUEST_DATA_RETIRED','This registration has reached its retention limit.',409);
      if(input.kind==='hotel.registration.correct'){if(!existing||existing.row.status!=='FINAL')throw new DomainError('VALIDATION_FAILED','Corrections require a finalized guest registration.');text(input.reason,'reason',500,true);}else if(existing?.row.status==='FINAL')throw new DomainError('REGISTRATION_FINAL','Use a reviewed correction for a checked-in registration.',409);
      if(details.occupants.some(o=>o.identity.action==='REPLACE')&&!policy.reviewed)throw new DomainError('GUEST_POLICY_REVIEW_REQUIRED','An owner must review guest identity and retention policy before collecting identity numbers.',409);
      let reservation:Row|null=null;const reservationId=existing?.row.reservation_id??input.reservationId??null;
      if(reservationId){
        if(reservationId!==input.reservationId||!input.expectedReservationVersion)throw new DomainError('VALIDATION_FAILED','Expected reservation version is required for a linked registration.');
        const res=await client.query('SELECT * FROM hospitality.reservations WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3 FOR UPDATE',[session.tenantId,session.outletId,reservationId]);reservation=res.rows[0];
        if(!reservation)throw new DomainError('NOT_FOUND','Reservation was not found at this outlet.',404);
        if(Number(reservation.version)!==input.expectedReservationVersion)throw new DomainError('VERSION_CONFLICT','Reservation changed. Refresh before saving guest details.',409,{currentVersion:Number(reservation.version)});
        if(input.kind==='hotel.registration.save'&&(reservation.status!=='CONFIRMED'||(reservation.guest_registration_id&&reservation.guest_registration_id!==input.registrationId)))throw new DomainError('VERSION_CONFLICT','Reservation no longer accepts this arrival registration.',409);
        if(input.kind==='hotel.registration.save')await assertGuestRoomCapacity(client,session,reservation.room_id,{adult_count:details.adultCount,child_count:details.childCount});
      }
      const version=input.expectedVersion+1;
      if(existing)await client.query('UPDATE hospitality.guest_registrations SET adult_count=$4,child_count=$5,booker=$6::jsonb,emergency_contact=$7::jsonb,policy_version=$8,version=$9,updated_by=$10,updated_at=now() WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3',[session.tenantId,session.outletId,input.registrationId,details.adultCount,details.childCount,JSON.stringify(details.booker),JSON.stringify(details.emergencyContact),policy.version,version,session.userId]);
      else await client.query('INSERT INTO hospitality.guest_registrations(id,tenant_id,outlet_id,reservation_id,policy_version,adult_count,child_count,booker,emergency_contact,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$10)',[input.registrationId,session.tenantId,session.outletId,reservationId,policy.version,details.adultCount,details.childCount,JSON.stringify(details.booker),JSON.stringify(details.emergencyContact),session.userId]);
      const previous=new Map((existing?.occupants??[]).map(o=>[o.id,o]));
      const changedFields=new Set<string>();
      if(!existing||stableStringify(existing.row.booker)!==stableStringify(details.booker))changedFields.add('booker');
      if(!existing||stableStringify(existing.row.emergency_contact)!==stableStringify(details.emergencyContact))changedFields.add('emergencyContact');
      if(!existing||existing.row.adult_count!==details.adultCount||existing.row.child_count!==details.childCount)changedFields.add('partyCounts');
      if((existing?.occupants??[]).some(o=>!details.occupants.some(next=>next.id===o.id)))changedFields.add('occupants.removed');
      await client.query('DELETE FROM hospitality.guest_registration_occupants WHERE tenant_id=$1 AND outlet_id=$2 AND registration_id=$3',[session.tenantId,session.outletId,input.registrationId]);
      for(const o of details.occupants){
        const identity=o.identity,oldDoc=previous.get(o.id);let protectedDoc:{ciphertext:string;keyVersion:string;suffix:string}|null=null,documentType:string|null=null,issuingCountry:string|null=null,expiresOn:string|null=null,verifiedBy:string|null=null,verifiedAt:string|null=null;
        if(identity.action==='KEEP'&&oldDoc?.document_ciphertext){protectedDoc={ciphertext:oldDoc.document_ciphertext,keyVersion:oldDoc.document_key_version,suffix:oldDoc.document_suffix};documentType=oldDoc.document_type;issuingCountry=oldDoc.issuing_country;expiresOn=oldDoc.expires_on;}
        if(identity.action==='REPLACE'){protectedDoc=protect(identity.number!,session,input.registrationId,o.id);documentType=identity.documentType!;issuingCountry=identity.issuingCountry!;expiresOn=identity.expiresOn||null;}
        if(protectedDoc&&identity.verified){verifiedBy=identity.action==='KEEP'&&oldDoc?.verified_at?oldDoc.verified_by:session.userId;verifiedAt=identity.action==='KEEP'&&oldDoc?.verified_at?new Date(oldDoc.verified_at).toISOString():new Date().toISOString();}
        const {identity:_,...privateFields}=o;
        if(!oldDoc||stableStringify(oldDoc.details)!==stableStringify(privateFields))changedFields.add('occupants.details');
        if(identity.action!=='KEEP'||Boolean(oldDoc?.verified_at)!==identity.verified)changedFields.add('occupants.identity');
        await client.query(`INSERT INTO hospitality.guest_registration_occupants(tenant_id,outlet_id,registration_id,id,kind,is_primary,details,guardian_id,document_type,issuing_country,document_expires_on,document_ciphertext,document_key_version,document_suffix,verified_by,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11::date,$12,$13,$14,$15,$16::timestamptz)`,[session.tenantId,session.outletId,input.registrationId,o.id,o.kind,o.primary,JSON.stringify(privateFields),o.guardianId,documentType,issuingCountry,expiresOn,protectedDoc?.ciphertext??null,protectedDoc?.keyVersion??null,protectedDoc?.suffix??null,verifiedBy,verifiedAt]);
      }
      if(input.kind==='hotel.registration.correct'){const final=await load(client,session,input.registrationId);const fields=missing(final.row,final.occupants,policy,await localToday(client,session));if(fields.length)throw new DomainError('GUEST_REGISTRATION_INCOMPLETE','Every adult must have verified identity details.',409,{missingFields:fields});assertDistinctAdultIdentities(final.occupants,session,input.registrationId);const stay=await client.query("SELECT room_id FROM hospitality.stays WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3 AND status='CHECKED_IN'",[session.tenantId,session.outletId,final.row.stay_id]);if(stay.rowCount)await assertGuestRoomCapacity(client,session,stay.rows[0].room_id,final.row);}
      let reservationVersion=reservation?Number(reservation.version):null;
      if(reservation&&input.kind==='hotel.registration.save'){
        const primary=details.occupants.find(o=>o.primary)!;
        const contact=details.booker.phone||details.booker.email||primary.phone||primary.email||null;
        const updated=await client.query('UPDATE hospitality.reservations SET guest_registration_id=$4,guest_name=$5,guest_contact=$6,version=version+1 WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3 RETURNING version',[session.tenantId,session.outletId,reservationId,input.registrationId,primary.fullName,contact?.slice(0,80)??null]);reservationVersion=Number(updated.rows[0].version);
      }
      await snapshot(client,session,input.registrationId,input.commandId,input.reason??'Guest registration saved');
      const result:GuestRegistrationResult={registrationId:input.registrationId,version,status:existing?.row.status??'DRAFT',policyVersion:policy.version,reservationId,reservationVersion};
      await evidence(client,session,input.commandId,input.kind,{registrationId:input.registrationId,version,status:result.status,policyVersion:policy.version,adultCount:details.adultCount,childCount:details.childCount,changedFields:[...changedFields].sort(),reasonProvided:Boolean(input.reason)});response={status:'CONFIRMED',value:result};
    }catch(error){await client.query('ROLLBACK TO SAVEPOINT guest_registration_save');if(!(error instanceof DomainError))throw error;response={status:error.code==='VERSION_CONFLICT'?'CONFLICT':'REJECTED',code:error.code,message:error.message,details:error.details};}
    await client.query('UPDATE system.commands SET status=$3,response=$4::jsonb,completed_at=now() WHERE tenant_id=$1 AND command_id=$2',[session.tenantId,input.commandId,response.status,JSON.stringify(response)]);
    return {commandId:input.commandId,...response};
  });
}
export async function revealGuestIdentity(operator:ApiSession,registrationId:string,value:unknown){
  id(registrationId,'registrationId');const input=record(value,['occupantId','reason'],'Identity reveal');id(input.occupantId,'occupantId');if(!['VERIFY_DOCUMENT','CORRECT_REGISTRATION','GUEST_REQUEST','INCIDENT_REVIEW'].includes(input.reason as string))return invalid('revealPurpose');
  return inTransaction(async client=>{const session=await revalidateOperator(client,operator);managerAccess(session);const {row,occupants}=await load(client,session,registrationId,true);if(row.data_erased_at)throw new DomainError('GUEST_DATA_RETIRED','This registration has reached its retention limit.',409);const occupant=occupants.find(o=>o.id===input.occupantId);if(!occupant?.document_ciphertext)throw new DomainError('NOT_FOUND','A retained identity document was not found.',404);const number=unprotect(occupant,session,registrationId);await client.query('INSERT INTO system.audit_events(id,tenant_id,outlet_id,actor_id,event_type,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[randomUUID(),session.tenantId,session.outletId,session.userId,'hotel.registration.identity.revealed',JSON.stringify({registrationId,occupantId:occupant.id,purposeCode:input.reason})]);return {number};});
}
export async function registrationForAllocation(client:PoolClient,session:ApiSession,envelope:CommandEnvelope,arrival:boolean,reservationId?:string){
  const registrationId=envelope.payload.registrationId;if(typeof registrationId!=='string'||!uuid.test(registrationId))throw new DomainError('GUEST_REGISTRATION_REQUIRED','Complete the guest registration before checking in. Refresh this workflow to continue.',409);
  const expected=envelope.expectedVersions[`registration:${registrationId}`];if(!Number.isSafeInteger(expected)||expected<1)throw new DomainError('VALIDATION_FAILED','Expected guest registration version is required.');
  const loaded=await load(client,session,registrationId,true),{row,occupants}=loaded;
  if(Number(row.version)!==expected||row.status!=='DRAFT'||row.data_erased_at)throw new DomainError('VERSION_CONFLICT','Guest registration changed or was already used. Refresh before continuing.',409,{currentVersion:Number(row.version)});
  if((row.reservation_id??null)!==(reservationId??null))throw new DomainError('REGISTRATION_ALREADY_BOUND','This guest registration belongs to a different reservation.',409);
  const policy=await readGuestRegistrationPolicy(client,session);
  if(arrival){const missingFields=missing(row,occupants,policy,await localToday(client,session));if(missingFields.length)throw new DomainError('GUEST_REGISTRATION_INCOMPLETE','Complete and verify identity for every adult before check-in.',409,{missingFields});assertDistinctAdultIdentities(occupants,session,registrationId);}
  const primary=occupants.find(o=>o.is_primary);if(!primary?.details.fullName)throw new DomainError('GUEST_REGISTRATION_INCOMPLETE','The primary guest name is required.',409);
  return {...loaded,policyVersion:policy.version,guestName:primary.details.fullName as string,guestContact:((row.booker.phone||row.booker.email||primary.details.phone||primary.details.email) as string)?.slice(0,80)||null};
}
export async function assertGuestRoomCapacity(client:PoolClient,session:ApiSession,roomId:string,registration:Row){
  const result=await client.query('SELECT max_adults,max_children,max_occupants FROM hospitality.rooms WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3',[session.tenantId,session.outletId,roomId]);const r=result.rows[0];if(r?.max_occupants!==null&&(registration.adult_count>r.max_adults||registration.child_count>r.max_children||registration.adult_count+registration.child_count>r.max_occupants))throw new DomainError('ROOM_CAPACITY_EXCEEDED','The guest party exceeds the reviewed room capacity.',409);return r?.max_occupants===null;
}
export async function bindGuestRegistration(client:PoolClient,session:ApiSession,envelope:CommandEnvelope,registrationId:string,reservationId:string){
  await client.query('UPDATE hospitality.guest_registrations SET reservation_id=$4,version=version+1,updated_by=$5,updated_at=now() WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3',[session.tenantId,session.outletId,registrationId,reservationId,session.userId]);await client.query('UPDATE hospitality.reservations SET guest_registration_id=$4 WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3',[session.tenantId,session.outletId,reservationId,registrationId]);await snapshot(client,session,registrationId,envelope.commandId,'Registration linked to reservation');
}
export async function finalizeGuestRegistration(client:PoolClient,session:ApiSession,envelope:CommandEnvelope,registrationId:string,stayId:string){
  const policy=await readGuestRegistrationPolicy(client,session);await client.query("UPDATE hospitality.guest_registrations SET status='FINAL',stay_id=$4,policy_version=$5,version=version+1,updated_by=$6,updated_at=now(),finalized_at=now() WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3",[session.tenantId,session.outletId,registrationId,stayId,policy.version,session.userId]);await client.query('UPDATE hospitality.stays SET guest_registration_id=$4 WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3',[session.tenantId,session.outletId,stayId,registrationId]);await snapshot(client,session,registrationId,envelope.commandId,'Arrival registration finalized');
}
export async function executeGuestRegistrationCommand(client:PoolClient,session:ApiSession,envelope:CommandEnvelope){
  await lockGuestRegistrationScope(client,session);const p=envelope.payload;
  if(envelope.type==='hotel.registration.policy.update'){
    owner(session);const input=record(p,['reviewed','acceptedDocumentTypes','requireNationality','requireResidence','requirePassportExpiry','draftRetentionDays','identityRetentionDays','privacyNotice'],'Guest policy');
    if(input.reviewed!==true||!Array.isArray(input.acceptedDocumentTypes)||!input.acceptedDocumentTypes.length||input.acceptedDocumentTypes.some(t=>!documentTypes.includes(t as GuestDocumentType))||new Set(input.acceptedDocumentTypes).size!==input.acceptedDocumentTypes.length)return invalid('acceptedDocumentTypes');
    const policy={reviewed:true,requireIdentityForAllAdults:true,acceptedDocumentTypes:input.acceptedDocumentTypes,requireNationality:boolean(input.requireNationality,'requireNationality'),requireResidence:boolean(input.requireResidence,'requireResidence'),requirePassportExpiry:boolean(input.requirePassportExpiry,'requirePassportExpiry'),draftRetentionDays:integer(input.draftRetentionDays,'draftRetentionDays',1,90),identityRetentionDays:integer(input.identityRetentionDays,'identityRetentionDays',1,3650),privacyNotice:text(input.privacyNotice,'privacyNotice',2000,true)};
    const current=await readGuestRegistrationPolicy(client,session);if(envelope.expectedVersions['guest-policy']!==current.version)throw new DomainError('VERSION_CONFLICT','Guest registration policy changed. Refresh before approving.',409,{currentVersion:current.version});
    await client.query('INSERT INTO hospitality.guest_registration_policies(tenant_id,outlet_id,version,policy,updated_by) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(tenant_id,outlet_id) DO UPDATE SET version=excluded.version,policy=excluded.policy,updated_by=excluded.updated_by,updated_at=now()',[session.tenantId,session.outletId,current.version+1,JSON.stringify(policy),session.userId]);const result={version:current.version+1,requireIdentityForAllAdults:true};await evidence(client,session,envelope.commandId,envelope.type,{...result,policy});return result;
  }
  if(envelope.type==='hotel.room.capacity.update'){
    const input=record(p,['roomId','maxAdults','maxChildren','maxOccupants','reason','legacyTransitionReason'],'Room capacity',['roomId','maxAdults','maxChildren','maxOccupants','reason']);const roomId=id(input.roomId,'roomId'),maxAdults=integer(input.maxAdults,'maxAdults',1),maxChildren=integer(input.maxChildren,'maxChildren'),maxOccupants=integer(input.maxOccupants,'maxOccupants',1);text(input.reason,'reason',500,true);if(maxAdults>maxOccupants||maxChildren>maxOccupants)return invalid('maxOccupants');if(input.legacyTransitionReason!==undefined)text(input.legacyTransitionReason,'legacyTransitionReason',500,true);
    const room=await client.query('SELECT version FROM hospitality.rooms WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3 FOR UPDATE',[session.tenantId,session.outletId,roomId]);if(!room.rowCount)throw new DomainError('NOT_FOUND','Room was not found.',404);if(envelope.expectedVersions[`room:${roomId}`]!==Number(room.rows[0].version))throw new DomainError('VERSION_CONFLICT','Room changed. Refresh before updating capacity.',409,{currentVersion:Number(room.rows[0].version)});
    const allocations=await client.query(`SELECT g.adult_count,g.child_count FROM hospitality.reservations r LEFT JOIN hospitality.guest_registrations g ON g.tenant_id=r.tenant_id AND g.outlet_id=r.outlet_id AND g.id=r.guest_registration_id WHERE r.tenant_id=$1 AND r.outlet_id=$2 AND r.room_id=$3 AND r.status='CONFIRMED' AND r.check_out_date>=(now() AT TIME ZONE $4)::date UNION ALL SELECT g.adult_count,g.child_count FROM hospitality.stays s LEFT JOIN hospitality.guest_registrations g ON g.tenant_id=s.tenant_id AND g.outlet_id=s.outlet_id AND g.id=s.guest_registration_id WHERE s.tenant_id=$1 AND s.outlet_id=$2 AND s.room_id=$3 AND s.status='CHECKED_IN'`,[session.tenantId,session.outletId,roomId,session.timeZone]);
    if(allocations.rows.some(r=>r.adult_count!==null&&(r.adult_count>maxAdults||r.child_count>maxChildren||r.adult_count+r.child_count>maxOccupants)))throw new DomainError('ROOM_CAPACITY_CONFLICT','Capacity would exclude an existing guest allocation.',409);
    if(allocations.rows.some(r=>r.adult_count===null)&&!input.legacyTransitionReason)throw new DomainError('LEGACY_OCCUPANCY_REVIEW_REQUIRED','Review unknown legacy party counts and provide a manager transition reason.',409);
    await client.query('UPDATE hospitality.rooms SET max_adults=$4,max_children=$5,max_occupants=$6,version=version+1 WHERE tenant_id=$1 AND outlet_id=$2 AND id=$3',[session.tenantId,session.outletId,roomId,maxAdults,maxChildren,maxOccupants]);const result={roomId,version:Number(room.rows[0].version)+1,maxAdults,maxChildren,maxOccupants};await evidence(client,session,envelope.commandId,envelope.type,{...result,legacyTransition:Boolean(input.legacyTransitionReason)});return result;
  }
  if(envelope.type==='hotel.registration.retention.run'){
    owner(session);record(p,['reason'],'Retention run');text(p.reason,'reason',500,true);const policy=await readGuestRegistrationPolicy(client,session);if(!policy.reviewed||!policy.identityRetentionDays)throw new DomainError('GUEST_POLICY_REVIEW_REQUIRED','Approve retention policy before running guest retention.',409);if(envelope.expectedVersions['guest-policy']!==policy.version)throw new DomainError('VERSION_CONFLICT','Retention policy changed. Review it again.',409);
    const eligible=await client.query(`SELECT g.id FROM hospitality.guest_registrations g LEFT JOIN hospitality.reservations r ON r.tenant_id=g.tenant_id AND r.outlet_id=g.outlet_id AND r.id=g.reservation_id LEFT JOIN hospitality.stays s ON s.tenant_id=g.tenant_id AND s.outlet_id=g.outlet_id AND s.id=g.stay_id WHERE g.tenant_id=$1 AND g.outlet_id=$2 AND g.data_erased_at IS NULL AND ((g.status='DRAFT' AND g.updated_at<now()-make_interval(days=>$3) AND (r.id IS NULL OR r.status IN ('CANCELLED','CHECKED_OUT') OR r.check_out_date<(now() AT TIME ZONE $5)::date)) OR (g.status='FINAL' AND s.status='CHECKED_OUT' AND s.checked_out_at<now()-make_interval(days=>$4))) FOR UPDATE OF g`,[session.tenantId,session.outletId,policy.draftRetentionDays,policy.identityRetentionDays,session.timeZone]);
    const ids=eligible.rows.map(r=>r.id);if(ids.length){await client.query("UPDATE hospitality.guest_registration_occupants SET details='{}'::jsonb,document_type=NULL,issuing_country=NULL,document_expires_on=NULL,document_ciphertext=NULL,document_key_version=NULL,document_suffix=NULL,verified_by=NULL,verified_at=NULL WHERE tenant_id=$1 AND outlet_id=$2 AND registration_id=ANY($3::uuid[])",[session.tenantId,session.outletId,ids]);await client.query("UPDATE hospitality.guest_registration_revisions SET private_snapshot='{}'::jsonb,reason='',erased_at=now() WHERE tenant_id=$1 AND outlet_id=$2 AND registration_id=ANY($3::uuid[])",[session.tenantId,session.outletId,ids]);await client.query("UPDATE hospitality.reservations SET guest_contact=NULL WHERE tenant_id=$1 AND outlet_id=$2 AND guest_registration_id=ANY($3::uuid[])",[session.tenantId,session.outletId,ids]);await client.query("UPDATE hospitality.stays SET guest_contact=NULL WHERE tenant_id=$1 AND outlet_id=$2 AND guest_registration_id=ANY($3::uuid[])",[session.tenantId,session.outletId,ids]);await client.query("UPDATE hospitality.guest_registrations SET booker='{}'::jsonb,emergency_contact='{}'::jsonb,data_erased_at=now(),updated_at=now(),version=version+1 WHERE tenant_id=$1 AND outlet_id=$2 AND id=ANY($3::uuid[])",[session.tenantId,session.outletId,ids]);}
    const result={erasedCount:ids.length,policyVersion:policy.version};await evidence(client,session,envelope.commandId,envelope.type,result);return result;
  }
  throw new DomainError('VALIDATION_FAILED','Unsupported guest registration command.');
}
