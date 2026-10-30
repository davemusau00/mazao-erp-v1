import { expect, test } from '@playwright/test';

test('authenticated workspace switching clears the old basket and loads only the target outlet catalog',async({page})=>{
  const base={user:{id:'context-user',name:'Context Operator',email:'context@example.invalid',role:'cashier',permissions:['commerce.sell']},tenant:{id:'source-tenant',name:'Source Business',currency:'KES',timeZone:'Africa/Nairobi',capabilities:['commerce']},outlet:{id:'source-outlet',name:'Source Outlet',timeZone:'Africa/Nairobi'},deviceId:'source-device',csrfToken:'context-csrf',onboardingStatus:'LIVE'};
  const target={...base,tenant:{...base.tenant,id:'target-tenant',name:'Target Business'},outlet:{...base.outlet,id:'target-outlet',name:'Target Outlet'},deviceId:'target-device'};
  const assignments=[{deviceId:base.deviceId,deviceLabel:'Source terminal',tenantId:base.tenant.id,tenantName:base.tenant.name,outletId:base.outlet.id,outletName:base.outlet.name},{deviceId:target.deviceId,deviceLabel:'Target terminal',tenantId:target.tenant.id,tenantName:target.tenant.name,outletId:target.outlet.id,outletName:target.outlet.name}];
  let active=base;const catalogReads:string[]=[];
  await page.route('**/api/v1/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname.replace('/api/v1','');
    if(path==='/auth/me')return route.fulfill({json:active});
    if(path==='/auth/assignments')return route.fulfill({json:{assignments}});
    if(path==='/auth/context'&&request.method()==='POST'){
      const input=request.postDataJSON() as {deviceId:string};active=input.deviceId===target.deviceId?target:base;
      return route.fulfill({json:active});
    }
    if(path==='/catalog/items'){
      catalogReads.push(active.outlet.id);
      const targetOutlet=active.outlet.id===target.outlet.id;
      return route.fulfill({json:{items:[{id:targetOutlet?'target-product':'source-product',sku:targetOutlet?'TARGET-1':'SOURCE-1',name:targetOutlet?'Target outlet item':'Source outlet item',unit:'each',currency:'KES',sellingPriceMinor:1000,taxRateBps:0,quantity:null,version:null,itemKind:'SERVICE',stockTracked:false,active:true}]}});
    }
    if(path==='/shifts/current')return route.fulfill({json:{shift:null}});
    return route.fulfill({status:200,json:{}});
  });
  page.on('dialog',dialog=>void dialog.accept());
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Signed in as Context Operator'})).toContainText('Source Outlet');
  await page.getByRole('button',{name:'Sell',exact:true}).click();
  await page.getByRole('button',{name:/Source outlet item/}).click();
  await expect(page.getByRole('region',{name:'Basket'}).getByText('Source outlet item',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Switch workspace'}).click();
  const dialog=page.getByRole('dialog',{name:'Switch workspace'});
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:/Target Business/}).click();
  await expect(page.getByRole('button',{name:'Signed in as Context Operator'})).toContainText('Target Outlet');
  await page.getByRole('button',{name:'Sell',exact:true}).click();
  await expect(page.getByRole('button',{name:/Target outlet item/})).toBeVisible();
  await expect(page.getByRole('button',{name:/Source outlet item/})).toHaveCount(0);
  await expect(page.getByText('Choose items to start a sale.')).toBeVisible();
  expect(catalogReads).toContain('source-outlet');expect(catalogReads).toContain('target-outlet');
});
