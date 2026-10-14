export type ApiRole = 'admin' | 'owner' | 'manager' | 'accountant' | 'cashier' | 'storekeeper' | 'receptionist' | 'housekeeper' | 'waiter' | 'cook' | 'bartender';
export type ApiPermission = 'config.view' | 'config.manage' | 'catalog.manage' | 'inventory.receive' | 'inventory.count' | 'inventory.count.approve' | 'commerce.sell' | 'commerce.refund' | 'shift.open' | 'shift.payout' | 'shift.close' | 'finance.view' | 'customers.view' | 'customers.charge' | 'customers.manage' | 'customers.settle' | 'hotel.manage' | 'hotel.frontdesk' | 'hotel.housekeeping';

export const ROLE_PERMISSIONS: Record<ApiRole, ApiPermission[]> = {
  admin: ['config.view', 'config.manage', 'catalog.manage', 'inventory.receive', 'inventory.count', 'inventory.count.approve', 'commerce.sell', 'commerce.refund', 'shift.open', 'shift.payout', 'shift.close', 'finance.view', 'customers.view', 'customers.charge', 'customers.manage', 'customers.settle','hotel.manage','hotel.frontdesk','hotel.housekeeping'],
  owner: ['config.view', 'config.manage', 'catalog.manage', 'inventory.receive', 'inventory.count', 'inventory.count.approve', 'commerce.sell', 'commerce.refund', 'shift.open', 'shift.payout', 'shift.close', 'finance.view', 'customers.view', 'customers.charge', 'customers.manage', 'customers.settle','hotel.manage','hotel.frontdesk','hotel.housekeeping'],
  manager: ['config.view', 'catalog.manage', 'inventory.receive', 'inventory.count', 'inventory.count.approve', 'commerce.sell', 'commerce.refund', 'shift.open', 'shift.payout', 'shift.close', 'finance.view', 'customers.view', 'customers.charge', 'customers.manage', 'customers.settle','hotel.manage','hotel.frontdesk','hotel.housekeeping'],
  accountant: ['finance.view', 'customers.view'],
  cashier: ['commerce.sell', 'shift.open', 'shift.close', 'customers.view', 'customers.charge', 'customers.settle'],
  storekeeper: ['inventory.receive', 'inventory.count'],
  receptionist: ['hotel.frontdesk','shift.open','shift.close'], housekeeper: ['hotel.housekeeping'], waiter: [], cook: [], bartender: [],
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
  capabilities:string[];
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
