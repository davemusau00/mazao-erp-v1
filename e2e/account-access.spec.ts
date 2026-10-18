import { expect, test, type Page } from '@playwright/test';

const userId = 'account-operator';
const tenantId = 'account-tenant';
const currentPassword = 'Current-browser-password-17!';
const newPassword = 'Changed-browser-password-32!';
const rolePermissions: Record<string, string[]> = {
  cashier: ['commerce.sell', 'shift.open', 'shift.close'],
  receptionist: ['hotel.frontdesk', 'shift.open', 'shift.close'],
  manager: ['config.view', 'commerce.sell', 'shift.open', 'shift.close', 'finance.view'],
  admin: ['config.view', 'config.manage', 'staff.view', 'staff.manage'],
};

function session(role: string) {
  return { user: { id: userId, name: 'Account Operator', email: 'operator@example.invalid', role, permissions: rolePermissions[role], credentialVersion: 1 }, tenant: { id: tenantId, name: 'Account Business', currency: 'KES', timeZone: 'Africa/Nairobi', capabilities: ['commerce', 'inventory', 'hospitality'] }, outlet: { id: 'account-outlet', name: 'Account outlet', timeZone: 'Africa/Nairobi' }, deviceId: 'account-device', csrfToken: 'account-csrf' };
}

function sessionRows() {
  return [
    { id: 'current-session', deviceId: 'account-device', deviceLabel: 'Current workspace', outletId: 'account-outlet', outletName: 'Account outlet', createdAt: '2026-10-16T06:00:00Z', expiresAt: '2099-10-17T06:00:00Z', revokedAt: null, version: 2, current: true },
    { id: 'other-session', deviceId: 'other-device', deviceLabel: 'Other workspace', outletId: 'account-outlet', outletName: 'Account outlet', createdAt: '2026-10-16T05:00:00Z', expiresAt: '2099-10-17T06:00:00Z', revokedAt: null, version: 3, current: false },
  ];
}

async function routeAccount(page: Page, role = 'cashier') {
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: session(role) }));
  await page.route('**/api/v1/shifts/current', route => route.fulfill({ json: { shift: null } }));
  await page.route('**/api/v1/auth/sessions', route => route.fulfill({ json: { userId, credentialVersion: 4, sessions: sessionRows() } }));
}

async function openAccount(page: Page) {
  await page.getByRole('button', { name: 'Signed in as Account Operator' }).click();
  const dialog = page.getByRole('dialog', { name: 'My account' });
  await expect(dialog.getByRole('heading', { name: 'My sessions' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Change my password', exact: true })).toBeEnabled();
  return dialog;
}

async function fillOwnPassword(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'My account' });
  await dialog.getByLabel('Current password', { exact: true }).fill(currentPassword);
  await dialog.getByLabel('New password', { exact: true }).fill(newPassword);
  await dialog.getByLabel('Confirm new password').fill(newPassword);
}

for (const [role, viewport] of [
  ['cashier', { width: 390, height: 844 }],
  ['receptionist', { width: 1024, height: 600 }],
  ['manager', { width: 1280, height: 720 }],
] as const) test(`${role} can reach their own account with keyboard and responsive controls`, async ({ page }, testInfo) => {
  await page.setViewportSize(viewport);
  await routeAccount(page, role);
  let staffReads = 0;
  await page.route('**/api/v1/staff**', route => { staffReads++; return route.fulfill({ status: 403, json: {} }); });
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Signed in as Account Operator' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'My account' });
  await expect(dialog.getByText('Account outlet', { exact: true }).first()).toBeVisible();
  await expect(dialog.getByLabel('New password', { exact: true })).toBeEditable();
  await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused();
  const closeBounds = await dialog.getByRole('button', { name: 'Close dialog' }).boundingBox();
  const triggerBounds = await trigger.boundingBox();
  expect(closeBounds!.height).toBeGreaterThanOrEqual(44);
  expect(closeBounds!.width).toBeGreaterThanOrEqual(44);
  expect(triggerBounds!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const screenshot = testInfo.outputPath(`${role}-account-${viewport.width}x${viewport.height}.png`);
  await page.screenshot({ path: screenshot });
  await testInfo.attach(`${role}-account-${viewport.width}x${viewport.height}`, { path: screenshot, contentType: 'image/png' });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(staffReads).toBe(0);
});

test('self-service password request uses the current server version and blocks dismissal while active', async ({ page }) => {
  await routeAccount(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let requestBody: Record<string, any> | undefined;
  await page.route('**/api/v1/auth/password', async route => {
    requestBody = route.request().postDataJSON();
    expect(route.request().headers()['x-csrf-token']).toBe('account-csrf');
    await held;
    await route.fulfill({ json: { commandId: requestBody!.commandId, status: 'CONFIRMED', value: { credentialVersion: 5, sessionsRevoked: 2, reauthenticate: true } } });
  });
  await page.goto('/');
  const dialog = await openAccount(page);
  await fillOwnPassword(page);
  await dialog.getByRole('button', { name: 'Change my password', exact: true }).click();
  await expect.poll(() => requestBody).toBeTruthy();
  expect(requestBody).toMatchObject({ protocolVersion: 1, expectedVersions: { [`credential:${userId}`]: 4 }, currentPassword, newPassword });
  await expect(dialog.getByLabel('New password', { exact: true })).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => window.dispatchEvent(new Event('mazao:before-navigate', { cancelable: true })))).toBe(false);
  release();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
});

test('unknown password outcome survives closing the account and retains no password in recovery', async ({ page }) => {
  await routeAccount(page);
  let commandId = '', posts = 0, checkedId = '';
  await page.route('**/api/v1/auth/password', route => { posts++; commandId = route.request().postDataJSON().commandId; return route.abort('failed'); });
  let confirmed = false;
  await page.route('**/api/v1/commands/*', route => {
    checkedId = route.request().url().split('/').at(-1)!;
    return confirmed
      ? route.fulfill({ json: { commandId, status: 'CONFIRMED', response: { commandId, status: 'CONFIRMED', value: { reauthenticate: true, credentialVersion: 5 } } } })
      : route.fulfill({ status: 404, json: { error: { message: 'Command not found' } } });
  });
  await page.goto('/');
  let dialog = await openAccount(page);
  await fillOwnPassword(page);
  await dialog.getByRole('button', { name: 'Change my password', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Check password change status' })).toBeVisible();
  const retained = await page.evaluate(async () => new Promise<any[]>((resolve, reject) => {
    const request = indexedDB.open('mazao-v1-secret-operations', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { const database = request.result; const read = database.transaction('operations').objectStore('operations').getAll(); read.onsuccess = () => { database.close(); resolve(read.result); }; };
  }));
  expect(retained).toHaveLength(1);
  expect(retained[0]).toMatchObject({ commandId, actorId: userId, targetUserId: userId, state: 'outcome_unknown' });
  expect(JSON.stringify(retained)).not.toContain(newPassword);
  expect(JSON.stringify(retained)).not.toContain(currentPassword);
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  dialog = await openAccountAfterPending(page);
  await dialog.getByText('Support reference', { exact: true }).click();
  await expect(dialog.getByText(`Reference ${commandId}`, { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('New password', { exact: true })).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Change my password', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Check password change status' }).click();
  await expect(dialog.getByRole('alert')).toContainText('No completed password operation was found yet');
  expect(checkedId).toBe(commandId);
  expect(posts).toBe(1);
  confirmed = true;
  await dialog.getByRole('button', { name: 'Check password change status' }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect(posts).toBe(1);
});

async function openAccountAfterPending(page: Page) {
  await page.getByRole('button', { name: 'Signed in as Account Operator' }).click();
  const dialog = page.getByRole('dialog', { name: 'My account' });
  await expect(dialog.getByRole('button', { name: 'Check password change status' })).toBeEnabled();
  return dialog;
}

test('operator can revoke another own session using its exact server version', async ({ page }) => {
  await routeAccount(page);
  const records = sessionRows();
  await page.route('**/api/v1/auth/sessions', route => route.fulfill({ json: { userId, credentialVersion: 4, sessions: records } }));
  let sent: any;
  await page.route('**/api/v1/commands', route => {
    sent = route.request().postDataJSON();
    records[1].revokedAt = '2026-10-16T07:00:00Z' as any;
    return route.fulfill({ json: { commandId: sent.commandId, status: 'CONFIRMED', value: { sessionId: 'other-session' } } });
  });
  await page.goto('/');
  const dialog = await openAccount(page);
  await dialog.getByRole('button', { name: 'Sign out session Other workspace', exact: true }).click();
  await dialog.getByLabel('Session sign-out reason').fill('Shared workstation returned');
  await dialog.getByRole('button', { name: 'Confirm session sign-out' }).click();
  await expect(dialog.getByRole('button', { name: 'Sign out session Other workspace', exact: true })).toHaveCount(0);
  expect(sent).toMatchObject({ type: 'auth.session.revoke', deviceId: 'account-device', expectedVersions: { 'session:other-session': 3 }, payload: { sessionId: 'other-session', reason: 'Shared workstation returned' } });
  expect(sent.payload).not.toHaveProperty('userId');
});

test('changing staff target clears secret fields, visibility and errors, and locks target changes during submission', async ({ page }) => {
  await routeAccount(page, 'admin');
  const configuration = {
    business: { id: tenantId, name: 'Account Business', currency: 'KES', timeZone: 'Africa/Nairobi', version: 1, legalName: '', registrationNumber: '', taxRegistrationNumber: '', address: '', phone: '', email: '', website: '', logoUrl: '', receiptQrImage: '', showQrOnReceipt: false, receiptHeader: '', receiptFooter: '', taxPolicy: { calculation: 'exclusive', defaultRateBps: 1600, label: 'VAT', reviewed: true } },
    outlet: { id: 'account-outlet', name: 'Account outlet', timeZone: 'Africa/Nairobi', version: 1, address: '', phone: '', email: '', receiptHeader: '', receiptFooter: '' },
    capabilities: ['commerce', 'inventory'], supportedCapabilities: ['commerce', 'inventory'], currencyLocked: false, readiness: { readyForFirstSale: false, checks: [] },
  };
  const staff = ['Alpha', 'Beta'].map((name, index) => ({ userId: `operator-${name}`, displayName: `Operator ${name}`, email: `${name.toLowerCase()}@example.invalid`, role: 'cashier', active: true, version: 1, credentialVersion: index ? 7 : 2, hasCredential: true, assignmentCount: 1, activeSessionCount: 0 }));
  await page.route('**/api/v1/configuration', route => route.fulfill({ json: { configuration } }));
  await page.route('**/api/v1/staff', route => route.fulfill({ json: { staff, roles: [{ role: 'cashier', label: 'Cashier', permissions: [], assignable: true }], outlets: [{ ...configuration.outlet, active: true }], authorizationModel: 'COARSE_ROLE_MAP' } }));
  await page.route('**/api/v1/staff/*/sessions', route => route.fulfill({ json: { userId: route.request().url().includes('Alpha') ? 'operator-Alpha' : 'operator-Beta', credentialVersion: 2, sessions: [] } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  await page.locator('.manage-grid').getByRole('button', { name: /^Staff/ }).click();
  const selected = page.getByRole('region', { name: 'Selected staff member' });
  await expect(selected.getByRole('button', { name: 'Reset operator password', exact: true })).toBeEnabled();
  await selected.getByLabel('New password', { exact: true }).fill(newPassword);
  await selected.getByLabel('Confirm new password').fill('A different valid password');
  await selected.getByRole('button', { name: 'Reset operator password', exact: true }).click();
  await expect(selected.getByRole('alert')).toContainText('Passwords did not match');
  await selected.getByLabel('New password', { exact: true }).fill(newPassword);
  await selected.getByLabel('Confirm new password').fill(newPassword);
  await selected.getByRole('button', { name: 'Show new password' }).click();
  await expect(selected.getByLabel('New password', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: /Operator Beta.*beta@example.invalid/ }).click();
  await expect(selected.getByRole('heading', { name: 'Operator Beta', exact: true })).toBeVisible();
  await expect(selected.getByLabel('New password', { exact: true })).toHaveValue('');
  await expect(selected.getByLabel('Confirm new password')).toHaveValue('');
  await expect(selected.getByLabel('New password', { exact: true })).toHaveAttribute('type', 'password');
  await expect(selected.getByRole('alert')).toHaveCount(0);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let payload: any;
  await page.route('**/api/v1/staff/operator-Beta/password', async route => { payload = route.request().postDataJSON(); await held; await route.fulfill({ json: { commandId: payload.commandId, status: 'REJECTED', code: 'PASSWORD_POLICY_REJECTED', message: 'Credential policy rejected this request.' } }); });
  await selected.getByLabel('New password', { exact: true }).fill(newPassword);
  await selected.getByLabel('Confirm new password').fill(newPassword);
  await selected.getByRole('button', { name: 'Reset operator password', exact: true }).click();
  await expect.poll(() => payload).toBeTruthy();
  expect(payload.expectedVersions).toEqual({ 'credential:operator-Beta': 7 });
  await expect(page.getByRole('button', { name: /Operator Alpha.*alpha@example.invalid/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Signed in as Account Operator' }).click();
  await expect(page.getByRole('dialog', { name: 'My account' })).toHaveCount(0);
  await page.getByRole('button', { name: 'All settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Staff access' })).toBeVisible();
  release();
  await expect(selected.getByRole('alert')).toContainText('This action could not be completed');
  await page.getByRole('button', { name: /Operator Alpha.*alpha@example.invalid/ }).click();
  await expect(selected.getByRole('alert')).toHaveCount(0);
  await expect(selected.getByLabel('New password', { exact: true })).toHaveValue('');
});
