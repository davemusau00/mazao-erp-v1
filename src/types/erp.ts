/**
 * Mazao ERP Domain Models & Canonical Contracts
 */

export type TenantType = 'retail' | 'hospitality' | 'farm_estate' | 'restaurant';

export interface TenantProfile {
  id: string;
  name: string;
  type: TenantType;
  currency: string;
  currencySymbol: string;
  /** IANA timezone used for rendering outlet business dates; omitted only in legacy demo data. */
  timeZone?: string;
  outletName?: string;
  capabilities?: string[];
  taxRate: number; // e.g. 0.16 for 16% VAT
  address: string;
  phone: string;
  tagline: string;
  receiptHeader: string;
  receiptFooter: string;
  tillNumber?: string;
  paybillNumber?: string;
  logoImage?: string;
  receiptQrImage?: string;
  showLogoOnReceipt?: boolean;
  showQrOnReceipt?: boolean;
  paperWidth?: '80mm' | '58mm';
}

export interface ProductItem {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  category: string;
  costPrice: number;
  sellingPrice: number;
  stockOnHand: number;
  reorderPoint: number;
  unit: string;
  description?: string;
  fastKey?: string;
}

export interface CartItem {
  product: ProductItem;
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  notes?: string;
}

export type PaymentMethod = 'cash' | 'card' | 'mobile_money' | 'room_folio' | 'customer_credit';

export interface CustomerAccount {
  id: string;
  tenantId: string;
  name: string;
  phone: string;
  email?: string;
  nationalIdOrTaxId?: string;
  creditLimit: number;
  currentBalance: number;
  status: 'active' | 'suspended';
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerTransaction {
  id: string;
  customerId: string;
  tenantId: string;
  timestamp: string;
  type: 'charge' | 'payment' | 'adjustment';
  amount: number;
  runningBalance: number;
  reference: string;
  paymentMethod?: PaymentMethod;
  notes?: string;
  cashierName: string;
}

export interface SaleOrder {
  id: string;
  idempotencyKey: string;
  orderNumber: string;
  shiftId: string;
  cashierName: string;
  tenantId: string;
  items: CartItem[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  paymentMethod: PaymentMethod;
  amountTendered: number;
  changeDue: number;
  timestamp: string;
  syncStatus: 'synced' | 'synced_server' | 'pending_outbox';
  roomChargeRef?: {
    roomId: string;
    roomNumber: string;
    guestName: string;
  };
  customerAccountRef?: {
    customerId: string;
    customerName: string;
    customerPhone?: string;
    previousBalance: number;
    newBalance: number;
    managerOverride?: {
      authorizedBy: string;
      reason: string;
      timestamp: string;
    };
  };
  status?: 'completed' | 'refunded';
  refundReason?: string;
  refundTimestamp?: string;
  printed?: boolean;
}

export type RoomStatus = 'vacant_clean' | 'vacant_dirty' | 'occupied' | 'reserved' | 'maintenance';
export type RoomTier = 'Standard' | 'Deluxe' | 'Executive Suite' | 'Safari Cottage';

export interface FolioCharge {
  id: string;
  timestamp: string;
  description: string;
  category: 'room' | 'dining' | 'laundry' | 'spa' | 'retail';
  amount: number;
  referenceOrderNumber?: string;
}

export interface Room {
  id: string;
  number: string;
  type: string;
  tier: RoomTier;
  floor: number;
  ratePerNight: number;
  maxGuests: number;
  status: RoomStatus;
  guestName?: string;
  guestPhone?: string;
  checkInDate?: string;
  checkOutDate?: string;
  folioCharges: FolioCharge[];
}

export interface Shift {
  id: string;
  tenantId: string;
  cashierName: string;
  startTime: string;
  endTime?: string;
  status: 'open' | 'closed';
  openingFloat: number;
  cashSales: number;
  cardSales: number;
  mobileSales: number;
  roomChargesTotal: number;
  customerCreditSales?: number;
  cashPayouts: number;
  expectedCash: number;
  actualCashCounted?: number;
  discrepancy?: number;
  notes?: string;
  zReportNumber?: string;
}

export interface StockMovement {
  id: string;
  timestamp: string;
  sku: string;
  productName: string;
  type: 'sale' | 'restock' | 'adjustment' | 'damage';
  quantity: number;
  balanceAfter: number;
  note: string;
  reference?: string;
}

export interface LedgerEntry {
  id: string;
  timestamp: string;
  reference: string;
  description: string;
  category: string;
  debitAccount: string;
  creditAccount: string;
  amount: number;
}

export interface OutboxItem {
  id: string;
  entityType: 'sale' | 'shift' | 'room_folio' | 'stock' | 'ledger';
  payload: any;
  createdAt: string;
  attempts: number;
  status: 'pending' | 'synced' | 'failed';
  error?: string;
}

export type UserRole = 'cashier' | 'waiter' | 'cook' | 'bartender' | 'storekeeper' | 'receptionist' | 'housekeeper' | 'accountant' | 'owner' | 'manager' | 'admin';

export type Permission =
  | 'pos.sell'
  | 'pos.discount_override'
  | 'pos.price_override'
  | 'pos.void_item'
  | 'shift.open'
  | 'shift.payout'
  | 'shift.close'
  | 'shift.view_audit'
  | 'rooms.checkin'
  | 'rooms.checkout'
  | 'rooms.manage_folios'
  | 'inventory.adjust'
  | 'products.manage'
  | 'customers.view'
  | 'customers.charge'
  | 'customers.settle'
  | 'customers.manage'
  | 'sales.history'
  | 'sales.refund'
  | 'ledger.view'
  | 'analytics.view'
  | 'settings.view'
  | 'settings.manage'
  | 'system.manage_conflicts'
  | 'kitchen.work'
  | 'hotel.housekeeping'
  | 'procurement.manage'
  | 'staff.manage'
  | 'devices.manage'
  | 'audit.view'
  | 'outlets.manage';

export interface StaffUser {
  id: string;
  name: string;
  role: UserRole;
  pin: string;
  title: string;
  badgeNumber: string;
}

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  cashier: [
    'pos.sell',
    'shift.open',
    'shift.close',
    'rooms.checkin',
    'customers.view',
    'customers.charge',
    'sales.history',
  ],
  manager: [
    'pos.sell',
    'pos.discount_override',
    'pos.price_override',
    'pos.void_item',
    'shift.open',
    'shift.payout',
    'shift.close',
    'shift.view_audit',
    'rooms.checkin',
    'rooms.checkout',
    'rooms.manage_folios',
    'hotel.housekeeping',
    'inventory.adjust',
    'products.manage',
    'procurement.manage',
    'customers.view',
    'customers.charge',
    'customers.settle',
    'customers.manage',
    'sales.history',
    'sales.refund',
    'analytics.view',
    'settings.view',
    'system.manage_conflicts',
  ],
  admin: [
    'pos.sell',
    'pos.discount_override',
    'pos.price_override',
    'pos.void_item',
    'shift.open',
    'shift.payout',
    'shift.close',
    'shift.view_audit',
    'rooms.checkin',
    'rooms.checkout',
    'rooms.manage_folios',
    'inventory.adjust',
    'products.manage',
    'customers.view',
    'customers.charge',
    'customers.settle',
    'customers.manage',
    'sales.history',
    'sales.refund',
    'ledger.view',
    'analytics.view',
    'settings.view',
    'settings.manage',
    'system.manage_conflicts',
    'kitchen.work', 'hotel.housekeeping', 'procurement.manage', 'staff.manage',
    'devices.manage', 'audit.view', 'outlets.manage',
  ],
  waiter: ['pos.sell', 'rooms.checkin', 'customers.view'],
  cook: ['kitchen.work'],
  bartender: ['kitchen.work', 'pos.sell'],
  storekeeper: ['inventory.adjust', 'products.manage', 'procurement.manage'],
  receptionist: ['rooms.checkin', 'rooms.checkout', 'rooms.manage_folios', 'customers.view', 'sales.history'],
  housekeeper: ['hotel.housekeeping'],
  accountant: ['shift.view_audit', 'customers.view', 'customers.settle', 'sales.history', 'ledger.view', 'analytics.view', 'audit.view'],
  owner: [
    'pos.sell', 'pos.discount_override', 'pos.price_override', 'pos.void_item', 'shift.open', 'shift.payout', 'shift.close', 'shift.view_audit',
    'rooms.checkin', 'rooms.checkout', 'rooms.manage_folios', 'inventory.adjust', 'products.manage', 'procurement.manage',
    'customers.view', 'customers.charge', 'customers.settle', 'customers.manage', 'sales.history', 'sales.refund', 'ledger.view',
    'analytics.view', 'settings.view', 'settings.manage', 'system.manage_conflicts', 'kitchen.work', 'hotel.housekeeping',
    'staff.manage', 'devices.manage', 'audit.view', 'outlets.manage',
  ],
};

export type ShiftAuditAction =
  | 'opening_float'
  | 'cash_payout'
  | 'void_line_item'
  | 'price_override'
  | 'manual_discount'
  | 'emergency_drawer_kick'
  | 'shift_close_variance';

export interface ShiftAuditLog {
  id: string;
  shiftId: string;
  timestamp: string;
  staffName: string;
  staffRole: UserRole;
  action: ShiftAuditAction;
  details: string;
  amount?: number;
  authorizedBy?: string;
  flagSeverity: 'info' | 'warning' | 'alert';
}

export type ConflictResolutionStrategy =
  | 'commutative_delta'
  | 'first_write_wins'
  | 'escalation_required';

export interface SyncConflict {
  id: string;
  entityType: 'stock_delta' | 'room_booking' | 'price_override';
  entityId: string;
  title: string;
  clientDevice: string;
  serverState: any;
  clientState: any;
  conflictStrategy: ConflictResolutionStrategy;
  status: 'auto_resolved' | 'escalation_pending' | 'manually_resolved';
  timestamp: string;
  resolutionDetails: string;
}

