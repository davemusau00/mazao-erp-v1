import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { COMMAND_CATALOGUE, validateCommandPayload } from '../src/commandCatalogue.js';
import { assertContract } from '../src/contractValidation.js';
import { DomainError, ROLE_PERMISSIONS, type ApiSession, type CommandEnvelope } from '../src/contracts.js';
import { requireCommandAuthority } from '../src/commandAuthorization.js';

function source(file: string) {
  const url = new URL(`../src/${file}`, import.meta.url);
  return readFileSync(url, 'utf8');
}

function dispatchTypes() {
  const file = source('commands.ts');
  const execute = /export async function executeCommand\([^]*?\n}\r?\n/.exec(file)?.[0];
  assert.ok(execute, 'executeCommand boundary changed: update the contract drift check');
  assert.ok(execute.includes('switch (envelope.type)'), 'dispatch boundary changed: update the contract drift check');
  const result = [...execute.matchAll(/\bcase\s+'([^']+)'\s*:/g)].map(match => match[1]);
  assert.ok(result.length > 0, 'dispatch extraction must not silently pass an empty scan');
  return result.sort();
}

test('every dispatch has a catalogue contract and every command contract has a dispatch', () => {
  const actual = dispatchTypes();
  assert.equal(new Set(actual).size, actual.length, 'duplicate dispatch is invalid');
  const declared = Object.entries(COMMAND_CATALOGUE).filter(([, entry]) => entry.transport === 'commands').map(([name]) => name).sort();
  assert.deepEqual(actual, declared);
  assert.deepEqual(Object.entries(COMMAND_CATALOGUE).filter(([, entry]) => entry.transport === 'credential').map(([name]) => name).sort(), ['auth.password.change', 'staff.password.set']);
});

test('catalogue schemas, domain references and operational boundaries are complete', () => {
  for (const [name, entry] of Object.entries(COMMAND_CATALOGUE)) {
    assert.equal(entry.schemaVersion, 1, name);
    assert.equal(entry.offlineMode, 'ONLINE_ONLY', name);
    assert.ok(entry.effects.length, name);
    assert.equal(entry.inputSchema.additionalProperties, false, name);
    assert.equal(entry.outputSchema.type, 'object', name);
    const [file, handler] = entry.domainHandler.split('#');
    assert.ok(new RegExp(`\\bfunction ${handler}\\(`).test(source(file)), `${name}: missing ${entry.domainHandler}`);
    if (entry.transport === 'commands') {
      assert.equal(entry.inputSchema.properties?.type.const, name);
      assert.equal(entry.inputSchema.properties?.payload.type, 'object');
    }
  }
});

test('execution and recovery authority agree with the catalogue for every role', () => {
  const capabilities = ['commerce', 'inventory', 'hospitality'];
  for (const [name, entry] of Object.entries(COMMAND_CATALOGUE)) {
    for (const role of Object.keys(ROLE_PERMISSIONS) as Array<keyof typeof ROLE_PERMISSIONS>) {
      const session = { role, capabilities } as ApiSession;
      const allowed = entry.permissions.every(permission => ROLE_PERMISSIONS[role].includes(permission));
      for (const recovery of [false, true]) {
        if (allowed) assert.doesNotThrow(() => requireCommandAuthority(session, name, recovery));
        else assert.throws(() => requireCommandAuthority(session, name, recovery), error => error instanceof DomainError && error.code === 'FORBIDDEN');
      }
    }
    for (const capability of entry.capabilities) {
      assert.throws(() => requireCommandAuthority({ role: 'owner', capabilities: capabilities.filter(value => value !== capability) } as ApiSession, name), error => error instanceof DomainError && error.code === 'CAPABILITY_DISABLED');
    }
  }
});

test('migrated schemas reject extra fields, type coercion and malformed nested identifiers', () => {
  const base = { protocolVersion: 1, commandId: randomUUID(), deviceId: randomUUID(), occurredAt: '2026-10-20T11:00:00Z', expectedVersions: {} };
  const payloads: Record<string, Record<string, unknown>> = {
    'shift.open': { openingFloatMinor: 0 }, 'hotel.room.mark_ready': { roomId: randomUUID() },
    'auth.session.revoke': { sessionId: randomUUID(), reason: 'Operator requested sign-out' },
    'staff.sessions.revoke': { userId: randomUUID(), sessionId: randomUUID(), reason: 'Staff access ended' },
  };
  for (const [type, payload] of Object.entries(payloads)) {
    const input = { ...base, type, payload } as CommandEnvelope;
    validateCommandPayload(input);
    assertContract(input, COMMAND_CATALOGUE[type].inputSchema);
    assert.throws(() => validateCommandPayload({ ...input, payload: { ...payload, ignoredIntent: true } }), DomainError);
    for (const key of Object.keys(payload)) assert.throws(() => validateCommandPayload({ ...input, payload: { ...payload, [key]: Array.isArray(payload[key]) ? null : [] } }), DomainError);
  }
  assert.throws(() => validateCommandPayload({ ...base, type: 'shift.open', payload: { openingFloatMinor: '0' } } as unknown as CommandEnvelope), DomainError);
  assert.throws(() => validateCommandPayload({ ...base, type: 'hotel.room.mark_ready', payload: { roomId: '------------------------------------' } } as CommandEnvelope), DomainError);
});

test('session reason schemas preserve domain trimming, length and control-character rules',()=>{
  const base={protocolVersion:1 as const,commandId:randomUUID(),deviceId:randomUUID(),occurredAt:'2026-10-20T11:00:00Z',expectedVersions:{}};
  const valid=['a','a'.repeat(500),' '+ 'a'.repeat(500)+' ','\u00a0'+ 'a'.repeat(500)+'\u00a0','\u2028a\u2029','a b'];
  const invalid=['',' '.repeat(500),'a'.repeat(501),' '+ 'a'.repeat(501)+' ','a\u0000b','\ta','a\n'];
  for(const type of ['auth.session.revoke','staff.sessions.revoke']){
    const payload={sessionId:randomUUID(),...(type==='staff.sessions.revoke'?{userId:randomUUID()}:{})};
    for(const reason of valid){
      const envelope:CommandEnvelope={...base,type,payload:{...payload,reason}};
      validateCommandPayload(envelope);
      assert.equal(envelope.payload.reason,reason,'validation preserves hashed input bytes');
    }
    for(const reason of invalid)assert.throws(()=>validateCommandPayload({...base,type,payload:{...payload,reason}}),DomainError);
  }
});

test('all four migrated result schemas describe actual handler result fields',()=>{
  const id=randomUUID();
  const results:Record<string,unknown>={
    'shift.open':{shiftId:id,version:1,openingFloatMinor:0},
    'hotel.room.mark_ready':{roomId:id,status:'READY',version:2},
    'auth.session.revoke':{sessionId:id,version:2,reauthenticate:true},
    'staff.sessions.revoke':{sessionId:id,version:2,reauthenticate:false},
  };
  for(const [type,value] of Object.entries(results))assertContract(value,COMMAND_CATALOGUE[type].outputSchema);
});

test('catalogue maintenance schemas require complete reviewed metadata and reject immutable or unknown intent',()=>{
  const id=randomUUID(),target=randomUUID();
  const base={protocolVersion:1 as const,commandId:randomUUID(),deviceId:randomUUID(),occurredAt:'2026-10-25T11:00:00Z',expectedVersions:{}};
  const payloads:Record<string,Record<string,unknown>>={
    'catalog.product.update':{productId:id,name:'Tea',sellingPriceMinor:1234,costPriceMinor:275,taxRateBps:1600,category:'Pantry',barcode:null,reorderLevel:'0.25',reason:'Reviewed metadata'},
    'catalog.product.set_active':{productId:id,active:false,reason:'Discontinued'},
    'catalog.category.create':{name:'Pantry'},
    'catalog.category.update':{categoryId:id,name:'Dry pantry',reason:'Clarify label'},
    'catalog.category.set_active':{categoryId:id,active:false,reason:'No active products'},
    'catalog.category.merge':{sourceCategoryId:id,targetCategoryId:target,reason:'Reviewed duplicate label'},
  };
  for(const [type,payload] of Object.entries(payloads)){
    const entry=COMMAND_CATALOGUE[type];assert.equal(entry.validation,'SCHEMA_AND_DOMAIN');
    assert.deepEqual(entry.permissions,['catalog.manage']);assert.deepEqual(entry.capabilities,[]);assert.equal(entry.offlineMode,'ONLINE_ONLY');
    validateCommandPayload({...base,type,payload});
    for(const key of Object.keys(payload)){
      const missing={...payload};delete missing[key];
      assert.throws(()=>validateCommandPayload({...base,type,payload:missing}),DomainError,`${type} missing ${key}`);
    }
    assert.throws(()=>validateCommandPayload({...base,type,payload:{...payload,unknownIntent:true}}),DomainError);
  }
  for(const invalid of [{sku:'NEW'},{baseUnit:'kg'},{currency:'USD'},{sellingPriceMinor:'1234'},{barcode:123},{reorderLevel:'1e3'},{name:'Tea\nname'},{category:'Pantry\n'}]){
    assert.throws(()=>validateCommandPayload({...base,type:'catalog.product.update',payload:{...payloads['catalog.product.update'],...invalid}}),DomainError,JSON.stringify(invalid));
  }
  validateCommandPayload({...base,type:'catalog.product.update',payload:{...payloads['catalog.product.update'],barcode:'0000123'}});
  validateCommandPayload({...base,type:'catalog.product.update',payload:{...payloads['catalog.product.update'],category:'',barcode:null}});
  for(const type of ['catalog.category.create','catalog.category.update'])assert.throws(()=>validateCommandPayload({...base,type,payload:{...payloads[type],name:' '}}),DomainError);
});

test('reviewed kind changes have strict contracts and capability baselines defer item-specific authority',()=>{
  const productId=randomUUID(),base={protocolVersion:1 as const,commandId:randomUUID(),deviceId:randomUUID(),occurredAt:'2026-10-25T11:00:00Z',expectedVersions:{[`product:${productId}`]:1}};
  const type='catalog.product.change_kind',payload={productId,itemKind:'SERVICE',reason:'Reviewed zero-stock change'};
  validateCommandPayload({...base,type,payload});
  for(const invalid of [{itemKind:'service'},{itemKind:null},{itemKind:' SERVICE '},{active:true},{reason:''}])assert.throws(()=>validateCommandPayload({...base,type,payload:{...payload,...invalid}}),DomainError);
  for(const key of Object.keys(payload)){const missing:Record<string,unknown>={...payload};delete missing[key];assert.throws(()=>validateCommandPayload({...base,type,payload:missing}),DomainError);}
  assertContract({productId,itemKind:'SERVICE',version:2,stockTracked:false},COMMAND_CATALOGUE[type].outputSchema);
  assert.throws(()=>assertContract({productId,itemKind:'UNKNOWN',version:2,stockTracked:false},COMMAND_CATALOGUE[type].outputSchema),DomainError);
  assert.deepEqual(COMMAND_CATALOGUE[type].permissions,['catalog.manage']);
  assert.deepEqual(COMMAND_CATALOGUE[type].capabilities,[]);
  for(const [name,entry] of Object.entries(COMMAND_CATALOGUE))if(name.startsWith('catalog.'))assert.deepEqual(entry.capabilities,[],name);
  for(const name of ['sales.order.settle','sales.order.refund'])assert.deepEqual(COMMAND_CATALOGUE[name].capabilities,['commerce']);
});
