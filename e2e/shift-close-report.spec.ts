import { expect, test } from '@playwright/test';

const managerSession = {
  user: {
    id: 'shift-manager-1', name: 'Nia Manager', email: 'nia@example.invalid', role: 'manager',
    permissions: [
      'catalog.manage', 'inventory.receive', 'inventory.count', 'inventory.count.approve',
      'commerce.sell', 'commerce.refund', 'shift.open', 'shift.payout', 'shift.close', 'finance.view',
      'customers.view', 'customers.charge', 'customers.manage', 'customers.settle',
    ],
  },
  tenant: { id: 'shift-tenant-1', name: 'Mazao Test Outlet', currency: 'KES', timeZone: 'Africa/Nairobi', capabilities: ['retail', 'inventory', 'commerce'] },
  outlet: { id: 'shift-outlet-1', name: 'Nairobi Counter' },
  deviceId: 'shift-device-1', csrfToken: 'csrf-shift-test',
};

test('operator opens, closes and reviews the server Z report for a business day', async ({ page }) => {
  let shift: Record<string, unknown> | null = null;
  let closeReports: Record<string, unknown>[] = [];

  await page.route('**/api/v1/auth/me', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } }) }));
  await page.route('**/api/v1/auth/login', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(managerSession) }));
  await page.route('**/api/v1/shifts/current', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ shift }) }));
  await page.route('**/api/v1/shifts/close-reports', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reports: closeReports }) }));
  await page.route('**/api/v1/commands', async route => {
    const command = route.request().postDataJSON() as { commandId: string; type: string; payload: { openingFloatMinor?: number; countedCashMinor?: number }; expectedVersions: Record<string, number> };
    if (command.type === 'shift.open') {
      shift = {
        id: 'shift-day-1', status: 'OPEN', openingFloatMinor: command.payload.openingFloatMinor, cashSalesMinor: 0,
        customerCollectionsMinor: 0, cashRefundsMinor: 0, cashPaidInMinor: 0, cashPayoutMinor: 0,
        expectedCashMinor: command.payload.openingFloatMinor, version: 1, openedAt: '2026-10-14T06:00:00.000Z', cashMovements: [],
      };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ commandId: command.commandId, status: 'CONFIRMED', value: { shiftId: 'shift-day-1', version: 1 } }) });
    }

    const reportId = 'report-day-1';
    const closedAt = '2026-10-14T17:00:00.000Z';
    closeReports = [{
      id: reportId, shiftId: 'shift-day-1', commandId: command.commandId, operatorId: managerSession.user.id,
      operatorName: managerSession.user.name, tenantName: managerSession.tenant.name, outletName: managerSession.outlet.name,
      timeZone: managerSession.tenant.timeZone, businessDate: '2026-10-14', currency: 'KES', shiftVersion: command.expectedVersions['shift:shift-day-1'] + 1,
      openedAt: '2026-10-14T06:00:00.000Z', closedAt, openingFloatMinor: '500000', cashSalesMinor: '0',
      customerCollectionsMinor: '0', cashRefundsMinor: '0', cashPaidInMinor: '0', cashPayoutMinor: '0',
      expectedCashMinor: '500000', countedCashMinor: String(command.payload.countedCashMinor), varianceMinor: String(command.payload.countedCashMinor! - 500000),
    }, ...closeReports];
    shift = null;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ commandId: command.commandId, status: 'CONFIRMED', value: { shiftId: 'shift-day-1', closeReportId: reportId, businessDate: '2026-10-14', version: 2, expectedCashMinor: '500000', countedCashMinor: String(command.payload.countedCashMinor), varianceMinor: '0' } }) });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in to Mazao' })).toBeVisible();
  await page.getByLabel('Email').fill(managerSession.user.email);
  await page.getByLabel('Password').fill('test-password-only');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Shifts', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'No till is open' })).toBeVisible();
  await page.getByLabel(/Opening float/).fill('5000.00');
  await page.getByRole('button', { name: 'Open shift' }).click();
  await expect(page.getByText('Shift open', { exact: true })).toBeVisible();

  await page.getByLabel(/Counted cash/).fill('5000.00');
  await page.getByRole('button', { name: 'Close shift' }).click();
  await expect(page.getByRole('heading', { name: 'Z report' })).toBeVisible();
  await expect(page.getByText(/Cash variance:/)).toBeVisible();
  await expect(page.getByText('Your close report is shown below.')).toBeVisible();
});
