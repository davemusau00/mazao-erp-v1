/** Business-facing messages are selected by code; remote diagnostics are never UI copy. */
const messages: Record<string, string> = {
  UNAUTHORIZED: 'Your sign-in has expired. Sign in again to continue.',
  INVALID_CREDENTIALS: 'The email or password is incorrect. Check your details and try again.',
  UNAUTHENTICATED: 'Check your email and password. If you still cannot sign in, ask your administrator to review your access.',
  FORBIDDEN: 'Your account does not have permission for this action. Ask your manager for help.',
  CSRF_INVALID: 'Your sign-in needs to be refreshed. Sign in again before continuing.',
  ASSIGNMENT_REQUIRED: 'Choose the workspace you want to open.',
  NO_ACTIVE_ASSIGNMENT: 'Your account needs an active workspace assignment. Ask your administrator for help.',
  VALIDATION_FAILED: 'Check the amounts and required details, then try again.',
  VERSION_CONFLICT: 'This information changed on another device. Refresh and review the latest details.',
  PRODUCT_ARCHIVE_STOCK_REMAINING: 'This item still has recorded quantity or value. Sell or reconcile its stock before archiving.',
  PRODUCT_ARCHIVE_UNRESOLVED_SHORTFALL: 'Resolve this item’s stock exceptions before archiving.',
  CATEGORY_IN_USE: 'Move the active items to another category before archiving this category.',
  CATEGORY_MERGED: 'This category was merged. Use its destination category.',
  CATEGORY_ARCHIVED: 'Restore the category or choose an active category before continuing.',
  CATEGORY_NAME_CONFLICT: 'That exact category name already exists. Choose its existing record or another name.',
  CATALOG_IDENTITY_CONFLICT: 'That SKU or barcode belongs to another item. Review the existing item.',
  OPEN_COUNT_CONFLICT: 'Finish or cancel the open outlet count before changing its catalog baseline.',
  IDEMPOTENCY_MISMATCH: 'The saved action differs from this attempt. Check the original action status before continuing.',
  CREDENTIAL_OPERATION_FENCED: 'The earlier password request was safely stopped. Enter a new password to continue.',
  INSUFFICIENT_STOCK: 'There is not enough stock for this sale. Review the quantities or receive more stock.',
  INSUFFICIENT_CASH: 'There is not enough cash in this till for this action. Review the cash-up details.',
  NOT_FOUND: 'This record could not be found in your workspace. Refresh and try again.',
  CUSTOMER_ACCOUNT_SUSPENDED: 'This customer account is suspended. Ask your manager for help.',
  CUSTOMER_CREDIT_LIMIT_EXCEEDED: 'This sale exceeds the customer’s available credit. Choose another payment method.',
  CUSTOMER_BALANCE_MISMATCH: 'The customer balance needs review. Ask your manager before collecting another payment.',
  DUPLICATE_PAYMENT_REFERENCE: 'This M-Pesa transaction reference has already been used. Review the original payment.',
  MPESA_REFERENCE_ALREADY_USED: 'This M-Pesa transaction reference has already been used. Review the original payment.',
  MANUAL_MPESA_REFUND_UNSUPPORTED: 'M-Pesa refunds are not available here. Ask your manager for help.',
  UNSUPPORTED_REFUND_METHOD: 'This payment method cannot be refunded here. Ask your manager for help.',
  RESOURCE_OCCUPIED: 'This room or resource is already in use. Refresh and choose an available option.',
  CAPABILITY_DISABLED: 'This feature is not enabled for your business. Ask your administrator for help.',
  REQUIRES_ONLINE: 'A connection is required for this action. Reconnect and check its status before continuing.',
  REQUIRES_APPROVAL: 'This action needs an authorized manager’s approval.',
  LIMIT_EXCEEDED: 'This action exceeds the allowed limit. Reduce the amount or ask your manager for help.',
  EXPORT_TOO_LARGE: 'This export is too large to download at once. Choose a shorter date range.',
  SOURCE_UNAVAILABLE: 'This document is not available in the selected outlet. Choose its outlet or review the accounting lines.',
  SOURCE_TOO_LARGE: 'This stock document has many lines. Review its stock movement history.',
  SHIFT_CASH_RECONCILIATION_FAILED: 'The cash-up totals need review before this shift can be closed. Ask your manager for help.',
  PERIOD_CLOSED: 'This accounting period is closed. Choose an open date or request an authorized adjustment.',
  RECONCILIATION_FAILED: 'The recorded totals do not agree. Review the source transactions before continuing.',
  DISCOUNT_NOT_ALLOWED: 'Your account cannot apply this discount. Ask your manager for help.',
  REQUEST_CANCELLED: 'Loading cancelled.',
  REQUEST_TIMED_OUT: 'Loading took longer than expected. Try again.',
  CONNECTION_FAILED: 'The connection was lost. Reconnect and try again.',
  INVALID_SERVER_RESPONSE: 'We couldn’t load this information correctly. Try again.',
  OUTCOME_UNKNOWN: 'We couldn’t confirm whether this action completed. Check its status before repeating it.',
  RECOVERY_STORAGE_UNAVAILABLE: 'Saved actions could not be checked on this device. Enable browser storage and try again, or ask your manager for help.',
  PAYMENT_CONFIRMATION_REQUIRED: 'Check that the payment was completed before recording it. Recording does not send money.',
  PAYMENT_EXCEEDS_BALANCE: 'This payment exceeds the outstanding bill. Review the amount before continuing.',
  DUPLICATE_SUPPLIER_INVOICE: 'This supplier bill or stock delivery has already been recorded. Review its original entry.',
  DUPLICATE_STATEMENT_REFERENCE: 'This statement or transaction reference has already been recorded. Review the original entry.',
  STATEMENT_PAYMENT_MISMATCH: 'The reference, amount and currency do not match. Review the statement and original payment.',
  ALREADY_MATCHED: 'This transaction has already been matched. Review its recorded match.',
  ALREADY_REVERSED: 'This record already has a correction. Review the linked correction entry.',
  PAID_INVOICE_REVERSAL_UNAVAILABLE: 'This bill has recorded payments. A supplier credit and returned-payment review is required.',
  AP_RECONCILIATION_FAILED: 'The supplier payment history does not agree with its balance. Review it before paying.',
  RECEIPT_INVOICE_MISMATCH: 'Choose the stock delivery for this outlet and match its full recorded value. Price differences need review.',
  PERIOD_OVERLAP: 'These dates overlap an existing accounting period. Choose another date range.',
  INVALID_PERIOD_TRANSITION: 'An open period must enter closing review first. Closed periods cannot be reopened here.',
  OPEN_SHIFTS_BLOCK_PERIOD: 'Close the active cashier shifts before beginning this period’s closing review.',
  PERIOD_RECONCILIATION_FAILED: 'Resolve account differences and unmatched M-Pesa transactions before closing this period.',
};

export function apiErrorMessage(code: string, status?: number): string {
  if (messages[code]) return messages[code];
  if (status === 401) return messages.UNAUTHORIZED;
  if (status === 403) return messages.FORBIDDEN;
  if (status === 404) return messages.NOT_FOUND;
  if (status === 429) return 'Too many requests were made. Wait a moment and try again.';
  if (status && status >= 500) return 'Mazao is temporarily unavailable. Try again shortly. Check any unconfirmed payment before repeating it.';
  return 'This action could not be completed. Review the details or ask your manager for help.';
}

export function unconfirmedActionMessage(path: string): string {
  return path === '/auth/login' ? 'We couldn’t check your sign-in. Try again.' : messages.OUTCOME_UNKNOWN;
}

export function presentOutcome<T extends { status?: unknown; code?: unknown; message?: unknown }>(result: T): T {
  if (result.status !== 'REJECTED' && result.status !== 'CONFLICT') return result;
  const code = typeof result.code === 'string' ? result.code : result.status === 'CONFLICT' ? 'VERSION_CONFLICT' : '';
  return { ...result, message: apiErrorMessage(code) };
}

/** An incomplete acknowledgement must never cause retained financial evidence to be deleted. */
export function isTerminalOutcome(result: unknown, commandId: string, commandType?: string, commandPayload?: Record<string,unknown>): boolean {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
  const outcome = result as Record<string, unknown>;
  if (outcome.commandId !== commandId || !['CONFIRMED', 'REJECTED', 'CONFLICT'].includes(String(outcome.status))) return false;
  if (outcome.status !== 'CONFIRMED') return typeof outcome.code === 'string'
    && outcome.code.trim().length > 0 && outcome.code.trim() !== 'IDEMPOTENCY_MISMATCH';
  if (!outcome.value || typeof outcome.value !== 'object' || Array.isArray(outcome.value)) return false;
  const value = outcome.value as Record<string, unknown>;
  const identifier = (key:string) => typeof value[key] === 'string' && value[key] !== '' && (commandPayload?.[key] === undefined || value[key] === commandPayload[key]);
  const version = (key:string) => typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && Number(value[key]) >= 1;
  if (commandType === 'catalog.product.create') {
    return typeof value.productId === 'string' && value.productId.trim().length > 0
      && typeof value.sku === 'string' && value.sku.trim().length > 0
      && (commandPayload?.sku === undefined || typeof commandPayload.sku === 'string' && value.sku === commandPayload.sku.trim());
  }
  if (commandType === 'catalog.product.update' || commandType === 'catalog.product.set_active') {
    return identifier('productId') && version('version') && typeof value.active === 'boolean'
      && (commandType !== 'catalog.product.set_active' || commandPayload?.active === undefined || value.active === commandPayload.active);
  }
  if (['catalog.category.create','catalog.category.update','catalog.category.set_active'].includes(commandType ?? '')) {
    return identifier('categoryId') && version('version') && typeof value.active === 'boolean'
      && (commandType !== 'catalog.category.set_active' || commandPayload?.active === undefined || value.active === commandPayload.active);
  }
  if (commandType === 'catalog.category.merge') {
    return identifier('sourceCategoryId') && identifier('targetCategoryId') && value.sourceCategoryId !== value.targetCategoryId
      && version('sourceVersion') && version('targetVersion') && typeof value.updatedProducts === 'number'
      && Number.isSafeInteger(value.updatedProducts) && value.updatedProducts >= 0;
  }
  const idField = commandType === 'sales.order.settle' ? 'saleId' : commandType === 'sales.order.refund' ? 'refundId' : undefined;
  return !idField || typeof value[idField] === 'string' && value[idField] !== '';
}

/** Status transport may omit the nested ID, but must never contradict it. */
export function isTerminalCommandStatus(result: unknown, commandId: string, commandType?: string, commandPayload?: Record<string, unknown>): result is {
  commandId: string; status: string; response: Record<string, unknown>;
} {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
  const status = result as Record<string, unknown>;
  if (status.commandId !== commandId || !status.response || typeof status.response !== 'object' || Array.isArray(status.response)) return false;
  const response = status.response as Record<string, unknown>;
  if (response.status !== status.status || Object.hasOwn(response, 'commandId') && response.commandId !== commandId) return false;
  return isTerminalOutcome({ ...response, commandId }, commandId, commandType, commandPayload);
}
