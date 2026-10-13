# Accounting and financial integrity specification

## Accounting policy
Double-entry general ledger from inception; balanced journal entries by currency; immutable posted entries and controlled reversing/adjusting entries. Chart of accounts configurable with template for small Kenyan hospitality/retail operators. Distinguish payment collection, accounts receivable/payable, revenue recognition, COGS, inventory asset, tax liability, customer deposits, discounts, refunds and cash drawer movement.

## Example events
Cash sale KES 1,700 inclusive tax: Dr Cash KES gross; Cr Sales Revenue net; Cr Tax Payable appropriate amount as determined by configured tax policy. Simultaneously Dr COGS and Cr Inventory at recorded actual cost. **Never hardcode tax rate**; tax classification and invoice rules must be verified per business and effective date. Credit sale uses Accounts Receivable rather than cash. Hotel advance deposit posts Cash vs Customer Deposit Liability until earned or policy-defined recognition. Supplier purchase: receive inventory against AP/GRNI as policy dictates; supplier payment Dr AP / Cr Cash or Bank, not an operating expense at payment time.

## Financial subledgers
Payment transactions and allocations, tills, cash paid in/out, supplier liabilities, guest bill charges, customer credit, stock cost evidence, expenses, asset depreciation. Each subledger event references a journal source ID unique within tenant. Close process calculates trial balance and reconciles to operational sources.

## Period controls
Period states `OPEN`, `CLOSING`, `CLOSED`; closed period rejects ordinary backdated postings. Approved adjustment routes have explicit effective date, audit and posting policy. Trial balance must be zero difference, unmatched receipts and provider transactions flagged, cash shift difference explained. No silent rewrite of prior invoice or receipt.

## Reports
P&L includes recognized revenue, returns, discounts, COGS, gross profit, payroll/accrual/expenses, depreciation, finance costs, applicable taxes depending on statement. Financial position statement only once complete account coverage is operational. Every figure drill-through to original journal entries. Incomplete data produces "partial operating summary" not "net profit". Tax/eTIMS compliance is a separately verified integration project, never claimed by generic receipt generation.

## Invariants/tests
Every posted journal balances; double refund can't exceed original remaining reversible amount; payment allocation cannot exceed cleared/confirmed tender; negative cash from counted drawer requires explicit policy; no period close with unexplained imbalance; duplicate provider callback creates one settlement; historical sale margins use cost snapshot; deposit is liability until earned.
