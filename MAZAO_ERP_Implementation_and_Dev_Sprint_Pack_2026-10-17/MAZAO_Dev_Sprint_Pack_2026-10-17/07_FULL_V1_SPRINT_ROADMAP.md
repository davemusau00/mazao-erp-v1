# MAZAO ERP | Full-v1 build-out sequence after the hardening release

**Planning assumption:** one experienced developer coordinating Codex agents, with access to a separate tester/pilot operator. Effort bands are **rough developer working days excluding waiting for production acceptance**, not promises or completion percentages. Parallel work is allowed only when contracts and migrations are isolated; finance, stock and auth tests must still converge on a single integration SHA.

## Delivery milestones

- **M0: Secure/stable pilot**: CI, recovery security, configuration, no endless loaders, working operator provisioning. Can be released without expanding feature scope.
- **M1: Online counter beta**: complete cash/M-Pesa manual/split tender, catalogue corrections, cash controls and basic reports for real retail checkout.
- **M2: Controlled stock and purchasing**: exact inventory valuation, packages, sealed/open policy, wastage/transfer and supplier payable cycle.
- **M3: Restaurant + hospitality operating beta**: kitchen/bar service lifecycle, hotel deposits/folios/checkout and guest accounting.
- **M4: Finance and multi-outlet**: period close, reconciled statements, outlet separation and role administration.
- **M5: Offline/hardware full-v1**: bounded offline authority and sync, physical print/scanner acceptance, durability/security/performance signoff.

## Dependency-ordered backlog

| Sprint | Scope | Indicative effort | Operator outcome / acceptance |
|---|---|---:|---|
| S00–S04 | PR #18 CI + authorization + loading + assets + staff | 7–18 dev days | M0 secure/stable, non-destructive new release |
| S05 | Manual M-Pesa, split tender, payment evidence/recovery | 5–10 dev days | Cash + M-Pesa payments sum exactly to sale; settled receipts |
| S06 | POS corrections: hold/resume, controlled discounts, void/refund, cash reconciliation | 5–12 | Full counter shift, exceptions journaled, no duplicate settlement |
| S07 | Catalogue edit/archive, categories, packages/conversions, barcode correctness | 6–12 | Operator can maintain real product catalogue without database tools |
| S08 | Stock transfers, adjustments/waste, spot counts, sealed/open units, valuations | 8–15 | Physical stock and carrying values reconcile with movements and journals |
| S09 | Suppliers, PO, receipts, invoices, AP partial payments | 8–15 | Supplier order→receipt→invoice→payment controls balanced |
| S10 | Restaurant tables/tabs, tickets, kitchen/bar execution, recipes and settlements | 10–20 | Open table→fire→prepare→serve→split/close, stock and tax posted once |
| S11 | Hotel rates, deposits, folios, partial/early/late checkout, housekeeping | 10–20 | Reservation→deposit→stay→service charges→settle→clean |
| S12 | Customers/AR aging and finance COA, expenses, periods and statements | 8–18 | P&L/balance/reporting source-reconciled and period locked |
| S13 | Multi-outlet/location operational authority and scoped transfers | 6–12 | User selects authorized location; documents never cross scope |
| S14 | Offline grants, bounded operations, sync/replay/queues, conflict controls | 15–30 | Interrupted/offline operations replay exactly once; exposure caps |
| S15 | Printer/scanner/device profiles, installed-PWA upgrade, full acceptance | 8–16 | Physical printer/scanner testing, 7 viewports, adversarial load and recovery |

**Delivery caution:** Full retail/restaurant/hotel/offline v1 is months of engineering/testing, not a few remaining CSS changes. This roadmap preserves the requested full PRD scope while letting M0/M1 ship sooner.

## Vertical sprint contract (repeat for S05–S15)

Every completed feature must have:

1. **Real connected UI** in the existing MAZAO design and feature registry, with permission-correct discovery and no endless loading.
2. **Server schema and API contracts** with typed versioned envelope/response validation, limits and scoped selectors.
3. **Tenant/outlet/user/role/capability authorization**, both for read and command execution/recovery.
4. **Transactional source of truth** with accurate money, quantity/unit arithmetic, idempotency, audit/outbox and source-linked accounting.
5. **Read models/reports** using authoritative posted evidence, no local demo projections.
6. **API/PostgreSQL and Playwright** fresh-upgrade tests, 401/403/conflict/lost-response, replays, simultaneous operators, mobile/desktop.
7. **Upgrade-safe migration**, off-host backup and exact SHA release gate.

## S05: Manual M-Pesa and split tender

- Model explicit payment `method`, `reference`, amount/currency, collector, timestamp and confirmed-by operator. Manual M-Pesa is **verified operator evidence**, not automatic Safaricom API confirmation.
- Validate tender totals, change, partial/outstanding balance policy, overpayment, rejection and idempotent retries.
- Link tender to original order, immutable receipt, cash vs noncash reconciliation and Z report. Ensure no cash drawer increase from M-Pesa.
- Add noncash reversal/approval process only with complete reversing entries; never edit posted payment rows in place.
- Negative: reused M-Pesa receipt/reference if policy forbids, forged reference, double submit, stale shift, session revoked, delayed outcome.
- **Done:** sold cash+manual M-Pesa basket matches journal/cash-up, no double posting after reload.

## S06: Sales operator corrections

- Persisted held carts/tabs with owner/shift/outlet versions and bounded expiration; lock stock policy explicitly.
- Discount authorization matrix, allowed ranges, snapshot of pre/post tax, immutable adjustments; void before settle vs linked refund after settle.
- Safe linked refunds across payment methods, remaining refundable cap and stock re-entry policy; approval records and audit.
- Daily exception report: voids, discounts, reversals, cash mismatch and missing settlement evidence.

## S07: Catalogue identities and packages

- Direct product edit, archive and search; barcode collisions and SKU identity rules; category master and import parity.
- Base units, package units, conversion exactness (e.g. sealed bottle to millilitres) and unit costs; forbid floats for valued base quantities.
- Package barcode lookup must resolve to correct quantity/base-unit and not accidentally double-consume inventory.
- Version-conflict/repricing safety; existing historical sale snapshots unchanged after archive or edits.

## S08: Inventory movement correctness

- Source-typed receiving, waste, transfer, variance and sale consumption, each one posted command and journal evidence.
- Physical vs reserved vs pending offline vs available model. Do not claim pending offline stock is already authoritative without reconciled ledger.
- Transfers have source/destination acknowledgement/receivable liability policy; no duplicate stock across locations.
- Saved full count and spot/blind counts handle legitimate conflicts after live sales; preserve human physical quantities. **Never use opening product import to overwrite existing stock or the user's 74-item unposted count.**
- Sealed/open containers: conversion creates equivalent base quantity under linked stock ID, valuation conserved. Sales by shot consume accurate millilitres.

## S09: Procurement and accounts payable

- Supplier master and identities; PO numbers and approval thresholds; matched receipts to ordered quantities; landed cost tax allocation.
- Supplier invoice duplicate detection, partial payment, liabilities aging and credit/return adjustments.
- Financial postings: inventory/accrual/AP/cash; proper separation of goods received not invoiced, invoice received and paid.
- Full link PO → delivery → invoice → payment, never a supplier free-text field alone.

## S10: Restaurant operations

- Real authorization for waiter/cook/bartender **only when their server-backed commands exist**.
- Table layout, seat/tab, modifications and fire events to kitchen/bar stations; durable tickets with state transitions.
- Recipe/BOM and yield depletion, sealed/open and waste handling, priced modifiers, splitting and transfers with privilege guard.
- Persist exactly one settlement per bill; reconcilable kitchen/bar completion and guest charge transfers.

## S11: Hotel lifecycle

- Room categories, seasons/rate plans, quote snapshots, inventory availability, reservation collision policy.
- Deposits as a **liability** before revenue recognition; folio line items, restaurant-to-room charge, partial/mixed tenders and refunds.
- Extensions, moves, early/late departure, actual-night policy, guest credit/balances, housekeeping inspection/holds.
- Back-to-back reservations, timezone-safe calendar dates and idempotent checkout.

## S12: Finance/AR/reporting

- Coherent chart of accounts and transaction-source mappings; expense capture, AP, deposits, asset/accrual accounting.
- Period-close gate with late posting denial or authorized adjustments; lock and reconciliation snapshots.
- P&L, balance sheet, trial balance, cash summary, VAT and source drilldown with exports; revenue/COGS matching and stock valuation.
- Aging/AR customer evidence and supplier AP aging and control-account checks. Every report is traceable to posted source transactions.

## S13: Multi-outlet authority

- Tenant → outlet → location hierarchy, persistent outlet selection, scoped users/devices/roles, global vs outlet catalogue policy.
- Inventory transfer two-sided exactly-once acceptance; no cross-outlet stock pooling without explicit business rules.
- Cross-outlet financial and operational report aggregation with scoped access; isolated race and permission tests.

## S14: Offline-first operations

- Time-bounded, cryptographically bound actor/device grants with scope, quantity/payment exposure caps and revocation TTL.
- Local drafts/projections vs durable accepted offline commands clearly distinguished; no fantasy stock numbers.
- Ordered, idempotent replay; monotonic server cursors/change feed; conflict resolution/fencing, quota/eviction, restart/migration recovery and dead-letter records.
- Reconnect and revalidation cannot settle a sale twice; unsynced value/status visibly reconciles after disruption.
- Signed acceptance: at least **100 permitted offline sales** with repeated replay, restart, conflict and malicious actor test fixtures.

## S15: Physical acceptance and release quality

- Browser printing/80mm receipt and printer profiles; if bridge/agent selected, document local trust, queue acknowledgment and copy semantics.
- Real scanner/barcodes, thermal cut margins, reprint identity, network drops, browser/PWA update and multiple terminals.
- Accessibility: keyboard order, reduced motion, contrast, screen readers, seven PRD viewports; role-specific end-to-end journeys.
- Disaster drill: bad upgrade roll back API/PWA, recover DB from off-host encrypted backup in **disposable destination**, verify data and exact command statuses.

## Parallelization rules for Codex

- Security/contracts lead defines request envelopes and schema; finance lead reviews journal effects before domain merge; UI lead waits for typed response fixtures; QA lead builds adversarial tests in parallel.
- Do not run multiple agent branches that independently allocate the same migration number or change `commands.ts` without a coordination merge plan.
- Merge small vertical PRs into a protected integration branch, run full suites after each merge, and promote immutable tested artifact only at milestone gates.

## What to defer explicitly

Automated M-Pesa/Daraja, eTIMS fiscal integrations, loyalty, reseller SaaS billing, public booking engine, advanced payroll, generative AI insights and native business apps can remain outside v1. This does **not** defer manual payment confirmation, restaurant service, hotel accounting, basic full reports or bounded offline operations, which the repository completion register still counts as required.
