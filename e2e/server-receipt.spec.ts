import { expect, test } from '@playwright/test';

test('receipt preview renders only the immutable server snapshot and keeps printer status explicit', async ({ page }) => {
  const orderId = 'order-receipt-test';
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: {
    user: { id: 'manager-user', name: 'MAYA MANAGER', email: 'manager@example.test', role: 'manager', permissions: ['commerce.sell', 'commerce.refund'] },
    tenant: { id: 'tenant-a', name: 'Countryside Resort', currency: 'KES', timeZone: 'Africa/Nairobi', capabilities: ['commerce', 'inventory'] },
    outlet: { id: 'outlet-a', name: 'Garden Cafe', timeZone: 'Africa/Nairobi' }, deviceId: 'device-a', csrfToken: 'csrf-a',
  } }));
  await page.route('**/api/v1/sales/orders', route => route.fulfill({ json: { orders: [{
    id: orderId, orderNumber: 'RCP-2026-0042', timestamp: '2026-10-15T08:00:00.000Z', cashierName: 'MAYA MANAGER',
    currency: 'KES', subtotalMinor: 10000, taxMinor: 1600, totalMinor: 11600, paidMinor: 11600, amountDueMinor: 0,
    customerName: null, refundedMinor: 0, status: 'completed', paymentMethod: 'cash',
    lines: [{ lineId: 'line-a', productId: 'product-a', sku: 'TEA-01', name: 'Kenyan tea', quantity: '2', unitPriceMinor: '5000', taxRateBps: 1600, subtotalMinor: '10000', taxMinor: '1600', refundedQuantity: '0' }],
  }] } }));
  await page.route(`**/api/v1/sales/orders/${orderId}/receipt`, route => route.fulfill({ json: {
    status: 'CONFIRMED', fiscalDocumentStatus: 'NOT_INTEGRATED', receiptId: orderId, receiptNumber: 'RCP-2026-0042',
    tenantName: 'Countryside Resort', outletName: 'Garden Cafe', timeZone: 'Africa/Nairobi',
    receiptProfile: { legalName: 'Countryside Resort Limited', address: 'Nairobi, Kenya', phone: '+254700000000', taxLabel: 'VAT', receiptFooter: 'Thank you for visiting.' },
    currency: 'KES', createdAt: '2026-10-15T08:00:00.000Z', operatorName: 'MAYA MANAGER', saleStatus: 'completed',
    lines: [{ lineId: 'line-a', sku: 'TEA-01', name: 'Kenyan tea', quantity: '2', unitPriceMinor: '5000', taxRateBps: 1600, subtotalMinor: '10000', taxMinor: '1600', totalMinor: '11600' }],
    payments: [{ method: 'cash', amountMinor: '11600', currency: 'KES', status: 'confirmed' }],
    subtotalMinor: '10000', taxMinor: '1600', totalMinor: '11600', amountPaidMinor: '11600', customerAccountCharge: null, cashTenderedMinor: '12000', changeMinor: '400',
  } }));

  await page.goto('/');
  await page.getByRole('button', { name: /^Sales history/ }).click();
  await page.getByRole('button', { name: 'Receipt preview' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Countryside Resort Limited')).toBeVisible();
  await expect(dialog.getByText('Kenyan tea')).toBeVisible();
  await expect(dialog.getByText('KES 116.00').first()).toBeVisible();
  await expect(dialog.getByText('KES 120.00')).toBeVisible();
  await expect(dialog.getByText('KES 4.00')).toBeVisible();
  await expect(dialog.getByText('Thank you for visiting.')).toBeVisible();
  await expect(dialog.getByText('Browser printing is not printer-device acknowledgement.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Open print dialog' })).toBeEnabled();
});
