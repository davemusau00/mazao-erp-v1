import assert from 'node:assert/strict';
import test from 'node:test';
import { filterCustomers, summarizeCustomers, type CustomerPresentationAccount } from '../../../src/components/customers/customerPresentation.ts';
import { requireCustomerView } from '../src/customerPolicy.js';
import type { ApiSession } from '../src/contracts.js';

const customers: CustomerPresentationAccount[] = [
  { id:'a', name:'Alpha Foods', phone:'0711000000', email:'alpha@example.test', creditLimitMinor:'900719925474099312345', balanceMinor:'900719925474099300001', status:'ACTIVE', version:1, createdAt:'', updatedAt:'' },
  { id:'b', name:'Beta Cafe', phone:'0712000000', email:null, creditLimitMinor:'10000', balanceMinor:'0', status:'SUSPENDED', version:1, createdAt:'', updatedAt:'' },
];

test('customer portfolio totals, remaining credit and utilization stay exact beyond Number precision', () => {
  const summary = summarizeCustomers(customers);
  assert.equal(summary.totalBalanceMinor, 900719925474099300001n);
  assert.equal(summary.totalCreditLimitMinor, 900719925474099322345n);
  assert.equal(summary.debtors, 1);
  assert.equal(summary.suspended, 1);
  assert.equal(summary.utilizationTenths, '999');
  assert.equal(BigInt(customers[0].creditLimitMinor) - BigInt(customers[0].balanceMinor), 12344n);
});

test('customer filters use server account status and exact minor-unit balance', () => {
  assert.deepEqual(filterCustomers(customers, '', 'debtors').map(customer => customer.id), ['a']);
  assert.deepEqual(filterCustomers(customers, '', 'good_standing').map(customer => customer.id), ['b']);
  assert.deepEqual(filterCustomers(customers, 'BETA', 'suspended').map(customer => customer.id), ['b']);
  assert.deepEqual(filterCustomers(customers, 'missing', 'all'), []);
});

function session(role: ApiSession['role'], capabilities = ['commerce']): ApiSession {
  return { sessionId:'s', userId:'u', fullName:'Test User', email:'user@example.test', tenantId:'t', tenantName:'Tenant', currency:'KES', outletId:'o', outletName:'Outlet', timeZone:'Africa/Nairobi', deviceId:'d', role, capabilities, expiresAt:new Date() };
}

test('customer read policy permits authorized roles and rejects private or disabled accounts', () => {
  assert.doesNotThrow(() => requireCustomerView(session('cashier')));
  assert.doesNotThrow(() => requireCustomerView(session('accountant')));
  assert.throws(() => requireCustomerView(session('storekeeper')), { code:'FORBIDDEN', statusCode:403 });
  assert.throws(() => requireCustomerView(session('cashier', [])), { code:'CAPABILITY_DISABLED', statusCode:403 });
});
