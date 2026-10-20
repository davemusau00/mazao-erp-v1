# Feature availability and count/import history

Implementation date: 20 October 2026, Africa/Nairobi. Tickets: S00-06 / G17 and the count/import UI portion of S00-04 / G04. This records development coverage; production activation, full v1 acceptance and physical hardware are separate gates.

## Corrected behavior

Manage previously marked supplier payables and payment reconciliation unavailable even though Money already had supported server workflows. It now provides permission-checked destinations for supplier bills/payments, paid expenses, incoming manual M-Pesa matching and accounting periods. Purchasing links directly to Money's supplier area. Expense and period cards also expose the implemented workflows and their limits.

`AccountingArea` is a shared typed destination. App navigation preserves existing capability/permission checks and the cancelable navigation guard. The Money destination starts in the requested accounting area. Workspace readiness tracks the accounting controls and records actually requested by that destination; it does not wait for a trial-balance read that never occurs. Recovery navigation for retained `finance.*` commands now opens Money instead of Shifts.

Read access remains `finance.view`. The API's reported `finance.manage` and `finance.close` permissions still control writes and period transitions. Configuration or stock receiving access alone grants no financial action. No role permission, API mutation or financial posting policy changed in this UI slice.

## Implemented limits

| Area | Supported workflow and boundary |
| --- | --- |
| Supplier accounts | Create suppliers; record unpaid expense bills or the complete value of one existing delivery; record partial bank/M-Pesa payments already made; reverse unpaid bills. PO, partial delivery matching, supplier credits and returned payments remain unavailable. |
| Expenses | Record already-paid operating, rent and utilities expenses through supported bank/M-Pesa accounts; preserve original evidence with linked category corrections/reversals. Stock receiving, supplier payment and till cash have their own workflows. Recording does not transfer money. |
| Manual M-Pesa | Cashier-confirmed sale and incoming statement evidence matching; statements contain 1–2,000 transactions over up to 367 days. No automatic provider confirmation, outgoing/bank reconciliation or proof of statement completeness. |
| Periods | Nonoverlapping periods up to 367 days, OPEN/CLOSING/CLOSED transitions, posting guards and close reconciliation. Closed periods cannot be reopened; corrections use an open date. |
| Restaurant and offline | Restaurant operations and offline financial transactions remain disabled. Online command recovery is available and does not authorize offline posting. |

README and the completion register also reconcile existing staff/assignment/session/password work, manual M-Pesa/line discounts, supplier/AP, expense and period controls against executable source. Historical release identity remains distinct from unverified current production state and from the new worktree.

## Count and import history

The old terminal 50-row lists are now first pages. Both workspaces consume the shared server continuation contract, show loaded and matching counts, load older pages, and send search terms to the complete authorized source. Read failures retain existing results and the same continuation for retry. An AbortController fences superseded and unmounted history reads. The current count's draft/post rules and the CSV validate/review/apply boundaries are preserved.

`count-import-history.spec.ts` verifies the 51st record in each workspace, a failed older-page read followed by an identical-cursor retry, server search that returns the formerly hidden record, and its detail action. `feature-availability.spec.ts` verifies direct supplier navigation at 1024×600 and 390×844, actual supplier-bill form access, readiness completion on accounting reads, read-only finance areas and denied finance/restaurant/offline actions. Existing configuration checks now distinguish an implemented finance card that requires access from an unimplemented module.

## Validation boundary

Browser acceptance uses explicit HTTP fixtures. It validates adapter/navigation/accessibility behavior and does not substitute for domain posting, real PostgreSQL isolation or current production data. Domain pagination and credential evidence are recorded in the execution register and their focused documents. No deploy, remote repository mutation or commit occurred for this slice.

Observed locally on 20 October:

- `npm run build`: passed. Observed development entry 506.54 kB / 137.39 kB gzip; 18 PWA precache entries, 806.24 KiB. Vite retained its configuration-loader notice and warning for an entry over 500 kB. This is not performance acceptance or an immutable release identity.
- `feature-availability.spec.ts`: **4 passed**, including both direct-supplier viewports, accounting readiness events, expense/period/manual-M-Pesa read-only destinations and finance/restaurant/offline restrictions.
- `count-import-history.spec.ts`: **2 passed**, covering record 51, identical-cursor retry, full-data search and reachable detail actions in each workspace.
- Existing `stock-count.spec.ts`: **2 passed**; existing `accounting-statement-race.spec.ts`: **1 passed**.
- The combined 34-test Chromium batch observed **31 passed, 3 failed**. Remaining failures were the older configuration empty-state assertion, an exception-list fixture missing the required `limit`, and the assignment picker on a build preceding its subsequent staff-source correction. The first two fixtures/assertions were corrected; fresh-build combined follow-up is owned by the shared execution register. These failures do not establish a pass for their workflows until rerun.

During test development, corrected fixtures also supplied response request IDs for completion timing, used public sanitized API errors, distinguished mobile navigation names, scoped a duplicate stock-exception action and matched the existing integer money display. These were acceptance-fixture corrections and did not change financial formatting or server error policy.
