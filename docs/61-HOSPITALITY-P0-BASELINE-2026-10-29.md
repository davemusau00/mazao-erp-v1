# Hospitality P0 baseline and dependency evidence

Verified **29 October 2026, Africa/Nairobi**, at approximately **20:16 EAT**.
This records the starting evidence for the [hospitality-first master instruction](../MAZAO_ERP_P0-P4_MASTER_DEVELOPMENT_INSTRUCTION_2026-10-29.md).
It is a development baseline, not a production check or full-v1 acceptance.

## Exact source and CI identity

| Item | Live observation |
| --- | --- |
| Canonical remote main | `6119ee2d2043afca38b764b5a0750dd9cf75908c` |
| PR #24 | Open, not merged, not draft; `feat/codebase-truth-s01` targeting `main` |
| PR #24 remote head and original local HEAD | `e595d9789270192bcf6f37a28e8346b055e3c59d` |
| Latest exact-head workflow | [40917747989](https://github.com/davemusau00/mazao-erp-v1/actions/runs/40917747989), completed **success**, updated `2026-10-29T17:11:32Z` / 20:11:32 EAT |
| Exact-main workflow | [39417548593](https://github.com/davemusau00/mazao-erp-v1/actions/runs/39417548593), completed **success**, updated `2026-10-20T11:53:44Z` |
| Hospitality implementation branch | `feat/hospitality-p1-configuration`, created from the accepted PR #24 head above |
| Production application/schema | Not inspected; current running SHA and applied migrations remain unverified |

The branch tips were compared using `git ls-remote origin` and connected GitHub
PR metadata. The workflow and job results were read from GitHub, including the
decoded test logs. The connected commit-workflow reader filters to pull-request
events, so its empty main result was not treated as missing or failed CI;
`gh run list --commit <exact-main-SHA>` verified main's push workflow.

The master instruction's run-in-progress snapshot is superseded by this
completed green result. The earlier failures on `2055396` and `042643c` are
historical. No current required baseline check was red at inspection.

### Required candidate jobs and observed test results

| Evidence | Exact observed result |
| --- | --- |
| [TypeScript and production build, job 123602396223](https://github.com/davemusau00/mazao-erp-v1/actions/runs/40917747989/job/123602396223) | Success |
| Fresh migration and checksum-safe rerun steps | Both success, migrations 001–028 |
| UI and API TypeScript | Success |
| API tests | **244 passed, 0 failed, 0 skipped** |
| Chromium browser acceptance | **140 passed** in 2.6 minutes |
| Cross-browser desktop/mobile matrix | **36 passed** in 1.0 minute |
| Real API/PostgreSQL browser integration | **21 passed** in 49.9 seconds |
| [API production-container validation, job 123606155647](https://github.com/davemusau00/mazao-erp-v1/actions/runs/40917747989/job/123606155647) | Success; container build, migration/rerun, configuration rejection, readiness and login-throttle steps passed |
| Publishing candidate application/image | Main-only publication steps skipped on this PR workflow |

These counts describe the existing exact-head suite. They do not validate new
hospitality changes, unimplemented journeys, installed-PWA behavior, physical
devices, production data or a measured production performance budget.

## Migration, upgrade and recovery ledger

`git diff --name-status origin/main e595d978 -- apps/api/migrations` identifies
only additive SQL files 022–028. Published migrations 001–021 were not changed.
The migration runner lists all 28 versions, verifies recorded checksums and
supports a known-version `MIGRATION_TARGET` for isolated upgrade fixtures.

Every migration below was visibly applied and then reported `already applied;
checksum matches` in the green candidate CI log. The checksum column is the
12-character prefix printed by that fresh CI application, not a second full
checksum independently calculated in this audit.

| Migration | CI checksum prefix | Inspected upgrade/recovery scope and limits |
| --- | --- | --- |
| `022_credential_operation_fencing` | `90338eb5eb41` | Descriptor-backed credential reconciliation; original command fencing, concurrent arrival/reconciliation, delayed originals and actor/outlet/current-authority checks in `credential-fencing.integration.test.ts`. The older populated import upgrade compares original commands and posted evidence through the current migration set. Legacy commands without descriptors remain distinguishable. Passwords are not stored in browser recovery metadata. |
| `023_catalog_maintenance` | `041cb68bad80` | `catalog-maintenance-upgrade.integration.test.ts` upgrades populated 022 fixtures, preserves original product/receipt/stock/journal fields, keeps exact category labels and checks rerun. Ambiguous SKU identity and category normalization fail preflight without automatic repair. An older writer lacking canonical category identity is not an accepted rollback writer. |
| `024_catalog_item_kinds` | `7db9006c09b4` | `item-kinds-upgrade.integration.test.ts` upgrades populated 023 fixtures to current, preserves original fields and snapshots, defaults legacy goods and rejects nonstock physical writes. Prepared settlement remains blocked by `RECIPE_CONSUMPTION_UNAVAILABLE`; this baseline has no accepted recipe consumption. |
| `025_command_capability_evidence` | `7c39b0313b7a` | The populated item-kind upgrade verifies legacy authority version zero, capability backfill and unchanged original hashes/canonical responses. Runtime recovery uses trusted persisted requirements instead of later mutable item classification. `command-recovery.integration.test.ts` exercises current authorization and original-response recovery. |
| `026_count_recovery` | `13a318cfc63f` | `count-recovery-upgrade.integration.test.ts` upgrades populated 025 to 026 and reruns all 26 checksums. It preserves original fields, exact large values and surviving count evidence; labels legacy coverage `LEGACY_CHECKPOINT`; fences incompatible save/post/erase writers and rejects cross-scope or rewritten evidence. Historical saves overwritten before this migration cannot be reconstructed. |
| `027_scoped_blind_counts` | `3457c8021853` | Current `count-recovery.integration.test.ts` includes selected/blind scope, baseline confidentiality and outside-scope rejection, and passed in the green 244-test run. Full current-schema populated upgrades include this migration. No dedicated populated 026-to-027 migration-specific fixture was found during this audit; location authority remains unavailable. |
| `028_tenant_onboarding` | `a5335e59da20` | Current `tenant-onboarding.integration.test.ts` passed: setup route/command denial, reviewed readiness, successful go-live, persisted review evidence and foreign-tenant isolation. Existing tenants are backfilled `LEGACY_ACTIVE`, without invented historical review. Broad populated upgrades reach current schema, but the inspected onboarding fixture inserts its setup records directly; it does not exercise the private interactive bootstrap terminal. No dedicated populated 027-to-028 migration-specific fixture was found. |

The green logs explicitly include the populated count and item-kind upgrade
suites, credential fencing, selected/blind count acceptance, tenant setup and
authenticated context switching. Earlier local statements in docs/57–60 that
the disposable database was unavailable, or that exact-head CI was pending,
remain historical observations. They do not describe this completed workflow.

The context-switch API fixture verifies own active assignments, CSRF and strict
input, foreign assignment rejection without changing the current session,
successful tenant/outlet/device/role change, `/auth/me` recovery visibility,
session version and prior-scope audit. Its green result does not independently
prove simultaneous switches across tabs, every lost-response timing or physical
terminal enrollment.

### Remaining release and recovery work

- Review the combined schema/API compatibility boundary before activation.
  Catalog, item-kind and immutable count guards intentionally reject some old
  writer behavior; restoring an arbitrary earlier API against the new schema is
  not established as safe by a checksum rerun.
- Preserve any catalog preflight ambiguity for reviewed repair. No production
  collision was looked for or repaired during this audit.
- Add targeted migration-specific legacy-count/onboarding assertions when they
  are required by the release review. Current broad upgrade preservation and
  current-schema domain tests must not be relabeled as every possible upgrade
  or rollback scenario.
- Private-terminal bootstrap recovery, physical enrollment, complete outlet
  deactivation hazards and broader context-switch interruption/race acceptance
  remain separate checks where not exercised by the inspected fixtures.
- Production pre-activation identity/schema, fresh backup, independently
  isolated restore, rollback/recovery procedure and post-activation evidence
  remain unverified. No restore or runtime identity claim is inferred from CI.

## PR reconciliation and hospitality branch dependency

[PR #24](https://github.com/davemusau00/mazao-erp-v1/pull/24) is an explicit
dependency of `feat/hospitality-p1-configuration`. The hospitality work starts
from its exact green head, which includes migrations 022–028 and the existing
recovery/setup contracts. It is not based directly on main's tree. Any review
or later PR must identify that dependency and distinguish hospitality changes
from PR #24's changes. A new commit requires its own relevant validation and
exact-head CI; this baseline does not transfer green status to changed code.

Read-only PR metadata still shows [#13](https://github.com/davemusau00/mazao-erp-v1/pull/13),
[#14](https://github.com/davemusau00/mazao-erp-v1/pull/14),
[#15](https://github.com/davemusau00/mazao-erp-v1/pull/15) and
[#16](https://github.com/davemusau00/mazao-erp-v1/pull/16) open as drafts.
`git cherry -v origin/main <branch>` marks every extra patch on those branches
with `-`: login guards `4c6e742`/`e65c258`, mixed counts `4319b9a`, account access
`7cffafd` and hotel dates `69cbd21`. Their fixes are represented on main.
Recommended disposition is reviewed supersession with preserved evidence;
this audit did not close, merge, reapply or reset them. Repository protections
and rulesets were not re-audited in this checkpoint; older governance findings
remain historical until refreshed.

## Restaurant and hotel source gap map at the accepted baseline

This table is anchored to `e595d978`, before new hospitality edits. It records
missing contracts without treating the unreachable preview as an implementation.

| Operator outcome | Baseline source and missing dependency |
| --- | --- |
| Configure tables/sections/stations/menu routing | `src/app/featureRegistry.ts` declares service `not_connected`. No durable table/station/menu-routing domain or command exists. Catalog products and logical staff/outlet assignments are reusable foundations. |
| Authorized waiter and station work | `apps/api/src/contracts.ts` gives waiter/cook/bartender empty permissions. No station assignment/feed scope or expeditor role/authority exists. Logical `deviceId` assignments do not prove physical station-device enrollment. |
| Save/edit/hold/fire a source order | `src/components/service/FoodServiceWorkspace.tsx` keeps preview tables, lines and ticket states in React memory and reads preview storage. It is not mounted as the connected service workspace. Stable source order/line IDs, versions, immutable fire revisions, retry recovery and settlement linkage must be implemented. |
| New/add-on/void KOT or BOT | No durable station ticket batches, document hashes, cancellation notices, copy reasons or ticket print-attempt records exist. Firing must not reuse the local preview transition as evidence. |
| Live KDS preparation and serve | No authorized station queue, source preparation transitions, reconnect/refresh mechanism, immutable cancellation/reopen audit or stale read-only offline policy exists. |
| Station 80 mm print and controlled reprint | `src/components/hardware/BackendReceiptModal.tsx` prints a confirmed customer receipt through `window.print()` and a fixed 76 mm stylesheet. `src/services/hardware.ts` is preview hardware support. Neither provides an accepted KOT printer profile/queue or proof of physical output. |
| Settle the same restaurant source once | Existing `sales.order.settle` supports the bounded cash/manual-M-Pesa/customer-account sale path. There is no durable restaurant source reference or exactly-once restaurant settlement handoff. Stock, tax, journal and original-command rules must be preserved. |
| Charge a served order to a guest room | `apps/api/src/commands.ts` creates stays/folios and checkout posts matching `ROOM_CHARGE` and `CASH_PAYMENT` entries for booked nights. No authenticated checked-in-folio restaurant charge, deposit/partial-payment running folio or source-order uniqueness contract exists. These are P2 dependencies. |
| Claim prepared-item ingredient cost | Prepared selling is explicitly rejected until recipe consumption exists. Restaurant configuration/order implementation must retain that boundary and must not invent ingredient COGS. |

The next coherent slice is server-backed hospitality configuration and authority,
followed by durable source orders/fire, station KOT/KDS and the accepted
settlement handoff. Physical KOT checks begin with the first printing slice;
they are not deferred until final P4 acceptance. Room-charge actions remain
unavailable until the folio contract is implemented and accepted.

## Disposable local verification tooling

Read-only checks found Docker Engine **29.6.2**, Node and GitHub CLI on PATH.
The task-owned container `mazao-truth-s00-postgres` runs PostgreSQL 16 at
`127.0.0.1:55435`; `pg_isready -U postgres -d mazao_truth` reported accepting
connections. This readiness probe did not run business SQL, migrate a database
or alter a service. Native `psql`, `pg_ctl`, `initdb` and Bun were not on PATH;
PostgreSQL tools are available through the existing test container.

Use a privately supplied disposable URL such as
`postgres://postgres:<redacted>@127.0.0.1:55435/postgres` as
`TEST_DATABASE_URL`. The following command is the repository's isolated API
test path; it is documented here, not newly run by this audit:

```powershell
node --import ./apps/api/test/support/isolate-database.mjs --import tsx --test --test-concurrency=2 apps/api/test/*.test.ts
```

The preload creates fresh `mazao_api_<uuid>` databases on localhost, applies
current migrations and retains them for local diagnosis. Preserve named
`mazao_truth` and `mazao_test` fixtures. The browser integration configuration
accepts generated `mazao_count_e2e_<32 lowercase hex>` databases, besides its
named fixtures; use a fresh generated database and a redacted URL such as
`postgres://postgres:<redacted>@127.0.0.1:55435/mazao_count_e2e_<uuidhex>` for
`MAZAO_E2E_DATABASE_URL`. Browser API and preview ports are 4102 and 3002.
Use only disposable local connection credentials held outside this document;
the integration fixtures create their own synthetic operator identities.
No local database tests were run for this read-only audit.

The only authorized audit output is this evidence document. No SSH, production
read/write, deployment, merge, push, PR mutation, branch-protection mutation,
database migration, container start/stop or destructive operation was performed.
