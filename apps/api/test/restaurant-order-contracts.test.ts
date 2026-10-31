import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { COMMAND_CATALOGUE, validateCommandPayload } from '../src/commandCatalogue.js';
import { assertContract } from '../src/contractValidation.js';
import { requireCommandAuthority } from '../src/commandAuthorization.js';
import { DomainError, type ApiSession, type CommandEnvelope } from '../src/contracts.js';
import { normalizeRestaurantModifiers } from '../src/restaurantOrderContracts.js';

const orderId=randomUUID(),productId=randomUUID();
const envelope=(type:string,payload:Record<string,unknown>):CommandEnvelope=>({protocolVersion:1,commandId:randomUUID(),deviceId:randomUUID(),type,occurredAt:'2026-10-29T12:00:00Z',expectedVersions:{[`order:${orderId}`]:1},payload});
const rejected=(run:()=>unknown)=>assert.throws(run,error=>error instanceof DomainError&&error.code==='VALIDATION_FAILED');
const line={productId,quantity:'1.125',modifiers:['No salt'],instructions:'Serve together'};

test('restaurant order inputs preserve hashes and reject injected prices, scope and malformed source identities',()=>{
  const examples:Record<string,Record<string,unknown>>={
    'restaurant.order.create':{tableId:null,serviceLabel:'Takeaway A'},
    'restaurant.order.save':{orderId,instructions:'Lunch service',lines:[line]},
    'restaurant.order.hold':{orderId,held:true,reason:'Wait for the guest'},
    'restaurant.order.cancel':{orderId,reason:'Unused unfired draft'},
    'restaurant.order.fire':{orderId},
  };
  for(const [type,payload] of Object.entries(examples)) {
    const input=envelope(type,payload),before=JSON.stringify(input);
    validateCommandPayload(input);assertContract(input,COMMAND_CATALOGUE[type].inputSchema);
    assert.equal(JSON.stringify(input),before,'Schema validation cannot rewrite the retained command fingerprint.');
    for(const field of ['outletId','actorId','unitPriceMinor','discountMinor','payment','stationIds'])rejected(()=>validateCommandPayload({...input,payload:{...payload,[field]:field==='unitPriceMinor'?1:randomUUID()}}));
    assert.equal(COMMAND_CATALOGUE[type].offlineMode,'ONLINE_ONLY');
    assert.ok(!COMMAND_CATALOGUE[type].effects.some(effect=>['stock','journal','sale','payment','folio'].includes(effect)));
  }
  const save=(patch:Record<string,unknown>)=>validateCommandPayload(envelope('restaurant.order.save',{orderId,instructions:'',lines:[{...line,...patch}]}));
  for(const quantity of [1,'-1','1e3','.5','1.1234567','1,000','100000000000000'])rejected(()=>save({quantity}));
  for(const productId of ['------------------------------------',[],null])rejected(()=>save({productId}));
  rejected(()=>save({lineId:randomUUID(),sellingPriceMinor:1}));
  rejected(()=>save({modifiers:['Duplicate','Duplicate']}));
  rejected(()=>save({modifiers:['Forbidden\nchoice']}));
  rejected(()=>validateCommandPayload(envelope('restaurant.order.save',{orderId,instructions:'',lines:Array.from({length:101},()=>line)})));
  rejected(()=>validateCommandPayload(envelope('restaurant.order.hold',{orderId,held:'true',reason:'Hold'})));
  rejected(()=>validateCommandPayload(envelope('restaurant.order.cancel',{orderId,reason:'   '})));
});

test('preparation choice normalization rejects whitespace duplicates without mutating retained input',()=>{
  const input=[' No salt ','Sauce separately'];
  assert.deepEqual(normalizeRestaurantModifiers(input),['No salt','Sauce separately']);
  assert.deepEqual(input,[' No salt ','Sauce separately']);
  for(const value of [['No salt',' No salt '],[''],['  '],['Bad\nchoice'],[1],Array.from({length:9},(_,index)=>String(index)),null])rejected(()=>normalizeRestaurantModifiers(value));
});

test('create, draft cancellation and fire outputs require truthful source state and durable ticket identities',()=>{
  const base={orderId,version:1,status:'DRAFT',held:false,fireRevision:0};
  const create=COMMAND_CATALOGUE['restaurant.order.create'].outputSchema,cancel=COMMAND_CATALOGUE['restaurant.order.cancel'].outputSchema,fire=COMMAND_CATALOGUE['restaurant.order.fire'].outputSchema;
  assertContract(base,create);assertContract({...base,status:'CANCELLED'},cancel);
  for(const schema of [create,cancel])for(const patch of [{held:true},{fireRevision:1},{version:0},{orderId:'wrong'}])rejected(()=>assertContract({...base,status:schema===cancel?'CANCELLED':'DRAFT',...patch},schema));
  rejected(()=>assertContract({...base,status:'FIRED'},create));rejected(()=>assertContract(base,cancel));
  const confirmed={...base,version:2,status:'FIRED',fireRevision:1,batchId:randomUUID(),ticketIds:[randomUUID(),randomUUID()],ticketType:'NEW'};
  assertContract(confirmed,fire);assertContract({...confirmed,fireRevision:2,ticketType:'ADD_ON'},fire);
  for(const patch of [{status:'DRAFT'},{status:'CANCELLED'},{held:true},{fireRevision:0},{ticketIds:[]},{ticketIds:[confirmed.ticketIds[0],confirmed.ticketIds[0]]},{batchId:'wrong'},{ticketType:'PRINTED'},{printed:true}])rejected(()=>assertContract({...confirmed,...patch},fire));
});

test('order command authority separates shared waiter tabs from station-only kitchen roles',()=>{
  const capabilities=['commerce','restaurant'];
  for(const type of ['restaurant.order.create','restaurant.order.save','restaurant.order.hold','restaurant.order.cancel','restaurant.order.fire']) {
    for(const role of ['admin','owner','manager','waiter'])assert.doesNotThrow(()=>requireCommandAuthority({role,capabilities} as ApiSession,type));
    for(const role of ['cook','bartender','cashier','accountant','storekeeper','receptionist','housekeeper'])assert.throws(()=>requireCommandAuthority({role,capabilities} as ApiSession,type),error=>error instanceof DomainError&&error.code==='FORBIDDEN');
    for(const capabilities of [['commerce'],['restaurant'],[]])assert.throws(()=>requireCommandAuthority({role:'waiter',capabilities} as ApiSession,type),error=>error instanceof DomainError&&error.code==='CAPABILITY_DISABLED');
  }
});

test('kitchen state commands are online-only, server-versioned and restricted to preparation roles',()=>{
  const ticketId=randomUUID(),base={protocolVersion:1 as const,commandId:randomUUID(),deviceId:randomUUID(),occurredAt:'2026-10-30T11:00:00Z',expectedVersions:{['ticket:'+ticketId]:1}};
  const payload={ticketId,fromStatus:'NEW',toStatus:'ACKNOWLEDGED'};
  const command={...base,type:'restaurant.ticket.advance',payload};
  validateCommandPayload(command);assertContract(command,COMMAND_CATALOGUE[command.type].inputSchema);
  assertContract({ticketId,version:2,status:'ACKNOWLEDGED',changedAt:'2026-10-30T11:00:00.000Z'},COMMAND_CATALOGUE[command.type].outputSchema);
  for(const bad of [{...payload,ignored:true},{...payload,toStatus:'SERVED'},{...payload,fromStatus:'READY'},{...payload,ticketId:'bad'}])assert.throws(()=>validateCommandPayload({...command,payload:bad}),DomainError);
  for(const role of ['admin','owner','manager','cook','bartender'])assert.doesNotThrow(()=>requireCommandAuthority({role,capabilities:['commerce','restaurant']} as ApiSession,command.type));
  for(const role of ['waiter','cashier','accountant','storekeeper'])assert.throws(()=>requireCommandAuthority({role,capabilities:['commerce','restaurant']} as ApiSession,command.type),error=>error instanceof DomainError&&error.code==='FORBIDDEN');
  for(const capabilities of [['commerce'],['restaurant'],[]])assert.throws(()=>requireCommandAuthority({role:'cook',capabilities} as ApiSession,command.type),error=>error instanceof DomainError&&error.code==='CAPABILITY_DISABLED');
});
