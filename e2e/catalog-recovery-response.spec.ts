import { expect, test, type Page } from '@playwright/test';
import type { BackendCommand } from '../src/services/apiClient';

const tenantId = '00000000-0000-4000-8000-000000000701';
const userId = '00000000-0000-4000-8000-000000000702';
const deviceId = '00000000-0000-4000-8000-000000000703';
const productId = '00000000-0000-4000-8000-000000000704';

async function savedCommands(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('mazao-v1-command-journal', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Array<{ command: BackendCommand; actorId?: string }>>((resolve, reject) => {
        const request = database.transaction('commands').objectStore('commands').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { database.close(); }
  });
}

async function fixture(page: Page) {
  const posts: BackendCommand[] = [];
  const item = { id: productId, name: 'Retained item', sku: 'KEEP-001', unit: 'each', currency: 'KES', sellingPriceMinor: 1000, costPriceMinor: 500, taxRateBps: 0, quantity: '0', inventoryValueMinor: '0', productVersion: 3, version: 1, category: '', categoryId: null, barcode: null, reorderLevel: '0', active: true };
  const state: { postResponse?: unknown; postDenial?:string; inventoryEnabled:boolean; onPost?:(command:BackendCommand)=>void; statusResponse: () => unknown; statusReads: number } = {
    inventoryEnabled:true,
    statusResponse: () => null,
    statusReads: 0,
  };
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path === '/auth/me') return route.fulfill({ json: { user: { id: userId, name: 'Recovery operator', email: 'recovery@example.invalid', role: 'manager', permissions: ['catalog.manage'] }, tenant: { id: tenantId, name: 'Recovery business', currency: 'KES', timeZone: 'Africa/Nairobi', capabilities: ['commerce',...(state.inventoryEnabled?['inventory']:[])] }, outlet: { id: '00000000-0000-4000-8000-000000000705', name: 'Recovery outlet', timeZone: 'Africa/Nairobi' }, deviceId, csrfToken: 'recovery-csrf' } });
    if (path === '/catalog/items') return route.fulfill({ json: { items: [item] } });
    if (path === '/catalog/categories') return route.fulfill({ json: { categories: [] } });
    if (path === '/inventory/movements') return route.fulfill({ json: { movements: [] } });
    if (path === '/commands') {
      posts.push(route.request().postDataJSON());
      if(state.postDenial)return route.fulfill({status:403,json:{error:{code:state.postDenial,message:'Original import recovery requires inventory authority.'}}});
      state.onPost?.(posts.at(-1)!);
      return state.postResponse === undefined ? route.abort('failed') : route.fulfill({ json: { commandId: posts.at(-1)!.commandId, ...state.postResponse as object } });
    }
    if (path.startsWith('/commands/')) {
      state.statusReads++;
      return route.fulfill({ json: state.statusResponse() });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND' } } });
  });
  return { posts, state };
}

async function openEdit(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Stock', exact: true }).last().click();
  await page.getByRole('button', { name: 'Manage items and categories', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Retained item', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit item', exact: true });
  await dialog.getByLabel('Item name', { exact: true }).fill('Reviewed retained item');
  await dialog.getByLabel('Reason for change').fill('Reviewed original values');
  return dialog;
}

test('malformed lost-command status responses retain the original journal and block a replacement command', async ({ page }) => {
  const { posts, state } = await fixture(page);
  let dialog = await openEdit(page);
  await dialog.getByRole('button', { name: 'Save item changes', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Check change status' })).toBeEnabled();
  const original = structuredClone(posts[0]);
  const value = { productId, version: 4, active: true };
  const malformed = [
    null,
    { commandId: original.commandId, status: 'CONFIRMED', response: { commandId: 'different-command', status: 'CONFIRMED', value } },
    { commandId: original.commandId, status: 'CONFIRMED', response: { commandId: original.commandId, status: 'CONFIRMED', value: {} } },
    { commandId: original.commandId, status: 'REJECTED', response: { commandId: original.commandId, status: 'REJECTED', code: '' } },
    { commandId: original.commandId, status: 'REJECTED', response: { commandId: original.commandId, status: 'REJECTED', code: ' IDEMPOTENCY_MISMATCH ' } },
  ];
  for (const response of malformed) {
    const previousReads = state.statusReads;
    state.statusResponse = () => response;
    await dialog.getByRole('button', { name: 'Check change status' }).click();
    await expect.poll(() => state.statusReads).toBe(previousReads + 1);
    await expect(dialog.getByRole('button', { name: 'Check change status' })).toBeEnabled();
    await expect(dialog.getByLabel('Item name', { exact: true })).toBeDisabled();
    expect((await savedCommands(page)).map(record => record.command)).toEqual([original]);
    expect(posts).toHaveLength(1);
  }
  await page.reload();
  await page.getByRole('button', { name: 'Stock', exact: true }).last().click();
  dialog = page.getByRole('dialog', { name: 'Edit item', exact: true });
  await expect(dialog.getByLabel('Item name', { exact: true })).toHaveValue('Reviewed retained item');
  state.statusResponse = () => ({ commandId: original.commandId, status: 'CONFIRMED', response: { commandId: original.commandId, status: 'CONFIRMED', value } });
  await dialog.getByRole('button', { name: 'Check change status' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await savedCommands(page)).toEqual([]);
  expect(posts).toHaveLength(1);
});

for (const code of ['', 'IDEMPOTENCY_MISMATCH']) {
  test(`a ${code || 'missing-code'} submission rejection retains the original command until a valid status result`, async ({ page }) => {
    const { posts, state } = await fixture(page);
    state.postResponse = { status: 'REJECTED', code };
    const dialog = await openEdit(page);
    await dialog.getByRole('button', { name: 'Save item changes', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Check change status' })).toBeEnabled();
    const original = structuredClone(posts[0]);
    expect((await savedCommands(page)).map(record => record.command)).toEqual([original]);
    state.statusResponse = () => ({ commandId: original.commandId, status: 'REJECTED', response: { commandId: original.commandId, status: 'REJECTED', code: 'VALIDATION_FAILED' } });
    await dialog.getByRole('button', { name: 'Check change status' }).click();
    await expect(dialog.getByRole('button', { name: 'Save item changes', exact: true })).toBeEnabled();
    expect(await savedCommands(page)).toEqual([]);
    expect(posts).toHaveLength(1);
  });
}

test('a lost item creation keeps its original SKU and journal until a complete matching result is returned', async ({ page }) => {
  const { posts, state } = await fixture(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Stock', exact: true }).last().click();
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Create item', exact: true });
  await dialog.getByLabel('Item name', { exact: true }).fill('Created retained item');
  await dialog.getByLabel('SKU', { exact: true }).fill('  NEW-KEEP-001  ');
  await dialog.getByLabel('Selling price (KES)', { exact: true }).fill('15.00');
  state.postResponse = { status: 'CONFIRMED', value: {} };
  await dialog.getByRole('button', { name: 'Create item', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Check change status' })).toBeEnabled();
  const original = structuredClone(posts[0]);
  for (const value of [{}, { productId: 'created-product', sku: 'WRONG-SKU' }]) {
    const previousReads = state.statusReads;
    state.statusResponse = () => ({ commandId: original.commandId, status: 'CONFIRMED', response: { commandId: original.commandId, status: 'CONFIRMED', value } });
    await dialog.getByRole('button', { name: 'Check change status' }).click();
    await expect.poll(() => state.statusReads).toBe(previousReads + 1);
    await expect(dialog.getByRole('button', { name: 'Check change status' })).toBeEnabled();
    expect((await savedCommands(page)).map(record => record.command)).toEqual([original]);
  }
  await page.reload();
  await page.getByRole('button', { name: 'Stock', exact: true }).last().click();
  dialog = page.getByRole('dialog', { name: 'Create item', exact: true });
  await expect(dialog.getByLabel('SKU', { exact: true })).toHaveValue('NEW-KEEP-001');
  state.statusResponse = () => ({ commandId: original.commandId, status: 'CONFIRMED', response: { commandId: original.commandId, status: 'CONFIRMED', value: { productId: 'created-product', sku: 'NEW-KEEP-001' } } });
  await dialog.getByRole('button', { name: 'Check change status' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Item created' })).toBeVisible();
  expect(await savedCommands(page)).toEqual([]);
  expect(posts).toHaveLength(1);
});

test('a denied original import POST retry retains its journal until authorized stored confirmation is recovered', async ({page})=>{
  const {posts,state}=await fixture(page);
  const batchId='00000000-0000-4000-8000-000000000706';
  const csv='sku,name,baseUnit,sellingPrice,costPrice\nIMPORT-KEEP,Retained imported item,each,10,5';
  const batch={
    id:batchId,fileName:'retained-items.csv',mode:'CREATE_ONLY',status:'READY',version:1,
    sourceHash:'a'.repeat(64),sourceBytes:csv.length,businessVersion:1,currency:'KES',defaultTaxRateBps:0,
    createdAt:'2026-10-27T09:00:00Z',createdBy:userId,appliedAt:null as string|null,
    source:{csv,mapping:{sku:'sku',name:'name',baseUnit:'baseUnit',sellingPrice:'sellingPrice',costPrice:'costPrice'}},
    summary:{rowCount:1,createCount:1,updateCount:0,unchangedCount:0,errorCount:0,warningCount:0,openingQuantityLines:0,openingValueMinor:'0'},
    errors:[],warnings:[],rows:[{rowNumber:2,action:'CREATE',sku:'IMPORT-KEEP',
      normalized:{sku:'IMPORT-KEEP',name:'Retained imported item',baseUnit:'each',currency:'KES',sellingPriceMinor:1000,costPriceMinor:500,taxRateBps:0,itemKind:'STOCKED_GOOD',barcode:null,category:'',reorderLevel:'0',openingQuantity:'0',openingUnitCostMinor:null,openingValueMinor:'0'},
      changes:[],defaults:{currency:'TENANT_DEFAULT',tax:'BUSINESS_DEFAULT'}}],
  };
  let commits=0;
  state.onPost=command=>{
    expect(command.type).toBe('catalog.import.apply');
    commits++;batch.status='APPLIED';batch.version=2;batch.appliedAt='2026-10-27T09:05:00Z';
  };
  await page.route('**/api/v1/catalog/imports**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/'+batchId))return state.inventoryEnabled
      ?route.fulfill({json:{batch}})
      :route.fulfill({status:403,json:{error:{code:'CAPABILITY_DISABLED',message:'Inventory is required for this original import.'}}});
    return route.fulfill({json:{batches:state.inventoryEnabled?[batch]:[]}});
  });
  const openCatalog=async()=>{
    await expect(page.getByLabel('Signed in as Recovery operator')).toBeVisible();
    await page.getByRole('button',{name:'Items and services',exact:true}).last().click();
  };
  await page.goto('/');await openCatalog();await page.getByRole('button',{name:'Import products',exact:true}).click();
  await page.getByRole('button',{name:'Review import retained-items.csv',exact:true}).click();
  await page.getByLabel('I reviewed every proposed change and opening stock value').check();
  await page.getByRole('button',{name:'Apply reviewed import',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Check import status',exact:true})).toBeVisible();
  const original=structuredClone(posts[0]);
  expect(original.type).toBe('catalog.import.apply');expect(original.payload).not.toHaveProperty('csv');
  expect((await savedCommands(page)).map(record=>record.command)).toEqual([original]);expect(commits).toBe(1);

  state.inventoryEnabled=false;state.postDenial='CAPABILITY_DISABLED';
  await page.reload();await openCatalog();
  const recovery=page.getByRole('region',{name:'Import actions needing review'});
  await expect(recovery).toContainText(original.commandId);
  await recovery.getByRole('button',{name:'Retry original action',exact:true}).click();
  await expect.poll(()=>posts.length).toBe(2);
  await expect(recovery.getByRole('button',{name:'Retry original action',exact:true})).toBeEnabled();
  expect(posts).toEqual([original,original]);expect(commits).toBe(1);
  expect((await savedCommands(page)).map(record=>record.command)).toEqual([original]);
  await page.reload();await openCatalog();
  await expect(page.getByRole('region',{name:'Import actions needing review'})).toContainText(original.commandId);
  expect((await savedCommands(page)).map(record=>record.command)).toEqual([original]);

  state.inventoryEnabled=true;state.postDenial=undefined;
  state.statusResponse=()=>({commandId:original.commandId,status:'CONFIRMED',response:{status:'CONFIRMED',value:{batchId}}});
  await page.getByRole('region',{name:'Import actions needing review'}).getByRole('button',{name:'Check status',exact:true}).click();
  await expect(page.getByRole('region',{name:'Import actions needing review'})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Import applied',exact:true})).toBeVisible();
  expect(await savedCommands(page)).toEqual([]);expect(posts).toEqual([original,original]);expect(commits).toBe(1);
});
