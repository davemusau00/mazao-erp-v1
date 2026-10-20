import {expect,test} from '@playwright/test';

test('POS requires per-item physical confirmation and a reason for an enabled stock exception sale',async({page})=>{
  let submitted:any;
  const session={user:{id:'cashier-a',name:'Cashier',email:'cashier@example.test',role:'cashier',permissions:['commerce.sell','shift.open','shift.close']},tenant:{id:'tenant-pos',name:'Shop',currency:'KES',timeZone:'Africa/Nairobi',capabilities:['commerce','inventory']},outlet:{id:'outlet-pos',name:'Shop counter',timeZone:'Africa/Nairobi'},deviceId:'device-pos',csrfToken:'csrf-pos'};
  await page.route('**/api/v1/auth/me',route=>route.fulfill({json:session}));
  await page.route('**/api/v1/catalog/items',route=>route.fulfill({json:{items:[{id:'item-a',sku:'TEA',name:'Tea',unit:'each',currency:'KES',sellingPriceMinor:10000,taxRateBps:1600,quantity:'1.000000',version:1,productVersion:1}]}}));
  await page.route('**/api/v1/shifts/current',route=>route.fulfill({json:{shift:{id:'shift-a',status:'OPEN',openingFloatMinor:0,cashSalesMinor:0,mpesaSalesMinor:0,customerCollectionsMinor:0,cashRefundsMinor:0,cashPaidInMinor:0,cashPayoutMinor:0,expectedCashMinor:0,version:1,openedAt:new Date().toISOString(),cashMovements:[]}}}));
  await page.route('**/api/v1/configuration/stock-sale-policy',route=>route.fulfill({json:{policy:{enabled:true,requirePhysicalConfirmation:true,requireReason:true,allowZeroReferenceCost:true,version:1,updatedBy:null,updatedByName:null,updatedAt:null}}}));
  await page.route('**/api/v1/commands',async route=>{submitted=route.request().postDataJSON();await route.fulfill({json:{commandId:submitted.commandId,status:'CONFIRMED',value:{saleId:'sale-a'}}});});
  await page.route('**/api/v1/sales/orders/sale-a/receipt',route=>route.fulfill({json:{status:'CONFIRMED',fiscalDocumentStatus:'NOT_INTEGRATED',receiptId:'sale-a',receiptNumber:'receipt-a',tenantName:'Shop',outletName:'Shop counter',timeZone:'Africa/Nairobi',currency:'KES',createdAt:new Date().toISOString(),operatorName:'Cashier',saleStatus:'CONFIRMED',lines:[],payments:[],originalSubtotalMinor:'20000',discountMinor:'0',subtotalMinor:'20000',taxMinor:'3200',totalMinor:'23200',amountPaidMinor:'23200',customerAccountCharge:null,cashTenderedMinor:'23200',changeMinor:'0'}}));
  await page.goto('/');await page.getByRole('button',{name:/^Sell/}).click();await page.getByRole('button',{name:/Tea/}).click();
  await page.getByLabel('Quantity for Tea').fill('2');await page.getByRole('button',{name:'Take payment',exact:true}).click();
  const dialog=page.getByRole('dialog'),confirm=dialog.getByRole('button',{name:'Confirm payment',exact:true});
  await expect(dialog.getByText('1 each beyond recorded stock')).toBeVisible();await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Reason').selectOption('SUSPECTED_UNRECORDED_DELIVERY');await expect(confirm).toBeDisabled();
  await dialog.getByRole('checkbox').check();await expect(confirm).toBeEnabled();await confirm.click();
  await expect.poll(()=>submitted?.type).toBe('sales.order.settle');
  expect(submitted.payload.stockException).toEqual({physicallyConfirmed:true,lines:[{productId:'item-a',maxConfirmedShortfall:'1',reasonCode:'SUSPECTED_UNRECORDED_DELIVERY'}]});
});
