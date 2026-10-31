export type ApiRole = 'admin' | 'owner' | 'manager' | 'accountant' | 'cashier' | 'storekeeper' | 'receptionist' | 'housekeeper' | 'waiter' | 'cook' | 'bartender';
export type ApiPermission = 'staff.view' | 'staff.manage' | 'devices.view' | 'devices.manage' | 'config.view' | 'config.manage' | 'catalog.manage' | 'inventory.receive' | 'inventory.count' | 'inventory.count.approve' | 'inventory.shortfall.view' | 'inventory.shortfall.configure' | 'inventory.shortfall.resolve' | 'commerce.sell' | 'commerce.discount' | 'commerce.refund' | 'shift.open' | 'shift.payout' | 'shift.close' | 'finance.view' | 'finance.manage' | 'finance.close' | 'customers.view' | 'customers.charge' | 'customers.manage' | 'customers.settle' | 'hotel.manage' | 'hotel.frontdesk' | 'hotel.housekeeping' | 'restaurant.view' | 'restaurant.manage' | 'restaurant.order.view' | 'restaurant.order' | 'restaurant.ticket.view' | 'restaurant.ticket.work';

export const ROLE_PERMISSIONS: Record<ApiRole, ApiPermission[]> = {
  admin: ['restaurant.order.view', 'restaurant.order', 'restaurant.ticket.view', 'restaurant.view', 'restaurant.manage', 'staff.view', 'staff.manage', 'devices.view', 'devices.manage', 'config.view', 'config.manage', 'catalog.manage', 'inventory.receive', 'inventory.count', 'inventory.count.approve', 'inventory.shortfall.view', 'inventory.shortfall.configure', 'inventory.shortfall.resolve', 'commerce.sell', 'commerce.discount', 'commerce.refund', 'shift.open', 'shift.payout', 'shift.close', 'finance.view', 'finance.manage', 'finance.close', 'customers.view', 'customers.charge', 'customers.manage', 'customers.settle','hotel.manage','hotel.frontdesk','hotel.housekeeping'],
  owner: ['restaurant.order.view', 'restaurant.order', 'restaurant.ticket.view', 'restaurant.view', 'restaurant.manage', 'staff.view', 'staff.manage', 'devices.view', 'devices.manage', 'config.view', 'config.manage', 'catalog.manage', 'inventory.receive', 'inventory.count', 'inventory.count.approve', 'inventory.shortfall.view', 'inventory.shortfall.configure', 'inventory.shortfall.resolve', 'commerce.sell', 'commerce.discount', 'commerce.refund', 'shift.open', 'shift.payout', 'shift.close', 'finance.view', 'finance.manage', 'finance.close', 'customers.view', 'customers.charge', 'customers.manage', 'customers.settle','hotel.manage','hotel.frontdesk','hotel.housekeeping'],
  manager: ['restaurant.order.view', 'restaurant.order', 'restaurant.ticket.view', 'restaurant.view', 'restaurant.manage', 'staff.view', 'devices.view', 'config.view', 'catalog.manage', 'inventory.receive', 'inventory.count', 'inventory.count.approve', 'inventory.shortfall.view', 'inventory.shortfall.resolve', 'commerce.sell', 'commerce.discount', 'commerce.refund', 'shift.open', 'shift.payout', 'shift.close', 'finance.view', 'finance.manage', 'customers.view', 'customers.charge', 'customers.manage', 'customers.settle','hotel.manage','hotel.frontdesk','hotel.housekeeping'],
  accountant: ['inventory.shortfall.view', 'finance.view', 'finance.manage', 'finance.close', 'customers.view'],
  cashier: ['restaurant.view', 'commerce.sell', 'commerce.discount', 'shift.open', 'shift.close', 'customers.view', 'customers.charge', 'customers.settle'],
  storekeeper: ['inventory.receive', 'inventory.count'],
  receptionist: ['hotel.frontdesk','shift.open','shift.close'], housekeeper: ['hotel.housekeeping'], waiter: ['restaurant.view','restaurant.order.view','restaurant.order'], cook: ['restaurant.view','restaurant.ticket.view'], bartender: ['restaurant.view','restaurant.ticket.view'],
};

for (const role of ['admin','owner','manager','cook','bartender'] as ApiRole[]) ROLE_PERMISSIONS[role].push('restaurant.ticket.work');

export interface ApiSession {
  sessionId: string;
  userId: string;
  fullName: string;
  credentialVersion?: number;
  email: string;
  tenantId: string;
  tenantName: string;
  currency: string;
  outletId: string;
  outletName: string;
  tenantTimeZone?: string;
  taxPolicy?: { calculation: 'exclusive'; defaultRateBps: number; label: string; reviewed: boolean };
  timeZone: string;
  deviceId: string;
  role: ApiRole;
  capabilities:string[];
  onboardingStatus?: 'SETUP'|'LIVE'|'LEGACY_ACTIVE';
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
