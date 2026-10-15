import { expect, test } from '@playwright/test';

test('finance reader sees only scoped confirmed operational aggregates and explicit coverage',async({page})=>{
  test.setTimeout(30000);
  await page.route('**/api/v1/auth/me',route=>route.fulfill({json:{user:{id:'finance-user',name:'FINANCE VIEWER',email:'finance@example.test',role:'accountant',permissions:['finance.view']},tenant:{id:'tenant-a',name:'Business A',currency:'KES',timeZone:'Africa/Nairobi',capabilities:['commerce','inventory']},outlet:{id:'outlet-a',name:'Outlet A',timeZone:'Africa/Nairobi'},deviceId:'device-a',csrfToken:'csrf-a'}}));
  await page.route('**/api/v1/reports/operational-analytics**',route=>route.fulfill({json:{
    reportType:'OUTLET_OPERATIONAL_ANALYTICS',scope:'OUTLET',tenantId:'tenant-a',outletId:'outlet-a',currency:'KES',timeZone:'Africa/Nairobi',from:'2026-10-10',to:'2026-10-15',generatedAt:'2026-10-15T09:00:00.000Z',
    totals:{grossSalesMinor:'123456',subtotalMinor:'106428',taxMinor:'17028',refundsMinor:'1000',cashCollectedMinor:'90000',accountCreditMinor:'33456'},
    daily:[{date:'2026-10-15',grossMinor:'123456',orderCount:'4',refundMinor:'1000',refundCount:'1'}],
    topProducts:[{productId:'product-a',sku:'SKU-A',name:'Maize flour',quantity:'12.5',revenueMinor:'70000',orderCount:'3'}],
    coverage:{status:'CONFIRMED_CASH_AND_ACCOUNT_CREDIT',orderCount:'4',refundCount:'1',cashPaymentCount:'3',accountChargeCount:'1',scope:'This outlet only. Server-confirmed sales.',excludedMethods:['card','mobile money','provider settlements'],excludedSources:['unposted orders','external payment provider confirmations']},
  }}));
  await page.goto('/');
  await page.getByRole('button',{name:/^Reports/}).click();
  await expect(page.getByRole('heading',{name:'Sales & Operations Overview'})).toBeVisible();
  await expect(page.getByText(/This outlet only/)).toBeVisible();
  await expect(page.getByText('Cash Collected')).toBeVisible();
  await expect(page.getByText('Account Credit')).toBeVisible();
  await expect(page.getByText('Top products by recorded sales')).toBeVisible();
  await expect(page.getByText(/provider settlements are excluded/)).toBeVisible();
  await expect(page.getByText(/not an accounting profit report/)).toBeVisible();
});
