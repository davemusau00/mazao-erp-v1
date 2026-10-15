# MAZAO ERP V1: Original UI Restoration and Server-Authority Integration

**Status:** Implementation-ready development specification; not implemented by this document.  
**Repository:** `davemusau00/mazao-erp-v1`  
**Audited baseline:** `df1007d9682eed211f7faf4cd71d6fcd54e4f869`, 2026-10-14.  
**Intended release:** A sequence of reviewable pull requests. No automatic production deployment.  
**Product directive:** Preserve the established Mazao visual design, navigation, component density and task flows. Connect supported actions to the authenticated Fastify/PostgreSQL system. Keep the *entire product information architecture visible* to appropriately scoped users, with unimplemented functions unmistakably inactive. Never restore browser-local financial authority or simulated data to signed-in sessions.

## 0. Immediate rules of engagement

1. **Do not redesign Mazao from scratch.** The approved visual reference is the existing local-preview components and the user-supplied screenshots. The original color/tokens, cards, dense tables, typography, side navigation, metric blocks, 80mm-style receipt and operator-oriented flows are the product design language.
2. **Do not substitute simpler new workspaces merely to connect APIs.** Extract pure presentation elements and build adapters/view models. Functional correctness and visual fidelity must both pass.
3. **Do not import `src/services/storage.ts` or its locally seeded data into the authenticated entry graph.** Reuse styles, icons, visual markup, interaction patterns and empty-state copy from the original components, *not* their authority.
4. **Show unfinished functionality but make its status unmistakable.** Visible `Not connected` cards or subpanels may explain the intended flow, but cannot create/edit/print purported confirmed transactions, submit simulated commands, mutate demo data, or imply server synchronization.
5. **Preserve authorization.** UI availability must derive from the current session and server-read capability/permission contracts. Visibility for discoverability is not a permission grant. Do not expose customer, supplier or private staff data without authorized reads.
6. **Keep the backend stable.** Preserve monetary minor-unit strings, decimal quantities, tax/COGS snapshots, immutable journals, versioned commands, idempotency, command-status recovery, CSRF, tenant/outlet scope and migrations.
7. **No false metrics.** Every displayed financial amount must be from scoped server records, reproducible formulae and explicit data coverage. Missing metrics render `Not available yet`, not zero, made-up values, or an unqualified profit figure.
8. **Each milestone includes tests, visual screenshots, diff review and scope documentation.** Existing tests must stay green. Do not deploy any UI-restoration PR to the shared production host without an explicitly approved release gate and a verified off-host restore.

## 1. Verified baseline and rationale

The original design's classes and CSS tokens remain in `src/index.css`, including `.manage-grid`, `.manage-card`, `.settings-profile-card`, `.count-session-*`, `.summary-metric`, `.workspace-nav`, and typography/surface variables. However, `src/App.tsx` imports and mounts the `Backend*` replacements. Original pages remain in the repository but are no longer part of the authenticated runtime:

| Original design reference | Active server page | Restoration task |
|---|---|---|
| `src/components/customers/CustomerDirectoryView.tsx` | `BackendCustomerWorkspace.tsx` | Rich metrics + customer table + segment filters + modal presentation powered by `GET /customers`, `GET /customers/:id/statement` and commands |
| `src/components/analytics/AnalyticsView.tsx` | `BackendFinancialReportsWorkspace.tsx` | Dashboard cards/charts + truthful period/source coverage, server-derived revenue and COGS; keep accounting pages intact |
| `src/components/inventory/StockCountWorkspace.tsx` | `BackendStockCountWorkspace.tsx` | Scan-first search/suggestion/count/variance UX mapped to persisted full-outlet counts; preserve full-count server policy |
| `src/components/manage/ManageWorkspace.tsx` | `BackendManageWorkspace.tsx` | Administration overview grid with all original cards, connected vs unavailable status, working business/outlet/import/capability links |
| `src/components/sync/SyncCenterModal.tsx` | A command recovery alert in `AppShell.tsx` | Real command recovery center using IndexedDB unresolved command IDs + server status; future offline controls visibly disabled |
| `src/components/hardware/ReceiptModal.tsx` | `BackendReceiptModal.tsx` | Styling/80mm typography and logo/footer parity using server receipt snapshots; do not fake printing confirmation |
| Original `src/components/layout/AppShell.tsx` layout | Server-only `AppShell.tsx` | Preserve original navigation tree and statuses; forbidden/unavailable routes must not mount executable screens |

The server currently supports confirmed cash and full customer-account checkout, customer credit/repayment, receiving, reviewed full-outlet count, basic hotel lifecycle, business configuration, CSV product import, cash close report, trial balance, partial operating summary, journal drill-down, and browser receipt view. It does not yet support server restaurant tickets, supplier/AP lifecycle, package conversions, full offline POS synchronization, full financial accounts, staff/device management, or paired-printer acknowledgment.

**Current production caution:** The prior deployment evidence is documented through a lower commit, with later CSV activation described in an open documentation PR. Do not assume the audited `main` SHA equals the active VPS SHA. The post-release encrypted backup restore exception remains open and is not resolved by UI work.

## 2. Architecture: Presentation preserved, authority replaced

### 2.1 Module boundaries

Organize components as follows (target architecture, not a demand for wholesale file relocation):

```
src/
  app/
    feature-registry.ts             # declarative visual navigation and capability states
    use-feature-availability.ts     # derives runtime action states from session and API
  components/
    design/                         # extracted original cards/tables/headers/metric/charts/styles
      MetricCard.tsx
      WorkspaceStatus.tsx
      DataCoverageNotice.tsx
      DenseDataTable.tsx
      FeatureCard.tsx
      EmptyUnavailablePanel.tsx
    customers/
      CustomerDirectoryPresentation.tsx
      BackendCustomerWorkspace.tsx   # queries/actions/unknown-result recovery
    inventory/
      StockCountPresentation.tsx
      BackendStockCountWorkspace.tsx
    analytics/
      OperationsOverviewPresentation.tsx
      BackendOperationsOverview.tsx  # new authoritative read model
    manage/
      ManagementHub.tsx
      BackendManageWorkspace.tsx
    sync/
      BackendRecoveryCenter.tsx
  services/
    apiClient.ts                     # only server API for authenticated records
    commandJournal.ts               # unknown-result persistence; NOT offline sync
  index.css                          # preserve approved tokens and existing styles
```

**Dependency direction:** `server query/command -> adapter/view model -> presentation component -> operator`. The presentation layer accepts immutable typed data, status metadata and callbacks. It cannot read `storage`, issue direct fetches, query IndexedDB, or write financial entities. Domain adapters are responsible for error/loading/unknown-result states and permissions. Avoid introducing a second business-logic implementation in React.

Use an adapter pattern rather than merely copying JSX that imports `storage`. Example conceptual interfaces:

```ts
type DataState<T> =
  | { kind: 'loading' }
  | { kind: 'ready'; data: T; refreshedAt: string; coverage: Coverage }
  | { kind: 'empty'; coverage: Coverage }
  | { kind: 'error'; message: string; retry: () => void }
  | { kind: 'unavailable'; reason: string };

type Coverage = {
  origin: 'server';
  tenantId: string;
  outletIds: string[];
  currency: string;
  timeZone: string;
  from?: string;
  to?: string;
  asOf?: string;
  completeness: 'complete' | 'partial' | 'unavailable';
  omissions: string[];
  calculatedAt: string;
  calculationVersion?: number;
};
```

### 2.2 Central feature registry and honest availability states

There must be **one authoritative, typed UI registry** used by sidebar, mobile navigation, management hub, setup, help and feature-specific inactive panels. Do not hardcode available/hidden switches separately in `App.tsx`, `AppShell.tsx`, and the management hub.

```ts
type FeatureState =
  | 'connected'              // Current supported workflow backed by live server data
  | 'partial'                // Some confirmed workflows; other capabilities visibly inactive
  | 'not_connected'          // No backend operation; visual shell/information only
  | 'not_enabled'            // Implemented but disabled in business capabilities
  | 'insufficient_permission'// User lacks role action/read authority
  | 'loading'
  | 'error';

type FeatureDefinition = {
  id: string;
  label: string;
  group: 'work'|'money'|'manage'|'support';
  description: string;
  icon: string;
  requiresCapability?: string;
  minimumReadPermissions?: string[];
  requiredActionPermissions?: string[];
  connectedRoutes?: string[];
  documentation?: string;
  plannedCapabilities?: string[];
};
```

The registry defines feature intent. The **actual session/API** decides whether a connected read or action is permitted. A local registry must never create an authorization bypass. If the server hasn't implemented a feature, show its module tile and safe, non-data explainer; no writable CTA. An implemented but permission-blocked feature should show a limited `Requires access` state only where policy permits discoverability. Never leak tenant resources through decorative previews.

For admin/owner, show *all planned sections* in the management hub and a complete product roadmap in navigation. For operational roles, show all **authorized or broadly discoverable** modules while hiding sensitive destinations and action details. `Tables & kitchen`, `Asset management`, `Staff & devices` and advanced finance can appear with meaningful states without routes that execute mutations.

**Disable semantics:** Prefer `button disabled`, `aria-disabled`, descriptive explanation and nearby `What is missing?` or `Learn about this module` informational link. Avoid clickable cards that silently do nothing. A connected management card can navigate to a live workspace. A partial card opens the connected subset while unsupported sub-actions remain disabled. Do not mark an entire module `Connected` simply because one read endpoint exists.

Do not reintroduce a `Local preview online`, `Sync all`, `Offline sale successful`, or `Printer printed` label in production unless it reflects actual verified authority.

### 2.3 Design parity contract

Preserve or systematically normalize the existing `src/index.css` variables:

- surfaces `--surface-app`, `--surface-sidebar`, `--surface-raised`, `--surface-panel`, `--surface-hover`;
- borders `--border-subtle` and `--border-strong`;
- text `--text-primary`, `--text-secondary`, `--text-muted`;
- accents `--accent`, `--accent-strong`, `--accent-soft`, success/warning/danger;
- fonts `--font-display`, `--font-body`, `--font-mono`;
- density, radius, rhythm, readable contrast, 44px minimum touch targets, focus-visible and reduced motion.

Retain the recognizable left navigation, top operator/business context, original icons, heading/eyebrow hierarchy, compact enterprise data tables, 4-up KPI cards, dark bordered panels, warning/positive numerical treatments, active-state blue, search/scan field, count review sheet, and receipt typography. Do not substitute unrelated component libraries, light theme defaults, or oversized consumer-style cards. Avoid stretching the entire view across ultrawide screens: use adaptive content grids and documented widths.

Use the original UI screenshot reference set for `Customer Directory`, `Sales & Operations Overview`, `Count stock`, `Manage`, `Offline Durability & Conflict Resolution`. The separate SERVEOS screenshot is a capability/operational UX reference, **not** evidence that Mazao has those backend functions and not an instruction to adopt its distinct brand skin.

### 2.4 Cross-cutting UI rules

- **Loading:** Show skeletons with the same shape as the finished cards/tables, not unrelated spinners.
- **Empty:** Show `No server records for this outlet/period` with clear next steps; do not seed business-looking fixtures.
- **Partial:** Show a visible report-coverage notice and omit or disable unsupported numbers.
- **Error:** Keep last clearly labeled successful snapshot only if safe and timestamped; never portray stale data as live. Retry the original GET.
- **Unknown mutation outcome:** Lock the impacted action, retain original command ID/payload, query `/commands/:id`, retry original ID only under established recovery policy. Never create a new command to resolve ambiguity.
- **Unauthorized:** No sensitive data fetch, no action enabled; server must reauthorize.
- **Offline:** Show read-only retained confirmed data only if its provenance and freshness are explicit. No new offline business transaction claims until signed grants + replay exist.
- **Print:** Show browser print dialog status, not device confirmation. Preserve real receipt snapshots and current operator-verified identity.
- **Money:** API minor units; use `BigInt`/precise formatting, tenant currency precision, no floats for accounting aggregates.
- **Quantities:** decimal strings, no silent parseFloat rounding; preserve six-decimal contract.
- **Concurrency:** Re-fetch server revision and require operator re-review after conflicts. No silent overwrite.
- **Accessibility:** Labels, responsive tables, keyboard nav, focus restoration, modal trapping, ARIA live alerts and chart text equivalents.

## 3. Screen-specific implementation requirements

### 3.1 Customer Directory and Credit Accounts: first high-fidelity restoration

**Reference:** `CustomerDirectoryView.tsx`; **container:** `BackendCustomerWorkspace.tsx`.

Preserve from screenshot: heading and five-account badge; four KPI panels (Total Receivables, Approved Credit Line, Credit Utilization, Account Risk & Holds); searchable five/six-column account table; `All / Debtors / Zero balance / Suspended` filters; per-row credit limit/outstanding/available/status/actions; compact customer/contact details; repayment, statement and edit dialogs; responsive small-screen card rows. The screenshot's names/amounts are examples ONLY, never seeded in signed-in mode.

**Authoritative inputs** already include `apiClient.listCustomerAccounts()` and `getCustomerStatement(customerId)`. Use current `customers.account.create`, `customers.account.update`, `customers.repayment` commands and existing unknown-outcome recovery. Typed view model:

```
accounts = authorized GET /customers results;
receivablesMinor = Σ max(0, account.balanceMinor); // ideally server-calculated/verified
approvedLimitMinor = Σ limit for accounts per explicitly documented portfolio rule;
utilization = (receivables / approvedLimit)×100, only if denominator > 0;
openDebtors = count(balance > 0);
suspended = count(status === 'SUSPENDED');
availableCreditMinor = max(0, limit - balance) for active accounts; otherwise 0;
```

Use `BigInt` on minor-unit strings. Define whether suspended limits remain in total credit-capacity KPI, and label it. Never show `KSh 0` as a substitute for unavailable statements. Add server-side pagination/filtering for large tenants before using unbounded client-only full-catalog filtering. Search should include name/phone/email only where permitted. Customer-detail and statement rows must derive from confirmed charges/repayments. Cash repayment requires an authorized active shift. Repayment of debt may remain possible for suspended accounts if the backend permits it. Do not imply that credit refunds, aging, exports or M-Pesa collections are supported; render their tiles/actions inactive and explanatory. The UI must not allow negative availability to appear as an ordinary available balance.

**Acceptance:** KPI arithmetic equals API fixtures and ledger data; unauthorized edit/repay controls cannot act; account save/replay/limit conflict; repayment overpayment guards; reload persistence; 390px table cards; keyboard operation; no `storage.getCustomers()` in authenticated graph.

### 3.2 Operations and sales analytics: restore visual richness without invented finance

**Reference:** `AnalyticsView.tsx`; **active:** `BackendFinancialReportsWorkspace.tsx`.

Keep `Money` as trial balance and journal detail; implement a **separate** `BackendOperationsOverview` inside `Reports` or via `Reports` sub-navigation so operational charts do not replace financial statements. Restore the screenshot's period tabs `Today / Yesterday / Last 7 Days / This Month / All Time`, KPIs, sales-velocity chart, tender chart, top revenue-generating SKUs, stock snapshot, and optional coverage notice. All charts must have accessible textual summaries.

Create **read-only, permission-gated** endpoints rather than calculating authoritative company reports from loose browser data:

- `GET /api/v1/reports/operations/overview?from=&to=&outletId=`: settled sales, refunds, revenue, order counts, average recorded sale, tax, explicit coverage and currency; derive business dates using the outlet's IANA time zone.
- `GET /api/v1/reports/operations/daily-sales?from=&to=&outletId=`: grouped authorized sales/refund values with signed values and deterministic dates.
- `GET /api/v1/reports/operations/tenders?from=&to=&outletId=`: confirmed `CASH` and customer-account charges currently; return absent or unavailable status for unsupported card/M-Pesa. Do not label receivables as collected cash.
- `GET /api/v1/reports/operations/top-products?from=&to=&outletId=&limit=`: net quantity, revenue, refunded quantity, exact realized line COGS where available; net COGS must account for restocked refunds and applicable business rules.
- `GET /api/v1/reports/operations/stock-snapshot?outletId=`: current on-hand / reorder labels / valuation only for cost-authorized roles.

All aggregate SQL must follow tenant/outlet/role scope; ignore or reject caller-submitted tenant/actor IDs. Use order, line, refund and journal snapshots; respect cancelled/refunded status and date boundaries. Include `calculationVersion`, `asOf`, `completeness`, `excludedSources`, and every card's numerator/denominator. If gross profit cannot be reconstructed from settled sales and matching immutable COGS/reversals, show `Estimated / Partial` or `Unavailable` rather than a categorical `Gross Profit` value. `Turnover 4.2x / yr` must remain unavailable until a defensible stock-average and period methodology exists. Missing provider tenders render labeled unconnected rows without nonzero mock proportions.

**Acceptance:** report totals reconcile with individual transactions and journal sources, multi-outlet isolation, cash vs credit, 100% returns, date/time-zone boundaries, export/large-data performance, no fabricated metrics, same chart layout and high-contrast labels.

### 3.3 Count stock: restore scan-first layout without weakening count controls

**Reference:** `StockCountWorkspace.tsx`; **active:** `BackendStockCountWorkspace.tsx`.

Retain screenshot's main title, contextual notice, session card, area label, full-width barcode/search input, product autocomplete suggestions, status line (`N items · counted · differences`), counted-item editor cards, review sheet and primary action placement. **Preserve the actual server lifecycle**: `inventory.count.open`, `.save`, `.post`, `.cancel`, `GET /inventory/counts/current`, `GET /inventory/counts/:id`, list history.

The preview was a selective list of scanned items. The current server opens a full-outlet baseline and **requires all items counted before posting**. A scan can focus/select an item in that *existing full snapshot*, mark it visible and accept its counted quantity; it may not silently redefine the full count into a selective count. Show progress `counted/total`, unfinished rows and a `Finish all items` requirement. Do not substitute browser-local ephemeral drafts for server-saved count sessions.

Base-unit `barcode` already exists in catalog metadata. Implement exact-match lookup from the server-authorized catalog or add barcode to count line read model; normalize scanner `Enter` behavior while preserving leading zeros, case and intentional whitespace rules; handle duplicate, unknown and mismatched barcodes. Never count one scan twice due to event/key repeat. Show a clear `Unknown barcode: not added` state; a future `Resolve unknown barcode` action must remain disabled until its API exists. The `areaLabel` is only descriptive, **not a physically partitioned stock location**; label it `Area note (outlet-wide count)` until inventory locations exist. Do not claim aisle-level accuracy from outlet-wide balance.

Preserve saved count revision, optimistic concurrency and manager approval. Variance reason required when changed. `Save draft` and `Review differences` are independent. `Post adjustments` is disabled until every baseline line is valid and the manager has authority. Show summary of gains, losses, financial carrying value and exact journal evidence after confirmed posting. On conflict, preserve operator entries and guide re-review; do not automatically discard a stale count (the current code reloads on some conflicts and needs a deliberate preservation policy).

**Acceptance:** scanner keyboard flow, exact barcode, multi-item search, count saved/reopened across browser restart, same command replay, full-outlet completeness gate, reason requirement, separate manager approval, concurrent receipt conflict, no alternate local count writes, original scan/search visual parity.

### 3.4 Manage and setup: restore the complete administration catalog

**Reference:** `ManageWorkspace.tsx`; **active:** `BackendManageWorkspace.tsx`.

Default to the original administration **overview card grid**, including all original entries, preserving the established `.settings-profile-card`, `.manage-grid`, `.manage-card`, `.manage-card-icon`, `.not-connected` CSS. Render real tenant/outlet identity from the signed-in session and `GET /configuration`, not preview `TenantProfile` storage.

| Tile | Functional destination today | Visible UI status |
|---|---|---|
| Business and outlets | Server-backed business profile + current outlet | `Partial: connected current-outlet editing; extra outlet create/switch disabled` |
| Staff | No authoritative full CRUD yet | `Not connected`; show staff-management shell and disabled Create/Edit/Suspend |
| Roles and permissions | Fixed server role/session map, no tenant grant editor | `Partial view of current role`; permission editor disabled |
| Devices and printing | Server assignment at bootstrap, browser print dialog | `Not connected` for enroll/revoke/print pairing; explain browser print mode |
| Data import | Stock → reviewed product CSV import | `Connected: CSV`; `XLSX`, packages and variants visibly disabled |
| Assets and maintenance | No server asset register | `Not connected`; show empty module shell without seeded assets |
| Business capabilities | `GET /configuration` and versioned capability command | `Connected` for supported capabilities; restaurant inactive |
| Setup checklist | Configuration readiness data | `Connected limited first-sale checks`; broad sign-off disabled |
| Outlet and receipts | Versioned outlet/receipt settings | `Connected` for text/contact; upload/QR integrations deferred until asset service exists |

The existing `BackendManageWorkspace` has working business/outlet/capability/readiness tabs. Do not delete them. **Wrap them in the overview layout**; clicking connected cards should navigate to these existing forms. When adding `onboarding` navigation, connect it to the real readiness panel, not archived local `OnboardingWorkspace`. `Manage` should still require `config.view/config.manage` and server reads; cards cannot grant privileges.

The independent SERVEOS screenshot suggests useful future UI sections: receipt logo upload, payment QR, API/database readiness, backup status and version. A Mazao settings page may display those headings *only with accurate contracts*. For example, `API/database ready` can use an authorized health projection; `Backup status` is **unavailable** unless the backup service provides timestamp+restore result; `M-Pesa QR` is `Not connected` until durable storage, QR verification, image security and customer payment-evidence policy exist. Do not reuse a fake green status or ServOS' version number.

### 3.5 Offline durability, recovery and conflicts: restore hierarchy, not simulator

**Reference:** `SyncCenterModal.tsx`; **new server UI:** `BackendRecoveryCenter.tsx`.

Preserve the modal hierarchy: title, `Pending commands`, `Review required`, status metrics, activity list, selected action detail, close footer. The real v1 center must show only confirmed browser journal entries retained because the server outcome is unknown (plus safely scoped server status). For each entry show masked command ID, type, timestamp, tenant/outlet/operator reference, local journal state and `Check server status` / `Retry original command` options when safe. If server reports `CONFIRMED`, the center refreshes authoritative read models and clears the unknown state. If rejected/conflict, show the reason and applicable review action. No auto-reissue of a new command ID, no local `synced` toggles.

The preview's `CRDT`, `first-write-wins cascades`, `24 pending local outbox` and simulated network state **are not server synchronization semantics**. Keep future `Offline sales`, `Conflict center`, `Multi-device sync` as visibly inactive modules with accurate explanation. `navigator.onLine` alone cannot prove server reachability; expose `Connected / Offline / Server unavailable / Recovery required` based on real request/readiness evidence and throttled probes where authorized. Never describe `system.outbox` rows as remotely acknowledged because there is no worker.

### 3.6 POS and receipts: same product skin, same money invariants

Retain the original compact product tiles, barcode search, basket, customer selector, payment dialog, receipt typography and keyboard/scanner flow, but all server-mode actions remain command-based. Current backend supports cash and full approved credit sales, VAT/cost journals, cash refunds, server receipt snapshots. Show split tender, M-Pesa, card, guest folio, discounts, voids and held baskets in the relevant visible UI sections **with disabled controls and reason text** until server contracts and provider evidence exist. Never let a disabled tender masquerade as cash or submit a dummy provider reference.

Receipt render must be from `getSaleReceipt`, with immutable tenant/outlet/operator/tax/item/payment snapshots. Use 58/80mm print styles and browser print, label it `Open print dialog`, not `Printed`. Hide/disable paired-printer status and cash-drawer commands until actual device evidence exists. Receipt logo or QR support must include secure validated upload and stored snapshot; never embed arbitrary unsafe URLs, unreadable QR, or auto-generated fake tax invoices. Preserve print-safe fixed typography, responsive screen preview and export.

### 3.7 Shifts and financial reports: faithful layout, proper evidence

The backend has immutable cash-close report data and Z-report-like screen. Preserve original till-count styling and add saved report history, variance state and compact report grid. Do not label a cash-drawer close report as a complete sales/tax/provider Z report until it includes product/tax/tender/void/refund source coverage. Show `Full Z report (not connected)` in the correct location rather than removing it. Improve count-denomination workflow and manager variance approval only after server policies exist.

Separate an **operational dashboard** from accounting reports. Keep trial balance, partial operating summary and journal drilldowns clearly `PARTIAL` where dependencies (AP, expenses, assets, payroll, depreciation, bank/provider settlement) are absent. Do not aggregate gross sales into recognized profit by ignoring credits/refunds.

### 3.8 Hotel, restaurant, procurement, staff, assets and device destinations

Preserve their navigation presence and recognizable page shells. Always show capabilities and actionable subset truthfully:

- **Hotel:** rooms, reservations, basic check-in/checkout and dirty→ready are connected when hospitality enabled and role allows. Deposit liability, ancillary charges, partial folios, room transfers and complex rate policy visibly disabled.
- **Restaurant:** tables, kitchen/bar tickets, modifiers, splits and recipe consumption are `Not connected`; no table can produce a purported server order until contracts exist. Display premium inert table board and flow explainer, not demo orders.
- **Procurement:** connected receiving is available; supplier master, purchase orders, invoices, AP and approval buttons visible but disabled.
- **Staff/devices:** manage overview cards + read-only scoped explanatory shells; staff CRUD and device enrollment remain disabled until secure server commands are accepted. Explicit device/outlet selection and session revocation require a separate credential/security design.
- **Assets:** show asset categories and expected lifecycle but no fake register rows or charts.
- **Multi-outlet:** list existing/current verified outlet where permitted; `Add outlet` and `Switch outlet` inactive until the backend supports assignments and secure selection.
- **Help:** link to each disabled feature's requirement/status and recovery action, without false promises of availability.

## 4. Concrete change list and PR sequence

Never merge all changes into one unreviewable giant PR. All PRs branch from the latest accepted `main`, carry before/after screenshots and tests, and use no prod write operations.

**PR-01: Parity foundation + management hub.** Files: `src/components/layout/AppShell.tsx`, `src/App.tsx`, `src/components/manage/BackendManageWorkspace.tsx`, `src/components/common/*`, `src/index.css`, `src/types/ui.ts`, `e2e/configuration.spec.ts`, new parity tests. Implement feature registry, original admin cards and statuses, connection to working business/outlet/capability/import/checklist forms, disabled staff/assets/devices. Show disabled workspaces in admin navigation. No API migration required. Existing configuration tests must be adapted to click the new Overview → Business card, without removing authorization assertions.

**PR-02: Customers visual parity.** Extract customer table/KPIs/filters/row actions from original view into pure presentation. Retain `BackendCustomerWorkspace` data/command/recovery layer. Use `BigInt` and real balances. Responsive table/cards and actual server permission behavior. No local storage.

**PR-03: Inventory count visual parity.** Preserve durable full-outlet count service. Implement scanner-friendly count presentation/lookup, line highlighting, progress, saved draft/review states, unknown barcode/incomplete count messaging. Extend read model for barcode where necessary, with tenant/role tests.

**PR-04: Operational analytics + source contracts.** New server query endpoints and `BackendOperationsOverview`, preserve original chart/card design, coverage states, output reconciliation, refunds/cost tests, no simulated tenders. Preserve financial-report workspace separately.

**PR-05: Recovery center and support.** Restore visual recovery console wired to actual retained command/status records, offline features visible but disabled. No simulated ack or CRDT claims. Add unknown response and replay acceptance.

**PR-06: POS, receipts, shifts and remaining partial-screen polish.** Restore original visual layout/scan ergonomics while preserving existing settled command and receipt authority. Add visibly disabled tender/discount/device integrations and documented server feature boundaries.

**PR-07: Remaining module shells, shared QA and accessibility.** Hotel, restaurant, AP, staff/devices, assets, setup; visual visibility and accurate feature states, no fabricated business data. Mobile/tablet/desktop, contrast, keyboard, screen-reader and touch/scanner acceptance.

**PR-08+ (separate backend capability deliveries):** Add supplier/AP, full multi-outlet staff/device administration, package conversion, manual M-Pesa evidence, restaurant orders, deposits/folios, offline signed grants/replay, advanced reports. Each new backend capability flips the corresponding registry feature from `Not connected` to `Partial/Connected` only after verification.

## 5. CI and acceptance plan

### 5.1 Permanent non-regression tests

1. **Auth boundary:** No user session => sign-in; restore failures => blocking error/retry; local preview cannot be opened as a production fallback. No imports from `storage.ts` in production entry graph.
2. **Visual navigation:** Owner/admin sees full product catalog, supported and unsupported sections, statuses and correct current business identity. Staff/cashier see only permitted data/actions; unavailable modules do not invoke APIs or mutate records. On mobile, the More panel retains the same statuses.
3. **Customer:** KPI calculations, active/suspended/zero/debtor filters, rendering, statement, repayment, edit/limit conflict, error/empty states, role denials and cross-tenant behavior.
4. **Count:** scanner query, preserved exact barcode, saved full baseline, saved draft after reload, all-lines gate, manager approval, immutable adjustment/replay, concurrent conflict; location label not misrepresented.
5. **Reports:** specified business-date ranges, covered source IDs/counts, refunds, cash vs receivable, chart/table agreement, direct journal drilldown, `PARTIAL` labels and zero/excluded-source behavior.
6. **Recovery:** Unknown command retained after response loss, lookup outcome, original ID retry, no double sale, no local-only queue presented as synchronized.
7. **Data integrity:** No new local preview writes, no synthetic client finance transactions, unauthorized APIs denied, idempotency, migrations, typecheck, API tests and Vite build green.
8. **Disabled flow:** Any `not_connected` affordance must not be clickable or must open only explanatory information; verify no POST to `/commands`, no ledger/stock changes and no stored demo records.
9. **Accessibility:** Keyboard navigation, focus, disable semantics, labels, contrast, screen-reader naming, zoom, motion preferences, dialog trap and dismissal.
10. **Performance:** Avoid unbounded `/orders`, `/customers`, `/inventory/movements` loads; use server pagination/limits for operational scale; measure large outlet table/search under test data.

### 5.2 Visual screenshot approval matrix

Capture and compare at **390×844 mobile; 800×1280 tablet; 1024×600 compact terminal; 1280×720 and 1280×800 desktop; 1366×768 laptop; 1920×1080 wide desktop**. Include screenshot states for populated **server fixtures**, empty, unauthorized, offline, loading, read error, unknown mutation, and disabled planned feature. Viewports with popovers/dialogs require their own captures. Fixed metrics and dates should be deterministic in tests. Compare original approved screenshots by composition (not accidental fixture amounts): navigation, grid positions, card density, chart axes and key panels, typography, interactive hierarchy and consistent light/dark surfaces. A screenshot alone does not prove a backend works; every meaningful mutation also needs PostgreSQL-backed acceptance.

Use Playwright (`e2e` and `e2e/integration`) with screenshot output and reviewed baselines. Prefer snapshot thresholds scoped to volatile content and legitimate rendering differences, not enormous blanket tolerances that conceal a new redesign. Tag tests per feature to allow PR-specific release gates.

### 5.3 Definition of Done for EACH screen

- [ ] Original reference screenshot mapped to a screen-element checklist.
- [ ] Original visual composition and responsive behavior restored; reviewed before/after captures.
- [ ] Every metric sourced or explicitly unavailable; scope, currency, date and freshness displayed.
- [ ] All connected actions use server-authorized query/command contracts.
- [ ] All unsupported features are visually discoverable and clearly disabled, with an explanation.
- [ ] No demo/local financial data on the authenticated route.
- [ ] Permission/tenant/outlet tests prove no access bypass.
- [ ] Loading, empty, error, conflict and unknown-outcome states handled.
- [ ] Relevant unit, API/PostgreSQL and browser acceptance passes on exact commit.
- [ ] A11y/keyboard/mobile touch tests and visual regression screenshots reviewed.
- [ ] Documentation updated: implemented/partial/not connected, exact remaining backend contracts.

## 6. Deployment and operational safety

Never mistake green CI for release deployment. Before any release to the shared VPS:

1. Confirm the active server SHA, migration head, runtime image revision and PWA artifact hash read-only.
2. Repair the documented Docker Desktop restore-verification failure and verify the **latest** encrypted off-host backup in a task-owned isolated PostgreSQL 16 instance, or establish an independently approved off-host restore verification. Successful backup creation is not a successful restore.
3. Verify source SHA-matched container and static PWA artifacts from green CI; record their digests.
4. Run the full authorization, transaction, visual, keyboard and responsive suites. Validate separate business outcomes in **disposable** CI PostgreSQL, not the live tenant.
5. Review Nginx and existing ServOS/SMS/business-site baselines. Do not touch their containers, volumes, proxy routes or credentials.
6. Activate only the Mazao release using the existing checked helper, retain compatible prior API/PWA and forward-only migrations, verify public HTTPS and core login/workflows, compare protected service baseline.
7. Obtain explicit production approval; a passing UI-parity PR alone is not authorization to deploy.

## 7. Final objective / operator experience

The operator should recognize the **same Mazao design** as in the initial screenshots, but every live value now has an authoritative source. A storekeeper scans and saves a real count; an accountant sees explicitly scoped server metrics; a cashier records real sales/credit/refunds and prints from confirmed receipt snapshots; an administrator sees the entire administration catalog with truthful Connected/Partial/Not connected states; a user can inspect unresolved server commands without ever seeing simulated synchronization as fact. New backend slices progressively enable the already visible affordances without replacing their visual language again.

### Final handoff format for the development agent

For every PR provide:

```
BASE SHA:
HEAD SHA:
Screens and approved visual references:
Before / after screenshot locations:
Touched files:
Connected endpoints and commands:
Features visible but inactive:
Source-of-truth and authorization review:
Unit/API/integration/e2e results:
Visual snapshot / viewport results:
Keyboard/screen-reader/touch findings:
New migrations and upgrade evidence (if any):
Remaining gaps:
Release decision (NO-GO until approved):
```

**Important:** This is an instruction/specification, not evidence that the above work has been implemented. Read the latest repository state before changing files, because Mazao is under active development and may have advanced beyond the audited baseline.
