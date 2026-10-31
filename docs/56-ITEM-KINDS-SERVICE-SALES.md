# Item kinds and service sales

Date: 25 October 2026, Africa/Nairobi. Plan ticket: S01-02.

Implementation is in progress. This document records the chosen domain rules,
each filled gap and observed verification; it does not claim acceptance before
the corresponding checks run. The full roadmap remains in
[the execution register](48-CODEBASE-TRUTH-EXECUTION.md).

## Classification and inventory evidence

`STOCKED_GOOD` tracks physical quantity and carrying value. `SERVICE` sells
through commerce without inventory movements, stock exceptions or inventory
COGS. `PREPARED` is explicitly distinguished and excluded from physical counts;
payment remains unavailable until recipe consumption is implemented. Hotel
room billing remains its own supported workflow, rather than an inferred
physical product type.

Migration 024 defaults every existing product and original sale-line snapshot
to stocked goods. No name-based classification or history rewrite occurs.
New services/prepared items have no inventory balance. Existing zero balance
rows survive reviewed reclassification; the catalog exposes nonstock quantity,
carrying value and stock version as null, with a separate actual balance version
for concurrency review. Database guards reject new nonstock physical quantity,
value and movement writes. Original sale-line kinds remain immutable inputs to
refund disposition even if the current item is later reclassified.

The dedicated versioned `catalog.product.change_kind` command requires a reason,
the product version and the actual balance version when a balance exists. It
requires zero physical quantity, zero carrying value, resolved stock exceptions
and no open outlet count. An existing misclassified record with stock must first
be corrected through a reviewed count/correction with its movement/journal
evidence; this command cannot delete or zero inventory. Metadata editing cannot
silently change kind. Converting a zero nonstock item to goods creates a zero
balance only when none exists. Audit/outbox evidence retains old/new kind and
the versions reviewed.

## Trading, counts and configuration

Service sale lines carry their original kind and zero inventory cost snapshots,
even when an item has a nonzero reference cost. Price, tax, discounts, tenders
and customer-account rules remain the existing commerce workflow. Only stocked
lines lock/change balances, create stock movements or use provisional stock
exceptions. Prepared payment rejects before any financial or stock posting.
Receiving rejects nonstock lines atomically, including mixed deliveries.

Refund disposition uses the immutable original sale kind. Services cannot be
restocked and create no inventory COGS reversal. An original stocked sale still
requires inventory authority after current reclassification; restoring physical
stock also requires the current item to remain active and stocked. Original
receipts, tax and COGS amounts are never rewritten by type changes.

Physical counts snapshot and check membership only for stocked goods. Creating
a service while a count is open cannot add a phantom count line or invalidate
its membership. A kind change remains blocked during any open count. The
inventory value report lists current stocked identities while retaining its
whole-tenant balance/movement/ledger controls, including preserved historical
zero rows. Historical movement access remains intact.

Commerce can be enabled without inventory; retail still requires both commerce
and inventory, and hospitality checkout retains its commerce dependency. The
first-sale checklist accepts an active service without a received stock row and
does not treat a prepared item as sale-ready. Catalog reads use a left join so
new nonstock items without balances remain visible. Reference cost keeps its
existing management/finance permission boundary; physical quantity/value/version
are null for nonstock items and when inventory is disabled.

Sales, refunds, receiving and stock-exception resolution use a shared outlet
catalog admission lock; catalog membership/kind changes and count snapshots use
the exclusive form of the same lock. Independent sales retain product-level
concurrency. Authority revalidation and PostgreSQL serialization retries remain
inside the original command transaction; a retry does not mint a new command ID.

## Migration and rollback boundary

Migrations 024 and 025 are additive. Existing products and sale lines become
stocked goods without label inference, and posted receipt, tax, quantity, value
and journal evidence remains unchanged. Previously applied SQL is not edited.
New commands persist authority version 1 and their trusted capability union;
legacy version-0 commands retain the earlier conservative requirements even
when old writers omit the new columns.

The preceding API does not understand service/prepared stock semantics. Database
guards prevent it from adding physical stock or movements to those identities,
but rejection alone does not make that API a compatible rollback target. Keep a
matching API for a static frontend rollback. An API rollback requires an
item-kind-aware compatible build or the separately approved and verified
backup/restore/cutover procedure, including the migration-023 category contract
described in docs/55. Do not drop constraints, rewrite historical kinds or remove
capability evidence to accommodate an older writer. No production migration or
rollback was exercised by these local disposable checks.

## Direct domain acceptance

With the disposable local PostgreSQL server and per-file isolation:

```text
node --import ./apps/api/test/support/isolate-database.mjs --import tsx --test apps/api/test/item-kinds.integration.test.ts
7 passed; 0 failed; 0 skipped. 24.35 seconds.
```

The six subcases plus parent cover commerce-only taxed decimal service sales,
original-ID replay, partial/final cash refunds and till closure; zero balances,
movements, shortfalls and inventory/COGS journal lines for services; mixed-basket
goods-only consumption; atomic prepared-payment and mixed-receiving rejection;
count exclusion with nonstock creation during counting; reviewed count-loss
correction before reclassification with unchanged subsequent movement/journal
evidence; product/balance version conflicts; explicit creation of a zero balance
on conversion to goods; scoped conversion; and original-kind refund behavior.

The first run reported four passed and three failed (two fixture errors and
their parent). The new test assumed the receipt route returned a nested
`receipt` property; its existing public response is the receipt object itself.
Corrected only the two fixture accesses, preserving the actual route and every
financial assertion. The complete rerun above passed.

The named disposable browser database upgraded from 023 to 024 and 025 with
checksums `7db9006c09b4` and `7c39b0313b7a`. Both new SQL files have explicit LF
checkout rules, preserving their checksummed bytes across Windows/Linux.

## Combined verification continuation (27 October)

The first complete sequential API rerun used the unchanged standard isolation
preload and completed 219 tests in 399.27 seconds: **217 passed, 2 failed, 0
skipped**. The two failures were an older configuration fixture that still
classified commerce alone as invalid and a customer-credit refund fixture that
supplied an unrelated random line ID. Trusted planning correctly could not find
that line before reaching the unsupported-tender guard. Corrected fixtures now
exercise valid original lines and retain separate invalid-line rejection; no
runtime guard is relaxed. The full failed reporter is preserved in
`.s01-kinds-api-full-reviewed-2026-10-27.log`. Focused reruns passed as recorded
below; the final complete API rerun remains required.

The coordinated typecheck and PWA build passed. The resulting main asset is
`index-Bf2i1Arf.js` (507.18 kB, 138.07 kB gzip); catalog maintenance is 24.11 kB /
7.30 kB gzip, Manage is 55.73 kB / 13.87 kB gzip, and PWA precaching includes
20 entries / 836.62 KiB. Existing Vite configuration/chunk warnings and a PWA
callback timing warning remain; build success is not performance acceptance.

The complete real API/PostgreSQL browser suite on this unchanged artifact
passed **19/19**, 1.8 minutes, using the preserved disposable `mazao_test`
database with migrations through 025. The previously failed configured stock
sale now passes, and the service workflow covers actual Manage reads before
the taxed sale/refund/close. Full output is retained in
`.s01-kinds-real-reviewed-2026-10-27.log`, with artifacts under
`dist-artifacts/playwright-s01-item-kinds-real-reviewed-2026-10-27`.
Full intercepted Chromium/Firefox and corrected combined API acceptance are
reported separately when terminal.

The corrected complete API rerun subsequently passed **219/219, 0 failed, 0
skipped**, 417.23 seconds, with the same sequential standard-isolation command
and unchanged migration-bootstrap limits. It includes the strengthened
commerce-only setup/checkout, valid unsupported credit refund and separate
invalid-line rejection, together with all inventory, finance, tenancy,
credential, migration and command-recovery cases. The retained reporter is
`.s01-kinds-api-final-2026-10-27.log`. No API runtime source changed between the
failed full run and this successful run; only the documented fixtures changed.
This API result remains separate from browser/physical/hosted release gates.

The shared dialog focus correction produced a new artifact after UI/API
typecheck and build passed: `index-cBYBUKkU.js` (507.26 kB / 138.09 kB gzip),
PWA 20 entries / 836.87 KiB. Three focused cases passed in Chromium (14.3
seconds) and Firefox (25.3 seconds), covering the original Add item entry,
active typing through a delayed focus frame, normal initial focus, cancellation
and focus restoration. The full real API/PostgreSQL browser suite on this
artifact passed **19/19**, 1.9 minutes; its reporter is
`.s01-kinds-real-focus-2026-10-27.log`, with artifacts in
`dist-artifacts/playwright-s01-item-kinds-real-focus-2026-10-27`.
The API runtime is unchanged from the 219-case passing run. Full 113-case
intercepted browser runs remain separate pending gates. Earlier artifact
results and failed traces are preserved below, without relabeling them.

## Confirmed settings navigation follow-up (27 October)

The 25 October full real browser batch completed 18 passed and 1 failed (19
tests, 3.0 minutes). The configured inventory/sale case clicked Stock immediately
after an outlet save displayed **Settings saved**. At that instant the form's
unsaved flag was still true until its refresh completed, so navigation raised a
discard confirmation. The browser dismissed that confirmation and remained in
Manage. No inventory or financial assertion was reached in the failed case.

A new configuration browser regression deliberately holds the post-confirmation
configuration refresh, dismisses unexpected dialogs, and attempts to navigate to
Help. It failed on the unchanged static artifact (1 failed, 17.6-second case),
proving this timing window without adding sleeps or relaxing deadlines. Its trace
is retained under `dist-artifacts/playwright-s01-settings-nav-repro-2026-10-27`;
the full real batch remains under `dist-artifacts/playwright-s01-item-kinds-real-all`.

`BackendManageWorkspace` now clears the submitted edits' unsaved flag when the
original command is confirmed, before displaying success and refreshing the
projection. Unknown/rejected/conflicted requests keep their existing recovery
rules. Fresh-build regression and the complete real browser batch remain required.

## Service-only settings follow-up (27 October)

Manage previously loaded business configuration and the inventory stock-sale
policy together unconditionally. With commerce alone, the actual policy endpoint
returns `CAPABILITY_DISABLED`, so even the business/outlet/capability forms could
not load. Earlier intercepted service fixtures supplied a policy regardless of
capability and masked this dependency.

A new browser case returns the actual 403 when inventory is disabled. Against
the unchanged artifact it failed before the business-name field appeared (1
failed, 17.2-second case); the trace remains under
`dist-artifacts/playwright-s01-service-settings-repro-2026-10-27`.

Manage now reads authoritative configuration first and requests the policy only
when inventory is enabled and the session has a supported policy-read
permission. It retains no invented policy/version when unavailable. The Stock
exceptions settings tab is disabled with a visible capability/access reason.
Deciding from returned configuration also handles a committed enable/disable
before the browser session refresh completes. A regression toggles inventory on
and off, checks that commerce remains enabled and counts only the one authorized
policy read. The real service workflow now visits Manage before creating its
item, and its existing request assertion covers this setup as well as POS.

Fresh-build focused and complete browser results remain required. The dedicated
kind fixtures now return 403 for this unavailable read rather than masking it.

## Real browser service workflow

The corrected real service workflow passed against the final static build and
the disposable localhost `mazao_test` database on 25 October 2026:

```text
npx playwright test --config playwright.integration.config.ts e2e/integration/service-sales.spec.ts --output=dist-artifacts/playwright-s01-service-real-reviewed --reporter=list
1 passed; 0 failed. 33.0 seconds overall; 12.1 seconds in the workflow.
```

The browser signs in with commerce alone, creates an explicit service, opens a
shift, takes taxed cash payment, reads the saved-kind receipt, refunds without
restocking and closes with the original cash float. Database assertions verify
zero physical balances, movements, shortfalls and inventory/COGS journal lines;
zero original/refund cost snapshots; balanced journals; a reconciled close; and
commerce-only persisted requirements for create, settle and refund. POS never
requests the unavailable inventory stock-sale policy. The preceding failed
locator trace remains preserved separately. This focused result does not imply
the full real browser suite or combined API regression passed.

## Verification status

The first combined API run was stopped after a confirmed compatibility failure,
before completion; it is not an accepted full regression. The existing closed-
period test deliberately sends incomplete sale/refund payloads and expects the
financial admission rejection first. New kind planning instead returned
`VALIDATION_FAILED` for missing lines. Read-only inspection of the retained test
database confirmed the period was closed, prior posting types were blocked and
the sale was rejected without posting. A narrow admission-order correction and
focused accounting/recovery verification are in progress. Valid service commands
must still persist their exact commerce-only requirements before financial
rejection so lost-response recovery cannot acquire an irrelevant inventory gate.

The interrupted run also encountered an actual 60-second disposable-database
migration bootstrap timeout and unusually slow legacy upgrade fixtures. Those
are retained failed/interrupted results, not evidence of a passing candidate or
a diagnosed production performance defect. Its live handle was explicitly
terminated to address the confirmed compatibility failure; no running test was
treated as stopped merely because an observation expired. The final combined
run will use sequential test-file execution without relaxing bootstrap limits.

The first new real service browser case failed on an exact-label select locator
before creating any item. The rendered control is a combobox; the fixture now
selects its accessible role/name, as used by focused UI acceptance, and uses the
same approach for the refund-reason select. The failed trace remains under
`dist-artifacts/playwright-s01-service-real`. A fresh source-frozen run remains
required after the coordinated final build and accounting correction.

Domain, migration, capability recovery, CSV and browser checks are pending until
observed results are appended below. No deployment or production schema change
has occurred.

## Frontend catalog, sales and setup

The independent **Items and services** workspace requires `catalog.manage` and
either commerce or inventory. It is reachable for service-only businesses;
Stock, receiving and counts retain their inventory capability boundaries.
Manage's Data import card and retained catalog/import recovery entries lead to
this catalog workspace. CSV imports also remain reachable from Stock. Import
navigation labels its return destination correctly in either context.

Creation offers Stocked good, Service and Prepared item, defaulting to Service
when inventory is disabled. Metadata editing keeps the item type immutable;
changing it uses a separate reasoned review dialog. The command includes the
current product version and the actual balance version when one exists, with
no invented version for a new nonstock item. Known stock quantity/value blocks
the action and directs an operator to the existing reviewed stock-correction
workflow. Missing balance-version evidence also disables reclassification.
Nonstock rows display no stock quantity/value; unavailable stocked fields say
they are unavailable. The original requested kind, reason, versions and command
ID survive an unknown outcome and reload through the existing journal.
Current-type actions also honor their capability: stocked goods require
inventory, while services/prepared items require sales. Creation and change-type
selectors disable destinations whose capability is not enabled. Today and Help
offer catalog entry independently of Stock; Today no longer advertises stock or
receiving shortcuts when inventory is disabled.

POS skips the stock-policy read when inventory is disabled. Services have no
on-hand text or shortfall confirmation, and mixed baskets request stock
acknowledgement only for stocked goods. Prepared items show that recipe
consumption is unavailable and cannot enter payment through selection or scan.
Stocked goods cannot be sold while inventory is disabled. Receiving and the
Stock list filter out nonstock kinds. Count entry describes stocked goods as
its physical baseline.

Refund disposition uses each original sale line's saved kind rather than the
current catalog type. A service refund shows **Service refund: no stock return**
and always sends `restock: false`. Nonstock return controls remain disabled.
If inventory is disabled, a new mixed refund leaves stocked-line quantities at
zero and disables those inputs while permitting service refunds. An entirely
stocked remaining sale cannot start a new refund until inventory is enabled.
This matches the server's requirement for every stocked historical line even
when no physical stock return is requested. A saved unknown stocked refund
retains its original quantity and stock-return intent; its checked control
explicitly says the original request returns stock and inventory is currently
disabled. Checking that command never substitutes a newly computed disposition.
Receipt preview and text export use the immutable line kind to identify services
and prepared items; older lines without a kind keep their stocked-good fallback.
These changes do not infer classifications from names or rewrite history.

CSV mapping supports `itemKind` with the exact accepted values and explains that
CSV cannot reclassify an existing item. Review labels each normalized kind;
service/prepared rows do not display opening-stock quantities as physical stock.
The template includes an explicit `STOCKED_GOOD` example. Capability checkboxes
were already independent; obsolete copy claiming that sales requires inventory
is replaced with the supported service-only behavior. First-sale readiness
continues to use the server's actual checks.

The mixed-basket review also exposed an existing display bug: React rendered
the BigInt zero from a conditional discount expression before the line amount
(`0KES 10`). The condition now evaluates to a boolean before rendering the
optional crossed-out original amount. A service-sale browser assertion checks
the actual visible basket price, so the unwanted prefix cannot pass unnoticed.
This is a presentation correction; amount calculations and settlement payloads
are unchanged.

UI TypeScript passed after the initial changes. Twelve focused intercepted browser
cases have been added for commerce-only catalog creation and sale, prepared
payment blocking, mixed stock exceptions/receiving, mobile original-ID type
recovery, absent/existing balance versions, count/stock correction gates,
historical service refunds, service CSV review, independent capabilities,
inventory-only negative gates, mixed refunds without inventory and retained
unknown stocked-refund intent.
Their browser results remain pending until the integrated build is tested.

The first integrated focused browser attempt reported **21 passed, 1 failed**
out of 22 in 7.5 minutes. The failure waited on an exact label locator for the
mixed-basket reason selector; its retained accessibility snapshot contained the
expected `Reason` combobox and only the stocked-good shortfall. The fixture now
selects that accessible combobox role. Item-type selectors use the same explicit
role. First-failure trace and context remain under
`dist-artifacts/playwright-s01-item-kinds-ui`. Some unchanged recovery cases took
25–45 seconds in this run, compared with roughly three seconds previously;
host resource/timing effects were observed but no cause or product latency fix
is claimed. Follow-up UI/API typecheck passed. A fresh build and the corrected
25-case run, including the negative-capability and refund review cases, remain
pending.

## Trusted command capability evidence

Migration 025 adds `system.commands.authority_version` and
`required_capabilities`. The default remains version zero for older API writers
during an upgrade. Existing catalog/product/category/import commands retain
their original inventory requirement; existing sale/refund commands retain
commerce plus inventory. Recovery uses a frozen legacy map for version-zero
rows, including rows inserted after the backfill by an older API. Empty SQL
defaults cannot turn an old stocked command into a commerce-only operation.

New commands store version-one capability evidence from a server-side planner
in the same serializable transaction. The planner reads scoped product kinds,
immutable original sale-line kinds for refunds, or server-owned import evidence.
Product classification changes require the union of old and requested kinds.
Category planning includes archived referenced products; an empty category uses
commerce when enabled, otherwise inventory. Mixed service/stock categories and
imports require both capabilities. Stocked refunds require inventory even when
the operator chooses no restocking.

The planner holds the catalog advisory lock exclusively for catalog commands
and in shared mode for sales/refunds, preserving independent product sale
concurrency. It takes no product/order row locks that would later need upgrading.
Execution retains its row/version checks, and a serialization retry repeats the
whole transaction and capability plan. Capability evidence is written before the
business savepoint. A business rejection rolls back its effects while retaining
the original requirements and canonical response. A planning rejection retains
the conservative legacy requirements if exact requirements could not be derived;
an unexpected database error aborts the whole transaction.

Status and replay recheck the original actor/outlet, current role permissions,
and the stored capabilities before comparing a retry's content hash. Neither
the retry payload nor a product's later kind can weaken or add requirements to
the original outcome. Unknown authority versions, invalid arrays, duplicate or
unknown capabilities, and missing required evidence fail closed. Internal
authority fields are excluded from public status responses. Dedicated password
operations retain their existing credential fences and zero-capability legacy
recovery; capability evidence contains no passwords, replayable bodies or CSV.

The populated upgrade test compares every pre-existing product, order-line,
balance, movement, order, payment, shift, journal, command, audit and outbox field;
only newly added kind/authority columns are excluded and separately asserted.
It checks all 25 migration checksums on rerun, original command hashes/responses,
stocked legacy defaults and database guards. Earlier upgrade tests use the same
additive-column comparison rule, preserving their original financial assertions.

Observed on 25 October 2026 against the disposable localhost PostgreSQL service:

```text
node --import tsx --test apps/api/test/command-authority.test.ts
5 passed, 0 failed, 0 skipped

node --import ./apps/api/test/support/isolate-database.mjs --import tsx --test --test-concurrency=1 apps/api/test/command-recovery.integration.test.ts
13 passed, 0 failed, 0 skipped; 14.37 seconds

node --import tsx --test --test-concurrency=1 apps/api/test/item-kinds-upgrade.integration.test.ts apps/api/test/catalog-maintenance-upgrade.integration.test.ts apps/api/test/product-import-upgrade.integration.test.ts
9 passed, 0 failed, 0 skipped; 23.83 seconds
```

The recovery run includes original actor/outlet/tenant and fresh-session checks,
revocation after HTTP preflight, role/capability loss, staff/password metadata,
cash replay after shift closure, unknown stored types, both directions of later
kind change, business-savepoint and planning rejection, rolling-upgrade writers,
malformed descriptors, archived category references and stocked nonrestocking
refunds. None of the recovery attempts repeats stock, payment, journal, audit or
outbox effects. The upgrade batch includes the new populated kind/authority
migration, prior catalog collision/normalization preflight rollback tests, and
the older import/credential upgrade.

API TypeScript and scoped diff checks passed. These local source/disposable
database checks are not deployment or production migration evidence.

### Period-admission compatibility regression

The first broad S01-02 API run was explicitly stopped after a confirmed failure;
it is an aborted partial run, not a complete pass or an observation timeout.
Its accounting-period test sent deliberately incomplete sales/refund payloads
after closing the period. New kind planning rejected the missing sale lines
before the established financial-period admission, returning `VALIDATION_FAILED`
where the earlier contract returned `PERIOD_CLOSED`. Read-only inspection of the
retained disposable database confirmed the exact stored rejection and a closed
period; no posting bypass was observed. That partial run also hit an actual
60-second isolation-bootstrap timeout and slow upgrade fixtures under host
contention. Its incomplete results are not counted as acceptance.

The compatibility fix invokes financial admission after a pre-savepoint
`VALIDATION_FAILED`/`NOT_FOUND` planning error only for dynamically planned
sale/refund/import-apply commands. Permission and capability failures keep their
priority, static schema validation remains first, and unexpected database errors
propagate to the existing serializable retry boundary. Invalid import UUIDs
retain controlled validation instead of reaching a raw PostgreSQL UUID cast.
Malformed supplied refund order IDs also retain controlled validation; an
omitted ID keeps the earlier closed-period admission behavior. Valid service
commands still complete their exact commerce-only capability plan
before admission, so a lost closed-period rejection remains recoverable without
inventory. Added assertions cover that recovery, malformed import UUIDs and
closed-period `shift.open` schema precedence. Focused verification of this fix
is recorded below after the run completes.

The first isolated accounting rerun failed before any test body: its migration
bootstrap reached the existing 60-second limit (`spawnSync ETIMEDOUT`, one file
failure, zero passed; 66.8 seconds). No timeout was raised and no accounting
assertion was evaluated by that attempt. Type checking was also unusually slow
at the same time; that attempt did not satisfy the focused verification gate.

The subsequent accounting rerun passed **6/6, zero failures/skips**, in
**255.92 seconds**. This used a separate, generated
`mazao_accounting_efdd57271f3b4bba9b23a6cc284fea98` database inside the existing
disposable task container. Setup was explicit: create that database, set
`DATABASE_URL` to its local fixture URL, and run
`node --import tsx apps/api/src/migration.ts` to completion (all 25 applied,
exit zero). Then set `TEST_DATABASE_URL` to the same isolated URL and run:

```text
node --import tsx --test --test-concurrency=1 apps/api/test/accounting-controls.integration.test.ts
```

The successful manual run omits the global isolation preload because setup
already created its own fresh database. It does not change or validate away
the automated preload's existing 60-second setup gate. The earlier failed
bootstrap remains a failed attempt. The reporter is retained locally in
`.s01-kinds-accounting-manual.log`; this result includes all period, reconciliation,
stale-snapshot and new compatibility assertions. A separate fresh-database
command-recovery rerun follows sequentially; no other database suite overlaps.

That sequential command-recovery rerun passed **13/13, zero failures/skips**, in
**46.08 seconds**, with the existing 180-second suite deadline unchanged. Its
separate generated database was
`mazao_recovery_80b9a49c43c6491eae96c4031f49827b`, explicitly migrated through
001-025 before running:

```text
node --import tsx --test --test-concurrency=1 apps/api/test/command-recovery.integration.test.ts
```

The reporter and migration output are retained locally in
`.s01-kinds-recovery-manual.log`. These focused manual-isolation passes verify
the compatibility fix and original recovery authority; a complete automated
API rerun remains a separate gate after the aborted broad attempt.

## Shared validation, contracts and CSV evidence

Direct item creation accepts `itemKind` as exactly `STOCKED_GOOD`, `SERVICE` or
`PREPARED`; omission preserves stocked-good defaults for earlier clients.
Nullable, coerced, padded and unknown kinds are rejected. Complete metadata
update still excludes kind, SKU, base unit and currency, so changing stock
tracking always requires the dedicated reviewed command. That command has a
strict payload/result contract, retains `catalog.manage`, uses the original
product/balance expected-version keys, and remains online only. Catalog/import
static capability lists are empty so the trusted planner can derive item kinds;
sales/refund retain commerce as their static requirement. The domain and stored
capability evidence remain authoritative for additional inventory access.

CSV mappings now support `itemKind`. Omitted new-row kinds become stocked goods;
omitted upsert kinds preserve the current scoped product kind. An explicit
different upsert kind produces `ITEM_KIND_CHANGE_REQUIRES_REVIEW` and cannot
apply. The normalized preview exposes the kind. Service/prepared rows reject
positive opening quantity or any nonempty explicit opening unit cost, including
zero. Their zero reference cost does not produce an inventory warning. New
service/prepared rows create no balance, movement or opening journal; stocked
creation retains its existing quantity, integer valuation and journal path.
Only batches containing stocked rows enter the open-count import gate.

Apply still verifies the original stored source/report hashes and recomputes
the complete report against locked scoped products. Older reports without
`itemKind` compare using a stocked-good default in copies; their original report
bytes, hash inputs and stored historical evidence are not rewritten. Product
versions and the stored/current kind comparison make later reclassification
stale. The upsert SQL also matches the reviewed kind and never updates it.

`productImportRequiredCapabilities` derives write requirements from current
source normalization, the original report and current referenced product kinds.
The union cannot downgrade a previously reviewed stocked batch after an item
is reclassified. It takes no product locks before the domain's update locks;
the planner already holds the outlet advisory lock. Detail/source/error reads
require the original report kinds alone, so a historical service batch retains
its original read authority after reclassification. List SQL filters that same
historical kind union before pagination and total counting. Legacy missing kinds
require inventory; mixed reports require both inventory and commerce. Empty
invalid reports contain no kind evidence and remain available to an authorized
catalog manager with at least commerce or inventory. Tenant/outlet scoping is
unchanged.

Client terminal validation for kind changes requires the original product ID
and requested kind, a positive safe result version, and a `stockTracked` value
consistent with the returned kind. Incomplete or contradictory results retain
the original recovery command. Business messages explain stock/exception
reclassification blocks and receiving attempts for nonstock items.

Observed shared verification on 25 October 2026:

```text
node --import tsx --test apps/api/test/catalog-validation.test.ts apps/api/test/product-import-validation.test.ts apps/api/test/api-messages.test.ts apps/api/test/command-catalogue.test.ts
32 passed; 0 failed; 0 skipped.

npm run typecheck
Passed for UI and API.

TEST_DATABASE_URL=<disposable localhost PostgreSQL>
node --import tsx --import ./apps/api/test/support/isolate-database.mjs --test apps/api/test/item-kind-import.integration.test.ts
7 passed; 0 failed; 0 skipped; 9.80 seconds.
```

The pure cases cover kind defaults and exact choices, immutable metadata kind,
CSV service/prepared opening restrictions, omitted/same/different upsert kinds,
zero-reference warning scope, untouched legacy report comparison, original plus
current capability union, strict command contracts and retained acknowledgement
identity. The dedicated `item-kind-import.integration.test.ts` adds real API/DB
acceptance for writes, replay, no stock/financial effects, legacy apply hashes,
stale review, historical read scopes and authorized pagination totals. All six
subcases and their parent pass on an independently migrated disposable database.
The read case proves service/prepared-only history remains visible with commerce
alone, legacy/mixed reports remain hidden without inventory, count/cursor pages
contain only authorized batches, foreign tenant/outlet details return 404, and
historical service authority does not change when the current product becomes
stocked. Inventory-only access sees the original goods batch and cannot read
historical service source.

The first DB run passed five subcases before its last fixture attempted to move
an assignment already referenced by a session. The existing composite session
foreign key correctly rejected that fixture update. The corrected test creates
an independent authenticated assignment in the other outlet; no runtime code
change was required. These local results do not replace the combined API,
fresh-build browser, hosted CI or operational release evidence.

## 27 October refund and import recovery follow-up

The committed checkpoint `f365090` already contains the fixture corrections for
waiting for authenticated navigation, checking the actual disabled option
attribute, and advancing refunded quantities after the mocked commit. A focused
run against its preserved static artifact reproduced the remaining refund UI
defect: the full committed/lost-response case failed because the review dialog
hid a line whose remaining quantity was already zero. Its original requested
quantity and stock-return choice therefore disappeared after reload.

```text
npx playwright test e2e/catalog-item-kinds.spec.ts --grep 'a full committed lost stocked refund' --output=dist-artifacts/playwright-s01-refund-committed-repro-2026-10-27 --reporter=list
1 failed. The expected original stock-return control was absent.
```

The failed trace is retained in that directory. The UI now renders unknown
refunds from their original command's requested line IDs, including exhausted
lines, while retaining disabled original quantities and dispositions. It does
not add unrelated remaining lines to that pending request. Ordinary new refunds
still show only remaining quantities. If the original sale is older than the
first history page, recovery uses the existing tenant/outlet-scoped server search
for its exact order ID and selects the matching result. This additional recovery
lookup does not alter the displayed history page or its totals. Status lookup
retains the original command ID; the fix does not create a replacement refund.

Four browser cases cover full and partial committed refunds, both within and
beyond the first history page, after inventory is disabled. They assert the
original quantity, checked stock-return intent, current remaining quantity,
durable unchanged journal, and removal only after an accepted original status.
The import recovery client case models an applied/lost-response import followed
by an original-ID POST retry denied with HTTP 403. The command must remain in
IndexedDB across reload, new imports stay locked, and restored authority permits
the original saved confirmation to clear it without a second commit. CSV source
never enters that ordinary command record. The API authority correction and
database evidence are documented separately below.

Verification on 27 October used the coordinated static artifact
`index-Bf2i1Arf.js`, after the shared UI/API typecheck and production build passed:

```text
node node_modules/@playwright/test/cli.js test e2e/configuration.spec.ts --grep 'service-only settings skip|confirmed settings allow navigation' --output=dist-artifacts/playwright-s01-config-review-2026-10-27 --reporter=list
2 passed; 0 failed. 9.8 seconds.

node node_modules/@playwright/test/cli.js test e2e/catalog-maintenance.spec.ts e2e/catalog-item-kinds.spec.ts e2e/catalog-recovery-response.spec.ts --output=dist-artifacts/playwright-s01-catalog-review-2026-10-27 --reporter=list
29 passed; 0 failed. 1.6 minutes. No test retries.
```

The 29-case batch comprises 15 item-kind cases, nine maintenance cases and five
response/recovery cases. All four committed refund cases and the import POST-403
case passed; the latter recovered the original saved confirmation with exactly
one modeled commit and two identical POST envelopes. The item-kind fixture now
returns the actual inventory-disabled HTTP 403 for stock-policy reads, instead
of supplying a policy to service-only sessions. The two settings regressions
separately verify capability enable/disable policy reads and navigation while a
confirmed projection refresh remains held. The reproduced failure above remains
failed evidence for the preceding artifact. These focused runs do not establish
the full browser suite, hosted CI, physical hardware or production acceptance.

## 27 October full browser regression

On the same frozen `index-Bf2i1Arf.js` artifact, the complete intercepted Chromium
suite passed:

```text
node node_modules/@playwright/test/cli.js test --output=dist-artifacts/playwright-s01-all-chromium-2026-10-27 --reporter=list
111 passed; 0 failed. 9.0 minutes. No test retries.
```

A deliberate conversation interruption did not restart this run. Its original
live handle was polled to terminal completion and the remaining reporter output
was retained. All catalog, service, refund, import-journal, configuration,
credential, inventory, directory, history and existing recovery cases in that
suite passed. This is intercepted browser acceptance; it does not replace real
API/PostgreSQL, exact-head hosted CI, installed-PWA, physical or performance gates.
The preview logged an unmocked trial-balance proxy refusal in the existing
account-label case; that case's mocked label workflow passed. No live API result
is inferred from that intercepted case.

After verifying port 3000 was released and the static entry still referenced
`index-Bf2i1Arf.js`, the complete Firefox suite was started without rebuilding.
Its original handle completed with **110 passed, one failed**, 11.0 minutes:

```text
node node_modules/@playwright/test/cli.js test --browser=firefox --output=dist-artifacts/playwright-s01-all-firefox-2026-10-27 --reporter=list
110 passed; 1 failed. No test retries.
```

Only the original Add item creation case failed. Its dialog remained open with
an empty required item name while the SKU, price, cost, barcode, reorder level
and category retained their entered values, so it never reached the expected
Stock screen. The trace records the first field-fill followed by late catalog
reads, without a page/console exception. This is retained failed acceptance,
not a full Firefox pass. All four committed-refund recovery cases, the denied
import retry/journal case and both new settings cases passed in that run.
Deterministic callback-order tests then reproduced a shared dialog focus race
consistent with this first-input failure:

```text
node node_modules/@playwright/test/cli.js test e2e/catalog-maintenance.spec.ts --browser=firefox --grep 'queued dialog focus|dialog initial focus' --output=dist-artifacts/playwright-s01-dialog-focus-repro-2026-10-27 --reporter=list
2 failed against index-Bf2i1Arf.js.
```

The first case explicitly held the queued animation-frame callback, focused the
name field and entered `First`, then released the callback before entering the
remaining text. The callback moved focus away and the field retained only
`First` instead of `First entry`. The second case verified normal initial focus
and Escape restoration, then demonstrated that closing a dialog left its queued
focus callback uncancelled. Both failed traces are preserved in the reproduction
directory. No delay or timeout relaxation was added to the original creation
case.

`ResponsiveDialog` now moves initial focus only when focus is still outside the
dialog, preserving an operator who already selected a field. Effect cleanup
cancels its scheduled animation frame before restoring the previous focus.
Fresh-build focus, creation and full browser/real-API acceptance remain required
for this shared component change; the preceding 111-case Chromium pass applies
to the earlier artifact.

The coordinated UI/API typecheck and build subsequently passed with static entry
`index-cBYBUKkU.js`. Focused acceptance of that new artifact passed in both browsers:

```text
node node_modules/@playwright/test/cli.js test e2e/catalog-maintenance.spec.ts --grep 'queued dialog focus|dialog initial focus|original Add item entry' --output=dist-artifacts/playwright-s01-dialog-focus-chromium-verified-2026-10-27 --reporter=list
3 passed; 0 failed. 14.3 seconds.

node node_modules/@playwright/test/cli.js test e2e/catalog-maintenance.spec.ts --browser=firefox --grep 'queued dialog focus|dialog initial focus|original Add item entry' --output=dist-artifacts/playwright-s01-dialog-focus-firefox-verified-2026-10-27 --reporter=list
3 passed; 0 failed. 25.3 seconds.
```

These cases include the original create-and-return workflow plus deterministic
typing preservation and normal initial focus/close restoration with callback
cancellation. No test deadline or original creation locator was changed. The
new artifact still requires the complete browser and real-API regressions.

The pending stocked-refund fixture was also hardened to model the API's actual
recovery authority. Its earlier UI-only status mock could return confirmation
while inventory remained disabled; that was not evidence of a server authority
bypass. The fixture now freezes the inventory requirement from the original sale
line when accepting the refund, returns HTTP 403 for its status while inventory
is disabled, and leaves the original intent and journal intact without another
POST. Each case then restores inventory, reloads through `GET /auth/me`, and
recovers the same original confirmation exactly once. It does not derive this
requirement from mutable current catalog kinds. No application source or build
changed for this fixture correction.

```text
node node_modules/@playwright/test/cli.js test e2e/catalog-item-kinds.spec.ts --grep 'committed lost stocked refund' --output=dist-artifacts/playwright-s01-refund-authority-chromium-2026-10-27 --reporter=list
4 passed; 0 failed. 18.0 seconds.

node node_modules/@playwright/test/cli.js test e2e/catalog-item-kinds.spec.ts --browser=firefox --grep 'committed lost stocked refund' --output=dist-artifacts/playwright-s01-refund-authority-firefox-2026-10-27 --reporter=list
4 passed; 0 failed. 44.5 seconds.
```

The complete 113-case Chromium suite, including the two new dialog regressions
and these stronger refund cases, passed on the same `index-cBYBUKkU.js` build:

```text
node node_modules/@playwright/test/cli.js test --output=dist-artifacts/playwright-s01-all-chromium-dialog-reviewed-2026-10-27 --reporter=list
113 passed; 0 failed. 5.0 minutes. No test retries.
```

The complete 113-case Firefox rerun was then started on this unchanged artifact.
Its result remains pending until terminal output is appended. The preceding
111-case Chromium and 110-pass/one-fail Firefox runs describe the earlier static
artifact and are retained separately.

## 27 October review: denied import replay retains recovery evidence

Review found an import-specific exception in original-ID POST replay. When
current permission or capability checks failed, it returned HTTP 200 with a
synthetic `REJECTED` result under the original command ID. The stored import
could already be confirmed, while the client's terminal-result handling would
remove its unresolved journal. The GET status route correctly returned an
access error, so POST and GET disagreed about what the caller had learned.

POST replay now propagates the same current-authority HTTP error. A revoked
role or disabled required capability returns HTTP 403 with `error.code`, without
claiming a terminal status or returning the original outcome. The original
command, request hash, capability requirements and posting evidence remain
unchanged. After authority is restored, the same original ID can recover its
stored outcome without repeating business work. This changes recovery admission;
fresh commands still persist their own definite domain outcomes as before.

The new command-recovery DB case commits both validation and a stocked opening
import, then checks role/capability revocation after HTTP preflight and subsequent
GET/POST denials. It compares complete import/product/balance/movement/journal/
command/audit/outbox rows before and after denied retries and authorized recovery.
Existing import-security assertions now require the real HTTP denial instead of
the synthetic terminal envelope.

Observed local verification on 27 October 2026, sequentially against separate
fresh databases on the task-owned localhost PostgreSQL 16 server:

```text
TEST_DATABASE_URL=<disposable localhost PostgreSQL>
node --import ./apps/api/test/support/isolate-database.mjs --import tsx --test apps/api/test/command-recovery.integration.test.ts
14 passed; 0 failed; 0 skipped. 31.95 seconds.

node --import ./apps/api/test/support/isolate-database.mjs --import tsx --test apps/api/test/product-import-security.integration.test.ts
10 passed; 0 failed; 0 skipped. 28.73 seconds.

npx tsc --noEmit -p tsconfig.api.json
Passed.
```

Both runs used the unchanged standard migration preload and its 60-second
bootstrap gate. The generated databases were
`mazao_api_a9eb9e5b4348424788791635fb12ec9f` and
`mazao_api_b712ab15852a44a7a1922d35e0a0c5c1`; the full reporter logs remain in
`.s01-kinds-replay-recovery-2026-10-27.log` and
`.s01-kinds-import-security-2026-10-27.log`. The new committed-import subcase
passed in 1.17 seconds. Scope-specific `git diff --check` also passed. These
results validate API recovery and import security; the paired client journal
case, combined regression and exact-head hosted/release gates remain separate.

## 27 October review: align API fixtures with service and original-line authority

The configuration suite still listed `['commerce']` as an invalid capability
set. S01-02 explicitly supports service-only commerce. Its negative cases now
check retail missing inventory, retail missing commerce, hospitality missing
commerce, duplicate capabilities and an unsupported restaurant capability.
The existing hardcoded business-version sequence is preserved. A positive
workflow appended at the end uses the current server version to enable commerce
alone and replays that setup once. Stocked goods alone do not satisfy its
catalog readiness; creating an explicit service makes it ready, and actual
checkout succeeds without an inventory capability. Database assertions confirm
commerce-only saved requirements, no service balance or movements and zero
inventory cost/COGS snapshots despite a nonzero reference cost. The previous
stocked receipt, balance and COGS evidence remains unchanged.

A later negative configuration fixture supplied a refund without any original
line, preventing trusted planning from deriving its stocked requirement. It now
uses the actual prior receipt line, with no restock requested. This verifies that
original stocked refunds still need inventory, independently of disposition.

The PostgreSQL integration fixture for unsupported customer-account refunds
previously supplied a random line UUID. It now supplies the actual immutable
credit receipt line and still receives `CUSTOMER_CREDIT_REFUND_UNAVAILABLE`.
A separate invalid-line command explicitly expects `NOT_FOUND`. Complete saved
orders/lines/payments/refunds/shifts, balances/movements, customer accounts/
charges and journals are compared before and after both refusals, proving no
credit reversal, cash refund or stock mutation. These are test-fixture
corrections; command planning, tender policy and posting code are unchanged.

Observed focused verification on 27 October 2026, sequentially with the unchanged
standard isolation/migration preload and separate fresh task-owned databases:

```text
TEST_DATABASE_URL=<disposable localhost PostgreSQL>
node --import ./apps/api/test/support/isolate-database.mjs --import tsx --test apps/api/test/configuration.integration.test.ts
1 passed; 0 failed; 0 skipped. 26.11 seconds overall; 11.99 seconds in the workflow.

node --import ./apps/api/test/support/isolate-database.mjs --import tsx --test apps/api/test/postgres.integration.test.ts
1 passed; 0 failed; 0 skipped. 51.96 seconds overall; 40.07 seconds in the workflow.

npx tsc --noEmit -p tsconfig.api.json
Passed.
```

The generated databases were `mazao_api_e10716f017274ef5a346f27fea6a27e1` and
`mazao_api_d1fff17d3fdb4ba8baf30914f3a7adc4`. Full reporter logs are retained in
`.s01-kinds-configuration-reviewed-2026-10-27.log` and
`.s01-kinds-postgres-reviewed-2026-10-27.log`. The PostgreSQL test continued on
its original live process across an intentional turn interruption; its terminal
exit 0 was polled from that same handle, with no restart. Scope-specific diff
checks passed. The earlier 217/219 run remains failed evidence until a separate
complete rerun validates the candidate.

## 29 October 2026 local artifact acceptance follow-up

The first full Firefox run against the S01-02 artifact completed **109/113**.
All four failures timed out at page navigation waiting for `load`; their traces
showed unresolved Google Fonts stylesheet/WOFF2 requests while the application
had rendered. This was an artifact-level external font dependency, so the fix
removed the Google Fonts preconnect and stylesheet from `index.html`, set system
font stacks in `src/index.css`, and changed receipt CSS to a system monospace
stack in `src/services/hardware.ts`. The fixed 1.5-second wait in the workspace-
navigation cancellation test also became a held route plus an assertion that the
obsolete shift-status request was cancelled while pending.

On the rebuilt offline-font artifact, the complete intercepted browser suites
passed **113/113 in Firefox** (5.4 minutes) and **113/113 in Chromium** (3.1
minutes). The five earlier Firefox failures each passed in a targeted rerun.
The source-frozen real API/PostgreSQL browser suite remains **19/19**, the
configuration browser cases **2/2**, and the catalog/kind/recovery batch **29/29**.
The complete isolated API regression passed **219/219, 0 skipped** after the
27 October fixture corrections. `npm run typecheck` passed UI and API; `npm run
build` passed with entry JS 507.26 kB / 138.09 kB gzip, 20 precache entries and
836.59 KiB total precache. Existing chunk-size warning remains; bundle size is
not a performance acceptance result.

Evidence logs: `.s01-font-followups-firefox-2026-10-28.log`,
`.s01-all-firefox-system-fonts-2026-10-28.log`,
`.s01-all-chromium-system-fonts-2026-10-28.log`,
`.s01-kinds-build-font-offline-2026-10-28.log` and
`.s01-kinds-typecheck-font-offline-2026-10-28.log`. Browser traces and reports
are under `dist-artifacts/playwright-s01-all-firefox-system-fonts-2026-10-28`
and `dist-artifacts/playwright-s01-all-chromium-system-fonts-2026-10-28`.

This establishes local artifact acceptance for S01-02, including its full
intercepted browser matrix. Exact-head hosted CI and all release, production,
backup/restore, installed-device and performance gates remain separate.

## Failed product import queue archival

Migration `029_product_import_queue_archive.sql` adds reversible queue archive
metadata to import batches. Only `INVALID` batches can be archived or restored;
their status, raw CSV, validation report and error export remain intact. The
active history is the default, and `GET /api/v1/catalog/imports?archived=true`
lists archived reviews. Batch mutations use the online `catalog.import.archive`
and `catalog.import.restore` commands with the `import:<batchId>` expected
version, current `catalog.manage` authority, command idempotency and audit/outbox
evidence. Restore is required before revalidation. Applied batches are never
archived by these commands.

An unresolved local validation can be removed only after its original command
status returns 404. The browser action clears only local validation recovery
metadata; unknown apply/archive/restore outcomes continue through command status
recovery.

Bulk imports keep one `catalog.category.created` audit record for each newly
created category. Their transactional outbox publishes one
`catalog.import.categories.created` event with `schemaVersion: 1`, the import
batch and command IDs, tenant/outlet scope, and the deduplicated category IDs,
names, versions, and source. This fits the outbox's one-event-type-per-command
identity. The repository has no outbox consumer for the legacy per-category
event; integrations that consume category creation from bulk imports should
subscribe to the aggregate event. Ordinary single-category commands retain
their existing `catalog.category.created` audit and outbox event.

PostgreSQL regression coverage includes 58 imported products across existing
and new categories, positive and zero opening quantities, exact `KES 96,012`
stock valuation, event completeness, confirmed-command replay, and a forced
mid-import error proving category, product, stock, journal, command, audit and
outbox rollback together.

Focused acceptance commands:

```sh
node --import tsx --test apps/api/test/command-catalogue.test.ts
node --import ./apps/api/test/support/isolate-database.mjs --import tsx --test apps/api/test/product-import-security.integration.test.ts apps/api/test/product-import-upgrade.integration.test.ts
npx playwright test --config playwright.integration.config.ts e2e/integration/product-import.spec.ts
```
