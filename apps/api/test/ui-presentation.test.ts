import assert from 'node:assert/strict';
import test from 'node:test';
import { textReceipt, type ReceiptPresentation } from '../../../src/utils/receipt.js';
import { actionStatusLabel, importIssueMessage, operationLabel, permissionLabel, roleLabel, sourceLabel } from '../../../src/utils/presentation.js';

test('business labels do not expose raw protocol, permission or role codes', () => {
  assert.equal(operationLabel('sales.order.settle'), 'Sale payment');
  assert.equal(operationLabel('customers.repayment'), 'Customer repayment');
  assert.equal(operationLabel('new.internal.action'), 'Business action');
  assert.equal(actionStatusLabel('CONFLICT'), 'Changed elsewhere');
  assert.equal(actionStatusLabel('NEW_INTERNAL_STATUS'), 'Needs review');
  assert.equal(permissionLabel('customers.charge'), 'Charge customer accounts');
  assert.equal(permissionLabel('new.internal.permission'), 'Additional business access');
  assert.equal(roleLabel('storekeeper'), 'Storekeeper');
  assert.equal(roleLabel('new_internal_role'), 'Staff member');
  assert.equal(sourceLabel('SALE_COGS'), 'Cost of sold items');
  assert.equal(sourceLabel('restock'), 'Stock received');
  assert.doesNotMatch(importIssueMessage('MONEY_INVALID'), /minor.unit|server|payload/i);
  assert.doesNotMatch(importIssueMessage('NEW_INTERNAL_CODE'), /NEW_INTERNAL_CODE/);
});

const receipt: ReceiptPresentation = {
  receiptId: '12345678-abcd-1234-abcd-123456789abc',
  tenantName: 'Business', outletName: 'Main outlet', currency: 'KES',
  timeZone: 'Africa/Nairobi', createdAt: '2026-10-18T09:00:00Z', operatorName: 'Cashier',
  originalSubtotalMinor: '20000', discountMinor: '3000',
  subtotalMinor: '17000', taxMinor: '2720', totalMinor: '19720', amountPaidMinor: '19720',
  customerAccountCharge: null, cashTenderedMinor: null, changeMinor: null,
  lines: [{ name: 'Item', quantity: '2.000000', unitPriceMinor: '10000',
    originalSubtotalMinor: '20000', discountMinor: '3000', discountReason: 'Offer',
    subtotalMinor: '17000' }],
  payments: [{ method: 'MANUAL_MPESA', amountMinor: '19720', currency: 'KES',
    reference: 'ABC12345' }],
};

test('receipt text retains exact discounts and cashier-confirmed M-Pesa without cash change', () => {
  const before = JSON.stringify(receipt);
  const text = textReceipt(receipt);
  assert.match(text, /Items before discounts: KES\s200/);
  assert.match(text, /Item discounts: KES\s30/);
  assert.match(text, /2 x KES\s100/);
  assert.match(text, /Total: KES\s197\.20/);
  assert.match(text, /M-Pesa \(cashier confirmed\): KES\s197\.20 \| Reference: ABC12345/);
  assert.doesNotMatch(text, /Cash received:|Change:|2\.000000|100\.00|server|command|integration/i);
  assert.equal(JSON.stringify(receipt), before, 'presentation must not rewrite receipt evidence');
});

test('historical cash receipts omit absent discount fields and retain exact cash values', () => {
  const oldReceipt = { ...receipt, originalSubtotalMinor: undefined, discountMinor: undefined,
    cashTenderedMinor: '20000', changeMinor: '280', payments: [{ method: 'CASH', amountMinor: '19720', currency: 'KES' }],
    lines: receipt.lines.map(({ originalSubtotalMinor, discountMinor, discountReason, ...line }) => line) };
  const text = textReceipt(oldReceipt);
  assert.doesNotMatch(text, /discount|M-Pesa/);
  assert.match(text, /Cash received: KES\s200/);
  assert.match(text, /Change: KES\s2\.80/);
});

