import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { BackendCommand } from '../src/services/apiClient';
import type { RestaurantConfiguration } from '../src/types/restaurant';
import type { RestaurantMenuItem, RestaurantOrder, RestaurantOrderLine, RestaurantOrderStation, RestaurantOrderTicket } from '../src/types/restaurantOrders';

const tenantId='00000000-0000-4000-8000-000000006401',outletId='00000000-0000-4000-8000-000000006402',userId='00000000-0000-4000-8000-000000006403',deviceId='00000000-0000-4000-8000-000000006404';
const tableId='00000000-0000-4000-8000-000000006405',mealId='00000000-0000-4000-8000-000000006406',drinkId='00000000-0000-4000-8000-000000006407',orderId='00000000-0000-4000-8000-000000006408';
const stamp='2026-10-29T17:00:00.000Z';
const history=(totalCount:number,more=false,cursor:string|null=null)=>({totalCount,hasMore:more,nextCursor:cursor,limit:50,asOf:stamp});
const kitchen:RestaurantOrderStation={id:'00000000-0000-4000-8000-000000006409',name:'Hot kitchen',kind:'KITCHEN',version:1,charactersPerLine:42};
const bar:RestaurantOrderStation={id:'00000000-0000-4000-8000-000000006410',name:'Service bar',kind:'BAR',version:1,charactersPerLine:42};
function amount(unit:number,quantity:string){const [whole,fraction='']=quantity.split('.');return Number((BigInt(unit)*(BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0')))+500000n)/1000000n);}
function tax(subtotal:number,bps:number){return Number((BigInt(subtotal)*BigInt(bps)+5000n)/10000n);}
function quote(id=mealId):RestaurantMenuItem{return {productId:id,productName:id===mealId?'Lunch plate':'Fresh juice',sku:id===mealId?'MEAL-1':'DRINK-1',itemKind:'STOCKED_GOOD',baseUnit:'each',currency:'KES',sellingPriceMinor:id===mealId?10000:2500,taxRateBps:1600,productVersion:1,menuVersion:1,preparationLabel:id===mealId?'Lunch plate':'Fresh juice',instructions:'Standard preparation',stationIds:[id===mealId?kitchen.id:bar.id],stations:[{...(id===mealId?kitchen:bar)}],effectiveAvailable:true};}
function emptyOrder(id=orderId,label='Garden tab'):RestaurantOrder{return {id,tableId,tableName:'Garden 4',serviceLabel:label,ownerId:userId,ownerName:'Order Waiter',currency:'KES',status:'DRAFT',held:false,version:1,fireRevision:0,lineCount:0,draftLineCount:0,subtotalMinor:0,taxMinor:0,totalMinor:0,createdAt:stamp,updatedAt:stamp,instructions:'',lines:[]};}
function savedLine(q=quote(),id:string=randomUUID()):RestaurantOrderLine{return {id,productId:q.productId,sku:q.sku,name:q.productName,itemKind:q.itemKind,baseUnit:q.baseUnit,quantity:'1',unitPriceMinor:q.sellingPriceMinor,taxRateBps:q.taxRateBps,lineSubtotalMinor:q.sellingPriceMinor,lineTaxMinor:tax(q.sellingPriceMinor,q.taxRateBps),currency:q.currency,productVersion:q.productVersion,menuVersion:q.menuVersion,preparationLabel:q.preparationLabel,preparationInstructions:q.instructions,modifiers:[],instructions:'',stations:structuredClone(q.stations),fireRevision:null,createdAt:stamp};}
function totals(order:RestaurantOrder){order.lineCount=order.lines.length;order.draftLineCount=order.lines.filter(line=>line.fireRevision===null).length;order.subtotalMinor=order.lines.reduce((sum,line)=>sum+line.lineSubtotalMinor,0);order.taxMinor=order.lines.reduce((sum,line)=>sum+line.lineTaxMinor,0);order.totalMinor=order.subtotalMinor+order.taxMinor;}
function ticket(order:RestaurantOrder,station:RestaurantOrderStation,lines:RestaurantOrderLine[],batchId=randomUUID()):RestaurantOrderTicket{
  const id=randomUUID(),type=order.fireRevision===1?'NEW':'ADD_ON';
  return {id,orderId:order.id,batchId,fireRevision:order.fireRevision,type,stationId:station.id,stationName:station.name,stationKind:station.kind,createdAt:stamp,documentHash:'a'.repeat(64),status:'NEW',stateVersion:1,stateChangedAt:stamp,stateActorName:'Order Waiter',snapshot:{schemaVersion:1,ticketId:id,batchId,orderId:order.id,fireRevision:order.fireRevision,type,station:structuredClone(station),tableId:order.tableId,tableName:order.tableName,serviceLabel:order.serviceLabel,orderInstructions:order.instructions,waiter:{id:userId,name:'Order Waiter'},firedBy:{id:userId,name:'Order Waiter'},deviceId,firedAt:stamp,originalBatchId:type==='NEW'?null:'00000000-0000-4000-8000-000000006411',lines:lines.map(line=>({lineId:line.id,productId:line.productId,sku:line.sku,name:line.name,itemKind:line.itemKind,baseUnit:line.baseUnit,quantity:line.quantity,preparationLabel:line.preparationLabel,preparationInstructions:line.preparationInstructions,modifiers:line.modifiers,instructions:line.instructions}))}};
}

async function connect(page:Page,role:'waiter'|'cook'='waiter'){
  const config:RestaurantConfiguration={sections:[],tables:[{id:tableId,name:'Garden 4',sectionId:null,seats:4,active:true,version:1}],stations:[{...kitchen,active:true},{...bar,active:true}],menuRoutes:[],stationAssignments:[],devices:[],products:[],productPage:null,permissions:{manage:false,assignDevices:false},availability:{ordering:true,fire:true,kds:false,printing:false,roomCharge:false,recipeConsumption:false},limits:{sections:100,tables:500,stations:100,menuRoutes:2000}};
  const state={orders:new Map<string,RestaurantOrder>(),menu:[quote(),quote(drinkId)],tickets:[] as RestaurantOrderTicket[],posts:[] as BackendCommand[],reads:[] as string[],results:new Map<string,Record<string,unknown>>(),loseType:'',incompleteFire:false,incompleteCancel:false,statusOverride:undefined as unknown,status404:false,readFailure:false,feedDenied:false,feedDeniedStatus:403 as 401|403,stationAccess:true,orderMore:false,menuMore:false,ticketMore:false,moreFailure:false,malformedDetail:'none' as 'none'|'missing-lines'|'foreign-ticket',
    orderOlder:emptyOrder(randomUUID(),'Older tab'),menuOlder:{...quote(drinkId),productId:randomUUID(),productName:'Older menu item'},detailGate:undefined as Promise<void>|undefined};
  const apply=(command:BackendCommand)=>{
    const p=command.payload;
    if(command.type==='restaurant.order.create'){const order=emptyOrder();order.serviceLabel=String(p.serviceLabel);order.tableId=p.tableId as string|null;order.tableName=order.tableId?'Garden 4':null;state.orders.set(order.id,order);}
    if(command.type==='restaurant.ticket.advance'){const ticket=state.tickets.find(row=>row.id===p.ticketId)!;ticket.status=String(p.toStatus) as RestaurantOrderTicket['status'];ticket.stateVersion++;ticket.stateChangedAt=new Date().toISOString();ticket.stateActorName='Order Cook';return {ticketId:ticket.id,status:ticket.status,version:ticket.stateVersion,changedAt:ticket.stateChangedAt};}
    const order=state.orders.get(String(p.orderId??orderId))!;
    if(command.type==='restaurant.order.save'){
      const lines=p.lines as Array<{lineId?:string;productId:string;quantity:string;modifiers:string[];instructions:string}>;
      order.lines=order.lines.filter(line=>line.fireRevision!==null).concat(lines.map(raw=>{const q=state.menu.find(item=>item.productId===raw.productId)??state.menuOlder;const line=savedLine(q,raw.lineId??randomUUID());line.quantity=raw.quantity;line.modifiers=raw.modifiers;line.instructions=raw.instructions;line.lineSubtotalMinor=amount(q.sellingPriceMinor,raw.quantity);line.lineTaxMinor=tax(line.lineSubtotalMinor,q.taxRateBps);return line;}));order.instructions=String(p.instructions);order.version++;totals(order);
    }
    if(command.type==='restaurant.order.hold'){order.held=Boolean(p.held);order.version++;}
    if(command.type==='restaurant.order.cancel'){order.status='CANCELLED';order.held=false;order.version++;}
    let extra:Record<string,unknown>={};
    if(command.type==='restaurant.order.fire'){
      order.version++;order.status='FIRED';order.fireRevision++;const lines=order.lines.filter(line=>line.fireRevision===null),batchId=randomUUID(),created:RestaurantOrderTicket[]=[];
      for(const station of [kitchen,bar]){const selected=lines.filter(line=>line.stations.some(value=>value.id===station.id));if(selected.length)created.push(ticket(order,station,selected,batchId));}
      for(const line of lines)line.fireRevision=order.fireRevision;state.tickets.push(...created);totals(order);extra={batchId,ticketIds:created.map(row=>row.id),ticketType:order.fireRevision===1?'NEW':'ADD_ON'};
    }
    return {orderId:order.id,version:order.version,status:order.status,held:order.held,fireRevision:order.fireRevision,...extra};
  };
  const detail=(id:string)=>{const order=state.orders.get(id)!;const tickets=state.tickets.filter(row=>row.orderId===id);return {order,currentQuotes:state.menu.filter(q=>order.lines.some(line=>line.productId===q.productId&&line.fireRevision===null)),tickets:state.ticketMore?tickets.slice(0,1):tickets,ticketPage:history(tickets.length,state.ticketMore,state.ticketMore?'tickets-next':null)};};
  await page.route('**/api/v1/**',async route=>{
    const url=new URL(route.request().url()),path=url.pathname.replace('/api/v1','');state.reads.push(path+url.search);
    if(path==='/auth/me')return route.fulfill({json:{user:{id:userId,name:role==='cook'?'Order Cook':'Order Waiter',email:'orders@example.invalid',role,permissions:['restaurant.view',...(role==='cook'?['restaurant.ticket.view','restaurant.ticket.work']:['restaurant.order.view','restaurant.order'])]},tenant:{id:tenantId,name:'Order browser business',currency:'KES',timeZone:'Africa/Nairobi',capabilities:['commerce','restaurant','inventory']},outlet:{id:outletId,name:'Dining outlet',timeZone:'Africa/Nairobi'},deviceId,csrfToken:'order-csrf'}});
    if(path==='/restaurant/configuration')return route.fulfill({json:{configuration:config}});
    if(state.readFailure&&route.request().method()==='GET'&&!path.startsWith('/commands/'))return route.fulfill({status:503,json:{error:{code:'INTERNAL_ERROR'}}});
    if(path==='/restaurant/menu')return route.fulfill({json:{menu:url.searchParams.has('after')||url.searchParams.has('q')?[state.menuOlder]:state.menu,page:history(state.menu.length+(state.menuMore?1:0),state.menuMore&&!url.searchParams.has('after')&&!url.searchParams.has('q'),state.menuMore&&!url.searchParams.has('after')&&!url.searchParams.has('q')?'menu-next':null)}});
    if(path==='/restaurant/orders'){
      if(state.moreFailure&&url.searchParams.has('after'))return route.fulfill({status:503,json:{error:{code:'INTERNAL_ERROR'}}});
      return route.fulfill({json:{orders:url.searchParams.has('after')||url.searchParams.has('q')?[state.orderOlder]:[...state.orders.values()],page:history(state.orders.size+(state.orderMore?1:0),state.orderMore&&!url.searchParams.has('after')&&!url.searchParams.has('q'),state.orderMore&&!url.searchParams.has('after')&&!url.searchParams.has('q')?'orders-next':null)}});
    }
    if(/^\/restaurant\/orders\/[^/]+$/.test(path)){
      const id=path.split('/').at(-1)!,captured=structuredClone(detail(id));
      if(state.malformedDetail==='missing-lines')captured.order.lines=[];
      if(state.malformedDetail==='foreign-ticket')for(const row of captured.tickets){const foreignOrderId='00000000-0000-4000-8000-000000006499';row.orderId=foreignOrderId;row.snapshot.orderId=foreignOrderId;row.snapshot.orderInstructions='Foreign ticket detail must stay hidden';}
      if(state.detailGate)await state.detailGate;return route.fulfill({json:captured}).catch(()=>{});
    }
    if(/^\/restaurant\/orders\/[^/]+\/tickets$/.test(path)){const id=path.split('/')[3];return route.fulfill({json:{tickets:state.tickets.filter(row=>row.orderId===id).slice(url.searchParams.has('after')?1:0,url.searchParams.has('after')?undefined:state.ticketMore?1:undefined),page:history(state.tickets.length,false)}});}
    if(path==='/restaurant/ticket-stations')return route.fulfill({json:{stations:state.stationAccess?[kitchen]:[],authority:'LOGICAL_ASSIGNMENT'}});
    if(path.startsWith('/restaurant/stations/')){
      if(state.feedDenied)return route.fulfill({status:state.feedDeniedStatus,json:{error:{code:state.feedDeniedStatus===401?'UNAUTHENTICATED':'FORBIDDEN'}}});
      const tickets=state.tickets.filter(row=>row.stationId===kitchen.id);return route.fulfill({json:{tickets:state.ticketMore&&!url.searchParams.has('after')?tickets.slice(0,1):url.searchParams.has('after')?tickets.slice(1):tickets,page:history(tickets.length,state.ticketMore&&!url.searchParams.has('after'),state.ticketMore&&!url.searchParams.has('after')?'station-next':null)}});
    }
    if(path==='/commands'){
      const command=route.request().postDataJSON() as BackendCommand;state.posts.push(command);
      const current=state.orders.get(String(command.payload.orderId));
      if(!state.results.has(command.commandId)&&current&&command.expectedVersions['order:'+current.id]!==current.version)return route.fulfill({json:{commandId:command.commandId,status:'CONFLICT',code:'VERSION_CONFLICT'}});
      if(!state.results.has(command.commandId)&&command.type==='restaurant.ticket.advance'){const target=state.tickets.find(ticket=>ticket.id===command.payload.ticketId);if(target&&command.expectedVersions['ticket:'+target.id]!==target.stateVersion)return route.fulfill({json:{commandId:command.commandId,status:'CONFLICT',code:'VERSION_CONFLICT'}});}
      if(!state.results.has(command.commandId))state.results.set(command.commandId,apply(command));
      if(state.loseType===command.type)return route.abort('failed');
      const value=state.incompleteFire&&command.type==='restaurant.order.fire'?{}:state.incompleteCancel&&command.type==='restaurant.order.cancel'?{...state.results.get(command.commandId),held:true}:state.results.get(command.commandId);
      return route.fulfill({json:{commandId:command.commandId,status:'CONFIRMED',value}});
    }
    if(path.startsWith('/commands/')){if(state.status404)return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});const id=path.split('/').at(-1)!;return route.fulfill({json:state.statusOverride??{commandId:id,status:'CONFIRMED',response:{commandId:id,status:'CONFIRMED',value:state.results.get(id)}}});}
    return route.fulfill({status:404,json:{error:{code:'UNEXPECTED_TEST_ENDPOINT',message:path}}});
  });return state;
}
async function openService(page:Page,role='Waiter'){
  await page.goto('/');await expect(page.getByLabel('Signed in as Order '+role)).toBeVisible();const button=page.getByRole('button',{name:/Tables & kitchen/});if(!await button.first().isVisible())await page.getByRole('button',{name:'More',exact:true}).click();await button.last().click();await expect(page.getByRole('heading',{name:role==='Cook'?'Station tickets':'Restaurant orders',exact:true})).toBeVisible();
}
async function create(page:Page,label='Garden tab'){
  await page.getByRole('button',{name:'Start order at Garden 4',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Start table order',exact:true});await dialog.getByLabel('Tab label',{exact:true}).fill(label);await dialog.getByRole('button',{name:'Create order',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('heading',{name:'Garden 4 · '+label,exact:true})).toBeVisible();
}
async function save(page:Page){await page.getByRole('button',{name:'Save order draft',exact:true}).click();await expect(page.getByRole('button',{name:'Save order draft',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Fire order',exact:true})).toBeEnabled();}
async function fire(page:Page){await page.getByRole('button',{name:'Fire order',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Create station tickets',exact:true});await dialog.getByRole('button',{name:'Create station tickets',exact:true}).click();return dialog;}
async function journal(page:Page){return page.evaluate(async()=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('mazao-v1-command-journal',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});try{return await new Promise<Array<{command:BackendCommand}>>((resolve,reject)=>{const request=db.transaction('commands').objectStore('commands').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}finally{db.close();}});}

test('waiter creates saves holds resumes and fires one station batch then a distinct add-on without payment authority',async({page})=>{
  const state=await connect(page);await openService(page);await create(page);await page.getByRole('button',{name:'Add menu item Lunch plate',exact:true}).click();await page.getByRole('button',{name:'Add menu item Fresh juice',exact:true}).click();const meal=page.getByRole('article',{name:'Draft line 1 Lunch plate',exact:true});await meal.getByLabel('Quantity',{exact:true}).fill('2');await meal.getByLabel('Item preparation notes',{exact:true}).fill('Sauce separate');await meal.getByLabel('Preparation choices (one per line, up to eight)',{exact:true}).fill('No chilli\nExtra salad');await page.getByLabel('Order notes',{exact:true}).fill('Serve together');await save(page);
  const ids=state.orders.get(orderId)!.lines.map(row=>row.id);await page.getByRole('button',{name:'Hold order',exact:true}).click();let dialog=page.getByRole('dialog',{name:'Hold order',exact:true});await dialog.getByLabel('Reason',{exact:true}).fill('Guests not ready');await dialog.getByRole('button',{name:'Hold order',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'Fire order',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Resume order',exact:true}).click();dialog=page.getByRole('dialog',{name:'Resume order',exact:true});await dialog.getByLabel('Reason',{exact:true}).fill('Guests ready');await dialog.getByRole('button',{name:'Resume order',exact:true}).click();await expect(dialog).toHaveCount(0);
  dialog=await fire(page);await expect(dialog).toHaveCount(0);expect(state.tickets).toHaveLength(2);expect(state.tickets.every(row=>row.type==='NEW')).toBe(true);expect(state.orders.get(orderId)!.lines.map(row=>row.id)).toEqual(ids);const original=structuredClone(state.tickets);await expect(page.getByRole('heading',{name:'Fired lines · read only',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Discard draft order',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Remove draft line 1',exact:true})).toHaveCount(0);
  state.menu[0]={...state.menu[0],productName:'Repriced lunch plate',sellingPriceMinor:12000,productVersion:2};await page.getByRole('button',{name:'Refresh orders',exact:true}).click();await expect(page.getByRole('button',{name:'Add menu item Repriced lunch plate',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Add menu item Repriced lunch plate',exact:true}).click();await save(page);dialog=await fire(page);await expect(dialog).toHaveCount(0);expect(state.tickets).toHaveLength(3);expect(state.tickets[2].type).toBe('ADD_ON');expect(state.tickets.slice(0,2)).toEqual(original);expect(state.tickets[2].snapshot.lines[0].lineId).not.toBe(ids[0]);expect(state.orders.get(orderId)!.lines[0].unitPriceMinor).toBe(10000);expect(state.orders.get(orderId)!.lines[2].unitPriceMinor).toBe(12000);
  await expect(page.getByRole('button',{name:/^(Print|Take payment|Confirm payment|Mark ready|Serve order|Charge room)/})).toHaveCount(0);expect(state.posts.every(command=>command.type.startsWith('restaurant.order.'))).toBe(true);expect(await journal(page)).toEqual([]);
});

test('lost fire acknowledgement survives reload and incomplete matching results retain the exact original command',async({page})=>{
  const state=await connect(page);await openService(page);await create(page);await page.getByRole('button',{name:'Add menu item Lunch plate',exact:true}).click();await save(page);state.loseType='restaurant.order.fire';let dialog=await fire(page);await expect(dialog.getByRole('button',{name:'Check order action status',exact:true})).toBeEnabled();const original=structuredClone(state.posts.at(-1)!);const value=state.results.get(original.commandId)!;
  for(const bad of [{},{...value,ticketIds:[]},{...value,batchId:'missing-batch'},{...value,ticketType:'ADD_ON'}]){state.statusOverride={commandId:original.commandId,status:'CONFIRMED',response:{commandId:original.commandId,status:'CONFIRMED',value:bad}};await dialog.getByRole('button',{name:'Check order action status',exact:true}).click();await expect(dialog.getByRole('button',{name:'Check order action status',exact:true})).toBeEnabled();expect((await journal(page)).map(row=>row.command)).toEqual([original]);}
  await page.reload();await openService(page);await expect(page.getByRole('button',{name:'Check order action status',exact:true})).toBeEnabled();state.statusOverride=undefined;await page.getByRole('button',{name:'Check order action status',exact:true}).click();await expect(page.getByRole('heading',{name:'Fired lines · read only',exact:true})).toBeVisible();expect(state.posts.filter(row=>row.type==='restaurant.order.fire')).toEqual([original]);expect(state.tickets).toHaveLength(1);expect(await journal(page)).toEqual([]);
});

test('a cancellation acknowledgement with an impossible held state retains its original command until valid status recovery',async({page})=>{
  const state=await connect(page);await openService(page);await create(page);
  state.incompleteCancel=true;
  await page.getByRole('button',{name:'Discard draft order',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Discard draft order',exact:true});
  await dialog.getByLabel('Reason',{exact:true}).fill('Guests left before ordering');
  await dialog.getByRole('button',{name:'Discard draft order',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Check order action status',exact:true})).toBeEnabled();
  const original=structuredClone(state.posts.at(-1)!);
  expect(original.type).toBe('restaurant.order.cancel');
  expect((await journal(page)).map(row=>row.command)).toEqual([original]);
  await expect(page.getByRole('button',{name:'Start order at Garden 4',exact:true})).toBeDisabled();
  expect(state.results.get(original.commandId)).toMatchObject({status:'CANCELLED',held:false,fireRevision:0});
  state.incompleteCancel=false;
  await dialog.getByRole('button',{name:'Check order action status',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({hasText:'Unfired draft order discarded.'})).toBeVisible();
  expect(await journal(page)).toEqual([]);
  expect(state.posts.filter(command=>command.type==='restaurant.order.cancel')).toEqual([original]);
  expect(state.orders.get(orderId)!.status).toBe('CANCELLED');
});

test('a never-received status retries the original fire envelope and cannot create a second batch',async({page})=>{
  const state=await connect(page);await openService(page);await create(page);await page.getByRole('button',{name:'Add menu item Lunch plate',exact:true}).click();await save(page);state.loseType='restaurant.order.fire';const dialog=await fire(page);await expect(dialog.getByRole('button',{name:'Check order action status',exact:true})).toBeEnabled();const original=structuredClone(state.posts.at(-1)!);state.loseType='';state.status404=true;await dialog.getByRole('button',{name:'Check order action status',exact:true}).click();await expect(dialog).toHaveCount(0);expect(state.posts.filter(row=>row.type==='restaurant.order.fire')).toEqual([original,original]);expect(state.tickets).toHaveLength(1);
});

test('two lines of one item require a consistent explicit review before adopting changed menu prices',async({page})=>{
  const state=await connect(page);await openService(page);await create(page);await page.getByRole('button',{name:'Add menu item Lunch plate',exact:true}).click();await save(page);const originalId=state.orders.get(orderId)!.lines[0].id;state.menu[0]={...state.menu[0],productVersion:2,sellingPriceMinor:12000};await page.getByRole('button',{name:'Refresh orders',exact:true}).click();await expect(page.getByText(/Menu prices, availability or station routing changed/)).toBeVisible();await page.getByRole('button',{name:'Add menu item Lunch plate',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:/different reviewed menu or station details/})).toBeVisible();await expect(page.getByRole('button',{name:'Save order draft',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Review current menu prices',exact:true}).click();await expect(page.getByRole('button',{name:'Save order draft',exact:true})).toBeEnabled();await save(page);const command=state.posts.at(-1)!;expect(command.expectedVersions['product:'+mealId]).toBe(2);expect(command.expectedVersions['order:'+orderId]).toBe(2);expect(state.orders.get(orderId)!.lines.map(row=>row.unitPriceMinor)).toEqual([12000,12000]);expect(state.orders.get(orderId)!.lines[0].id).toBe(originalId);
});

test('reconnect preserves unsaved draft text and the originally opened shared-order version',async({page,context})=>{
  const state=await connect(page);await openService(page);await create(page);
  await page.getByRole('button',{name:'Add menu item Lunch plate',exact:true}).click();await save(page);
  const notes=page.getByRole('article',{name:'Draft line 1 Lunch plate',exact:true}).getByLabel('Item preparation notes',{exact:true});
  await notes.fill('Keep original review');state.orders.get(orderId)!.version=5;
  await context.setOffline(true);await expect(page.getByRole('button',{name:'Save order draft',exact:true})).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByRole('alert').filter({hasText:/shared order changed elsewhere/})).toBeVisible();
  await expect(notes).toHaveValue('Keep original review');
  await page.getByRole('button',{name:'Save order draft',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:/order or its menu details changed elsewhere/})).toBeVisible();
  const saves=state.posts.filter(command=>command.type==='restaurant.order.save');
  expect(saves).toHaveLength(2);expect(saves.at(-1)!.expectedVersions['order:'+orderId]).toBe(2);
});

test('offline and failed authoritative reads block new orders saves and fire until fresh reads succeed',async({page,context})=>{
  const state=await connect(page);await openService(page);await create(page);await page.getByRole('button',{name:'Add menu item Lunch plate',exact:true}).click();await save(page);await context.setOffline(true);await expect(page.getByRole('alert').filter({hasText:/Reconnect and refresh before saving or firing/})).toBeVisible();await expect(page.getByRole('button',{name:'Fire order',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Start order at Garden 4',exact:true})).toBeDisabled();state.readFailure=true;await context.setOffline(false);await expect(page.getByRole('alert').filter({hasText:/temporarily unavailable/}).first()).toBeVisible();await expect(page.getByRole('button',{name:'Fire order',exact:true})).toBeDisabled();expect(state.posts.filter(row=>row.type==='restaurant.order.fire')).toHaveLength(0);state.readFailure=false;await page.getByRole('button',{name:'Refresh orders',exact:true}).click();await expect(page.getByRole('button',{name:'Fire order',exact:true})).toBeEnabled();
});

test('an incomplete order detail cannot hide unfired source lines or authorize a replacement save',async({page})=>{
  const state=await connect(page),order=emptyOrder();
  order.lines=[savedLine()];totals(order);state.orders.set(orderId,order);
  await openService(page);await page.getByRole('button',{name:'Open order Garden tab',exact:true}).click();
  const notes=page.getByRole('article',{name:'Draft line 1 Lunch plate',exact:true}).getByLabel('Item preparation notes',{exact:true});
  await notes.fill('Retain this reviewed source line');
  await expect(page.getByRole('button',{name:'Save order draft',exact:true})).toBeEnabled();
  state.malformedDetail='missing-lines';
  await page.getByRole('button',{name:'Refresh orders',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'The restaurant order details are incomplete.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Save order draft',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Fire order',exact:true})).toBeDisabled();
  await expect(notes).toHaveValue('Retain this reviewed source line');
  expect(state.posts).toHaveLength(0);expect(state.orders.get(orderId)!.lines).toHaveLength(1);
  state.malformedDetail='none';
  await page.getByRole('button',{name:'Refresh orders',exact:true}).click();
  await expect(page.getByRole('button',{name:'Save order draft',exact:true})).toBeEnabled();
  await expect(notes).toHaveValue('Retain this reviewed source line');
});

test('a ticket with matching internal identifiers still cannot be attached to another order detail',async({page})=>{
  const state=await connect(page),order=emptyOrder();
  order.status='FIRED';order.fireRevision=1;order.lines=[savedLine()];order.lines[0].fireRevision=1;totals(order);
  state.orders.set(orderId,order);state.tickets=[ticket(order,kitchen,order.lines)];
  await openService(page);await page.getByRole('button',{name:'Open order Garden tab',exact:true}).click();
  await expect(page.getByText('New kitchen ticket',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Add menu item Fresh juice',exact:true}).click();
  await expect(page.getByRole('button',{name:'Save order draft',exact:true})).toBeEnabled();
  state.malformedDetail='foreign-ticket';
  await page.getByRole('button',{name:'Refresh orders',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'The restaurant order details are incomplete.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Save order draft',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Fire order',exact:true})).toBeDisabled();
  await expect(page.getByText('Foreign ticket detail must stay hidden',{exact:true})).toHaveCount(0);
  expect(state.posts).toHaveLength(0);expect(state.tickets[0].orderId).toBe(orderId);
});

test('a superseded late detail read cannot replace newer quote evidence or unsaved text',async({page})=>{
  const state=await connect(page);await openService(page);await create(page);await page.getByRole('button',{name:'Add menu item Lunch plate',exact:true}).click();await save(page);const notes=page.getByRole('article',{name:'Draft line 1 Lunch plate',exact:true}).getByLabel('Item preparation notes',{exact:true});await notes.fill('Preserve local preparation review');let release!:()=>void;state.detailGate=new Promise<void>(resolve=>{release=resolve;});
  await page.getByRole('button',{name:'Refresh orders',exact:true}).click();await expect(page.getByRole('button',{name:'Refresh orders',exact:true})).toBeEnabled();state.detailGate=undefined;state.orders.get(orderId)!.version=6;state.menu[0]={...state.menu[0],productVersion:2,sellingPriceMinor:12000};await page.getByRole('button',{name:'Refresh orders',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:/shared order changed elsewhere/})).toBeVisible();release();await expect(notes).toHaveValue('Preserve local preparation review');await expect(page.getByText(/Current menu:.*120/).first()).toBeVisible();await page.getByRole('button',{name:'Save order draft',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:/order or its menu details changed elsewhere/})).toBeVisible();
  const saves=state.posts.filter(command=>command.type==='restaurant.order.save');
  expect(saves).toHaveLength(2);expect(saves.at(-1)!.expectedVersions['order:'+orderId]).toBe(2);expect(saves.at(-1)!.expectedVersions['product:'+mealId]).toBe(1);
});

test('order menu and immutable-ticket histories continue search and retain rows after a failed continuation',async({page})=>{
  const state=await connect(page);const order=emptyOrder();order.lines=[savedLine()];totals(order);state.orders.set(orderId,order);state.orderMore=true;state.menuMore=true;await openService(page);const orders=page.locator('section[aria-labelledby="restaurant-orders-title"]');state.moreFailure=true;await orders.getByRole('button',{name:'Load older records',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('button',{name:'Open order Garden tab',exact:true})).toBeVisible();state.moreFailure=false;await orders.getByRole('button',{name:'Load older records',exact:true}).click();await expect(page.getByRole('button',{name:'Open order Older tab',exact:true})).toBeVisible();await page.getByRole('button',{name:'Open order Garden tab',exact:true}).click();const menu=page.locator('section[aria-labelledby="restaurant-menu-title"]');await menu.getByRole('button',{name:'Load older records',exact:true}).click();await expect(page.getByRole('button',{name:'Add menu item Older menu item',exact:true})).toBeVisible();await menu.getByLabel('Search restaurant menu',{exact:true}).fill('OLDER');await menu.getByRole('button',{name:'Search records',exact:true}).click();expect(state.reads).toContain('/restaurant/menu?q=OLDER');
  order.status='FIRED';order.fireRevision=1;order.lines[0].fireRevision=1;totals(order);state.tickets=[ticket(order,kitchen,order.lines),ticket(order,kitchen,order.lines)];state.ticketMore=true;await page.getByRole('button',{name:'Reload saved order',exact:true}).click();const tickets=page.locator('section[aria-labelledby="restaurant-order-tickets-title"]');await expect(tickets.getByText('New kitchen ticket',{exact:true})).toHaveCount(1);await tickets.getByRole('button',{name:'Load older records',exact:true}).click();await expect(tickets.getByText('New kitchen ticket',{exact:true})).toHaveCount(2);expect(state.reads).toContain('/restaurant/orders/'+orderId+'/tickets?after=tickets-next');
});

test('cook station advances durable ticket state and recovers the original command after a lost response',async({page})=>{
  const state=await connect(page,'cook'),order=emptyOrder();order.status='FIRED';order.fireRevision=1;order.lines=[savedLine()];order.lines[0].fireRevision=1;totals(order);state.tickets=[ticket(order,kitchen,order.lines)];await openService(page,'Cook');
  state.loseType='restaurant.ticket.advance';await page.getByRole('button',{name:'Acknowledge ticket',exact:true}).first().click();await expect(page.getByRole('button',{name:'Check original ticket action status',exact:true})).toBeVisible();
  const original=structuredClone(state.posts[0]);state.loseType='';await page.getByRole('button',{name:'Check original ticket action status',exact:true}).click();await expect(page.getByText('ACKNOWLEDGED',{exact:true})).toBeVisible();
  expect(state.posts.filter(command=>command.type==='restaurant.ticket.advance')).toEqual([original]);await page.getByRole('button',{name:'Start preparation',exact:true}).click();await expect(page.getByText('PREPARING',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Mark ready',exact:true}).click();await expect(page.getByText('READY',{exact:true})).toBeVisible();expect(state.posts.filter(command=>command.type==='restaurant.ticket.advance')).toHaveLength(3);
});
test('cook station actions stop offline and revoked logical device access is rechecked on refresh',async({page,context})=>{
  const state=await connect(page,'cook'),order=emptyOrder();order.status='FIRED';order.fireRevision=1;order.lines=[savedLine()];order.lines[0].fireRevision=1;totals(order);state.tickets=[ticket(order,kitchen,order.lines),ticket(order,kitchen,order.lines)];state.ticketMore=true;await openService(page,'Cook');await expect(page.getByRole('button',{name:'Orders',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Hot kitchen',exact:true})).toBeVisible();await page.getByRole('button',{name:'Load older records',exact:true}).click();await expect(page.getByText('New kitchen ticket',{exact:true})).toHaveCount(2);await expect(page.getByRole('button',{name:'Acknowledge ticket',exact:true}).first()).toBeVisible();await context.setOffline(true);await expect(page.getByRole('alert').filter({hasText:/offline.*out of date/})).toBeVisible();await expect(page.getByRole('button',{name:'Acknowledge ticket',exact:true}).first()).toBeDisabled();await expect(page.getByRole('button',{name:'Refresh station tickets',exact:true})).toBeDisabled();state.stationAccess=false;await context.setOffline(false);await expect(page.getByText(/No preparation stations are assigned/)).toBeVisible();await expect(page.getByText('New kitchen ticket',{exact:true})).toHaveCount(0);expect(state.posts).toHaveLength(0);
});

for(const viewport of [{width:1024,height:600},{width:390,height:844}])test(`assigned kitchen queue stays usable at ${viewport.width}x${viewport.height}`,async({page},testInfo)=>{
  await page.setViewportSize(viewport);const state=await connect(page,'cook'),order=emptyOrder();order.status='FIRED';order.fireRevision=1;order.lines=[savedLine()];order.lines[0].fireRevision=1;totals(order);state.tickets=[ticket(order,kitchen,order.lines)];await openService(page,'Cook');
  const acknowledge=page.getByRole('button',{name:'Acknowledge ticket',exact:true});await expect(acknowledge).toBeVisible();const box=await acknowledge.boundingBox();expect(box).not.toBeNull();expect(Math.round(box!.height*1000)/1000).toBeGreaterThanOrEqual(44);expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(viewport.width+1);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);await testInfo.attach(`restaurant-kds-${viewport.width}x${viewport.height}.png`,{body:await page.screenshot({fullPage:false}),contentType:'image/png'});
});

for(const status of [401,403] as const)test(`station feed denial ${status} clears previously authorized tickets and station controls`,async({page})=>{
  const state=await connect(page,'cook'),order=emptyOrder();
  order.status='FIRED';order.fireRevision=1;order.lines=[savedLine()];order.lines[0].fireRevision=1;totals(order);
  state.tickets=[ticket(order,kitchen,order.lines)];
  await openService(page,'Cook');
  await expect(page.getByText('New kitchen ticket',{exact:true})).toBeVisible();
  state.feedDenied=true;state.feedDeniedStatus=status;
  await page.getByRole('button',{name:'Refresh station tickets',exact:true}).click();
  await expect(page.getByText('New kitchen ticket',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Hot kitchen',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Load older records',exact:true})).toHaveCount(0);
  if(status===401)await expect(page.getByLabel('Signed in as Order Cook')).toHaveCount(0);
  else await expect(page.getByRole('alert').filter({hasText:/could not be confirmed/})).toBeVisible();
  expect(state.posts).toHaveLength(0);
});

for(const viewport of [{width:1024,height:600},{width:1280,height:720},{width:1280,height:800},{width:800,height:1280},{width:1366,height:768},{width:1920,height:1080},{width:390,height:844}])test(`station ticket review fits ${viewport.width}x${viewport.height}`,async({page},testInfo)=>{
  await page.setViewportSize(viewport);const state=await connect(page);await openService(page);await create(page);await page.getByRole('button',{name:'Add menu item Lunch plate',exact:true}).click();await page.getByRole('article',{name:'Draft line 1 Lunch plate',exact:true}).getByLabel('Item preparation notes',{exact:true}).fill('Long preparation notes stay readable and wrap inside the order.');await save(page);await page.getByRole('button',{name:'Fire order',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Create station tickets',exact:true}),confirm=dialog.getByRole('button',{name:'Create station tickets',exact:true});await confirm.scrollIntoViewIfNeeded();const box=await confirm.boundingBox();expect(box).not.toBeNull();expect(Math.round(box!.height*1000)/1000).toBeGreaterThanOrEqual(44);expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(viewport.width+1);expect(box!.y+box!.height).toBeLessThanOrEqual(viewport.height+1);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);await testInfo.attach(`restaurant-fire-${viewport.width}x${viewport.height}.png`,{body:await page.screenshot({fullPage:false}),contentType:'image/png'});await confirm.click();await expect(dialog).toHaveCount(0);expect(state.tickets).toHaveLength(1);
});
