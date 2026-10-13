import type { Permission, TenantProfile } from './erp';

/** UI routes are task areas, not persisted domain entities. */
export type WorkspaceId =
  | 'today'
  | 'sell'
  | 'sales'
  | 'service'
  | 'stock'
  | 'purchasing'
  | 'hotel'
  | 'reservations'
  | 'stock-count'
  | 'customers'
  | 'shifts'
  | 'money'
  | 'reports'
  | 'manage'
  | 'onboarding'
  | 'help';

export interface WorkspaceDefinition {
  id: WorkspaceId;
  label: string;
  description: string;
  permission?: Permission;
  anyPermissions?: Permission[];
  capability?: string;
  group: 'work' | 'money' | 'manage' | 'support';
}

export type CommandStatus =
  | 'editing'
  | 'validating'
  | 'sending'
  | 'confirmed'
  | 'rejected'
  | 'outcome_unknown'
  | 'local_only'
  | 'pending_sync'
  | 'conflict';

export interface CommandOutcome<T> {
  commandId: string;
  status: CommandStatus;
  value?: T;
  message?: string;
  retryable: boolean;
}

export interface FieldIssue {
  field: string;
  message: string;
}

export interface ReportCoverage {
  asOf: string;
  from: string;
  to: string;
  status: 'complete' | 'partial' | 'unavailable';
  explanation?: string;
}

/** Money is passed between UI and application services in minor units. */
export interface MoneyValue {
  amountMinor: number;
  currency: TenantProfile['currency'];
}

/** Decimal quantities stay strings at form boundaries to avoid float rounding. */
export interface QuantityValue {
  amount: string;
  unit: string;
}

export interface UiApplicationServices {
  checkCommandStatus(commandId: string): Promise<CommandOutcome<unknown>>;
  reviewCommandActivity(commandId: string): Promise<void>;
}

export interface CommandContext {
  commandId: string;
  tenantId: string;
  outletId: string;
  actorId: string;
  deviceId: string;
}

export interface SaleDraftInput {
  lines: Array<{ productId: string; quantity: QuantityValue; unitPrice: MoneyValue; discountMinor?: number }>;
  tenders: Array<{ method: 'cash' | 'manual_mpesa' | 'card' | 'customer_credit' | 'guest_bill'; amount: MoneyValue; reference?: string }>;
  customerId?: string;
  guestStayId?: string;
}

export interface StockCountReviewInput {
  locationId: string;
  baselineVersion: number;
  lines: Array<{ productId: string; counted: QuantityValue; reason?: string }>;
}

export interface RoomStayInput {
  roomId: string;
  guestName: string;
  guestContact?: string;
  arrivalDate: string;
  departureDate: string;
  rate: MoneyValue;
}

export interface ShiftCashUpInput {
  shiftId: string;
  countedCash: MoneyValue;
  notes?: string;
}

export interface CustomerRepaymentInput {
  customerId: string;
  amount: MoneyValue;
  method: 'cash' | 'manual_mpesa' | 'bank';
  reference?: string;
}

export interface ReportQuery {
  reportId: string;
  from: string;
  to: string;
  outletIds: string[];
}

export interface CatalogItemInput {
  name: string;
  sku: string;
  barcode?: string;
  category: string;
  baseUnit: string;
  purchasePackage?: { name: string; contains: QuantityValue; cost: MoneyValue };
  sellingPrice: MoneyValue;
  reorderPoint: QuantityValue;
}

export interface ImportPreviewRequest {
  fileName: string;
  contentHash: string;
  columnMap: Record<string, string>;
  outletId: string;
}

export interface ImportPreviewResult {
  batchId: string;
  validRows: number;
  rejectedRows: number;
  warnings: string[];
  rowIssues: Array<{ row: number; field: string; message: string }>;
}

export interface DeliveryReceiptInput {
  supplierId: string;
  purchaseOrderId?: string;
  lines: Array<{ productId: string; received: QuantityValue; unitCost: MoneyValue }>;
  reference?: string;
}

export interface ReservationInput extends RoomStayInput {
  deposit?: MoneyValue;
}

export interface TableOrderInput {
  tableId: string;
  lines: Array<{ productId: string; quantity: QuantityValue; notes?: string }>;
}

export interface KitchenTicketUpdateInput {
  ticketId: string;
  status: 'accepted' | 'preparing' | 'ready' | 'served';
}

/** UI adapters implement this contract; the local demo store is not an implementation of server authority. */
export interface V1ApplicationServices extends UiApplicationServices {
  createCatalogItem(context: CommandContext, input: CatalogItemInput): Promise<CommandOutcome<{ productId: string }>>;
  previewImport(context: CommandContext, input: ImportPreviewRequest): Promise<ImportPreviewResult>;
  applyImport(context: CommandContext, batchId: string): Promise<CommandOutcome<{ imported: number; rejected: number }>>;
  receiveDelivery(context: CommandContext, input: DeliveryReceiptInput): Promise<CommandOutcome<{ receiptId: string; movementBatchId: string }>>;
  submitSale(context: CommandContext, input: SaleDraftInput): Promise<CommandOutcome<{ saleId: string; receiptId: string }>>;
  submitTableOrder(context: CommandContext, input: TableOrderInput): Promise<CommandOutcome<{ orderId: string }>>;
  updateKitchenTicket(context: CommandContext, input: KitchenTicketUpdateInput): Promise<CommandOutcome<{ ticketId: string }>>;
  reviewStockCount(context: CommandContext, input: StockCountReviewInput): Promise<CommandOutcome<{ movementBatchId: string }>>;
  createReservation(context: CommandContext, input: ReservationInput): Promise<CommandOutcome<{ reservationId: string }>>;
  createRoomStay(context: CommandContext, input: RoomStayInput): Promise<CommandOutcome<{ stayId: string; guestBillId: string }>>;
  closeCashShift(context: CommandContext, input: ShiftCashUpInput): Promise<CommandOutcome<{ reportId: string }>>;
  recordCustomerRepayment(context: CommandContext, input: CustomerRepaymentInput): Promise<CommandOutcome<{ repaymentId: string; balance: MoneyValue }>>;
  loadReport(query: ReportQuery): Promise<{ coverage: ReportCoverage; rows: Array<Record<string, string | number | null>> }>;
}
