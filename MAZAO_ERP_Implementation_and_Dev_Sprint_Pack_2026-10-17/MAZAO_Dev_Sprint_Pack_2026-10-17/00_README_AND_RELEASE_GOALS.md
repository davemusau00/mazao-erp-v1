# MAZAO ERP | Fix and Development Sprint Pack

**Snapshot date:** 17 October 2026 (Africa/Nairobi)  
**Repository:** https://github.com/davemusau00/mazao-erp-v1  
**Deployed / green `main`:** `872514217272c154236fcab02bfda11417dd5dff`  
**Integration PR:** [#18, `feat/product-finishing`](https://github.com/davemusau00/mazao-erp-v1/pull/18), at `0e350e0c695635949094acda3a9832e6c9f780de`  
**Last checked CI:** [39040137815](https://github.com/davemusau00/mazao-erp-v1/actions/runs/39040137815), **FAILED**; API 93/95 tests passed and one failing subtest caused a failed parent. Browser/production-image jobs did not run.  
**Basis:** GitHub tree, PR metadata, exact CI job logs, current source inspection, earlier operator-provided VPS health and Firefox diagnostics, included background audits. This pack is a specification, **not a code patch, CI pass, merge, or deployment**.

## Mission

1. Restore a deterministic, green integration branch without breaking any working security checks.
2. Make all implemented screens **bounded, observable, usable, safely retryable** under intermittent connections; measure real latency rather than calling a 20-second timeout a speed fix.
3. Close command-result scope leaks and validate authorization during transaction/recovery races.
4. Complete practical operator setup using existing fixed server roles, credentials, memberships, sessions and outlet assignments.
5. Keep MAZAO's current dark design system, information architecture, accessible patterns and parity references. No generic redesign or removal of unfinished-but-visible navigation.
6. After hardening, finish online retail, inventory, procurement, restaurant, hotel, accounting and bounded offline workflows in dependency order.
7. Release only exact, CI-verified immutable artifacts with an off-host restore-verified backup; never impact unrelated VPS workloads.

## Source-of-truth hierarchy

1. **Checked-out code + direct tests/CI** beats prose documents and commit titles.
2. `main` is the deployed authority for production behavior; PR #18 is **candidate code only**.
3. `docs/27-V1-COMPLETION-REGISTER.md`, `docs/32-PRODUCT-FINISHING-AUDIT-2026-10-16.md`, `docs/43-LOADING-STAFF-BUILDOUT-STATUS-2026-10-16.md` are inventories, **not certificates of production acceptance**.
4. Previous Firefox observations: one malformed/incomplete `/configuration` response near 163 KB, one complete valid JSON response **683,935 bytes**, one request timing out past 10 seconds. Root cause is **not** conclusively known.
5. Production deployment `8725142` passed health and database migration verification with PostgreSQL retained; browser acceptance of every journey is still outstanding.

## Documents and order of use

| File | When | What it authorizes |
|---|---|---|
| `01_CODEX_MASTER_EXECUTION_INSTRUCTION.md` | First | One complete agent mission, scope and reporting contract |
| `02_SPRINT_00_CI_AND_STAFF_CONCURRENCY.md` | Immediately | Resolve failing latest CI without weakening security |
| `03_SPRINT_01_RECOVERY_AND_SECURITY.md` | After first green API run | Audit command authority, sessions and credential fencing |
| `04_SPRINT_02_LOADING_AND_PERFORMANCE.md` | Parallel investigation, then implementation | Root-cause and fix slow/indefinite loading everywhere |
| `05_SPRINT_03_CONFIGURATION_ASSETS.md` | After API shape is stable | Validate migration 017, image separation and receipt history |
| `06_SPRINT_04_STAFF_PROVISIONING.md` | After security and read reliability | Finish staff/assignment UX, role transparency and acceptance |
| `07_FULL_V1_SPRINT_ROADMAP.md` | After hardened slice | Remaining retail-to-offline full-scope delivery roadmap |
| `08_TEST_MATRIX_AND_PERFORMANCE_BUDGETS.md` | Every PR | Security, UI, performance and data acceptance matrix |
| `09_NON_DESTRUCTIVE_RELEASE_AND_ROLLBACK.md` | Only after green CI | Safe staging, backup, migration, verification and rollback |
| `10_BACKLOG.csv` | Every stand-up | Structured tasks with ownership, dependencies and gates |
| `11_AGENT_HANDOFF_AND_PR_TEMPLATE.md` | End of each branch | Evidence bundle, review and done definition |
| `references/` | As needed | Previously authored source-based audits retained verbatim |
| `INSTALL_INTO_REPO.ps1` | Optional, locally | Non-overwriting copy into `docs/implementation-sprints-2026-10-17` |
| `12_ALL_IN_ONE_CODEX_SPRINT_SPEC.md` | Optional | Single combined Markdown task for an agent |

## Current delivery decision

**HOLD production at `8725142`.** Do not push PR #18 code or migration 017 to the VPS until it is updated against main, all required GitHub jobs are green, all release artifacts are built from the exact promoted commit, and image upgrade/performance/security checks are met.

PR #18 is **9 ahead / 3 behind** main at this checkpoint; its changes span **50 files**. Avoid a blind merge of any old topic branch: PRs #13–#16 overlap fixes already incorporated into `main`; `fix/credential-operation-fencing` may independently introduce a migration numbered `017`. Resolve the migration namespace by **reviewing all migrations at integration time**. If unshipped, rename the conflicting *new* migration to `018` and change its manifest; **never rename an already-applied migration**.

## Definition of release-ready

All boxes MUST be true:

- [ ] CI typecheck, API, normal Playwright, real PostgreSQL Playwright, production-container migration/readiness/security smoke and artifact publication all green for an identifiable SHA.
- [ ] Exactly the correct actor/outlet/tenant may inspect or replay original command results, including after role/session changes. No duplicate postings.
- [ ] No endless spinner. Every implemented screen has success, empty, retryable failure, offline/expired-session and cancellation states.
- [ ] Performance budgets measured on documented hardware/dataset/network; no unsupported claims of p95 performance.
- [ ] `GET /configuration` metadata remains compact, images and past receipts survive upgrades, versions/checksums remain valid.
- [ ] Staff create → credential → assignment → actual sign-in passes and manager/cashier negative permissions pass.
- [ ] Saved stock counts, especially the operator's real unposted 74-item count, are preserved. No reset/overwrite of its baseline; handle legitimate stale-count conflicts explicitly.
- [ ] Off-host encrypted backup fresh and restore-verified; forward-only migration compatibility assessed; safe staged activation and rollback rehearsed in disposable environment.
- [ ] Production MAZAO API/PWA match; unrelated services and DB volume untouched; sampled read-only production smoke completed.

## What is out of this stabilization slice

Full custom-RBAC editing, physical printer pairing, native Android/iOS build, live Daraja and eTIMS connections, restaurant order execution, true offline payments, supplier AP and hotel folios are **not implemented by the current fix PR**. They are scheduled as explicit future domain sprints in file 07. Do not mark them done because a button or mocked UI exists.
