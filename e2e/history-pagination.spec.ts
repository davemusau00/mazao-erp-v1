import {expect,test} from '@playwright/test';

const session={user:{id:'history-user',name:'History owner',email:'history@example.invalid',role:'owner',permissions:['catalog.manage','inventory.receive','inventory.shortfall.view','inventory.shortfall.resolve','finance.view','commerce.sell','shift.open','shift.close']},tenant:{id:'history-tenant',name:'History business',currency:'KES',timeZone:'Africa/Nairobi',capabilities:['inventory','commerce']},outlet:{id:'history-outlet',name:'History outlet',timeZone:'Africa/Nairobi'},deviceId:'history-device',csrfToken:'history-csrf'};
const pageInfo=(totalCount:number,nextCursor:string|null)=>({asOf:'2026-10-20T09:00:00Z',totalCount,nextCursor,hasMore:!!nextCursor,limit:2});
const movement=(index:number)=>({id:`movement-${index}`,timestamp:'2026-10-20T08:00:00Z',sku:`SKU-${index}`,productName:`History item ${index}`,type:'restock',quantity:'1',balanceAfter:String(index),note:`Evidence ${index}`,reference:`Evidence ${index}`});

test('stock movement history retries a failed continuation and searches all server records',async({page})=>{
  const calls:string[]=[];let attempts=0;
  await page.route('**/api/v1/**',route=>{
    const url=new URL(route.request().url()),path=url.pathname.replace('/api/v1','');
    if(path==='/auth/me')return route.fulfill({json:session});
    if(path==='/catalog/items')return route.fulfill({json:{items:[]}});
    if(path==='/inventory/movements'){
      calls.push(url.search);const older=url.searchParams.has('after'),searched=url.searchParams.has('q');
      if(older&&++attempts===1)return route.fulfill({status:503,json:{error:{code:'DATABASE_UNAVAILABLE',message:'Older movement read interrupted.'}}});
      return route.fulfill({json:{movements:older||searched?[movement(251)]:[movement(1),movement(2)],page:pageInfo(searched?1:251,older||searched?null:'older-movements')}});
    }
    return route.fulfill({status:404,json:{error:{code:'NOT_FOUND',message:path}}});
  });
  await page.goto('/');await page.getByRole('button',{name:'Stock',exact:true}).click();
  const history=page.locator('section').filter({has:page.getByRole('heading',{name:'Recent stock movements',exact:true})});
  await history.getByRole('button',{name:'Load older records'}).click();
  await expect(history.getByRole('alert')).toContainText('Mazao is temporarily unavailable.');
  await history.getByRole('button',{name:'Retry movement history'}).click();
  await expect(history.getByText('History item 251',{exact:true})).toBeVisible();
  await history.getByRole('textbox',{name:'Search stock movements'}).fill('item 251');await history.getByRole('button',{name:'Search records'}).click();
  await expect(history.getByText('1 shown of 1 matching records',{exact:true})).toBeVisible();
  expect(calls.filter(value=>value==='?after=older-movements')).toHaveLength(2);expect(calls).toContain('?q=item+251');
});

test('returning from import cancels the earlier stock read before showing newer history',async({page})=>{
  let catalogReads=0,movementReads=0,releaseFirst!:()=>void;
  const held=new Promise<void>(resolve=>{releaseFirst=resolve;});
  await page.route('**/api/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname.replace('/api/v1','');
    if(path==='/auth/me')return route.fulfill({json:session});
    if(path==='/catalog/items'){
      if(++catalogReads===1)await held;
      try{return await route.fulfill({json:{items:[]}});}catch{return;}
    }
    if(path==='/inventory/movements')return route.fulfill({json:{movements:[movement(++movementReads===1?1:251)],page:pageInfo(1,null)}});
    if(path==='/catalog/imports')return route.fulfill({json:{batches:[]}});
    return route.fulfill({status:404,json:{error:{code:'NOT_FOUND',message:path}}});
  });
  await page.goto('/');await page.getByRole('button',{name:'Stock',exact:true}).click();
  await expect.poll(()=>catalogReads).toBe(1);
  const cancelled=page.waitForEvent('requestfailed',request=>new URL(request.url()).pathname==='/api/v1/catalog/items');
  await page.getByRole('button',{name:'Import products',exact:true}).click();await page.getByRole('button',{name:'Back to stock',exact:true}).click();
  expect((await cancelled).failure()?.errorText).toMatch(/abort|cancel/i);
  await expect(page.getByText('History item 251',{exact:true})).toBeVisible();
  releaseFirst();await expect.poll(()=>catalogReads).toBe(2);
  await expect(page.getByText('History item 1',{exact:true})).toHaveCount(0);
  await expect(page.getByText('History item 251',{exact:true})).toBeVisible();
});

test('shift history reaches older cash movements and displays the selected immutable close report',async({page})=>{
  const report=(index:number)=>({id:`report-${index}`,shiftId:`shift-${index}`,commandId:`command-${index}`,operatorId:'history-user',operatorName:`Closer ${index}`,tenantName:'History business',outletName:'History outlet',timeZone:'Africa/Nairobi',businessDate:'2026-10-20',currency:'KES',shiftVersion:2,openedAt:'2026-10-20T07:00:00Z',closedAt:'2026-10-20T08:00:00Z',openingFloatMinor:'0',cashSalesMinor:String(index*100),customerCollectionsMinor:'0',cashRefundsMinor:'0',cashPaidInMinor:'0',cashPayoutMinor:'0',expectedCashMinor:String(index*100),countedCashMinor:String(index*100),varianceMinor:'0'});
  const cash=(index:number)=>({id:`cash-${index}`,movementType:'PAID_IN',amountMinor:index,reason:`Cash reason ${index}`,reference:null,actorName:'History owner',createdAt:'2026-10-20T08:00:00Z'});
  await page.route('**/api/v1/**',route=>{
    const url=new URL(route.request().url()),path=url.pathname.replace('/api/v1','');
    if(path==='/auth/me')return route.fulfill({json:session});
    if(path==='/shifts/current')return route.fulfill({json:{shift:{id:'open-shift',status:'OPEN',openingFloatMinor:0,cashSalesMinor:0,customerCollectionsMinor:0,cashRefundsMinor:0,cashPaidInMinor:0,cashPayoutMinor:0,expectedCashMinor:0,version:1,openedAt:'2026-10-20T07:00:00Z',cashMovements:[cash(1)],cashMovementPage:pageInfo(101,'older-cash')}}});
    if(path==='/shifts/open-shift/cash-movements')return route.fulfill({json:{movements:[cash(101)],page:pageInfo(101,null)}});
    if(path==='/shifts/close-reports')return route.fulfill({json:{reports:[report(url.searchParams.has('after')?51:1)],page:pageInfo(51,url.searchParams.has('after')?null:'older-reports')}});
    return route.fulfill({status:404,json:{error:{code:'NOT_FOUND',message:path}}});
  });
  await page.goto('/');await page.getByRole('button',{name:/^Shifts/}).click();
  await page.getByRole('region',{name:'Till movement history navigation'}).getByRole('button',{name:'Load older records'}).click();
  await expect(page.getByText('Cash reason 101',{exact:true})).toBeVisible();
  const history=page.getByRole('region',{name:'Close report history'});await history.getByRole('button',{name:'Load older records'}).click();
  await history.getByRole('button',{name:/Closer 51/}).click();
  const reportView=page.locator('section[aria-labelledby="z-report-title"]');await expect(reportView).toContainText('Closer 51');await expect(reportView).toContainText(/KES\s+51(?:\D|$)/);
});

test('exception evidence picker reaches the 101st record and labels top-100 summaries',async({page})=>{
  const secondEvidenceQueries:string[]=[];
  const evidence=(index:number)=>({id:`evidence-${index}`,createdAt:'2026-10-20T08:00:00Z',type:'RECEIPT',quantity:'1',availableQuantity:'1',documentReference:`Delivery ${index}`});
  const exception={id:'exception-1',createdAt:'2026-10-20T08:00:00Z',sale:{orderId:'sale-1',receiptNumber:'receipt-1',soldAt:'2026-10-20T08:00:00Z'},product:{id:'product-1',sku:'SKU-1',name:'Short item'},operator:{id:'history-user',name:'History owner'},recordedQuantityBefore:'0',requestedQuantity:'1',quantity:'1',resolvedQuantity:'0',remainingQuantity:'1',currentStock:'1',reasonCode:'SUSPECTED_UNRECORDED_DELIVERY',reasonNote:null,status:'OPEN',version:1,balanceVersion:1,resolutions:[]};
  await page.route('**/api/v1/**',route=>{
    const url=new URL(route.request().url()),path=url.pathname.replace('/api/v1','');
    if(path==='/auth/me')return route.fulfill({json:session});
    if(path==='/catalog/items')return route.fulfill({json:{items:[]}});
    if(path==='/inventory/movements')return route.fulfill({json:{movements:[]}});
    if(path==='/reports/stock-exceptions')return route.fulfill({json:{scope:'OUTLET',outletId:'history-outlet',outletName:'History outlet',currency:'KES',timeZone:'Africa/Nairobi',from:'2026-10-01',to:'2026-10-20',totals:{createdEvents:'1',createdQuantity:'1',affectedSales:'1',affectedProducts:'1',unresolvedQuantityNow:'1',oldestOpenAt:null,resolutionsInPeriod:'0',resolvedQuantityInPeriod:'0'},byOperator:[],byProduct:[],coverage:{completeTotals:true,costVisible:true,policy:'Top 100'}}});
    if(path==='/inventory/shortfalls')return route.fulfill({json:{items:[1,2].map(index=>({id:`exception-${index}`,productName:index===1?'Short item':'Second short item',sku:`SKU-${index}`,receiptNumber:`receipt-${index}`,operatorName:'History owner',createdAt:exception.createdAt,reasonCode:exception.reasonCode,quantity:'1',status:'OPEN'})),totalOnPage:2,limit:50,nextAfter:null}});
    if(path==='/inventory/shortfalls/exception-1')return route.fulfill({json:{exception}});
    if(path==='/inventory/shortfalls/exception-1/evidence')return route.fulfill({json:{evidence:[evidence(url.searchParams.has('after')?101:1)],page:pageInfo(101,url.searchParams.has('after')?null:'older-evidence')}});
    if(path==='/inventory/shortfalls/exception-2')return route.fulfill({json:{exception:{...exception,id:'exception-2',product:{id:'product-2',sku:'SKU-2',name:'Second short item'}}}});
    if(path==='/inventory/shortfalls/exception-2/evidence'){secondEvidenceQueries.push(url.search);return route.fulfill({json:{evidence:[evidence(2)],page:pageInfo(101,'older-second')}});}
    return route.fulfill({status:404,json:{error:{code:'NOT_FOUND',message:path}}});
  });
  await page.goto('/');await page.getByRole('button',{name:'Stock',exact:true}).click();await page.locator('#main-content').getByRole('button',{name:'Stock exceptions',exact:true}).click();
  await expect(page.getByRole('heading',{name:'By item (top 100)'})).toBeVisible();
  await page.getByRole('button',{name:/Short item · SKU-1/}).click();
  await page.getByRole('button',{name:'Load older records',exact:true}).click();
  await page.getByLabel('Supporting inventory record').selectOption('evidence-101');
  await expect(page.getByLabel('Document reference (optional)')).toHaveValue('Delivery 101');
  await page.getByRole('button',{name:/Second short item · SKU-2/}).click();
  await expect(page.getByLabel('Document reference (optional)')).toHaveValue('Delivery 2');
  await page.getByRole('button',{name:'Retry evidence read',exact:true}).click();
  await expect.poll(()=>secondEvidenceQueries.length).toBe(2);
  expect(secondEvidenceQueries).toEqual(['','']);
});
