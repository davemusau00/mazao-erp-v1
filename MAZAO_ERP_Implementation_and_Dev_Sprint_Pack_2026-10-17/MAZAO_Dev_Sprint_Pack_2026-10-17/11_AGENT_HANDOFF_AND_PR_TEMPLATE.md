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
