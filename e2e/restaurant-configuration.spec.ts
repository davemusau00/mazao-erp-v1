import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { BackendCommand } from '../src/services/apiClient';
import type { RestaurantConfiguration, RestaurantProduct } from '../src/types/restaurant';

const tenantId='00000000-0000-4000-8000-000000006101',outletId='00000000-0000-4000-8000-000000006102';
const userId='00000000-0000-4000-8000-000000006103',deviceId='00000000-0000-4000-8000-000000006104';
const productId='00000000-0000-4000-8000-000000006105',stationId='00000000-0000-4000-8000-000000006106';
const laterProductId='00000000-0000-4000-8000-000000006107';
const history=(totalCount=1,hasMore=false,nextCursor:string|null=null)=>({totalCount,hasMore,nextCursor,limit:50,asOf:'2026-10-29T17:00:00.000Z'});
const product:RestaurantProduct={id:productId,name:'Lunch plate',sku:'LUNCH-PLATE',itemKind:'STOCKED_GOOD',version:3,active:true,currency:'KES',sellingPriceMinor:12500,taxRateBps:1600};

function configuration():RestaurantConfiguration {
  return {sections:[],tables:[],stations:[],menuRoutes:[],stationAssignments:[],devices:[{id:deviceId,label:'Kitchen workspace',version:2,active:true}],products:[{...product}],productPage:history(),
    permissions:{manage:true,assignDevices:true},availability:{ordering:false,fire:false,kds:false,printing:false,roomCharge:false,recipeConsumption:false},limits:{sections:100,tables:500,stations:100,menuRoutes:2000}};
}

async function connect(page:Page,readonly=false){
  const config=configuration(),posts:BackendCommand[]=[],reads:string[]=[],results=new Map<string,Record<string,unknown>>();
  if(readonly){config.permissions={manage:false,assignDevices:false};config.devices=[];config.products=[];config.productPage=null;}
  const state:{configurationStatus:number;malformedRead:boolean;postMode:'normal'|'incomplete'|'lost';statusResponse?:unknown;statusNotFound:boolean;productFailure:boolean;productReads:string[];productOverride?:RestaurantProduct[]}={configurationStatus:200,malformedRead:false,postMode:'normal',statusNotFound:false,productFailure:false,productReads:[]};
  const apply=(command:BackendCommand):Record<string,unknown>=>{
    const p=command.payload;
    if(command.type==='restaurant.section.save'){
      const id=String(p.sectionId??randomUUID()),before=config.sections.find(row=>row.id===id),version=(before?.version??0)+1;
      const row={id,name:String(p.name),active:Boolean(p.active),version};config.sections=config.sections.filter(row=>row.id!==id).concat(row);return {sectionId:id,version,active:row.active};
    }
    if(command.type==='restaurant.table.save'){
      const id=String(p.tableId??randomUUID()),before=config.tables.find(row=>row.id===id),version=(before?.version??0)+1;
      const row={id,name:String(p.name),sectionId:p.sectionId===null?null:String(p.sectionId),seats:Number(p.seats),active:Boolean(p.active),version};config.tables=config.tables.filter(row=>row.id!==id).concat(row);return {tableId:id,version,active:row.active};
    }
    if(command.type==='restaurant.station.save'){
      const id=String(p.stationId??randomUUID()),before=config.stations.find(row=>row.id===id),version=(before?.version??0)+1;
      const row={id,name:String(p.name),kind:p.kind as 'KITCHEN'|'BAR'|'EXPO',charactersPerLine:Number(p.charactersPerLine),active:Boolean(p.active),version};config.stations=config.stations.filter(row=>row.id!==id).concat(row);return {stationId:id,version,active:row.active};
    }
    if(command.type==='restaurant.menu.save'){
      const item=config.products.find(row=>row.id===p.productId)??product,before=config.menuRoutes.find(row=>row.productId===p.productId),version=(before?.version??0)+1;
      config.menuRoutes=config.menuRoutes.filter(row=>row.productId!==p.productId).concat({productId:String(p.productId),productName:item.name,sku:item.sku,itemKind:item.itemKind,productVersion:item.version,productActive:item.active,currency:item.currency,sellingPriceMinor:item.sellingPriceMinor,taxRateBps:item.taxRateBps,stationIds:p.stationIds as string[],preparationLabel:String(p.preparationLabel),instructions:String(p.instructions),available:Boolean(p.available),effectiveAvailable:Boolean(p.available)&&item.active,version});return {productId:p.productId,version};
    }
    const before=config.stationAssignments.find(row=>row.deviceId===p.deviceId),version=(before?.version??0)+1;
    config.stationAssignments=config.stationAssignments.filter(row=>row.deviceId!==p.deviceId).concat({deviceId:String(p.deviceId),stationIds:p.stationIds as string[],deviceVersion:2,effectiveActive:true,version});return {deviceId:p.deviceId,version};
  };
  await page.route('**/api/v1/**',async route=>{
    const url=new URL(route.request().url()),path=url.pathname.replace('/api/v1','');reads.push(path);
    if(path==='/auth/me')return route.fulfill({json:{user:{id:userId,name:readonly?'Restaurant Waiter':'Restaurant Admin',email:'restaurant-browser@example.invalid',role:readonly?'waiter':'admin',permissions:readonly?['restaurant.view']:['restaurant.view','restaurant.manage','devices.manage']},tenant:{id:tenantId,name:'Restaurant browser business',currency:'KES',timeZone:'Africa/Nairobi',capabilities:['restaurant','commerce','inventory']},outlet:{id:outletId,name:'Dining outlet',timeZone:'Africa/Nairobi'},deviceId,csrfToken:'restaurant-csrf'}});
    if(path==='/restaurant/configuration')return route.fulfill({status:state.configurationStatus,json:state.configurationStatus!==200?{error:{code:'TEMPORARILY_UNAVAILABLE'}}:state.malformedRead?{configuration:{...config,availability:{...config.availability,kds:true}}}:{configuration:config}});
    if(path==='/restaurant/products'){
      state.productReads.push(url.search);
      if(state.productFailure)return route.fulfill({status:503,json:{error:{code:'TEMPORARILY_UNAVAILABLE'}}});
      const later={...product,id:laterProductId,name:'Older menu item',sku:'OLDER-MENU',version:7};
      return route.fulfill({json:{products:state.productOverride??[later],page:history(url.searchParams.has('q')?1:2)}});
    }
    if(path==='/commands'){
      const command=route.request().postDataJSON() as BackendCommand;posts.push(command);
      if(!results.has(command.commandId)){
        const p=command.payload;
        const menu=config.menuRoutes.find(row=>row.productId===p.productId),item=config.products.find(row=>row.id===p.productId);
        const assignment=config.stationAssignments.find(row=>row.deviceId===p.deviceId),device=config.devices.find(row=>row.id===p.deviceId);
        const staleMenu=command.type==='restaurant.menu.save'&&((menu?.version??undefined)!==command.expectedVersions[`menu:${p.productId}`]||item&&item.version!==command.expectedVersions[`product:${p.productId}`]);
        const staleAssignment=command.type==='restaurant.station.assign'&&((assignment?.version??undefined)!==command.expectedVersions[`stationAssignment:${p.deviceId}`]||device?.version!==command.expectedVersions[`device:${p.deviceId}`]);
        if(staleMenu||staleAssignment){
          const missingReview=command.type==='restaurant.menu.save'&&menu&&command.expectedVersions[`menu:${p.productId}`]===undefined
            ||command.type==='restaurant.station.assign'&&assignment&&command.expectedVersions[`stationAssignment:${p.deviceId}`]===undefined;
          return route.fulfill({json:{commandId:command.commandId,status:missingReview?'REJECTED':'CONFLICT',code:missingReview?'VALIDATION_FAILED':'VERSION_CONFLICT'}});
        }
      }
      if(!results.has(command.commandId))results.set(command.commandId,apply(command));
      if(state.postMode==='lost')return route.abort('failed');
      return route.fulfill({json:{commandId:command.commandId,status:'CONFIRMED',value:state.postMode==='incomplete'?{}:results.get(command.commandId)}});
    }
    if(path.startsWith('/commands/')){
      if(state.statusNotFound)return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});
      const commandId=path.split('/').at(-1)!;
      return route.fulfill({json:state.statusResponse??{commandId,status:'CONFIRMED',response:{commandId,status:'CONFIRMED',value:results.get(commandId)}}});
    }
    return route.fulfill({status:404,json:{error:{code:'UNEXPECTED_TEST_ENDPOINT',message:path}}});
  });
  return {config,state,posts,reads,results};
}

async function openRestaurant(page:Page){
  await page.goto('/');
  await expect(page.getByRole('button',{name:/^Signed in as Restaurant (Admin|Waiter)$/})).toBeVisible();
  const navigation=page.getByRole('button',{name:/Tables & kitchen/});
  if(!await navigation.first().isVisible())await page.getByRole('button',{name:'More',exact:true}).click();
  await navigation.last().click();
  await expect(page.getByRole('heading',{name:'Restaurant setup',exact:true})).toBeVisible();
}
async function addArea(page:Page,name='Garden service'){
  await page.getByRole('button',{name:'Add service area',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Add service area',exact:true});await dialog.getByLabel('Area name',{exact:true}).fill(name);return dialog;
}
async function retained(page:Page){
  return page.evaluate(async()=>{
    const database=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('mazao-v1-command-journal',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try{return await new Promise<Array<{command:BackendCommand}>>((resolve,reject)=>{const request=database.transaction('commands').objectStore('commands').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}finally{database.close();}
  });
}

test('restaurant setup creates durable area table stations menu routing and logical station access',async({page})=>{
  const {config,posts,reads}=await connect(page);await openRestaurant(page);
  let dialog=await addArea(page);await dialog.getByRole('button',{name:'Save area',exact:true}).click();await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Garden service',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Tables',exact:true}).click();await page.getByRole('button',{name:'Add table',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Add table',exact:true});await dialog.getByLabel('Table name',{exact:true}).fill('Garden 4');await dialog.getByLabel('Service area',{exact:true}).selectOption(config.sections[0].id);await dialog.getByLabel('Seats',{exact:true}).fill('4');await dialog.getByRole('button',{name:'Save table',exact:true}).click();await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:'Preparation stations',exact:true}).click();
  for(const [name,kind] of [['Hot kitchen','KITCHEN'],['Service bar','BAR']] as const){
    await page.getByRole('button',{name:'Add preparation station',exact:true}).click();dialog=page.getByRole('dialog',{name:'Add preparation station',exact:true});await dialog.getByLabel('Station name',{exact:true}).fill(name);await dialog.getByLabel('Station type',{exact:true}).selectOption(kind);await dialog.getByLabel('Characters per line',{exact:true}).fill('48');await dialog.getByRole('button',{name:'Save station',exact:true}).click();await expect(dialog).toHaveCount(0);
  }
  await page.getByRole('button',{name:'Menu routing',exact:true}).click();await page.getByRole('button',{name:'Add menu routing',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Add menu routing',exact:true});await dialog.getByLabel('Menu item',{exact:true}).selectOption(productId);await dialog.getByLabel('Preparation label',{exact:true}).fill('Lunch plate — pass together');await dialog.getByLabel('Preparation instructions',{exact:true}).fill('Sauce on the side');await dialog.getByLabel('Hot kitchen',{exact:true}).check();await dialog.getByLabel('Service bar',{exact:true}).check();await dialog.getByRole('button',{name:'Save menu routing',exact:true}).click();await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Lunch plate',exact:true})).toBeVisible();await expect(page.getByText('Sauce on the side',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Station access',exact:true}).click();await page.getByRole('button',{name:'Assign stations',exact:true}).click();dialog=page.getByRole('dialog',{name:'Assign stations',exact:true});await dialog.getByLabel('Workspace assignment',{exact:true}).selectOption(deviceId);await dialog.getByLabel('Hot kitchen',{exact:true}).check();await dialog.getByRole('button',{name:'Save station access',exact:true}).click();await expect(dialog).toHaveCount(0);
  expect(posts.map(command=>command.type)).toEqual(['restaurant.section.save','restaurant.table.save','restaurant.station.save','restaurant.station.save','restaurant.menu.save','restaurant.station.assign']);
  expect(posts[1].payload).toEqual({name:'Garden 4',sectionId:config.sections[0].id,seats:4,active:true});
  expect(posts[4].expectedVersions).toEqual({[`product:${productId}`]:3});expect(posts[5].expectedVersions).toEqual({[`device:${deviceId}`]:2});
  expect(new Set(posts.map(command=>command.commandId)).size).toBe(6);expect(await retained(page)).toEqual([]);
  await page.reload();await openRestaurant(page);await page.getByRole('button',{name:'Tables',exact:true}).click();await expect(page.getByRole('heading',{name:'Garden 4',exact:true})).toBeVisible();
  await expect(page.getByText(/Taking table orders, sending kitchen or bar tickets, printing, live kitchen preparation and room charges are unavailable/)).toBeVisible();
  expect(reads.some(path=>path.startsWith('/sales/')||path.startsWith('/hotel/'))).toBe(false);
});

test('a waiter can review restaurant configuration without price payment or station assignment authority',async({page})=>{
  const {config,posts,reads}=await connect(page,true);config.sections=[{id:randomUUID(),name:'Dining room',active:true,version:1}];config.stations=[{id:stationId,name:'Hot kitchen',kind:'KITCHEN',active:true,version:1,charactersPerLine:42}];
  await openRestaurant(page);await expect(page.getByText('You can review restaurant setup. Ask a manager to change it.',{exact:true})).toBeVisible();
  for(const tab of ['Service areas','Tables','Preparation stations','Menu routing']){await page.getByRole('button',{name:tab,exact:true}).click();await expect(page.getByRole('button',{name:/^(?:Add service area|Add table|Add preparation station|Add menu routing|Edit area|Edit table|Edit station|Edit menu)/})).toHaveCount(0);}
  await expect(page.getByRole('button',{name:'Station access',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Sell',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:/Take payment|Confirm payment|Charge room|Send to kitchen|Fire order/})).toHaveCount(0);
  expect(posts).toHaveLength(0);expect(reads).not.toContain('/restaurant/products');
});

test('incomplete setup acknowledgement retains one original command through malformed status and reload',async({page})=>{
  const {state,posts,results}=await connect(page);state.postMode='incomplete';await openRestaurant(page);let dialog=await addArea(page,'Retained service area');await dialog.getByRole('button',{name:'Save area',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Check setup change status',exact:true})).toBeEnabled();const original=structuredClone(posts[0]);const value=results.get(original.commandId)!;
  for(const malformed of [{},{sectionId:value.sectionId},{...value,version:0},{sectionId:value.sectionId,version:1},{...value,active:false}]){
    state.statusResponse={commandId:original.commandId,status:'CONFIRMED',response:{commandId:original.commandId,status:'CONFIRMED',value:malformed}};
    await dialog.getByRole('button',{name:'Check setup change status',exact:true}).click();await expect(dialog.getByRole('button',{name:'Check setup change status',exact:true})).toBeEnabled();
    await expect(dialog.getByLabel('Area name',{exact:true})).toBeDisabled();expect((await retained(page)).map(record=>record.command)).toEqual([original]);expect(posts).toHaveLength(1);
  }
  await page.reload();await openRestaurant(page);await expect(page.getByRole('button',{name:'Add service area',exact:true})).toBeDisabled();
  state.statusResponse={commandId:original.commandId,status:'CONFIRMED',response:{commandId:original.commandId,status:'CONFIRMED',value}};
  await page.getByRole('button',{name:'Check setup change status',exact:true}).click();await expect(page.getByRole('button',{name:'Add service area',exact:true})).toBeEnabled();expect(await retained(page)).toEqual([]);expect(posts).toHaveLength(1);
  await expect(page.getByRole('heading',{name:'Retained service area',exact:true})).toBeVisible();
});

test('a dropped setup response retries the exact original envelope only after a not-found status',async({page})=>{
  const {state,posts,config}=await connect(page);state.postMode='lost';await openRestaurant(page);const dialog=await addArea(page,'Original ID garden');await dialog.getByRole('button',{name:'Save area',exact:true}).click();await expect(dialog.getByRole('button',{name:'Check setup change status',exact:true})).toBeEnabled();
  const original=structuredClone(posts[0]);state.statusNotFound=true;state.postMode='normal';await dialog.getByRole('button',{name:'Check setup change status',exact:true}).click();await expect(dialog).toHaveCount(0);expect(posts).toEqual([original,original]);expect(config.sections).toHaveLength(1);expect(await retained(page)).toEqual([]);
});

test('failed or malformed setup refreshes and an offline connection block writes until a fresh read',async({page,context})=>{
  const {state,posts}=await connect(page);await openRestaurant(page);await expect(page.getByRole('button',{name:'Add service area',exact:true})).toBeEnabled();
  state.configurationStatus=503;await page.getByRole('button',{name:'Refresh setup',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:/temporarily unavailable/})).toBeVisible();await expect(page.getByRole('button',{name:'Add service area',exact:true})).toBeDisabled();
  state.configurationStatus=200;state.malformedRead=true;await page.getByRole('button',{name:'Refresh setup',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:/required directories, permissions or availability/})).toBeVisible();await expect(page.getByRole('button',{name:'Add service area',exact:true})).toBeDisabled();
  state.malformedRead=false;await page.getByRole('button',{name:'Refresh setup',exact:true}).click();await expect(page.getByRole('button',{name:'Add service area',exact:true})).toBeEnabled();
  const dialog=await addArea(page,'Offline unsaved area');await context.setOffline(true);await expect(page.getByRole('alert').filter({hasText:/out of date while offline/})).toBeVisible();await expect(dialog.getByLabel('Area name',{exact:true})).toBeDisabled();await expect(dialog.getByRole('button',{name:'Save area',exact:true})).toBeDisabled();expect(posts).toHaveLength(0);
  await context.setOffline(false);await expect(dialog.getByRole('button',{name:'Save area',exact:true})).toBeEnabled();await dialog.getByRole('button',{name:'Save area',exact:true}).click();await expect(dialog).toHaveCount(0);expect(posts).toHaveLength(1);
});

test('menu picker continues beyond its first page retains rows on failure and searches the full source',async({page})=>{
  const {config,state,posts}=await connect(page);config.stations=[{id:stationId,name:'Hot kitchen',kind:'KITCHEN',charactersPerLine:42,active:true,version:1}];config.productPage=history(2,true,'restaurant-cursor-2');await openRestaurant(page);await page.getByRole('button',{name:'Menu routing',exact:true}).click();await page.getByRole('button',{name:'Add menu routing',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Add menu routing',exact:true});await expect(dialog.getByText('Showing 1 of 2 matching menu items.',{exact:true})).toBeVisible();state.productFailure=true;await dialog.getByRole('button',{name:'Load more menu items',exact:true}).click();await expect(dialog.getByRole('alert')).toBeVisible();await expect(dialog.getByLabel('Menu item',{exact:true}).locator('option')).toHaveCount(2);
  state.productFailure=false;await dialog.getByRole('button',{name:'Load more menu items',exact:true}).click();await expect(dialog.getByText('Showing 2 of 2 matching menu items.',{exact:true})).toBeVisible();expect(state.productReads.slice(0,2)).toEqual(['?after=restaurant-cursor-2','?after=restaurant-cursor-2']);
  await dialog.getByLabel('Search menu items',{exact:true}).fill('OLDER-MENU');await dialog.getByRole('button',{name:'Search items',exact:true}).click();await expect(dialog.getByText('Showing 1 of 1 matching menu items.',{exact:true})).toBeVisible();expect(state.productReads.at(-1)).toBe('?q=OLDER-MENU');await dialog.getByLabel('Menu item',{exact:true}).selectOption(laterProductId);await dialog.getByLabel('Preparation label',{exact:true}).fill('Older menu item');await dialog.getByLabel('Hot kitchen',{exact:true}).check();await dialog.getByRole('button',{name:'Save menu routing',exact:true}).click();await expect(dialog).toHaveCount(0);expect(posts[0].expectedVersions).toEqual({[`product:${laterProductId}`]:7});
});

function menuRoute(version=1){
  return {productId,productName:product.name,sku:product.sku,itemKind:product.itemKind,productVersion:product.version,productActive:true,currency:product.currency,sellingPriceMinor:product.sellingPriceMinor,taxRateBps:product.taxRateBps,stationIds:[stationId],preparationLabel:'Reviewed lunch plate',instructions:'Reviewed instructions',available:true,effectiveAvailable:true,version};
}
function addKitchen(config:RestaurantConfiguration){config.stations=[{id:stationId,name:'Hot kitchen',kind:'KITCHEN',charactersPerLine:42,active:true,version:1}];}
async function reconnectSetup(page:Page,context:import('@playwright/test').BrowserContext){
  await context.setOffline(true);await expect(page.getByRole('alert').filter({hasText:/out of date while offline/})).toBeVisible();
  await context.setOffline(false);await expect(page.getByRole('dialog').getByRole('button',{name:/^Save /})).toBeEnabled();
}

test('reconnect preserves reviewed menu versions and cannot overwrite another manager change',async({page,context})=>{
  const {config,posts}=await connect(page);addKitchen(config);config.menuRoutes=[menuRoute()];await openRestaurant(page);await page.getByRole('button',{name:'Menu routing',exact:true}).click();await page.getByRole('button',{name:'Edit menu routing Lunch plate',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Edit menu routing',exact:true});await dialog.getByLabel('Preparation label',{exact:true}).fill('My unsent lunch label');
  config.menuRoutes=[{...menuRoute(2),preparationLabel:'Other manager lunch label',instructions:'Other manager instructions'}];
  await reconnectSetup(page,context);await expect(dialog.getByLabel('Preparation label',{exact:true})).toHaveValue('My unsent lunch label');await dialog.getByRole('button',{name:'Save menu routing',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:/These details changed elsewhere/})).toBeVisible();expect(posts[0].expectedVersions).toEqual({[`product:${productId}`]:3,[`menu:${productId}`]:1});expect(config.menuRoutes[0].preparationLabel).toBe('Other manager lunch label');
});

test('reconnect preserves reviewed station access and device versions after reassignment',async({page,context})=>{
  const {config,posts}=await connect(page);addKitchen(config);config.stationAssignments=[{deviceId,stationIds:[stationId],version:1,deviceVersion:2,effectiveActive:true}];await openRestaurant(page);await page.getByRole('button',{name:'Station access',exact:true}).click();await page.getByRole('button',{name:'Edit station access Kitchen workspace',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Assign stations',exact:true});await dialog.getByLabel('Hot kitchen',{exact:true}).uncheck();
  config.devices=[{...config.devices[0],version:3,label:'Reassigned kitchen workspace'}];config.stationAssignments=[{deviceId,stationIds:[stationId],version:2,deviceVersion:3,effectiveActive:true}];
  await reconnectSetup(page,context);await dialog.getByRole('button',{name:'Save station access',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:/These details changed elsewhere/})).toBeVisible();expect(posts[0].expectedVersions).toEqual({[`device:${deviceId}`]:2,[`stationAssignment:${deviceId}`]:1});expect(config.stationAssignments[0]).toMatchObject({stationIds:[stationId],version:2,deviceVersion:3});
});

test('a menu route created elsewhere during reconnect cannot replace reviewed absence',async({page,context})=>{
  const {config,posts}=await connect(page);addKitchen(config);await openRestaurant(page);await page.getByRole('button',{name:'Menu routing',exact:true}).click();await page.getByRole('button',{name:'Add menu routing',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Add menu routing',exact:true});await dialog.getByLabel('Menu item',{exact:true}).selectOption(productId);await dialog.getByLabel('Preparation label',{exact:true}).fill('My new route');await dialog.getByLabel('Hot kitchen',{exact:true}).check();config.menuRoutes=[menuRoute()];
  await reconnectSetup(page,context);await dialog.getByRole('button',{name:'Save menu routing',exact:true}).click();
  await expect(dialog.getByRole('alert')).toHaveText('Check the amounts and required details, then try again.');expect(posts[0].expectedVersions).toEqual({[`product:${productId}`]:3});expect(config.menuRoutes[0].preparationLabel).toBe('Reviewed lunch plate');
});

test('station access created elsewhere during reconnect cannot replace reviewed absence',async({page,context})=>{
  const {config,posts}=await connect(page);addKitchen(config);await openRestaurant(page);await page.getByRole('button',{name:'Station access',exact:true}).click();await page.getByRole('button',{name:'Assign stations',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Assign stations',exact:true});await dialog.getByLabel('Workspace assignment',{exact:true}).selectOption(deviceId);await dialog.getByLabel('Hot kitchen',{exact:true}).check();config.stationAssignments=[{deviceId,stationIds:[],version:1,deviceVersion:2,effectiveActive:false}];
  await reconnectSetup(page,context);await dialog.getByRole('button',{name:'Save station access',exact:true}).click();
  await expect(dialog.getByRole('alert')).toHaveText('Check the amounts and required details, then try again.');expect(posts[0].expectedVersions).toEqual({[`device:${deviceId}`]:2});expect(config.stationAssignments[0].stationIds).toEqual([]);
});

test('menu search cannot silently refresh the authority of the selected product',async({page})=>{
  const {config,state,posts}=await connect(page);addKitchen(config);await openRestaurant(page);await page.getByRole('button',{name:'Menu routing',exact:true}).click();await page.getByRole('button',{name:'Add menu routing',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Add menu routing',exact:true});await dialog.getByLabel('Menu item',{exact:true}).selectOption(productId);await dialog.getByLabel('Preparation label',{exact:true}).fill('My reviewed route');await dialog.getByLabel('Hot kitchen',{exact:true}).check();config.products=[{...product,version:4,sellingPriceMinor:15000}];state.productOverride=config.products;
  await dialog.getByLabel('Search menu items',{exact:true}).fill('LUNCH');await dialog.getByRole('button',{name:'Search items',exact:true}).click();await expect.poll(()=>state.productReads.length).toBe(1);await expect(dialog.getByRole('button',{name:'Save menu routing',exact:true})).toBeEnabled();await dialog.getByRole('button',{name:'Save menu routing',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:/These details changed elsewhere/})).toBeVisible();expect(posts[0].expectedVersions).toEqual({[`product:${productId}`]:3});expect(config.menuRoutes).toHaveLength(0);
});

test('adding menu routing for an already configured item directs the operator to edit',async({page})=>{
  const {config,posts}=await connect(page);addKitchen(config);config.menuRoutes=[menuRoute()];await openRestaurant(page);await page.getByRole('button',{name:'Menu routing',exact:true}).click();await page.getByRole('button',{name:'Add menu routing',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Add menu routing',exact:true});await dialog.getByLabel('Menu item',{exact:true}).selectOption(productId);await expect(dialog.getByRole('alert')).toContainText('already has menu routing');expect(posts).toHaveLength(0);
});

for(const viewport of [{width:1024,height:600},{width:1280,height:720},{width:1280,height:800},{width:800,height:1280},{width:1366,height:768},{width:1920,height:1080},{width:390,height:844}]){
  test(`restaurant menu setup remains usable at ${viewport.width}x${viewport.height}`,async({page},testInfo)=>{
    await page.setViewportSize(viewport);const {config}=await connect(page);config.stations=[{id:stationId,name:'Hot kitchen station with a long descriptive name',kind:'KITCHEN',charactersPerLine:48,active:true,version:1}];await openRestaurant(page);await page.getByRole('button',{name:'Menu routing',exact:true}).click();await page.getByRole('button',{name:'Add menu routing',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Add menu routing',exact:true});await dialog.getByLabel('Menu item',{exact:true}).selectOption(productId);await dialog.getByLabel('Preparation label',{exact:true}).fill('Lunch plate with side portions');await dialog.getByLabel('Preparation instructions',{exact:true}).fill('Keep sauce separate. Check the preparation notes before handoff.');await dialog.getByLabel('Hot kitchen station with a long descriptive name',{exact:true}).check();
    const save=dialog.getByRole('button',{name:'Save menu routing',exact:true});await expect(save).toBeEnabled();await save.scrollIntoViewIfNeeded();const bounds=await save.boundingBox();expect(bounds).not.toBeNull();expect(Math.round(bounds!.height*1000)/1000).toBeGreaterThanOrEqual(44);expect(bounds!.width).toBeGreaterThanOrEqual(44);expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(viewport.width+1);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(viewport.height+1);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await testInfo.attach(`restaurant-menu-${viewport.width}x${viewport.height}.png`,{body:await page.screenshot({fullPage:false}),contentType:'image/png'});
    await save.click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('heading',{name:'Lunch plate',exact:true})).toBeVisible();
  });
}
