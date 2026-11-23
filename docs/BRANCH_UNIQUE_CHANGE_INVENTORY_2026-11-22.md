# Unique-change inventory (commit and dirty-overlay evidence)

**Snapshot:** 23 November 2026. Reference point: `origin/main` at `23cc0001d3d14607b2427e61126133bdaa30b359`. Patch counts below are `git cherry` counts; they answer commit patch equivalence, not semantic feature equivalence. Dirty file results normalize CRLF/LF and are only a file-content comparison. See the linked full matrices for every ref and path.

## Committed feature and PR deltas

| Branch or PR | Commit/tree evidence against main | Classification |
| --- | --- | --- |
| PR #13 login guard | 2 commits; 0 patch-only, 2 patch-equivalent; PR open/conflicting; no checks reported on the PR head. | No missing committed implementation identified. Current-main regression checks and exact-main hosted CI pass. Superseded recommendation. |
| PR #14 mixed stock count | 1 commit; 0 patch-only, 1 patch-equivalent; PR open/conflicting; old TypeScript/build check fails and container validation is skipped. | No missing committed implementation identified. Current-main regression checks and exact-main hosted CI pass. Superseded recommendation. |
| PR #15 account self-service | 1 commit; 0 patch-only, 1 patch-equivalent; PR open/conflicting; old TypeScript/build check fails and container validation is skipped. | No missing committed implementation identified. Current-main regression checks and exact-main hosted CI pass. Superseded recommendation. |
| PR #16 hotel date guards | 1 commit; 0 patch-only, 1 patch-equivalent; PR open/conflicting; old TypeScript/build check fails and container validation is skipped. | No missing committed implementation identified. Current-main regression checks and exact-main hosted CI pass. Superseded recommendation. |
| PR #28–31 | Credential recovery, recovery navigation, import resume and guest registration merged in order; PR #31 is present in current main. | Merged prerequisite feature work. Local clean PR worktrees are cleanup candidates, but remote historical refs should remain. |
| PR #26 | Exact source head `01c3566b23ffdc24633e6c8c58826e7bd84afb1b`, merge/current main `23cc0001d3d14607b2427e61126133bdaa30b359`; PR state is MERGED. | KDS foundation is in main; current main retains the lost-fire acknowledgement/recovery assertion and migration 033 ticket lifecycle. Exact-head hosted CI passed. The older `5138f11` branch pair carries the identical lifecycle SQL under migration 031, which conflicts with the accepted migration sequence; preserve it as historical worktrees, port none. |
| `feat/confirmed-stock-exception-sales` | Four patch-only commits at `7373a7464812fabae6bf65d8c8fa36cae9091f87d`; source PR #23 is merged. | Main has migration 021 and the stock-exception source; its report query includes the qualified item key and later pagination. No missing stock-exception delta identified; preserve the old branch as history. |
| `feat/hospitality-kds-lifecycle` / `feat/restaurant-print-queue` | Both local branches point to `5138f118253eb5ac2e70fd1416ef9bc59189154c`; four patch-only commits, ten behind main. | The old stack numbers restaurant configuration/orders/ticket lifecycle as migrations 029/030/031. Its lifecycle SQL blob `c9401309714d7df800bf02be48ff0a46b4d5241c` exactly matches current main migration 033, while 029/030 collide with current applied import archive/guest registration. Keep as stale history; do not transplant or run its migration list. |
| `feat/hospitality-orders-fire` / `feat/hospitality-p1-configuration` | Two and one patch-only commits, respectively. | Their restaurant configuration and order/fire slices are represented by current migrations 031/032 and the merged KDS lifecycle. Keep the dirty root overlay; no committed restaurant source needs porting. |
| `fix/command-recovery-scope` | One patch-only commit `65d390b77426288c6f1b53e7e93d1b932f5252d9`, two patch-equivalent commits. | Current main's `requireStoredCommandAuthority` binds recovery to persisted command type, actor/outlet, current role and capabilities; current integration tests cover changed authority and unknown command types. The old baseline policy is superseded; no port. |
| PR #33 | Updated docs-only PR head `812d1a9e70f8fa1133a51b3b17c207ba1f6aa258`; 2 behind and 5 ahead of current main, merge base `2a5da2d8215748716dbd7d8155c733f90fa59070`, 5 patch-only commits. | Fast-forward update adds verified deployment identities, restored-Country-dump evidence and current M0-M6 status. Prior exact-head run `45161799538` passed; follow-up `45166885270` passed at the exact current PR head. PR #33 is mergeable with a conflict-free merge tree. Current-main comparison candidate remains local only. |
| PR #34 | 4 patch-only commits, code + migration 034, open Draft at `520deb334411c56c3086ada20d82ffaf7905f98a`. | Durable station print queue. Exact-head CI passed. Manual review found Chromium rejects the `80mm auto` page-size declaration. Its CSS correction is Draft PR #35, stacked on #34; two later documentation-only commits record CI and hardware gates. Full hosted candidate run `45160206478` passed 310 API tests with zero skips, the populated 029-to-034 upgrade and checksum rerun, 216 browser cases, 240 cross-browser cases, and 29 real API/PostgreSQL browser cases. Migration 034 blob remains unchanged. Physical printer/cutter/paper acceptance remains outstanding. |
| PR #35 | Draft head c6c09f4996d087850c29d8eef0a3f230a1668eda, stacked on PR #34 at 520deb334411c56c3086ada20d82ffaf7905f98a; 7 commits ahead of main including #34. | CSS correction at 9283bd3 removes Chromium-rejected 80mm auto; migration 034 unchanged. Pre-documentation run 45160206478 passed 310 API/0 skips, 216 browser, 240 cross-browser, 29 API/PostgreSQL integration, fresh/populated migration and rerun. Intermediate docs head 824449c passed run 45168462815. Final docs head c6c09f4: run 45168669467 attempt 1 had a non-reproduced restaurant-orders sign-out timeout; attempt 2 passed all tests and API-container validation at the exact current SHA. Physical printer/cutter/paper acceptance remains outstanding. Physical printer/cutter/paper gate remains; do not merge yet. |
| PR #32 and selected merged PR #17, #23–25, #27 | PR #32 (SaaS/offline roadmap) merged 21 November and its plan is on main; refs and patch-equivalence counts are in the branch matrix. Several squash-merged heads retain patch-only commits. | Preserve remote refs. Local cleanup candidates only where the exact SHA is reachable remotely/main and the worktree is clean. |

## Dirty overlay deltas

| Worktree branch | Overlay paths | File-content relation to main | Feature area and disposition |
| --- | ---: | --- | --- |
| `feat/hospitality-orders-fire` | 17 | 13 differ, 2 same, 2 new | Import/archive overlay has no safe unique port; it duplicates migration 029 under colliding number 031 and its dirty migration list drops current 030 and 033. Keep the entire worktree. |
| `feat/guest-registration` | 45 | 13 differ, 32 same, 0 new | Guest implementation files match main; tracked differences are old-base changes, not missing feature code. Keep the worktree; port none. |
| `fix/product-import-resume` | 1 | 1 differs | Dirty UI removes current-main pending selection, tenant scoping and generation checks. Keep the worktree; port none. |
| `codex/restaurant-ticket-handoff-v1` | 18 | 17 differ, 1 new | P04 ticket handoff layered on PR #34; untracked migration 035. Keep; review after 034, no port yet. |
| `feat/catalog-maintenance` | 12 | 9 differ, 3 new | Superseded by main `CatalogMaintenanceWorkspace` and `catalogMaintenance` API, which provide edit/archive/restore, categories, search and command recovery. Preserve dirty WIP; no UI port identified. |
| `feat/codebase-truth-count-recovery` | 47 | 32 differ, 15 same, 0 new | Older count/catalog/service-sales fork. Migration 026 is byte-identical to main; review dialog and browser test also match. Main includes migration 027 and later S01-03–07 work. Preserve all dirty paths; no safe unique count port identified. |
| `fix/credential-operation-fencing` | 15 | 9 differ, 6 new | Reviewed: main already has credential reconciliation/fencing in migration 022; this overlay proposes a different gate table in migration 017, colliding with main's configuration-assets 017, and changes the old recovery metadata contract. Preserve; port none. |
| `fix/access-recovery-routing` | 9 | 7 differ, 1 same, 1 new | Old-base recovery-routing/focus overlay. `CommandRecoveryNavigation.tsx` is byte-identical to main; the other paths differ because main has later guest, restaurant and device-context recovery behavior. Preserve the dirty overlay; port none. |

The file-level differences are not proof that behavior is missing. Dirty overlays remain preserved. Semantic review has identified duplicate/stale or regressive import, guest-registration and credential-fencing changes; no source delta was ported. Do not infer that unreviewed WIP is either safe to merge or disposable.

## Semantic review completed on 22 November

- Root `feat/hospitality-orders-fire` and the dirty `fix/product-import-resume` overlay do not have a safe unique import delta to port. The proposed migration 031 is the same SQL as current main's applied 029 and collides with restaurant configuration 031. Root's dirty migration registration drops guest-registration 030 and restaurant-ticket-lifecycle 033. The current-main import implementation also retains stronger recovery ordering/fencing and category aggregate outbox evidence than these stale overlays.
- The guest-registration worktree contains the same guest implementation files as main. Its tracked differences are from an older base, not missing functionality. Keep the worktree as user history; do not port or delete it.
- The root untracked 8 November master plan is a shorter stale copy (478 lines) than the 556-line current-main plan. The local guest plan differs from the merged implementation approach. Preserve both local files and treat main's accepted roadmap and PR #31 implementation as current references. The separate 29 October P0–P4 instruction remains to be mapped against that roadmap.

These comparisons do not clear any dirty worktree for cleanup. The ticket-handoff overlay adds a distinct served/void workflow, but it is stacked on the unaccepted PR #34 print-queue head and proposes migration 035; review its authorization, accounting/stock effects, recovery and exact-head tests after the print-queue predecessor is accepted. Main already contains the richer catalog-maintenance workspace and the later count-recovery slices; the old dirty catalog/count branches have no safe unique port identified. The clean PR #29 recovery-navigation branch is merged. Main carries current recovery routing and a reusable dialog focus trap; the separate dirty `fix/access-recovery-routing` stock-count overlay remains preserved and still needs exact isolation/retest.

## PR #33 current-main candidate

The local branch review/deployment-baseline-mainline-2026-11-22 is based directly on current main and contains three commits patch-equivalent to active PR #33, plus one uncommitted roadmap status supplement. It remains local, with no hosted result at the supplemental content. Review that unique supplement independently; do not treat the replayed commits as a separate merge candidate.

## Exact migration/content hashes

- Main migration `029_product_import_queue_archive.sql` and the dirty root worktree's misnumbered `031_product_import_queue_archive.sql` have identical normalized content SHA256 `e0217ed5ea600cd3a14d2639ac6eaff65b26bb3a8bd0a068350edb481c501ea4`; only the path/number differs.
- Main migration `026_count_recovery.sql` and the dirty count-recovery worktree's untracked path normalize identically.
- Dirty credential migration `017_credential_operation_fences.sql` is new relative to main and differs from `022_credential_operation_fencing.sql`; main already uses migration 017 for configuration assets.
- PR #34 migration 034 raw file-content SHA256 is `486bbb8fa6afe2b86cdc22d2ec1bfeca0bc83c1b32b385d9ec33ac0d9a758b10` (Git blob object ID `89287d87abf16432c649934a91efb2a7e4ebfffe`). Its exact-head populated-upgrade test and checksum rerun passed in hosted CI. Do not edit or renumber it after application.

## Evidence files

- [Branch/ref matrix](BRANCH_REF_MATRIX_2026-11-22.md)
- [Dirty overlay content matrix](DIRTY_OVERLAY_CONTENT_MATRIX_2026-11-22.md)
- [Worktree state and paths](WORKTREE_STATE_MATRIX_2026-11-22.md)
- [Cleanup proposal](BRANCH_CLEANUP_PROPOSAL_2026-11-22.md)
- [Full reconciliation report](BRANCH_CONSOLIDATION_AUDIT_2026-11-22.md)
