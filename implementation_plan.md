# Customer Directory & Charge to Account Credit Engine

Comprehensive architectural and design plan for Mazao ERP's Customer Directory module, credit account ledgers, and Point-of-Sale 'Charge to Account' tender flow with strict credit limit validation and manager overrides.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following key decisions have been aligned based on user clarification:
>
> - **Credit Limit Enforcement**: Strict block when order total exceeds available credit (`currentBalance + total > creditLimit`), with a secure **Manager PIN override prompt** (PIN `2468` or authorized manager/admin profile) that logs the override to the shift audit trail.
> - **POS Customer Selection**: Integrated **instant live search bar** inside the POS tender dialog with real-time outstanding balance indicators and remaining credit badges (`Credit Limit - Balance`).
> - **Debt Repayment Flow**: Dedicated **Repayment Modal** inside the Customer Directory with instant balance recalculation and thermal receipt printing for customer account credit settlements.

---

## 1. Overview & Core Concept

- **What It Does**: Unifies B2B credit accounts and customer relationship management into Mazao ERP. Enables cashiers to issue orders on credit against verified customer accounts, validates remaining credit limits in real-time, provides manager override mechanisms, and empowers business operators to monitor outstanding receivables, view customer statement ledgers, and collect debt repayments with branded receipts.
- **Target Audience / Persona**:
  - **Cashiers**: Swiftly locate regular or corporate customers by name or phone during checkout, verify available credit headroom, and execute credit sales.
  - **Managers & Supervisors**: Authorize temporary credit overruns via quick PIN authorization and audit all customer debt creation.
  - **Accountants & Owners**: Track aged accounts receivable, customer balances, credit limits, and record repayments.
- **Key Value**: Replaces vulnerable paper debt books and fragmented spreadsheets with an authoritative, offline-resilient customer ledger directly tied to stock deduction and shift financial registers.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **POS 'Charge to Account' Checkout Flow**:
   - Cashier builds an order in `PointOfSaleView` and taps **Tender / Settle**.
   - Selects **Charge to Account** alongside Cash, Card, and M-Pesa.
   - Searches customer by name, phone, or company with instant debounced lookup.
   - The selected customer card reveals:
     - Outstanding debt balance (`KES 12,400.00`).
     - Credit limit (`KES 25,000.00`).
     - Remaining credit (`KES 12,600.00`).
   - If the sale exceeds available headroom:
     - Red warning banner appears: *"Order exceeds available credit by KES 1,400.00"*.
     - Settle button changes to **Authorize Manager Override**.
     - Dialog prompts for Manager PIN (`2468`). Upon verification, the order completes with an audit log tag (`OVERRIDE_CREDIT_LIMIT`).
   - Thermal receipt prints with customer account breakdown: previous balance, sale charge, and new balance.

2. **Customer Directory Workspace Flow**:
   - Operator clicks **Customers** in the main navigation shell.
   - Header stat cards summarize:
     - **Total Receivables**: Sum of all outstanding customer debt.
     - **Active Credit Customers**: Number of accounts carrying debt.
     - **Overdue / Near Limit Accounts**: Accounts exceeding 80% of limit.
     - **Repayments Collected**: Shift/monthly credit settlement total.
   - Search & filter toolbar allows filtering by status (`All`, `With Debt`, `Overdue/Limit Warning`) and searching by name, phone, or tax PIN.
   - Selecting a customer opens the **Customer Account Profile & Statement**:
     - View detailed transaction ledger (Invoiced sales vs. Repayments with timestamps, references, and cashiers).
     - Tap **Record Repayment** to accept cash/M-Pesa/bank settlements and print a settlement receipt.
     - Tap **Edit Profile** to adjust credit limits, contact info, or suspend credit.

### Visual Identity & Theme

- **Palette**: OLED dark background (`#090b10`), elevated panels (`bg-zinc-900 border-zinc-800`), crisp blue action cues (`text-blue-400`, `bg-blue-600`), and emerald accents for repayments (`text-emerald-400`).
- **Typography & Tabular Alignment**: All debt balances, credit limits, invoice amounts, and statement figures rendered in monospace tabular numerals (`font-mono tabular-nums`).
- **Zero-Pill Discipline**: Clean unboxed metadata separated by middots (`Phone · Account # · Limit`), avoiding ornamental capsule clutter.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Manager PIN Override Gate**:
  - *Chosen Approach*: When a sale exceeds the customer's credit limit, cashiers cannot bypass it unilaterally; an in-dialog modal prompts for a Manager/Admin PIN (`2468`).
  - *Why*: Prevents bad debt accumulation while avoiding frustrating operational gridlock during busy evening or restaurant shifts.
- **Decision 2: Local & Outbox Ledger Synchronization**:
  - *Chosen Approach*: Customer balance updates and debt repayments are recorded atomically in the storage engine with offline outbox mutation tracking.
  - *Why*: Ensures credit sales and settlements continue working seamlessly even when network connectivity drops.
- **Decision 3: Dedicated Customer Directory Tab**:
  - *Chosen Approach*: Integrated as a top-level workspace module (`customers`) in `AppShell` with full RBAC access controls.
  - *Why*: Allows accountants and back-office staff to manage customer profiles, statements, and repayments without interfering with front-desk POS terminals.

---

## 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        AppShell Navigation Shell                       │
│  [POS]  [Hospitality]  [Inventory]  [Shifts]  [Ledger]  [Customers]    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
           ┌────────────────────────┴────────────────────────┐
           ▼                                                 ▼
┌──────────────────────────────────────┐  ┌──────────────────────────────┐
│          PointOfSaleView             │  │    CustomerDirectoryView     │
│ - Payment Option: 'customer_account' │  │ - Directory & Debt Overview  │
│ - Instant Customer Search Box        │  │ - Statement / Ledger History │
│ - Credit Headroom Validation         │  │ - Record Repayment Dialog    │
│ - Manager Override PIN Modal         │  │ - Customer Profile Editor    │
└──────────────────┬───────────────────┘  └──────────────┬───────────────┘
                   │                                     │
                   └──────────────────┬──────────────────┘
                                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        StorageEngine (storage.ts)                      │
│ - getCustomers(), saveCustomer(), getCustomerTransactions()            │
│ - processSale() -> updates customer balance & logs transaction         │
│ - recordCustomerRepayment() -> recalculates balance & generates slip   │
└─────────────────────────────────────┬──────────────────────────────────┘
                                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Hardware Print Engine                           │
│ - Thermal receipt with Customer Account Ref & Balance Statement        │
│ - Repayment Acknowledgment Slip (80mm / 58mm)                          │
└────────────────────────────────────────────────────────────────────────┘
```

### Data Entities & Schema

1. **`CustomerProfile`**:
   - `id: string`
   - `tenantId: string`
   - `name: string`
   - `phone: string`
   - `email?: string`
   - `taxPinOrNationalId?: string`
   - `companyName?: string`
   - `creditLimit: number` (e.g. `50000`)
   - `currentBalance: number` (current debt, e.g. `12400`)
   - `status: 'active' | 'suspended' | 'blocked'`
   - `createdAt: string`
   - `updatedAt: string`
   - `notes?: string`

2. **`CustomerAccountTransaction`**:
   - `id: string`
   - `customerId: string`
   - `tenantId: string`
   - `type: 'charge' | 'repayment' | 'credit_adjustment'`
   - `amount: number`
   - `previousBalance: number`
   - `newBalance: number`
   - `referenceOrderNumber?: string`
   - `cashierName: string`
   - `paymentMethod?: PaymentMethod` (for repayments)
   - `timestamp: string`
   - `notes?: string`

---

## 5. Implementation Steps

1. **Data Models & Types (`src/types/erp.ts`)**:
   - Add `CustomerProfile`, `CustomerAccountTransaction`, and `'customer_account'` to `PaymentMethod`.
   - Update `SaleOrder` with `customerAccountRef` and manager override tags.
   - Add customer permissions to `ROLE_PERMISSIONS` (`canViewCustomers`, `canManageCustomerCredit`, `canRecordRepayments`, `canOverrideCreditLimit`).

2. **Storage Engine Integration (`src/services/storage.ts`)**:
   - Add seed customers with realistic balances and credit limits.
   - Add methods: `getCustomers()`, `getCustomerById()`, `saveCustomer()`, `deleteCustomer()`, `getCustomerTransactions()`, `recordCustomerRepayment()`.
   - Update `processSale()` to debit the customer account when `paymentMethod === 'customer_account'`.

3. **Point of Sale Integration (`PointOfSaleView.tsx`)**:
   - Add **Charge Account** tender selector with user icon.
   - Add live customer search input with instant balance badge (`KES 12,500 / Limit KES 30,000`).
   - Implement credit limit validation logic and Manager PIN override dialog.
   - Include customer account balance summary in thermal receipt output.

4. **Customer Directory View (`CustomerDirectoryView.tsx`)**:
   - Build high-density customer table with search, filter tabs, and debt statistics.
   - Build customer statement drawer showing chronological invoices and repayments.
   - Build **Record Repayment Modal** with instant receipt printing.
   - Build **Add/Edit Customer Modal** with credit limit configuration.

5. **AppShell & Routing Integration (`AppShell.tsx`, `App.tsx`)**:
   - Add `customers` navigation item with `Users` icon.
   - Register view in `App.tsx` and wire tenant and RBAC synchronization.

6. **Verification & Quality Checks**:
   - Test build compilation and lint checks.
   - Test credit limit breach and manager PIN override flow.
   - Test repayment recording and balance calculation.
