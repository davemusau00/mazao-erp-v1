# Mixed stock-count posting acceptance

Date: **16 October 2026, Africa/Nairobi**. Scope: audit finding F02 only.

## Operator outcome and accounting policy

A reviewed full-outlet count can contain both surplus and missing stock. Previously its posting built one `INVENTORY` journal line with a positive debit for gains and a positive credit for shrinkage. The existing journal-line constraint permits a positive amount on only one side, so mixed counts returned HTTP 500 and the transaction rolled back.

The posting now records separate `INVENTORY` debit and credit lines. The existing journal helper omits zero lines. Gross gains remain credited to `INVENTORY_COUNT_GAIN`; gross shrinkage remains debited to `INVENTORY_COUNT_SHRINKAGE`. Equal-valued gains and losses retain both stock movements and both variance accounts, even when the net inventory value change is zero.

Valuation remains the saved moving weighted-average carrying value defined by [ADR 0006](adr/0006-weighted-average-inventory-cost.md). Item setup cost remains a fallback for zero-baseline gains. This change does not alter those valuation rules.

## Contract, authority and transaction boundary

The version-1 `inventory.count.post` input/output, expected `count:{id}` revision, online-only behavior and error codes are unchanged. The authenticated tenant/outlet scope and `inventory.count.approve` permission remain enforced. A storekeeper can record a draft; an authorized manager/admin must post it.

The existing serializable command transaction still commits quantity/value balances, immutable movements, a balanced journal, the posted count revision, audit/outbox events and canonical command outcome together. Exact concurrent or later replay returns that original outcome. An invalid posting rolls back its business effects while retaining a deterministic rejected command outcome and the saved count draft.

No migration is needed. No applied migration or historical financial/stock record was changed. Deployment rollback can restore the prior API, with its original mixed-count limitation; this slice introduces no schema compatibility boundary.

## Acceptance evidence

The new `apps/api/test/stock-count-variance.integration.test.ts` creates unique disposable tenants and authenticates real admin/storekeeper HTTP sessions. Products are created and received through domain commands, using receipt costs that differ from item reference costs. It covers:

- Gains only and losses only.
- Unequal mixed gains/losses in both net directions.
- Equal mixed values with decimal quantities.
- Actual weighted-average value, final balances, gross inventory debit/credit and gain/shrinkage evidence, one-sided journal lines and balanced journals.
- Concurrent and later exact replay, one posted revision, and one audit/outbox event.
- Unchanged receiving/journal history and server count-history projection.
- Denied storekeeper posting; a missing reason on the second processed variance after the first line has been processed; complete business rollback; canonical rejected replay; corrected draft followed by successful posting.

The new `e2e/integration/stock-count.spec.ts` exercises actual Chromium, API and PostgreSQL at **1024 x 600**. It records/saves a mixed count, reloads its durable server draft, reviews/posts it, checks history and verifies database journal/movement evidence. It covers equal and unequal mixed values, keeps confirmation visible at the constrained viewport, and recovers the original committed posting after deliberately losing its HTTP response and reloading the browser. No business API is mocked; only the committed response is interrupted in the recovery case.

Observed local verification:

| Check | Result |
| --- | --- |
| New focused PostgreSQL suite | **7 passed, 0 failed, 0 skipped**. |
| Regression control using the old posting line | Gains/losses-only cases passed; all three mixed scenarios and corrected mixed-draft posting returned HTTP 500. Node reported **2 passed, 5 failed**, including the failed parent test. The corrected implementation was then restored. |
| New plus existing PostgreSQL integration, serial execution | **8 passed, 0 failed, 0 skipped**. |
| Real mixed-count browser journeys | **2 passed**, 18.9 seconds. |
| TypeScript | `npm run typecheck` passed UI and API checks. |
| Production PWA build | `npm run build` passed. Existing Vite `__dirname` and terminal-color warnings remain. |
| Fresh database and migration rerun | Migrations **001–016** applied; all **16** rerun checksums matched. |

The isolated PostgreSQL 16 test instance used loopback port **55437**, an explicit task label and temporary memory-backed database storage. Browser verification used temporary ports **3004/4104** to avoid other agents' test servers; the committed test uses the existing integration configuration normally. No hosted database, SSH or deployment was used.

An earlier parallel run against the shared task database encountered existing serializable retry exhaustion (`40001`) in an unrelated legacy sale and a count posting. Serial regression passed; the dedicated database avoids interference from concurrently running agents. This is not evidence that the full parallel database suite or the broader concurrency/performance gate has passed.

Only the constrained desktop Chromium count journey was exercised here. This slice does not claim the full viewport/accessibility matrix, physical scanner/printing, installed-PWA update behavior or full v1 acceptance. Other audit findings remain separate work.
