import {expect,test} from '@playwright/test';

const trialBalance = {
  reportType:'TRIAL_BALANCE',scope:'TENANT',tenantId:'tenant-a',tenantName:'Business A',currency:'KES',timeZone:'Africa/Nairobi',
  asOf:'2026-10-18',generatedAt:'2026-10-18T09:00:00.000Z',latestJournalAt:null,
  coverage:{status:'POSTED_JOURNAL_ONLY',journalEntryCount:'0',emptyJournalEntryCount:'0',unbalancedJournalEntryCount:'0',sourceTypes:[],explanation:'Recorded journal entries only.'},
  totals:{debitMinor:'0',creditMinor:'0',differenceMinor:'0',balanced:true},accounts:[],
};

test('finance reader sees complete scoped sales, collections, M-Pesa and coverage labels',async({page})=>{
  test.setTimeout(30000);
  const pageErrors:string[]=[];page.on('pageerror',error=>pageErrors.push(error.message));
  await page.route('**/api/v1/auth/me',route=>route.fulfill({json:{user:{id:'finance-user',name:'FINANCE VIEWER',email:'finance@example.test',role:'accountant',permissions:['finance.view']},tenant:{id:'tenant-a',name:'Business A',currency:'KES',timeZone:'Africa/Nairobi',capabilities:['commerce','inventory']},outlet:{id:'outlet-a',name:'Outlet A',timeZone:'Africa/Nairobi'},deviceId:'device-a',csrfToken:'csrf-a'}}));
  await page.route('**/api/v1/reports/operational-analytics**',route=>route.fulfill({json:{
    reportType:'OUTLET_OPERATIONAL_ANALYTICS',scope:'OUTLET',tenantId:'tenant-a',outletId:'outlet-a',outletName:'Outlet A',currency:'KES',timeZone:'Africa/Nairobi',from:'2026-10-10',to:'2026-10-15',generatedAt:'2026-10-15T09:00:00.000Z',
    totals:{grossSalesMinor:'123456',subtotalMinor:'106428',taxMinor:'17028',refundsMinor:'1000',cashCollectedMinor:'90000',accountCreditMinor:'33456',originalSubtotalMinor:'110000',discountMinor:'3572',refundSubtotalMinor:'800',refundTaxMinor:'200',netRevenueMinor:'105628',manualMpesaMinor:'20000',customerCollectionsMinor:'5000',cashRefundsMinor:'1000',cashPaidInMinor:'3000',cashPayoutMinor:'500',netDrawerMovementMinor:'97500',roomCashCollectionsMinor:'4000',totalCashCollectionsMinor:'99000',netTaxMinor:'16828',netInvoiceMinor:'122456'},
    daily:[{date:'2026-10-15',grossMinor:'123456',orderCount:'4',refundMinor:'1000',refundCount:'1'}],
    topProducts:[{productId:'product-a',sku:'SKU-A',name:'Maize flour',quantity:'12.5',revenueMinor:'70000',orderCount:'3'}],
    coverage:{status:'CONFIRMED_SALES_AND_COLLECTIONS',orderCount:'4',refundCount:'1',cashPaymentCount:'3',accountChargeCount:'1',manualMpesaPaymentCount:'1',customerCollectionCount:'2',roomCashPaymentCount:'1',productCount:'14',topProductsComplete:false,scope:'This outlet only. Item sales and returns use their own business dates. Collections use their receipt dates, including collections for older sales. Room cash is shown separately from item sales. Product ranking is after item discounts and before returns.',excludedMethods:['automatic provider verification'],excludedSources:['unposted sales','external settlement statements','room revenue from item sales totals'],drawerMovementExplanation:'Cash sale receipts + customer collections + room cash + paid-ins less cash refunds and payouts. Opening floats and cash-up differences are excluded.'},
  }}));
  await page.route('**/api/v1/reports/trial-balance**',route=>route.fulfill({json:trialBalance}));
  await page.goto('/');
  await expect(page.getByLabel('Signed in as FINANCE VIEWER')).toBeVisible();
  const reportsNav=page.getByRole('button',{name:/^Reports/});
  if(!(await reportsNav.isVisible())){
    const moreNav=page.getByRole('button',{name:'More',exact:true});
    await expect(moreNav).toBeVisible();
    await moreNav.click();
  }
  await expect(reportsNav.last()).toBeVisible();
  await reportsNav.last().click();
  await expect(page.getByRole('heading',{name:'Sales & Operations Overview'})).toBeVisible();
  await expect(page.getByText(/This outlet only/)).toBeVisible();
  await expect(page.getByText('Item invoice totals')).toBeVisible();
  await expect(page.getByText('Net sales revenue',{exact:true}).first()).toBeVisible();
  await expect(page.getByText('Cash from sales')).toBeVisible();
  await expect(page.getByText('M-Pesa received')).toBeVisible();
  await expect(page.getByText('Customer account collections')).toBeVisible();
  await expect(page.getByText('Top products by recorded sales')).toBeVisible();
  await expect(page.getByText(/automatic provider verification are not included/)).toBeVisible();
  await expect(page.getByText(/not a complete accounting profit report/)).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/\b(server|backend|payload)\b/i);
  expect(pageErrors).toEqual([]);
});
