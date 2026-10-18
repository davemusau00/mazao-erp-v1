import { expect, test } from '@playwright/test';

test('recovery center checks the retained command without resubmitting it',async({page})=>{
  await page.addInitScript(async()=>{
    await new Promise<void>((resolve,reject)=>{
      const request=indexedDB.open('mazao-v1-command-journal',1);
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('commands'))request.result.createObjectStore('commands',{keyPath:'command.commandId'});};
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const database=request.result;
        const transaction=database.transaction('commands','readwrite');
        transaction.objectStore('commands').put({
          command:{protocolVersion:1,commandId:'retained-repayment-1',tenantId:'recovery-tenant',deviceId:'recovery-device',type:'customers.repayment',occurredAt:'2026-10-15T08:00:00.000Z',expectedVersions:{},payload:{customerId:'customer-private',amountMinor:1000}},
          actorId:'recovery-operator',state:'outcome_unknown',savedAt:'2026-10-15T08:01:00.000Z',
        });
        transaction.oncomplete=()=>{database.close();resolve();};
        transaction.onerror=()=>reject(transaction.error);
      };
    });
  });
  await page.route('**/api/v1/auth/me',route=>route.fulfill({json:{user:{id:'recovery-operator',name:'RECOVERY OPERATOR',email:'recovery@example.test',role:'manager',permissions:['customers.view','customers.settle']},tenant:{id:'recovery-tenant',name:'Recovery Business',currency:'KES',timeZone:'Africa/Nairobi',capabilities:['commerce']},outlet:{id:'recovery-outlet',name:'Main outlet',timeZone:'Africa/Nairobi'},deviceId:'recovery-device',csrfToken:'recovery-csrf'}}));
  let commandPosts=0;
  await page.route('**/api/v1/commands/retained-repayment-1',route=>route.fulfill({json:{commandId:'retained-repayment-1',status:'CONFIRMED',response:{commandId:'retained-repayment-1',status:'CONFIRMED',value:{repaymentId:'repayment-1'}}}}));
  await page.route('**/api/v1/commands',route=>{commandPosts++;return route.fulfill({json:{commandId:'retained-repayment-1',status:'CONFIRMED',value:{repaymentId:'repayment-1'}}});});
  await page.goto('/');
  await page.getByRole('button',{name:'Review actions'}).click();
  const dialog=page.getByRole('dialog',{name:'Actions needing review'});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Customer repayment')).toBeVisible();
  await expect(dialog.getByText(/Nothing is automatically sent again from here/)).toBeVisible();
  await dialog.getByRole('button',{name:'Check status'}).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(commandPosts).toBe(0);
});
