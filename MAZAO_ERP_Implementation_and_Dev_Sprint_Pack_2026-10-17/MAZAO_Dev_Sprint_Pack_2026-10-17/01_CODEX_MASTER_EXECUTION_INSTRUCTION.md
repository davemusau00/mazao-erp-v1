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
