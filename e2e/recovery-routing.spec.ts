import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { RecoverableCommand } from '../src/services/commandJournal';

const actorId='routing-operator',tenantId='routing-tenant',deviceId='routing-device',outletId='routing-outlet';
const adminPermissions=['config.view','config.manage','staff.view','staff.manage','devices.view','devices.manage'];
const command=(commandId:string,type:string,payload:Record<string,unknown>):RecoverableCommand=>({
  actorId,state:'outcome_unknown',savedAt:'2026-10-16T07:00:00Z',
  command:{protocolVersion:1,commandId,tenantId,deviceId,type,payload,occurredAt:'2026-10-16T06:59:00Z',expectedVersions:{}},
});

async function seedJournal(page:Page,records:RecoverableCommand[]){
  await page.addInitScript(async records=>{
    await new Promise<void>((resolve,reject)=>{
      const request=indexedDB.open('mazao-v1-command-journal',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('commands',{keyPath:'command.commandId'});
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const db=request.result,transaction=db.transaction('commands','readwrite');
        records.forEach(record=>transaction.objectStore('commands').put(record));
        transaction.oncomplete=()=>{db.close();resolve();};
        transaction.onerror=()=>reject(transaction.error);
      };
    });
  },records);
}

async function routeWorkspace(page:Page,permissions=adminPermissions){
  const observed={posts:[] as string[],statusReads:[] as string[],staffReads:0,staffSessionUsers:[] as string[]};
  page.on('request',request=>{if(request.method()==='POST'&&request.url().includes('/api/v1/'))observed.posts.push(request.url());});
  await page.route('**/api/v1/auth/me',route=>route.fulfill({json:{
    user:{id:actorId,name:'Recovery Operator',email:'operator@example.invalid',role:permissions.includes('staff.manage')?'admin':'cashier',permissions,credentialVersion:1},
    tenant:{id:tenantId,name:'Recovery Business',currency:'KES',timeZone:'Africa/Nairobi',capabilities:['commerce','inventory']},
    outlet:{id:outletId,name:'Recovery Outlet',timeZone:'Africa/Nairobi'},deviceId,csrfToken:'routing-csrf',
  }}));
  await page.route('**/api/v1/shifts/current',route=>route.fulfill({json:{shift:null}}));
  await page.route('**/api/v1/configuration',route=>route.fulfill({json:{configuration:{
    business:{id:tenantId,name:'Recovery Business',currency:'KES',timeZone:'Africa/Nairobi',version:1,legalName:'',registrationNumber:'',taxRegistrationNumber:'',address:'',phone:'',email:'',website:'',logoUrl:'',receiptQrImage:'',showQrOnReceipt:false,receiptHeader:'',receiptFooter:'',taxPolicy:{calculation:'exclusive',defaultRateBps:0,label:'Tax',reviewed:true}},
    outlet:{id:outletId,name:'Recovery Outlet',timeZone:'Africa/Nairobi',version:1,address:'',phone:'',email:'',receiptHeader:'',receiptFooter:''},
    capabilities:['commerce','inventory'],supportedCapabilities:['commerce','inventory','hospitality','retail'],currencyLocked:false,
    readiness:{readyForFirstSale:false,checks:[]},
  }}}));
  const staff=['alice','bob'].map(userId=>({userId,displayName:userId==='alice'?'Alice First':'Bob Original',email:userId+'@example.invalid',role:'cashier',active:true,version:1,credentialVersion:1,hasCredential:false,assignmentCount:1,activeSessionCount:0}));
  await page.route('**/api/v1/staff**',route=>{observed.staffReads++;return route.fulfill({json:{staff,roles:[{role:'cashier',label:'Cashier',permissions:[],assignable:true}],outlets:[{id:outletId,name:'Recovery Outlet',timeZone:'Africa/Nairobi',active:true}],authorizationModel:'COARSE_ROLE_MAP'}});});
  await page.route('**/api/v1/staff/*/sessions',route=>{observed.staffReads++;const userId=route.request().url().split('/').at(-2)!;observed.staffSessionUsers.push(userId);return route.fulfill({json:{userId,credentialVersion:1,sessions:[]}});});
  await page.route('**/api/v1/auth/sessions',route=>route.fulfill({json:{userId:actorId,credentialVersion:1,sessions:[]}}));
  await page.route('**/api/v1/devices**',route=>route.fulfill({json:{devices:['assignment-first','assignment-original'].map((id,index)=>({id,kind:'WORKSPACE_ASSIGNMENT',label:index?'Original counter':'First counter',outletId,outletName:'Recovery Outlet',assignedUserId:index?'bob':'alice',assignedUserName:index?'Bob Original':'Alice First',active:true,version:1,createdAt:'2026-10-16T06:00:00Z',revokedAt:null}))}}));
  await page.route('**/api/v1/commands/*',route=>{
    const id=decodeURIComponent(route.request().url().split('/').at(-1)!);observed.statusReads.push(id);
    return route.fulfill({json:{commandId:id,status:'UNKNOWN',response:{status:'UNKNOWN'}}});
  });
  await page.route('**/api/v1/commands',route=>route.fulfill({status:500,json:{error:{message:'Navigation must not submit a command.'}}}));
  return observed;
}

async function openRecord(page:Page,id:string,testInfo?:TestInfo){
  await page.getByRole('button',{name:'Review actions'}).click();
  const dialog=page.getByRole('dialog',{name:'Actions needing review'});
  const row=dialog.getByRole('article').filter({hasText:id});
  await expect(row).toBeVisible();
  if(testInfo)await capture(page,testInfo,'recovery-center-before-open');
  await row.getByRole('button',{name:'Open workspace'}).click();
  await expect(dialog).toHaveCount(0);
}

async function capture(page:Page,testInfo:TestInfo,name:string){
  const path=testInfo.outputPath(name+'.png');await page.screenshot({path});
  await testInfo.attach(name,{path,contentType:'image/png'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
}

for(const viewport of [{width:390,height:844},{width:800,height:1280},{width:1024,height:600},{width:1280,height:720},{width:1280,height:800},{width:1366,height:768},{width:1920,height:1080}]){
  test(`staff recovery opens the original operator and command at ${viewport.width}x${viewport.height}`,async({page},testInfo)=>{
    await page.setViewportSize(viewport);
    await seedJournal(page,[command('a-other-staff','staff.member.update',{userId:'alice',displayName:'Alice Changed',role:'cashier'}),command('b-original-staff','staff.member.update',{userId:'bob',displayName:'Bob Changed',role:'cashier'})]);
    const observed=await routeWorkspace(page);await page.goto('/');
    await openRecord(page,'b-original-staff',testInfo);
    await expect(page.getByRole('heading',{name:'Staff access',exact:true})).toBeVisible();
    await expect(page.getByRole('region',{name:'Selected staff member'}).getByRole('heading',{name:'Bob Original'})).toBeVisible();
    const retained=page.getByRole('region',{name:'Retained access command'});
    await expect(retained).toContainText('b-original-staff');await expect(retained).not.toContainText('a-other-staff');
    await expect(retained).toBeFocused();
    await retained.getByRole('button',{name:'Check access change status',exact:true}).click();
    await expect.poll(()=>observed.statusReads).toEqual(['b-original-staff']);
    expect(observed.posts).toEqual([]);
    expect(observed.staffSessionUsers.every(userId=>userId==='bob')).toBe(true);
    const bounds=await retained.getByRole('button',{name:'Check access change status',exact:true}).boundingBox();expect(bounds!.height).toBeGreaterThanOrEqual(44);
    await capture(page,testInfo,`staff-recovery-${viewport.width}x${viewport.height}`);
  });
}

test('assignment recovery opens assignments and identifies the original target without a submission',async({page},testInfo)=>{
  await page.setViewportSize({width:1024,height:600});
  await seedJournal(page,[command('a-unrelated-staff','staff.member.update',{userId:'alice'}),command('b-original-assignment','devices.assignment.update',{deviceId:'assignment-original',label:'Changed counter',assignedUserId:'bob'})]);
  const observed=await routeWorkspace(page);await page.goto('/');await openRecord(page,'b-original-assignment');
  await expect(page.getByRole('heading',{name:'Workspace assignments',exact:true})).toBeVisible();
  await expect(page.getByRole('article',{name:'Original workspace assignment'})).toContainText('Original counter');
  await expect(page.getByRole('region',{name:'Retained access command'})).toContainText('b-original-assignment');
  expect(observed.posts).toEqual([]);await capture(page,testInfo,'assignment-recovery-1024x600');
});

test('cashier session recovery opens My account and selects the clicked original command',async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});
  await seedJournal(page,[command('a-other-session','auth.session.revoke',{sessionId:'session-first',reason:'Lost browser'}),command('b-original-session','auth.session.revoke',{sessionId:'session-original',reason:'Lost browser'})]);
  const observed=await routeWorkspace(page,['commerce.sell','shift.open','shift.close']);await page.goto('/');await openRecord(page,'b-original-session');
  const account=page.getByRole('dialog',{name:'My account'});
  await expect(account.getByRole('heading',{name:'My sessions'})).toBeVisible();
  await expect(account.getByRole('region',{name:'Retained access command'})).toContainText('b-original-session');
  await account.getByRole('button',{name:'Check access change status',exact:true}).click();
  await expect.poll(()=>observed.statusReads).toEqual(['b-original-session']);
  expect(observed.posts).toEqual([]);expect(observed.staffReads).toBe(0);
  await capture(page,testInfo,'self-session-recovery-390x844');
});

test('staff session recovery selects its original operator before showing session evidence',async({page})=>{
  await seedJournal(page,[command('a-first-session','staff.sessions.revoke',{userId:'alice',sessionId:'alice-session',reason:'Lost browser'}),command('b-bob-session','staff.sessions.revoke',{userId:'bob',sessionId:'bob-session',reason:'Lost browser'})]);
  const observed=await routeWorkspace(page);await page.goto('/');await openRecord(page,'b-bob-session');
  const selected=page.getByRole('region',{name:'Selected staff member'});
  await expect(selected.getByRole('heading',{name:'Bob Original'})).toBeVisible();
  await expect(selected.getByRole('region',{name:'Retained access command'})).toContainText('b-bob-session');
  await expect.poll(()=>observed.staffSessionUsers).toEqual(['bob']);
  expect(observed.posts).toEqual([]);
});

test('a missing original operator is not replaced with another directory entry',async({page})=>{
  await seedJournal(page,[command('missing-staff-target','staff.member.update',{userId:'deleted-or-hidden-user'})]);
  const observed=await routeWorkspace(page);await page.goto('/');await openRecord(page,'missing-staff-target');
  await expect(page.getByText(/original operator is absent/)).toBeVisible();
  await expect(page.getByRole('region',{name:'Selected staff member'})).toHaveCount(0);
  await expect(page.getByRole('region',{name:'Retained access command'})).toContainText('missing-staff-target');
  expect(observed.posts).toEqual([]);
});

for(const exists of [true,false])test(`retained staff creation ${exists?'selects the server operator by original email':'does not substitute an unrelated operator before confirmation'}`,async({page})=>{
  await seedJournal(page,[command('retained-staff-create','staff.member.create',{email:exists?'bob@example.invalid':'missing@example.invalid',displayName:'New Operator',role:'cashier'})]);
  const observed=await routeWorkspace(page);await page.goto('/');await openRecord(page,'retained-staff-create');
  const selected=page.getByRole('region',{name:'Selected staff member'});
  if(exists)await expect(selected.getByRole('heading',{name:'Bob Original'})).toBeVisible();
  else{await expect(selected).toHaveCount(0);await expect(page.getByText(/original operator is absent/)).toBeVisible();}
  expect(observed.posts).toEqual([]);
});

test('settings recovery selects the clicked settings section and original command',async({page})=>{
  await seedJournal(page,[command('a-retained-business','configuration.business.update',{}),command('b-retained-outlet','configuration.outlet.update',{})]);
  const observed=await routeWorkspace(page);await page.goto('/');await openRecord(page,'b-retained-outlet');
  await expect(page.getByRole('button',{name:'Outlet and receipts',exact:true})).toHaveAttribute('aria-current','page');
  await page.locator('details').filter({hasText:'b-retained-outlet'}).locator('summary').click();
  await expect(page.getByText('b-retained-outlet',{exact:false})).toBeVisible();
  expect(observed.posts).toEqual([]);
});

for(const reason of ['lost-role','other-assignment','unsupported-type'] as const)test(`recovery retains evidence and disables unavailable navigation for ${reason}`,async({page})=>{
  const record=command('blocked-record',reason==='unsupported-type'?'future.command':'staff.member.update',{userId:'bob'});
  if(reason==='other-assignment')record.command.deviceId='another-assignment';
  await seedJournal(page,[record]);
  const observed=await routeWorkspace(page,reason==='lost-role'?['config.view','staff.view']:adminPermissions);await page.goto('/');
  await page.getByRole('button',{name:'Review actions'}).click();
  const dialog=page.getByRole('dialog',{name:'Actions needing review'});
  await expect(dialog.getByRole('button',{name:'Open workspace'})).toBeDisabled();
  await expect(dialog.getByText(reason==='other-assignment'?/original workspace assignment/:/current access or enabled services/)).toBeVisible();
  expect(observed.posts).toEqual([]);expect(observed.staffReads).toBe(0);
  const close=dialog.getByRole('button',{name:'Close actions needing review'});await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');await expect(dialog.getByRole('button',{name:'Check status'})).toBeFocused();
  await page.keyboard.press('Tab');await expect(close).toBeFocused();
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Review actions'})).toBeFocused();
  await page.reload();await page.getByRole('button',{name:'Review actions'}).click();
  await expect(page.getByRole('dialog',{name:'Actions needing review'})).toContainText('blocked-record');
});

test('foreign actor and tenant records never appear in the current recovery list',async({page})=>{
  const foreignActor=command('foreign-actor-record','staff.member.update',{userId:'bob'});foreignActor.actorId='someone-else';
  const foreignTenant=command('foreign-tenant-record','staff.member.update',{userId:'bob'});foreignTenant.command.tenantId='another-tenant';
  await seedJournal(page,[foreignActor,foreignTenant,command('own-record','staff.member.update',{userId:'bob'})]);
  await routeWorkspace(page);await page.goto('/');await page.getByRole('button',{name:'Review actions'}).click();
  const dialog=page.getByRole('dialog',{name:'Actions needing review'});
  await expect(dialog.getByRole('article')).toHaveCount(1);await expect(dialog).toContainText('own-record');await expect(dialog).not.toContainText('foreign-');
});

test('recovery navigation respects an unsaved settings guard with one discard decision',async({page})=>{
  await seedJournal(page,[command('retained-staff-navigation','staff.member.update',{userId:'bob'})]);
  const observed=await routeWorkspace(page);await page.goto('/');
  await page.getByRole('button',{name:'Manage',exact:true}).click();await page.getByRole('button',{name:/Business and outlets/}).click();
  await page.getByLabel('Business name',{exact:true}).fill('Unsaved business');
  await page.getByRole('button',{name:'Review actions'}).click();
  let decisions=0;page.once('dialog',dialog=>{decisions++;void dialog.dismiss();});
  const center=page.getByRole('dialog',{name:'Actions needing review'});await center.getByRole('button',{name:'Open workspace'}).click();
  await expect(center).toBeVisible();expect(decisions).toBe(1);await expect(page.getByLabel('Business name',{exact:true})).toHaveValue('Unsaved business');
  page.once('dialog',dialog=>{decisions++;void dialog.accept();});await center.getByRole('button',{name:'Open workspace'}).click();
  await expect(page.getByRole('heading',{name:'Staff access',exact:true})).toBeVisible();expect(decisions).toBe(2);expect(observed.posts).toEqual([]);
});

test('an active access status request cannot overwrite another recovery selection',async({page})=>{
  await seedJournal(page,[command('a-active-access','staff.member.update',{userId:'alice'}),command('b-next-access','staff.member.update',{userId:'bob'})]);
  const observed=await routeWorkspace(page);
  let release!:()=>void,entered=false;
  const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/v1/commands/a-active-access',async route=>{entered=true;await held;await route.fulfill({json:{commandId:'a-active-access',status:'UNKNOWN',response:{status:'UNKNOWN'}}});});
  await page.goto('/');await openRecord(page,'a-active-access');
  await page.getByRole('region',{name:'Retained access command'}).getByRole('button',{name:'Check access change status',exact:true}).click();
  await expect.poll(()=>entered).toBe(true);
  await page.getByRole('button',{name:'Review actions'}).click();
  const center=page.getByRole('dialog',{name:'Actions needing review'});
  const openNext=center.getByRole('article').filter({hasText:'b-next-access'}).getByRole('button',{name:'Open workspace'});
  await openNext.click();await expect(center).toBeVisible();
  await expect(page.getByRole('region',{name:'Selected staff member'})).toContainText('Alice First');
  release();
  await expect(page.getByRole('region',{name:'Retained access command'}).getByRole('button',{name:'Check access change status',exact:true})).toBeEnabled();
  await openNext.click();await expect(center).toHaveCount(0);
  await expect(page.getByRole('region',{name:'Selected staff member'})).toContainText('Bob Original');
  await expect(page.getByRole('region',{name:'Retained access command'})).toContainText('b-next-access');expect(observed.posts).toEqual([]);
});
