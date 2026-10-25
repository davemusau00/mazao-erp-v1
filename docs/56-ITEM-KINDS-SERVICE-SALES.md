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
