/**
 * Mazao ERP Authoritative Storage & Offline Synchronization Engine
 * Local-First architecture using IndexedDB / LocalStorage with Outbox Queue,
 * Granular Audit Logging, Role-Based Access Control, and Conflict Resolution.
 */

import {
  TenantProfile,
  ProductItem,
  Room,
  SaleOrder,
  Shift,
  StockMovement,
  LedgerEntry,
  OutboxItem,
  FolioCharge,
  StaffUser,
  UserRole,
  Permission,
  ROLE_PERMISSIONS,
  ShiftAuditLog,
  SyncConflict,
  CustomerAccount,
  CustomerTransaction,
  PaymentMethod
} from '../types/erp';

// Seed tenants
export const INITIAL_TENANTS: TenantProfile[] = [
  {
    id: 'tenant-retail',
    name: 'Apex Supermarket & Hardware',
    type: 'retail',
    currency: 'KES',
    currencySymbol: 'KSh',
    taxRate: 0.16,
    address: 'Kenyatta Ave, Suite 104, Nairobi',
    phone: '+254 700 123 456',
    tagline: 'High-Velocity Fast Retail & Building Supplies',
    receiptHeader: 'APEX SUPERMARKET & WHOLESALE',
    receiptFooter: 'Thank you for shopping at Apex! Goods once sold cannot be returned without receipt.',
    tillNumber: '884129',
    paybillNumber: '522522',
    paperWidth: '80mm',
    showLogoOnReceipt: true,
    showQrOnReceipt: true,
    logoImage: '',
    receiptQrImage: '',
  },
  {
    id: 'tenant-lodge',
    name: 'Savanna Ridge Safari Lodge',
    type: 'hospitality',
    currency: 'USD',
    currencySymbol: '$',
    taxRate: 0.12,
    address: 'Mara Triangle Ridge Road, Maasai Mara',
    phone: '+254 711 987 654',
    tagline: 'Luxury Bush Retreat & Eco-Conservancy',
    receiptHeader: 'SAVANNA RIDGE SAFARI LODGE',
    receiptFooter: 'Thank you for staying with us. Conservation levy included in all rates.',
    tillNumber: '719200',
    paybillNumber: '400200',
    paperWidth: '80mm',
    showLogoOnReceipt: true,
    showQrOnReceipt: true,
    logoImage: '',
    receiptQrImage: '',
  },
  {
    id: 'tenant-farm',
    name: 'Green Valley Agro-Estate',
    type: 'farm_estate',
    currency: 'KES',
    currencySymbol: 'KSh',
    taxRate: 0.0, // Agricultural produce exempt
    address: 'Highland Farm Block 4, Nyeri Outskirts',
    phone: '+254 722 555 789',
    tagline: 'Farm-Fresh Dairy, Avocados & Specialty Nursery',
    receiptHeader: 'GREEN VALLEY AGRO-ESTATE',
    receiptFooter: 'Harvested daily. Traceable from soil to dining table.',
    tillNumber: '633812',
    paybillNumber: '247247',
    paperWidth: '80mm',
    showLogoOnReceipt: true,
    showQrOnReceipt: true,
    logoImage: '',
    receiptQrImage: '',
  },
  {
    id: 'tenant-bistro',
    name: 'The Brass Foundry Bistro',
    type: 'restaurant',
    currency: 'KES',
    currencySymbol: 'KSh',
    taxRate: 0.16,
    address: '4th Floor, Craft Quarter, Westlands',
    phone: '+254 733 444 112',
    tagline: 'Artisan Wood-Fired Kitchen & Craft Bar',
    receiptHeader: 'THE BRASS FOUNDRY BISTRO',
    receiptFooter: 'Service charge not included. Tips go directly to floor & kitchen team.',
    tillNumber: '920140',
    paybillNumber: '888880',
    paperWidth: '80mm',
    showLogoOnReceipt: true,
    showQrOnReceipt: true,
    logoImage: '',
    receiptQrImage: '',
  },
];

// Seed Customer Accounts
export const INITIAL_CUSTOMERS: CustomerAccount[] = [
  {
    id: 'cust-1',
    tenantId: 'tenant-retail',
    name: 'Carol Wanjiku',
    phone: '+254 712 345 678',
    email: 'carol.w@techsolutions.ke',
    nationalIdOrTaxId: '28491024',
    creditLimit: 10000,
    currentBalance: 3300,
    status: 'active',
    notes: 'Tech Solutions Ltd office pantry regular account',
    createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'cust-2',
    tenantId: 'tenant-retail',
    name: 'Peter Kamau',
    phone: '+254 723 456 789',
    email: 'kamau.builders@gmail.com',
    nationalIdOrTaxId: '19482011',
    creditLimit: 15000,
    currentBalance: 7200,
    status: 'active',
    notes: 'Contractor wholesale account - 30 day credit agreement',
    createdAt: new Date(Date.now() - 45 * 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'cust-3',
    tenantId: 'tenant-retail',
    name: 'Mama Mboga Supplies',
    phone: '+254 734 567 890',
    email: 'mboga.market@outlook.com',
    nationalIdOrTaxId: 'A004928172K',
    creditLimit: 8000,
    currentBalance: 1800,
    status: 'active',
    notes: 'Weekly market stall bulk procurement',
    createdAt: new Date(Date.now() - 20 * 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'cust-4',
    tenantId: 'tenant-retail',
    name: 'Dr. Amina Mohamed',
    phone: '+254 745 678 901',
    email: 'amina.m@nairobihospital.org',
    nationalIdOrTaxId: '21948201',
    creditLimit: 25000,
    currentBalance: 0,
    status: 'active',
    notes: 'VIP customer account - zero outstanding balance',
    createdAt: new Date(Date.now() - 15 * 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'cust-5',
    tenantId: 'tenant-retail',
    name: 'John Otieno',
    phone: '+254 756 789 012',
    email: 'jotieno@ke.org',
    nationalIdOrTaxId: '30491822',
    creditLimit: 5000,
    currentBalance: 5000,
    status: 'suspended',
    notes: 'Credit limit reached. 30+ days overdue account hold.',
    createdAt: new Date(Date.now() - 60 * 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

// Seed Customer Transactions
export const INITIAL_CUSTOMER_TX: CustomerTransaction[] = [
  {
    id: 'ctx-1',
    customerId: 'cust-1',
    tenantId: 'tenant-retail',
    timestamp: new Date(Date.now() - 5 * 86400000).toISOString(),
    type: 'charge',
    amount: 1850,
    runningBalance: 1850,
    reference: 'ORD-84102',
    notes: 'POS Sale - Beverages & Bakery',
    cashierName: 'Jane Mwangi',
  },
  {
    id: 'ctx-2',
    customerId: 'cust-1',
    tenantId: 'tenant-retail',
    timestamp: new Date(Date.now() - 2 * 86400000).toISOString(),
    type: 'charge',
    amount: 1450,
    runningBalance: 3300,
    reference: 'ORD-84221',
    notes: 'POS Sale - Pantry Supplies',
    cashierName: 'Jane Mwangi',
  },
  {
    id: 'ctx-3',
    customerId: 'cust-2',
    tenantId: 'tenant-retail',
    timestamp: new Date(Date.now() - 10 * 86400000).toISOString(),
    type: 'charge',
    amount: 12200,
    runningBalance: 12200,
    reference: 'ORD-83950',
    notes: 'Bulk Hardware - Cement & Wire Nails',
    cashierName: 'Jane Mwangi',
  },
  {
    id: 'ctx-4',
    customerId: 'cust-2',
    tenantId: 'tenant-retail',
    timestamp: new Date(Date.now() - 3 * 86400000).toISOString(),
    type: 'payment',
    amount: 5000,
    runningBalance: 7200,
    reference: 'PAY-MPESA-QRT89',
    paymentMethod: 'mobile_money',
    notes: 'Partial payment received via M-Pesa Till',
    cashierName: 'David Kibet',
  },
];

// Seed staff users with distinct RBAC roles
export const INITIAL_STAFF: StaffUser[] = [
  {
    id: 'staff-1',
    name: 'Jane Mwangi',
    role: 'cashier',
    pin: '1111',
    title: 'Lead POS Cashier',
    badgeNumber: 'CSH-042',
  },
  {
    id: 'staff-2',
    name: 'David Kibet',
    role: 'manager',
    pin: '2222',
    title: 'Shift Operations Manager',
    badgeNumber: 'MGR-018',
  },
  {
    id: 'staff-3',
    name: 'Sarah Chen',
    role: 'admin',
    pin: '9999',
    title: 'General Store Administrator',
    badgeNumber: 'ADM-001',
  },
];

// Seed products per tenant
export const INITIAL_PRODUCTS: Record<string, ProductItem[]> = {
  'tenant-retail': [
    { id: 'ret-1', sku: 'RET-MILK-1L', barcode: '61611001', name: 'Fresh Whole Milk 1L', category: 'Dairy', costPrice: 65, sellingPrice: 85, stockOnHand: 142, reorderPoint: 30, unit: 'pck', fastKey: '1' },
    { id: 'ret-2', sku: 'RET-BREAD-800G', barcode: '61611002', name: 'Artisan Sliced Bread 800g', category: 'Bakery', costPrice: 70, sellingPrice: 95, stockOnHand: 84, reorderPoint: 20, unit: 'loaf', fastKey: '2' },
    { id: 'ret-3', sku: 'RET-COFFEE-250G', barcode: '61611003', name: 'Estate Ground Coffee 250g', category: 'Beverages', costPrice: 380, sellingPrice: 550, stockOnHand: 36, reorderPoint: 15, unit: 'tin', fastKey: '3' },
    { id: 'ret-4', sku: 'RET-RICE-5KG', barcode: '61611004', name: 'Aromatic Pishori Rice 5kg', category: 'Pantry', costPrice: 850, sellingPrice: 1150, stockOnHand: 28, reorderPoint: 10, unit: 'bag' },
    { id: 'ret-5', sku: 'RET-SUGAR-2KG', barcode: '61611005', name: 'Pure White Sugar 2kg', category: 'Pantry', costPrice: 280, sellingPrice: 360, stockOnHand: 45, reorderPoint: 15, unit: 'bag' },
    { id: 'ret-6', sku: 'RET-SOAP-BAR', barcode: '61611006', name: 'Antibacterial Bar Soap', category: 'Toiletries', costPrice: 55, sellingPrice: 80, stockOnHand: 190, reorderPoint: 40, unit: 'pcs' },
    { id: 'ret-7', sku: 'RET-NAILS-2IN', barcode: '61611007', name: 'Steel Wire Nails 2-Inch (1kg)', category: 'Hardware', costPrice: 160, sellingPrice: 240, stockOnHand: 52, reorderPoint: 15, unit: 'kg' },
    { id: 'ret-8', sku: 'RET-CEMENT-50KG', barcode: '61611008', name: 'Portland Cement 50kg', category: 'Hardware', costPrice: 680, sellingPrice: 820, stockOnHand: 18, reorderPoint: 25, unit: 'bag' },
  ],
  'tenant-lodge': [
    { id: 'lod-1', sku: 'LOD-COCKTAIL-SUN', barcode: '72722001', name: 'Sundowner Gin Fizz', category: 'Bar', costPrice: 4, sellingPrice: 14, stockOnHand: 120, reorderPoint: 25, unit: 'gls', fastKey: '1' },
    { id: 'lod-2', sku: 'LOD-WINE-CAB', barcode: '72722002', name: 'Reserve Cabernet Sauvignon', category: 'Bar', costPrice: 18, sellingPrice: 48, stockOnHand: 44, reorderPoint: 12, unit: 'btl', fastKey: '2' },
    { id: 'lod-3', sku: 'LOD-GAME-DRIVE', barcode: '72722003', name: 'Private Dawn Safari Drive', category: 'Activities', costPrice: 35, sellingPrice: 110, stockOnHand: 999, reorderPoint: 0, unit: 'pax', fastKey: '3' },
    { id: 'lod-4', sku: 'LOD-SPA-MASSAGE', barcode: '72722004', name: '60-Min Savanna Herbal Spa', category: 'Wellness', costPrice: 20, sellingPrice: 75, stockOnHand: 999, reorderPoint: 0, unit: 'session' },
    { id: 'lod-5', sku: 'LOD-LAUNDRY-SET', barcode: '72722005', name: 'Guest Express Bush Laundry', category: 'Services', costPrice: 3, sellingPrice: 18, stockOnHand: 999, reorderPoint: 0, unit: 'load' },
    { id: 'lod-6', sku: 'LOD-BUFFET-DINNER', barcode: '72722006', name: 'Boma Barbecue Dinner Buffet', category: 'Dining', costPrice: 12, sellingPrice: 38, stockOnHand: 80, reorderPoint: 10, unit: 'cover' },
  ],
  'tenant-farm': [
    { id: 'frm-1', sku: 'FRM-MILK-BULK', barcode: '83833001', name: 'Raw Chilled Dairy Milk (5L)', category: 'Dairy', costPrice: 200, sellingPrice: 350, stockOnHand: 48, reorderPoint: 10, unit: 'jug', fastKey: '1' },
    { id: 'frm-2', sku: 'FRM-AVO-HASS', barcode: '83833002', name: 'Export Grade Hass Avocados (1kg)', category: 'Horticulture', costPrice: 90, sellingPrice: 160, stockOnHand: 220, reorderPoint: 40, unit: 'kg', fastKey: '2' },
    { id: 'frm-3', sku: 'FRM-EGGS-TRAY', barcode: '83833003', name: 'Free-Range Brown Eggs (30-Tray)', category: 'Poultry', costPrice: 360, sellingPrice: 480, stockOnHand: 65, reorderPoint: 15, unit: 'tray', fastKey: '3' },
    { id: 'frm-4', sku: 'FRM-HONEY-500G', barcode: '83833004', name: 'Raw Acacia Forest Honey 500g', category: 'Apiary', costPrice: 420, sellingPrice: 650, stockOnHand: 32, reorderPoint: 10, unit: 'jar' },
    { id: 'frm-5', sku: 'FRM-SEEDLING-MAC', barcode: '83833005', name: 'Grafted Macadamia Seedling', category: 'Nursery', costPrice: 180, sellingPrice: 350, stockOnHand: 110, reorderPoint: 25, unit: 'tree' },
    { id: 'frm-6', sku: 'FRM-ORGANIC-COMPOST', barcode: '83833006', name: 'Aged Farm Compost 50kg', category: 'Fertilizer', costPrice: 250, sellingPrice: 450, stockOnHand: 40, reorderPoint: 12, unit: 'bag' },
  ],
  'tenant-bistro': [
    { id: 'bst-1', sku: 'BST-STEAK-RIBEYE', barcode: '94944001', name: 'Prime Aged Ribeye Steak 350g', category: 'Mains', costPrice: 850, sellingPrice: 1850, stockOnHand: 24, reorderPoint: 8, unit: 'plate', fastKey: '1' },
    { id: 'bst-2', sku: 'BST-CRAFT-IPA', barcode: '94944002', name: 'Foundry Draught IPA 500ml', category: 'Drinks', costPrice: 160, sellingPrice: 450, stockOnHand: 86, reorderPoint: 20, unit: 'pint', fastKey: '2' },
    { id: 'bst-3', sku: 'BST-BURGER-WAGYU', barcode: '94944003', name: 'Truffle Wagyu Melt Burger', category: 'Mains', costPrice: 520, sellingPrice: 1250, stockOnHand: 32, reorderPoint: 10, unit: 'plate', fastKey: '3' },
    { id: 'bst-4', sku: 'BST-ESPRESSO-DBL', barcode: '94944004', name: 'Double Shot Single Origin', category: 'Coffee', costPrice: 45, sellingPrice: 220, stockOnHand: 300, reorderPoint: 50, unit: 'cup' },
    { id: 'bst-5', sku: 'BST-TIRAMISU', barcode: '94944005', name: 'House Mascarpone Tiramisu', category: 'Dessert', costPrice: 180, sellingPrice: 580, stockOnHand: 14, reorderPoint: 6, unit: 'pcs' },
  ],
};

// Seed rooms
export const INITIAL_ROOMS: Room[] = [
  {
    id: 'rm-101',
    number: '101',
    type: 'Savanna Tent',
    tier: 'Deluxe',
    floor: 1,
    ratePerNight: 280,
    maxGuests: 2,
    status: 'occupied',
    guestName: 'Elena Rostova',
    guestPhone: '+44 7700 900123',
    checkInDate: '2026-10-12',
    checkOutDate: '2026-10-16',
    folioCharges: [
      { id: 'chg-1', timestamp: '2026-10-12T14:00:00Z', description: 'Room Stay (Night 1 of 4)', category: 'room', amount: 280 },
      { id: 'chg-2', timestamp: '2026-10-12T19:30:00Z', description: 'Sundowner Gin Fizz x 2', category: 'dining', amount: 28, referenceOrderNumber: 'ORD-8812' },
      { id: 'chg-3', timestamp: '2026-10-13T06:30:00Z', description: 'Private Dawn Safari Drive', category: 'spa', amount: 110 },
    ],
  },
  {
    id: 'rm-102',
    number: '102',
    type: 'Bush Cottage',
    tier: 'Executive Suite',
    floor: 1,
    ratePerNight: 420,
    maxGuests: 3,
    status: 'occupied',
    guestName: 'Marcus & Sarah Vance',
    guestPhone: '+1 415 555 2671',
    checkInDate: '2026-10-11',
    checkOutDate: '2026-10-15',
    folioCharges: [
      { id: 'chg-4', timestamp: '2026-10-11T15:00:00Z', description: 'Room Stay (Night 1 of 4)', category: 'room', amount: 420 },
      { id: 'chg-5', timestamp: '2026-10-12T15:00:00Z', description: 'Room Stay (Night 2 of 4)', category: 'room', amount: 420 },
      { id: 'chg-6', timestamp: '2026-10-12T20:15:00Z', description: 'Reserve Cabernet Sauvignon + Boma Dinner', category: 'dining', amount: 86 },
    ],
  },
  {
    id: 'rm-103',
    number: '103',
    type: 'Savanna Tent',
    tier: 'Deluxe',
    floor: 1,
    ratePerNight: 280,
    maxGuests: 2,
    status: 'vacant_dirty',
    folioCharges: [],
  },
  {
    id: 'rm-104',
    number: '104',
    type: 'Acacia Chalet',
    tier: 'Standard',
    floor: 1,
    ratePerNight: 190,
    maxGuests: 2,
    status: 'vacant_clean',
    folioCharges: [],
  },
  {
    id: 'rm-201',
    number: '201',
    type: 'Valley Lookout',
    tier: 'Executive Suite',
    floor: 2,
    ratePerNight: 460,
    maxGuests: 4,
    status: 'vacant_clean',
    folioCharges: [],
  },
  {
    id: 'rm-202',
    number: '202',
    type: 'Acacia Chalet',
    tier: 'Standard',
    floor: 2,
    ratePerNight: 190,
    maxGuests: 2,
    status: 'reserved',
    guestName: 'Dr. Kwame Osei',
    checkInDate: '2026-10-14',
    checkOutDate: '2026-10-17',
    folioCharges: [],
  },
];

// Seed Granular Shift Audit Log entries
export const INITIAL_AUDIT_LOGS: ShiftAuditLog[] = [
  {
    id: 'aud-1',
    shiftId: 'shift-active',
    timestamp: new Date(Date.now() - 3600 * 2800).toISOString(),
    staffName: 'Jane Mwangi',
    staffRole: 'cashier',
    action: 'opening_float',
    details: 'Initial till opening float counted and locked into cash drawer',
    amount: 1500,
    authorizedBy: 'David Kibet (Manager)',
    flagSeverity: 'info',
  },
  {
    id: 'aud-2',
    shiftId: 'shift-active',
    timestamp: new Date(Date.now() - 3600 * 1800).toISOString(),
    staffName: 'Jane Mwangi',
    staffRole: 'cashier',
    action: 'void_line_item',
    details: 'Voided duplicate Portland Cement 50kg bag prior to settlement',
    amount: 820,
      authorizedBy: 'David Kibet (local demo approval)',
    flagSeverity: 'warning',
  },
  {
    id: 'aud-3',
    shiftId: 'shift-active',
    timestamp: new Date(Date.now() - 3600 * 1100).toISOString(),
    staffName: 'David Kibet',
    staffRole: 'manager',
    action: 'price_override',
    details: 'Mid-shift promotional discount override on Estate Coffee 250g',
    amount: 55,
    authorizedBy: 'Self-Authorized (MGR-018)',
    flagSeverity: 'warning',
  },
  {
    id: 'aud-4',
    shiftId: 'shift-active',
    timestamp: new Date(Date.now() - 3600 * 450).toISOString(),
    staffName: 'Jane Mwangi',
    staffRole: 'cashier',
    action: 'cash_payout',
    details: 'Till payout disbursed for express courier parcel delivery',
    amount: 250,
    authorizedBy: 'David Kibet (Manager)',
    flagSeverity: 'info',
  },
  {
    id: 'aud-5',
    shiftId: 'shift-active',
    timestamp: new Date(Date.now() - 3600 * 200).toISOString(),
    staffName: 'Sarah Chen',
    staffRole: 'admin',
    action: 'emergency_drawer_kick',
    details: 'Hardware supervisor manual drawer latch release for audit count inspection',
    authorizedBy: 'Sarah Chen (Admin Badge ADM-001)',
    flagSeverity: 'alert',
  },
];

// Seed Offline Sync Conflicts
export const INITIAL_CONFLICTS: SyncConflict[] = [
  {
    id: 'conf-1',
    entityType: 'stock_delta',
    entityId: 'ret-1',
    title: 'Concurrent Offline Stock Decrement (Milk 1L)',
    clientDevice: 'Mobile Tablet POS Terminal 02',
    serverState: { stockOnHand: 140, lastEvent: 'Restock +10 at 09:12' },
    clientState: { stockOnHand: 138, delta: -2, lastEvent: 'Offline Sale #ORD-4491 at 09:15' },
    conflictStrategy: 'commutative_delta',
    status: 'auto_resolved',
    timestamp: new Date(Date.now() - 1800 * 1000).toISOString(),
    resolutionDetails: 'CRDT Commutative Delta applied: net -2 deducted from authoritative base 140. Authoritative balance: 138. Zero lost updates.',
  },
  {
    id: 'conf-2',
    entityType: 'room_booking',
    entityId: 'rm-101',
    title: 'Concurrent Reservation on Savanna Tent 101',
    clientDevice: 'Offline Safari Desk Terminal',
    serverState: { roomNumber: '101', guest: 'Elena Rostova', checkInTimestamp: '09:05:00Z' },
    clientState: { roomNumber: '101', guest: 'Dr. Kwame Osei', checkInTimestamp: '09:08:12Z' },
    conflictStrategy: 'first_write_wins',
    status: 'auto_resolved',
    timestamp: new Date(Date.now() - 1200 * 1000).toISOString(),
    resolutionDetails: 'First-Write-Wins upheld Elena Rostova on Rm 101. Offline guest Dr. Kwame Osei automatically upgraded to equivalent Chalet Rm 202 without collision.',
  },
  {
    id: 'conf-3',
    entityType: 'price_override',
    entityId: 'ret-8',
    title: 'Offline Emergency Price Override (Portland Cement)',
    clientDevice: 'Yard Barcode Gun #3',
    serverState: { sellingPrice: 820.0, updatedAt: '08:00:00Z' },
    clientState: { sellingPrice: 790.0, overrideReason: 'Bulk Contractor Discount during outage', cashier: 'Jane Mwangi' },
    conflictStrategy: 'escalation_required',
    status: 'escalation_pending',
    timestamp: new Date(Date.now() - 600 * 1000).toISOString(),
    resolutionDetails: 'Awaiting Shift Manager sign-off: accept client offline concession ($790) or maintain standard server catalog price ($820).',
  },
];

class StorageEngine {
  private tenantId: string = 'tenant-retail';
  private isSimulatedOnline: boolean = true;
  private tenants: TenantProfile[] = INITIAL_TENANTS;
  private products: Record<string, ProductItem[]> = {};
  private rooms: Room[] = [];
  private orders: SaleOrder[] = [];
  private activeShift: Shift | null = null;
  private shiftsHistory: Shift[] = [];
  private stockMovements: StockMovement[] = [];
  private ledgerEntries: LedgerEntry[] = [];
  private outboxQueue: OutboxItem[] = [];
  private staffUsers: StaffUser[] = INITIAL_STAFF;
  private activeStaffId: string = 'staff-1';
  private auditLogs: ShiftAuditLog[] = [];
  private conflicts: SyncConflict[] = [];
  private customers: CustomerAccount[] = INITIAL_CUSTOMERS;
  private customerTransactions: CustomerTransaction[] = INITIAL_CUSTOMER_TX;
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.init();
  }

  private init() {
    const savedTenant = localStorage.getItem('mazao_active_tenant');
    if (savedTenant) this.tenantId = savedTenant;

    const savedSimOnline = localStorage.getItem('mazao_sim_online');
    if (savedSimOnline !== null) this.isSimulatedOnline = savedSimOnline === 'true';

    const savedTenants = localStorage.getItem('mazao_tenants');
    this.tenants = savedTenants ? JSON.parse(savedTenants) : INITIAL_TENANTS;

    const savedCustomers = localStorage.getItem('mazao_customers');
    this.customers = savedCustomers ? JSON.parse(savedCustomers) : INITIAL_CUSTOMERS;

    const savedCustTx = localStorage.getItem('mazao_customer_tx');
    this.customerTransactions = savedCustTx ? JSON.parse(savedCustTx) : INITIAL_CUSTOMER_TX;

    const savedStaffUsers = localStorage.getItem('mazao_staff_users');
    this.staffUsers = savedStaffUsers ? JSON.parse(savedStaffUsers) : INITIAL_STAFF;

    const savedProducts = localStorage.getItem('mazao_products');
    this.products = savedProducts ? JSON.parse(savedProducts) : INITIAL_PRODUCTS;

    const savedRooms = localStorage.getItem('mazao_rooms');
    this.rooms = savedRooms ? JSON.parse(savedRooms) : INITIAL_ROOMS;

    const savedOrders = localStorage.getItem('mazao_orders');
    this.orders = savedOrders ? JSON.parse(savedOrders) : this.seedInitialOrders();

    const savedActiveShift = localStorage.getItem('mazao_active_shift');
    if (savedActiveShift) {
      this.activeShift = JSON.parse(savedActiveShift);
    } else {
      this.activeShift = {
        id: 'shift-' + Date.now(),
        tenantId: this.tenantId,
        cashierName: 'Jane Mwangi',
        startTime: new Date(Date.now() - 3600 * 3000).toISOString(),
        status: 'open',
        openingFloat: 1500,
        cashSales: 0,
        cardSales: 0,
        mobileSales: 0,
        roomChargesTotal: 0,
        cashPayouts: 0,
        expectedCash: 1500,
      };
    }

    const savedShifts = localStorage.getItem('mazao_shifts_history');
    this.shiftsHistory = savedShifts ? JSON.parse(savedShifts) : [];

    const savedMovements = localStorage.getItem('mazao_stock_movements');
    this.stockMovements = savedMovements ? JSON.parse(savedMovements) : [];

    const savedLedger = localStorage.getItem('mazao_ledger');
    this.ledgerEntries = savedLedger ? JSON.parse(savedLedger) : this.seedInitialLedger();

    const savedOutbox = localStorage.getItem('mazao_outbox');
    this.outboxQueue = savedOutbox ? JSON.parse(savedOutbox) : [];

    const savedStaffId = localStorage.getItem('mazao_active_staff_id');
    if (savedStaffId) this.activeStaffId = savedStaffId;

    const savedAudit = localStorage.getItem('mazao_shift_audit');
    this.auditLogs = savedAudit ? JSON.parse(savedAudit) : INITIAL_AUDIT_LOGS;

    const savedConflicts = localStorage.getItem('mazao_sync_conflicts');
    this.conflicts = savedConflicts ? JSON.parse(savedConflicts) : INITIAL_CONFLICTS;
  }

  private persist() {
    try {
      localStorage.setItem('mazao_active_tenant', this.tenantId);
      localStorage.setItem('mazao_sim_online', String(this.isSimulatedOnline));
      localStorage.setItem('mazao_tenants', JSON.stringify(this.tenants));
      localStorage.setItem('mazao_customers', JSON.stringify(this.customers));
      localStorage.setItem('mazao_customer_tx', JSON.stringify(this.customerTransactions));
      localStorage.setItem('mazao_staff_users', JSON.stringify(this.staffUsers));
      localStorage.setItem('mazao_products', JSON.stringify(this.products));
      localStorage.setItem('mazao_rooms', JSON.stringify(this.rooms));
      localStorage.setItem('mazao_orders', JSON.stringify(this.orders));
      if (this.activeShift) {
        localStorage.setItem('mazao_active_shift', JSON.stringify(this.activeShift));
      } else {
        localStorage.removeItem('mazao_active_shift');
      }
      localStorage.setItem('mazao_shifts_history', JSON.stringify(this.shiftsHistory));
      localStorage.setItem('mazao_stock_movements', JSON.stringify(this.stockMovements));
      localStorage.setItem('mazao_ledger', JSON.stringify(this.ledgerEntries));
      localStorage.setItem('mazao_outbox', JSON.stringify(this.outboxQueue));
      localStorage.setItem('mazao_active_staff_id', this.activeStaffId);
      localStorage.setItem('mazao_shift_audit', JSON.stringify(this.auditLogs));
      localStorage.setItem('mazao_sync_conflicts', JSON.stringify(this.conflicts));
    } catch {
      // storage quota fallback
    }
    this.notify();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  // --- Staff & Granular RBAC Permissions ---
  public getStaffUsers(): StaffUser[] {
    return this.staffUsers;
  }

  public getActiveStaff(): StaffUser {
    return this.staffUsers.find(s => s.id === this.activeStaffId) || this.staffUsers[0];
  }

  public switchStaff(staffId: string): void {
    this.activeStaffId = staffId;
    const staff = this.getActiveStaff();
    if (this.activeShift && this.activeShift.status === 'open') {
      this.activeShift.cashierName = staff.name;
    }
    this.persist();
  }

  public hasPermission(perm: Permission): boolean {
    const staff = this.getActiveStaff();
    const perms = ROLE_PERMISSIONS[staff.role] || [];
    return perms.includes(perm);
  }

  public createStaffUser(staff: Omit<StaffUser, 'id'>): StaffUser {
    const newStaff: StaffUser = {
      ...staff,
      id: 'staff-' + Date.now(),
    };
    this.staffUsers.push(newStaff);
    this.persist();
    return newStaff;
  }

  public updateStaffUser(staff: StaffUser): StaffUser {
    const idx = this.staffUsers.findIndex(s => s.id === staff.id);
    if (idx !== -1) {
      this.staffUsers[idx] = { ...staff };
      this.persist();
    }
    return staff;
  }

  public deactivateStaffUser(staffId: string): void {
    if (this.staffUsers.length <= 1) return; // prevent zero staff
    this.staffUsers = this.staffUsers.filter(s => s.id !== staffId);
    if (this.activeStaffId === staffId) {
      this.activeStaffId = this.staffUsers[0].id;
    }
    this.persist();
  }

  // --- Granular Shift Audit Log Engine ---
  public getAuditLogs(shiftId?: string): ShiftAuditLog[] {
    if (shiftId) {
      return this.auditLogs.filter(a => a.shiftId === shiftId);
    }
    return this.auditLogs;
  }

  public recordAuditLog(entry: {
    shiftId?: string;
    action: ShiftAuditLog['action'];
    details: string;
    amount?: number;
    authorizedBy?: string;
    flagSeverity?: ShiftAuditLog['flagSeverity'];
  }): ShiftAuditLog {
    const staff = this.getActiveStaff();
    const newEntry: ShiftAuditLog = {
      id: 'aud-' + Date.now() + '-' + Math.random().toString(36).substring(2, 5),
      shiftId: entry.shiftId || (this.activeShift ? this.activeShift.id : 'shift-general'),
      timestamp: new Date().toISOString(),
      staffName: staff.name,
      staffRole: staff.role,
      action: entry.action,
      details: entry.details,
      amount: entry.amount,
      authorizedBy: entry.authorizedBy || `${staff.name} (${staff.title})`,
      flagSeverity: entry.flagSeverity || (entry.action === 'price_override' || entry.action === 'void_line_item' ? 'warning' : 'info'),
    };

    this.auditLogs.unshift(newEntry);
    this.persist();
    return newEntry;
  }

  // --- Advanced Offline Conflict Resolution Engine ---
  public getConflicts(): SyncConflict[] {
    return this.conflicts;
  }

  public resolveConflict(conflictId: string, choice: 'accept_client' | 'accept_server' | 'auto_reconcile'): void {
    const conflict = this.conflicts.find(c => c.id === conflictId);
    if (!conflict) return;

    if (conflict.entityType === 'price_override') {
      if (choice === 'accept_client') {
        const prod = (this.products[this.tenantId] || []).find(p => p.id === conflict.entityId);
        if (prod) {
          prod.sellingPrice = conflict.clientState.sellingPrice;
        }
        conflict.resolutionDetails = `Manager accepted client concession rate ($${conflict.clientState.sellingPrice}). Price updated.`;
      } else {
        conflict.resolutionDetails = `Manager rejected concession rate. Authoritative server price ($${conflict.serverState.sellingPrice}) maintained.`;
      }
    } else if (conflict.entityType === 'stock_delta') {
      conflict.resolutionDetails = 'CRDT Commutative Delta reaffirmed. Balance synchronized.';
    } else if (conflict.entityType === 'room_booking') {
      conflict.resolutionDetails = 'Booking conflict resolved. Room upgrade confirmed.';
    }

    conflict.status = 'manually_resolved';
    this.persist();
  }

  public simulateNewConflict(type: 'stock_delta' | 'room_booking' | 'price_override'): SyncConflict {
    const now = new Date().toISOString();
    let newConf: SyncConflict;

    if (type === 'stock_delta') {
      newConf = {
        id: 'conf-' + Date.now(),
        entityType: 'stock_delta',
        entityId: 'ret-2',
        title: 'Concurrent Offline Stock Decrement (Sliced Bread 800g)',
        clientDevice: 'Mobile Register #4',
        serverState: { stockOnHand: 84, lastEvent: 'Restock +20' },
        clientState: { stockOnHand: 80, delta: -4, lastEvent: 'Offline Sale #ORD-9912' },
        conflictStrategy: 'commutative_delta',
        status: 'auto_resolved',
        timestamp: now,
        resolutionDetails: 'CRDT Commutative Delta applied: net -4 merged with server 84. Authoritative balance: 80.',
      };
    } else if (type === 'room_booking') {
      newConf = {
        id: 'conf-' + Date.now(),
        entityType: 'room_booking',
        entityId: 'rm-102',
        title: 'Concurrent Offline Check-in Clash (Cottage 102)',
        clientDevice: 'Offline iPad Reception Frontdesk',
        serverState: { roomNumber: '102', guest: 'Marcus Vance', checkInTime: '10:00Z' },
        clientState: { roomNumber: '102', guest: 'Lady Beatrix Finch', checkInTime: '10:03Z' },
        conflictStrategy: 'first_write_wins',
        status: 'auto_resolved',
        timestamp: now,
        resolutionDetails: 'First-Write-Wins: Marcus Vance retained Rm 102. Lady Beatrix Finch routed to equivalent Valley Suite 201.',
      };
    } else {
      newConf = {
        id: 'conf-' + Date.now(),
        entityType: 'price_override',
        entityId: 'ret-3',
        title: 'Mid-Shift Offline Price Override (Ground Coffee 250g)',
        clientDevice: 'Curbside Drive-thru POS',
        serverState: { sellingPrice: 550, updatedAt: '07:30Z' },
        clientState: { sellingPrice: 500, overrideReason: 'Rainy Day Promotion', cashier: this.getActiveStaff().name },
        conflictStrategy: 'escalation_required',
        status: 'escalation_pending',
        timestamp: now,
        resolutionDetails: 'Pending Supervisor Sign-Off: approve curbside concession ($500) or keep base ($550).',
      };
    }

    this.conflicts.unshift(newConf);
    this.persist();
    return newConf;
  }

  // --- Tenants & Settings ---
  public getTenants(): TenantProfile[] {
    return this.tenants;
  }

  public getActiveTenant(): TenantProfile {
    return this.tenants.find(t => t.id === this.tenantId) || this.tenants[0];
  }

  public updateTenantProfile(updated: TenantProfile): TenantProfile {
    const idx = this.tenants.findIndex(t => t.id === updated.id);
    if (idx !== -1) {
      this.tenants[idx] = { ...updated };
    } else {
      this.tenants.push({ ...updated });
    }
    this.persist();
    return updated;
  }

  public switchTenant(newTenantId: string): void {
    this.tenantId = newTenantId;
    if (this.activeShift) {
      this.activeShift.tenantId = newTenantId;
    }
    this.persist();
  }

  // --- Customer Credit & Accounts Engine ---
  public getCustomers(tenantId?: string): CustomerAccount[] {
    const target = tenantId || this.tenantId;
    return this.customers.filter(c => c.tenantId === target);
  }

  public getAllCustomers(): CustomerAccount[] {
    return this.customers;
  }

  public getCustomerById(customerId: string): CustomerAccount | undefined {
    return this.customers.find(c => c.id === customerId);
  }

  public createCustomer(cust: Omit<CustomerAccount, 'id' | 'createdAt' | 'updatedAt'>): CustomerAccount {
    const now = new Date().toISOString();
    const newCust: CustomerAccount = {
      ...cust,
      id: 'cust-' + Date.now(),
      createdAt: now,
      updatedAt: now,
    };
    this.customers.unshift(newCust);
    this.persist();
    return newCust;
  }

  public updateCustomer(cust: CustomerAccount): CustomerAccount {
    const idx = this.customers.findIndex(c => c.id === cust.id);
    if (idx !== -1) {
      this.customers[idx] = { ...cust, updatedAt: new Date().toISOString() };
      this.persist();
    }
    return cust;
  }

  public deleteCustomer(customerId: string): boolean {
    const cust = this.getCustomerById(customerId);
    if (!cust) return false;
    this.customers = this.customers.filter(c => c.id !== customerId);
    this.persist();
    return true;
  }

  public getCustomerTransactions(customerId: string): CustomerTransaction[] {
    return this.customerTransactions
      .filter(tx => tx.customerId === customerId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  public chargeCustomerAccount(customerId: string, amount: number, orderRef: string, notes?: string): CustomerTransaction {
    const customer = this.getCustomerById(customerId);
    if (!customer) throw new Error('Customer account not found');

    const newBalance = customer.currentBalance + amount;
    customer.currentBalance = newBalance;
    customer.updatedAt = new Date().toISOString();

    const tx: CustomerTransaction = {
      id: 'ctx-' + Date.now(),
      customerId,
      tenantId: customer.tenantId,
      timestamp: new Date().toISOString(),
      type: 'charge',
      amount,
      runningBalance: newBalance,
      reference: orderRef,
      paymentMethod: 'customer_credit',
      notes: notes || `POS Sale #${orderRef}`,
      cashierName: this.getActiveStaff().name,
    };

    this.customerTransactions.unshift(tx);
    this.persist();
    return tx;
  }

  public settleCustomerAccount(
    customerId: string,
    amount: number,
    paymentMethod: PaymentMethod,
    reference: string,
    notes?: string
  ): CustomerTransaction {
    const customer = this.getCustomerById(customerId);
    if (!customer) throw new Error('Customer account not found');

    const newBalance = Math.max(0, customer.currentBalance - amount);
    customer.currentBalance = newBalance;
    customer.updatedAt = new Date().toISOString();

    const tx: CustomerTransaction = {
      id: 'ctx-' + Date.now(),
      customerId,
      tenantId: customer.tenantId,
      timestamp: new Date().toISOString(),
      type: 'payment',
      amount,
      runningBalance: newBalance,
      reference,
      paymentMethod,
      notes: notes || `Credit repayment received via ${paymentMethod.replace('_', ' ')}`,
      cashierName: this.getActiveStaff().name,
    };

    this.customerTransactions.unshift(tx);

    // If shift is open, update shift totals
    if (this.activeShift && this.activeShift.status === 'open') {
      if (paymentMethod === 'cash') {
        this.activeShift.cashSales += amount;
        this.activeShift.expectedCash += amount;
      } else if (paymentMethod === 'mobile_money') {
        this.activeShift.mobileSales += amount;
      } else if (paymentMethod === 'card') {
        this.activeShift.cardSales += amount;
      }
    }

    // Double-entry General Ledger record
    const debitAccount =
      paymentMethod === 'cash'
        ? 'Cash in Till (Drawer)'
        : paymentMethod === 'mobile_money'
        ? 'Mobile Money Till'
        : 'Operating Bank Account';

    this.recordLedgerEntry(
      reference,
      `Credit Settlement - ${customer.name} (Ref: ${reference})`,
      'Credit Repayment',
      debitAccount,
      'Accounts Receivable - Customer Credit',
      amount
    );

    this.recordAuditLog({
      action: 'cash_payout',
      details: `Credit repayment settled for ${customer.name}: ${amount} via ${paymentMethod}`,
      amount,
      flagSeverity: 'info',
    });

    this.persist();
    return tx;
  }

  // --- Network Offline Simulation ---
  public isOnline(): boolean {
    return this.isSimulatedOnline;
  }

  public toggleNetworkSimulation(): void {
    this.isSimulatedOnline = !this.isSimulatedOnline;
    if (this.isSimulatedOnline) {
      this.flushOutboxQueue();
    }
    this.persist();
  }

  public getOutboxCount(): number {
    return this.outboxQueue.filter(item => item.status === 'pending').length;
  }

  public getOutboxQueue(): OutboxItem[] {
    return this.outboxQueue;
  }

  public flushOutboxQueue(): void {
    if (!this.isSimulatedOnline) return;

    this.outboxQueue = this.outboxQueue.map(item => {
      if (item.status === 'pending') {
        return { ...item, status: 'synced', attempts: item.attempts + 1 };
      }
      return item;
    });

    this.orders = this.orders.map(o => ({
      ...o,
      syncStatus: 'synced',
    }));

    this.persist();
  }

  public clearSyncedOutbox(): void {
    this.outboxQueue = this.outboxQueue.filter(item => item.status === 'pending');
    this.persist();
  }

  // --- Products & Inventory ---
  public getProducts(): ProductItem[] {
    return this.products[this.tenantId] || [];
  }

  public adjustStock(productId: string, delta: number, type: StockMovement['type'], note: string): void {
    const list = this.products[this.tenantId] || [];
    const prod = list.find(p => p.id === productId);
    if (!prod) return;

    prod.stockOnHand = Math.max(0, prod.stockOnHand + delta);

    const movement: StockMovement = {
      id: 'mov-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      timestamp: new Date().toISOString(),
      sku: prod.sku,
      productName: prod.name,
      type,
      quantity: delta,
      balanceAfter: prod.stockOnHand,
      note,
    };

    this.stockMovements.unshift(movement);

    this.outboxQueue.unshift({
      id: 'outbox-stock-' + Date.now(),
      entityType: 'stock',
      payload: movement,
      createdAt: new Date().toISOString(),
      attempts: 0,
      status: this.isSimulatedOnline ? 'synced' : 'pending',
    });

    this.persist();
  }

  public getStockMovements(): StockMovement[] {
    return this.stockMovements;
  }

  // --- Rooms & Hospitality ---
  public getRooms(): Room[] {
    return this.rooms;
  }

  public getOccupiedRoomsWithGuests(): Room[] {
    return this.rooms.filter(r => r.status === 'occupied' && r.guestName);
  }

  public checkInGuest(roomId: string, guestName: string, phone: string, nights: number): void {
    const rm = this.rooms.find(r => r.id === roomId);
    if (!rm) return;

    const now = new Date();
    const checkOut = new Date(now.getTime() + nights * 86400000);

    rm.status = 'occupied';
    rm.guestName = guestName;
    rm.guestPhone = phone;
    rm.checkInDate = now.toISOString().slice(0, 10);
    rm.checkOutDate = checkOut.toISOString().slice(0, 10);

    const roomCharge: FolioCharge = {
      id: 'chg-' + Date.now(),
      timestamp: new Date().toISOString(),
      description: `${rm.type} Room Stay (${nights} nights @ $${rm.ratePerNight}/nt)`,
      category: 'room',
      amount: rm.ratePerNight * nights,
    };
    rm.folioCharges.push(roomCharge);

    this.recordLedgerEntry(
      'AR-' + rm.number,
      `Guest Check-in Rm ${rm.number} (${guestName})`,
      'Hospitality',
      'Accounts Receivable - Guest Ledger',
      'Room Revenue',
      roomCharge.amount
    );

    this.outboxQueue.unshift({
      id: 'outbox-checkin-' + Date.now(),
      entityType: 'room_folio',
      payload: { roomId, guestName, nights, charge: roomCharge },
      createdAt: new Date().toISOString(),
      attempts: 0,
      status: this.isSimulatedOnline ? 'synced' : 'pending',
    });

    this.persist();
  }

  public addFolioCharge(roomId: string, charge: Omit<FolioCharge, 'id' | 'timestamp'>): void {
    const rm = this.rooms.find(r => r.id === roomId);
    if (!rm) return;

    const fullCharge: FolioCharge = {
      ...charge,
      id: 'chg-' + Date.now(),
      timestamp: new Date().toISOString(),
    };

    rm.folioCharges.push(fullCharge);

    this.outboxQueue.unshift({
      id: 'outbox-folio-chg-' + Date.now(),
      entityType: 'room_folio',
      payload: { roomId, charge: fullCharge },
      createdAt: new Date().toISOString(),
      attempts: 0,
      status: this.isSimulatedOnline ? 'synced' : 'pending',
    });

    this.persist();
  }

  public settleRoomFolio(
    roomId: string,
    paymentMethod: PaymentMethod,
    amountTendered: number,
    notes?: string
  ): { room: Room; charges: FolioCharge[]; changeDue: number; totalPaid: number } {
    const rm = this.rooms.find(r => r.id === roomId);
    if (!rm) throw new Error('Room not found');

    const finalizedCharges = [...rm.folioCharges];
    const totalDue = finalizedCharges.reduce((acc, c) => acc + c.amount, 0);
    const changeDue = Math.max(0, amountTendered - totalDue);

    if (totalDue > 0) {
      const debitAccount =
        paymentMethod === 'cash'
          ? 'Cash in Till (Drawer)'
          : paymentMethod === 'mobile_money'
          ? 'Mobile Money Till'
          : paymentMethod === 'card'
          ? 'Card Clearing Merchant'
          : 'Accounts Receivable - Corporate Ledger';

      this.recordLedgerEntry(
        'FOLIO-SETTLE-' + rm.number,
        `Guest Folio Settlement Rm ${rm.number} (${rm.guestName || 'Guest'}) via ${paymentMethod.replace('_', ' ')}${notes ? ` · ${notes}` : ''}`,
        'Hospitality',
        debitAccount,
        'Accounts Receivable - Guest Ledger',
        totalDue
      );

      if (this.activeShift && this.activeShift.status === 'open') {
        if (paymentMethod === 'cash') {
          this.activeShift.cashSales += totalDue;
          this.activeShift.expectedCash += totalDue;
        } else if (paymentMethod === 'mobile_money') {
          this.activeShift.mobileSales += totalDue;
        } else if (paymentMethod === 'card') {
          this.activeShift.cardSales += totalDue;
        }
      }
    }

    rm.status = 'vacant_dirty';
    rm.guestName = undefined;
    rm.guestPhone = undefined;
    rm.checkInDate = undefined;
    rm.checkOutDate = undefined;
    rm.folioCharges = [];

    this.persist();
    return { room: rm, charges: finalizedCharges, changeDue, totalPaid: totalDue };
  }

  public checkOutGuest(roomId: string): FolioCharge[] {
    const result = this.settleRoomFolio(roomId, 'cash', 0);
    return result.charges;
  }

  public updateRoomHousekeeping(roomId: string, status: Room['status']): void {
    const rm = this.rooms.find(r => r.id === roomId);
    if (rm) {
      rm.status = status;
      this.persist();
    }
  }

  // --- Point of Sale & Orders ---
  public getOrders(): SaleOrder[] {
    return this.orders;
  }

  public getOrderById(orderId: string): SaleOrder | undefined {
    return this.orders.find(o => o.id === orderId || o.orderNumber === orderId);
  }

  public refundOrder(orderId: string, reason: string, refundMethod: PaymentMethod): SaleOrder {
    const order = this.orders.find(o => o.id === orderId);
    if (!order) throw new Error('Order not found');

    order.status = 'refunded';
    order.refundReason = reason;
    order.refundTimestamp = new Date().toISOString();

    // Restock items
    for (const item of order.items) {
      this.adjustStock(
        item.product.id,
        item.quantity,
        'adjustment',
        `Return/Refund on #${order.orderNumber}: ${reason}`
      );
    }

    // Ledger reversal
    const creditAccount =
      refundMethod === 'cash'
        ? 'Cash in Till (Drawer)'
        : refundMethod === 'mobile_money'
        ? 'Mobile Money Till'
        : 'Card Clearing Merchant';

    this.recordLedgerEntry(
      `REFUND-${order.orderNumber}`,
      `Sales Refund for #${order.orderNumber} (${reason})`,
      'Returns',
      'Sales Revenue Reversal',
      creditAccount,
      order.total
    );

    this.recordAuditLog({
      action: 'void_line_item',
      details: `Full order refund executed for #${order.orderNumber}: ${order.total} (${reason}) via ${refundMethod}`,
      amount: order.total,
      flagSeverity: 'warning',
    });

    this.persist();
    return order;
  }

  public processSale(orderInput: Omit<SaleOrder, 'id' | 'idempotencyKey' | 'timestamp' | 'syncStatus' | 'printed'>): SaleOrder {
    const now = new Date();
    const idempotencyKey = 'IDEM-' + Math.random().toString(36).substring(2, 10).toUpperCase() + '-' + Date.now();
    const order: SaleOrder = {
      ...orderInput,
      id: 'ord-' + Date.now(),
      idempotencyKey,
      timestamp: now.toISOString(),
      syncStatus: this.isSimulatedOnline ? 'synced' : 'pending_outbox',
      printed: false,
      status: 'completed',
    };

    for (const item of order.items) {
      this.adjustStock(
        item.product.id,
        -item.quantity,
        'sale',
        `Sale #${order.orderNumber}`
      );
    }

    if (order.paymentMethod === 'room_folio' && order.roomChargeRef) {
      this.addFolioCharge(order.roomChargeRef.roomId, {
        description: `POS Bill #${order.orderNumber} (${order.items.map(i => `${i.quantity}x ${i.product.name}`).slice(0, 2).join(', ')})`,
        category: 'dining',
        amount: order.total,
        referenceOrderNumber: order.orderNumber,
      });
    }

    if (order.paymentMethod === 'customer_credit' && order.customerAccountRef) {
      this.chargeCustomerAccount(
        order.customerAccountRef.customerId,
        order.total,
        order.orderNumber,
        `POS Sale #${order.orderNumber}`
      );
    }

    if (this.activeShift && this.activeShift.status === 'open') {
      if (order.paymentMethod === 'cash') {
        this.activeShift.cashSales += order.total;
        this.activeShift.expectedCash += order.total;
      } else if (order.paymentMethod === 'card') {
        this.activeShift.cardSales += order.total;
      } else if (order.paymentMethod === 'mobile_money') {
        this.activeShift.mobileSales += order.total;
      } else if (order.paymentMethod === 'room_folio') {
        this.activeShift.roomChargesTotal += order.total;
      } else if (order.paymentMethod === 'customer_credit') {
        this.activeShift.customerCreditSales = (this.activeShift.customerCreditSales || 0) + order.total;
      }
    }

    const debitAccount =
      order.paymentMethod === 'cash'
        ? 'Cash in Till (Drawer)'
        : order.paymentMethod === 'card'
        ? 'Card Clearing Merchant'
        : order.paymentMethod === 'mobile_money'
        ? 'Mobile Money Till'
        : order.paymentMethod === 'customer_credit'
        ? 'Accounts Receivable - Customer Credit'
        : 'Accounts Receivable - Guest Folios';

    this.recordLedgerEntry(
      order.orderNumber,
      `Sale Order #${order.orderNumber} (${order.cashierName})`,
      'Sales',
      debitAccount,
      'Sales Revenue',
      order.subtotal
    );

    if (order.tax > 0) {
      this.recordLedgerEntry(
        order.orderNumber,
        `VAT Output Tax on #${order.orderNumber}`,
        'Taxation',
        debitAccount,
        'VAT Payable',
        order.tax
      );
    }

    this.orders.unshift(order);

    this.outboxQueue.unshift({
      id: 'outbox-order-' + order.id,
      entityType: 'sale',
      payload: order,
      createdAt: now.toISOString(),
      attempts: 0,
      status: this.isSimulatedOnline ? 'synced' : 'pending',
    });

    this.persist();
    return order;
  }

  // --- Product Management & Guided Stock Intake ---
  public createProduct(product: Omit<ProductItem, 'id'>): ProductItem {
    const newProduct: ProductItem = {
      ...product,
      id: 'prod-' + Date.now(),
    };
    if (!this.products[this.tenantId]) {
      this.products[this.tenantId] = [];
    }
    this.products[this.tenantId].unshift(newProduct);
    this.persist();
    return newProduct;
  }

  public updateProduct(product: ProductItem): ProductItem {
    const tenantProducts = this.products[this.tenantId] || [];
    const idx = tenantProducts.findIndex(p => p.id === product.id);
    if (idx !== -1) {
      tenantProducts[idx] = { ...product };
      this.persist();
    }
    return product;
  }

  public getProductById(id: string): ProductItem | undefined {
    const tenantProducts = this.products[this.tenantId] || [];
    return tenantProducts.find(p => p.id === id);
  }

  public receiveStock(
    items: { productId: string; quantity: number; costPrice?: number }[],
    supplierRef: string,
    notes?: string
  ): void {
    let totalIntakeValue = 0;
    const now = new Date().toISOString();

    for (const item of items) {
      const prod = this.getProductById(item.productId);
      if (!prod) continue;

      if (item.costPrice !== undefined && item.costPrice > 0) {
        prod.costPrice = item.costPrice;
      }

      prod.stockOnHand += item.quantity;
      const itemCost = (item.costPrice || prod.costPrice) * item.quantity;
      totalIntakeValue += itemCost;

      const movement: StockMovement = {
        id: 'mov-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        timestamp: now,
        sku: prod.sku,
        productName: prod.name,
        type: 'restock',
        quantity: item.quantity,
        balanceAfter: prod.stockOnHand,
        note: `Stock Intake Ref: ${supplierRef}${notes ? ` · ${notes}` : ''}`,
        reference: supplierRef,
      };
      this.stockMovements.unshift(movement);
    }

    if (totalIntakeValue > 0) {
      this.recordLedgerEntry(
        supplierRef,
        `Inventory Intake: Ref ${supplierRef}`,
        'Procurement',
        'Merchandise Inventory Asset',
        'Accounts Payable - Trade Suppliers',
        totalIntakeValue
      );
    }

    this.persist();
  }

  // --- Shifts & Cash Drawer Balancing ---
  public getActiveShift(): Shift | null {
    return this.activeShift;
  }

  public getShiftsHistory(): Shift[] {
    return this.shiftsHistory;
  }

  public openNewShift(cashierName: string, openingFloat: number): Shift {
    const newShift: Shift = {
      id: 'shift-' + Date.now(),
      tenantId: this.tenantId,
      cashierName,
      startTime: new Date().toISOString(),
      status: 'open',
      openingFloat,
      cashSales: 0,
      cardSales: 0,
      mobileSales: 0,
      roomChargesTotal: 0,
      cashPayouts: 0,
      expectedCash: openingFloat,
    };

    this.activeShift = newShift;

    this.recordLedgerEntry(
      'FLOAT-' + newShift.id.slice(-6),
      `Opening Cash Float (${cashierName})`,
      'Treasury',
      'Cash in Till (Drawer)',
      'Vault Reserve Cash',
      openingFloat
    );

    this.recordAuditLog({
      shiftId: newShift.id,
      action: 'opening_float',
      details: `Shift till opened with opening float count of ${this.getActiveTenant().currencySymbol} ${openingFloat.toFixed(2)}`,
      amount: openingFloat,
      flagSeverity: 'info',
    });

    this.persist();
    return newShift;
  }

  public recordCashPayout(amount: number, reason: string): void {
    if (!this.activeShift || this.activeShift.status !== 'open') return;

    this.activeShift.cashPayouts += amount;
    this.activeShift.expectedCash -= amount;

    this.recordLedgerEntry(
      'DROP-' + Date.now().toString().slice(-6),
      `Till Cash Payout: ${reason}`,
      'Expenses',
      'Petty Cash Expense',
      'Cash in Till (Drawer)',
      amount
    );

    this.recordAuditLog({
      shiftId: this.activeShift.id,
      action: 'cash_payout',
      details: `Cash payout from drawer: ${reason}`,
      amount,
      flagSeverity: 'info',
    });

    this.persist();
  }

  public closeShift(actualCashCounted: number, notes?: string): Shift {
    if (!this.activeShift) throw new Error('No active shift to close');

    const discrepancy = actualCashCounted - this.activeShift.expectedCash;
    const closedShift: Shift = {
      ...this.activeShift,
      endTime: new Date().toISOString(),
      status: 'closed',
      actualCashCounted,
      discrepancy,
      notes,
      zReportNumber: 'Z-' + new Date().getFullYear() + '-' + Math.floor(1000 + Math.random() * 9000),
    };

    if (discrepancy !== 0) {
      if (discrepancy > 0) {
        this.recordLedgerEntry(
          closedShift.zReportNumber!,
          `Shift Cash Overage (${closedShift.cashierName})`,
          'Audit',
          'Cash in Till (Drawer)',
          'Cash Short/Over Account',
          discrepancy
        );
      } else {
        this.recordLedgerEntry(
          closedShift.zReportNumber!,
          `Shift Cash Shortage (${closedShift.cashierName})`,
          'Audit',
          'Cash Short/Over Account',
          'Cash in Till (Drawer)',
          Math.abs(discrepancy)
        );
      }
    }

    this.recordAuditLog({
      shiftId: closedShift.id,
      action: 'shift_close_variance',
      details: `Shift closed. Expected: ${this.getActiveTenant().currencySymbol} ${closedShift.expectedCash.toFixed(2)}, Counted: ${this.getActiveTenant().currencySymbol} ${actualCashCounted.toFixed(2)}. Variance: ${this.getActiveTenant().currencySymbol} ${discrepancy.toFixed(2)} (${discrepancy === 0 ? 'Balanced' : discrepancy > 0 ? 'Overage' : 'Shortage'}). Ref: ${closedShift.zReportNumber}`,
      amount: Math.abs(discrepancy),
      flagSeverity: discrepancy === 0 ? 'info' : 'alert',
    });

    this.shiftsHistory.unshift(closedShift);
    this.activeShift = null;

    this.outboxQueue.unshift({
      id: 'outbox-shift-' + closedShift.id,
      entityType: 'shift',
      payload: closedShift,
      createdAt: new Date().toISOString(),
      attempts: 0,
      status: this.isSimulatedOnline ? 'synced' : 'pending',
    });

    this.persist();
    return closedShift;
  }

  // --- Financial Ledgers ---
  public getLedgerEntries(): LedgerEntry[] {
    return this.ledgerEntries;
  }

  private recordLedgerEntry(
    reference: string,
    description: string,
    category: string,
    debitAccount: string,
    creditAccount: string,
    amount: number
  ): void {
    const entry: LedgerEntry = {
      id: 'ledg-' + Date.now() + '-' + Math.random().toString(36).substring(2, 5),
      timestamp: new Date().toISOString(),
      reference,
      description,
      category,
      debitAccount,
      creditAccount,
      amount: Math.round(amount * 100) / 100,
    };
    this.ledgerEntries.unshift(entry);
  }

  private seedInitialLedger(): LedgerEntry[] {
    return [
      {
        id: 'ledg-init-1',
        timestamp: new Date(Date.now() - 86400000 * 2).toISOString(),
        reference: 'OPEN-BAL',
        description: 'Opening Capital & Bank Reserves',
        category: 'Equity',
        debitAccount: 'Operating Bank Account',
        creditAccount: "Owner's Equity",
        amount: 500000,
      },
      {
        id: 'ledg-init-2',
        timestamp: new Date(Date.now() - 86400000).toISOString(),
        reference: 'INV-RESTOCK',
        description: 'Initial Opening Warehouse Inventory Stock',
        category: 'Inventory',
        debitAccount: 'Merchandise Inventory Asset',
        creditAccount: 'Operating Bank Account',
        amount: 185000,
      },
    ];
  }

  // Pre-seed realistic past orders across multiple days for Analytics & Reporting
  private seedInitialOrders(): SaleOrder[] {
    const orders: SaleOrder[] = [];
    const prods = INITIAL_PRODUCTS['tenant-retail'];
    const now = Date.now();

    const sampleDays = [
      { daysAgo: 6, count: 8, baseRevenue: 4200 },
      { daysAgo: 5, count: 11, baseRevenue: 5900 },
      { daysAgo: 4, count: 9, baseRevenue: 4800 },
      { daysAgo: 3, count: 14, baseRevenue: 7800 },
      { daysAgo: 2, count: 12, baseRevenue: 6400 },
      { daysAgo: 1, count: 16, baseRevenue: 8900 },
      { daysAgo: 0, count: 7, baseRevenue: 3800 },
    ];

    sampleDays.forEach((day, dayIdx) => {
      for (let i = 0; i < day.count; i++) {
        const p1 = prods[i % prods.length];
        const p2 = prods[(i + 2) % prods.length];
        const subtotal = p1.sellingPrice * 2 + p2.sellingPrice;
        const tax = subtotal * 0.16;
        const total = subtotal + tax;
        const methods: SaleOrder['paymentMethod'][] = ['cash', 'card', 'mobile_money'];
        const method = methods[i % methods.length];

        orders.push({
          id: `seed-ord-${dayIdx}-${i}`,
          idempotencyKey: `SEED-KEY-${dayIdx}-${i}`,
          orderNumber: `ORD-${84000 + dayIdx * 100 + i}`,
          shiftId: 'seed-shift',
          cashierName: 'Jane Mwangi',
          tenantId: 'tenant-retail',
          items: [
            { product: p1, quantity: 2, unitPrice: p1.sellingPrice },
            { product: p2, quantity: 1, unitPrice: p2.sellingPrice },
          ],
          subtotal,
          tax,
          discount: 0,
          total,
          paymentMethod: method,
          amountTendered: total,
          changeDue: 0,
          timestamp: new Date(now - day.daysAgo * 86400000 - i * 3600000).toISOString(),
          syncStatus: 'synced',
          printed: true,
        });
      }
    });

    return orders;
  }
}

export const storage = new StorageEngine();
