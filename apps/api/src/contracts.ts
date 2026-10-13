export type ApiRole = 'admin' | 'owner' | 'manager' | 'accountant' | 'cashier' | 'storekeeper' | 'receptionist' | 'housekeeper' | 'waiter' | 'cook' | 'bartender';
export type ApiPermission = 'catalog.manage' | 'inventory.receive' | 'commerce.sell' | 'shift.open' | 'shift.close' | 'finance.view';

export const ROLE_PERMISSIONS: Record<ApiRole, ApiPermission[]> = {
  admin: ['catalog.manage', 'inventory.receive', 'commerce.sell', 'shift.open', 'shift.close', 'finance.view'],
  owner: ['catalog.manage', 'inventory.receive', 'commerce.sell', 'shift.open', 'shift.close', 'finance.view'],
  manager: ['catalog.manage', 'inventory.receive', 'commerce.sell', 'shift.open', 'shift.close', 'finance.view'],
  accountant: ['finance.view'],
  cashier: ['commerce.sell', 'shift.open', 'shift.close'],
  storekeeper: ['inventory.receive'],
  receptionist: [], housekeeper: [], waiter: [], cook: [], bartender: [],
};

export interface ApiSession {
  sessionId: string;
  userId: string;
  fullName: string;
  email: string;
  tenantId: string;
  tenantName: string;
  currency: string;
  outletId: string;
  outletName: string;
  timeZone: string;
  deviceId: string;
  role: ApiRole;
  expiresAt: Date;
}

export interface CommandEnvelope {
  protocolVersion: 1;
  commandId: string;
  tenantId?: string;
  deviceId: string;
  type: string;
  occurredAt: string;
  expectedVersions: Record<string, number>;
  payload: Record<string, unknown>;
}

export class DomainError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 400, readonly details?: unknown) { super(message); }
}
