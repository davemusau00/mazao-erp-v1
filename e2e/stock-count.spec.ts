import { expect, test } from '@playwright/test';

const business = { id:'count-tenant', name:'Test Outlet Group', currency:'KES', timeZone:'Africa/Nairobi', capabilities:['commerce','inventory'] };
const count = {
  id:'count-session-1', status:'OPEN', areaLabel:'Main store', version:3,
  baselineAt:'2026-10-15T08:00:00.000Z', openedAt:'2026-10-15T08:00:00.000Z', openedBy:'MANAGER', postedAt:null, postedBy:null,
  lineCount:1, countedLineCount:0,
  lines:[{productId:'product-1',sku:'MAIZE-1',name:'Maize flour',unit:'bag',expectedQuantity:'12',expectedBalanceVersion:8,countedQuantity:null,varianceReason:null,countedBy:null,countedAt:null}],
};

async function authenticatedCountSession(page: import('@playwright/test').Page, permissions: string[]) {
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json:{
    user:{id:'manager-1',name:'COUNT MANAGER',email:'manager@example.test',role:'manager',permissions},
    tenant:business,outlet:{id:'outlet-1',name:'Main outlet',timeZone:'Africa/Nairobi'},deviceId:'device-1',csrfToken:'csrf-test',
  }}));
  await page.route('**/api/v1/inventory/counts/current', route => route.fulfill({json:{count}}));
  await page.route('**/api/v1/inventory/counts', route => route.fulfill({json:{counts:[{id:count.id,status:'OPEN',areaLabel:'Main store',version:3,openedAt:count.openedAt,openedBy:'MANAGER',postedAt:null,postedBy:null,lineCount:1,countedLineCount:0}]}}));
  await page.route('**/api/v1/catalog/items', route => route.fulfill({json:{items:[{id:'product-1',sku:'MAIZE-1',name:'Maize flour',unit:'bag',currency:'KES',sellingPriceMinor:25000,taxRateBps:0,quantity:'12',version:8,barcode:'6164000123456'}]}}));
}

test('manager scans an authorized catalog barcode to focus a line in the complete server count', async ({page}, testInfo) => {
  test.setTimeout(30000);
  await page.setViewportSize({width:390,height:844});
  await authenticatedCountSession(page,['inventory.count','inventory.count.approve']);
  await page.goto('/');
  const countNavigation=page.getByRole('button',{name:'Count stock',exact:true});
  if(!await countNavigation.isVisible())await page.getByRole('button',{name:'More',exact:true}).click();
  await countNavigation.last().click();
  await expect(page.getByRole('heading',{name:'Outlet count in progress'})).toBeVisible();
  await expect(page.getByText('1 baseline items · 0 saved counts')).toBeVisible();
  await page.getByRole('textbox',{name:'Scan barcode or search count items'}).fill('6164000123456');
  const match=page.getByRole('option',{name:/Maize flour.*6164000123456/});
  await expect(match).toBeVisible();
  await match.click();
  await expect(page.getByRole('textbox',{name:'Counted quantity'})).toBeFocused();
  await expect(page.getByRole('button',{name:'Review and post'})).toBeDisabled();
  await testInfo.attach('stock-count-scan-first-390x844.png',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
});

test('cashier without count permission cannot navigate to count work', async ({page}) => {
  await authenticatedCountSession(page,['commerce.sell']);
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Count stock',exact:true})).toHaveCount(0);
});
