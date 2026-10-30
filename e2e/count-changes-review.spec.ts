import { expect, test, type Page } from '@playwright/test';
import type { BackendCommand, BackendInventoryCount } from '../src/services/apiClient';
import type { CountLineEvidence, CountReview, CountReviewMovement } from '../src/types/countRecovery';

const tenantId='30000000-0000-4000-8000-000000000001',outletId='30000000-0000-4000-8000-000000000002',userId='30000000-0000-4000-8000-000000000003',deviceId='30000000-0000-4000-8000-000000000004';
const countId='40000000-0000-4000-8000-000000000001',firstId='50000000-0000-4000-8000-000000000001',secondId='50000000-0000-4000-8000-000000000002',reviewId='60000000-0000-4000-8000-000000000001';
const savedEventId='60000000-0000-4000-8000-000000000002';
const firstMovementId='70000000-0000-4000-8000-000000000001',secondMovementId='70000000-0000-4000-8000-000000000002',movementCommandId='70000000-0000-4000-8000-000000000003';
const timestamp='2026-10-27T08:00:00Z';
type Mode='normal'|'lost'|'malformed'|'not-arrived'|'stale'|'save-conflict';

async function fixture(page:Page,options:{mode?:Mode;canApprove?:boolean;legacy?:boolean;pageFailure?:boolean;readFailure?:boolean;noChanges?:boolean;eventFailure?:boolean}={}){
  const state={mode:options.mode??'normal',posts:[] as BackendCommand[],statusBad:false,stockQuantity:options.noChanges?'10':'8',balanceVersion:options.noChanges?2:3,pageFailure:options.pageFailure??false,readFailure:options.readFailure??false,eventFailure:options.eventFailure??false,
    count:{id:countId,status:'OPEN',areaLabel:'Full shelf count',version:3,revision:1,coverage:options.legacy?'LEGACY_CHECKPOINT':'COMPLETE',baselineAt:timestamp,openedAt:timestamp,openedBy:'Count manager',postedAt:null,postedBy:null,lineCount:2,countedLineCount:2,
      lines:[{productId:firstId,sku:'COUNT-A',name:'Count item A',unit:'each',expectedQuantity:'10',expectedBalanceVersion:2,countedQuantity:'9',varianceReason:'Earlier physical shortage',countedBy:userId,countedAt:timestamp,baselineRevision:1,countedRevision:1,requiresRecount:false},
        {productId:secondId,sku:'COUNT-B',name:'Count item B',unit:'each',expectedQuantity:'5',expectedBalanceVersion:2,countedQuantity:'5',varianceReason:null,countedBy:userId,countedAt:timestamp,baselineRevision:1,countedRevision:1,requiresRecount:false}]} as BackendInventoryCount,
  };
  const canonical=new Map<string,Record<string,unknown>>();
  const movement=(id:string,sequence:string):CountReviewMovement=>({id,sequence,timestamp,type:'SALE',quantity:'-1',commandId:movementCommandId,referenceId:null,documentReference:'Sale during physical count'});
  const review=():CountReview=>({countId,status:state.count.status,countVersion:state.count.version,revision:state.count.revision!,fingerprint:state.count.version.toString(16).padStart(64,'0'),coverage:options.legacy?'LEGACY_CHECKPOINT':'COMPLETE',canReview:!options.noChanges&&!state.count.lines[0].requiresRecount,blockers:options.noChanges||state.count.lines[0].requiresRecount?['NO_CHANGED_ITEMS']:[],unchangedLineCount:options.noChanges?2:1,
    changedLines:options.noChanges||state.count.lines[0].requiresRecount?[]:[{productId:firstId,sku:'COUNT-A',name:'Count item A',unit:'each',newItem:false,reviewable:true,changeReasons:options.legacy?['LEGACY_CHECKPOINT']:['BALANCE_CHANGED','MOVEMENTS_CHANGED'],
      previous:{expectedQuantity:'10',expectedBalanceVersion:2,baselineRevision:1,reviewedProductVersion:options.legacy?null:1,countedQuantity:state.count.lines[0].countedQuantity,varianceReason:state.count.lines[0].varianceReason,countedBy:userId,countedAt:timestamp,countedRevision:1},
      current:{quantity:state.stockQuantity,balanceVersion:state.balanceVersion,productVersion:1,itemKind:'STOCKED_GOOD',active:true,movementThrough:'3'},movements:[movement(firstMovementId,'3')],movementPage:{coverage:options.legacy?'FULL_LEGACY_HISTORY':'SINCE_BASELINE',lowerExclusive:options.legacy?'0':'1',upperInclusive:'3',totalCount:2,limit:1,nextCursor:'older-item-movement',hasMore:true}}]});
  const permissions=['inventory.count','inventory.receive',...(options.canApprove===false?[]:['inventory.count.approve','catalog.manage','finance.view'])];
  await page.route('**/api/v1/**',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(path==='/api/v1/auth/me')return route.fulfill({json:{user:{id:userId,name:'Count manager',email:'count@example.invalid',role:options.canApprove===false?'storekeeper':'manager',permissions},tenant:{id:tenantId,name:'Count business',currency:'KES',timeZone:'Africa/Nairobi',capabilities:['inventory','commerce']},outlet:{id:outletId,name:'Count outlet',timeZone:'Africa/Nairobi'},deviceId,csrfToken:'count-csrf'}});
    if(path==='/api/v1/shifts/current')return route.fulfill({json:{shift:null}});
    if(path==='/api/v1/catalog/items')return route.fulfill({json:{items:state.count.lines.map(line=>({id:line.productId,sku:line.sku,name:line.name,unit:'each',currency:'KES',sellingPriceMinor:1000,costPriceMinor:100,taxRateBps:0,itemKind:'STOCKED_GOOD',stockTracked:true,quantity:line.productId===firstId?state.stockQuantity:'5',version:state.balanceVersion,productVersion:1,balanceVersion:state.balanceVersion,inventoryValueMinor:'800'}))}});
    if(path==='/api/v1/inventory/counts/current')return route.fulfill({json:{count:state.count.status==='OPEN'?state.count:null}});
    if(path==='/api/v1/inventory/counts')return route.fulfill({json:{counts:[state.count]}});
    if(path===`/api/v1/inventory/counts/${countId}`)return route.fulfill({json:{count:state.count}});
    if(path===`/api/v1/inventory/counts/${countId}/review`){if(state.readFailure){state.readFailure=false;return route.fulfill({status:503,json:{error:{code:'INTERNAL_ERROR'}}});}return route.fulfill({json:{review:review()}});}
    if(path===`/api/v1/inventory/counts/${countId}/review/movements`){if(state.pageFailure){state.pageFailure=false;return route.fulfill({status:503,json:{error:{code:'INTERNAL_ERROR'}}});}return route.fulfill({json:{productId:firstId,movements:[movement(secondMovementId,'2')],page:{...review().changedLines[0].movementPage,nextCursor:null,hasMore:false}}});}
    const event=(saved:boolean)=>({id:saved?savedEventId:reviewId,eventType:saved?'SAVED':'REVIEWED',countVersion:saved?3:4,revision:saved?1:2,status:'OPEN',actorId:userId,actorName:'Count manager',reason:saved?null:'Reviewed sales before physical recount',createdAt:timestamp,commandId:movementCommandId,lineCount:1});
    const evidence=(after:boolean):CountLineEvidence=>({productId:firstId,sku:'COUNT-A',name:'Count item A',unit:'each',expectedQuantity:after?'8':'10',expectedBalanceVersion:after?3:2,baselineRevision:after?2:1,reviewedProductVersion:1,countedQuantity:after?null:'9',varianceReason:after?null:'Earlier physical shortage',countedBy:after?null:userId,countedAt:after?null:timestamp,countedRevision:after?null:1,movementAfter:after?'3':'1',requiresRecount:after});
    if(path===`/api/v1/inventory/counts/${countId}/events`){const older=url.searchParams.has('after');return route.fulfill({json:{events:[event(older)],page:{asOf:timestamp,totalCount:2,limit:1,hasMore:!older,nextCursor:older?null:'older-count-event'}}});}
    if(path===`/api/v1/inventory/counts/${countId}/events/${reviewId}`)return route.fulfill({json:{event:event(false),lines:[{productId:firstId,before:evidence(false),after:evidence(true)}]}});
    if(path===`/api/v1/inventory/counts/${countId}/events/${savedEventId}`){if(state.eventFailure){state.eventFailure=false;return route.fulfill({status:503,json:{error:{code:'INTERNAL_ERROR'}}});}return route.fulfill({json:{event:event(true),lines:[{productId:firstId,before:{...evidence(false),countedQuantity:null,varianceReason:null,countedBy:null,countedAt:null,countedRevision:null},after:evidence(false)}]}});}
    if(path.startsWith('/api/v1/commands/')&&request.method()==='GET'){
      const commandId=path.split('/').at(-1)!,outcome=canonical.get(commandId);
      if(!outcome)return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});
      const response=state.statusBad?{...outcome,value:{...(outcome.value as object),version:state.count.version+1}}:outcome;
      return route.fulfill({json:{commandId,status:'CONFIRMED',response}});
    }
    if(path==='/api/v1/commands'&&request.method()==='POST'){
      const command=request.postDataJSON() as BackendCommand;state.posts.push(structuredClone(command));
      const previous=canonical.get(command.commandId);if(previous)return route.fulfill({json:{commandId:command.commandId,...previous}});
      if(command.type==='inventory.count.post')return route.fulfill({json:{commandId:command.commandId,status:'CONFLICT',code:'COUNT_REVIEW_REQUIRED'}});
      if(command.type==='inventory.count.save'){
        if(state.mode==='save-conflict'){state.count.version+=1;return route.fulfill({json:{commandId:command.commandId,status:'CONFLICT',code:'VERSION_CONFLICT'}});}
        for(const entry of command.payload.lines as Array<{productId:string;countedQuantity:string|null;varianceReason:string|null}>){const line=state.count.lines.find(line=>line.productId===entry.productId)!;line.countedQuantity=entry.countedQuantity;line.varianceReason=entry.varianceReason;line.requiresRecount=entry.countedQuantity===null;line.countedRevision=entry.countedQuantity===null?null:line.baselineRevision;}
        state.count.version+=1;state.count.countedLineCount=state.count.lines.filter(line=>line.countedQuantity!==null).length;
        return route.fulfill({json:{commandId:command.commandId,status:'CONFIRMED',value:{countId,version:state.count.version,status:'OPEN',lineCount:2}}});
      }
      if(command.type==='inventory.count.review'){
        if(state.mode==='not-arrived'){state.mode='normal';return route.abort('failed');}
        if(state.mode==='stale'){state.mode='normal';state.stockQuantity='7';state.balanceVersion=4;return route.fulfill({json:{commandId:command.commandId,status:'CONFLICT',code:'COUNT_REVIEW_STALE'}});}
        state.count.version+=1;state.count.revision=2;state.count.countedLineCount=1;
        Object.assign(state.count.lines[0],{expectedQuantity:state.stockQuantity,expectedBalanceVersion:state.balanceVersion,baselineRevision:2,countedQuantity:null,varianceReason:null,countedBy:null,countedAt:null,countedRevision:null,requiresRecount:true});
        const value={countId,version:state.count.version,reviewId,revision:2,affectedProductIds:[firstId]},outcome={status:'CONFIRMED',value};canonical.set(command.commandId,outcome);
        if(state.mode==='lost')return route.abort('failed');
        return route.fulfill({json:{commandId:command.commandId,...outcome,...(state.mode==='malformed'?{value:{}}:{})}});
      }
    }
    return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});
  });
  await page.goto('/');await expect(page.getByLabel('Signed in as Count manager')).toBeVisible();
  const navigation=page.getByRole('button',{name:'Count stock',exact:true});if(!await navigation.isVisible())await page.getByRole('button',{name:'More',exact:true}).click();await navigation.last().click();
  await expect(page.getByRole('heading',{name:'Outlet count in progress'})).toBeVisible();
  return state;
}

async function openReview(page:Page){await page.getByRole('button',{name:'Review stock changes',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Review changed count items'});await expect(dialog.getByRole('group',{name:'Changed item Count item A'})).toBeVisible();return dialog;}
async function acceptReview(dialog:ReturnType<Page['getByRole']>){await dialog.getByLabel('Manager review reason',{exact:true}).fill('Reviewed sales before physical recount');await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Accept baseline and require recount',exact:true}).click();}

for(const [width,height] of [[1024,600],[390,844]])test(`review keeps earlier evidence and requires only affected recounts at ${width}x${height}`,async({page},testInfo)=>{
  await page.setViewportSize({width,height});const state=await fixture(page,{pageFailure:true});
  await page.getByRole('button',{name:'Review and post',exact:true}).click();await page.getByRole('button',{name:'Post reviewed count',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Review changed count items'});await expect(dialog.getByText('Earlier reason: Earlier physical shortage',{exact:true})).toBeVisible();await expect(dialog.getByText('1 affected items · 1 unchanged saved lines will stay in the count.')).toBeVisible();
  await dialog.getByRole('button',{name:'Load more item movements',exact:true}).click();await expect(dialog.getByRole('button',{name:'Retry item movements',exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Retry item movements',exact:true}).click();await expect(dialog.getByText(/2 of 2 shown/)).toBeVisible();
  const confirm=dialog.getByRole('button',{name:'Accept baseline and require recount',exact:true});await confirm.scrollIntoViewIfNeeded();await expect(confirm).toBeInViewport();expect((await confirm.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await testInfo.attach(`count-review-${width}x${height}.png`,{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  await acceptReview(dialog);await expect(dialog).toHaveCount(0);
  const first=page.locator('article').filter({has:page.getByRole('heading',{name:'Count item A',exact:true})}),second=page.locator('article').filter({has:page.getByRole('heading',{name:'Count item B',exact:true})});
  await expect(first.getByLabel('Counted quantity',{exact:true})).toHaveValue('');await expect(first.getByLabel('Counted quantity',{exact:true})).toBeFocused();await expect(first).toContainText('Physical recount required');await expect(second.getByLabel('Counted quantity',{exact:true})).toHaveValue('5');
  const request=state.posts.find(command=>command.type==='inventory.count.review')!;expect(request.payload).toMatchObject({countId,reason:'Reviewed sales before physical recount',affectedProductIds:[firstId]});expect(request.expectedVersions).toEqual({[`count:${countId}`]:3,[`product:${firstId}`]:1,[`balance:${firstId}`]:3});expect(state.posts.filter(command=>command.type==='inventory.count.review')).toHaveLength(1);
});

test('review focus does not interrupt a counter typing before the queued focus runs',async({page})=>{
  await fixture(page);const dialog=await openReview(page);
  await dialog.getByLabel('Manager review reason',{exact:true}).fill('Reviewed sales before physical recount');await dialog.getByRole('checkbox').check();
  await page.evaluate(()=>{
    const state=window as any;
    state.queuedCountFocus=null;
    window.requestAnimationFrame=(callback:FrameRequestCallback)=>{state.queuedCountFocus=callback;return 1_000_001;};
  });
  await dialog.getByRole('button',{name:'Accept baseline and require recount',exact:true}).click();await expect(dialog).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>(window as any).queuedCountFocus!==null)).toBe(true);
  const scanner=page.getByLabel('Scan barcode or search count items',{exact:true});await scanner.fill('COUNT-A');
  await page.evaluate(()=>{const state=window as any;state.queuedCountFocus?.(performance.now());state.queuedCountFocus=null;});
  await expect(scanner).toBeFocused();
});

for(const mode of ['lost','malformed','not-arrived'] as const)test(`unknown ${mode} review retains original request across restart and resolves once`,async({page})=>{
  const state=await fixture(page,{mode});const dialog=await openReview(page);await acceptReview(dialog);
  const pending=page.getByRole('dialog',{name:'Check count review status'});await expect(pending).toContainText('Reviewed sales before physical recount');const original=structuredClone(state.posts[0]);
  await page.reload();await expect(page.getByLabel('Signed in as Count manager')).toBeVisible();const nav=page.getByRole('button',{name:'Count stock',exact:true});if(!await nav.isVisible())await page.getByRole('button',{name:'More',exact:true}).click();await nav.last().click();
  await expect(pending.getByRole('button',{name:'Check review status',exact:true})).toBeEnabled();await expect(pending).toContainText('Count item A');
  if(mode!=='not-arrived'){state.statusBad=true;await pending.getByRole('button',{name:'Check review status',exact:true}).click();await expect(pending).toBeVisible();await expect(pending.getByRole('button',{name:'Check review status',exact:true})).toBeEnabled();expect(state.posts).toEqual([original]);state.statusBad=false;}
  await pending.getByRole('button',{name:'Check review status',exact:true}).click();await expect(pending).toHaveCount(0);expect(state.posts).toEqual(mode==='not-arrived'?[original,original]:[original]);expect(state.count.version).toBe(4);
});

test('unsent entries must be saved before review and a stale save never discards them',async({page})=>{
  const state=await fixture(page,{mode:'save-conflict'});const first=page.locator('article').filter({has:page.getByRole('heading',{name:'Count item A',exact:true})});await first.getByLabel('Counted quantity',{exact:true}).fill('7');
  const dialog=await openReview(page);await dialog.getByLabel('Manager review reason',{exact:true}).fill('Review after saving edits');await dialog.getByRole('checkbox').check();await expect(dialog.getByRole('button',{name:'Accept baseline and require recount',exact:true})).toBeDisabled();await expect(dialog).toContainText('Unsent entry still in your count: 7');
  await dialog.getByRole('button',{name:'Save edits and refresh review',exact:true}).click();await expect(dialog).toContainText('saved draft changed elsewhere');await dialog.getByRole('button',{name:'Return to count',exact:true}).click();await expect(first.getByLabel('Counted quantity',{exact:true})).toHaveValue('7');expect(state.posts.map(command=>command.type)).toEqual(['inventory.count.save']);
});

test('counter sees honest legacy evidence but cannot accept a manager baseline',async({page})=>{
  await fixture(page,{canApprove:false,legacy:true});const dialog=await openReview(page);await expect(dialog).toContainText('original movement boundary is unavailable');await expect(dialog.getByText(/Full historical movements; original boundary unknown/)).toBeVisible();await expect(dialog.getByRole('button',{name:'Accept baseline and require recount',exact:true})).toBeDisabled();await expect(dialog).not.toContainText('Carrying value');await expect(dialog).toContainText('A manager must accept');
});

test('changed-item read failure preserves the draft and supports an explicit retry',async({page})=>{
  await fixture(page,{readFailure:true});await page.getByRole('button',{name:'Review stock changes',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Review changed count items'});await dialog.getByRole('button',{name:'Retry changed-item review',exact:true}).click();await expect(dialog.getByRole('group',{name:'Changed item Count item A'})).toBeVisible();await dialog.getByRole('button',{name:'Return to count',exact:true}).click();await expect(page.locator('article').filter({has:page.getByRole('heading',{name:'Count item A',exact:true})}).getByLabel('Counted quantity',{exact:true})).toHaveValue('9');
});

test('another movement invalidates the preview and requires fresh acknowledgement',async({page})=>{
  const state=await fixture(page,{mode:'stale'});const dialog=await openReview(page);await acceptReview(dialog);await expect(dialog.getByRole('checkbox')).not.toBeChecked();await expect(dialog.getByRole('button',{name:'Accept baseline and require recount',exact:true})).toBeDisabled();await expect(dialog).toContainText('Stock or this draft changed after the review opened');expect(state.posts).toHaveLength(1);
});

test('an unchanged baseline reports an empty review without clearing a saved physical variance',async({page})=>{
  const state=await fixture(page,{noChanges:true});await page.getByRole('button',{name:'Review stock changes',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Review changed count items'});await expect(dialog).toContainText('No count-relevant stock changes were found');await expect(dialog.getByRole('button',{name:'Accept baseline and require recount',exact:true})).toBeDisabled();await dialog.getByRole('button',{name:'Return to count',exact:true}).click();await expect(page.locator('article').filter({has:page.getByRole('heading',{name:'Count item A',exact:true})}).getByLabel('Counted quantity',{exact:true})).toHaveValue('9');expect(state.posts).toHaveLength(0);
});

test('earlier saved quantity and reason remain reachable through event continuation and failed-detail retry',async({page})=>{
  await fixture(page,{eventFailure:true});const review=await openReview(page);await acceptReview(review);await expect(review).toHaveCount(0);await page.getByRole('button',{name:'View details',exact:true}).click();const history=page.getByRole('dialog',{name:'Stock count details'});await history.getByRole('button',{name:'View Baseline reviewed version 4',exact:true}).click();const selected=history.getByRole('region',{name:'Selected count evidence'});await expect(selected).toContainText('Earlier physical shortage');await history.getByRole('button',{name:'Load older count evidence',exact:true}).click();await history.getByRole('button',{name:'View Count entries saved version 3',exact:true}).click();await expect(history.getByRole('button',{name:'Retry selected count evidence',exact:true})).toBeVisible();await expect(selected).toContainText('Baseline reviewed');await history.getByRole('button',{name:'Retry selected count evidence',exact:true}).click();await expect(selected).toContainText('Count entries saved');await expect(selected).toContainText('physical count 9');await expect(selected).toContainText('Earlier physical shortage');
});
