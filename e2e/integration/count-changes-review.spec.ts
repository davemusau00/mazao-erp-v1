import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, test } from '@playwright/test';
import { hashPassword } from '../../apps/api/src/security';

test.use({extraHTTPHeaders:{'x-forwarded-for':'198.51.100.27'}});
const pool=new Pool({connectionString:process.env.MAZAO_E2E_DATABASE_URL});
test.afterAll(async()=>{await pool.end();});

for(const [width,height,lostResponse] of [[1024,600,true],[390,844,false]] as const){
  test(`real count review preserves a sale and earlier counts through physical recount at ${width}x${height}`,async({page})=>{
    const tenantId=randomUUID(),outletId=randomUUID(),userId=randomUUID(),deviceId=randomUUID();
    const email=`count-review-${userId}@example.invalid`,password=`Disposable-count-review-${randomUUID()}`;
    await pool.query("INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,'Disposable reviewed count','KES','Africa/Nairobi')",[tenantId]);
    await pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Reviewed count outlet','Africa/Nairobi')",[outletId,tenantId]);
    await pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'inventory'),($1,'commerce')",[tenantId]);
    await pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)',[userId,email,await hashPassword(password),'Reviewed Count Admin']);
    await pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[tenantId,userId]);
    await pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Disposable reviewed count assignment')",[deviceId,tenantId,outletId,userId]);
    await page.setViewportSize({width,height});await page.goto('/');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByLabel('Signed in as Reviewed Count Admin')).toBeVisible();
    const setup=await page.evaluate(async()=>{
      const session=await(await fetch('/api/v1/auth/me')).json();
      const command=async(type:string,payload:Record<string,unknown>)=>{
        const response=await fetch('/api/v1/commands',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.csrfToken},body:JSON.stringify({protocolVersion:1,commandId:crypto.randomUUID(),tenantId:session.tenant.id,deviceId:session.deviceId,type,occurredAt:new Date().toISOString(),expectedVersions:{},payload})});
        const result=await response.json();if(!response.ok||result.status!=='CONFIRMED')throw new Error('Disposable count setup failed: '+JSON.stringify(result));return result.value;
      };
      const first=await command('catalog.product.create',{sku:'REVIEW-A',name:'Reviewed item A',baseUnit:'each',currency:'KES',sellingPriceMinor:1000,costPriceMinor:100,taxRateBps:0});
      const second=await command('catalog.product.create',{sku:'REVIEW-B',name:'Reviewed item B',baseUnit:'each',currency:'KES',sellingPriceMinor:1000,costPriceMinor:100,taxRateBps:0});
      await command('inventory.receive',{documentReference:'REVIEWED-COUNT-BASELINE',lines:[{productId:first.productId,quantity:'10',unitCostMinor:100},{productId:second.productId,quantity:'5',unitCostMinor:100}]});
      const shift=await command('shift.open',{openingFloatMinor:0});return{firstId:first.productId as string,secondId:second.productId as string,shiftId:shift.shiftId as string};
    });
    const navigate=async()=>{await expect(page.getByLabel('Signed in as Reviewed Count Admin')).toBeVisible();const button=page.getByRole('button',{name:'Count stock',exact:true});if(!await button.isVisible())await page.getByRole('button',{name:'More',exact:true}).click();await button.last().click();};
    await navigate();await page.getByRole('button',{name:'Start full count',exact:true}).click();
    const first=page.locator('article').filter({has:page.getByRole('heading',{name:'Reviewed item A',exact:true})}),second=page.locator('article').filter({has:page.getByRole('heading',{name:'Reviewed item B',exact:true})});
    await first.getByLabel('Counted quantity',{exact:true}).fill('9');await first.getByLabel('Reason for difference').fill('Earlier physical shortage before sale');await second.getByLabel('Counted quantity',{exact:true}).fill('5');await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Count draft saved'})).toBeVisible();
    const count=(await pool.query("SELECT id,version::text FROM inventory.stock_counts WHERE tenant_id=$1 AND status='OPEN'",[tenantId])).rows[0];expect(count.version).toBe('2');
    await page.evaluate(async({firstId,shiftId})=>{
      const session=await(await fetch('/api/v1/auth/me')).json();const commandId=crypto.randomUUID();
      const response=await fetch('/api/v1/commands',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.csrfToken},body:JSON.stringify({protocolVersion:1,commandId,tenantId:session.tenant.id,deviceId:session.deviceId,type:'sales.order.settle',occurredAt:new Date().toISOString(),expectedVersions:{[`shift:${shiftId}`]:1,[`product:${firstId}`]:1},payload:{shiftId,lines:[{productId:firstId,quantity:'2'}],tenders:[{method:'CASH',amountMinor:2000,currency:'KES'}]}})});
      const outcome=await response.json();if(!response.ok||outcome.status!=='CONFIRMED')throw new Error('Disposable concurrent sale failed: '+JSON.stringify(outcome));
    },setup);
    await page.getByRole('button',{name:'Review and post',exact:true}).click();await page.getByRole('button',{name:'Post reviewed count',exact:true}).click();
    const review=page.getByRole('dialog',{name:'Review changed count items'});await expect(review).toContainText('Earlier reason: Earlier physical shortage before sale');await expect(review.getByText('Sale',{exact:true})).toBeVisible();
    let reviewCommandId='';if(lostResponse)await page.route('**/api/v1/commands',async route=>{if(route.request().postDataJSON().type!=='inventory.count.review')return route.continue();reviewCommandId=route.request().postDataJSON().commandId;await route.fetch();await route.abort('failed');});
    await review.getByLabel('Manager review reason',{exact:true}).fill('Reviewed completed sale; recounting current shelf');await review.getByRole('checkbox').check();const accept=review.getByRole('button',{name:'Accept baseline and require recount',exact:true});await accept.scrollIntoViewIfNeeded();await expect(accept).toBeInViewport();expect((await accept.boundingBox())!.height).toBeGreaterThanOrEqual(44);await accept.click();
    if(lostResponse){await expect(page.getByRole('dialog',{name:'Check count review status'})).toBeVisible();await page.unroute('**/api/v1/commands');await page.reload();await navigate();const pending=page.getByRole('dialog',{name:'Check count review status'});await expect(pending).toContainText('Reviewed completed sale; recounting current shelf');await pending.getByRole('button',{name:'Check review status',exact:true}).click();await expect(pending).toHaveCount(0);}
    else await expect(review).toHaveCount(0);
    await expect(first.getByLabel('Counted quantity',{exact:true})).toHaveValue('');await expect(first.getByLabel('Counted quantity',{exact:true})).toBeFocused();await expect(second.getByLabel('Counted quantity',{exact:true})).toHaveValue('5.000000');
    const beforePost=(await pool.query("SELECT count(*)::int n FROM inventory.movements WHERE tenant_id=$1 AND movement_type='COUNT_ADJUSTMENT'",[tenantId])).rows[0];expect(beforePost.n).toBe(0);
    await first.getByLabel('Counted quantity',{exact:true}).fill('6');await first.getByLabel('Reason for difference').fill('Fresh physical recount confirms two missing units');await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Count draft saved'})).toBeVisible();await page.getByRole('button',{name:'Review and post',exact:true}).click();await page.getByRole('button',{name:'Post reviewed count',exact:true}).click();await expect(page.getByRole('heading',{name:'No open stock count',exact:true})).toBeVisible();
    const balances=(await pool.query('SELECT product_id,quantity::text,inventory_value_minor::text FROM inventory.balances WHERE tenant_id=$1 ORDER BY product_id',[tenantId])).rows;
    expect(balances.find(line=>line.product_id===setup.firstId)).toMatchObject({quantity:'6.000000',inventory_value_minor:'600'});expect(balances.find(line=>line.product_id===setup.secondId)).toMatchObject({quantity:'5.000000',inventory_value_minor:'500'});
    const movements=(await pool.query("SELECT movement_type,quantity_delta::text,value_minor::text FROM inventory.movements WHERE tenant_id=$1 AND movement_type IN ('SALE','COUNT_ADJUSTMENT') ORDER BY movement_type",[tenantId])).rows;expect(movements).toEqual([{movement_type:'COUNT_ADJUSTMENT',quantity_delta:'-2.000000',value_minor:'200'},{movement_type:'SALE',quantity_delta:'-2.000000',value_minor:'200'}]);
    const journal=(await pool.query('SELECT sum(debit_minor)::text debit,sum(credit_minor)::text credit,sum(CASE WHEN account_code=\'INVENTORY\' THEN debit_minor-credit_minor ELSE 0 END)::text inventory FROM finance.journal_lines WHERE tenant_id=$1',[tenantId])).rows[0];expect(journal.debit).toBe(journal.credit);expect(journal.inventory).toBe('1100');
    if(reviewCommandId)expect((await pool.query('SELECT count(*)::int n FROM system.audit_events WHERE tenant_id=$1 AND command_id=$2',[tenantId,reviewCommandId])).rows[0].n).toBe(1);
    await page.getByRole('button',{name:'View details',exact:true}).click();const history=page.getByRole('dialog',{name:'Stock count details'});await history.getByRole('button',{name:'View Count entries saved version 2',exact:true}).click();const saved=history.getByRole('region',{name:'Selected count evidence'});await expect(saved).toContainText('Earlier physical shortage before sale');await expect(saved).toContainText('physical count 9');
  });
}
