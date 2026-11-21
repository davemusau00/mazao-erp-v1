import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { apiErrorMessage, isTerminalCommandStatus, isTerminalOutcome, presentOutcome, unconfirmedActionMessage } from '../../../src/services/apiMessages.js';

test('a cancelled restaurant draft cannot retire recovery with an impossible held result', () => {
  const commandId=randomUUID(),orderId=randomUUID(),payload={orderId,reason:'Discard unfired draft'},versions={['order:'+orderId]:3};
  const confirmed={commandId,status:'CONFIRMED',value:{orderId,version:4,status:'CANCELLED',held:false,fireRevision:0}};
  assert.equal(isTerminalOutcome(confirmed,commandId,'restaurant.order.cancel',payload,versions),true);
  assert.equal(isTerminalOutcome({...confirmed,value:{...confirmed.value,held:true}},commandId,'restaurant.order.cancel',payload,versions),false);
});

test('uncertain changes direct the operator to status recovery without implying failure', () => {
  const message = unconfirmedActionMessage('/commands');
  assert.match(message, /Check its status before repeating/);
  assert.doesNotMatch(message, /no data|retry this read|command ID|server/i);
  assert.match(unconfirmedActionMessage('/auth/login'), /sign-in/);
});

test('incomplete financial acknowledgements cannot clear original recovery records', () => {
  assert.equal(isTerminalOutcome({commandId:'original',status:'CONFIRMED'},'original','sales.order.settle'),false);
  assert.equal(isTerminalOutcome({commandId:'original',status:'CONFIRMED',value:{}},'original','sales.order.settle'),false);
  assert.equal(isTerminalOutcome({commandId:'different',status:'CONFIRMED',value:{saleId:'sale'}},'original','sales.order.settle'),false);
  assert.equal(isTerminalOutcome({commandId:'original',status:'CONFIRMED',value:{saleId:'sale'}},'original','sales.order.settle'),true);
  assert.equal(isTerminalOutcome({commandId:'original',status:'REJECTED',code:'VALIDATION_FAILED'},'original'),true);
});

test('remote diagnostic messages are replaced while codes and result details remain available', () => {
  const source = { status: 'REJECTED', code: 'INTERNAL_ERROR', message: 'SELECT secret FROM database', details: { reference: 'preserved' } };
  const result = presentOutcome(source);
  assert.notEqual(result.message, source.message);
  assert.deepEqual(result.details, source.details);
  assert.equal(result.code, source.code);
  for (const status of [401, 403, 429, 500]) assert.doesNotMatch(apiErrorMessage('UNRECOGNIZED', status), /SQL|payload|command|server/i);
  assert.match(apiErrorMessage('INSUFFICIENT_STOCK'), /stock/);
  assert.match(apiErrorMessage('HTTP_429', 429), /Wait/);
});

test('catalogue acknowledgements require complete typed outcomes and preserve the submitted target',()=>{
  const confirmed=(value:Record<string,unknown>)=>({commandId:'original',status:'CONFIRMED',value});
  for(const type of ['catalog.product.update','catalog.product.set_active']){
    const input={productId:'product-a',active:false};
    assert.equal(isTerminalOutcome(confirmed({productId:'product-a',version:2,active:false}),'original',type,input),true);
    for(const value of [{},{productId:'product-a'},{productId:'product-a',version:'2',active:false},{productId:'product-b',version:2,active:false},{productId:'product-a',version:2,active:'false'}])assert.equal(isTerminalOutcome(confirmed(value),'original',type,input),false);
  }
  assert.equal(isTerminalOutcome(confirmed({productId:'product-a',version:2,active:true}),'original','catalog.product.set_active',{productId:'product-a',active:false}),false);
  for(const type of ['catalog.category.create','catalog.category.update','catalog.category.set_active']){
    assert.equal(isTerminalOutcome(confirmed({categoryId:'category-a',version:1,active:true}),'original',type),true);
    assert.equal(isTerminalOutcome(confirmed({categoryId:'category-a',version:1}),'original',type),false);
  }
  const merge={sourceCategoryId:'category-a',targetCategoryId:'category-b',sourceVersion:2,targetVersion:3,updatedProducts:0};
  assert.equal(isTerminalOutcome(confirmed(merge),'original','catalog.category.merge',{sourceCategoryId:'category-a',targetCategoryId:'category-b'}),true);
  assert.equal(isTerminalOutcome(confirmed({...merge,updatedProducts:'0'}),'original','catalog.category.merge'),false);
  assert.equal(isTerminalOutcome(confirmed({...merge,targetCategoryId:'category-c'}),'original','catalog.category.merge',{sourceCategoryId:'category-a',targetCategoryId:'category-b'}),false);
});

test('idempotency mismatches and empty rejection codes cannot resolve the original operation',()=>{
  for(const status of ['REJECTED','CONFLICT']){
    for(const code of ['', '  ', 'IDEMPOTENCY_MISMATCH', ' IDEMPOTENCY_MISMATCH '])assert.equal(isTerminalOutcome({commandId:'original',status,code},'original','catalog.product.update'),false);
    assert.equal(isTerminalOutcome({commandId:'original',status,code:'VERSION_CONFLICT'},'original','catalog.product.update'),true);
  }
});

test('item creation requires an identity and its normalized original SKU before clearing recovery',()=>{
  const check=(value:Record<string,unknown>,sku:unknown='  KEEP-001  ')=>isTerminalOutcome({commandId:'original',status:'CONFIRMED',value},'original','catalog.product.create',{sku});
  assert.equal(check({productId:'legacy-product-id',sku:'KEEP-001'}),true);
  for(const value of [{},{productId:'legacy-product-id'},{productId:'',sku:'KEEP-001'},{productId:' ',sku:'KEEP-001'},{productId:'legacy-product-id',sku:''},{productId:'legacy-product-id',sku:' '},{productId:'legacy-product-id',sku:'DIFFERENT-001'},{productId:'legacy-product-id',sku:'keep-001'}])assert.equal(check(value),false);
  assert.equal(check({productId:'legacy-product-id',sku:'KEEP-001'},1),false);
});

test('command status validates the outer envelope and preserves nested command identity',()=>{
  const value={productId:'product-a',version:2,active:true};
  const response={commandId:'original',status:'CONFIRMED',value};
  const valid={commandId:'original',status:'CONFIRMED',response};
  const check=(result:unknown)=>isTerminalCommandStatus(result,'original','catalog.product.update',{productId:'product-a'});
  assert.equal(check(valid),true);
  assert.equal(check({...valid,response:{status:'CONFIRMED',value}}),true,'legacy status responses can omit the nested ID');
  for(const result of [null, [], 'CONFIRMED', {}, {...valid,commandId:'different'}, {...valid,response:null}, {...valid,response:[]}, {...valid,response:{...response,commandId:'different'}}, {...valid,response:{...response,status:'REJECTED'}}, {...valid,response:{...response,value:{...value,productId:'product-b'}}}])assert.equal(check(result),false);
  for(const code of ['', ' ', 'IDEMPOTENCY_MISMATCH'])assert.equal(check({commandId:'original',status:'REJECTED',response:{commandId:'original',status:'REJECTED',code}}),false);
  assert.equal(check({commandId:'original',status:'CONFLICT',response:{commandId:'original',status:'CONFLICT',code:'VERSION_CONFLICT'}}),true);
});

test('kind-change acknowledgements preserve reviewed target kind and stock-tracking meaning',()=>{
  const check=(value:Record<string,unknown>,itemKind='SERVICE')=>isTerminalOutcome({commandId:'original',status:'CONFIRMED',value},'original','catalog.product.change_kind',{productId:'product-a',itemKind});
  assert.equal(check({productId:'product-a',itemKind:'SERVICE',version:2,stockTracked:false}),true);
  assert.equal(check({productId:'product-a',itemKind:'PREPARED',version:2,stockTracked:false},'PREPARED'),true);
  assert.equal(check({productId:'product-a',itemKind:'STOCKED_GOOD',version:2,stockTracked:true},'STOCKED_GOOD'),true);
  for(const value of [{},{productId:'product-b',itemKind:'SERVICE',version:2,stockTracked:false},{productId:'product-a',itemKind:'PREPARED',version:2,stockTracked:false},{productId:'product-a',itemKind:'SERVICE',version:2,stockTracked:true},{productId:'product-a',itemKind:'SERVICE',version:0,stockTracked:false},{productId:'product-a',itemKind:'SERVICE',version:2}])assert.equal(check(value),false);
});

test('count review acknowledgement proves original count version and the exact affected set', () => {
  const countId='abcdefab-1234-4abc-8def-1234567890ab',first=randomUUID(),second=randomUUID(),reviewId=randomUUID();
  const payload={countId,reason:'Reviewed live movement',reviewFingerprint:'a'.repeat(64),affectedProductIds:[first,second]};
  const expectedVersions={[`count:${countId}`]:3};
  const value={countId,version:4,reviewId,revision:2,affectedProductIds:[second,first]};
  const check=(candidate:Record<string,unknown>,versions:Record<string,number>|undefined=expectedVersions)=>isTerminalOutcome({commandId:'original',status:'CONFIRMED',value:candidate},'original','inventory.count.review',payload,versions);
  assert.equal(check(value),true,'server ordering may differ without changing the reviewed set');
  const uppercasePayload={...payload,countId:countId.toUpperCase(),affectedProductIds:[first.toUpperCase(),second.toUpperCase()]};
  assert.equal(isTerminalOutcome({commandId:'original',status:'CONFIRMED',value},'original','inventory.count.review',uppercasePayload,expectedVersions),true,'canonical UUID results must resolve valid uppercase input without changing retained intent');
  assert.equal(isTerminalOutcome({commandId:'original',status:'CONFIRMED',value},'original','inventory.count.review',uppercasePayload,{[`count:${countId.toUpperCase()}`]:3}),false,'the original expected version must use the canonical key required by the domain');
  for(const candidate of [{},{...value,countId:randomUUID()},{...value,version:3},{...value,version:5},{...value,version:'4'},{...value,reviewId:''},{...value,revision:0},{...value,affectedProductIds:[]},{...value,affectedProductIds:[first]},{...value,affectedProductIds:[first,second,randomUUID()]},{...value,affectedProductIds:[first,first]},{...value,affectedProductIds:[first,first.toUpperCase()]}])assert.equal(check(candidate),false);
  assert.equal(check(value,{}),false,'missing original expected count version cannot resolve recovery');
  assert.equal(isTerminalOutcome({commandId:'other',status:'CONFIRMED',value},'original','inventory.count.review',payload,expectedVersions),false);
  assert.equal(isTerminalCommandStatus({commandId:'original',status:'CONFIRMED',response:{status:'CONFIRMED',value}},'original','inventory.count.review',payload,expectedVersions),true);
  assert.equal(isTerminalCommandStatus({commandId:'original',status:'CONFIRMED',response:{status:'CONFIRMED',value:{...value,version:5}}},'original','inventory.count.review',payload,expectedVersions),false);
});

test('kitchen ticket recovery requires the same ticket and the next preparation state',()=>{
  const commandId=randomUUID(),ticketId=randomUUID(),payload={ticketId,fromStatus:'NEW',toStatus:'ACKNOWLEDGED'},versions={['ticket:'+ticketId]:1};
  const value={ticketId,version:2,status:'ACKNOWLEDGED',changedAt:'2026-10-31T11:23:46.938Z'};
  const check=(candidate:Record<string,unknown>)=>isTerminalOutcome({commandId,status:'CONFIRMED',value:candidate},commandId,'restaurant.ticket.advance',payload,versions);
  assert.equal(check(value),true);
  for(const candidate of [{},{...value,ticketId:randomUUID()},{...value,version:1},{...value,version:3},{...value,status:'READY'},{...value,changedAt:'not-a-date'}])assert.equal(check(candidate),false);
  assert.equal(check(value)&&isTerminalCommandStatus({commandId,status:'CONFIRMED',response:{commandId,status:'CONFIRMED',value}},commandId,'restaurant.ticket.advance',payload,versions),true);
  assert.equal(isTerminalCommandStatus({commandId,status:'CONFIRMED',response:{commandId,status:'CONFIRMED',value:{...value,version:4}}},commandId,'restaurant.ticket.advance',payload,versions),false);
});
