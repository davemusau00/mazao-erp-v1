/** Exact money is serialized in minor units. These operations record reviewed
 * business evidence; they do not initiate bank or mobile-money transfers. */
export type ExpenseCategory = 'OPERATING_EXPENSE' | 'RENT_EXPENSE' | 'UTILITIES_EXPENSE';
export type NoncashPaymentAccount = 'BANK_CONTROL' | 'MOBILE_MONEY_CONTROL';
export interface AccountingCheck { ledgerMinor: string; subledgerMinor: string; differenceMinor: string; balanced: boolean }
export interface AccountingControls {
  generatedAt: string; businessDate: string; currency: string; timeZone: string;
  controls: { receivables: AccountingCheck; inventory: AccountingCheck; payables: AccountingCheck };
  incomingMpesa: { recordedMinor: string; matchedMinor: string; unmatchedMinor: string; recordedCount: string; matchedCount: string; unmatchedCount: string; unmatchedStatementMinor: string; unmatchedStatementCount: string };
  coverage: { status: 'PARTIAL'; exclusions: string[]; negativeNoncashAccounts: Array<{ accountCode: NoncashPaymentAccount; balanceMinor: string }> };
  categories: Array<{ code: ExpenseCategory; label: string }>;
  paymentAccounts: Array<{ code: NoncashPaymentAccount; label: string }>;
  permissions: { manage: boolean; close: boolean };
}
export interface AccountingExpense {
  id: string; createdAt: string; effectiveDate: string; amountMinor: string; currency: string;
  category: ExpenseCategory; description: string; payee: string | null; paymentAccount: NoncashPaymentAccount;
  version: number; currentCategory: ExpenseCategory;
  reclassification: {effectiveDate:string;category:ExpenseCategory;reason:string;operatorName:string} | null;
  reference: string; operatorName: string;
  reversal: { id: string; effectiveDate: string; reason: string; operatorName: string } | null;
}
export interface AccountingSupplier { id: string; createdAt: string; name: string; phone: string | null }
export interface AccountingInvoice {
  id: string; createdAt: string; supplierId: string; supplierName: string; reference: string;
  invoiceDate: string; dueDate: string; amountMinor: string; paidMinor: string; remainingMinor: string;
  currency: string; kind: 'EXPENSE' | 'RECEIPT'; category: ExpenseCategory | null;
  receiptCommandId: string | null; description: string; status: 'OPEN' | 'REVERSED'; version: number;
}
export interface AccountingPayment {
  id: string; createdAt: string; effectiveDate: string; amountMinor: string; currency: string;
  paymentAccount: NoncashPaymentAccount; reference: string; operatorName: string;
  kind: 'EXPENSE' | 'SUPPLIER_PAYMENT'; sourceId: string; description: string;
}
export interface AccountingPeriod {
  id: string; createdAt: string; from: string; to: string; status: 'OPEN' | 'CLOSING' | 'CLOSED';
  version: number; reason: string; operatorName: string; changedAt: string;
}
export interface AccountingStatement {
  id: string; createdAt: string; reference: string; from: string; to: string; currency: string;
  lineCount: number; totalMinor: string; matchedCount: number;
}
export interface AccountingStatementLine {
  id: string; createdAt: string; statementId: string; statementReference: string; reference: string;
  occurredOn: string; amountMinor: string; currency: string; paymentId: string | null; matchedAt: string | null;
  originalReference: string; originalAmountMinor: string; originalOccurredOn: string; correctionReason: string | null; version: number;
}
export interface AccountingReceipt {
  id: string; createdAt: string; reference: string | null; supplierName: string | null; amountMinor: string; currency: string; outletName: string;
}
export interface AccountingMpesaPayment { id: string; createdAt: string; reference: string; amountMinor: string; currency: string; outletName: string; operatorName: string; matched: boolean }
export interface AccountingRecordMap {
  expenses: AccountingExpense; suppliers: AccountingSupplier; invoices: AccountingInvoice; payments: AccountingPayment;
  periods: AccountingPeriod; statements: AccountingStatement; 'statement-lines': AccountingStatementLine; receipts: AccountingReceipt; 'mpesa-payments': AccountingMpesaPayment;
}
export type AccountingRecordKind = keyof AccountingRecordMap;
export interface AccountingRecordPage<K extends AccountingRecordKind = AccountingRecordKind> {
  records: Array<AccountingRecordMap[K]>; pageInfo: { limit: number; hasMore: boolean; nextCursor: string | null };
}
