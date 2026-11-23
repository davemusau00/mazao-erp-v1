# Branch cleanup proposal (no cleanup executed)

**Snapshot:** 23 November 2026, compared with `origin/main` at `23cc0001d3d14607b2427e61126133bdaa30b359`. All path, SHA, ahead/behind, merge-base, and patch-equivalence evidence is in the linked matrices. `origin` refs are historical evidence and are proposed to remain intact.

## Candidate local worktrees and refs

These are clean worktrees whose work is merged, patch-equivalent, or fully reachable from current main. The table is a proposal only. Before any action, re-check the path and SHA; get explicit user approval; remove only the named clean worktree; then try ordinary `git branch -d`. If Git refuses due squash-merge ancestry, stop and retain the local branch. Never use `-f`, `-D`, or delete remote refs.

| Local branch | SHA | Worktree | Current evidence | Proposed action after approval |
| --- | --- | --- | --- | --- |
| `codex/access-recovery-navigation` | `a0928f2e5a7ff000634e9c8c081471d0cfa415fe` | `C:/Users/Admin/AppData/Local/Mazao/Worktrees/access-recovery-navigation` | PR #29 merged; same remote branch SHA; one patch-equivalent commit; clean. | Remove this local worktree/ref only; retain `origin/codex/access-recovery-navigation`. |
| `codex/credential-recovery` | `d88b5805f3a09fc86dccd9e71620b46d93b1f7d9` | `C:/Users/Admin/AppData/Local/Mazao/Worktrees/credential-recovery` | PR #28 merged; same remote branch SHA; one patch-equivalent commit; clean. | Remove local worktree/ref only; retain remote history. |
| `codex/product-import-resume` | `7bc5c680170ad7e20e439e04cfd98ebb76391fa2` | `C:/Users/Admin/AppData/Local/Mazao/Worktrees/product-import-resume-clean` | PR #30 merged; same remote branch SHA; one patch-equivalent commit; clean. | Remove local worktree/ref only; retain remote history. |
| `codex/guest-registration` | `901f84a24f79bbf4450fea13495abb3446cecb56` | `C:/Users/Admin/AppData/Local/Mazao/Worktrees/guest-registration-clean` | PR #31 merged at `8df8d67`; same remote branch SHA; clean. Its two commits are not patch-equivalent because main used squash merge; reviewed feature is in main. | Remove local worktree/ref only after confirming the merged registration implementation; retain remote history. |
| `codex/pr26-repair` | `01c3566b23ffdc24633e6c8c58826e7bd84afb1b` | `C:/Users/Admin/AppData/Local/Mazao/Worktrees/pr26-repair` | PR #26 merged at current main; exact reviewed PR head; clean. | Remove local worktree/ref only; retain the remote PR source ref and merge evidence. |
| `feat/product-import-queue-archive` | `4d9e446f02fcb50ffc415fe723ae9f315dd0aaa0` | `C:/Users/Admin/AppData/Local/Mazao/Worktrees/product-import-queue-archive` | PR #27 merged; branch tip is an ancestor of current main; clean. | Remove local worktree/ref only; retain remote history. |
| `docs/saas-offline-roadmap` | `c137b63302b686518e23cfbf33b8f5e25321e84f` | `C:/Users/Admin/AppData/Local/Mazao/Worktrees/saas-offline-roadmap` | PR #32 merged; same remote SHA; clean. Two commits differ by patch ID due squash; roadmap content is in main. | Remove local worktree/ref only after checking the merged roadmap; retain remote history. |
| `deploy/mazaoyako-config` | `34298383338df70a8551e8cf4ac91a285438b612` | `C:/Users/Admin/AppData/Local/Mazao/Worktrees/mazaoyako-deployment` | PR #25 merged; tip is an ancestor of current main; clean. | Remove local worktree/ref only; retain remote history. |
| `fix/api-test-isolation` | `a883e5a1d649a552e73a4fa6e07d7102fbf44ae6` | `C:/Users/Admin/Downloads/MAZAO-ERP/mazao-erp-test-isolation` | PR #17 merged; tip is an ancestor of current main; clean. | Remove local worktree/ref only; retain remote history. |
| `codex/pr24-review-cleanup` | `ae7109912d36130453782fd72bae1be19c31c97b` | `C:/Users/Admin/AppData/Local/Mazao/Worktrees/pr24-final-review` | Tip is an ancestor of current main; clean. | Remove local worktree/ref only after confirming its commit remains reachable from main. |
| `fix/catalog-scan-identities` | `df1007d9682eed211f7faf4cd71d6fcd54e4f869` | `C:/Users/Admin/Downloads/MAZAO-ERP/mazao-erp-csv-import` | Tip is an ancestor of current main; clean. | Remove local worktree/ref only after confirming its commit remains reachable from main. |

Retain all matching `origin/*` refs, all GitHub PR records, tags, and mainline history. The proposal does not include remote deletion.

## Explicitly retain

- `codex/restaurant-print-queue` at PR #34 head `520deb334411c56c3086ada20d82ffaf7905f98a`: active open Draft PR.
- `review/pr34-print-page-size-2026-11-22` at `c6c09f4996d087850c29d8eef0a3f230a1668eda`: published as Draft PR #35 stacked on #34; the pre-documentation code head passed run 45160206478. Intermediate docs head 824449c passed run 45168462815. Latest head c6c09f4 run 45168669467 attempt 2 passed after a non-reproduced sign-out timeout in attempt 1; API-container validation passed. Physical hardware acceptance remains open; retain local and remote refs through that gate.
- `codex/restaurant-ticket-handoff-v1` at the same base SHA but dirty with 17 tracked paths and migration 035: preserve for a separate unique-delta review.
- `docs/live-deployment-baseline` at PR #33 head `1477f818e7b6847add67dd5115788b8139253766`: preserve as a clean historical worktree. Active PR #33 now points to 812d1a9e70f8fa1133a51b3b17c207ba1f6aa258 on review/deployment-baseline-refresh-2026-11-22 and origin/docs/live-deployment-baseline.
- Dirty branches/worktrees: root `feat/hospitality-orders-fire`; `feat/guest-registration`; `fix/product-import-resume`; `feat/catalog-maintenance`; `feat/codebase-truth-count-recovery`; `fix/credential-operation-fencing`; `fix/access-recovery-routing`. Preserve all contents and migrations.
- Clean historical local branches: `feat/hospitality-kds-lifecycle` and `feat/restaurant-print-queue` both point to `5138f118253eb5ac2e70fd1416ef9bc59189154c`; their ticket-lifecycle migration 031 has the exact blob used as current main migration 033, while their old 029/030/031 sequence conflicts with current migration history. `feat/confirmed-stock-exception-sales` at `7373a7464812fabae6bf65d8cfa36cae9091f87d` is merged feature history from PR #23 and its current-main functionality is present. `fix/staff-name-evidence` at `adde772d592373d513da4de3d965f20a5c00bb1f` is patch-equivalent to main. The detached worktree at `6436e256728c4bfe1d546c7627f3490a9fa0c1aa` is clean. Retain all until explicit cleanup approval; no remote history is included in cleanup.
- Open PR #13–16 source refs and any associated worktrees until the PRs are formally superseded. Do not delete remote refs.
- Local `main` was verified to have no unique commits and no checked-out worktree, then fast-forwarded to `origin/main` at `23cc0001d3d14607b2427e61126133bdaa30b359`. No other worktree or remote ref was changed.
- Review worktrees for branch audit, the current-main docs supplement, active PR #33, and PR #35 until each change is accepted or deliberately discarded. The PR #33 update worktree is clean at 812d1a9e70f8fa1133a51b3b17c207ba1f6aa258.

## Approved cleanup procedure (not run)

1. Obtain explicit approval naming the local worktrees/refs to remove. This proposal is not approval.
2. Re-fetch refs and re-run `git status --short --untracked-files=all` for each exact path. Abort for any dirty/untracked state or changed SHA.
3. Preserve the matrix and relevant commit IDs. Keep all remote refs and PR history.
4. For each approved clean candidate, run `git worktree remove <exact-path>` without `--force`, then `git branch -d <exact-local-branch>` without `-D`. If either refuses, stop and retain it.
5. Verify the resulting worktree/ref list. Do not delete remote branches, rewrite history, rebase dirty work, or change branch protection in this cleanup.


The local worktree C:/Users/Admin/AppData/Local/Mazao/Worktrees/deployment-baseline-mainline is on review/deployment-baseline-mainline-2026-11-22 at 055607f2114b3590289af10e57483bee449c70ce, based on current main. Its three commits are patch-equivalent to active PR #33; one uncommitted roadmap status supplement remains unique. Preserve it until that supplement is reviewed or isolated.
