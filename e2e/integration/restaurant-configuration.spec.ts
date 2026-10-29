import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, test, type Page } from '@playwright/test';
import { hashPassword } from '../../apps/api/src/security';

// Test-only loopback ingress keeps this fixture separate from other login limits.
test.use({extraHTTPHeaders:{'x-forwarded-for':'198.51.100.61'}});
const pool=new Pool({connectionString:process.env.MAZAO_E2E_DATABASE_URL});
test.afterAll(async()=>{await pool.end();});

async function openRestaurant(page:Page){
  await expect(page.getByLabel('Signed in as Restaurant Browser Admin')).toBeVisible();
  const button=page.getByRole('button',{name:/Tables & kitchen/});
  if(!await button.first().isVisible())await page.getByRole('button',{name:'More',exact:true}).click();
  await button.last().click();await expect(page.getByRole('heading',{name:'Restaurant setup',exact:true})).toBeVisible();
}

test('real restaurant configuration persists after reload while posted stock sales receipts and journals remain unchanged',async({page},testInfo)=>{
  test.setTimeout(180_000);
  const tenantId=randomUUID(),outletId=randomUUID(),userId=randomUUID(),deviceId=randomUUID();
  const email=`restaurant-browser-${userId}@example.invalid`,password=`Disposable-restaurant-browser-${randomUUID()}`;
  await pool.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Disposable restaurant browser','KES','Africa/Nairobi')",[tenantId]);
  await pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Dining browser outlet','Africa/Nairobi')",[outletId,tenantId]);
  await pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'restaurant'),($1,'commerce'),($1,'inventory')",[tenantId]);
  await pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)',[userId,email,await hashPassword(password),'Restaurant Browser Admin']);
  await pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[tenantId,userId]);
  await pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Dining logical workspace')",[deviceId,tenantId,outletId,userId]);
  await page.setViewportSize({width:1024,height:600});await page.goto('/');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByLabel('Signed in as Restaurant Browser Admin')).toBeVisible();

  // Establish actual nonempty immutable trading evidence before setup changes.
  const fixture=await page.evaluate(async()=>{
    const session=await(await fetch('/api/v1/auth/me')).json();
    const command=async(type:string,payload:Record<string,unknown>,expectedVersions:Record<string,number>={})=>{
      const response=await fetch('/api/v1/commands',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.csrfToken},body:JSON.stringify({protocolVersion:1,commandId:crypto.randomUUID(),tenantId:session.tenant.id,deviceId:session.deviceId,type,occurredAt:new Date().toISOString(),expectedVersions,payload})});const result=await response.json();
      if(!response.ok||result.status!=='CONFIRMED')throw new Error(`Disposable restaurant fixture command failed: ${JSON.stringify(result)}`);return result.value;
    };
    const item=await command('catalog.product.create',{sku:'RESTAURANT-POSTED',name:'Existing stocked lunch',baseUnit:'each',currency:'KES',sellingPriceMinor:12500,costPriceMinor:5000,taxRateBps:1600});
    await command('inventory.receive',{documentReference:'DISPOSABLE-RESTAURANT-DELIVERY',lines:[{productId:item.productId,quantity:'4',unitCostMinor:5000}]});
    const shift=await command('shift.open',{openingFloatMinor:10000});
    const sale=await command('sales.order.settle',{shiftId:shift.shiftId,lines:[{productId:item.productId,quantity:'1'}],tenders:[{method:'CASH',amountMinor:20000,currency:'KES'}]},{[`shift:${shift.shiftId}`]:shift.version,[`product:${item.productId}`]:1});
    const receipt=await(await fetch(`/api/v1/sales/orders/${sale.saleId}/receipt`)).json();return {productId:item.productId as string,saleId:sale.saleId as string,receipt};
  });
  const businessEvidence=async()=>Promise.all(['catalog.products','inventory.balances','inventory.movements','commerce.orders','commerce.order_lines','commerce.payments','commerce.shifts','finance.journal_entries','finance.journal_lines'].map(async table=>(await pool.query(`SELECT to_jsonb(x)::text evidence FROM ${table} x WHERE tenant_id=$1 ORDER BY to_jsonb(x)::text`,[tenantId])).rows));
  const before=await businessEvidence(),commands:Array<{commandId:string;type:string;expectedVersions:Record<string,number>}>=[];
  page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/v1/commands')commands.push(request.postDataJSON());});

  await openRestaurant(page);await page.getByRole('button',{name:'Add service area',exact:true}).click();let dialog=page.getByRole('dialog',{name:'Add service area',exact:true});await dialog.getByLabel('Area name',{exact:true}).fill('Garden dining');await dialog.getByRole('button',{name:'Save area',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('heading',{name:'Garden dining',exact:true})).toBeVisible();
  const section=(await pool.query('SELECT id,name,version::text FROM restaurant.sections WHERE tenant_id=$1',[tenantId])).rows[0];expect(section).toMatchObject({name:'Garden dining',version:'1'});
  await page.getByRole('button',{name:'Tables',exact:true}).click();await page.getByRole('button',{name:'Add table',exact:true}).click();dialog=page.getByRole('dialog',{name:'Add table',exact:true});await dialog.getByLabel('Table name',{exact:true}).fill('Garden 7');await dialog.getByLabel('Service area',{exact:true}).selectOption(section.id);await dialog.getByLabel('Seats',{exact:true}).fill('4');await dialog.getByRole('button',{name:'Save table',exact:true}).click();await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:'Preparation stations',exact:true}).click();await page.getByRole('button',{name:'Add preparation station',exact:true}).click();dialog=page.getByRole('dialog',{name:'Add preparation station',exact:true});await dialog.getByLabel('Station name',{exact:true}).fill('Hot kitchen');await dialog.getByLabel('Station type',{exact:true}).selectOption('KITCHEN');await dialog.getByLabel('Characters per line',{exact:true}).fill('48');await dialog.getByRole('button',{name:'Save station',exact:true}).click();await expect(dialog).toHaveCount(0);
  const station=(await pool.query('SELECT id,name,kind,characters_per_line,version::text FROM restaurant.stations WHERE tenant_id=$1',[tenantId])).rows[0];expect(station).toMatchObject({name:'Hot kitchen',kind:'KITCHEN',characters_per_line:48,version:'1'});
  await page.getByRole('button',{name:'Menu routing',exact:true}).click();await page.getByRole('button',{name:'Add menu routing',exact:true}).click();dialog=page.getByRole('dialog',{name:'Add menu routing',exact:true});await dialog.getByLabel('Menu item',{exact:true}).selectOption(fixture.productId);await dialog.getByLabel('Preparation label',{exact:true}).fill('Lunch plate');await dialog.getByLabel('Preparation instructions',{exact:true}).fill('Sauce on the side');await dialog.getByLabel('Hot kitchen',{exact:true}).check();await dialog.getByRole('button',{name:'Save menu routing',exact:true}).click();await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:'Station access',exact:true}).click();await page.getByRole('button',{name:'Assign stations',exact:true}).click();dialog=page.getByRole('dialog',{name:'Assign stations',exact:true});await dialog.getByLabel('Workspace assignment',{exact:true}).selectOption(deviceId);await dialog.getByLabel('Hot kitchen',{exact:true}).check();await dialog.getByRole('button',{name:'Save station access',exact:true}).click();await expect(dialog).toHaveCount(0);

  expect(commands.map(command=>command.type)).toEqual(['restaurant.section.save','restaurant.table.save','restaurant.station.save','restaurant.menu.save','restaurant.station.assign']);expect(commands[3].expectedVersions).toEqual({[`product:${fixture.productId}`]:1});expect(commands[4].expectedVersions).toEqual({[`device:${deviceId}`]:1});
  expect((await pool.query('SELECT name,section_id,seats,active,version::text FROM restaurant.tables WHERE tenant_id=$1',[tenantId])).rows).toEqual([{name:'Garden 7',section_id:section.id,seats:4,active:true,version:'1'}]);
  expect((await pool.query('SELECT product_id,preparation_label,instructions,available,version::text FROM restaurant.menu_routes WHERE tenant_id=$1',[tenantId])).rows).toEqual([{product_id:fixture.productId,preparation_label:'Lunch plate',instructions:'Sauce on the side',available:true,version:'1'}]);
  expect((await pool.query('SELECT station_id FROM restaurant.menu_route_stations WHERE tenant_id=$1 AND product_id=$2',[tenantId,fixture.productId])).rows).toEqual([{station_id:station.id}]);
  expect((await pool.query('SELECT device_id,station_id FROM restaurant.station_assignment_links WHERE tenant_id=$1',[tenantId])).rows).toEqual([{device_id:deviceId,station_id:station.id}]);
  const audited=(await pool.query("SELECT command_id,event_type,payload FROM system.audit_events WHERE tenant_id=$1 AND event_type LIKE 'restaurant.%' ORDER BY event_type",[tenantId])).rows;expect(audited).toHaveLength(5);for(const entry of audited){expect(entry.payload.configurationOnly).toBe(true);expect(commands.some(command=>command.commandId===entry.command_id)).toBe(true);}
  expect((await pool.query("SELECT count(*)::int total FROM system.transactional_outbox WHERE tenant_id=$1 AND event_type LIKE 'restaurant.%'",[tenantId])).rows[0].total).toBe(5);

  await page.reload();await openRestaurant(page);await page.getByRole('button',{name:'Tables',exact:true}).click();await expect(page.getByRole('heading',{name:'Garden 7',exact:true})).toBeVisible();await page.getByRole('button',{name:'Menu routing',exact:true}).click();await expect(page.getByRole('heading',{name:'Existing stocked lunch',exact:true})).toBeVisible();await expect(page.getByText('Sauce on the side',{exact:true})).toBeVisible();
  await expect(page.getByText(/Taking table orders, sending kitchen or bar tickets, printing, live kitchen preparation and room charges are unavailable/)).toBeVisible();
  for(const viewport of [{width:1024,height:600},{width:390,height:844}]){await page.setViewportSize(viewport);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);await testInfo.attach(`restaurant-real-${viewport.width}x${viewport.height}.png`,{body:await page.screenshot({fullPage:false}),contentType:'image/png'});}
  expect(await businessEvidence()).toEqual(before);const afterReceipt=await page.evaluate(async saleId=>(await fetch(`/api/v1/sales/orders/${saleId}/receipt`)).json(),fixture.saleId);expect(afterReceipt).toEqual(fixture.receipt);
});
