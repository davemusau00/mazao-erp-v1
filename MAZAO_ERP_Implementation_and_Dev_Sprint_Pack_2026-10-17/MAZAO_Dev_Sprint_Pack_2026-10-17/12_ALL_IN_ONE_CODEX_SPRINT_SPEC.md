# MAZAO ERP | All-in-one Codex execution and development sprint specification

Generated 17 October 2026 from the separately editable documents in this pack. Read sections in order; repository code and current CI remain authoritative over this snapshot. This document is an implementation instruction, **not evidence that fixes have been applied**.



---

> Source: `00_README_AND_RELEASE_GOALS.md`

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



---

> Source: `01_CODEX_MASTER_EXECUTION_INSTRUCTION.md`

# Master Codex Implementation Instruction | MAZAO Finish and Harden

> Paste this entire brief into Codex **with the pack available in the repository working directory**. Do not run on the production host. The agent should work in the existing Git repository and produce reviewable commits/PRs, not a second implementation of the product.

## Your role and mandatory initial commands

You are lead backend engineer, reliability engineer, security reviewer, and React/PWA integration engineer. Work on `davemusau00/mazao-erp-v1`. First inspect repository status and fetch upstream. Never assume the user's local checkout is up to date.

```bash
pwd
git status --short --branch
git remote -v
git fetch origin --prune
git log -1 --format='%H %s' origin/main
git log -1 --format='%H %s' origin/feat/product-finishing
git diff --stat origin/main...origin/feat/product-finishing
git branch -r
```

Use a **dedicated integration worktree/branch based on `origin/feat/product-finishing`**, not dirty `main`. Before editing, integrate the up-to-date `origin/main` carefully and resolve duplicates in test isolation, product counts, login and hotel/date patches. Record conflicts and their resolutions; never delete valid regression tests just to complete a merge. If automated branch management is unavailable, stop and give precise instructions instead of claiming to have performed it.

## Absolute safety invariants

- PostgreSQL authority is the only business-record source of truth. **Do not reset, reseed, wipe, truncate, drop, or replace production records, tenants, staff, stock counts, shifts, audit, journals, commands, receipts, or volumes.**
- Production host, `.env`, cookies, credentials, tokens and business images are out of bounds during code work. Use disposable localhost PostgreSQL only for integration acceptance.
- Preserve `SERIALIZABLE` financial commands, their 3 bounded retries and original `commandId` idempotency. No automatic creation of new IDs after unknown writes, and no replay of payment, print or external effects inside retried transactions.
- Never bypass staff permission/role/device/tenant/outlet checks or disable the ninth-attempt HTTP 429 login throttle to make a test green.
- Enforce server authorization; frontend hiding alone is not a security boundary.
- Treat immutable journal, receipt identity/tax/payment snapshots, COGS, audit/outbox, and history as accounting evidence.
- Keep the existing MAZAO design language, workspaces, panels, breakpoints, keyboard accessibility and visual assets. Do not replace dark UI with generic admin templates.
- Never replace published/applied migration SQL/checksums. Audit potentially conflicting candidate `017_*` migrations before branch integration.
- No force-push to `main`; no main merge or production release until human review plus green required checks.

## Phase gates and execution order

**Phase A: Repair latest CI** (file 02). Reproduce the `staff-security.integration.test.ts` concurrency failure. Read the exact GitHub run [39040137815](https://github.com/davemusau00/mazao-erp-v1/actions/runs/39040137815). It records the second concurrent actor's GET returning `401` after access revocation, while the test expects `200`. Separate preflight reads from parallel mutations; continue checking genuine last-admin safety. Do not introduce a bypass for revoked sessions.

**Phase B: Validate security and recovery** (file 03). PR #18 adds `commandAuthorization.ts` and stricter same-actor/outlet command recovery. Verify the policy is complete for every command type, lifecycle/replay behavior is correct, and secret credential recovery is fenced safely. Run negative tests.

**Phase C: No forever-loading screens** (file 04). Inventory every route, make all reads bounded, observable and independently recoverable, diagnose `/configuration` by measuring API vs Nginx vs browser, establish before/after latency. Preserve unknown-write fencing.

**Phase D: Settings PNG asset correctness** (file 05). Validate `017_configuration_assets.sql`, legacy image URLs, size and authentication rules, keep/remove/replace, historical receipts, audit sanitization and production upgrade path.

**Phase E: Staff UX** (file 06). Complete and verify the existing four-step guided provisioning; do not pretend custom RBAC grants and physical device enrollment are implemented. Handle 403, revoked sessions, missing assignment, recovery and target-specific password reset safely.

**Phase F: Full v1 vertical slices** (file 07). Implement the remaining business workflows after Phase A–E release; each vertical slice must include reporting/accounting, role tests, UI, migrations, browser/API tests and user acceptance.

## Concrete inspection targets

- API: `apps/api/src/app.ts`, `db.ts`, `commands.ts`, `configuration.ts`, `staff.ts`, `credentials.ts`, `commandAuthorization.ts`, `identityAuthority.ts`, `migration.ts`, `productImport.ts`, `receipts.ts`.
- Schema: `apps/api/migrations/001_initial.sql` through `017_configuration_assets.sql` on candidate; inspect other worktrees for future overlapping `017_*` migrations.
- UI: `src/services/apiClient.ts`, `src/components/layout/AppShell.tsx`, `src/components/manage/BackendManageWorkspace.tsx`, `StaffAccessWorkspace.tsx`, `OperatorSessionsPanel.tsx`, `PasswordOperationPanel.tsx`, `src/hooks/useCommandRecoveryReadiness.ts`, all connected workspace loaders in `docs/43-*`.
- Tests: `apps/api/test/staff-security.integration.test.ts`, `command-recovery.integration.test.ts`, `configuration-assets.integration.test.ts`, `stock-count-variance.integration.test.ts`, `e2e/integration/*`, `e2e/workspace-recovery-readiness.spec.ts`.
- Ops: `.github/workflows/ci.yml`, `infra/activate-release.sh`, `infra/Backup-Mazao.ps1`, `docs/13-INFRA-DEPLOYMENT.md`.

## Required commands (disposable database only)

Repo uses a Bun-pinned CI runtime (`1.4.3`) with npm-style scripts. Do not assume Node 26 locally duplicates hosted Bun behavior. Install from lockfile without modifying it casually.

```bash
bun install --frozen-lockfile
bun run typecheck
bun run db:migrate
bun run db:migrate        # same DB, must match migration checksums
bun run test:api
bun run test:e2e
bun run test:integration
```

`test:integration` requires `MAZAO_E2E_DATABASE_URL` set to a specifically named, migrated localhost disposable database as enforced by `playwright.integration.config.ts`. Supply matching `DATABASE_URL` and `TEST_DATABASE_URL`. Never point any `MAZAO_*TEST*` variable at `93.127.131.55` or any production database.

If the environment cannot support a check, report **BLOCKED**, the missing prerequisite and the precise reproduction command. A mock/UI pass cannot replace real PostgreSQL and container acceptance.

## Per-PR delivery contract

For every PR provide: concise scope; exact changed files; root cause; threat/data model; migration implications; rollback behavior; before-and-after measurements where applicable; executed commands and unedited pass/fail counts; failure artifacts or traces; visual parity screenshots for impacted views; known limitations; and explicit **production deploy: NOT PERFORMED**. Include human QA steps with an admin, manager and cashier test account in disposable fixtures.

## Stop conditions

Stop merging/promoting when: any red required CI check, migration collision/checksum mismatch, new unaudited monetary effect, cross-actor status result, unknown command replay duplicates effects, baseline data altered, any route never leaving loading, build/image SHA mismatch, or unverified off-host backup restore. Report blockers rather than concealing them.

## Final expected response

Return a concise release-readiness dashboard with commit SHAs, PRs, green/red counts, root causes, outstanding work ordered by P0/P1/P2, links to evidence, the exact next safe command, and whether the production deployment remains unchanged.



---

> Source: `02_SPRINT_00_CI_AND_STAFF_CONCURRENCY.md`

# Sprint 00 | Unblock CI without breaking staff safeguards

**Urgency:** P0 · **Suggested effort:** 0.5–1.5 focused engineering days plus hosted CI · **Owner:** backend/security/test engineer · **Branch:** existing PR #18 after main reconciliation.  
**Start gate:** `main` green at `8725142`; PR #18 head `0e350e0` failed GitHub Actions run `39040137815`.

## Verified failure

At `apps/api/test/staff-security.integration.test.ts`, test *“parallel administrator removals or assignment transfers cannot strand the business”* currently builds two asynchronous actions. Each action reads the other actor's membership/assignment **inside** the same `Promise.all` that starts concurrent access-changing commands. When one action succeeds first, the other actor's session can legitimately be revoked before its **preflight GET**. The helper `members()` asserts `200` but receives `401 UNAUTHENTICATED`.

CI output: 95 cases, **93 pass / 2 fail** (failing subtest and parent). Typecheck and migrations pass; normal browser, real database browser and image job skip because `test:api` fails. This is a genuine test-race defect in the orchestration, **not permission to weaken server revocation**, and does not prove that all real administrator races are safe.

## Surgical correction design

### Red/green method

1. Run the single file against a **disposable migrated localhost** test database; repeat enough times to expose the race. Capture the exact HTTP transitions and expected audit entries, without logging credentials.
2. Split **read preflight** from **mutation concurrency**: gather both target membership versions or target device versions while both actors are known authenticated. Build two complete immutable command envelopes with independently generated UUIDs **before** starting the race.
3. Issue only the prepared commands concurrently, e.g. `Promise.all([submit(owner, preparedOwner), submit(peer, preparedPeer)])`; never issue fresh GETs as part of these concurrent workers. Preserve concurrency in the actual mutation path.
4. Assert exactly one command is `CONFIRMED` when the preconditions demand one winner; the loser is either a documented `REJECTED/CONFLICT`, or an authentication/authority rejection such as `401/403`, depending on whether revocation occurs before the handler's session check. Require **zero HTTP 500s** and **zero unauthorized CONFIRMEDs**.
5. Query PostgreSQL afterward using test-only DB access: exactly one usable tenant administrator with an active membership, password and active outlet assignment remains; no orphaned active assignments; no unexpected sessions; audit/outbox and stored command outcomes match actual committed effects.
6. Repeat reversed order and several dozen iterations with distinct disposable tenant fixtures. Ensure same-actor simultaneous changes, cross-tenant targets, current-session self-reassignment and open-till restrictions remain denied. Use deterministic barriers only when necessary; don't sleep arbitrarily to manufacture ordering.
7. Keep the existing fast test suite; preserve high-value independent mutation concurrency within each isolated DB test file.

### Representative test shape (illustrative, adapt to real types)

```ts
// Before race: BOTH actors are authenticated and all versions are fetched.
const peerVersion = (await member(app, owner, peer.userId)).version;
const ownerVersion = (await member(app, peer, owner.userId)).version;
const disablePeer = command(owner, 'staff.member.set_active',
  { userId: peer.userId, active: false, reason: 'Last administrator race' },
  { [`staff:${peer.userId}`]: peerVersion });
const disableOwner = command(peer, 'staff.member.set_active',
  { userId: owner.userId, active: false, reason: 'Last administrator race' },
  { [`staff:${owner.userId}`]: ownerVersion });

const responses = await Promise.all([
  submit(app, owner, disablePeer),
  submit(app, peer, disableOwner),
]);
// Normalize both HTTP response and command envelope; allow a legitimately
// revoked actor's 401, but never allow two confirmed removals or HTTP 500.
```

Use an analogous preflight for `devices.assignment.update`. This snippet is **not a ready-to-apply patch**, and its exact expected codes must be derived from the actual app handler.

## Merge/rebase containment

`feat/product-finishing` is 3 commits behind and 9 ahead of main. Use `git fetch origin` and a new worktree; integrate `origin/main` via merge (safer audit trail) or a deliberately controlled rebase on a private branch. Important duplicated work:

- `apps/api/test/support/isolate-database.mjs` and `package.json` already fixed on main. Keep **main's last accepted test isolation** unless current branch adds proven improvements.
- Historical migration upgrade fixture cleanup already accepted on main; preserve it.
- `fix/mixed-stock-count` PR #14, `fix/account-self-service` PR #15, `fix/hotel-calendar-dates` PR #16 are older parallel lines. Relevant fixes are already included in main or PR #18, so do **not** blindly merge all their commits.
- Check migration `017_configuration_assets.sql` against any later `017_credential_operation_fencing` local worktree before staging a release; assign unique immutable numbers before application.

## Acceptance gates

- [ ] Focused staff concurrency case 30–100 disposable iterations, including each race type and reversed scheduling; no lost last admin.
- [ ] `bun run typecheck` green.
- [ ] `bun run test:api` green with **0 failures, 0 unintended skips** and meaningful DB-backed coverage.
- [ ] CI Playwright regular and real PostgreSQL browser suites subsequently run and pass; do not claim victory after only fixing the API stage.
- [ ] Production API image smoke job runs and passes on exact candidate SHA.
- [ ] No privilege/rate-limit relaxation, no removed assertions, no global serialization of otherwise legitimate stock/sale transaction races.
- [ ] PR updated with the original CI log citation and explanation of why 401 was legitimate for the losing actor.

## Failure escalation

If both removal commands can commit, if all admins are lost, or a revoked actor posts a new authoritative command, **this is a product security defect**, not a flaky test. Stop and fix `staff.ts`, transaction locks, session revalidation and last-admin checks with a targeted real-DB regression before restarting integration.



---

> Source: `03_SPRINT_01_RECOVERY_AND_SECURITY.md`

# Sprint 01 | Tenant, operator, assignment and command-recovery security

**Priority:** P0 · **Suggested effort:** 1–3 focused engineering days · **Depends on:** Sprint 00 core CI green.  
**Status at 17 Oct:** implementation exists on PR #18 but is not yet accepted in GitHub's complete pipeline; production `main` lacks the new generic recovery policy.

## Security goals

1. Only the actor who originated a command, in the correct tenant and authorized outlet/assignment, may read its stored result or replay its exact envelope, unless a separately designed delegated capability is explicitly introduced.
2. Permissions and capability status must be recomputed from current authoritative server state. Changing role, disabling a capability, revoking an assignment or session must not leave a stale right to inspect old sensitive results or post new commands.
3. Never mistake a server status-query `404` for proof that a secret or financial operation was never accepted. An unknown credential operation must remain fenced pending authoritative resolution.
4. A confirmed original command replay returns the original outcome **once** with no second effect, even if a shift is now closed or stock has changed.
5. Stored financial evidence, receipts, stock balances, audit and outbox must remain unchanged after a forbidden replay/read.

## Code audit map

- `apps/api/src/commandAuthorization.ts`: new `policies`, `requireCommandAuthority`, `requireCommandRecoveryAuthority`.
- `apps/api/src/app.ts`: `POST /api/v1/commands` replay branch, `GET /api/v1/commands/:commandId`, request preHandler, credential routes.
- `apps/api/src/identityAuthority.ts`: `revalidateOperator` at command time; retain original assigned outlet and role in validated scope.
- `apps/api/src/staff.ts`: membership/device updates, tenant row serialization, last administrator and open shift checks, session revocation.
- `apps/api/src/credentials.ts`: dedicated password writes, idempotent fingerprint key, accepted/unknown/replayed boundaries.
- `apps/api/test/command-recovery.integration.test.ts`, `apps/api/test/staff-security.integration.test.ts`.
- `src/services/commandJournal.ts`, `secretOperationJournal.ts`, `apiClient.ts`, `identityUi.tsx` and credential UI.

## Work package A: shared execution and recovery authority

- Inventory every currently supported `CommandEnvelope.type` by searching `commands.ts`, `staff.ts`, `configuration.ts`, `productImport.ts`, `credentials.ts`. Compare with every key in `commandAuthorization.ts`. Unregistered types must deny by default; do not leave aliases that allow stronger permissions on replay than at initial execution.
- Ensure `GET /commands/:id` performs tenant-scoped lookup and exact actor/outlet comparison without revealing whether a foreign ID exists; return sanitized 404 for unauthorized result discovery.
- Ensure `POST /commands` duplicate path checks **persisted** type and request hash, actor, tenant, outlet/assignment and current role. A forged replacement payload must not change the authorization policy. Preserve import-specific definite-rejection contracts only where already explicit.
- Check execution and recovery permissions are at least equally restrictive. Any payload-dependent checks (refund amount, current shift, target staff, management access) must be covered by either a documented recovery exception or an independent gate that never broadens privilege.
- Protect read-only `GET` responses against secrets in command-result JSON, including staff operations. Avoid logging credential payloads.

## Work package B: credential-operation fencing

- Existing `staff.password.set` and `auth.password.change` use protected password endpoints, **not** generic command payloads. Do not place passwords in URL, audit, logs, IndexedDB, queue, service-worker cache or sessionStorage.
- Review the still-separate credential fencing work carefully. It may require another migration that once used number `017`, while PR #18 now uses `017_configuration_assets.sql`. Before integration, allocate an unused migration number (likely `018_...` if 017 is not applied anywhere), update the ordered manifest, and test fresh/upgrade/rerun.
- A timed-out password submission can have succeeded. Retain only command UUID/target/version/kind metadata and show 'Check original status'; no new command until definite resolution or explicitly documented safe fencing.
- After target password reset, server revokes target sessions; after own password change, server revokes current session. Do not show success or reopen privileged UI after revoked credentials.
- Do not rotate `CREDENTIAL_FINGERPRINT_KEY` during redeploy. This production secret anchors the credential idempotency fingerprint and needs controlled durable handling.

## Work package C: concurrency and adversarial checks

| Attack/edge case | Required server outcome |
|---|---|
| Cashier knows admin command UUID in same tenant | Sanitized 404; no outcome leak |
| Same user, different outlet/assignment | Deny status/replay unless explicitly authorized by a documented policy |
| Cross-tenant UUID | 404, no foreign data |
| Operator downgraded to role without permission | Deny even if original write was valid |
| Assignment/session revoked between authentication and command transaction | Deny new authority, preserve committed history |
| Duplicate original receipt/sale after till closes | Return original committed result, no second ledger/stock effect when current recovery policy permits |
| Replay with same UUID but modified payload | Idempotency mismatch / definite rejection; no new effects |
| Replay with another actor's device/session | Deny; retain original stored hash/result |
| Parallel last-admin membership/assignment changes | At least one usable admin remains; no HTTP 500 |
| Password accepted but network response lost | Never resend password from storage; resolve original status safely |

## Evidence to capture

- HTTP status + generic code (no secrets), current actor/outlet/tenant roles, number of row mutations in disposable fixtures; negative cases across manager/cashier/admin.
- `system.commands`, journal, stock, shifts, receipts, audit and outbox row counts/hashes before and after unauthorized probes.
- Target-specific frontend password inputs cleared on member change; no secret value in persisted browser journals.
- Test true session revocation after command authorizer has authenticated but before its transactional preflight, avoiding mock-only assertions.

## Completion criteria

- [ ] Authorization inventory exhaustively matches supported command types.
- [ ] Tests cover execution, status, exact replay, forged same UUID/different type, role downgrade and outlet switch.
- [ ] Zero unauthorized result disclosures and duplicate authoritative effects.
- [ ] Credential fencing/migration collision decided and documented, not silently skipped.
- [ ] CI/API/PostgreSQL/browser tests green, with no weakening of rate limits or last-admin guards.
- [ ] Prod untouched; security note documents remaining known limitations and threat assumptions.



---

> Source: `04_SPRINT_02_LOADING_AND_PERFORMANCE.md`

# Sprint 02 | Eliminate indefinite loading and actually measure performance

**Priority:** P0 · **Suggested effort:** 2–5 engineering days for stabilization, ongoing performance iteration · **Owner:** frontend/API/reliability · **Parallel with:** Sprint 01 diagnostics.  
**Status:** PR #18 adds 10-second slow warnings, 20-second GET deadlines, request IDs, timing telemetry, response validation, cancellations and many view-level retries. Its current CI has not run the required browser stages. **The underlying production `/configuration` stall remains unproven.**

## Non-negotiable user-facing contract

Every **connected** MAZAO route, including login/session restoration, Today, Sell, Sales, Stock, stock count, Purchasing, Hotel/Reservations, Customers, Shifts, Money, Reports, Manage, Staff, Assignments, My Account and CSV import must have:

- **State machine:** `idle → loading → usable|empty|error|offline|unauthorized|cancelled`, with a slow warning during loading. No dependency may leave the page permanently awaiting data.
- **Explicit bounded reads:** warning after 10 seconds, 20-second overall GET deadline including body consumption, visible retry, request ID and a failure message without raw sensitive response.
- **Honest partial rendering:** the independently loaded catalogue remains visible if stock movements fail; Staff/Assignments work if configuration GET fails; Today shell needn't await shift data.
- **Safe concurrent navigation:** cancel obsolete GET requests on route/filters/unmount; ignore stale responses with generation guards; preserve unsaved forms and in-flight commands.
- **Financial mutation discipline:** 30-second request deadline may return `OUTCOME_UNKNOWN`; retained original command and status inspection are mandatory. Never silently retry with new UUID.
- **Accessibility:** `role=status` for progress, `role=alert` for failures, keyboard-operable retry, visible focus, no multi-minute screen reader announcements.
- **Recovery durability:** do not delete IndexedDB, service-worker caches or pending command records as an indiscriminate 'loading fix'.

## Confirmed incident data, not assumptions

- Browser `GET /api/v1/auth/me` returned HTTP 200 in an authenticated session.
- `GET /api/v1/configuration` once delivered malformed JSON around character 163,546.
- The same endpoint later delivered a **683,935-byte**, HTTP 200, byte-consistent, valid JSON body.
- Another request aborted after 10 seconds before successful body completion.
- Service worker was active in Firefox. No end-to-end trace yet attributes fault to PostgreSQL vs Bun/Fastify vs Nginx vs browser.
- `main` auth middleware unnecessarily projected `t.business_profile` into every authorized read; PR #18 projects tax policy instead. That is a confirmed optimization, **not proof of the 10-second stall's cause**.

## Work package A: route inventory and UI loader review

Use `src/app/featureRegistry.ts`, the route component tree and `docs/43-LOADING-STAFF-BUILDOUT-STATUS-2026-10-16.md`. For every connected workspace record:

| Dimension | Required information |
|---|---|
| Initial reads | Endpoint sequence and waterfall/dependency edges |
| Permission | Role, capability and selected assignment required |
| Starting state | skeleton, loading label, editable controls enabled/disabled |
| Failure state | 401, 403, 429, 500, missing fields, invalid JSON, truncated body, offline, timeout |
| Actions | retry read, copy safe request ID, access recovery, sign-in or permission explanation |
| Navigation | abort on leave, preserve unsaved edits, retained command evidence |
| Performance | JS chunk, TTFB, body duration, parse, first usable state, request bytes |

Document each in the test matrix (file 08); add tests for the untested entries in `docs/43`. Never count a disabled restaurant card as a loaded server-backed restaurant module.

## Work package B: shared `apiClient` correctness

Review actual `src/services/apiClient.ts` on PR #18 rather than replacing it wholesale. It already defines `READ_TIMEOUT_MS=20_000`, slow warning, `ApiClientError`, `x-request-id`, server timing, response-shape checks and request cancellation.

Checklist:

1. Timeout covers both **fetch headers and response-body reading**, not just the header wait.
2. JSON failures throw explicit `INVALID_SERVER_RESPONSE`. Do not turn HTTP 200 into `{}` or `[]`.
3. A `401` that genuinely means authentication expired ends the session and shows sign-in; a `403` keeps the authenticated session while explaining permission denial. Neither should spin forever.
4. A `429` login response surfaces backoff and Retry-After; the rate limit is not bypassed.
5. Independent GET clients accept `AbortSignal`; aborted old route requests cannot update new route state.
6. Never use a GET retry mechanism automatically on mutations, credential uploads or commands.
7. Slow banner cleans itself up on success/failure/navigation; multiple simultaneous requests are aggregated rather than racing banners.
8. No PII, cookies, credentials, image contents, bearer tokens or raw response bodies in telemetry or public error IDs.
9. POST asset uploads and generic business commands must have **separate** retry contracts (idempotent upload draft vs unknown authoritative command).
10. Keep local pending command metadata until server confirms final status; 404 alone may be insufficient for secret operations.

## Work package C: three-hop `/configuration` diagnosis

**Never use real production credentials in command lines pasted to chat or committed tests.** In a controlled disposable environment, replay a tenant with both large 512 KiB PNGs, Unicode names and representative history. On the production system, collect only read-only metadata and sanitized timings under an authorized session.

### Hop 1: DB and API

- Inspect `pg_stat_activity`, transaction wait events, pool active/idle/waiting, slow queries, PostgreSQL logs, and `pg_column_size`/`octet_length` of image fields (sizes only). Do **not** output image strings.
- Instrument `pool.connect()` wait, auth preHandler SQL duration, `getConfiguration` subquery durations, JSON serialization and first-byte time. Prefer `Server-Timing` and safe request IDs.
- Examine snapshot transaction: capability count queries, initial readiness count subqueries, repeated `currencyLocked` EXISTS checks. Only optimize confirmed expensive paths; check indexes and query plans with disposable data.
- Measure serialized full profile vs projected `business_profile->'taxPolicy'`, and compact configuration vs legacy body. Test Unicode byte length.

### Hop 2: API container → Nginx

- On **disposable/staging**, compare direct API and reverse-proxied authenticated requests to the same fixture. Record HTTP status, TTFB, total, content encoding, byte length and digest, unique safe ID.
- If upstream complete and proxy truncates: examine `proxy_read_timeout`, buffering, upstream keepalive, premature close and HTTP framing. Avoid changing shared/global Nginx for other apps.
- If API itself stalls: investigate DB waits, Bun/Fastify, serialization and event loop under load.

### Hop 3: Nginx → Firefox PWA

- Use a controlled Firefox profile with and without service-worker interception (do not clear operator's actual IndexedDB), then Chromium desktop/mobile emulation.
- Repeat 30 cold/warm requests with a cache-busting query string; capture status, timing, byte count and JSON digest only. Tests should include Unicode and interrupted bodies.
- If response is intact but React page stays blank/spinning, inspect the state machine, stale request cancellation, render exceptions, content-security errors and workspace dependency waterfalls.

## Targets (provisional SLOs; baseline required)

| Measure | Target in documented reference setup |
|---|---|
| Typical configuration **metadata** JSON | <=32 KiB (existing PR fixture asserts this) |
| `GET /configuration` p95 | <=1.5 s at defined 30+ request baseline |
| Implemented common workspace p95 first usable | <=3 s, with 10 concurrent simulated operators |
| Slow-read user warning | At 10 s, with safe request ID |
| Ordinary GET terminal deadline | 20 s including headers and body |
| Non-financial error behavior | Visible useful error and functional Retry, never infinite spinner |
| Confirmed transaction | Status and receipts correct under lost response and repeated recovery |

Targets must state environment, fixture sizes, device/browser, request count, warm/cold condition, p50/p95/p99 and error rate. A fast mock does not substantiate a production SLO. If p95 misses the target, document the bottleneck and require another measured iteration before declaring performance complete.

## Failure injection matrix

For every connected workspace simulate: delayed headers, delayed body, truncated JSON with 200, invalid response shape, offline before and during GET, `401`, `403`, `429`, `500`, stale response after navigation, SW update/reload, concurrent operations and abandoned route. For stock, payment, shift, staff, hotel mutations also inject **response lost after commit** and prove exact original command recovery.

## Tests and source locations

- `e2e/configuration.spec.ts`: malformed JSON, warning, Retry and performance metadata, preserve Staff independent of configuration.
- `e2e/workspace-recovery-readiness.spec.ts`: reload, route change, local recovery, correct status locator scopes.
- `e2e/integration/configuration.spec.ts`, `staff-access.spec.ts`, `stock-count.spec.ts`: production-shaped PostgreSQL flows.
- `src/components/home/BackendTodayWorkspace.tsx`, `inventory/BackendInventoryWorkspace.tsx`, `inventory/BackendStockCountWorkspace.tsx`, `procurement/ProcurementWorkspace.tsx`, `hospitality/BackendHotelWorkspace.tsx`, `shifts/ShiftManagerView.tsx`, `manage/BackendManageWorkspace.tsx`, `AppShell.tsx`.
- Audited but not fully validated route matrix: `docs/43-LOADING-STAFF-BUILDOUT-STATUS-2026-10-16.md`.

## Done gate

- [ ] A root cause or narrowed causal boundary for intermittent config delay/truncation is documented with before-and-after evidence.
- [ ] Every connected route reaches a terminal usable/empty/error/offline/auth state within its contract; no silent swallowing of malformed JSON.
- [ ] State preserved across errors, refresh, cancellations, installation and session expiry.
- [ ] Real Firefox/Nginx/Bun and Chromium/staging acceptance run; representative datasets and network profiles recorded.
- [ ] Measured p95 targets met or formally blocked with explicit owner and incident reproducer; avoid claim of performance success from only timeout logic.
- [ ] Security and command integrity regression passes, including lost response after authoritative commit.



---

> Source: `05_SPRINT_03_CONFIGURATION_ASSETS.md`

# Sprint 03 | Configuration PNG assets, schema 017 and receipt compatibility

**Priority:** P0 for data integrity, P1 for optimization · **Suggested effort:** 2–4 focused days including upgrade tests · **Depends on:** Sprint 00 green + Sprint 02 instrumentation.  
**Status:** PR #18 contains `apps/api/migrations/017_configuration_assets.sql`, `configuration.ts` staged PNG handling and authenticated asset routes. This is **candidate** code. Deployed `main` is still at migrations 001–016.

## Problem and required outcomes

Current deployed configuration may carry base64 PNG data inline with every business settings response. The operator observed a **683,935-byte** successful JSON body, a prior malformed body and a >10-second configuration read. This creates avoidable transfer/memory costs; it does not prove why a specific response stalls.

A robust design returns **small settings metadata** and serves image bytes by separate authenticated URLs. **All existing stored images must continue to render; reprints of historical receipts must preserve original evidence after edits.**

## Current candidate architecture

- `017_configuration_assets.sql` introduces `core.configuration_assets` with `tenant_id`, `kind` (`logo|receipt_qr`), `draft_id`, bytea `content`, SHA-256, byte length, `PENDING|ACTIVE|RETIRED`, timestamps, uniqueness of active asset by tenant+kind and deduplicated draft IDs.
- `POST /api/v1/configuration/assets` stages PNG bytes with protected session and CSRF. Same draft ID + same content is an idempotent success; same draft ID + different content is a conflict.
- `GET /api/v1/configuration/assets/:assetId` serves authenticated `image/png` by tenant scope with `Cache-Control: private, no-store`. `GET .../assets/legacy/logo` and `/legacy/receipt_qr` are supported in the candidate backend for existing inline data.
- `GET /api/v1/configuration` removes large legacy image fields from the SQL-projected JSON, returning reference URLs and essential business/outlet/capability/readiness metadata.
- `configuration.business.update` supports explicit `imageActions.logo|receiptQr` of `keep|remove|replace`, staging and active/retired transitions in a transaction. It must never remove stored images when unrelated business fields are saved.

## Required implementation review

### Schema and compatibility

- Test **fresh install**, upgrade from schema 016 with a representative active business and inline PNGs, and **idempotent migration rerun**. Applied 001–016 checksums must remain unchanged.
- Reconcile migration 017 against separate credential-operation fencing work. Neither `017_configuration_assets.sql` nor a future `017_*` can coexist under the runner's list as applied duplicates. Choose distinct numbers **before either is applied in production**; do not rename an already applied migration.
- Ensure tenant-scoped asset foreign keys and access checks; prevent cross-tenant image retrieval and stage draft reuse. Review whether lower-privilege users may read receipt QR and logo, aligned with legitimate receipt usage.
- Confirm authorized `config.manage` is required to stage/upload and activate/remove assets. Audit decisions are tenant and actor specific.
- Avoid materializing base64 images into response logs/audit/outbox; use asset IDs, hashes and changes of state only.
- Set retention/GC rules only after confirming no historical document or active configuration references an asset. Never delete `ACTIVE` or receipt-referenced assets as routine orphan cleanup.

### Image validation and performance

- Validate proper PNG signature, chunk structure/CRC, dimensions, byte upper bound **512 KiB**, and safe decompression ceiling. Reject invalid/truncated payload, SVG masquerade and decompression bombs.
- Check base64 transfer expands payload to ~4/3; ensure route-specific body limits and supported form behaviors under PNG max size.
- Browser upload must use draft UUID and must show staged/upload failed/unknown/saved status, not silently drop image. Validate an asset is staged for the **same tenant and kind**.
- `keep` + empty non-image fields must not remove image refs; `remove` must be deliberate, separately reviewable and version-checked. Concurrent editors should receive version conflict, not overwrite each other silently.
- Test external HTTPS logo URL behavior separately from uploaded PNG. Do not allow `javascript:`/HTML/SVG injection via URL fields.
- Return compact metadata to browser and load image bytes lazily. Keep all existing business settings forms and visual layout stable.

### Immutable receipt evidence

- The sales/receipt projection may snapshot logo/QR identity and tax configuration. Test a receipt created with logo/QR A, then replace with B or remove current settings, then reprint prior sale. Original identity/QR representation must remain identical or an explicitly documented immutable reference must resolve.
- Verify current receipt images render in browser and printer preview, without re-embedding megabytes in common settings responses.
- Never rewrite posted receipts, shift close reports or financial evidence to make migration easier.

## End-to-end acceptance scenarios

1. Existing production-shaped tenant on 016 has inline logo and QR. Apply 017 to cloned disposable DB; GET metadata references `legacy` routes; both bytes/digests match previous PNGs.
2. Stage maximum allowed PNG logo/QR separately. Same draft id+same bytes returns same stage; altered bytes with same ID returns 409; wrong tenant denied.
3. Save `replace` both images as explicit business command; GET metadata **<32 KiB**, URLs resolve and images render; checksum/hash checked.
4. Update phone/tax/receipt footer with `keep` actions; images remain intact.
5. Remove only QR with explicit `remove`; logo remains; historical receipt QR still resolves.
6. Concurrent business changes obey versions; rejected edits do not activate uncommitted assets.
7. Two simulated staff roles receive only authorized business/asset reads, no mutation access when unauthorized.
8. Interrupted staging response retried with **same** draft ID; never create contradictory active assets or expose base64 in logs.
9. Route through actual Bun API container and Nginx for body-length/timing measurements with Unicode and PNG fixtures.
10. Upgrade→rollback-app compatibility assessed: older API may not understand new asset references, even if schema migration is additive. Define compatibility behavior before production cutover.

## Evidence gates

- [ ] Upgrade/fresh/rerun migration checksum tests green (001–017 or uniquely renumbered manifest).
- [ ] `configuration-assets.integration.test.ts` and `configuration.integration.test.ts` cover max PNG, keep/replace/remove, legacy, audits, role/tenant, receipt snapshots.
- [ ] Compact settings response measured, slow-repro trace compared against old implementation.
- [ ] No business logo/QR lost; no financial document rewritten.
- [ ] API smoke + real browser image checks green in CI before publication.
- [ ] Migration/rollback readiness recorded; no live DB modifications without fresh restore-verified off-host backup.



---

> Source: `06_SPRINT_04_STAFF_PROVISIONING.md`

# Sprint 04 | Finish People & Access, operator provisioning and role transparency

**Priority:** P1 · **Suggested effort:** 2–5 focused engineering days · **Depends on:** CI, security and bounded reads.  
**Status:** Server-backed Staff and Assignments are in production; PR #18 adds a guided four-step setup and fixed-role access matrix. The candidate still requires hosted browser and human first-use acceptance.

## Actual supported identity model

- `identity.users`: global unique identity and password credentials.
- `identity.memberships`: tenant-scoped role and display name, active flag and version.
- `identity.devices`: logical operator ↔ outlet workspace assignment. **Not a hardware-bound device enrollment or printer pairing mechanism.**
- `identity.sessions`: revocable sessions scoped to active assignment/tenant/outlet. Password change/reset revokes relevant sessions.
- `ROLE_PERMISSIONS` in `apps/api/src/contracts.ts`: fixed coarse backend grants, **not editable custom RBAC templates**.
- Admin/owner have staff and assignment write rights; manager has relevant read access; cashier lacks staff administration. Storekeeper can count but cannot approve/post stock counts.
- Roles `waiter`, `cook`, `bartender` are currently not assignable by the staff API because supported server workflows/permissions are absent. Receptionist/housekeeper require hospitality capability.
- The documented production secret `CREDENTIAL_FINGERPRINT_KEY` is required for credential operations; it must remain stable across releases and restores.

## User journey to make unmistakable

1. **Create identity and tenant membership:** display name, unique email, allowed fixed role. Output identity ID and `hasCredential=false`.
2. **Set initial password:** protected credential endpoint, server-provided `credentialVersion`, password 12–256 chars, exact command ID. Never store password in reusable browser journals or URLs.
3. **Create logical workspace assignment:** active outlet, assigned member, human-readable label such as `Front Desk POS`; server checks `devices.manage` and tenant-scope version.
4. **Verify actual sign-in:** operator authenticates with assigned account, selects a valid assignment if several, and server confirms active session. Status shows `ready`, `awaiting first sign-in` or concrete incomplete reason.

New PR #18 UI uses `sessionStorage` to remember **only** user ID and wizard step. Server, not browser state, is authoritative about password/assignment/session completion. Confirm a switch to another staff member cannot carry over unsaved credentials.

## UX requirements and design-preservation rules

- Preserve MAZAO's existing dark shell, typography, spacing, borders, control styles and layout. Reorganize discoverability only where directly beneficial; do not remove existing Staff/Assignments tabs or break URLs/navigation.
- Top-level Manage can show a concise **People & Access** summary linking to Staff, Assignments, effective roles, sessions and My Account. Keep useful existing sections intact.
- Staff directory cards show: full display name, email, fixed role, membership state, credentials present/missing, number of active assignments, active sessions, version and honest next action.
- Selected member detail and credential panel must be `key`ed/scoped by `userId`. On target switch or unmount: clear all password inputs and stale notifications. Block navigation while secret POST is in flight.
- Distinguish user disabled vs no password vs no assignment vs expired session vs wrong role. Avoid generic 'access settings missing'.
- Progressive setup with retry/resume after reload; wizard cannot claim complete solely because local step says complete. When server marks session active, confirm original operator and outlet.
- Roles/permissions display is **read only** until tenant-scoped custom RBAC design, schema, authoritative middleware and negative tests exist. Never offer decorative checkboxes that imply grant management.
- When Manager opens read-authorized section, show controls read-only instead of a broken wizard. For cashier, provide own My Account sessions/password only, not unauthorized staff directory.
- Pagination/search is required for >500 members before scaling to large tenants; current API returns at most 500. Scope to future release if not needed for pilot, but show that as a limitation.

## API and code tasks

- `GET /api/v1/staff`, `GET /api/v1/devices`, `GET /api/v1/staff/:userId/sessions`, `GET /api/v1/auth/sessions`: honor roles, current server state, tenant/outlet scope, sensible empty values, request IDs and bounded reads.
- Commands `staff.member.create/update/set_active`, `devices.assignment.create/update/revoke`, `staff.sessions.revoke`, `auth.session.revoke`: keep optimistic versioning, tenant transaction lock and last-admin/open-shift protection.
- `POST /api/v1/staff/:userId/password`, `/auth/password`: protected CSRF, no ordinary command payload secret, idempotent accepted/replayed response handling, version and session revocation.
- Password target-specific UI in `PasswordOperationPanel.tsx`; session details in `OperatorSessionsPanel.tsx`; recovery in `identityUi.tsx` and `useCommandRecoveryReadiness.ts`.
- Audit event and outbox must identify who changed whom, in which tenant/outlet, before/after role/activity/assignment, reason, not password contents.

## Required matrix

| Actor | Staff view | Staff write | Assignment view/write | Own account | Expected |
|---|---|---|---|---|---|
| Admin / Owner | yes | yes | yes/yes | yes | Full staged provisioning + last-admin limits |
| Manager | yes | no | yes/no | yes | Explain restricted edits, 403 on forged POST |
| Cashier | no | no | no/no | yes | Own sessions/password only |
| Storekeeper | no | no | no/no | yes | Can count, cannot approve count |
| Receptionist | role-dependent | no | no/no | yes | Hospitality capability rules honored |
| Cross-tenant actor | no foreign data | no | no/no | own only | Sanitized 404/403, no enumeration |

## Acceptance matrix

- [ ] Brand-new staff account created, initial password set, active outlet assigned and first actual sign-in completed (real API+PostgreSQL+browser).
- [ ] Account without password or without assignment cannot sign in and the UI shows exact missing step.
- [ ] Role change impacts effective permissions immediately; manager/cashier forged writes are denied by API.
- [ ] Revoked membership, assignment or credential invalidates active sessions and blocks subsequent operations.
- [ ] Two-admin simultaneous removals/transfers cannot strand the business; open till blocks reassignments where applicable.
- [ ] Changing selected person during password edit clears secret input; pending requests cannot target the wrong account.
- [ ] Interrupted password POST preserves metadata-only original-operation recovery; no password persisted in logs/storage.
- [ ] Server-read failure exposes retry with bounded state; Staff/Assignments still load even if `/configuration` is down.
- [ ] Keyboard/mobile/tablet usability, accessible labels and visual parity snapshots pass without generic redesign.
- [ ] Verified with owner/admin, manager and cashier accounts in disposable data and a controlled pilot walkthrough after release.

## Explicit non-goals

Custom per-permission editing, hierarchical job roles, branch-defined grants, first-login mandatory expiry, HR/payroll, hardware pairing, printer enrollment and restaurant waiter/cook/bartender operational grant sets. Put these on the full-v1 roadmap only when server workflows exist and an authorization model is reviewed.



---

> Source: `07_FULL_V1_SPRINT_ROADMAP.md`

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



---

> Source: `08_TEST_MATRIX_AND_PERFORMANCE_BUDGETS.md`

# MAZAO | Regression, acceptance and performance evidence matrix

**Rule:** a missing test, skipped required check, unmeasured SLO or failure masked by stubs is NOT a pass. Record exact SHA, browser/runtime, database fixture, run timestamp, pass/fail/skips and artifact links. Never run destructive tests on production.

## Evidence tiers

- **L0 static:** source review, typecheck, schema diff, unit tests.
- **L1 disposable API+PostgreSQL:** migrations, actual SQL constraints, concurrent requests and monetary invariants.
- **L2 browser+real API+PostgreSQL:** authenticated users, recoverable commands, navigation and responsive surfaces.
- **L3 production-image/proxy/staging:** Bun container, Nginx framing, Firefox installed PWA/service worker, degraded networks, realistic sizes.
- **L4 live non-destructive smoke:** verified release identity, readiness and read-only selected business screens, tenant isolation and operator sign-in. Never generate fake stock or sales in the real business.

## Required CI stages

| Stage | Command/job | Gate |
|---|---|---|
| Install | `bun install --frozen-lockfile` | Lockfile unchanged unless reviewed |
| Fresh schema | `bun run db:migrate` on disposable DB | All migrations apply, no collision |
| Rerun | `bun run db:migrate` same DB | Checksums match |
| Typecheck | `bun run typecheck` | 0 errors |
| API | `bun run test:api` | All required real-DB cases green |
| Browser | `bun run test:e2e` | All supported UI tests green |
| Real DB browser | `bun run test:integration` | All accepted journeys green |
| Image | `.github/workflows/ci.yml` publish-api-image job | Container smoke, key guard, 429, readiness green |
| Promotion | main push with both build jobs green | Immutable API/PWA same full SHA |

The latest candidate CI run `39040137815` stopped at `test:api` (93/95), skipping browser/image stages. **Do not infer those stages passed because earlier local docs recorded success.**

## Critical business invariant cases

| Case | API+DB | Real browser | Assertions |
|---|---|---|---|
| Mixed stock count gains > losses | yes | yes | Gross debit/credit lines one-sided, balanced journal, exact quantity/value |
| Mixed gains = losses | yes | yes | Both gross adjustments retained, no net-value shortcut losing evidence |
| Stale count after sale | yes | yes | Explicit conflict, physical draft preserved, no partial mutation |
| Existing 74-line unposted count | simulated clone only | controlled | No automatic reset or opening import overwrite |
| Sale lost response after DB commit | yes | yes | Original command ID replay, one order/payment/journal |
| Same UUID different payload | yes | yes | Safe idempotency mismatch/rejection |
| Staff cross-actor status lookup | yes | yes | Sanitized 404, no result data leak |
| Last-admin concurrent changes | repeat race | yes | One admin remains, no 500 |
| Password reset after response lost | yes | yes | No secret persisted; original status fenced |
| Configuration large PNG/Unicode | yes | yes | Exact asset bytes, small GET, no truncated JSON |
| Receipt after logo/tax/settings changed | yes | yes | Historical snapshot reprints unchanged |
| Hotel midnight/DST/timezone | yes | yes | Calendar date text accurate, no accidental day shifts |
| Customer statement concurrent posting | yes | yes | Consistent snapshot, balance/source match |
| Session revoked while loading | yes | yes | Sign-in/error transition, no stale privileged data |
| Role downgraded during write | yes | yes | Transaction-time denial, history still readable per policy |

## Per-route read fault matrix

Run per **connected** route, not mock-only smoke:

| Fault | Expected UI result | Safe retry? |
|---|---|---|
| HTTP 200 valid empty record/list | Honest empty state | yes when refreshed |
| HTTP 200 truncated JSON | Invalid-response error; no empty fake data | GET yes |
| HTTP 200 wrong shape | Invalid-response error | GET yes |
| 401 | Auth lost; sign in; don't treat as no records | after auth |
| 403 | Permission denied, session retained | after authorized change |
| 429 | Visible throttling/backoff | respect Retry-After |
| 500/502/504 | Available portion remains usable; error with request ID | GET yes |
| Headers delayed 11 s | Slow warning, still waiting within deadline | GET yes after failure |
| Body stalls to 20 s | Terminal timeout and retry | GET yes |
| Offline before fetch | Offline message / retry after reconnect | GET yes |
| Navigate away mid-read | Cancel request, no stale UI overwrite | not required |
| Service worker upgrade | Correct assets/version and local command journal intact | recover |
| POST response lost **after commit** | Outcome unknown + retained original UUID | status or identical replay only |

## Latency budgets, measurement methodology

These are **targets**, not existing measured guarantees:

| Signal | Budget | Sample method |
|---|---|---|
| `/configuration` compact body | <32 KiB for representative configured tenant | Body bytes over 30 reads |
| `/configuration` p95 | ≤1.5s | 30+ GETs, warm/cold separately |
| Common route first usable p95 | ≤3s | 10 concurrent operators, real fixture data |
| Read slow warning | 10s | Inject 11s header/body waits |
| GET max wait | 20s incl. body | Inject never-ending stream |
| Business mutation unknown outcome | visibly fenced after 30s client deadline | Delay commit response then status query |
| Integrity/error rate | 0 truncated-success bodies and 0 silent blanking in sampled test | Compare byte/digest and JSON parse |

Collect per request: route template, browser/runtime version, status, service-worker state, warm/cold flag, response `content-length`, actual bytes, TTFB, download/body time, JSON parse time, first usable render, total time, database size profile and server app timing header. Calculate p50, p95, p99 with actual observations and attach summaries; don't print cookies, names, image data or raw HAR publicly.

## Reference fixture profile

Prepare **disposable** tenant(s) with: 1/10/500 staff, at least two outlets, 1,000 product rows, 74 stock count lines including mixed variances, 10,000 inventory movements (or a documented bounded substitute), realistic shift/order/customer history, 100+ booked hotel nights, maximum supported PNG logo and payment QR, Unicode names and varied role permissions. Derive distribution only from safe synthetic data, not production PII. Add both cold and warm browser cache fixtures.

## Accessibility and UX checks

- Seven PRD viewports plus desktop, tablet and phone touch input; check Staff, Manage, stock counts, Sell and hotel screens.
- Keyboard-only navigation to Retry, field errors and protected confirmation; visible focus; ARIA live announcements not duplicated.
- Large image/media + slow network must not block all settings tabs.
- Screen must never display 'Loading...' permanently; timeout and Retry are observable in the DOM and by assistive technology.
- Current visual style/spacing/cards/menu must remain equivalent. Store before/after screenshots in test artifacts.

## Release evidence worksheet

```text
Candidate commit SHA:
Main ancestry reconciled: YES / NO
Migration list and checksums:
Schema upgrade source + destination fixture:
Typecheck:
API tests (pass/fail/skips):
Mock browser (pass/fail/skips):
Real API/Postgres browser (pass/fail/skips):
Production Bun container job:
Firefox + Nginx + SW delayed-response tests:
Before/after p50/p95/p99, config bytes:
Auth/command replay/cross-actor evidence:
Staff provisioning owner-manager-cashier matrix:
Receipt/logo/QR and stock count preservation:
Off-host encrypted backup timestamp + restoreVerified:
Deployment SHA / previous SHA:
Unrelated services verification:
Decision: PASS / HOLD / ROLLBACK
Reviewed by:
```



---

> Source: `09_NON_DESTRUCTIVE_RELEASE_AND_ROLLBACK.md`

# MAZAO | Non-destructive production release and rollback runbook

**Use only after all other sprint gates pass.** This document describes a procedure; it does not authorize immediate execution, assert that PR #18 is green, or substitute for a live operator's permission. Target: MAZAO's isolated Compose project on VPS `93.127.131.55`. Other stacks sharing the VPS must not be touched.

## Architecture verified during previous release

- MAZAO installation `/srv/mazao`, Compose project `mazao`, `.env` and `compose.yml`.
- API `mazao-api-1` exposed via loopback `127.0.0.1:4101`, PostgreSQL `mazao-db-1` using named volume `mazao-postgres-data`.
- Frontend symlink `/var/www/mazao/current` points to versioned `/var/www/mazao/releases/<sha>`.
- Public app `https://mazao.davemusau.co.ke`; health `GET /api/v1/health/ready`.
- `infra/activate-release.sh` verifies two archives, checks image source revision, installs a new static directory, preserves env/PWA rollback references, migrates and restarts **only** MAZAO API, switches symlink and checks readiness.
- Last operator-verified deployment: `872514217272c154236fcab02bfda11417dd5dff`. Re-check the live state before any future release.

## Preflight and no-go checks

1. **Merge and test exact code first.** PR #18 must be green after reconciliation and review. Artifact names are generated only for passing `main` pushes, not arbitrary PR commits. Record promoted `NEW_SHA` from the successful `main` Actions run. The old artifact IDs and hashes from `8725142` are **not reusable** for a new release.
2. **Schema compatibility.** Inventory all candidate migration versions and SQL checksums (PR #18 adds `017_configuration_assets.sql`; other work may also propose 017). Verify *new* migration numbering before application. Additive migration does not imply the **old API** can read all new data: test rollback-app compatibility explicitly.
3. **Backup.** Use the existing `infra/Backup-Mazao.ps1 -VerifyRestore` from **local Windows PowerShell**, not Ubuntu Bash. Require `restoreVerified: true`, no unbalanced journal control totals and retain the encrypted DPAPI backup off-host. Store backup metadata, not credentials, in release ticket. The Windows DPAPI key depends on the creating account and its recovery material.
4. **VPS read-only check.** API/db Compose health, current image SHA, PWA target, disk/RAM, `nginx -t`, and independent services. Resolve any active production incidents before cutover.
5. **Business acceptance.** Existing unposted 74-item physical count remains in progress; no automated count close/post. Confirm current QR/logo/reprints and staff accounts before migrating asset model.
6. **Change window.** Inform operators of a possible brief MAZAO-only API interruption. Do not reboot Ubuntu or apply unrelated system/Compose updates during release.

## Phase 1: discover and verify release artifacts

- CI workflow: `.github/workflows/ci.yml` (jobs `TypeScript and production build`, `Validate API container and publish main releases`).
- Required artifact names: `mazao-api-image-<NEW_SHA>` and `mazao-pwa-<NEW_SHA>` from the **same passing `main` run**.
- Use `gh` with authenticated GitHub API to download each artifact. GitHub's artifact ZIP may wrap `mazao-api-image.tar`; preserve the exact canonical image identity.
- Compare API ZIP bytes against GitHub-provided digest where available, then compute `sha256sum` on the zip staged on VPS. Extract/build PWA tar locally, compute its new SHA256, and compare VPS upload checksum. Never reuse hash of an old tar for a new PWA.
- Fetch the **exact** `infra/activate-release.sh` from the new SHA, inspect its diff against previously approved script, and do not use a modified script from an unverified working directory.

## Phase 2: stage files without changing live services

Example read-only server inspection from Windows:

```powershell
ssh mazao-live 'cd /srv/mazao && cat release-sha && docker compose --project-name mazao --env-file .env -f compose.yml ps && readlink -f /var/www/mazao/current && sudo -n nginx -t'
```

Stage only the three **new** exact files under `/srv/mazao/incoming/` using `scp`. Verify file sizes and SHA256 on VPS. Confirm currently deployed `release-sha` still equals the expected old release. Stop if it has advanced or there is an unexpected existing release destination.

## Phase 3: controlled activation

The script usage is:

```bash
bash /srv/mazao/incoming/activate-release.sh <FULL_NEW_SHA> <NEW_API_ZIP_SHA256> <NEW_PWA_TAR_SHA256>
```

Only run the above with actual, independently verified current arguments and an approved change window. Do not run placeholders. The script migrates the database **before** it swaps API/PWA, then replaces only the API with `docker compose up -d --no-deps --wait api`; it does not recreate the DB.

Observe all migration output. If migration 017 fails or the API image health check fails, stop and inspect the script's rollback log. Don't repeatedly apply partially failed releases until state is inspected.

## Phase 4: immediate verification

```bash
cd /srv/mazao
cat release-sha
docker compose --project-name mazao --env-file .env -f compose.yml ps
docker inspect mazao-api-1 --format '{{.Config.Image}}'
readlink -f /var/www/mazao/current
curl --fail --silent --show-error http://127.0.0.1:4101/api/v1/health/ready
curl --fail --silent --show-error https://mazao.davemusau.co.ke/api/v1/health/ready
sudo nginx -t
```

Then, in a permitted authenticated **read-only** pilot session, verify: same business/outlet identity, existing products and balances, saved counts including user's 74-item open count, historical receipt and logo/QR, Staff/Assignments listing, fixed role matrix, Manage configuration latency, signed-in PWA freshness and request errors. Exercise new writes only in disposable/staging or an explicitly approved pilot procedure, not ad hoc on the real business.

## Rollback, recovery and migration caveat

`activate-release.sh` snapshots `.env` and previous PWA symlink, and on failure attempts to restore the former MAZAO API and static release. **It does not reverse database migrations.** It cannot guarantee the old API understands records transformed by a newer API, and it does not automatically recover off-host data loss. Do not claim complete rollback until database and application compatibility has been tested.

If activation fails:

1. Preserve entire output and timestamps. Confirm which step ran last and whether `release-sha` was rewritten.
2. Check only the MAZAO project's API, static symlink and migration state. Avoid `docker compose down -v`, `docker system prune --volumes`, `docker volume prune`, DB recreates or broad Nginx restarts.
3. Verify previous app is healthy and retained image exists; if rollback isn't healthy, stop and involve operator rather than hand-editing DB to match old source.
4. If a database restore is ever needed, restore to a **new isolated instance first**, verify command/journal invariants and operational data. Production replacement requires a separate controlled decision and downtime plan.
5. Recheck SERVEOS and all unrelated stack processes, routing and ports (without restarting them).

## Release record template

```text
Change ticket:
Operator approval:
Production old API/PWA SHA:
Candidate new SHA:
GitHub successful run URL:
API artifact ID/digest/local SHA256/VPS SHA256:
PWA artifact ID/source ZIP SHA256/packaged tar SHA256/VPS SHA256:
Migration list and 016→017 upgrade acceptance:
Credential-key continuity verified (yes/no, no secret value):
Off-host backup createdAt/restoreVerified/control totals:
Cutover started/completed UTC+EAT:
API readiness and symlink verification:
Read-only business check results:
PWA SW/version check:
Other VPS services verified:
Rollback path and backward compatibility verified:
Final disposition: SUCCESS / HOLD / ROLLBACK
```

## Banned shortcuts

- `docker compose down -v` or delete `mazao-postgres-data`.
- Global `docker prune`/volume cleanup or broad `docker compose up --force-recreate` across projects.
- Re-run bootstrap/seed over existing tenant data.
- Update `main`/GitHub CI from a release shell or use untested PR-built PWA against old API.
- Ignore red CI, assign new SHA/hash by guess, or manually edit immutable migration files.
- Delete live browser storage/IndexedDB or replace the saved count with opening quantities during a performance investigation.



---

> Source: `11_AGENT_HANDOFF_AND_PR_TEMPLATE.md`

# Codex handoff, review discipline and PR template

## Suggested agent deployment

For a single operator with Codex, run agents on **separate branch/worktrees**. Integrate via one owner, not several branches simultaneously editing shared `commands.ts`, `app.ts`, `configuration.ts`, or migration registry.

| Agent | Primary files | Explicit stop condition |
|---|---|---|
| A: CI + staff concurrency | `staff-security.integration.test.ts`, `staff.ts`, CI output | Any last-admin/security invariant violation |
| B: security/recovery | `commandAuthorization.ts`, `app.ts`, credential recovery tests | Any unauthorized command outcome or replay duplication |
| C: loading + instrumentation | `apiClient.ts`, `AppShell.tsx`, workspace loaders, E2E | Unknown-command state weakened or stale UI overwrite |
| D: configuration/media | `configuration.ts`, migration 017, asset tests | Migration conflict or logo/receipt loss |
| E: staff UI/acceptance | `StaffAccessWorkspace.tsx`, account panels, E2E | Password leaks, forged role acceptance, design regression |
| F: integration/release QA | package scripts, migrations, CI workflow, artifacts | Any red required check or production data path |

## Session 1 prompt (copy to Codex)

```text
Read 00_README_AND_RELEASE_GOALS.md, 01_CODEX_MASTER_EXECUTION_INSTRUCTION.md,
02_SPRINT_00_CI_AND_STAFF_CONCURRENCY.md and 08_TEST_MATRIX_AND_PERFORMANCE_BUDGETS.md.
Fetch origin; inspect main SHA 872514217272c154236fcab02bfda11417dd5dff
and feat/product-finishing SHA 0e350e0c695635949094acda3a9832e6c9f780de.
Use a new worktree and maintain current production unchanged.
Reproduce latest CI run 39040137815 staff-security concurrent-admin test.
Stage both preflight reads BEFORE the parallel command submissions;
keep real concurrent writes, live session revocation and last-admin invariants.
Run disposable PostgreSQL tests, typecheck, full API and GitHub CI.
Do not reduce authorization, change rate limits or skip the test.
Report changed files, SQL/HTTP behavior, pass/fail, blockers and PR evidence.
```

## Session 2 prompt

```text
Read 03_SPRINT_01_RECOVERY_AND_SECURITY.md and
04_SPRINT_02_LOADING_AND_PERFORMANCE.md.
Validate PR #18 same-actor/outlet command recovery against all command types,
role changes, session revocation and lost financial/credential responses.
Audit every implemented workspace's loading/failure/cancellation contract.
Instrument actual DB, Bun API, Nginx and Firefox for the intermittent
/configuration issue. Do not claim root cause based on a timeout patch alone.
Only use disposable synthetic fixtures; do not inspect live business credentials.
Write tests and attach quantitative before/after evidence for real regressions.
```

## Session 3 prompt

```text
Read 05_SPRINT_03_CONFIGURATION_ASSETS.md and
06_SPRINT_04_STAFF_PROVISIONING.md.
Test 017_configuration_assets fresh, upgrade from 016, rerun and rollback-app
compatibility; preserve old logo/QR and immutable receipt snapshots.
Check for competing migration 017 in credential-operation-fencing work.
Validate Staff create→password→assignment→real login, admin/manager/cashier
permission matrix and slow/offline UI; preserve current dark design.
No custom RBAC pretend-implementation, no physical device pairing claims.
Finish with full API, mock browser, real Postgres/browser and Bun-image CI.
```

## PR description template

```markdown
# Scope
- Objective / operator outcome:
- Baseline main SHA and candidate SHA:
- Changed files:

# Root cause and implemented approach
- Previously observed evidence:
- Root cause proven / boundary still unproven:
- Security or financial invariant affected:
- Alternative approaches rejected:

# Schema and backwards compatibility
- Migration file / checksum / applied state:
- Fresh/upgrade/rerun evidence:
- Compatibility with older API and PWA:
- Backup / rollback implications:

# Tests performed (exact unedited results)
- Typecheck:
- API real DB:
- Browser normal:
- Browser real API+DB:
- Container smoke:
- Production-shaped Firefox/Nginx performance:
- Visual regression/accessibility:

# Behavior matrix
- 401/403/429/500/offline/timeout:
- Actor/tenant/outlet permission negatives:
- Original command exact replay:
- Stock/receipt/journal preservation:

# Remaining blockers
- Unproven behaviors:
- Test skips:
- Production deployment: NOT PERFORMED

# Review
- Security/accounting owner:
- Operator UX owner:
- QA evidence URLs:
```

## Daily 15-minute stand-up template

Use `10_BACKLOG.csv` to update `owner`, `status`, `evidence_url`, and `blocker`; no fabricated percentages. Summarize blockers and next two smallest unblockers, not vague general statements.

```text
DATE / BRANCH / SHA:
GREEN GATES / RED GATES:
WHAT CHANGED (FILES):
ROOT CAUSE PROVEN OR STILL HYPOTHESIS:
EVIDENCE / LOGS / PERF NUMBERS:
NEW MIGRATION / COMPATIBILITY RISK:
NEXT 2 TASKS:
PROD UNCHANGED? YES / NO:
```

## Definition of done for an agent

**Done** requires tests and source evidence tied to a SHA. `Committed locally`, `Mocked demo works`, `CI not run`, `Looks good` and `No TypeScript error` are intermediate states. Distinguish P0 production pilot hardening from full v1 ERP completion. No one may invent a release or claim a server change without actual operator-verified execution.
