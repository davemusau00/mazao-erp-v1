import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { isCountEvidenceEvent, isCountLineEvidence, isCountMovementPage, isCountReview } from '../../../src/utils/countRecovery.js';
import type { CountReview } from '../../../src/types/countRecovery.js';

function fixture():CountReview{
  const countId=randomUUID(),productId=randomUUID();
  return {countId,status:'OPEN',countVersion:3,revision:1,fingerprint:'a'.repeat(64),coverage:'COMPLETE',canReview:true,blockers:[],unchangedLineCount:1,changedLines:[{
    productId,sku:'COUNT-A',name:'Count item',unit:'each',newItem:false,reviewable:true,changeReasons:['BALANCE_CHANGED'],
    previous:{expectedQuantity:'10',expectedBalanceVersion:2,baselineRevision:1,reviewedProductVersion:1,countedQuantity:'9',varianceReason:'Earlier physical shortage',countedBy:randomUUID(),countedAt:'2026-10-27T08:00:00Z',countedRevision:1},
    current:{quantity:'8',balanceVersion:3,productVersion:1,itemKind:'STOCKED_GOOD',active:true,movementThrough:'9007199254740995'},
    movements:[{id:randomUUID(),sequence:'9007199254740995',timestamp:'2026-10-27T08:10:00Z',type:'SALE',quantity:'-2',commandId:randomUUID(),referenceId:null,documentReference:null}],
    movementPage:{coverage:'SINCE_BASELINE',lowerExclusive:'9007199254740993',upperInclusive:'9007199254740995',totalCount:1,limit:10,nextCursor:null,hasMore:false},
  }]};
}

test('count review reads retain decimal-string movement boundaries beyond safe Number precision',()=>{
  const review=fixture();assert.equal(isCountReview(review,review.countId),true);
  assert.equal(review.changedLines[0].current.movementThrough,'9007199254740995');
  for(const candidate of [{...review,countId:randomUUID()},{...review,fingerprint:''},{...review,canReview:true,blockers:['INELIGIBLE_ITEMS']},{...review,changedLines:[review.changedLines[0],review.changedLines[0]]}])assert.equal(isCountReview(candidate,review.countId),false);
  const line=review.changedLines[0];
  for(const changed of [{...line,current:{...line.current,balanceVersion:null}},{...line,current:{...line.current,movementThrough:9007199254740995}},{...line,movements:[{...line.movements[0],sequence:'9007199254740993'}]},{...line,previous:{...line.previous,countedQuantity:9}}])assert.equal(isCountReview({...review,changedLines:[changed]},review.countId),false);
});

test('movement pages reject inconsistent continuation and boundaries without coercion',()=>{
  const page=fixture().changedLines[0].movementPage;assert.equal(isCountMovementPage(page),true);
  for(const candidate of [{...page,hasMore:true,nextCursor:null},{...page,upperInclusive:'1'},{...page,lowerExclusive:0},{...page,totalCount:'1'},{...page,limit:0}])assert.equal(isCountMovementPage(candidate),false);
});

test('saved count evidence requires typed quantities and explicit legacy coverage facts',()=>{
  const review=fixture(),line=review.changedLines[0];
  const evidence={productId:line.productId,sku:line.sku,name:line.name,unit:line.unit,expectedQuantity:'10',expectedBalanceVersion:2,baselineRevision:1,reviewedProductVersion:null,countedQuantity:'9',varianceReason:'Saved variance',countedBy:randomUUID(),countedAt:'2026-10-27T08:00:00Z',countedRevision:1,movementAfter:null,requiresRecount:false};
  assert.equal(isCountLineEvidence(evidence),true);
  assert.equal(isCountLineEvidence({...evidence,countedQuantity:9}),false);
  const event={id:randomUUID(),eventType:'LEGACY_CHECKPOINT',countVersion:3,revision:1,status:'OPEN',actorId:null,actorName:'Legacy checkpoint',reason:null,createdAt:'2026-10-27T08:00:00Z',commandId:null,lineCount:1};
  assert.equal(isCountEvidenceEvent(event),true);assert.equal(isCountEvidenceEvent({...event,createdAt:'not-a-time'}),false);
});
