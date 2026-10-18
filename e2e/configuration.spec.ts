import { expect, test, type Page, type TestInfo } from '@playwright/test';

// Browser adapter coverage uses explicit HTTP fixtures. PostgreSQL command
// authority, tenant isolation and receipt snapshots are covered in API tests.
function fixture() {
  return {
    business:{id:'tenant-config-test',name:'COUNTRYSIDE RESORT',currency:'KES',timeZone:'Africa/Nairobi',version:1,legalName:'',registrationNumber:'',taxRegistrationNumber:'',address:'',phone:'',email:'',website:'',logoUrl:'',receiptHeader:'',receiptFooter:'',taxPolicy:{calculation:'exclusive',defaultRateBps:1600,label:'VAT',reviewed:false}},
    outlet:{id:'outlet-config-test',name:'COUNTRYSIDE BAR',timeZone:'Africa/Nairobi',version:1,address:'',phone:'',email:'',receiptHeader:'',receiptFooter:''},
    capabilities:['commerce','inventory'],supportedCapabilities:['commerce','inventory','hospitality','retail'],currencyLocked:true,
    readiness:{readyForFirstSale:false,checks:[{key:'tax',label:'Tax policy reviewed',complete:false,detail:'Review the default tax rate.'}]},
  };
}
type Configuration=ReturnType<typeof fixture>;
const permissions=['config.view','config.manage'];
function session(configuration:Configuration,access=permissions) {
  return {user:{id:'user-config-test',name:'KITULI KASINA',email:'kasina@example.invalid',role:access.includes('config.manage')?'admin':'manager',permissions:access},tenant:{id:configuration.business.id,name:configuration.business.name,currency:configuration.business.currency,timeZone:configuration.business.timeZone,capabilities:configuration.capabilities},outlet:{id:configuration.outlet.id,name:configuration.outlet.name,timeZone:configuration.outlet.timeZone},deviceId:'device-config-test',csrfToken:'csrf-config-test'};
}
async function routeReads(page:Page,configuration:Configuration,access=permissions) {
  await page.route('**/api/v1/auth/me',route=>route.fulfill({json:session(configuration,access)}));
  await page.route('**/api/v1/configuration',route=>route.fulfill({json:{configuration}}));
}
async function openManage(page:Page) {
  await page.goto('/');
  await expect(page.getByLabel('Signed in as KITULI KASINA')).toBeVisible();
  const manage=page.getByRole('button',{name:'Manage',exact:true});
  if(!await manage.isVisible())await page.getByRole('button',{name:'More',exact:true}).click();
  await page.getByRole('button',{name:'Manage',exact:true}).last().click();
  await expect(page.getByRole('heading',{name:'Manage your business'})).toBeVisible();
  await page.getByRole('button',{name:/Business and outlets/}).click();
  await expect(page.getByLabel('Business name',{exact:true})).toHaveValue('COUNTRYSIDE RESORT');
}

// A real IndexedDB transaction holds the journal while HTTP reads can finish.
// This exposes the race between loading current projections and recovery evidence.
async function holdCommandJournal(page:Page) {
  await page.evaluate(async()=>{
    await new Promise<void>((resolve,reject)=>{
      const request=indexedDB.open('mazao-v1-command-journal',1);
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('commands'))request.result.createObjectStore('commands',{keyPath:'command.commandId'});};
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const database=request.result;
        const transaction=database.transaction('commands','readwrite');
        const store=transaction.objectStore('commands');
        let hold=true,entered=false;
        (window as any).releaseJournalForTest=()=>{hold=false;};
        const keepActive=()=>{
          const read=store.get('__journal-read-lock-test__');
          read.onsuccess=()=>{
            if(!entered){entered=true;resolve();}
            if(hold)keepActive();
          };
          read.onerror=()=>reject(read.error);
        };
        transaction.oncomplete=()=>database.close();
        transaction.onabort=()=>{database.close();reject(transaction.error);};
        keepActive();
      };
    });
  });
}

test('settings stay locked until recovery evidence is checked and a configured 100 percent policy can be resaved',async({page})=>{
  const configuration=fixture();configuration.business.taxPolicy.defaultRateBps=10000;
  await routeReads(page,configuration);
  let submitted:Record<string,any>|undefined;
  await page.route('**/api/v1/commands',route=>{
    submitted=route.request().postDataJSON();
    configuration.business={...configuration.business,...submitted!.payload,version:2};
    return route.fulfill({json:{commandId:submitted!.commandId,status:'CONFIRMED',value:{version:2}}});
  });
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Manage',exact:true})).toBeVisible();
  await holdCommandJournal(page);
  await page.getByRole('button',{name:'Manage',exact:true}).click();
  await page.getByRole('button',{name:/Business and outlets/}).click();
  await expect(page.getByLabel('Default tax rate (%)')).toHaveValue('100.00');
  await expect(page.getByLabel('Business name',{exact:true})).toBeDisabled();
  await expect(page.getByText('Checking for unfinished settings changes...')).toBeVisible();
  await page.evaluate(()=>(window as any).releaseJournalForTest());
  await expect(page.getByLabel('Business name',{exact:true})).toBeEnabled();
  await page.getByLabel('Legal business name').fill('Maximum rate policy');
  await page.getByRole('button',{name:'Save business settings'}).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  expect(submitted?.payload.taxPolicy.defaultRateBps).toBe(10000);
});

test('cash checkout waits for retained command evidence even when the catalog and shift are ready',async({page})=>{
  const configuration=fixture();
  await routeReads(page,configuration,['commerce.sell','shift.open','shift.close']);
  await page.route('**/api/v1/catalog/items',route=>route.fulfill({json:{items:[{id:'item-recovery-test',sku:'RECOVERY-SKU',name:'Recovery item',unit:'each',currency:'KES',sellingPriceMinor:10000,taxRateBps:1600,quantity:'10',version:1}]}}));
  await page.route('**/api/v1/shifts/current',route=>route.fulfill({json:{shift:{id:'shift-recovery-test',status:'OPEN',openingFloatMinor:0,cashSalesMinor:0,customerCollectionsMinor:0,cashRefundsMinor:0,cashPaidInMinor:0,cashPayoutMinor:0,expectedCashMinor:0,version:1,openedAt:'2026-10-14T10:00:00Z',cashMovements:[]}}}));
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Sell',exact:true}).first()).toBeVisible();
  await holdCommandJournal(page);
  await page.getByRole('button',{name:'Sell',exact:true}).first().click();
  await page.getByRole('button',{name:/Recovery item RECOVERY-SKU/}).click();
  await expect(page.getByRole('button',{name:'Take payment',exact:true})).toBeDisabled();
  await expect(page.getByText('Checking for payments that need review…')).toBeVisible();
  await page.evaluate(()=>(window as any).releaseJournalForTest());
  await expect(page.getByRole('button',{name:'Take payment',exact:true})).toBeEnabled();
});

test('administrator settings submit exact versioned commands and persist across reload',async({page})=>{
  const configuration=fixture();
  await routeReads(page,configuration);
  let captured:Record<string,any>|undefined;
  await page.route('**/api/v1/commands',async route=>{
    captured=route.request().postDataJSON();
    expect(route.request().headers()['x-csrf-token']).toBe('csrf-config-test');
    configuration.business={...configuration.business,...captured!.payload,version:2};
    await route.fulfill({json:{commandId:captured!.commandId,status:'CONFIRMED',value:{version:2}}});
  });
  await openManage(page);
  await expect(page.getByLabel('Currency (ISO code)')).toBeDisabled();
  await page.getByLabel('Legal business name').fill('Countryside Resort Limited');
  await page.getByLabel('Contact phone').fill('+254700123456');
  await page.getByLabel('Receipt footer',{exact:true}).fill('Thank you for visiting Countryside.');
  await page.getByLabel('Default tax rate (%)').fill('16.25');
  await page.getByLabel('I have reviewed this business tax policy').check();
  await page.getByRole('button',{name:'Save business settings'}).click();
  await expect(page.getByRole('status')).toContainText('Settings saved.');
  expect(captured).toMatchObject({protocolVersion:1,type:'configuration.business.update',tenantId:configuration.business.id,deviceId:'device-config-test',expectedVersions:{['business:'+configuration.business.id]:1},payload:{legalName:'Countryside Resort Limited',phone:'+254700123456',receiptFooter:'Thank you for visiting Countryside.',taxPolicy:{defaultRateBps:1625,calculation:'exclusive',reviewed:true}}});
  await page.reload();
  await page.getByRole('button',{name:'Manage',exact:true}).click();
  await page.getByRole('button',{name:/Business and outlets/}).click();
  await expect(page.getByLabel('Legal business name')).toHaveValue('Countryside Resort Limited');
  await expect(page.getByLabel('Default tax rate (%)')).toHaveValue('16.25');
  await expect(page.getByRole('button',{name:'Save business settings'})).toBeDisabled();
});

test('unknown settings outcome survives reload and retries the original command unchanged',async({page})=>{
  const configuration=fixture();await routeReads(page,configuration);
  const attempts:Record<string,any>[]=[];
  await page.route('**/api/v1/commands',async route=>{
    const submitted=route.request().postDataJSON();attempts.push(submitted);
    if(attempts.length===1)return route.abort('failed');
    configuration.business={...configuration.business,...submitted.payload,version:2};
    return route.fulfill({json:{commandId:submitted.commandId,status:'CONFIRMED',value:{version:2}}});
  });
  await openManage(page);
  await page.getByLabel('Business name',{exact:true}).fill('Countryside Updated');
  await page.getByRole('button',{name:'Save business settings'}).click();
  await expect(page.getByRole('heading',{name:'Check settings save status'})).toBeVisible();
  await expect(page.getByLabel('Business name',{exact:true})).toBeDisabled();
  await page.reload();await page.getByRole('button',{name:'Manage',exact:true}).click();
  await page.getByRole('button',{name:/Business and outlets/}).click();
  await expect(page.getByRole('heading',{name:'Check settings save status'})).toBeVisible();
  await page.getByText('Support reference', { exact:true }).last().click();
  await expect(page.getByText('Reference '+attempts[0].commandId,{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Retry original action'}).click();
  await expect(page.getByRole('heading',{name:'Check settings save status'})).toHaveCount(0);
  await expect(page.getByLabel('Business name',{exact:true})).toHaveValue('Countryside Updated');
  expect(attempts).toHaveLength(2);expect(attempts[1]).toEqual(attempts[0]);
});

test('status lookup confirms a retained command without submitting another command',async({page})=>{
  const configuration=fixture();await routeReads(page,configuration);
  let original:Record<string,any>|undefined;
  let postCount=0;
  await page.route('**/api/v1/commands',route=>{original=route.request().postDataJSON();postCount++;configuration.outlet={...configuration.outlet,...original!.payload,version:2};return route.abort('failed');});
  await page.route('**/api/v1/commands/*',route=>route.fulfill({json:{commandId:original!.commandId,status:'CONFIRMED',response:{commandId:original!.commandId,status:'CONFIRMED',value:{version:2}}}}));
  await openManage(page);await page.getByRole('button',{name:'Outlet and receipts',exact:true}).click();
  await page.getByLabel('Outlet address').fill('Machakos, Kenya');
  await page.getByRole('button',{name:'Save outlet settings'}).click();
  await expect(page.getByRole('heading',{name:'Check settings save status'})).toBeVisible();
  await page.getByRole('button',{name:'Check status',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Settings saved.');
  await expect(page.getByLabel('Outlet address')).toHaveValue('Machakos, Kenya');expect(postCount).toBe(1);
});

test('version conflict preserves edited fields until operator reloads server settings',async({page})=>{
  const configuration=fixture();await routeReads(page,configuration);
  await page.route('**/api/v1/commands',route=>{configuration.business.legalName='Changed on another device';configuration.business.version=2;return route.fulfill({json:{commandId:route.request().postDataJSON().commandId,status:'CONFLICT',code:'VERSION_CONFLICT',message:'Business configuration changed. Review current settings before saving.'}});});
  await openManage(page);await page.getByLabel('Legal business name').fill('My unsaved revision');
  await page.getByRole('button',{name:'Save business settings'}).click();
  await expect(page.getByLabel('Legal business name')).toHaveValue('My unsaved revision');
  await expect(page.getByRole('button',{name:'Save business settings'})).toBeDisabled();
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Reload settings'}).click();
  await expect(page.getByLabel('Legal business name')).toHaveValue('Changed on another device');
  await expect(page.getByText('Changes saved',{exact:true})).toBeVisible();
});

test('configuration readers cannot change settings and unauthorized operators cannot navigate to Manage',async({page})=>{
  const configuration=fixture();await routeReads(page,configuration,['config.view']);await openManage(page);
  await expect(page.getByLabel('Business name',{exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Save business settings'})).toBeDisabled();
  await page.getByRole('button',{name:'Capabilities',exact:true}).click();
  await expect(page.getByLabel('Rooms and guest stays')).toBeDisabled();
  await page.route('**/api/v1/auth/me',route=>route.fulfill({json:session(configuration,[])}));
  await page.reload();await expect(page.getByRole('button',{name:'Manage',exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Manage your business'})).toHaveCount(0);
});

test('malformed successful configuration JSON is reported and Retry reloads the panel',async({page})=>{
  const configuration=fixture();await page.route('**/api/v1/auth/me',route=>route.fulfill({json:session(configuration)}));
  await page.addInitScript(()=>{(window as any).__apiTimings=[];window.addEventListener('mazao:api-request-completed',(event:Event)=>(window as any).__apiTimings.push((event as CustomEvent).detail));});
  let reads=0;
  await page.route('**/api/v1/configuration',route=>{reads++;return reads===1?route.fulfill({status:200,contentType:'application/json',headers:{'x-request-id':'req-fixture-config-1'},body:'{"configuration":'}):route.fulfill({json:{configuration},headers:{'x-request-id':'req-fixture-config-2','server-timing':'app;dur=1.4, nginx;dur=2.1'}});});
  await page.goto('/');await page.getByRole('button',{name:'Manage',exact:true}).click();await page.getByRole('button',{name:/Business and outlets/}).click();
  await expect(page.getByRole('alert')).toContainText('load this information correctly');
  await page.getByText('Support references (1)').click();
  await expect(page.getByText('req-fixture-config-1',{exact:true})).toBeVisible();
  await expect(page.getByText('/configuration',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Retry loading settings'})).toBeVisible();
  await page.getByRole('button',{name:'Retry loading settings'}).click();
  await expect(page.getByLabel('Business name',{exact:true})).toHaveValue('COUNTRYSIDE RESORT');
  const timing=await page.evaluate(()=>(window as any).__apiTimings.find((entry:any)=>entry.requestId==='req-fixture-config-2'));
  expect(timing).toMatchObject({requestId:'req-fixture-config-2',status:200,serverAppMs:1.4,serverNginxMs:2.1});
  expect(timing.parseMs).toBeGreaterThanOrEqual(0);
  expect(timing.responseBytes).toBeGreaterThan(0);expect(timing.headersMs).toBeGreaterThanOrEqual(0);expect(timing.bodyMs).toBeGreaterThanOrEqual(0);
  expect(reads).toBe(2);
});

test('workspace timing separates the React commit from the first usable state',async({page})=>{
  const configuration=fixture();await routeReads(page,configuration);
  await page.addInitScript(()=>{
    (window as any).__workspaceTimings=[];
    for(const name of ['mazao:workspace-rendered','mazao:workspace-render-cycle','mazao:workspace-first-usable'])window.addEventListener(name,(event:Event)=>(window as any).__workspaceTimings.push({name,detail:(event as CustomEvent).detail}));
  });
  await page.goto('/');await page.getByRole('button',{name:'Manage',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Manage your business'})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>(window as any).__workspaceTimings.some((entry:any)=>entry.name==='mazao:workspace-first-usable'&&entry.detail.workspace==='manage'))).toBe(true);
  const timings=await page.evaluate(()=>(window as any).__workspaceTimings.filter((entry:any)=>entry.detail.workspace==='manage'));
  expect(timings.find((entry:any)=>entry.name==='mazao:workspace-rendered')?.detail.durationMs).toBeGreaterThanOrEqual(0);
  expect(timings.find((entry:any)=>entry.name==='mazao:workspace-render-cycle')?.detail.durationMs).toBeGreaterThanOrEqual(0);
  expect(timings.find((entry:any)=>entry.name==='mazao:workspace-first-usable')?.detail).toMatchObject({workspace:'manage',outcome:'ready',blockingReadCount:0});
});

test('staff stays usable when the independent business configuration read fails',async({page})=>{
  const configuration=fixture();
  await page.route('**/api/v1/auth/me',route=>route.fulfill({json:session(configuration,[...permissions,'staff.view'])}));
  await page.route('**/api/v1/configuration',route=>route.abort());
  await page.route('**/api/v1/staff',route=>route.fulfill({json:{staff:[],roles:[{role:'admin',label:'Administrator',permissions:['staff.manage','devices.manage'],assignable:false}],outlets:[{id:configuration.outlet.id,name:configuration.outlet.name,timeZone:configuration.outlet.timeZone,active:true}],authorizationModel:'COARSE_ROLE_MAP'}}));
  await page.goto('/');await page.getByRole('button',{name:'Manage',exact:true}).click();
  await page.getByRole('heading',{name:'Manage your business'}).waitFor();
  await page.locator('.manage-grid').getByRole('button',{name:/^Staff/}).click();
  await expect(page.getByRole('heading',{name:'Staff access'})).toBeVisible();
  await expect(page.getByText('No staff memberships are recorded for this business.')).toBeVisible();
  await expect(page.getByRole('alert').filter({hasText:'Retry loading settings'})).toBeVisible();
});

test('business logo uploads separately and the versioned command stores only its asset reference',async({page})=>{
  const configuration=fixture();await routeReads(page,configuration);
  const onePixelPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/xR8AAAAASUVORK5CYII=','base64');
  let uploaded:Record<string,any>|undefined;let command:Record<string,any>|undefined;
  await page.route('**/api/v1/configuration/assets',route=>{uploaded=route.request().postDataJSON();return route.fulfill({json:{asset:{id:'asset-logo-test',kind:'logo',sha256:'a'.repeat(64),byteLength:onePixelPng.length}}});});
  await page.route('**/api/v1/commands',route=>{command=route.request().postDataJSON();return route.fulfill({json:{commandId:command!.commandId,status:'CONFIRMED',value:{version:2}}});});
  await openManage(page);
  await page.getByLabel('Upload business logo PNG').setInputFiles({name:'logo.png',mimeType:'image/png',buffer:onePixelPng});
  await page.getByRole('button',{name:'Save business settings'}).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  expect(uploaded).toMatchObject({kind:'logo',dataUrl:`data:image/png;base64,${onePixelPng.toString('base64')}`});
  expect(command?.payload.imageActions).toEqual({logo:{mode:'replace',assetId:'asset-logo-test'},receiptQr:{mode:'keep'}});
  expect(JSON.stringify(command?.payload)).not.toContain('data:image/png;base64,');
});

test('management overview exposes connected setup and disabled admin modules without opening unsupported actions',async({page})=>{
  const configuration=fixture();await routeReads(page,configuration,[...permissions,'catalog.manage','staff.view','devices.view']);
  await page.route('**/api/v1/catalog/items',route=>route.fulfill({json:{items:[]}}));
  await page.route('**/api/v1/inventory/movements',route=>route.fulfill({json:{movements:[]}}));
  await page.route('**/api/v1/catalog/imports',route=>route.fulfill({json:{batches:[]}}));
  await page.goto('/');
  await page.getByRole('button',{name:'Manage',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Manage your business'})).toBeVisible();
  for(const label of ['Roles and permissions','Assets and maintenance','Supplier accounts and payables','Connection and recovery','Payment reconciliation']){
    const card=page.getByRole('button',{name:new RegExp("^"+label)});
    await expect(card).toBeDisabled();
    await expect(card).toContainText('Unavailable');
  }
  for(const label of ['Staff','Workspace assignments']){
    const card=page.getByRole('button',{name:new RegExp("^"+label)});
    await expect(card).toBeEnabled();
    await expect(card).toContainText('Available');
  }
  const grid=page.locator('.manage-grid');
  for(const label of ['Business and outlets','Data import','Business capabilities','Setup checklist','Outlet and receipts'])
    await expect(grid.getByRole('button',{name:new RegExp("^"+label)})).toBeEnabled();
  await page.getByRole('button',{name:'Setup checklist, Limited',exact:true}).click();
  await expect(page.getByRole('heading',{name:'First sale checklist'})).toBeVisible();
  await expect(page.getByText('Complete the remaining setup checks before selling.')).toBeVisible();
  await page.getByRole('button',{name:'Manage',exact:true}).click();
  await page.locator('.manage-grid').getByRole('button',{name:/Data import/}).click();
  await expect(page.getByRole('heading',{name:'Import products from CSV'})).toBeVisible();
});

test('opening Setup checklist from the workspace navigation loads its checklist section',async({page})=>{
  const configuration=fixture();await routeReads(page,configuration);
  let configurationReads=0;
  await page.unroute('**/api/v1/configuration');
  await page.route('**/api/v1/configuration',route=>{configurationReads++;return route.fulfill({json:{configuration}});});
  await page.goto('/');
  await page.getByRole('button',{name:'Manage',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Manage your business'})).toBeVisible();
  await page.getByRole('button',{name:'Setup checklist, Limited',exact:true}).click();
  await expect(page.getByText('Complete the remaining setup checks before selling.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Setup checklist, Limited',exact:true})).toHaveAttribute('aria-current','page');
  expect(configurationReads).toBeGreaterThanOrEqual(2);
});

test('internal workspace navigation cancels the obsolete shift status read',async({page})=>{
  const configuration=fixture();await routeReads(page,configuration,['shift.open','shift.close']);
  let currentReads=0;let cancelledReads=0;
  page.on('requestfailed',request=>{if(request.url().endsWith('/api/v1/shifts/current'))cancelledReads++;});
  await page.route('**/api/v1/shifts/current',async route=>{
    currentReads++;
    if(currentReads===1){await new Promise(resolve=>setTimeout(resolve,1500));await route.fulfill({json:{shift:null}}).catch(()=>{});return;}
    await route.fulfill({json:{shift:null}});
  });
  await page.route('**/api/v1/shifts/close-reports',route=>route.fulfill({json:{reports:[]}}));
  await page.goto('/');await expect.poll(()=>currentReads).toBe(1);
  await page.getByRole('button',{name:'Open a shift',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Cash control'})).toBeVisible();
  await expect.poll(()=>cancelledReads).toBeGreaterThan(0);
  await expect.poll(()=>currentReads).toBe(2);
});

test('cashier navigation shows unsupported restaurant work as disabled and keeps management private',async({page})=>{
  const configuration=fixture();await routeReads(page,configuration,['commerce.sell']);await page.goto('/');
  const service=page.getByRole('button',{name:/Tables & kitchen/});
  await expect(service).toBeDisabled();
  await expect(service).toHaveAttribute('aria-disabled','true');
  await expect(page.getByRole('button',{name:'Manage',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:/Money/})).toHaveCount(0);
});

test('management overview screenshots cover mobile, tablet and terminal viewports',async({page},testInfo:TestInfo)=>{
  const configuration=fixture();await routeReads(page,configuration,[...permissions,'catalog.manage','staff.view','devices.view']);await page.goto('/');
  await page.getByRole('button',{name:'Manage',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Manage your business'})).toBeVisible();
  for(const viewport of [{width:390,height:844},{width:800,height:1280},{width:1024,height:600},{width:1280,height:720},{width:1280,height:800},{width:1366,height:768},{width:1920,height:1080}]){
    await page.setViewportSize(viewport);
    await testInfo.attach(`manage-overview-${viewport.width}x${viewport.height}.png`,{body:await page.screenshot({fullPage:false}),contentType:'image/png'});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  }
});

for(const viewport of [{width:1024,height:600},{width:390,height:844}])test(`business settings actions remain accessible at ${viewport.width}x${viewport.height}`,async({page})=>{
  await page.setViewportSize(viewport);const configuration=fixture();await routeReads(page,configuration);await openManage(page);
  await page.getByLabel('Business name',{exact:true}).fill('COUNTRYSIDE RESORT UPDATED');
  const save=page.getByRole('button',{name:'Save business settings'});await save.scrollIntoViewIfNeeded();await expect(save).toBeVisible();
  const bounds=await save.boundingBox();expect(bounds).not.toBeNull();expect(bounds!.width).toBeGreaterThan(44);expect(bounds!.height).toBeGreaterThanOrEqual(44);expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(viewport.width);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
});
