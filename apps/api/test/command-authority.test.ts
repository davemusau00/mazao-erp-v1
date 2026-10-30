import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DomainError, type ApiSession } from '../src/contracts.js';
import { requireStoredCommandAuthority } from '../src/commandAuthorization.js';

const operator = (capabilities: string[]) => ({ role: 'admin', capabilities } as ApiSession);
const denied = (run: () => void, code: string) => assert.throws(run, error => error instanceof DomainError && error.code === code && error.statusCode === 403);

test('legacy affected types retain their original inventory requirement', () => {
  for (const type of ['catalog.product.create', 'catalog.product.update', 'catalog.category.create', 'catalog.category.merge', 'catalog.import.validate', 'catalog.import.apply', 'sales.order.settle', 'sales.order.refund']) {
    denied(() => requireStoredCommandAuthority(operator(['commerce']), { actor_id: '', outlet_id: '', command_type: type, authority_version: 0, required_capabilities: [] }), 'CAPABILITY_DISABLED');
    requireStoredCommandAuthority(operator(['commerce', 'inventory']), { actor_id: '', outlet_id: '', command_type: type, authority_version: 0, required_capabilities: ['inventory'] });
  }
});

test('new trusted service evidence recovers with commerce while stored inventory remains required', () => {
  requireStoredCommandAuthority(operator(['commerce']), { actor_id: '', outlet_id: '', command_type: 'catalog.product.create', authority_version: 1, required_capabilities: ['commerce'] });
  denied(() => requireStoredCommandAuthority(operator(['commerce']), { actor_id: '', outlet_id: '', command_type: 'catalog.product.create', authority_version: 1, required_capabilities: ['inventory'] }), 'CAPABILITY_DISABLED');
});

test('explicit missing, malformed, duplicate and unknown metadata never broadens authority', () => {
  for (const [authority_version, required_capabilities] of [[null, ['commerce']], [2, ['commerce']], ['1', ['commerce']], [1, undefined], [1, null], [1, {}], [1, []], [1, ['hospitality']], [1, ['commerce', 'commerce']], [1, ['commerce', null]], [1, ['unknown-capability']], [0, null]]) {
    denied(() => requireStoredCommandAuthority(operator(['commerce', 'inventory', 'hospitality']), { actor_id: '', outlet_id: '', command_type: 'catalog.product.create', authority_version, required_capabilities }), 'FORBIDDEN');
  }
});

test('current role permissions and commerce baseline remain required for trusted sale evidence', () => {
  denied(() => requireStoredCommandAuthority({ ...operator(['commerce', 'inventory']), role: 'accountant' }, { actor_id: '', outlet_id: '', command_type: 'sales.order.settle', authority_version: 1, required_capabilities: ['commerce'] }), 'FORBIDDEN');
  denied(() => requireStoredCommandAuthority(operator(['inventory']), { actor_id: '', outlet_id: '', command_type: 'sales.order.settle', authority_version: 1, required_capabilities: ['commerce'] }), 'CAPABILITY_DISABLED');
  denied(() => requireStoredCommandAuthority(operator(['commerce', 'inventory']), { actor_id: '', outlet_id: '', command_type: 'sales.order.settle', authority_version: 1, required_capabilities: [] }), 'FORBIDDEN');
});

test('dedicated credential readers keep legacy zero-capability recovery without accepting unknown types', () => {
  requireStoredCommandAuthority(operator([]), { actor_id: '', outlet_id: '', command_type: 'staff.password.set' });
  requireStoredCommandAuthority(operator([]), { actor_id: '', outlet_id: '', command_type: 'auth.password.change', authority_version: 1, required_capabilities: [] });
  denied(() => requireStoredCommandAuthority(operator(['commerce', 'inventory']), { actor_id: '', outlet_id: '', command_type: 'future.command', authority_version: 1, required_capabilities: [] }), 'FORBIDDEN');
});
