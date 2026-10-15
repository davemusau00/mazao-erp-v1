import assert from 'node:assert/strict';
import test from 'node:test';
import { reportRange, requireOperationalAnalytics } from '../src/operationalAnalyticsPolicy.js';
import type { ApiSession } from '../src/contracts.js';

function session(role:ApiSession['role'],capabilities=['commerce']):ApiSession{return {sessionId:'s',userId:'u',fullName:'Test User',email:'test@example.test',tenantId:'tenant',tenantName:'Tenant',currency:'KES',outletId:'outlet',outletName:'Outlet',timeZone:'Africa/Nairobi',deviceId:'device',role,capabilities,expiresAt:new Date()};}

test('operational analytics requires finance visibility and the commerce capability',()=>{
  assert.doesNotThrow(()=>requireOperationalAnalytics(session('manager')));
  assert.doesNotThrow(()=>requireOperationalAnalytics(session('accountant')));
  assert.throws(()=>requireOperationalAnalytics(session('cashier')),{code:'FORBIDDEN',statusCode:403});
  assert.throws(()=>requireOperationalAnalytics(session('manager',[])),{code:'CAPABILITY_DISABLED',statusCode:403});
});

test('operational analytics range validates calendar dates and caps reports at 367 days',()=>{
  assert.deepEqual(reportRange('2025-01-01','2026-01-02'),{from:'2025-01-01',to:'2026-01-02'});
  assert.throws(()=>reportRange('2025-02-29','2025-03-01'),{code:'VALIDATION_FAILED'});
  assert.throws(()=>reportRange('2025-02-01','2025-01-31'),{code:'VALIDATION_FAILED'});
  assert.throws(()=>reportRange('2025-01-01','2026-01-03'),{code:'VALIDATION_FAILED'});
});
