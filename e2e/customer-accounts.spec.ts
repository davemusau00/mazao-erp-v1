import { expect, test, type Page, type TestInfo } from '@playwright/test';

const accounts=[
  {id:'customer-a',name:'Alpha Foods',phone:'0711000000',email:'alpha@example.test',creditLimitMinor:'1000000',balanceMinor:'125050',status:'ACTIVE',version:2,createdAt:'2026-10-01T08:00:00.000Z',updatedAt:'2026-10-15T08:00:00.000Z'},
  {id:'customer-b',name:'Beta Cafe',phone:'0712000000',email:null,creditLimitMinor:'500000',balanceMinor:'0',status:'SUSPENDED',version:1,createdAt:'2026-10-02T08:00:00.000Z',updatedAt:'2026-10-15T08:00:00.000Z'},
];

async function customerSession(page:Page,permissions:string[]){
  await page.route('**/api/v1/auth/me',route=>route.fulfill({json:{user:{id:'customer-user',name:'CUSTOMER OPERATOR',email:'customer@example.test',role:permissions.includes('customers.manage')?'manager':'cashier',permissions},tenant:{id:'customer-tenant',name:'Customer Business',currency:'KES',timeZone:'Africa/Nairobi',capabilities:['commerce']},outlet:{id:'customer-outlet',name:'Main outlet',timeZone:'Africa/Nairobi'},deviceId:'customer-device',csrfToken:'customer-csrf'}}));
  await page.route('**/api/v1/customers',route=>route.fulfill({json:{customers:accounts}}));
  await page.route('**/api/v1/customers/customer-a/statement',route=>route.fulfill({json:{customer:accounts[0],currency:'KES',generatedAt:'2026-10-15T09:00:00.000Z',entries:[]}}));
  await page.route('**/api/v1/shifts/current',route=>route.fulfill({json:{shift:null}}));
}

test('manager sees exact server receivables, status filters, compact rows and account dialogs',async({page},testInfo:TestInfo)=>{
  await customerSession(page,['customers.view','customers.manage','customers.settle']);
  await page.goto('/');
  await page.getByRole('button',{name:/^Customers/}).click();
  await expect(page.getByRole('heading',{name:'Customer Directory & Credit Accounts'})).toBeVisible();
  await expect(page.getByText('KES 1,250.50').first()).toBeVisible();
  await expect(page.getByRole('button',{name:'Debtors (1)'})).toBeVisible();
  await page.getByRole('button',{name:'Suspended (1)'}).click();
  await expect(page.getByRole('row',{name:/Beta Cafe/})).toBeVisible();
  await expect(page.getByRole('row',{name:/Alpha Foods/})).toHaveCount(0);
  await page.getByRole('button',{name:'All Accounts (2)'}).click();
  await testInfo.attach('customer-accounts-1280x720.png',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  await page.getByRole('button',{name:'New Customer'}).click();
  await expect(page.getByRole('dialog',{name:'New customer account'})).toBeVisible();
  await expect(page.getByText('Sales on account cannot exceed the approved credit limit.')).toBeVisible();
});

test('cashier can read accounts but cannot create, edit, or settle without an open shift',async({page})=>{
  await customerSession(page,['customers.view','customers.settle']);
  await page.goto('/');
  await page.getByRole('button',{name:/^Customers/}).click();
  await expect(page.getByRole('button',{name:'New Customer'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Edit account'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Record repayment',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Record Repayment',exact:true})).toBeDisabled();
});

test('customer list stays usable while statement reads run and late statements cannot replace a newer selection',async({page})=>{
  await customerSession(page,['customers.view','customers.manage','customers.settle']);
  await page.unroute('**/api/v1/customers/customer-a/statement');
  let finishAlpha!:()=>void;
  const alphaFinished=new Promise<void>(resolve=>{finishAlpha=resolve;});
  await page.route('**/api/v1/customers/customer-a/statement',async route=>{
    await new Promise(resolve=>setTimeout(resolve,900));
    await route.fulfill({json:{customer:accounts[0],currency:'KES',generatedAt:'2026-10-15T09:00:00.000Z',entries:[{id:'alpha-entry',type:'CHARGE',createdAt:'2026-10-14T09:00:00.000Z',receiptNumber:'ALPHA-RECEIPT',reference:'ALPHA-STATEMENT',amountMinor:'100',balanceAfterMinor:'100',allocations:[]}]}});
    finishAlpha();
  });
  await page.route('**/api/v1/customers/customer-b/statement',route=>route.fulfill({json:{customer:accounts[1],currency:'KES',generatedAt:'2026-10-15T09:00:00.000Z',entries:[{id:'beta-entry',type:'CHARGE',createdAt:'2026-10-14T09:00:00.000Z',receiptNumber:'BETA-RECEIPT',reference:'BETA-STATEMENT',amountMinor:'200',balanceAfterMinor:'200',allocations:[]}]}}));
  let accountReads=0;let releaseRefresh!:()=>void;let refreshStarted!:()=>void;
  const refreshGate=new Promise<void>(resolve=>{releaseRefresh=resolve;});
  const refreshRequested=new Promise<void>(resolve=>{refreshStarted=resolve;});
  await page.unroute('**/api/v1/customers');
  await page.route('**/api/v1/customers',async route=>{
    accountReads++;
    if(accountReads===2){refreshStarted();await refreshGate;}
    await route.fulfill({json:{customers:accounts}});
  });
  await page.goto('/');await page.getByRole('button',{name:/^Customers/}).click();
  await expect(page.getByRole('row',{name:/Alpha Foods/})).toBeVisible();
  await expect(page.getByRole('row',{name:/Beta Cafe/})).toBeVisible();
  await page.getByRole('button',{name:/Beta Cafe/}).first().click();
  await expect(page.getByRole('heading',{name:'Beta Cafe'})).toBeVisible();
  await expect(page.getByText('Ref BETA-STATEMENT')).toBeVisible();
  await alphaFinished;
  await expect(page.getByText('Ref BETA-STATEMENT')).toBeVisible();
  await expect(page.getByText('Ref ALPHA-STATEMENT')).toHaveCount(0);

  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await refreshRequested;
  await expect(page.getByText('Refreshing customer accounts; previously loaded accounts remain available.')).toBeVisible();
  await expect(page.getByRole('row',{name:/Beta Cafe/})).toBeVisible();
  releaseRefresh();
  await expect(page.getByText('Refreshing customer accounts; previously loaded accounts remain available.')).toHaveCount(0);
});
