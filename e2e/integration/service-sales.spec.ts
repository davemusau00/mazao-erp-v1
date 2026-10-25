import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, test } from '@playwright/test';
import { hashPassword } from '../../apps/api/src/security';

test.use({extraHTTPHeaders:{'x-forwarded-for':'198.51.100.24'}});
const pool=new Pool({connectionString:process.env.MAZAO_E2E_DATABASE_URL});
test.afterAll(async()=>{await pool.end();});

test('commerce-only operator creates sells refunds and closes a service without physical stock or COGS',async({page})=>{
  const tenantId=randomUUID(),outletId=randomUUID(),userId=randomUUID(),deviceId=randomUUID();
  const email='service-browser-'+userId+'@example.invalid',password='Disposable-service-browser-'+randomUUID();
  await pool.query("INSERT INTO core.tenants(id,name,currency,time_zone,business_profile) VALUES($1,'Disposable service business','KES','Africa/Nairobi',$2::jsonb)",[tenantId,JSON.stringify({taxPolicy:{calculation:'exclusive',defaultRateBps:1600,label:'VAT',reviewed:true}})]);
  await pool.query("INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,'Service browser outlet','Africa/Nairobi')",[outletId,tenantId]);
  await pool.query("INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,'commerce')",[tenantId]);
  await pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)',[userId,email,await hashPassword(password),'Service Browser Admin']);
  await pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[tenantId,userId]);
  await pool.query("INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,'Disposable service assignment')",[deviceId,tenantId,outletId,userId]);
  const requests:string[]=[];page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/v1/'))requests.push(new URL(request.url()).pathname);});
  await page.setViewportSize({width:1024,height:600});
  await page.goto('/');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByLabel('Signed in as Service Browser Admin')).toBeVisible();
  await page.getByRole('button',{name:'Items and services',exact:true}).click();
  await page.getByRole('button',{name:'Add item',exact:true}).click();
  const create=page.getByRole('dialog',{name:'Create item',exact:true});
  await create.getByRole('combobox',{name:'Item type',exact:true}).selectOption('SERVICE');await create.getByLabel('Item name',{exact:true}).fill('Consultation');await create.getByLabel('SKU',{exact:true}).fill('SERVICE-CONSULTATION');
  await create.getByLabel('Selling price (KES)',{exact:true}).fill('10.00');await create.getByLabel('Reference cost per unit (KES)',{exact:true}).fill('4.00');await create.getByRole('button',{name:'Create item',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Consultation',exact:true})).toBeVisible();
  const product=(await pool.query("SELECT id,item_kind FROM catalog.products WHERE tenant_id=$1 AND sku='SERVICE-CONSULTATION'",[tenantId])).rows[0];expect(product.item_kind).toBe('SERVICE');
  await page.getByRole('button',{name:'Shifts',exact:true}).click();await page.getByLabel('Opening float (KES)').fill('100.00');await page.getByRole('button',{name:'Open shift',exact:true}).click();await expect(page.getByLabel('Counted cash (KES)')).toBeVisible();
  await page.getByRole('button',{name:'Sell',exact:true}).first().click();await page.getByRole('button',{name:/Consultation/}).click();await page.getByRole('button',{name:'Take payment',exact:true}).click();
  await page.getByLabel('Cash received (KES)',{exact:true}).fill('20.00');await page.getByRole('button',{name:'Confirm payment',exact:true}).click();
  const receipt=page.getByRole('dialog').filter({has:page.getByRole('button',{name:'Close receipt',exact:true})});await expect(receipt).toContainText('Consultation');await expect(receipt).toContainText('11.60');await expect(receipt).toContainText('Service');await page.getByRole('button',{name:'Close receipt',exact:true}).click();
  const line=(await pool.query('SELECT id,item_kind_snapshot,cost_price_minor::text,cogs_minor::text,provisional_cogs_minor::text FROM commerce.order_lines WHERE tenant_id=$1',[tenantId])).rows[0];expect(line).toMatchObject({item_kind_snapshot:'SERVICE',cost_price_minor:'0',cogs_minor:'0',provisional_cogs_minor:'0'});
  await page.getByRole('button',{name:'Sales history',exact:true}).click();await page.getByRole('button',{name:'Refund remaining items',exact:true}).click();
  const refund=page.getByRole('dialog',{name:'Review returned quantities'});await expect(refund.getByLabel('Service refund: no stock return')).toBeDisabled();await expect(refund.getByLabel('Service refund: no stock return')).not.toBeChecked();await refund.getByRole('combobox',{name:'Reason',exact:true}).selectOption('Incorrect ring-up / Cashier error');await refund.getByRole('button',{name:'Confirm cash refund',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Refund completed'})).toBeVisible();
  await page.getByRole('button',{name:'Shifts',exact:true}).click();await page.getByLabel('Counted cash (KES)').fill('100.00');await page.getByRole('button',{name:'Close shift',exact:true}).click();await expect(page.getByRole('heading',{name:'Z report',exact:true})).toBeVisible();
  const physical=(await pool.query(`SELECT (SELECT count(*)::int FROM inventory.balances WHERE tenant_id=$1) balances,
    (SELECT count(*)::int FROM inventory.movements WHERE tenant_id=$1) movements,
    (SELECT count(*)::int FROM inventory.sale_shortfalls WHERE tenant_id=$1) shortfalls,
    (SELECT count(*)::int FROM finance.journal_lines WHERE tenant_id=$1 AND account_code IN ('INVENTORY','COST_OF_GOODS_SOLD','UNRECORDED_STOCK_CLEARING')) cost_lines`,[tenantId])).rows[0];expect(physical).toEqual({balances:0,movements:0,shortfalls:0,cost_lines:0});
  const closed=(await pool.query('SELECT expected_cash_minor::text,counted_cash_minor::text,variance_minor::text FROM commerce.shift_close_reports WHERE tenant_id=$1',[tenantId])).rows[0];expect(closed).toMatchObject({expected_cash_minor:'10000',counted_cash_minor:'10000',variance_minor:'0'});
  const returned=(await pool.query('SELECT quantity::text,cogs_minor::text,restocked FROM commerce.refund_lines WHERE tenant_id=$1 AND order_line_id=$2',[tenantId,line.id])).rows[0];expect(returned).toEqual({quantity:'1.000000',cogs_minor:'0',restocked:false});
  const journal=(await pool.query('SELECT sum(debit_minor)::text debit,sum(credit_minor)::text credit FROM finance.journal_lines WHERE tenant_id=$1',[tenantId])).rows[0];expect(journal.debit).toBe(journal.credit);
  expect(requests).not.toContain('/api/v1/configuration/stock-sale-policy');
  const commandEvidence=(await pool.query("SELECT authority_version,required_capabilities FROM system.commands WHERE tenant_id=$1 AND command_type IN ('catalog.product.create','sales.order.settle','sales.order.refund')",[tenantId])).rows;expect(commandEvidence).toHaveLength(3);for(const command of commandEvidence){expect(command.authority_version).toBe(1);expect(command.required_capabilities).toEqual(['commerce']);}
});
