# Customer wording, manual M-Pesa, item discounts and financial reporting

Date: 18 October 2026. Branch: `feat/product-finishing`.

## Status and agreed requirements

**Implementation is complete on feat/product-finishing; production release is pending.** This replaces the investigation-only status below. The branch contains the agreed cashier-confirmed M-Pesa flow, fixed-amount item discounts, customer-facing wording and number formatting, and expanded accounting/reporting workflows. A real command-recovery defect found during release validation has also been fixed. Technical performance acceptance remains **FAIL** with the product owner's previously recorded exception acceptance in docs/44-PERFORMANCE-ACCEPTANCE-2026-10-18.md; that does not replace the exact-main CI and current-production backup/restore gates.

The user confirmed:

- The cashier verifies receipt of a manual M-Pesa payment.
- Discounts apply to individual sale items.
- Discounts use a currency **amount**, never a percentage. There must be no percentage-discount input or whole-basket discount in this slice.

The recommended quantity rule is an amount applied **once to the entire selected item line**, with the quantity visible. For example, two items at KES 100 have an original line value of KES 200. A KES 30 discount makes the taxable line value KES 170 under the existing tax-exclusive price policy. The discount is not repeated for each unit. Label the field **Discount for these items (KES)**, substituting the actual currency.

Proposed initial discount authorization: introduce `commerce.discount` in the active API permission map for owner, admin, manager and cashier, require a reason for a nonzero discount, and record the operator. This is a proposed permission policy, not an existing grant or a user decision about discount limits. Do not reuse archived prototype permissions as authorization. Keep any later amount limits or supervisor-approval rules explicit and enforce them in the API.

## Implementation and release progress

- Manual M-Pesa settlement records a transaction reference and requires cashier confirmation. The server keeps payment, receipt, shift and journal evidence in the existing authoritative command transaction.
- Item discounts are fixed currency amounts on individual sale lines. The amount applies once to the complete line, not once per unit and not to the whole basket.
- Reachable business workflows use plain customer-facing language and consistent money/quantity formatting.
- Accounting now includes an editable account display catalogue, controls and expanded supported reports. Reports state their source coverage and keep financial records server-authoritative.
- Lost-response recovery validates the command ID returned by the status endpoint's outer envelope before it removes the original recovery record. It keeps the original command ID and does not create a new payment retry.

The live API was checked read-only during release preparation: HTTPS liveness/readiness returned live/ready, the current API container was healthy, and production is at migration head 017_configuration_assets. Candidate migrations 018–020 are applied only after the required fresh backup and isolated restore. No production business rows or services have been changed by this preparation.

### Validation recorded for this release candidate

- npm run typecheck: passed.
- Production build: passed; the main JavaScript bundle is 487.32 KB (132.12 KB gzip), with accounting/reporting workspaces split into lazy chunks.
- npm run test:integration against the disposable PostgreSQL 16 database with migrations 001–020: **17/17 passed**, including lost-response settings, stock-count and import recovery; fixed-amount financial flows; staff setup; login throttling; and the supported real-DB journeys.
- Earlier branch validation passed 120 API/PostgreSQL tests and 59 Chromium journeys. The merged release candidate passes the Firefox/Chromium desktop/mobile matrix **36/36** after its operational-analytics fixture was made to wait for the signed-in state and mock the trial-balance read. The first PR CI attempt caught that fixture race; CI must pass again on the corrected commit.
- Live read-only preflight: HTTPS live and ready; Mazao API and PostgreSQL healthy; nginx -t passed with administrator privileges; current production schema head is 017_configuration_assets. Disk availability was 104 GB and memory availability 5.7 GiB at the preflight snapshot. Protected ServOS and SMS containers were recorded for post-activation comparison.

**Still pending:** feature-branch CI on the final merge candidate, exact-main CI and artifacts, a fresh off-host backup restored offline with the current live migration head and balanced journals, then activation and post-activation protected-service/HTTPS/database checks.

## Investigation baseline and original findings

The following table records defects found at the start of the investigation; it is not a claim that each item remains open after the implementation above.

Only screens reachable from `src/App.tsx` count as implemented. `FinanceWorkspace.tsx`, older receipt/sync components and generic UI contract types contain designs that are not active services.

| Priority | Finding and source evidence | Required correction |
| --- | --- | --- |
| P0 | `src/services/apiClient.ts:232` describes malformed successful responses as a read retry with "no data was accepted", including mutation requests. The journal retains the unknown outcome at `:365-366`, but the wording can encourage another payment. | Separate read errors from unconfirmed changes. Preserve the original payment command and require status recovery. Never imply that a lost/unreadable acknowledgement proves no payment was recorded. |
| P0 | Technical language occurs throughout bootstrap, navigation, recovery, Help and connected workspaces. `apiClient.ts:236` also exposes arbitrary API error messages. | Centralize business-facing error/outcome translation and rewrite reachable content, tooltips, accessible labels and recovery actions. Keep support references and internal codes available without making them the main instruction. |
| P0 | POS offers cash/customer account only (`src/components/pos/PointOfSaleView.tsx:37,138,180`). Settlement rejects other tenders (`apps/api/src/commands.ts:730-737`); the original payment constraint permits only cash (`apps/api/migrations/001_initial.sql:147-156`). | Implement manual M-Pesa across validation, an additive migration, atomic posting, POS, receipts, history, reports, close evidence and recovery. A new payment button is insufficient. |
| P0 | Sale-line normalization retains only product and quantity (`commands.ts:739-744`), so adding `discountMinor` today would be silently ignored. | Add and validate the canonical amount-discount fields before displaying discount controls. Reject unsupported discount inputs instead of accepting a different price from the one reviewed. |
| P0 | Sales history labels all non-account sales cash (`apps/api/src/app.ts:319`); cash refunds sum cash payments and credit the drawer (`commands.ts:921-937`). | Read actual confirmed tender evidence. Prevent a manual M-Pesa payment from becoming a cash sale or cash refund through a fallback. |
| P1 | Trial-balance Refresh sets the same date string, so the effect does not rerun when the date is unchanged (`BackendFinancialReportsWorkspace.tsx:51-60,82-85`). | Add an explicit refresh trigger, including a visible retry for failed reads. |
| P1 | The "Cash Collected" metric uses only sale payments (`operationalAnalytics.ts:27-30`); customer repayments are separate postings (`commands.ts:259-266`). Refunds are also separate. | Label the existing measure "Cash from sales". Show customer collections, cash refunds and net cash movement separately; collections do not create additional sales revenue. |
| P1 | Top products group by ID plus historical names/SKUs (`operationalAnalytics.ts:37-44`), while React keys only by product ID (`BackendOperationalAnalyticsWorkspace.tsx:54`). | Aggregate by product identity, choose a documented display name, and preserve historical names in transaction detail. Avoid split rankings and duplicate keys after a rename. |
| P1 | Tenant-wide finance queries use the current outlet time zone (`financeReports.ts:82-109,149-153`). | Use a stable tenant reporting time zone for tenant reports. Use the outlet time zone only for outlet reports, and apply the same scope to detail and exports. |
| P1 | `ACCOUNTS_RECEIVABLE` and `OPENING_BALANCE_CLEARING` are missing from known balance-sheet classification (`financeReports.ts:20-23,206`), although both are posted by supported commands. | Register human-readable metadata and classifications for every current account code. Recognize control accounts without incorrectly adding them to operating revenue or costs. |
| P1 | Report effects suppress late updates but do not abort obsolete GETs (`BackendFinancialReportsWorkspace.tsx:51-75`; analytics workspace `:25-31`). | Pass cancellation signals, keep the last successful result with its original scope visible during a safe refresh, and prevent old responses from overwriting a newer selection. |
| P1 | Shared and duplicated money formatters force currency decimals. Quantities often display raw six-place strings. | Consolidate exact formatting for money and quantities; remove insignificant zeros without rounding away real amounts or changing persisted values. |
| P1 | Journal detail exposes source constants and IDs; a journal source ID is the command ID (`commands.ts:103-104`). | Resolve authorized source documents; do not treat a command ID as an order/document ID. Put technical references in optional support details. |

The current Money screen is a trial balance plus a **partial operating summary**. Reports contains outlet sales, cash sale payments, account charges, daily totals and the top ten products. Cash-up is a physical cash report. These foundations do not constitute complete accounting or reconciliation.

## Slice 1: Plain language, exact display and existing report correctness

### Customer-facing copy

Audit these reachable areas together:

- `src/App.tsx`, `components/auth`, `components/layout/AppShell.tsx`, `components/common/CommandRecoveryReadiness.tsx` and `components/help/HelpWorkspace.tsx`.
- Today, POS, sales history, receipts, stock, full counts and product imports.
- Customers, statements, repayments, shifts, hotel and reservations.
- Manage, onboarding, staff, assignments, Money and Reports.
- Shared errors, command outcomes, confirmations, empty states, tooltips and screen-reader labels.

| Current wording or concept | Customer wording |
| --- | --- |
| Checking saved server session | Checking your sign-in |
| Server session could not be verified | We couldn't check your sign-in. Try again. |
| Server account / sign out of server | Online / Sign out |
| Command recovery center | Actions needing review |
| Check server command status | Check status |
| `sales.order.settle` | Sale payment |
| Retained command evidence | Details saved on this device for checking status |
| Server catalogue | Items |
| Server roles / tenant membership | Staff roles / business access |
| Basis points, revisions and payloads | Explain the actual amount, changed record or corrective action |
| Backend unavailable / not connected | State which task is unavailable and the next useful action |

Use `navigator.onLine` only as the browser's online/offline indication. It does not prove the service is reachable. Preserve genuine business vocabulary such as trial balance, journal, tax and customer balance where it helps the relevant operator.

Shared error translation must cover read timeout, lost connection, malformed/incomplete responses, 401, 403, 429 and service failures. Handle structured validation details safely. Do not print arbitrary API messages, raw codes, SQL details, paths or internal field names as the main instruction. Preserve request and command references internally for diagnosis.

For a read: **We couldn't load this information. Try again.** Provide the relevant action and retain safe earlier data.

For an uncertain payment: **We couldn't confirm whether this payment completed. Check its status before taking payment again.** Keep the basket locked against another payment until the original result is known. Other uncertain changes need equivalent task-specific wording.

Keep accurate business limitations visible: sales need a connection, a partial report has missing sources, a capped list is incomplete, and opening a print dialog is not proof of physical printing. Translate these facts; do not delete them to make the interface appear complete.

### Number display

Use the exact `BigInt`-based money path in `src/utils/money.ts` for all reachable screens and receipt preview/print/text. Remove duplicate implementations from `BackendReceiptModal.tsx`, finance and inventory.

Display policy: hide fractional digits when the fraction is zero; preserve the currency's normal fractional precision when it is nonzero. Examples:

| Value | Display |
| --- | --- |
| KES 1200.00 | KES 1,200 |
| KES 1200.50 | KES 1,200.50 |
| KES 1200.05 | KES 1,200.05 |
| Quantity 12.000000 | 12 |
| Quantity 1.250000 | 1.25 |
| Tax rate 16.00% | 16% |

Preserve negative values, large integer values, locale grouping and zero-/three-decimal currencies. Keep exact submitted minor units, tax rates and quantities unchanged. Receipt exports and screen previews must agree. Machine-readable exports should retain explicit currency, units and exact minor values, independent of decorative display formatting.

### Existing reports

Fix same-date refresh/retry, cancellation, correct account classification, tenant reporting dates, product aggregation and collection labels before adding more charts. Show the selected business dates, outlet/all-outlets scope, currency, generated time and coverage on each report.

Do not label an old result with newly selected dates while refresh is in progress or has failed. Show that the previous result is being retained. Restore explicit ready/empty/error/retry behavior for both report and journal-detail panels.

## Slice 2: Cashier-confirmed manual M-Pesa sale

### Checkout and evidence

Add **M-Pesa** next to Cash and Customer account. The first implementation uses one payment method for the full sale; mixed tender requires its own accepted allocation/recovery design.

1. Display the exact amount due and configured receiving business account, where configured.
2. The cashier checks the business's payment evidence and enters the transaction reference.
3. Require explicit confirmation: **I have checked that this payment was received.**
4. Submit the sale once through the existing durable command journal.
5. Show completion/receipt only after a confirmed command result; otherwise offer original-action status recovery.

Canonical tender design: `method: MANUAL_MPESA`, exact `amountMinor`, currency, normalized transaction reference and explicit manual-confirmation input. Record confirming operator from the authenticated session and confirmation time from the database. Associate the configured receiving account when multiple accounts are supported. No provider credentials or unnecessary customer details belong in the command.

Validate the reference with documented normalization/length rules; avoid assuming a permanent provider format without verification. Normalize before persisting the original command. Require the exact sale amount; do not produce cash change from an M-Pesa overpayment.

Enforce a PostgreSQL uniqueness constraint for normalized manual M-Pesa references across the tenant (not merely a browser or outlet check). Keep reversed references reserved. If receiving-account scoping later becomes necessary, define and prove its duplicate protection before changing this boundary.

This is **cashier confirmation**, with statement reconciliation tracked separately. Neither the UI nor reports may call it automatic provider verification.

### Posting and connected reads

- Use an additive migration; do not edit `001_initial.sql` or rewrite existing payments.
- Debit a distinct mobile-money asset/control account; credit sale revenue and configured tax as appropriate. Preserve separate COGS/inventory posting.
- Keep the current transaction, idempotency, stock locks, expected versions, audit and request-hash protections.
- Do not increase expected physical drawer cash. Maintain a separate M-Pesa shift total and immutable close evidence without rewriting historical cash close snapshots.
- Receipt, history and reports must use actual payment method/amount/reference, with a human-readable manual-confirmation label. Do not synthesize cash tendered/change for M-Pesa.
- Extend account mappings, tender filters, source drilldown and control checks in the same slice.
- Retained commands and reloaded POS state must preserve method, amount, reference, manual confirmation and all line discounts. Never generate a new command ID to resolve an unknown outcome.

### Refund and other-workflow boundaries

The current refund route is cash-only. Initially disable M-Pesa refunds with a clear **M-Pesa refunds are not available here** explanation until an authorized outgoing-payment workflow is implemented. The API must reject an attempt to use the cash path. A manual refund workflow must record its own outgoing reference, operator, amount, audit, tax/COGS allocations and original-sale linkage; recording an instruction must not claim that money was sent.

Customer repayments and hotel checkout currently have separate cash-only contracts. POS M-Pesa support must not imply those workflows accept it. Keep their limitations understandable and extend them only through complete, separately accepted slices.

## Slice 3: Currency amount discounts per item line

### UI and canonical input

Add the amount field to the item line, alongside quantity, original value and discounted value. There is no percentage field and no whole-sale allocation. Suggested line payload:

```ts
{
  productId: string;
  quantity: string;
  discountMinor?: number; // once for the entire line; default zero
  discountReason?: string;
}
```

Validate nonnegative integer minor units and active discount permission. Reject percentage fields and unsupported pricing overrides rather than silently ignoring a requested discount. Limit the amount to the rounded original pre-tax line value. Require a reason for a nonzero discount. Quantity or catalog-price changes must keep the amount visible, revalidate it and require review before payment; never silently rescale the discount per unit.

### Exact calculations and immutable evidence

Under the current tax-exclusive price policy:

```text
original line value = existing exact quantity × original unit price, rounded by current policy
discounted taxable value = original line value − line discount amount
line tax = configured item tax applied to discounted taxable value
line payable = discounted taxable value + line tax
```

The API recalculates from locked, version-checked catalog values. The browser estimate is not authority. Preserve existing quantity precision and rounding policy. A completely free checkout remains a separately specified comp workflow; the current sale-total-greater-than-zero guard must not disappear accidentally.

Snapshot original price/value, discount amount/reason, discounted subtotal, tax rate/tax, quantity and exact COGS. Old lines have zero discounts; their receipt, journal and stock amounts remain unchanged.

Recommended initial accounting: credit **net discounted revenue** and expose gross item value and discounts through immutable sale-line reporting. Do not claim a separate discount GL account if it is not posted. If a contra-revenue discount account is chosen later, update journals, report classification and refund reversals together so discounts are never counted twice.

Discounts change revenue and applicable tax, not issued quantity or recorded COGS. Weighted-average valuation must remain unchanged.

Partial refunds allocate the original discounted subtotal, original tax and original COGS; they must never use today's product price. Track the corresponding discount allocation for reporting. The final return consumes the exact remaining reversible amounts to avoid rounding residue or an excessive cumulative refund.

Update receipt preview, browser print, text download, sales detail, refund review, shifts and reports together. Basket summaries should distinguish original item value, item discounts, discounted subtotal, tax and final amount due.

## Slice 4: Useful, complete reporting over supported records

Improve the current screens around operator questions and source drilldown:

| Report | Required content |
| --- | --- |
| Sales and returns | Original item value, amount discounts, discounted revenue, tax, invoice totals, refunds, net sales and original-document drilldown. Refunds are included by their own posting/business date, including returns of earlier-period sales. |
| Payments and collections | Cash from sales, manual M-Pesa, account charges, later customer collections, cash/noncash refunds and reconciliation state. Payments and repayments must not create duplicate revenue. |
| Cash-up and operators | Opening float, cash sales, collections, refunds, paid-ins/payouts, expected/counted cash, difference/reason, and separately stated noncash tenders. |
| Item performance | Identity-stable product totals, quantity sold/returned, discounts, net revenue and original cost snapshots. Clearly define pre-/post-return ranking. |
| Customer balances and ageing | Opening balance, charges, allocated collections, closing balance, overdue bands based on recorded due dates, and AR control reconciliation. Missing due dates remain identified rather than guessed. |
| Inventory value | Quantity, carrying value, recorded/estimated source coverage, movements and GL control reconciliation. Do not substitute reference item cost for weighted-average carrying value. |
| Ledger and operating result | Account names, classifications, opening/debit/credit/closing balances, journal checks, complete source drilldown and the actual missing-source coverage. |

Define the control totals before building the cards:

- **Net sales revenue** is discounted revenue excluding tax minus refund subtotals excluding tax. Show tax reversals separately; do not subtract a tax-inclusive refund payment from tax-exclusive revenue.
- **Net drawer movement** is cash sales plus cash customer collections plus paid-ins, less cash refunds and payouts. Expected closing cash adds opening float. Preserve all supported cash sources, including room checkout, and show their separate categories where useful. M-Pesa is excluded from physical drawer cash.
- Payments and customer collections use their own transaction business dates, independently of the original sale date. A later repayment affects collections and receivables, not current-period sales revenue.

Default to Today, Yesterday, Last 7 days, This month and custom business dates. Use explicit allowed scope; do not introduce an all-outlets selector backed by unscoped queries or fabricate outlet attribution for existing tenant-only journal records.

Aggregate control totals over the **entire authorized selected dataset**, separately from paginated detail. Current top-ten previews may remain labelled previews, with continuation to the complete item report. Add stable pagination to capped sales, movements, customer/staff lists and other details before treating them as complete exports.

Use a consistent read snapshot/as-of boundary for detail and exports where necessary. Export the complete selected dataset, not the current page. Large exports should use authorized, audited jobs and expiring downloads as specified in `docs/18-REPORTS-INTELLIGENCE.md`. Source-document resolution must verify tenant, outlet and permission on every read.

Preserve existing performance targets: p95 common reads within 1.5 seconds and p95 first usable workspace within 3 seconds on the documented reference environment. Profile populated query plans before changing joins, indexes or caching. Keep aggregate and detail requests bounded and independent.

## Slice 5: Accounting workflows and controls

Accounting feels basic because business source workflows and controls are missing, not merely because there are few charts. Implement these in reviewable slices:

1. **Account catalogue and mapping:** human-readable names, account class, normal balance, control-account rules, statement mapping and explicit treatment of every existing posting code. Version policy changes; do not reclassify historical results silently.
2. **Operating expenses:** approved categories, amount/currency, business date, payee/reference and payment source; atomic balanced posting, immutable source evidence and authorized linked reversals. Distinguish operating costs from inventory purchases, supplier payments, transfers, owner movements and drawer movements.
3. **Reconciliation:** mobile-money recorded receipts versus statement evidence, unmatched/duplicate/amount-difference review, AR versus customer subledger, inventory value versus journal, and cash versus shift close evidence. Mark unknown or unreconciled sources honestly.
4. **Supplier invoices and AP:** receipt/invoice matching, duplicate guard, supplier balances, allocations and payments. Paying an existing liability does not record the expense a second time.
5. **Periods and adjustments:** explicit accounting effective date, OPEN/CLOSING/CLOSED controls, approved adjustments/reversals and source-control checks. Historical posted records stay immutable; failed close checks block closing.
6. **Statements and exports:** improve the operating summary as supported sources become complete. A full P&L, cash-flow or financial-position claim requires the relevant source coverage, mappings, opening balances and reconciliations. Until then, label supported account balances and partial results accurately.

Do not activate disconnected expense drafts or period-checklist prototypes as substitutes for these commands and controls. Tax/eTIMS compliance remains separately verified scope; this plan changes no tax rate or certification claim.

## Implementation order and exit evidence

Deliver the slices in order, each as a complete vertical change. Manual M-Pesa and discounts must include their receipt/report/recovery effects before release; they must not wait for a later cosmetic reporting pass.

| Slice | Required implementation acceptance |
| --- | --- |
| 1: language/display/report defects | Every reachable screen and representative error/recovery branch reviewed; no exposed implementation instructions; unknown payments keep safe status recovery; exact money/quantity display; same-date refresh and report scope/date/aggregation fixes. |
| 2: manual M-Pesa | Cashier confirmation, missing/invalid reference, exact amount, duplicate references across concurrent operators/outlets, permissions, one command replay, lost response after commit, restart recovery, receipt/history/report/shift consistency and cash-refund rejection. |
| 3: amount item discounts | Quantity one/multiple/fractional, zero/one-minor-unit/full-line/excess/negative discount, unauthorized request, reason, stale catalog/version, configured mixed tax rates, rounding and partial/final discounted refunds. Verify no percentage or basket discount path. |
| 4: supported reports | Populated known control totals for sales, returns, discounts, tenders and repayments; product renames; multi-page totals/exports; tenant/outlet/date boundaries; permission isolation; authorized original-document drilldown. |
| 5: accounting controls | Balanced journals, source/subledger reconciliations, append-only reversals, duplicate/replay protection, period/adjustment authorization, complete supported statement mappings and honest missing-source status. |

Implementation verification must include disposable production-shaped PostgreSQL data, fresh/upgrade/rerun migration checks, unchanged historical receipt/stock/order/payment/journal fingerprints, existing cash/account-charge/repayment regression, concurrent operators, and exact-commit CI. The dedicated current analytics integration test only checks zero totals for an absent tenant (`apps/api/test/operational-analytics.integration.test.ts:15-24`); it is insufficient evidence for the expanded reports.

Browser evidence must cover Firefox and Chromium, the viewport matrix in `docs/15-TESTING-ACCEPTANCE.md`, touch/keyboard access, meaningful loading/empty/error/retry states, navigation cancellation and cold/warm/offline/reconnection behavior. Keep IndexedDB recovery data and original command IDs across upgrades. No financial operation becomes offline-authorized through these changes.

Record actual commands/results and distinguish planned checks from executed evidence. Financial acceptance remains tied to the real PostgreSQL and browser journeys, including unchanged authoritative stock, order, payment, receipt, journal and historical records. Production release remains a separate gate requiring exact-main CI, verified artifacts, compatible additive migrations and a fresh isolated restore of the current production database. Owner acceptance of performance exceptions does not establish financial-workflow acceptance.

## References

- `agents/AGENTS.md`; `docs/01-PRODUCT-PRD.md`; `docs/02-UX-DESIGN-SYSTEM.md`; `docs/03-PLATFORM-ARCHITECTURE.md`.
- `docs/06-API-CONTRACTS.md`; `docs/09-FINANCE-ACCOUNTING.md`; `docs/10-POS-INVENTORY.md`; `docs/18-REPORTS-INTELLIGENCE.md`.
- `docs/24-BACKEND-INTEGRATION.md`; `docs/27-V1-COMPLETION-REGISTER.md`; `docs/28-BUSINESS-CONFIGURATION-INTEGRATION.md`.
- ADRs 0003, 0005 and 0006 for offline authorization, money/history and weighted-average cost.
- Current release/performance evidence: `docs/44-PERFORMANCE-ACCEPTANCE-2026-10-18.md` and `docs/45-PRODUCTION-RELEASE-2026-10-18.md`. Those historical results are not new-feature acceptance.
