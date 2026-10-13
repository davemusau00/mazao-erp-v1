# UI journey review and next implementation gates

This review records the current local-preview UI against the v1 workflows in the PRD, commerce/inventory specification, hospitality specification, reporting specification, and acceptance matrix. It is a source inspection, not an operator research sign-off or production acceptance.

## Current environment boundary

The repository contains a React/Vite PWA and a browser-local `StorageEngine` backed by `localStorage`. It has no authenticated HTTP API, shared database, server authorization, durable command status endpoint, or production provider integration. `src/types/ui.ts` defines intended application-service contracts, but no implementation is connected. The existing offline switch and sync queue are simulations. Local success therefore means only that the preview updated browser state.

## Role journey map

| Role | Documented journey | Current UI coverage | Blocking gaps before operational use |
| --- | --- | --- | --- |
| Administrator | Business/outlet → capabilities/tax → item import → staff/device setup → first shift/sale → readiness | Onboarding checklist; Manage screens | Setup and import are not persisted/applied; no account provisioning, outlet/device authority, reviewed tax policy or go-live command. |
| Cashier | Open shift → basket → split tender → recovery → receipt/history → refund → close shift | POS, sales history/return preview, shifts, receipt dialog | POS has one payment method per order; payment is a local synchronous write; retry/unknown outcome and split allocation are absent; shift and till are local demo state. |
| Storekeeper | Delivery → package conversion → stock receipt → durable count → variance review → movement history | Stock, purchasing and count preview | Purchasing/count drafts are page-only; receiving preview does not create a movement; no location/version concurrency, unknown barcode resolution, package conversion or approved count command. |
| Waiter / cook / bartender | Table → order → fire/routing → station progress → settlement | Table and kitchen interaction preview | Tickets and statuses remain in component memory; no durable order, exactly-once send, station routing, recipe consumption boundary or settlement link. |
| Receptionist | Availability → reservation/walk-in → check-in → guest bill/deposit → checkout | Room operations and reservation preview | Reservation availability is a local snapshot; no hold/expiry or overlap lock; payment/deposit, charge posting, final settlement and checkout authority need services. |
| Housekeeper | Dirty → cleaning → inspected → ready; maintenance block | Room operations status controls | Local state only; inspection actor/evidence, maintenance controls and durable task history are absent. |
| Accountant / owner / manager | Cash-up → exception review → accurate reports → drill through to source | Shift audit, ledger and analytics screens | Ledger/report data is demo state; COGS is estimated from current catalog costs; there is no report query authority, source coverage API, period control or complete drill-through. |

## Critical slice acceptance criteria

### Cash sale and shift close

- [ ] Build a basket, validate quantities and tenant/outlet tax policy, and preserve integer minor-unit totals.
- [ ] Submit one stable command ID; a retry reuses that ID and returns the original outcome.
- [ ] Support split tender allocations whose sum equals the amount due; distinguish cash, provider-confirmed payment, unverified manual reference, and customer/guest balance.
- [ ] Keep the basket and command reference available on rejected, unknown, and conflict outcomes. Unknown outcome supports status check and activity review without generating a new payment.
- [ ] Produce a receipt from confirmed sale data; printer/spool completion does not become payment authority.
- [ ] Cash-up uses the authoritative shift version and records counted cash, variance, actor, time, and reason; exact replay cannot close twice.
- [ ] Refund is a linked reversal with policy/permission checks and a source receipt.

### Stock receiving and count

- [ ] Enter package quantity and package unit cost, preview normalized base quantity and exact minor-unit extension, then approve a receipt command.
- [ ] Count draft survives restart in a durable draft store; unknown barcodes enter a resolution queue.
- [ ] Count review requires baseline revision, location, all quantities and reasons for variances.
- [ ] One atomic command records immutable before/after movement evidence; concurrent sale/count returns a conflict with a recovery path.

### Hotel and restaurant

- [ ] Availability and reservation creation are separate; reservation creation uses a time-bounded hold and overlap-safe server command.
- [ ] Check-in creates a stay and guest bill atomically; deposits and charges remain distinguishable.
- [ ] Checkout shows charges, payments, refunds, and outstanding balance, then records closure and cleaning status as one controlled workflow.
- [ ] Table order submission and station ticket delivery are idempotent; item firing and stock consumption follow an explicit domain event.
- [ ] Room or table preview never appears as a confirmed reservation, stay, or kitchen ticket before service confirmation.

## Service integration contract gate

`src/types/ui.ts` contains the preliminary `V1ApplicationServices` interface. Before connecting financial, stock, reservation, or room actions, the contract package must define a validated versioned command envelope with tenant/outlet/operator/device context, stable command ID, expected entity versions, authorization, offline policy, structured rejection/conflict/unknown results, and status lookup. Money values must be integer minor units with safe-range validation; quantities remain decimal strings. Domain implementation, persistence, API authorization, idempotency, audit, and integration/negative tests are not present in this UI repository, so a local adapter must not masquerade as that service.

## Reporting corrections and gates

The reports view now scopes records to the selected active tenant, excludes refunded records from sales totals, and uses configured outlet time zone for calendar grouping. Cross-tenant consolidation is removed because the preview does not define currency conversion or tenant data coverage. Sales counts and stock rows remain local snapshot data. COGS and margin are estimates from stored item cost fields, not verified historical cost snapshots or posted accounting results.

- [ ] Replace preview calculations with a permission-scoped report query and a reproducible calculation version.
- [ ] Show half-open local-business-date range, outlet scope, `asOf`, source count, completeness/partial/unavailable status, exclusions, and currency.
- [ ] Drill from each total to its source records and reconcile control totals before labeling financial statements complete.
- [ ] Add refunds, tenders, shifts/variances, purchases, inventory valuation, room occupancy/balances, P&L and trial balance only when their source datasets exist.

## Responsive and accessibility review record

The stylesheet includes mobile navigation, a short-height desktop rule, 44px POS/dialog controls in key paths, reduced-motion handling, and a higher-contrast preference override. These are implementation observations, not a completed visual or assistive-technology review.

| Viewport / input | Status | Required evidence |
| --- | --- | --- |
| 1024×600 | Not manually verified | POS basket/payment CTA, dialogs and shift close remain reachable without clipping. |
| 1280×720, 1280×800 | Not manually verified | POS, service floor, tables and modal layouts. |
| 800×1280 | Not manually verified | Tablet portrait navigation, forms, tables and action placement. |
| 1366×768, 1920×1080 | Not manually verified | Management/report density, focus order and readable content width. |
| 390×844 | Not manually verified | Bottom navigation, mobile checkout, dialogs, long labels and primary actions. |
| Keyboard / screen reader | Not manually verified | Skip-to-main focus, labels, dialog focus/escape, chart descriptions, live outcome announcements. |
| Touch / scanner | Not hardware verified | 44px hit targets, scan focus/recovery, duplicate/unknown scan behavior. |
| Reduced motion / high contrast | CSS support present; not manually verified | Contrast measurements and motion preference review across critical states. |

## Execution order

1. Close the gaps in one end-to-end online cashier sale and shift-close slice, including split tender and unknown-outcome recovery.
2. Add stock receiving and reviewed count as a separate vertical slice with concurrency and movement evidence.
3. Add reservation/check-in/checkout and restaurant ticket slices against their domain services.
4. Build reports from those authoritative records, then complete the viewport and accessibility review on the connected journeys.

No live tenant, physical device, provider, production database, or operator research was used for this review.
