import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, test, type Page } from '@playwright/test';
import { hashPassword } from '../../apps/api/src/security';

// A distinct terminal keeps the real per-client login limit enabled in CI.
test.use({ extraHTTPHeaders: { 'x-forwarded-for': '198.51.100.2' } });

// The integration config restricts this URL to a disposable localhost database.
const pool = new Pool({ connectionString: process.env.MAZAO_E2E_DATABASE_URL });
const tenantId = randomUUID(), outletId = randomUUID(), userId = randomUUID(), deviceId = randomUUID();
const email = `import-${userId}@example.invalid`, password = `Disposable-import-${randomUUID()}`;
const headers = ['sku','name','baseUnit','sellingPrice','costPrice','taxRate','currency','barcode','category','reorderLevel','openingQuantity','openingUnitCost'];
const mappingLabels = ['SKU','Item name','Base unit','Selling price','Reference cost','Tax rate (%)','Currency','Barcode','Category','Reorder level','Opening quantity','Opening unit cost'];
const csv = (rows: string[][], columns = headers) => [columns, ...rows].map(row => row.map(cell => `"${cell.replaceAll('"','""')}"`).join(',')).join('\r\n');

test.beforeAll(async () => {
  await pool.query('INSERT INTO core.tenants(id,name,currency,time_zone) VALUES($1,$2,$3,$4)', [tenantId, 'Disposable CSV business', 'KES', 'Africa/Nairobi']);
  await pool.query('INSERT INTO core.outlets(id,tenant_id,name,time_zone) VALUES($1,$2,$3,$4)', [outletId, tenantId, 'Disposable CSV outlet', 'Africa/Nairobi']);
  for (const capability of ['commerce','inventory','retail']) await pool.query('INSERT INTO core.tenant_capabilities(tenant_id,capability) VALUES($1,$2)', [tenantId, capability]);
  await pool.query('INSERT INTO identity.users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)', [userId, email, await hashPassword(password), 'Import Admin']);
  await pool.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')", [tenantId,userId]);
  await pool.query('INSERT INTO identity.devices(id,tenant_id,outlet_id,assigned_user_id,label) VALUES($1,$2,$3,$4,$5)', [deviceId,tenantId,outletId,userId,'Disposable CSV device']);
});
test.afterAll(async () => { await pool.end(); });

async function importWorkspace(page: Page) {
  await page.getByRole('button', {name:'Stock',exact:true}).first().click();
  const heading=page.getByRole('heading', {name:'Import products from CSV'});
  const action=page.getByRole('button', {name:'Import products',exact:true});
  await expect(heading.or(action)).toBeVisible();
  if(!await heading.isVisible()) await action.click();
  await expect(heading).toBeVisible();
}
async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email', {exact:true}).fill(email);
  await page.getByLabel('Password', {exact:true}).fill(password);
  await page.getByRole('button', {name:'Sign in',exact:true}).click();
  await expect(page.getByLabel('Signed in as Import Admin')).toBeVisible();
  await importWorkspace(page);
}
async function upload(page: Page, name: string, source: string, columns = headers) {
  await expect(page.getByLabel('Product CSV file', {exact:true})).toBeEnabled();
  await page.getByLabel('Product CSV file', {exact:true}).setInputFiles({name,mimeType:'text/csv',buffer:Buffer.from(source)});
  for (const [index, column] of headers.entries()) {
    if (columns.includes(column)) await page.getByLabel('CSV column for '+mappingLabels[index], {exact:true}).selectOption({label:column});
  }
}
async function validate(page: Page) {
  await page.getByRole('button', {name:'Validate all rows',exact:true}).click();
  await expect(page.getByRole('heading', {name:'Proposed changes',exact:true})).toBeVisible();
}
async function review(page: Page) {
  await page.getByLabel('I reviewed every proposed change and opening stock value', {exact:true}).check();
  const warning = page.getByLabel('I acknowledge all import warnings', {exact:true});
  if (await warning.isVisible()) await warning.check();
}
async function assertStock(sku: string, quantity: string, value: string) {
  const row = (await pool.query('SELECT b.quantity,b.inventory_value_minor,p.id FROM inventory.balances b JOIN catalog.products p ON p.id=b.product_id AND p.tenant_id=b.tenant_id AND p.outlet_id=b.outlet_id WHERE p.tenant_id=$1 AND p.outlet_id=$2 AND p.sku=$3',[tenantId,outletId,sku])).rows[0];
  expect(row.quantity).toBe(quantity);
  expect(String(row.inventory_value_minor)).toBe(value);
  return row.id as string;
}

test('CSV errors block all writes; reviewed opening stock and metadata updates persist with journal evidence', async ({page}) => {
  await signIn(page);
  await upload(page,'unsafe.csv',csv([['IMPORT-UNSAFE','Invalid\u0000name','piece','10.00','4.00','0','KES','001230','General','0','0','']]));
  await page.getByRole('button',{name:'Validate all rows',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText(/control characters|UTF-8/i);
  await expect(page.getByRole('button',{name:'Check command status',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Validate all rows',exact:true})).toBeEnabled();
  await upload(page,'invalid.csv',csv([
    ['IMPORT-MILK','Milk','litre','1e2','4.00','16','KES','001234','Drinks','2','2.5','4.00'],
    ['IMPORT-MILK','Duplicate','litre','10.00','4.00','16','KES','001234','Drinks','2','0','0'],
    ['IMPORT-CURRENCY','Bad currency row','piece','10.00','4.00','16','not-a-currency','001235','General','2','0','0'],
  ]));
  await validate(page);
  await expect(page.getByRole('heading',{name:/^Validation errors/})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('csv-validation-errors.png'),fullPage:true});
  await expect(page.getByRole('button',{name:'Apply reviewed import',exact:true})).toBeDisabled();
  expect((await pool.query('SELECT count(*)::int n FROM catalog.products WHERE tenant_id=$1',[tenantId])).rows[0].n).toBe(0);
  expect((await pool.query('SELECT count(*)::int n FROM inventory.movements WHERE tenant_id=$1',[tenantId])).rows[0].n).toBe(0);
  expect((await pool.query('SELECT count(*)::int n FROM finance.journal_entries WHERE tenant_id=$1',[tenantId])).rows[0].n).toBe(0);
  const download = page.waitForEvent('download');
  await page.getByRole('button',{name:'Download errors CSV',exact:true}).click();
  const report=await download;
  expect(report.suggestedFilename()).toMatch(/\.csv$/);
  const stream=await report.createReadStream(); expect(stream).not.toBeNull();
  let errorText=''; for await (const chunk of stream!) errorText+=chunk.toString();
  expect(errorText).toContain('rawValue'); expect(errorText).toContain('1e2'); expect(errorText).toContain('DUPLICATE_SKU');
  await page.getByRole('button',{name:'Choose another CSV',exact:true}).click();
  await upload(page,'opening.csv',csv([['IMPORT-MILK','Milk, fresh','litre','10.00','4.00','16','KES','001234','Drinks','2','2.5','4.00']]));
  await validate(page);
  expect((await pool.query('SELECT count(*)::int n FROM catalog.products WHERE tenant_id=$1',[tenantId])).rows[0].n).toBe(0);
  await review(page);
  let applyRequests=0;
  page.on('request',request=>{if(request.url().endsWith('/api/v1/commands')&&request.postDataJSON()?.type==='catalog.import.apply')applyRequests++;});
  await page.evaluate(()=>{
    const original=IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction=function(stores,mode,options){
      if(this.name==='mazao-v1-command-journal'&&mode==='readwrite'){
        IDBDatabase.prototype.transaction=original;
        throw new DOMException('Simulated storage quota failure','QuotaExceededError');
      }
      return original.call(this,stores,mode,options);
    };
  });
  await page.getByRole('button',{name:'Apply reviewed import',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText(/not sent/i);
  expect(applyRequests).toBe(0);
  await expect(page.getByRole('button',{name:'Apply reviewed import',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Apply reviewed import',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Import applied',exact:true})).toBeVisible();
  const productId = await assertStock('IMPORT-MILK','2.500000','1000');
  const journal = (await pool.query("SELECT j.id,sum(l.debit_minor)::text debit,sum(l.credit_minor)::text credit,array_agg(l.account_code) accounts FROM finance.journal_entries j JOIN finance.journal_lines l ON l.journal_entry_id=j.id AND l.tenant_id=j.tenant_id WHERE j.tenant_id=$1 AND j.source_type='OPENING_PRODUCT_IMPORT' GROUP BY j.id",[tenantId])).rows;
  expect(journal).toHaveLength(1); expect(journal[0].debit).toBe('1000'); expect(journal[0].credit).toBe('1000');
  expect(journal[0].accounts.sort()).toEqual(['INVENTORY','OPENING_BALANCE_CLEARING']);
  expect((await pool.query('SELECT barcode FROM catalog.products WHERE id=$1',[productId])).rows[0].barcode).toBe('001234');
  await page.getByRole('button',{name:'Choose another CSV',exact:true}).click();
  const columns=headers.slice(0,10);
  await upload(page,'update.csv',csv([['IMPORT-MILK','Milk updated','litre','11.00','4.00','16','KES','001234','Drinks','3']],columns),columns);
  await page.getByLabel('Import mode',{exact:true}).selectOption({label:'Create new or update matching SKUs'});
  await validate(page); await review(page);
  await page.getByRole('button',{name:'Apply reviewed import',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Import applied',exact:true})).toBeVisible();
  await assertStock('IMPORT-MILK','2.500000','1000');
  expect((await pool.query('SELECT name,selling_price_minor FROM catalog.products WHERE id=$1',[productId])).rows[0]).toEqual({name:'Milk updated',selling_price_minor:'1100'});
  expect((await pool.query('SELECT count(*)::int n FROM inventory.movements WHERE tenant_id=$1',[tenantId])).rows[0].n).toBe(1);
  await page.reload(); await importWorkspace(page);
  await expect(page.getByRole('heading',{name:'Import history',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Review import update.csv',exact:true}).first().click();
  await expect(page.getByRole('heading',{name:'Import applied',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Back to stock',exact:true}).click();
  await page.getByRole('button',{name:'Shifts',exact:true}).click();
  await page.getByLabel('Opening float (KES)',{exact:true}).fill('100.00');
  await page.getByRole('button',{name:'Open shift',exact:true}).click();
  await expect(page.getByLabel('Counted cash (KES)',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Sell',exact:true}).first().click();
  const scanner=page.getByLabel(/Search items or scan SKU/);
  await scanner.fill('001234'); await scanner.press('Enter');
  await page.getByRole('button',{name:'Take payment',exact:true}).click();
  await page.getByLabel('Cash received (KES)',{exact:true}).fill('20.00');
  await page.getByRole('button',{name:'Confirm payment',exact:true}).click();
  const receipt=page.getByRole('dialog').filter({has:page.getByRole('button',{name:'Close receipt',exact:true})});
  await expect(receipt).toContainText('Milk updated'); await expect(receipt).toContainText('12.76');
  await page.getByRole('button',{name:'Close receipt',exact:true}).click();
  await page.getByRole('button',{name:'Shifts',exact:true}).click();
  await page.getByLabel('Counted cash (KES)',{exact:true}).fill('112.76');
  await page.getByRole('button',{name:'Close shift',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Z report',exact:true})).toBeVisible();
  await assertStock('IMPORT-MILK','1.500000','600');
  const closed=(await pool.query('SELECT expected_cash_minor,counted_cash_minor,variance_minor FROM commerce.shift_close_reports WHERE tenant_id=$1',[tenantId])).rows;
  expect(closed).toEqual([{expected_cash_minor:'11276',counted_cash_minor:'11276',variance_minor:'0'}]);
});

test('lost import response survives restart and checks original command without duplicating stock or journals', async ({page}) => {
  await signIn(page);
  await upload(page,'recovery.csv',csv([['IMPORT-RECOVER','Recovery item','piece','5.00','2.00','0','KES','000555','General','1','3','2.00']]));
  let validationId='';
  await page.route('**/api/v1/commands',async route=>{
    const body=route.request().postDataJSON();
    if(body.type!=='catalog.import.validate'){await route.continue();return;}
    validationId=body.commandId; await route.fetch(); await route.abort('failed');
  });
  await page.getByRole('button',{name:'Validate all rows',exact:true}).click();
  await expect(page.getByRole('button',{name:'Check command status',exact:true})).toBeVisible();
  const retained=await page.evaluate(async()=>{
    const open=indexedDB.open('mazao-v1-import-validations');
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);});
    try{return await new Promise<unknown[]>((resolve,reject)=>{const request=db.transaction('operations','readonly').objectStore('operations').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}finally{db.close();}
  });
  expect(retained).toHaveLength(1);
  expect(JSON.stringify(retained)).not.toContain('Recovery item');
  expect(JSON.stringify(retained)).not.toContain('openingUnitCost');
  await page.unroute('**/api/v1/commands');
  await page.reload(); await importWorkspace(page);
  await page.getByRole('button',{name:'Check command status',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Proposed changes',exact:true})).toBeVisible();
  expect((await pool.query('SELECT count(*)::int n FROM system.commands WHERE tenant_id=$1 AND command_id=$2',[tenantId,validationId])).rows[0].n).toBe(1);
  expect((await pool.query("SELECT count(*)::int n FROM catalog.products WHERE tenant_id=$1 AND sku='IMPORT-RECOVER'",[tenantId])).rows[0].n).toBe(0);
  await review(page);
  let commandId='';
  await page.route('**/api/v1/commands',async route=>{
    const body=route.request().postDataJSON();
    if(body.type!=='catalog.import.apply'){await route.continue();return;}
    commandId=body.commandId; await route.fetch(); await route.abort('failed');
  });
  await page.getByRole('button',{name:'Apply reviewed import',exact:true}).click();
  await expect(page.getByRole('button',{name:'Check command status',exact:true})).toBeVisible();
  await page.unroute('**/api/v1/commands');
  await page.reload(); await importWorkspace(page);
  await page.getByRole('button',{name:'Check command status',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Import applied',exact:true})).toBeVisible();
  const productId=await assertStock('IMPORT-RECOVER','3.000000','600');
  expect((await pool.query('SELECT count(*)::int n FROM system.commands WHERE tenant_id=$1 AND command_id=$2',[tenantId,commandId])).rows[0].n).toBe(1);
  expect((await pool.query('SELECT count(*)::int n FROM inventory.movements WHERE tenant_id=$1 AND product_id=$2',[tenantId,productId])).rows[0].n).toBe(1);
  const batchId=(await pool.query('SELECT response FROM system.commands WHERE tenant_id=$1 AND command_id=$2',[tenantId,commandId])).rows[0].response.value.batchId;
  expect((await pool.query('SELECT count(*)::int n FROM finance.journal_entries WHERE tenant_id=$1 AND source_id=$2',[tenantId,batchId])).rows[0].n).toBe(1);
});

test('CSV validation is stale after business policy changes and cannot commit until revalidated', async ({page}) => {
  await signIn(page);
  await upload(page,'stale.csv',csv([['IMPORT-STALE','Stale item','piece','5.00','2.00','0','KES','000666','General','1','0','0']]));
  await validate(page); await review(page);
  // Simulate an independently committed settings update in this disposable fixture.
  await pool.query('UPDATE core.tenants SET version=version+1 WHERE id=$1',[tenantId]);
  await page.getByRole('button',{name:'Apply reviewed import',exact:true}).click();
  await expect(page.getByRole('button',{name:'Revalidate against current records',exact:true})).toBeVisible();
  expect((await pool.query("SELECT count(*)::int n FROM catalog.products WHERE tenant_id=$1 AND sku='IMPORT-STALE'",[tenantId])).rows[0].n).toBe(0);
  await page.getByRole('button',{name:'Revalidate against current records',exact:true}).click();
  await expect(page.getByLabel('I reviewed every proposed change and opening stock value',{exact:true})).not.toBeChecked();
  await review(page);
  await page.getByRole('button',{name:'Apply reviewed import',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Import applied',exact:true})).toBeVisible();
});

test('CSV mapping and primary review actions fit all required desktop, tablet and mobile viewports', async ({page}) => {
  await signIn(page);
  await upload(page,'layout.csv',csv([['IMPORT-LAYOUT','Layout item','piece','5.00','2.00','0','KES','000777','General','1','0','0']]));
  for(const [width,height] of [[1024,600],[1280,720],[1280,800],[800,1280],[1366,768],[1920,1080],[390,844]]){
    await page.setViewportSize({width,height});
    const action=page.getByRole('button',{name:'Validate all rows',exact:true}); await action.scrollIntoViewIfNeeded();
    await expect(action).toBeInViewport(); const rect=await action.boundingBox();
    expect(rect!.height).toBeGreaterThanOrEqual(44); expect(rect!.x+rect!.width).toBeLessThanOrEqual(width);
    const signOut=await page.getByRole('button',{name:'Sign out of server',exact:true}).boundingBox();
    expect(signOut!.height).toBeGreaterThanOrEqual(44); expect(signOut!.width).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await validate(page);
  for(const [width,height] of [[1024,600],[1280,720],[1280,800],[800,1280],[1366,768],[1920,1080],[390,844]]){
    await page.setViewportSize({width,height});
    const action=page.getByRole('button',{name:'Apply reviewed import',exact:true}); await action.scrollIntoViewIfNeeded();
    await expect(action).toBeInViewport(); const rect=await action.boundingBox();
    expect(rect!.height).toBeGreaterThanOrEqual(44); expect(rect!.x+rect!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.screenshot({path:test.info().outputPath('csv-review-mobile.png'),fullPage:true});
});
