import {expect,test,type Page} from '@playwright/test';

const tenant='staff-history-tenant',operator='staff-history-admin',firstId='00000000-0000-4000-8000-000000000001',lastId='00000000-0000-4000-8000-000000000501';
const member=(userId:string,name:string)=>({userId,displayName:name,email:`${name.toLowerCase().replaceAll(' ','-')}@example.invalid`,role:'cashier',active:true,version:1,credentialVersion:1,hasCredential:true,assignmentCount:1,activeSessionCount:1});
const first=member(firstId,'First operator'),last=member(lastId,'Operator beyond first page');
const page=(more=false,total=2)=>({nextCursor:more?'older-page':null,hasMore:more,totalCount:total,asOf:'2026-10-20T06:00:00Z',limit:1});
const sessionRow=(id:string,label:string)=>({id,deviceId:id,deviceLabel:label,outletId:'history-outlet',outletName:'History outlet',createdAt:'2026-10-20T06:00:00Z',expiresAt:'2099-10-20T06:00:00Z',revokedAt:null,version:1,current:false});
async function fixture(browser:Page){
  await browser.route('**/api/v1/auth/me',route=>route.fulfill({json:{user:{id:operator,name:'History Administrator',email:'history-admin@example.invalid',role:'admin',permissions:['config.view','config.manage','staff.view','staff.manage','devices.view','devices.manage']},tenant:{id:tenant,name:'History business',currency:'KES',timeZone:'Africa/Nairobi',capabilities:['commerce','inventory']},outlet:{id:'history-outlet',name:'History outlet',timeZone:'Africa/Nairobi'},deviceId:'history-device',csrfToken:'history-csrf'}}));
  await browser.route('**/api/v1/shifts/current',route=>route.fulfill({json:{shift:null}}));
  await browser.route('**/api/v1/configuration/stock-sale-policy',route=>route.fulfill({json:{policy:{outletId:'history-outlet',enabled:false,allowZeroReferenceCost:false,version:1,requirePhysicalConfirmation:true,requireReason:true}}}));
  await browser.route('**/api/v1/configuration',route=>route.fulfill({json:{configuration:{business:{id:tenant,name:'History business',currency:'KES',timeZone:'Africa/Nairobi',version:1,taxPolicy:{calculation:'exclusive',defaultRateBps:1600,label:'VAT',reviewed:true}},outlet:{id:'history-outlet',name:'History outlet',timeZone:'Africa/Nairobi',version:1},capabilities:['commerce','inventory'],supportedCapabilities:['commerce','inventory'],readiness:{readyForFirstSale:false,checks:[]}}}}));
  await browser.route('**/api/v1/staff?*',route=>{
    const query=new URL(route.request().url()).searchParams;
    const sought=query.get('q');const staff=sought?([first,last].filter(person=>person.userId===sought||person.displayName.toLowerCase().includes(sought.toLowerCase()))):query.has('after')?[last]:[first];
    if(sought==='unavailable')return route.fulfill({status:503,json:{error:{code:'SERVICE_UNAVAILABLE'}}});
    return route.fulfill({json:{staff,roles:[{role:'cashier',label:'Cashier',permissions:[],assignable:true}],outlets:[{id:'history-outlet',name:'History outlet',timeZone:'Africa/Nairobi',active:true}],authorizationModel:'COARSE_ROLE_MAP',page:page(!sought&&!query.has('after'))}});
  });
  // The first read has no query parameters; subsequent reads use the same contract.
  await browser.route('**/api/v1/staff',route=>route.fulfill({json:{staff:[first],roles:[{role:'cashier',label:'Cashier',permissions:[],assignable:true}],outlets:[{id:'history-outlet',name:'History outlet',timeZone:'Africa/Nairobi',active:true}],authorizationModel:'COARSE_ROLE_MAP',page:page(true)}}));
  await browser.route('**/api/v1/staff/*/sessions**',route=>{
    const query=new URL(route.request().url()).searchParams;
    if(query.get('q')==='unavailable')return route.fulfill({status:503,json:{error:{code:'SERVICE_UNAVAILABLE'}}});
    const sessions=query.has('after')?[sessionRow('older-session','Older terminal')]:[sessionRow('newer-session','Newer terminal')];
    return route.fulfill({json:{userId:route.request().url().includes(lastId)?lastId:firstId,credentialVersion:1,sessions,page:page(!query.has('after'))}});
  });
  await browser.route('**/api/v1/devices**',route=>{
    const older=new URL(route.request().url()).searchParams.has('after');
    return route.fulfill({json:{devices:[{id:older?'older-assignment':'newer-assignment',label:older?'Older workspace':'Newer workspace',kind:'WORKSPACE_ASSIGNMENT',outletId:'history-outlet',outletName:'History outlet',assignedUserId:firstId,assignedUserName:first.displayName,active:true,version:1,createdAt:'2026-10-20T06:00:00Z',revokedAt:null}],page:page(!older)}});
  });
}

test('staff search reaches operators beyond the first page and session history appends older records',async({page:browser})=>{
  await fixture(browser);await browser.goto('/');await browser.getByRole('button',{name:'Manage',exact:true}).click();
  await browser.locator('.manage-grid').getByRole('button',{name:/^Staff/}).click();
  const directory=browser.getByRole('region',{name:'Staff directory'});
  await directory.getByLabel('Search staff',{exact:true}).fill('unavailable');await directory.getByRole('button',{name:'Search records'}).click();
  await expect(browser.getByRole('alert').first()).toBeVisible();
  await directory.getByRole('button',{name:'Load older records'}).click();
  await expect(directory.getByRole('button',{name:/First operator/})).toBeVisible();await expect(directory.getByRole('button',{name:/Operator beyond first page/})).toBeVisible();
  await directory.getByLabel('Search staff',{exact:true}).fill('beyond');await directory.getByRole('button',{name:'Search records'}).click();
  await expect(directory.getByRole('button',{name:/First operator/})).toHaveCount(0);
  await directory.getByRole('button',{name:/Operator beyond first page/}).click();
  const sessions=browser.getByRole('region',{name:'Operator sessions'});
  await sessions.getByLabel('Search operator sessions').fill('unavailable');await sessions.getByRole('button',{name:'Search records'}).click();
  await expect(sessions.getByRole('alert')).toBeVisible();
  await sessions.getByRole('button',{name:'Load older records'}).click();
  await expect(sessions.getByRole('heading',{name:/Newer terminal/})).toBeVisible();await expect(sessions.getByRole('heading',{name:/Older terminal/})).toBeVisible();
  await expect(sessions.getByRole('status')).toContainText('2 shown of 2 matching records');
});

test('an in-progress operator setup survives first-page omission and selects the saved operator',async({page:browser})=>{
  await fixture(browser);
  await browser.addInitScript(({key,userId})=>sessionStorage.setItem(key,JSON.stringify({userId,step:'password'})),{key:`mazao-staff-setup:${tenant}:${operator}`,userId:lastId});
  await browser.goto('/');await browser.getByRole('button',{name:'Manage',exact:true}).click();await browser.locator('.manage-grid').getByRole('button',{name:/^Staff/}).click();
  await expect(browser.getByRole('region',{name:'Guided operator setup'})).toBeVisible();
  await expect(browser.getByRole('region',{name:'Selected staff member'}).getByRole('heading',{name:last.displayName,exact:true})).toBeVisible();
  expect(await browser.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!).userId,`mazao-staff-setup:${tenant}:${operator}`)).toBe(lastId);
});

test('assignment operator picker searches server records beyond the first staff page',async({page:browser})=>{
  await fixture(browser);await browser.goto('/');await browser.getByRole('button',{name:'Manage',exact:true}).click();
  await browser.locator('.manage-grid').getByRole('button',{name:/^Workspace assignments|^Devices/}).click();
  await browser.getByRole('button',{name:'Load older records'}).last().click();
  const older=browser.getByRole('article').filter({has:browser.getByRole('heading',{name:'Older workspace',exact:true})});
  await older.getByRole('button',{name:'Edit assignment'}).click();
  await browser.getByLabel('Search operators for assignments').fill('beyond');
  await browser.getByRole('region',{name:'Operator search for assignments'}).getByRole('button',{name:'Search records'}).click();
  await browser.getByRole('combobox',{name:'Active operator',exact:true}).selectOption(lastId);
  await expect(browser.getByRole('combobox',{name:'Active operator',exact:true})).toHaveValue(lastId);
  await expect(older.getByRole('combobox',{name:'Assign to active operator',exact:true})).toBeVisible();
  await older.getByRole('combobox',{name:'Assign to active operator',exact:true}).selectOption(lastId);
  await expect(older.getByRole('combobox',{name:'Assign to active operator',exact:true})).toHaveValue(lastId);
});
