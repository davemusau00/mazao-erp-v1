# Product finishing audit and delivery sequence

Audit date: **16 October 2026, Africa/Nairobi**. Repository: [davemusau00/mazao-erp-v1](https://github.com/davemusau00/mazao-erp-v1).

## Decision

Mazao has a substantial, working online retail foundation and a partial hotel foundation. It is still materially short of the full retail/restaurant/hotel/offline v1 in the PRD. The remaining work includes new domain workflows, not just screen completion.

Use current `origin/main` as the integration base. First harden the existing workflows, then finish a coherent online retail operating cycle, then restaurant/hotel workflows, then bounded offline execution and full release acceptance. Keep accounting, permissions, recovery and real database/browser verification inside each slice.

Do not restart the product or first reorganize it into the aspirational package tree. Existing PostgreSQL authority, transaction/idempotency machinery, stock valuation and journals are useful foundations. Introduce explicit command contracts and extract domain services as the affected workflows change.

This audit adds documentation only. It does not fix the defects, change GitHub policy, merge/delete branches, deploy, or claim full acceptance.

## Source and branch reconciliation

Live GitHub refs, PRs, issues, workflow metadata and logs were inspected, and `git fetch origin --prune` refreshed remote refs. All **nine remote branches** were compared by ancestry, tree differences and, where necessary, patch equivalence.

Baseline: `origin/main` **5a74b54302038f18fada24e69d0a9eb0e1e8c892**, merged PR #12. The current checkout is `fix/operational-analytics-500` at **1be8da7eb751a38f310d33edeff9f262898c5b29**. Its complete tracked tree is identical to `origin/main`: tree **3308ac7215c565c815b05e1267805fe183cc11fe**. Therefore current local code inspection/build/browser results apply to that main tree.

| Remote branch | Tip | Behind / ahead of main | Finding |
| --- | --- | --- | --- |
| `main` | `5a74b54` | 0 / 0 | Current integration source; latest CI green. |
| `fix/operational-analytics-500` | `1be8da7` | 1 / 0 | PR #12 merged; identical source tree to main. |
| `feat/staff-workspace-access` | `8f7fabc` | 6 / 1 | One non-ancestor commit, but `git cherry origin/main origin/feat/staff-workspace-access` marks it `-`: its analytics SQL/test patch already exists in main. No unique feature to rescue. |
| `feat/product-csv-import` | `86f3e17` | 33 / 0 | Already integrated through PR #5. |
| `feat/server-configuration` | `aac34eb` | 40 / 0 | Already integrated through PR #3. |
| `fix/pilot-server-login` | `bf55aff` | 47 / 0 | PR #2 closed without merge, but the branch tip is now an ancestor of main; no stranded commit. |
| `deploy/mazao-isolated-vps` | `0c9e593` | 57 / 0 | Already integrated through PR #1. |
| `docs/csv-pilot-release` | `736d1b7` | 31 / 0 | Already integrated through PR #7. |
| `docs/pilot-configuration-evidence` | `b2dca3a` | 38 / 0 | Already integrated through PR #4. |

There are **zero open PRs and zero GitHub issues** at this checkpoint. PRs #1 and #3-#12 are merged; #2 is closed. There are no published GitHub releases. `main` has `protected: false`; branch protection returned 404 and repository rules/rulesets were empty. This conflicts with the protected-main/review/release policy in `21-RELEASE-AND-GOVERNANCE.md`.

The local `main` branch still points to `3915a0e`, **37 commits behind** remote main. A second existing worktree, `../mazao-erp-csv-import`, is on `fix/catalog-scan-identities` at `df1007d`, **29 commits behind** remote main. Neither was changed. Start future implementation from fetched `origin/main`; do not infer current product state from those local branch pointers.

Most remote branches are historical clutter, not separate unfinished products. Archive/delete them only as an intentional later housekeeping action. The staff branch needs patch-equivalence awareness rather than another feature merge. Commit titles also need care: `9d16a43` mentions analytics but actually changes configuration/images/UI; the diff is authoritative.

## How the codebase actually works

| Boundary | Current source | Role and practical consequence |
| --- | --- | --- |
| Application entry | `src/App.tsx`, `src/app/featureRegistry.ts`, `src/components/layout/AppShell.tsx` | Requires a real server session; role/capability registry controls reachable destinations. |
| UI transport and recovery | `src/services/apiClient.ts`, `commandJournal.ts`, `importValidationJournal.ts`, `secretOperationJournal.ts` | Session/CSRF HTTP adapter; original-command and validation recovery evidence in IndexedDB. Password recovery persists metadata without passwords. |
| API/authentication | `apps/api/src/app.ts`, `security.ts`, `identityAuthority.ts` | Fastify routes, session and origin/CSRF checks, role/device validation, command submission/status lookup. |
| Business mutations | `apps/api/src/commands.ts`, `configuration.ts`, `productImport.ts`, `staff.ts`, `credentials.ts` | Existing domain/application functions with handwritten payload validation. A large central command module still owns many stock, commerce, customer and hotel mutations. |
| Database and transactions | `apps/api/src/db.ts`, `migration.ts`, `apps/api/migrations/001-016` | PostgreSQL authority, SERIALIZABLE unit of work, bounded serialization/deadlock retry, immutable migration checksums and database invariants. |
| Read models | `receipts.ts`, `shiftCloseReports.ts`, `customerAccounts.ts`, `financeReports.ts`, `operationalAnalytics.ts` | Receipt/report/account projections with varying snapshot and authorization policies. |
| Delivery/operations | `.github/workflows/ci.yml`, `Dockerfile.api`, `infra/` | Tested PWA/API artifacts, isolated deployment/rollback scripts, backup/restore tools and operator runbooks. |

The proposed `packages/contracts`, `packages/domain`, `apps/worker` and print-bridge topology in the architecture document is not implemented. API/UI contract definitions remain separate TypeScript types; generic command payloads are `Record<string, unknown>` and there is no generated canonical schema/OpenAPI command catalogue. Transactional outbox rows exist, but no background worker consumes/publishes them.

The old local-storage workspaces are retained reference code. `FoodServiceWorkspace`, old `HospitalityView`, `ReservationWorkspace`, `ManageWorkspace`, `OnboardingWorkspace`, local finance and analytics must not be counted as completed backend features. The authenticated application entry graph does not route them. A passing runtime-boundary test verifies that retired preview storage/simulated hardware are outside the application entry graph.

### Foundations to retain

- Atomic command effects and stored outcomes; exact original IDs for retry and status lookup.
- Fresh actor/device/role/capability authorization inside new command transactions.
- SERIALIZABLE transactions with bounded retries and no external side effects inside the retry callback.
- Composite tenant foreign keys, exact money/quantity arithmetic and deferred journal balance constraints.
- Weighted-average inventory carrying value, transaction-time sale COGS and capped linked cash refunds.
- Immutable sale identity/tax/payment snapshots, source-reconciled cash close and server Z reports.
- Reviewed staged CSV validation/apply with version checks, opening-stock evidence and hostile-input coverage.
- Staff/session/credential services with version checks, revocation, replay fingerprints and last-admin/open-shift safeguards.

## Product state against the full v1

"Connected" means a reachable authenticated workflow exists. It does not imply every release/role/device scenario has passed.

| Area | Connected now | Still required |
| --- | --- | --- |
| Business/setup | Business/legal/contact/tax/receipt settings, capabilities, current outlet settings, computed first-sale checklist | Fresh-business self-service provisioning beyond bootstrap, additional outlets/locations, switching, persisted reviewed go-live, complete operating settings. |
| Staff/access | Tenant staff creation/edit/suspension, coarse server roles, initial/reset credentials, logical outlet assignments, authenticated assignment choice, session review/revocation | Reachable My account for ordinary staff; target-safe password forms; complete recovery; custom permission grants/approvals; physical device enrollment. Automatic first-login password expiry is absent. |
| Catalog/import | Item create, SKU/barcode/category/reorder metadata via CSV, reviewed CSV create/update, errors/export, opening stock, history/recovery | Direct edit/archive and category administration, variants, packages/conversions and package barcodes, services/nonstock, XLSX/package-aware import. |
| Inventory | Receiving/movements, weighted-average value, saved full-outlet count/review/post/cancel | Mixed-variance posting fix, transfers, waste/adjustments, locations, spot/blind counts, unknown barcode handling, zero-baseline valuation review, physical/reserved/pending-local/available projections, reservation reconciliation and valuation/source reconciliation. |
| Sales/payments | Cash sale or full approved customer-account charge, server receipt/history, linked cash refunds, shift cash-up | Held baskets/tabs, discounts/void approvals, split tender, manually confirmed M-Pesa evidence/reconciliation, guest charges, credit/noncash refunds and complete tender/tax Z reporting. Automated providers remain separately deferred. |
| Customers/AR | Account/credit-limit/status management, credit charges, FIFO cash repayment, reconciled statements | Concurrent statement snapshot fix, credit reversals, noncash/split repayment, aging/export and AR control-account reconciliation. |
| Purchasing/AP | Reviewed delivery receipt, supplier/reference text, inventory/accrual posting | Supplier master, PO approvals/delivery links, invoices/matching/duplicate prevention, cost/tax allocations, payable subledger, partial settlement/reconciliation. Receiving alone does not create a payable. |
| Restaurant | Disabled discovery card only; waiter/cook/bartender roles have empty grants | Tables, tabs, modifiers, stations, persisted order edits/fire, kitchen/bar completion, transfers/splits/voids, recipes/yield/sealed-open policy and exactly-once settlement. |
| Hotel | Rooms, reservations/cancellation, walk-in/check-in, booked-night full-cash checkout, dirty-to-ready | Calendar-type fix; types/rates/availability policy, deposits/liability, food/service folio lines, partial payments/reversals/statements, extensions/moves/actual-night rules, cleaning/inspection/holds. Hotel-only mode is not supported by current capability dependencies. |
| Finance/reports | Balanced posted journal, trial balance, journal drill-through, explicitly partial operating summary, outlet sales analytics | COA/mapping, expenses, supplier AP/deposits/assets, periods/late-post rejection, complete supported statements, source/subledger/valuation reconciliation and scoped exports. Analytics SQL test currently checks only an empty-data aggregate. |
| Assets/operations | Shifts and logical assignments | Asset acquisition/custody/maintenance/disposal and associated accounting; granular operational approvals and audit/export workflows. |
| Offline/synchronization | Cached PWA and durable unknown-command recovery | Signed actor/device grants, bounded stock/cash authority, local projections/evidence, ordered replay/feed/cursors, conflict/fencing, quota/migration/restart/export recovery, worker/retry/dead-letter processing. Offline financial operations remain v1 scope. |
| Printing/hardware | Server receipt, thermal-style preview, browser print/text fallback | Printer profiles and document/copy/hash semantics; optional paired agent if selected; physical scanner/printer/QR/drawer acceptance for supported profiles. Browser print is not physical delivery evidence. |
| UX/release quality | OLED-dark responsive shell and seven-viewport management screenshot capture | Full workflow viewport matrix, keyboard/screen-reader/contrast/reduced-motion review, installed-PWA upgrade behavior, representative performance/load and business acceptance. |

## Urgent defects and incomplete integration

Priorities: **P1** before expanding routine pilot use; **P2** in the following finishing slices. "Source-confirmed" describes inspected code/constraints; it is not a claim that a live business mutation was exercised.

| ID | Priority | Finding, evidence and required acceptance |
| --- | --- | --- |
| F01 | P1 | **Login throttle does not engage.** `app.ts:34` registers rate-limit before synchronously defining the login route at `:62`; the plugin's `onRoute` hook is installed later. Local `app.inject` after `app.ready()` accepted nine malformed logins as HTTP 400, including the ninth despite an eight/minute limit. Independent reproduction accepted twelve. Fix plugin/route registration order and verify the ninth attempt is 429. Configure bounded trusted-proxy handling: Nginx forwards client IP, but Fastify lacks `trustProxy`, which would otherwise group operators in the proxy's bucket once limiting works. |
| F02 | P1 | **Mixed stock gains and losses cannot post.** `commands.ts:543-547` builds one INVENTORY line with positive debit AND credit. `001_initial.sql:190` forbids that. A normal count with both nonzero gains and shrinkage hits a database constraint and rolls back. Source-confirmed; not run against PostgreSQL locally. Split or correctly net inventory postings and test unequal/equal mixed variances, replay, balanced journals and unchanged state on rejection. |
| F03 | P1 | **Hotel date guards use incompatible runtime types.** Raw DATE reads at `commands.ts:1017,1040` are declared strings; installed `pg` parses them to `Date`. The comparisons with `YYYY-MM-DD` at `:1023,1042` both evaluate false. Local installed-parser reproduction confirmed this; `2030-01-10` serialized as `2030-01-09T21:00:00.000Z` under the local time zone. Select explicit calendar-date text and test future/expired reservations, early checkout, returned API dates and UTC/non-UTC runtimes. Full DB mutation reproduction remains open. |
| F04 | P1 | **Password entry survives changing selected staff.** `StaffAccessWorkspace.tsx:74,79` reuses an unkeyed `PasswordOperationPanel` when the target changes. The panel clears inputs on submit/unmount, not target change (`PasswordOperationPanel.tsx:15-23`). Credentials entered for A can remain when B becomes the target. Remount/reset all secret and target-specific state; test switching before submit and while recovery is pending. |
| F05 | P1 | **Recovery readiness differs by workspace.** POS waits for recovery inspection, but receiving clears loading before journal inspection (`ProcurementWorkspace.tsx:40-60,84-89`); counts/hotel/shift also lack equivalent fail-closed readiness. Slow or failed journal reads can permit a new operation before a retained uncertain command is found. Source-confirmed race risk; reproduce delayed/unavailable IndexedDB and interrupted request before fixing shared readiness/in-flight behavior. |
| F06 | P1 | **Merge/configuration gates are incomplete.** Live main has no protection/rulesets. CI's production container smoke omits `CREDENTIAL_FINGERPRINT_KEY`, while readiness is only `SELECT 1` (`app.ts:57-59`, `.github/workflows/ci.yml:104`). Missing credential configuration can therefore ship as healthy, as the PR #10 history illustrates. Enforce review/CI and validate required production configuration/startup plus credential acceptance. |
| F07 | P2 | **My account is unreachable.** `MyAccountDialog.tsx:7` exists without a caller/import; `AppShell.tsx:86` renders a noninteractive identity block. Ordinary staff cannot follow docs/31's password-change instruction. Wire it into the authenticated shell and test cashier/receptionist/manager self-service and session revocation. |
| F08 | P2 | **Password recovery can dead-end on status 404.** The panel only offers repeated status checks and disables new entry while pending (`PasswordOperationPanel.tsx:54-55,73,79`). Metadata persisted before a request that never reaches the server has no supported resolution. Add safe server-side reconciliation/fencing and explicit re-entry policy; never erase uncertainty merely because one status lookup returns 404. |
| F09 | P2 | **Customer statements can falsely report corruption during concurrency.** Independent account/event reads at `customerAccounts.ts:34,38` are compared at `:84`. A charge/repayment between them can produce false integrity failure. Use one repeatable-read snapshot and test concurrent collections/charges. Source-confirmed race; not reproduced with a DB here. |
| F10 | P2 | **Ordinary command status is only tenant-scoped.** `app.ts:320-335` applies actor/outlet/permission checks to credentials/imports but not general commands. A tenant member with another command UUID can retrieve its outcome across roles/outlets. Existing ordinary-command replay also bypasses the new-command fresh authority path. Define explicit recovery authorization and test demoted/revoked actors and cross-outlet access. No UUID enumeration exploit was established. |
| F11 | P2 | **Staff name changes are incompletely propagated.** Membership edits write `m.display_name` (`staff.ts:80`), and migration 016 snapshots order operator names, but session/history/receipt/Z consumers still use `u.full_name` (`app.ts:69,96,223`, `receipts.ts:43`, `commands.ts:715`). Use current tenant names for new operations and immutable snapshots for history; test rename without historical mutation. |
| F12 | P2 | **Unsaved count edits can disappear on navigation.** `BackendStockCountWorkspace.tsx:279` warns but has no before-navigate/beforeunload guard. Persisted server drafts remain safe; recent unsaved edits do not. Also add access/account routes to global recovery: `AppShell.tsx:74` currently sends unrecognized staff/device commands to Shifts. |
| F13 | P2 | **No clean no-database API test path.** Analytics integration imports its DB-dependent service before checking `TEST_DATABASE_URL` (`operational-analytics.integration.test.ts:4-10`), so absent `DATABASE_URL` crashes before the intended skip. Reproduced: 38 pass, one fail, eight skips. With an explicit unused localhost DATABASE_URL: 38 pass, zero fail, nine skips. Make test setup/skip boundaries intentional; neither outcome substitutes for DB acceptance. |

## Verification and deployment evidence

| Check | Observed result and scope |
| --- | --- |
| Latest main CI | [Run 38765205921](https://github.com/davemusau00/mazao-erp-v1/actions/runs/38765205921), exact SHA `5a74b54`: **63 API tests, 0 failures, 0 skips; 24 browser tests; 9 real API/PostgreSQL browser tests; image migration/rerun/readiness and artifact publication passed.** |
| Local typecheck | `npm run typecheck`: passed both UI and API TypeScript. |
| Local production build | `npm run build`: passed; main JS 479.84 kB / gzip 130.32 kB, separate Manage/analytics chunks and generated PWA worker. Vite warns about `__dirname`; PWA build callback was slow. |
| Local browser acceptance | `npx playwright test --reporter=line` against the newly built preview: **24 passed, 55.4 seconds**. These are mocked API/browser-state tests. |
| Local API without DB env | Explicitly empty DATABASE_URL/TEST_DATABASE_URL: **38 pass, 1 fail, 8 skipped** due to F13. |
| Local pure/API boundary lane with unused DB URL | TEST_DATABASE_URL empty, DATABASE_URL `postgres://test:test@127.0.0.1:1/unused`: **38 pass, 0 fail, 9 skipped**. No PostgreSQL connected. |
| Local PostgreSQL/browser integration | Not rerun: Docker Linux engine unavailable and no task-owned disposable database configured. Hosted CI is the available exact-main database evidence. |
| Local diagnostics | Login throttle failure reproduced using in-process injection without DB calls; installed PostgreSQL DATE parser/type comparisons reproduced without DB. Other defects are code/constraint analysis with explicit reproduction work above. |
| Public read-only check | PWA and `/api/v1/health/ready` returned HTTP 200. HTML references `index-BeEnLfnZ.js` / `index-Bs6Nrf_v.css`, matching this main-tree build's asset names. Readiness returned ready/database available. This does not establish exact running API image, migrations or authenticated workflow health. |
| Latest documented full activation | `30-UI-PARITY-RESTORATION-STATUS.md:84`: `3404990`, PR #10, 15 October. Newer main artifacts are published and the public static asset names match main; exact current API revision has not been independently identified. |
| Latest documented successful restore | `30-UI-PARITY-RESTORATION-STATUS.md:87`: encrypted checkpoint `20261015T182622-03dfabc4d5ab49eb96e76dc5f6d7e515.dump.dpapi`, restored into isolated PostgreSQL 16: **16 migrations, 1 tenant, 13 orders, 43 journals, 0 unbalanced journals**. This supersedes older failed-restore notes. It is repository evidence, not a new restore or backup-freshness check. |

Real browser integration comprises configuration/first-sale/cash-close, CSV import and staff provisioning. It does not establish real-browser acceptance for all customer/count/analytics/hotel/role workflows. The analytics SQL regression is an empty-data test, so nonzero aggregates, refunds, multiple outlets and tenant isolation still need cases.

Both browser configurations block service workers and use Chromium. PWA update/restart/storage-migration behavior is untested by these suites. `autoUpdate` is configured, while release policy requires deferring updates around unresolved transactional work. Seven management viewport captures do not prove that every operator workflow is accessible at every required viewport.

Backup recovery remains operationally fragile: documented scheduling depends on the Windows PC and logged-in account, DPAPI CurrentUser recovery is not portable, and no continuously available independent storage/key-recovery path, monitored freshness or measured RPO/RTO is established. Preserve the successful restore evidence while completing these controls. Do not report the old restore failure as still the latest state.

Monitoring, alerting, realistic checkout/load percentiles and most SLO evidence remain open. Current numeric targets in docs/22 are proposed targets. CSV timing alone does not establish ordinary checkout/report latency or concurrency capacity.

## Delivery sequence

Each row is an outcome, not permission to combine unrelated work into a large PR. Implement the sub-slices below as individually reviewed end-to-end changes. The ordering assumes the documented retail-first roadmap; a selected pilot vertical can change restaurant/hotel order without removing full v1 requirements.

| Order | Milestone | Deliverable | Exit evidence |
| --- | --- | --- | --- |
| 0 | Harden current pilot | F01-F06, then F07-F13; current evidence register; enforced CI/review; recoverable production config | Correct throttle, mixed count and calendar-date tests; safe password-target changes; no mutation before journal readiness; scoped recovery; exact commit green. |
| 1 | Complete business setup and everyday stock | Tenant/outlet lifecycle and switching; direct item edit/archive; categories/barcodes; package/unit semantics; transfers/waste/adjustments; reviewed go-live | Fresh business to first sale without developer SQL; edit/archive cannot rewrite old receipts; package receiving/counting/transfers reconcile by outlet/value. |
| 2 | Complete online counter and cash-up | Manual M-Pesa evidence policy, split tender, held baskets, discounts/void approval, linked credit/noncash reversal, AR aging/controls, full tender/tax/Z reports | Mixed-tender sale/refund/retry cannot double-post; clear manual/provider status; till/tenders/AR/journal reconcile through close. |
| 3 | Complete purchasing and accounting foundations | Supplier master, PO/approval/delivery, invoice matching/duplicate guard, payable, partial payment; expenses, COA/mapping, period rules | Receive-to-invoice-to-partial-pay reconciliation, immutable corrections, inventory accrual clears correctly, closed periods reject late writes. |
| 4 | Restaurant operation | Packages/recipes/sealed-open policy, table order/modifiers/stations/fire, kitchen/bar completion, transfer/split/void, settlement | Full restaurant shift; retries never duplicate tickets or settlement; recipe stock and journals reconcile. Depends on stock/tender foundations. |
| 5 | Full hotel billing and housekeeping | Rates/availability/calendar rules, deposit liability, service/food/POS folio charges, partial settlement/reversal/statements, extensions/moves, inspection/holds | Deposit to folio to partial settlement to checkout to cleaning; room contention and journal/liability/till reconciliation. Base folio and ordinary POS-to-folio can proceed alongside restaurant; restaurant-generated charges depend on restaurant charge evidence. |
| 6 | Complete finance/assets/reports | Asset acquisition/custody/maintenance/disposal; supported financial statements; AR/AP/deposit/stock/source reconciliation; scoped exports | Bookkeeper can trace every reported total to sources; statements disclose completeness; periods and adjustments cover all implemented sources. Foundation controls begin at milestone 3. |
| 7 | Bounded offline operations | Real enrolled-device identity, signed grants, allocations/exposure, durable local cash evidence, feed/replay/fencing/recovery, worker operations | Required 100 permitted sales, restarts, repeated replay, expiration/revocation, storage migration/quota/loss and multi-device races; no duplicate or erased cash evidence. Start protocol design earlier; enable only after stable semantics. |
| 8 | Full v1 release acceptance | All suites A-H, required personas/viewports/accessibility, installed-PWA compatibility, scanner/printing profiles, monitored backup/restore, performance/rollback/business sign-off | Exact release SHA/digests/migrations/test/device/business evidence and demonstrated recoverability. Only this milestone can claim full documented v1. |

Suggested dependency path:

```mermaid
flowchart LR
  H[Harden existing workflows] --> S[Setup and stock foundations]
  S --> T[Counter tenders and reversals]
  S --> P[Purchasing and finance controls]
  T --> R[Restaurant]
  S --> R
  T --> G[Hotel folios]
  P --> G
  R --> F[Complete reports and reconciliations]
  G --> F
  P --> F
  T --> O[Bounded offline execution]
  F --> A[Full acceptance]
  O --> A
```

### First implementation queue

1. **Login and required runtime configuration:** F01 plus the configuration portion of F06; focused API/container acceptance. Configure GitHub branch controls separately as repository administration.
2. **Mixed stock-count posting:** F02, including gains-only, losses-only, unequal mixed and equal mixed values, replay and rollback invariants.
3. **Hotel calendar boundaries:** F03, normalized API dates and UTC/Nairobi runtime cases; future/expired/early-departure negative paths.
4. **Finish account/password UX:** F04, F07 and F08; target isolation, reachable self-service, safe status recovery, credential/session browser acceptance.
5. **Uniform command recovery and draft safety:** F05, F10, F12; gate journal reads, retain exact IDs, reject unauthorized status/replay, protect unsaved counts and route recovery correctly.
6. **Read-model/test consistency:** F09, F11, F13; statement snapshots, current-versus-historical names, clean test prerequisites and populated analytics cases. Split further if needed to keep each PR coherent.
7. **Catalog maintenance:** direct edit/archive/category/barcode/reorder workflow, stale quote handling, preserved historic evidence and real browser acceptance.
8. **Operational business setup:** additional outlet creation and authorized switching, persisted reviewed go-live; new tenant provisioning through a documented supported path.
9. **Manual payment and split-tender slice:** finalize accounting/evidence/reversal policy first, implement it end to end, then include it in reconciled cash/tender reporting.
10. **Package-aware stock slice:** explicit conversion contracts, purchase/base/sale quantities, package barcode scans, reviewed receiving/count semantics and valuation. This unblocks recipe/restaurant work.

Items 7-10 can be reordered within the dependency table for the selected pilot. Do not introduce full procurement, kitchen, folios and offline execution into one PR.

### Parallel work that reduces elapsed time

- Backend stock/catalog and tender work can proceed independently after command/recovery contracts are agreed, using separate branches and domain ownership.
- QA can add real customer/count/hotel/analytics/role journeys while domain work proceeds; tests should represent workflows/invariants, not mirror implementation.
- Operations can establish monitored independent backups/key recovery, startup checks and release evidence in parallel with product slices.
- UX can complete the existing flows and required viewport/accessibility review without enabling unavailable backend modules.
- Finance/folio/restaurant/offline policy design can begin early; execution follows their stock/payment/source dependencies.

The fastest credible first release is a clearly bounded **online retail pilot** after milestones 0-2 and its relevant operational/recovery gates. This is a delivery milestone, not a reduction of the full v1 promise. Ordinary restaurant/hotel and required offline behavior remain on the completion register. No unsupported percentage-complete or calendar promise is justified by the current evidence.

## Finish criteria for every new slice

Follow `agents/AGENTS.md`: versioned validated input/output and error contracts; tenant/role/device policy; atomic domain transaction; exact money/quantity; concurrency versions; idempotency and unknown-outcome recovery; immutable stock/accounting/audit effects; explicit offline classification; migrations fresh/upgrade/rerun; negative and actual API/browser journeys; documentation and measured relevant performance.

Maintain one current status table with fields: feature/workflow, accountable owner, source SHA, connected scope, missing scope, exact acceptance evidence, deployment revision, remaining gate. Historical evidence should retain its date/SHA and point to its superseding checkpoint.

The following are explicitly deferred in the PRD and should not delay the defined full v1: automated M-Pesa/eTIMS integrations, loyalty, public booking engine, advanced payroll, native apps, AI insights, reseller billing and advanced revenue management. Manual payment evidence, normal restaurant/hotel billing and bounded offline accounting are not on that deferred list.

## Documentation reconciliation required

- README and docs/23, docs/24 and docs/27 still describe staff/assignment/credential work as absent even though it is connected. Correct those entries, while keeping custom grants and physical enrollment open.
- Docs/30's later checkpoints supersede its early local-only/open-PR claims and older failed-restore notes. Its remaining visual/accessibility/domain gates are still real.
- Docs/25 and the backup runbook retain historical failed-restore language; link to the 15 October successful restore without implying current backups are continuously verified.
- `16-ROADMAP-BACKLOG.md` is a founding roadmap; use the outcome/PR sequence above for current execution. `implementation_plan.md` is an older narrow hotel plan, not the whole-product backlog.
- Root `.env.example` is an obsolete AI Studio template. Publish a usable local API/database/test setup that agrees with CI's pinned Bun/frozen lockfile; README's unlocked npm install is not equivalent reproducibility evidence.

No roadmap row should be marked complete merely because its types, database tables, screenshots or disabled discovery card exist.
