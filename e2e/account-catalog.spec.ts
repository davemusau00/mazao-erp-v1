import {expect,test} from '@playwright/test';

test('account names are versioned and change only their visible labels',async({page},testInfo)=>{
  const commands:Record<string,unknown>[]=[];let catalogVersion=1;
  const accounts=[
    {accountCode:'CASH_TILL',label:'Cash in tills',classification:'ASSET',systemDefined:true},
    {accountCode:'SALES_REVENUE',label:'Item sales revenue',classification:'REVENUE',systemDefined:true},
  ];
  await page.route('**/api/v1/auth/me',route=>route.fulfill({json:{user:{id:'finance-owner',name:'Finance owner',email:'finance@example.test',role:'accountant',permissions:['finance.view','finance.manage']},tenant:{id:'tenant-a',name:'Business A',currency:'KES',timeZone:'Africa/Nairobi',capabilities:['commerce','inventory']},outlet:{id:'outlet-a',name:'Outlet A',timeZone:'Africa/Nairobi'},deviceId:'finance-device',csrfToken:'csrf-a'}}));
  await page.route('**/api/v1/reports/account-catalog',route=>route.fulfill({json:{version:catalogVersion,generatedAt:'2026-10-18T09:00:00.000Z',labelPolicy:'CURRENT_VERSIONED_LABELS',accounts,permissions:{manage:true},coverage:'Display names use the stated catalogue version. Account classes and control-account identities are fixed.'}}));
  await page.route('**/api/v1/commands',async route=>{
    const command=route.request().postDataJSON() as Record<string,unknown>;commands.push(command);catalogVersion++;
    const payload=command.payload as {accountCode:string;label:string};const account=accounts.find(item=>item.accountCode===payload.accountCode)!;account.label=payload.label;
    return route.fulfill({json:{commandId:command.commandId,status:'CONFIRMED',value:{accountCode:payload.accountCode,label:payload.label,catalogVersion}}});
  });
  await page.goto('/');
  let moneyNav=page.getByRole('button',{name:/^Money/}).filter({visible:true});
  if(await moneyNav.count()===0){await page.getByRole('button',{name:'More',exact:true}).click();moneyNav=page.getByRole('button',{name:/^Money/}).filter({visible:true});}
  await moneyNav.last().click();
  await page.getByRole('button',{name:'Account names',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Account names'})).toBeVisible();
  await expect(page.getByText('Account classes and posted records do not change.')).toBeVisible();
  const revenueRow=page.getByRole('row').filter({hasText:'SALES_REVENUE'});
  await revenueRow.getByRole('button',{name:'Rename'}).click();
  await page.getByRole('textbox',{name:'Display name for SALES_REVENUE'}).fill('Counter revenue');
  await revenueRow.getByRole('button',{name:'Save name'}).click();
  await expect(revenueRow.getByText('Counter revenue')).toBeVisible();
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({type:'finance.account.label',expectedVersions:{'account-catalog:tenant-a':1},payload:{accountCode:'SALES_REVENUE',label:'Counter revenue'}});
  await testInfo.attach('account-names-desktop.png',{body:await page.screenshot(),contentType:'image/png'});
  await page.setViewportSize({width:390,height:844});
  await testInfo.attach('account-names-mobile.png',{body:await page.screenshot(),contentType:'image/png'});
});
