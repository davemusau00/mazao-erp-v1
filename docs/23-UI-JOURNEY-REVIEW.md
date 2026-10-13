# UI journey review and implementation gates

This review compares the current hybrid UI with the v1 workflows in the product, commerce/inventory, hospitality, reporting and acceptance specifications. It is a source review, not operator research or production acceptance.

## Current environment boundary

The repository contains a React/Vite PWA, a browser-local `StorageEngine`, and a partial Fastify/PostgreSQL API. Authenticated server workflows cover item setup, delivery receiving, cash sales/refunds, shifts, and an initial hotel room/reservation/stay lifecycle. Other modules remain local previews and are hidden while signed in. The IndexedDB command journal retains unknown command outcomes; it does not provide offline command execution or remote synchronization. There is no payment provider, outbox worker, or verified hardware authority.

## Findings addressed in the UI and integration continuation

- `src/utils/decimal.ts` exists and the local prototype routes are rendered. `ManageWorkspace` receives its navigation callback.
- Local folio checkout requires entered settlement to cover the balance. It remains a demo flow and does not support approved balances or provider confirmation.
- Reconnecting the local network no longer marks outbox records synchronized. Local records are identified as browser-local.
- Browser storage write failures are surfaced where handled, but localStorage writes are not atomic and do not provide durable financial storage.
- Local full refunds reject repeated attempts and missing reasons and create separate revenue/VAT reversal records. They do not submit provider refunds or create a production-authoritative journal.
- The ledger no longer claims trial-balance verification or invents operating-bank data.
- Signed-in POS no longer falls through to local sale processing when the server catalog fails. Server checkout is disabled until catalog and shift state are loaded.
- Server-mode navigation hides local-only customer, kitchen, stock-count, report, management and onboarding workflows.
- Authenticated UI permissions now come from the server session contract; catalog and sales history omit cost fields from unauthorized projections. Production API startup requires an exact `APP_ORIGINS` allowlist.

## Role journey map

| Role | Intended journey | Current UI coverage | Blocking gaps before operational use |
|---|---|---|---|
| Administrator | Business/outlet setup, capabilities/tax, imports, staff/devices, first shift and readiness | Local setup preview; server item setup and connected commands | Server-mode setup and Manage are hidden. No account provisioning, outlet/device administration, tax-policy review, imports or go-live command. |
| Cashier | Open shift, basket, split tender, recovery, receipt/history, refund and close | Server cash sale, unknown-command recovery, history and cash-up; local receipt preview | Only one cash tender is confirmed. No provider/split tender, immutable receipt document or complete drawer reconciliation. PostgreSQL/browser acceptance is pending. |
| Storekeeper | Delivery, package conversion, receipt, count, variance review and movements | Server item setup, reviewed receipt and movement history; local count preview | No package conversion, barcode resolution, count session, blind count or approved variance command. |
| Waiter/cook/bartender | Table, order, fire/routing, station progress and settlement | Local tables and kitchen preview | Hidden in server mode. No persistent table/order/ticket commands, station routing, recipe consumption or settlement link. |
| Receptionist | Availability, reservation/walk-in, check-in, guest bill/deposit and checkout | Server rooms, reservations, check-in and booked-night cash checkout | No deposits, ancillary folio charges, split payment, approved balance, early checkout or complete statement. Database acceptance remains pending. |
| Housekeeper | Dirty, cleaning, inspection, ready and maintenance hold | Server dirty-room list and mark-ready command | No cleaning-start/inspection workflow or maintenance controls. Event history is not yet reviewed in an operator workflow. |
| Accountant/owner/manager | Cash-up, exceptions, reports and drill-through | Server shift cash-up; report/ledger preview only when not signed in | Reports are hidden in server mode. No authoritative ledger/report query, completeness/freshness metadata, period controls or full drill-through. COGS still uses mutable catalog cost. |

## Critical slice acceptance criteria

### Cash sale and shift close

- [ ] Validate quantity and tax policy at the server and preserve integer minor-unit totals.
- [ ] Submit one stable command ID; exact retry returns the same canonical response and does not repeat mutation.
- [ ] Support split tenders that equal the due amount; distinguish cash, provider-confirmed payment, unverified references and customer/guest balance.
- [ ] Keep basket and command reference available on rejection, unknown and conflict outcomes. Unknown outcomes support status and activity review without a new payment.
- [ ] Create receipts from confirmed server data; printer completion does not become payment authority.
- [ ] Cash-up records authoritative shift version, counted cash, variance, actor, time and reason; replay cannot close twice.
- [ ] Refunds are linked reversals with policy/permission checks and a source receipt.

### Stock receiving and count

- [ ] Preview package conversion and exact minor-unit extension before posting a receipt.
- [ ] Persist count drafts across restart and route unknown barcodes to resolution.
- [ ] Count review captures baseline revision, location, quantities and variance reasons.
- [ ] One atomic command records before/after movement evidence; concurrent sale/count returns a recoverable conflict.

### Hotel and restaurant

- [ ] Availability and reservation confirmation are separate; overlapping reservations are race-safe.
- [ ] Check-in creates a stay and open folio atomically; deposits and earned charges remain distinct.
- [ ] Checkout shows charges, payments, refunds and balance, then closes the folio/stay and marks cleaning state in one controlled workflow.
- [ ] Table order and station ticket submission are idempotent; stock consumption follows an explicit domain event.
- [ ] Local preview never appears as a confirmed reservation, stay or kitchen ticket before service confirmation.

## Service integration contract

`src/services/apiClient.ts` implements the authenticated HTTP boundary and IndexedDB command journal. `apps/api/src/contracts.ts` and the command dispatcher define protocol version 1, server-derived actor/tenant authority, server-issued role permissions, expected versions, idempotent outcomes and status lookup for connected workflows. Contracts are not generated from a shared package; payloads are runtime-validated in domain code, permissions remain coarse role maps, and the server does not replay offline commands. Money crosses server boundaries as integer minor units and quantities as decimal strings. Local storage remains a distinct preview authority. The exhaustive screen-to-client-to-route-to-command map is in [the backend integration register](24-BACKEND-INTEGRATION.md).

## Reporting and data coverage

The local preview reports scope records to the selected tenant, exclude refunded records from sales totals, and use configured time zones for calendar grouping. These views are hidden in server mode because there are no authoritative report queries or coverage contracts. Local COGS and margin are estimates from mutable item cost fields, not historical cost snapshots or complete accounting statements.

- [ ] Add permission-scoped report queries with a reproducible calculation version.
- [ ] Show business-date range, outlet scope, `asOf`, source count, completeness/partial/unavailable state, exclusions and currency.
- [ ] Drill every total through to source records and reconcile control totals before labeling financial statements complete.
- [ ] Add refunds, tenders, shifts/variances, purchases, inventory valuation, room occupancy/balances, P&L and trial balance only when source datasets exist.

## Responsive and accessibility review record

The stylesheet includes mobile navigation, short-height desktop rules, 44px controls in key paths, reduced-motion handling and a higher-contrast preference override. These observations are not a completed viewport or assistive-technology review.

| Viewport/input | Status | Required evidence |
|---|---|---|
| 1024×600 | Not manually verified | POS basket/payment action, dialogs and shift close without clipping. |
| 1280×720 and 1280×800 | Not manually verified | POS, service floor, table and modal layouts. |
| 800×1280 | Not manually verified | Tablet navigation, forms, tables and actions. |
| 1366×768 and 1920×1080 | Not manually verified | Management/report density, focus order and content width. |
| 390×844 | Not manually verified | Mobile navigation, checkout, dialogs, long labels and primary actions. |
| Keyboard/screen reader | Not manually verified | Focus, labels, dialog escape behavior, chart descriptions and live outcome announcements. |
| Touch/scanner | Not hardware verified | 44px targets, scan focus/recovery and duplicate/unknown scan behavior. |
| Reduced motion/high contrast | CSS support present; not manually verified | Contrast and motion checks across critical journeys. |

## Execution order

1. Keep the current P0 source fixes and PostgreSQL CI acceptance together: fresh migrations, authenticated catalog read, exact command replay and overlapping reservation contention.
2. Complete cashier/shift acceptance for rejected and unknown outcomes, split/provider tenders, immutable receipts, refunds and drawer reconciliation.
3. Add stock counts/transfers/cost layers, restaurant tickets and customer-account services as separate transactional slices.
4. Complete hotel deposits, folio charges, payment and actual-night policy before calling the hotel lifecycle complete.
5. Build reports from authoritative records, then review viewport, keyboard, touch/scanner and screen-reader behavior on connected journeys.

No live tenant, production database, payment provider, physical device, production deployment or operator research was used for this review. See [Backend integration register](24-BACKEND-INTEGRATION.md) for route, command and module status.
