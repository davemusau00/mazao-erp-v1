import { expect, test, type Page } from '@playwright/test';

async function prepare(page:Page) {
  const session={user:{id:'cashier-a',name:'Cashier',email:'cashier@example.test',role:'cashier',permissions:['commerce.sell','commerce.discount','shift.open','shift.close']},tenant:{id:'tenant-pos',name:'Shop',currency:'KES',timeZone:'Africa/Nairobi',capabilities:['commerce','inventory']},outlet:{id:'outlet-pos',name:'Shop counter',timeZone:'Africa/Nairobi'},deviceId:'device-pos',csrfToken:'csrf-pos'};
  await page.route('**/api/v1/auth/me',route=>route.fulfill({json:session}));
  await page.route('**/api/v1/catalog/items',route=>route.fulfill({json:{items:[{id:'item-a',sku:'TEA',name:'Tea',unit:'each',currency:'KES',sellingPriceMinor:10000,taxRateBps:1600,quantity:'10.000000',version:1,productVersion:1}]}}));
  await page.route('**/api/v1/shifts/current',route=>route.fulfill({json:{shift:{id:'shift-a',status:'OPEN',openingFloatMinor:0,cashSalesMinor:0,mpesaSalesMinor:0,customerCollectionsMinor:0,cashRefundsMinor:0,cashPaidInMinor:0,cashPayoutMinor:0,expectedCashMinor:0,version:1,openedAt:new Date().toISOString(),cashMovements:[]}}}));
  await page.route('**/api/v1/sales/orders/*/receipt',route=>route.fulfill({json:{status:'CONFIRMED',fiscalDocumentStatus:'NOT_INTEGRATED',receiptId:'sale-a',receiptNumber:'receipt-a',tenantName:'Shop',outletName:'Shop counter',timeZone:'Africa/Nairobi',currency:'KES',createdAt:new Date().toISOString(),operatorName:'Cashier',saleStatus:'CONFIRMED',lines:[{lineId:'line-a',sku:'TEA',name:'Tea',quantity:'2',unitPriceMinor:'10000',originalSubtotalMinor:'20000',discountMinor:'3000',discountReason:'Customer offer',taxRateBps:1600,subtotalMinor:'17000',taxMinor:'2720',totalMinor:'19720'}],payments:[{method:'MANUAL_MPESA',amountMinor:'19720',currency:'KES',status:'confirmed',reference:'REF12345',confirmation:'CASHIER_CONFIRMED'}],originalSubtotalMinor:'20000',discountMinor:'3000',subtotalMinor:'17000',taxMinor:'2720',totalMinor:'19720',amountPaidMinor:'19720',customerAccountCharge:null,cashTenderedMinor:null,changeMinor:null}}));
  await page.goto('/');
  await page.getByRole('button',{name:/^Sell/}).click();
  await page.getByRole('button',{name:/Tea/}).click();
}

async function discountedBasket(page:Page) {
  await prepare(page);
  await page.getByLabel('Quantity for Tea').fill('2');
  await page.getByText('Item discount',{exact:true}).click();
  await page.getByLabel('Discount amount for Tea').fill('30');
  await page.getByLabel('Discount reason for Tea').fill('Customer offer');
  await page.getByRole('button',{name:'Take payment',exact:true}).click();
  await page.getByRole('button',{name:'M-Pesa',exact:true}).click();
}

test('item discount is one currency amount for the line and M-Pesa requires cashier confirmation',async({page})=>{
  let submitted:any;
  await page.route('**/api/v1/commands',async route=>{submitted=route.request().postDataJSON();await route.fulfill({json:{commandId:submitted.commandId,status:'CONFIRMED',value:{saleId:'sale-a'}}});});
  await discountedBasket(page);
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByText(/Amount due.*197\.20/)).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Confirm payment',exact:true})).toBeDisabled();
  await dialog.getByLabel('M-Pesa transaction reference').fill('ref12345');
  await expect(dialog.getByRole('button',{name:'Confirm payment',exact:true})).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button',{name:'Confirm payment',exact:true}).click();
  await expect.poll(()=>submitted?.type).toBe('sales.order.settle');
  expect(submitted.payload.lines).toEqual([{productId:'item-a',quantity:'2',discountMinor:3000,discountReason:'Customer offer'}]);
  expect(submitted.payload.tenders).toEqual([{method:'MANUAL_MPESA',amountMinor:19720,currency:'KES',reference:'REF12345',manuallyConfirmed:true}]);
  expect(JSON.stringify(submitted)).not.toMatch(/discountPercent|discountRate/);
  await expect(page.getByRole('dialog').getByText('REF12345',{exact:false})).toBeVisible();
});

test('unreadable payment acknowledgement survives reload and checks the original payment without a new submission',async({page})=>{
  const submitted:any[]=[];
  await page.route('**/api/v1/commands',async route=>{submitted.push(route.request().postDataJSON());await route.fulfill({status:200,contentType:'application/json',body:'{broken'});});
  await page.route('**/api/v1/commands/*',async route=>{
    const commandId=route.request().url().split('/').at(-1)!;
    await route.fulfill({json:{commandId,status:'CONFIRMED',response:{commandId,status:'CONFIRMED',value:{saleId:'sale-a'}}}});
  });
  await discountedBasket(page);
  await page.getByLabel('M-Pesa transaction reference').fill('REF12345');
  await page.getByRole('dialog').getByRole('checkbox').check();
  await page.getByRole('button',{name:'Confirm payment',exact:true}).click();
  await expect(page.getByText(/Check its status before repeating it/).first()).toBeVisible();
  await expect(page.getByRole('button',{name:'Confirm payment',exact:true})).toBeDisabled();
  const original=submitted[0].commandId;
  await page.reload();
  await page.getByRole('button',{name:/^Sell/}).click();
  await expect(page.getByRole('button',{name:'Check payment status',exact:true}).first()).toBeVisible();
  const checked=page.waitForRequest(request=>request.url().endsWith('/commands/'+original)&&request.method()==='GET');
  await page.getByRole('button',{name:'Check payment status',exact:true}).first().click();await checked;
  await expect(page.getByRole('dialog').getByText('REF12345',{exact:false})).toBeVisible();
  expect(submitted).toHaveLength(1);
});

test('invalid line discount cannot reach checkout and quantities display without trailing zeroes',async({page})=>{
  await prepare(page);
  await expect(page.getByText('10 each on hand')).toBeVisible();
  await page.getByText('Item discount',{exact:true}).click();
  await page.getByLabel('Discount amount for Tea').fill('101');
  await page.getByLabel('Discount reason for Tea').fill('Customer offer');
  await expect(page.getByRole('button',{name:'Take payment',exact:true})).toBeDisabled();
  await page.getByLabel('Discount amount for Tea').fill('30');
  await page.getByLabel('Discount reason for Tea').fill('');
  await expect(page.getByRole('button',{name:'Take payment',exact:true})).toBeDisabled();
  await expect(page.locator('input[aria-label*="percentage" i]')).toHaveCount(0);
});
