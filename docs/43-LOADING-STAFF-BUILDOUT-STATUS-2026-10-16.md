# Loading, Manage and Staff Build-out Status

**Date:** 16 October 2026  
**Verification refreshed:** 18 October 2026
**Source branch:** `feat/product-finishing`  
**Plan:** [`MAZAO_Loading_Performance_Manage_Staff_Completion_Plan_v2.md`](../MAZAO_Loading_Performance_Manage_Staff_Completion_Plan_v2.md)

This record tracks source work completed for the plan and separates it from production-runtime and release evidence that has not been collected. No production host, database, account, reverse proxy or service was accessed or changed.

The system-wide performance run and current acceptance decision are in [`44-PERFORMANCE-ACCEPTANCE-2026-10-18.md`](44-PERFORMANCE-ACCEPTANCE-2026-10-18.md). That record supersedes the earlier “not measured” route timing notes below for the measured disposable workload. It records passing latency thresholds and a failing overall release decision because capped history endpoints have no complete continuation flow, plus additional open release gates. Its browser measurements cover warm workspace navigation; they do not establish cold-start p95. The verification table and gate summary below are refreshed to that run.

## Route loading inventory

The shared client applies a 20-second ceiling to GET headers and body consumption, raises an accessible warning after 10 seconds, and treats cancellation as a separate outcome. Successful JSON reads require a JSON object and endpoint-specific mandatory fields/lists. Workspace navigation cancels pending reads; loaders with local state guards ignore obsolete results. Failed reads produce safe request diagnostics with a route template, status/code, duration and request ID. Successful reads emit browser-only timing events with header time, body time, byte count and the API `Server-Timing` app duration. No event includes response content, credentials, tenant names or request bodies.

| Entry | Permission / capability | Initial server reads | Loading and failure behavior in source | Remaining route evidence |
|---|---|---|---|---|
| Sign in / restore | Public, then server session | `POST /auth/login`; `GET /auth/me` | Form error is visible; workspace selection is explicit when more than one active assignment exists; successful session response is validated. Ordinary GET restore is bounded. | Firefox/PWA offline refresh and session-expiry network matrix not run. |
| Today | Any authenticated session; till panel requires `shift.open` or `shift.close` | `GET /shifts/current` for authorized till panel | Shortcut shell renders independently. Till failure is visible and has **Retry shift status**; pending read is cancelled on navigation/unmount. | Timings not collected on representative data. |
| Sell | `commerce.sell` and `commerce` capability | `GET /catalog/items` + `GET /shifts/current`; `GET /customers` when customer credit is available | Catalog and shift load in parallel. Checkout stays locked until required data and local recovery evidence load. Header refresh retries; customer-account read failure is separately visible. | Browser failure injection covers command recovery and configuration, not every GET/status class. |
| Sales history | `commerce.sell`, `commerce.refund` or `finance.view` | `GET /sales/orders`; retained refund evidence from IndexedDB | Visible load state/error and Refresh. Refund mutations retain their original command ID and expose status recovery. | No production-shaped receipt volume or pagination stress run. |
| Tables & kitchen | Hospitality capability | None; feature is not connected | Navigation is disabled with an accurate explanation. | Deliberately unavailable; no loader to measure. |
| Stock | Inventory capability plus `catalog.manage` or `inventory.receive` | `GET /catalog/items` and `GET /inventory/movements` independently; recovery metadata locally | Catalog failure is visible with Refresh. Movement failure does not hide loaded catalog and has its own retry. Movement endpoint returns the latest 250 records. | Large catalog/movement timing and concurrency not measured. |
| Count stock | Inventory capability plus count permission | `GET /inventory/counts/current` + `GET /inventory/counts`; catalog read for count entry | Saved count and history load in parallel; errors are visible; Refresh is disabled when unsaved edits or unresolved writes would be endangered. | 30/10 route workload and mobile-network timing not run. |
| Purchasing | Inventory capability plus `inventory.receive` | `GET /catalog/items` | Catalog loader has visible error and Refresh; write controls remain disabled while unavailable or recovery inspection is pending. | Large catalog timings not measured. Supplier accounts/payables remain unconnected. |
| Hotel / Reservations | Hospitality capability and `hotel.frontdesk`, `hotel.manage` or `hotel.housekeeping` | `GET /hospitality/rooms`, then reservations and stays in parallel when front desk is authorized | Visible loader/error, Refresh and independent command recovery. Reservations, stays and housekeeping are views within the connected hotel workspace. | Production-shaped hotel volume and network-failure matrix not run. |
| Customers | Commerce capability plus customer view/manage/settle permission | `GET /customers`, selected `GET /customers/{id}/statement`, and `GET /shifts/current` when settling | Visible load/error, Refresh, and selected-statement progress. Cash repayments require an open server shift. | Customer-history volume and concurrency not measured. |
| Shifts | Commerce capability plus `shift.open` or `shift.close` | `GET /shifts/current` + `GET /shifts/close-reports` | Parallel read, visible load error and Retry; write recovery preserves original command ID. | No end-to-end response timing baseline on production-shaped history. |
| Money | `finance.view` | `GET /reports/trial-balance` or `GET /reports/profit-loss`; selected account uses `GET /reports/journal-lines` | Visible busy/error states; report has explicit Refresh and journal detail is separately loaded with pagination. | No large-ledger timing or concurrency evidence. |
| Reports | `finance.view` | `GET /reports/operational-analytics` | Scoped report loader, visible error and date-range refresh; stale requests are ignored on period change/unmount. | No fixture-size or production runtime percentiles measured. |
| Manage / Setup checklist | `config.view` or `config.manage` | `GET /configuration`; staff and assignments call `GET /staff` and `GET /devices` in their own panels | Configuration load error is distinct from form errors, survives section changes, and has a retry. Last loaded configuration remains visible if a refresh fails. Staff and assignments render independently of configuration. | Actual Bun/Nginx/Firefox path and observed production issue not reproduced. |
| Staff / Assignments | `staff.view` / `devices.view`; mutations require `staff.manage` / `devices.manage` | `GET /staff`; `GET /devices` for assignment panel, guided assignment/verification steps, or explicit assignment view; scoped session reads on demand | Directory and assignment failures are visible with a Refresh button. Membership, credential, assignment and first-session status come from server reads. Wizard resume metadata contains only user ID and step in session storage. | 500-member pagination/search and manager/cashier permission matrix still need full acceptance. |
| My Account | Any authenticated session | `GET /auth/sessions`; private password operation/recovery endpoints | Session/password panels expose progress, visible errors, retry/status actions and protect active password submission from navigation. Passwords are not journaled. | Firefox and mobile operational acceptance not run. |
| Help | Authenticated | No server data read | Local guidance renders without a loader. | No server performance work applies. |
| CSV import (opened from Stock) | `catalog.manage` plus inventory capability | `GET /catalog/imports`, `GET /catalog/items`, selected `GET /catalog/imports/{id}`; bounded CSV error download | Separate history/batch retry, validation status recovery and original command recovery. | Existing 1,000-row figures are CI cases, not a route p95 or production guarantee. |

The inventory is a source-level route map, not an assertion that all route-level failure injections or performance targets have passed. The server remains authoritative for permission, tenant/outlet scope and command outcomes.

## Source changes in this build-out

- `src/services/apiClient.ts`: strict JSON parsing and mandatory response-shape checks; bounded GET headers/body; slow-read and terminal failure outcomes; safe request IDs; cancellation; client timing events; no automatic mutation retry with a new command ID.
- `src/components/layout/AppShell.tsx`: accessible slow-read banner and expandable, copyable request-ID diagnostics containing only safe route/error metadata.
- `apps/api/src/app.ts`: validates incoming request IDs, returns the ID, and emits an app-duration `Server-Timing` header. Authentication projections select tax policy rather than transferring the full tenant profile.
- `apps/api/src/configuration.ts` and migration `017_configuration_assets.sql`: tenant-scoped staged PNG assets, strict PNG validation, separate authenticated reads, compact configuration metadata, safe keep/replace/remove image actions, scrubbed audit/outbox evidence, and immutable receipt references.
- `src/components/manage/BackendManageWorkspace.tsx`: separate configuration load errors from form errors and keep retry visible across settings sections; staff and assignments remain independent of that read.
- `src/components/manage/StaffAccessWorkspace.tsx`: resumable identity → protected password → logical workspace assignment → server sign-in verification flow, fixed-role effective-permission matrix, and explicit initial-password/assignment/session states.
- `src/components/home/BackendTodayWorkspace.tsx`: cancellation/generation guards and retry for the current-shift read.
- `src/components/inventory/BackendInventoryWorkspace.tsx`: catalog remains usable when movement history fails; movement failure is no longer converted to an empty history.
- `e2e/configuration.spec.ts`, `e2e/integration/staff-access.spec.ts`: malformed JSON diagnostics and retry, timing event shape, configuration/staff independence, and real-database guided first-use coverage.

## Verification record

| Check | Result |
|---|---|
| `npm run typecheck` | Passed on the performance candidate tree. |
| `npm run build` | Passed. Main client bundle 522.20 kB minified / 140.58 kB gzip; PWA precache 680.15 KiB. Vite still reports the existing chunk-size and native config-loader warnings. |
| `npm run test:e2e` | 52/52 passed, including request timing, navigation cancellation, malformed-JSON retry and customer statement race coverage. |
| `npm run test:api` | 95/95 passed against task-owned disposable PostgreSQL. |
| `npm run test:integration` | 17/17 passed against freshly migrated task-owned PostgreSQL, including financial and inventory read-integrity assertions. |
| Fresh migrations | Migrations 001–017 applied to a fresh disposable test database; checksum-safe rerun matched. |
| Local production-container smoke | Candidate `Dockerfile.api` readiness passed with read-only root; login throttling returned 429 with `Retry-After: 60` on the ninth invalid attempt. Local disposable container only. |
| `npm run perf:browser` / `npm run perf:sw-upgrade` | Firefox and Chromium desktop/mobile offline, reconnect, IndexedDB sentinel and service-worker upgrade checks passed; see the linked performance record. |
| `npm run perf:assert` | Passed latency thresholds only. Its JSON marks `scope: LATENCY_ONLY` and `releaseAcceptance: false`. |
| `git diff --check` | Passed after the performance report and release documentation updates. |

## Open acceptance and release gates

See [`44-PERFORMANCE-ACCEPTANCE-2026-10-18.md`](44-PERFORMANCE-ACCEPTANCE-2026-10-18.md) for the current pass/fail matrix. Overall acceptance is **FAIL**: fixed list caps need a complete continuation path; full cold-start and per-screen error coverage, distinct-operator workload, exact-main CI, and off-host restore verification remain open (`restoreVerified=false`). No live host or production data was changed. Custom RBAC grant editing and physical-device enrollment remain separate product decisions outside this loading work.