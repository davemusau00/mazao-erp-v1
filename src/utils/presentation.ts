/** Human-readable labels only. Protocol values remain unchanged in requests and recovery storage. */
export { formatDecimalQuantity, formatBasisPoints } from './money.js';
export function operationLabel(type: string): string {
  const labels: Record<string, string> = {
    'sales.order.settle': 'Sale payment', 'sales.order.refund': 'Sale refund',
    'shift.open': 'Open till', 'shift.close': 'Close till', 'shift.cash.movement': 'Till cash movement',
    'inventory.receive': 'Stock delivery', 'inventory.count.open': 'Start stock count',
    'inventory.count.save': 'Save stock count', 'inventory.count.update': 'Save stock count',
    'inventory.count.post': 'Approve stock count', 'inventory.count.cancel': 'Cancel stock count',
    'catalog.product.create': 'Create item', 'catalog.product.update': 'Update item',
    'catalog.product.archive': 'Archive item', 'catalog.product.restore': 'Restore item',
    'catalog.import.validate': 'Check product import', 'catalog.import.revalidate': 'Recheck product import',
    'catalog.import.apply': 'Apply product import', 'configuration.business.update': 'Business settings',
    'configuration.outlet.update': 'Outlet settings', 'configuration.capabilities.update': 'Business services',
    'customers.account.create': 'Create customer account', 'customers.account.update': 'Update customer account',
    'customers.repayment': 'Customer repayment', 'customers.repayment.record': 'Customer repayment', 'staff.member.create': 'Create staff account',
    'staff.member.update': 'Update staff account', 'staff.member.set_active': 'Change staff access',
    'devices.assignment.create': 'Create outlet assignment', 'devices.assignment.update': 'Update outlet assignment',
    'devices.assignment.revoke': 'Remove outlet assignment', 'auth.password.change': 'Password change',
    'staff.password.set': 'Set staff password', 'auth.session.revoke': 'Sign out a session',
    'staff.sessions.revoke': 'Sign out a staff session', 'hotel.room.create': 'Create room',
    'hotel.reservation.create': 'Create reservation', 'hotel.reservation.cancel': 'Cancel reservation',
    'hotel.checkin': 'Guest check-in', 'hotel.checkout': 'Guest checkout', 'hotel.room.mark_ready': 'Room ready',
    'finance.expense.record': 'Record expense', 'finance.expense.reverse': 'Correct expense',
    'finance.expense.reclassify': 'Correct expense category', 'finance.account.label': 'Account display name',
    'finance.supplier.create': 'Create supplier', 'finance.supplier.invoice': 'Record supplier bill',
    'finance.supplier.invoice.reverse': 'Correct supplier bill', 'finance.supplier.payment': 'Record supplier payment',
    'finance.mpesa.statement.record': 'Record M-Pesa statement', 'finance.mpesa.statement.match': 'Match M-Pesa payment',
    'finance.mpesa.statement.correct': 'Correct M-Pesa statement', 'finance.period.create': 'Create accounting period',
    'finance.period.transition': 'Change accounting period status',
  };
  return labels[type] ?? 'Business action';
}

export function actionStatusLabel(status: string): string {
  return ({ CONFIRMED: 'Completed', REJECTED: 'Not completed', CONFLICT: 'Changed elsewhere',
    EXECUTING: 'Still being checked', NOT_FOUND: 'No completed action found', READY: 'Ready for review',
    INVALID: 'Needs corrections', APPLIED: 'Applied', VALIDATING: 'Checking',
    CREATE: 'New item', UPDATE: 'Update item', UNCHANGED: 'No changes',
    OPEN: 'Open', POSTED: 'Approved', CANCELLED: 'Cancelled', ACTIVE: 'Active', SUSPENDED: 'Suspended',
  } as Record<string, string>)[status] ?? 'Needs review';
}

export function roleLabel(role: string): string {
  return ({ owner: 'Owner', admin: 'Administrator', manager: 'Manager', cashier: 'Cashier',
    stock_clerk: 'Stock clerk', stock_keeper: 'Stock keeper', storekeeper: 'Storekeeper', accountant: 'Accountant',
    frontdesk: 'Front desk', front_desk: 'Front desk', housekeeper: 'Housekeeper',
    receptionist: 'Receptionist', waiter: 'Waiter', cook: 'Cook', bartender: 'Bartender', kitchen: 'Kitchen', auditor: 'Auditor', readonly: 'Read only',
  } as Record<string, string>)[role] ?? 'Staff member';
}

export function permissionLabel(code: string): string {
  return ({ 'commerce.sell': 'Make sales', 'commerce.refund': 'Issue refunds', 'commerce.discount': 'Discount sale items',
    'catalog.manage': 'Manage items', 'inventory.receive': 'Receive stock', 'inventory.count': 'Count stock',
    'inventory.count.approve': 'Approve stock counts', 'finance.view': 'View accounts and reports',
    'finance.manage': 'Manage accounting records', 'finance.close': 'Close accounting periods',
    'customers.view': 'View customers', 'customers.charge': 'Charge customer accounts', 'customers.manage': 'Manage customers', 'customers.settle': 'Collect customer repayments',
    'shift.open': 'Open a till', 'shift.close': 'Close a till', 'shift.payout': 'Record till cash movements', 'shift.cash.movement': 'Record till cash movements',
    'config.view': 'View business settings', 'config.manage': 'Change business settings',
    'staff.view': 'View staff', 'staff.manage': 'Manage staff', 'devices.view': 'View outlet assignments',
    'devices.manage': 'Manage outlet assignments', 'hotel.frontdesk': 'Manage guests and reservations',
    'hotel.manage': 'Manage rooms', 'hotel.housekeeping': 'Update room cleaning',
    'audit.view': 'View business activity',
  } as Record<string, string>)[code] ?? 'Additional business access';
}

export function sourceLabel(type: string): string {
  return ({ sale: 'Sale', restock: 'Stock received', adjustment: 'Stock adjustment',
    RECEIPT: 'Stock received', COUNT: 'Stock count', OPENING: 'Opening stock',
    SALE: 'Sale', SALES_ORDER: 'Sale', SALE_PAYMENT: 'Sale payment', REFUND: 'Sale refund',
    SALE_COGS: 'Cost of sold items', SALE_REFUND: 'Sale refund', SALE_REFUND_COGS: 'Returned item costs',
    SHIFT_OPEN: 'Till opening', SHIFT_CASH_PAID_IN: 'Till cash paid-in', SHIFT_CASH_PAYOUT: 'Till cash payout',
    SHIFT_CASH_VARIANCE: 'Till cash difference', ROOM_CHECKOUT: 'Guest checkout',
    EXPENSE: 'Expense', EXPENSE_REVERSAL: 'Expense correction', SUPPLIER_INVOICE: 'Supplier bill',
    SUPPLIER_INVOICE_REVERSAL: 'Supplier bill correction', SUPPLIER_PAYMENT: 'Supplier payment',
    SALES_REFUND: 'Sale refund', INVENTORY_RECEIPT: 'Stock delivery', INVENTORY_COUNT: 'Stock count',
    INVENTORY_COUNT_VARIANCE: 'Stock count adjustment', OPENING_STOCK: 'Opening stock',
    CUSTOMER_REPAYMENT: 'Customer repayment', CUSTOMER_ACCOUNT_CHARGE: 'Customer account charge',
    SHIFT_CASH_MOVEMENT: 'Till cash movement', HOTEL_CHECKOUT: 'Guest checkout',
  } as Record<string, string>)[type] ?? operationLabel(type);
}

export function importIssueMessage(code: string): string {
  return ({
    MAPPING_FIELD: 'Choose a supported product field.', MAPPING_HEADER: 'Choose a column that exists in this file.',
    MAPPING_DUPLICATE: 'A file column can be matched to only one product field.', MAPPING_REQUIRED: 'Match the SKU column before checking the file.',
    UNSUPPORTED_PACKAGE_COLUMN: 'This package column is ignored. Enter opening quantities in individual base units.',
    UNMAPPED_COLUMN: 'This column is not matched and will be ignored.',
    SKU_INVALID: 'Use a SKU with 1 to 64 letters, digits, underscores, dots or hyphens. Keep long codes as text.',
    SKU_AMBIGUOUS: 'Several existing items use this SKU. Resolve the duplicate items before importing.',
    ITEM_ARCHIVED: 'This SKU belongs to an archived item. Restore it before importing changes.',
    SKU_EXISTS: 'This SKU already exists. Choose create or update mode to change it.',
    FIELD_INVALID: 'Enter a valid value for this field.', UNIT_IMMUTABLE: 'An existing item unit cannot be changed by import.',
    CURRENCY_MISMATCH: 'Use the business currency. Import cannot convert existing amounts.',
    CURRENCY_IMMUTABLE: 'An existing item currency cannot be changed by import.',
    MONEY_INVALID: 'Enter a non-negative amount within the supported currency precision and amount limit.',
    TAX_INVALID: 'Enter a tax rate from 0 to 100 with up to two decimal places.', CATEGORY_INVALID: 'Use a category of 80 characters or fewer.',
    BARCODE_INVALID: 'Use the original barcode as text, up to 64 characters. Do not use scientific notation.',
    BARCODE_EXISTS: 'Another item at this outlet already uses this barcode.',
    QUANTITY_INVALID: 'Enter a non-negative quantity with up to six decimal places.',
    OPENING_STOCK_EXISTING: 'Opening stock is only for new items. Use a delivery or stock count for existing items.',
    OPENING_COST_REQUIRED: 'Enter the unit cost for opening stock. Confirm it explicitly if the cost is zero.',
    OPENING_VALUE_INVALID: 'Opening stock value exceeds the supported amount limit.',
    OPENING_TOTAL_INVALID: 'Total opening stock value exceeds the supported amount limit.',
    ZERO_OPENING_VALUE: 'Opening stock has zero value. Confirm this cost before importing.',
    ZERO_REFERENCE_COST: 'The reference cost is zero. Check it before importing; it may be needed when a count finds stock.',
    DUPLICATE_SKU: 'This SKU appears more than once in the file.', DUPLICATE_BARCODE: 'This barcode appears on more than one row.',
    CSV_ENCODING: 'Save the file as a UTF-8 CSV and upload it again.', CSV_BYTES_LIMIT: 'Use a file no larger than 512 KB.',
    CSV_CELL_LIMIT: 'A cell contains more than 2,048 characters.', CSV_COLUMNS_LIMIT: 'Use no more than 50 columns.',
    CSV_ROWS_LIMIT: 'Use no more than 1,000 product rows.', CSV_QUOTE: 'Check quotation marks in this CSV row.',
    CSV_EMPTY: 'Include a header and at least one product row.', CSV_HEADER: 'Use a unique, non-empty name for every column.',
    CSV_ROW_WIDTH: 'Every product row must have the same number of columns as the header.',
  } as Record<string, string>)[code] ?? 'Review this value in your file and check the file again.';
}

export function setupCheckLabel(key: string): string {
  return ({ business: 'Business details', outlet: 'Outlet details', tax: 'Tax rate reviewed',
    commerce: 'Selling enabled', catalog: 'Items available', stock: 'Stock received', staff: 'Staff and outlet access',
  } as Record<string, string>)[key] ?? 'Business setup check';
}

export function setupCheckDetail(key: string, original: string): string {
  if (key === 'business' || key === 'outlet' || key === 'catalog' || key === 'stock') return original;
  return ({ tax: 'The default tax rate applies to new items. Previous sales keep their original tax amounts.',
    commerce: 'Enable Sales and Inventory to take payment.',
    staff: 'At least one active staff account and outlet assignment are needed.',
  } as Record<string, string>)[key] ?? 'Review this setup item with your administrator.';
}
