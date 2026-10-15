import type { ApiSession } from './contracts.js';
import { DomainError, ROLE_PERMISSIONS } from './contracts.js';

export function requireCustomerView(session: ApiSession) {
  if (!session.capabilities.includes('commerce')) throw new DomainError('CAPABILITY_DISABLED', 'Customer accounts are not enabled for this tenant.', 403);
  if (!ROLE_PERMISSIONS[session.role].includes('customers.view')) {
    throw new DomainError('FORBIDDEN', 'Your role cannot view customer accounts.', 403);
  }
}
