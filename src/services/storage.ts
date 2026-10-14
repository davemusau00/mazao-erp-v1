/**
 * Retired prototype storage compatibility surface.
 * The live application uses authenticated server commands and IndexedDB command recovery.
 * Existing browser records are preserved but are never loaded or modified here.
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
import { sumDecimalStrings } from '../utils/decimal';

// Archived components retain their types while no seeded data enters a live bundle.
export const INITIAL_TENANTS: TenantProfile[] = [];
export const INITIAL_CUSTOMERS: CustomerAccount[] = [];
export const INITIAL_CUSTOMER_TX: CustomerTransaction[] = [];
export const INITIAL_STAFF: StaffUser[] = [];
export const INITIAL_PRODUCTS: Record<string, ProductItem[]> = {};
export const INITIAL_ROOMS: Room[] = [];
export const INITIAL_AUDIT_LOGS: ShiftAuditLog[] = [];
export const INITIAL_CONFLICTS: SyncConflict[] = [];

class StorageEngine {
  private tenantId: string = '';
  private isSimulatedOnline: boolean = true;
  private tenants: TenantProfile[] = [];
  private products: Record<string, ProductItem[]> = {};
  private rooms: Room[] = [];
  private orders: SaleOrder[] = [];
  private activeShift: Shift | null = null;
  private shiftsHistory: Shift[] = [];
  private stockMovements: StockMovement[] = [];
  private ledgerEntries: LedgerEntry[] = [];
  private outboxQueue: OutboxItem[] = [];
  private staffUsers: StaffUser[] = [];
  private activeStaffId: string = '';
  private auditLogs: ShiftAuditLog[] = [];
  private conflicts: SyncConflict[] = [];
  private customers: CustomerAccount[] = [];
  private customerTransactions: CustomerTransaction[] = [];
  private listeners: Set<() => void> = new Set();
  private persistenceError: string | null = null;

  constructor() {
    // Retained solely so archived prototype components can typecheck. The live
    // application has no browser financial store. Preserve old browser records
    // for an explicit recovery/export; never load, seed, or overwrite them.
  }

  private persist(): never {
    throw new Error('Browser preview storage is retired. Sign in and use server commands.');
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getPersistenceError(): string | null {
    return this.persistenceError;
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
    // There is no server transport in this preview. Keep local items pending;
    // connectivity simulation must never be presented as server acknowledgement.
    this.notify();
  }

  public clearSyncedOutbox(): void {
    // A local preview cannot verify that any queued item was remotely acknowledged.
    throw new Error('Outbox records cannot be cleared: no server acknowledgement service is configured.');
  }

  // --- Products & Inventory ---
  public getProducts(): ProductItem[] {
    return this.products[this.tenantId] || [];
  }

  public adjustStock(productId: string, delta: number, type: StockMovement['type'], note: string): void {
    const list = this.products[this.tenantId] || [];
    const prod = list.find(p => p.id === productId);
    if (!prod) return;
    if (!Number.isFinite(delta) || delta === 0) throw new Error('Stock change must be a finite, non-zero quantity.');
    const balanceAfter = Number(sumDecimalStrings([String(prod.stockOnHand), String(delta)]));
    if (!Number.isFinite(balanceAfter) || balanceAfter < 0) throw new Error('Stock cannot be reduced below zero.');
    prod.stockOnHand = balanceAfter;

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
      status: 'pending',
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
      status: 'pending',
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
      status: 'pending',
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
    if (rm.status !== 'occupied') throw new Error('Only an occupied room can be checked out.');
    if (!['cash', 'card', 'mobile_money'].includes(paymentMethod)) {
      throw new Error('Guest folio checkout requires cash, card, or mobile money settlement.');
    }

    const finalizedCharges = [...rm.folioCharges];
    const totalDue = finalizedCharges.reduce((acc, c) => acc + c.amount, 0);
    if (!Number.isFinite(amountTendered) || amountTendered < totalDue) {
      throw new Error(`Settlement is incomplete. Outstanding balance: ${Math.max(0, totalDue - amountTendered).toFixed(2)}.`);
    }
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
    if (order.status === 'refunded') throw new Error(`Order ${order.orderNumber} has already been refunded.`);
    if (!reason.trim()) throw new Error('A refund reason is required.');

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
      order.subtotal
    );
    if (order.tax > 0) {
      this.recordLedgerEntry(
        `REFUND-VAT-${order.orderNumber}`,
        `VAT reversal for refund #${order.orderNumber}`,
        'Taxation',
        'VAT Payable',
        creditAccount,
        order.tax
      );
    }

    if (this.activeShift?.status === 'open') {
      if (refundMethod === 'cash') {
        this.activeShift.cashSales -= order.total;
        this.activeShift.expectedCash -= order.total;
      } else if (refundMethod === 'card') {
        this.activeShift.cardSales -= order.total;
      } else if (refundMethod === 'mobile_money') {
        this.activeShift.mobileSales -= order.total;
      }
    }

    // Keep an explicit refund movement after all ledger validations succeed.
    for (const item of order.items) {
      this.adjustStock(item.product.id, item.quantity, 'adjustment', `Return/Refund on #${order.orderNumber}: ${reason}`);
    }
    order.status = 'refunded';
    order.refundReason = reason;
    order.refundTimestamp = new Date().toISOString();

    this.recordAuditLog({
      action: 'void_line_item',
      details: `Full order refund executed for #${order.orderNumber}: ${order.total} (${reason}) via ${refundMethod}`,
      amount: order.total,
      flagSeverity: 'warning',
    });

    this.outboxQueue.unshift({
      id: `outbox-refund-${order.id}`,
      entityType: 'sale',
      payload: { type: 'refund', orderId: order.id, reason, refundMethod, amount: order.total },
      createdAt: new Date().toISOString(),
      attempts: 0,
      status: 'pending',
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
      syncStatus: 'pending_outbox',
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
      status: 'pending',
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
      status: 'pending',
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


}

export const storage = new StorageEngine();
