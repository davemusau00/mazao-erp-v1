# Catalog maintenance and categories

Date: 25 October 2026, Africa/Nairobi. Plan ticket: S01-01.

This slice extends the authenticated PostgreSQL catalogue. Product identity
(SKU, base unit and currency), posted sale/receipt snapshots, stock quantity
and carrying value remain separate from editable product metadata. Maintenance
commands are online only and require `catalog.manage` with inventory enabled.
Domain, migration and browser evidence is recorded below as it is verified.

## Shared validation and command contracts

`apps/api/src/catalogValidation.ts` now owns direct-create/update and CSV
normalization. SKU/barcode leading zeros remain text. Scientific notation is
rejected for identifiers; product names, category labels and other supplied
fields reject control characters before trimming. SKU, base unit and barcode
retain their existing identifier alphabets and lengths. Category labels remain
exact and case-sensitive: `Pantry` and `pantry` do not silently merge.

Direct prices are non-negative safe integer minor units. CSV decimal prices
convert with integer arithmetic using the currency's fraction digits; unsafe
values, thousands separators, signs and scientific notation are rejected.
Quantities remain decimal strings with at most fourteen whole digits and six
fraction digits, normalized without binary floating-point arithmetic. Tax rates
remain integer basis points from zero through 10,000; CSV percentages convert
exactly with at most two decimals.

Creation keeps the configured default tax and existing optional metadata
defaults (`category: ''`, `barcode: null`, `reorderLevel: '0'`). CSV upsert
retains omitted existing values, immutable base unit/currency checks and the
entire-file error gate. Raw controls in mapped CSV fields are errors even when
trimming could otherwise hide them. Existing CSV error codes, collision checks,
opening-stock evidence and validation/apply review remain authoritative.
`productImport.validateCatalogMetadata` re-exports the shared implementation
for earlier internal callers.

Product update requires the complete editable snapshot: name, selling/reference
cost minor amounts, tax rate, category label, nullable barcode and reorder
quantity, together with product ID, reason and current product version. SKU,
base unit, currency, omitted fields and unsupported authority fields cannot
silently alter update intent. Category create/update/archive/restore/merge use
their declared identifiers, exact labels, reasons and versions. Merge requires
both source and destination category versions in the domain transaction.

The six maintenance commands have strict input/result schemas in
`commandCatalogue.ts`, baseline permissions/capabilities and declared effects.
The existing dispatch/catalogue drift check includes them. The small schema
validator now supports standard JSON Schema nullable type arrays for barcode;
it performs no coercion, field removal or default insertion. Normalization in
the domain leaves the original envelope bytes used for idempotency unchanged.

## HTTP client and recovery boundary

`apiClient.listCatalog(signal, { includeArchived: true })` and
`listCatalogCategories` expose the archived-read option explicitly; the API
enforces its permission boundary. Product DTOs add active state/category ID,
and category DTOs expose active state, version, merge destination and product
counts. Optional product fields retain compatibility with earlier intercepted
UI fixtures; the current server returns the maintenance metadata.

Typed mutation helpers send complete versioned envelopes through the existing
durable command journal. Product expected-version keys are `product:<id>`;
category keys are `category:<id>`, including both merge targets. Callers retain
the original envelope and command ID for retry/status recovery.

A catalogue `CONFIRMED` acknowledgement must contain the declared identifier,
positive safe version and boolean active state, or both merge identifiers/
versions plus a non-negative safe updated-product count. When the retained
payload is available, target IDs and requested archive/restore state must match
it. Missing or mismatched confirmations remain unknown and cannot remove the
original recovery record. Business error codes retain structured details while
operator-facing copy explains identity conflicts, open counts, stock/exception
archive blocks and category state/conflicts.

## Domain and migration boundary

Migration `023_catalog_maintenance` introduces an outlet-scoped category master
and a paired product/category foreign key. It backfills each exact non-empty
legacy label without combining case variants. A normalized, case-insensitive
SKU index reserves identities across both active and archived products. Before
changing schema, the migration rejects ambiguous legacy SKU groups with their
product IDs, or category labels containing outer whitespace or controls. These
are reviewed data-repair gates; no production collision has been observed or
automatically repaired. The migration runner remains transactional and checks
the recorded migration checksum on rerun. Earlier applied migrations are intact.
The new migration has an explicit LF checkout rule in `.gitattributes`, so
Windows automatic line-ending conversion cannot change its checksummed bytes
after checkout. Existing applied SQL files and their checkout policy are intact.

Product create, update and CSV apply resolve category identity in the same
command transaction. New exact labels create a category with audit/outbox
evidence under the parent command ID. An archived category cannot acquire new
references. An archived product may retain its existing archived category while
editing unrelated metadata, but restoration requires an active category.
Category rename changes current product labels and increments affected product
versions. Merge moves all current source references to the reviewed target,
increments both category versions and affected product versions, and retains
the inactive source with its target ID. A merged category cannot be restored.
Archiving a category requires no active product references.

Product metadata updates never change stock quantity or carrying value. Archive
requires zero recorded quantity, zero carrying value and no unresolved sale
shortfall. Receiving and settlement retain their active-product checks; a refund
that requests stock restoration now also rejects an archived product before any
financial effect. Historical cash refunds that do not restore stock keep their
original evidence path. Paid receipt, tax and COGS snapshots are never rewritten.
Existing quote product-version checks detect edits, category rename and merge.

Catalog create/archive/restore, import apply and all count commands serialize on
the same transaction-scoped outlet advisory lock after authority revalidation.
They retain the existing shared outlet authority lock, avoiding a shared-to-
exclusive row-lock upgrade. An open count blocks membership and reference-cost
changes. Ordinary names, selling prices, tax, barcode and category metadata can
change while the count preserves its immutable baseline snapshots; category
rename/merge changes neither stock quantity nor value. Posting still verifies
the count's existing stock versions. Database serialization retry remains the
existing command processor's responsibility, preserving the original command ID.

The normal catalog read returns active products. `includeArchived=true` is an
explicit `catalog.manage` boundary, and category management reads use the same
permission and inventory capability. SKU/barcode collisions, stale versions,
open counts, remaining stock, unresolved exceptions and category state each
produce a controlled business rejection. All mutation outcomes use the shared
command journal, audit and transactional outbox.

### Release and rollback compatibility

The product/category foreign key requires the matching maintenance API after
migration 023. An older API that writes a non-empty category label without its
category ID would fail that constraint, including old CSV apply code. Reverting
only the frontend can retain the matching API and forward schema. Reverting the
API requires a tested schema-compatible build or a separately verified database
restore/cutover plan; dropping category constraints or deleting master/evidence
rows is not an approved rollback. This compatibility boundary, migration
preflight and exact-artifact restore/rollback proof remain release gates before
any deployment. Current tests establish fresh/upgrade/rerun behavior, not safe
rollback to the preceding API version.

Database and browser acceptance remain pending until the observed runs below
are recorded. This migration has not been applied to production.

The first four-file database regression completed 21 passed and 3 failed out of
24 reported tests: two import evidence assertions and their containing parent
test failed. Both assertions expected one total audit/outbox event, before the
new category master had its own creation evidence. They now assert exactly one
`catalog.import.apply` and one `catalog.category.created` in each evidence table.
The original replay and full business-state comparisons remain. Accounting,
mixed count and import/receipt snapshot checks passed in that run; the corrected
import assertions require a rerun before acceptance.

## Focused local verification

```text
node --import tsx --test apps/api/test/catalog-validation.test.ts apps/api/test/product-import-validation.test.ts apps/api/test/api-messages.test.ts
16 passed; 0 failed; 0 skipped.

node --import tsx --test apps/api/test/command-catalogue.test.ts
7 passed; 0 failed; 0 skipped.

npm run typecheck
Passed for UI and API.
```

These checks cover direct/CSV normalization parity, leading zeros and defaults,
scientific identifiers, controls hidden by trimming, complete updates and
immutable fields, decimal and safe-money boundaries, case-sensitive labels,
nullable barcode, strict command shapes, baseline authority, dispatch drift and
incomplete/mismatched acknowledgement retention. They do not establish
database posting, migration/upgrade, browser, hosted CI or production acceptance;
those results must be recorded separately on the candidate used for them.

## 25 October 2026 real PostgreSQL acceptance

The maintenance integration suite passed **10 tests, 0 failed, 0 skipped** in an
isolated disposable database:

```text
node --import ./apps/api/test/support/isolate-database.mjs --import tsx --test --test-concurrency=1 apps/api/test/catalog-maintenance.integration.test.ts
```

The suite executes all new catalog commands through the authenticated API and
checks actual results against their catalogue output schemas. It covers direct
edit/version/audit, exact original-ID replay and changed-body rejection, competing
edits, concurrent mixed-case creation, barcode identity conflicts, tenant/outlet
and all six new-command permission boundaries, hidden cost data and restricted
archived reads. Archive requires zero quantity, zero carrying value and no open
stock exception. Open counts reject create/archive/restore/import apply and
reference-cost changes, while ordinary metadata plus category rename/merge leave
the saved count baseline unchanged. A count-open/archive race must either retain
the active item in the count or archive it before the count snapshots membership.

Paid receipt/tax/COGS and journal snapshots remain byte-for-byte equal after
metadata changes. Stale quotes cannot settle, and mixed receiving or refund
restocking of an archived product reject without partial inventory, cash,
refund or journal effects. Category tests retain case distinctions, validate
both merge versions and rename conflicts, update active and archived product
references, enforce outlet scope and active-product archive gates, and allow an
archived product to retain its existing archived category while correcting its
description. CSV/direct rejection and decimal normalization agree; a stale CSV
review cannot replace a newer direct edit.

CSV preview validates the source and current product rows, without claiming that
every referenced category master is active. A file naming an archived category
can therefore be `READY`, then receive `CATEGORY_ARCHIVED` at apply. A dedicated
test proves the current category authority rejects atomically: products,
categories, balances, movements, journals, audit and outbox remain unchanged
after the rejected apply. The operator message directs selection of an active
category or restoration of its existing identity.

The populated 022-to-023 upgrade, rerun and preflight suites passed **5 tests,
0 failed, 0 skipped**, including the existing 014-to-current upgrade regression:

```text
node --import tsx --test --test-concurrency=1 apps/api/test/catalog-maintenance-upgrade.integration.test.ts apps/api/test/product-import-upgrade.integration.test.ts
```

These files create and drop their own generated local databases, so they run
without the additional global isolation preload. They compare original product
identity/metadata, stock balances/movements, paid order/line/payment snapshots,
closed shift and balanced journal evidence before/after migration and rerun.
Exact category labels `Milk` and `milk` remain distinct; uncategorized and
archived products retain correct references. An archived legacy SKU still
reserves its normalized identity. Case-folded SKU collisions and category labels
requiring normalization fail preflight before category DDL, with all original
financial and identity evidence preserved; no row is silently merged or trimmed.

The initial full API run reported **178 passed, 2 failed out of 180**, with no
skips. Both reported failures were the new populated-upgrade assertion and its
parent: database collation returned the two preserved case-distinct labels in
the opposite order from the fixture expectation. The corrected assertion checks
both exact labels using deterministic JavaScript sorting. Snapshot queries on a
single PostgreSQL client now execute sequentially, avoiding deprecated concurrent
query calls. The focused upgrade rerun above passes after these test corrections.
An overlapping two-file run also timed out in the global isolation preload
before either upgrade test body began; it is not accepted evidence. Serial,
self-isolating upgrade execution removes that redundant bootstrap and passed.

API TypeScript and scoped whitespace checks passed after the new tests. A fresh
combined API regression, browser evidence, exact-commit hosted CI and operational
release gates remain separate from these focused results. No migration was
applied outside disposable local databases and no deployment occurred.

## Reachable maintenance UI and recovery

Stock now exposes **Manage items and categories** to operators with
`catalog.manage`. Existing Add item uses the same form and returns to Stock
after confirmed creation. Creation includes optional exact category, barcode
and reorder quantity, while an omitted tax rate retains the configured default.
Existing movement history, CSV import and count navigation remain available.
The maintenance workspace is loaded on entry through a separate lazy chunk.

Product editing sends the complete editable snapshot and displayed product
version. SKU, base unit and currency remain read-only. Archive/restore requires
a reason; visible stock quantity/value blocks archive before submission, and
the server remains authoritative for exceptions, counts and category state.
An archived product can be edited to select an active category before restore.
The Include archived switch requests the permission-restricted API read.
Missing authoritative versions disable mutation with an explanation.

Category controls create, rename, archive, restore and explicitly merge an
exact source label into a selected destination. Merge sends both versions and
requires a reason. Active product references visibly block category archive;
merged categories cannot be restored. Local search is labelled as a search of
loaded items/categories, rather than claiming server-wide results.

Forms use the shared responsive dialog with a persistent action footer at
1024×600 and 390×844. Unknown outcomes and restarts restore the original form
values and command ID from the recovery journal. A committed-but-lost response
uses status lookup; a command that never arrived retries its original envelope.
Version conflicts retain the entered values until the operator explicitly
discards them and reloads current server data. No command response fabricates
updated catalog rows: successful operations reread authoritative lists.

## Focused UI verification, 25 October 2026

```text
npm run typecheck
Passed for UI and API.

npm run build
Passed. Main JavaScript: 502.43 kB (136.65 kB gzip).
Lazy maintenance JavaScript: 20.33 kB (6.43 kB gzip).
PWA: 19 precache entries, 825.62 KiB.

npx playwright test e2e/catalog-maintenance.spec.ts e2e/stock-count.spec.ts e2e/count-import-history.spec.ts e2e/history-pagination.spec.ts e2e/workspace-recovery-readiness.spec.ts --reporter=list
31 passed; 0 failed; 1.8 minutes.
```

The nine new intercepted catalog cases cover complete metadata and version
submission at both target viewports; zero-stock archive/restore and archived
reads; exact-case category create/rename/archive/restore/merge; lost-response
restart lookup; original-ID retry after a command never arrived; conflict
retention and explicit reload; complete Add item creation; and restricted
navigation for an operator without catalog management. The other 22 cases
retain count, import, history continuation and existing recovery behavior.

The first eight-case attempt reported five passed and three failed. One failed
at initial page navigation before application load during an observed host
timing interruption; no application defect was established. A mobile fixture
used a label locator that did not resolve the rendered category combobox, so
the test now selects its accessible combobox role. The conflict test inspected
its request list before asynchronous journal persistence completed; it now
waits for the second request before asserting its envelope. These two changes
correct acceptance fixtures rather than product behavior. The final run above
includes the added creation case and all nine catalog cases pass.

The build still reports Vite's native configuration-loader notice and its
existing main-chunk size warning. Intercepted browser evidence does not prove
PostgreSQL posting; the real browser workflow and combined regressions are
recorded separately when complete. Hosted CI and deployment remain unverified.

## Real browser maintenance acceptance, 25 October 2026

```text
npx playwright test --config playwright.integration.config.ts e2e/integration/catalog-maintenance.spec.ts --output=test-results-catalog-maintenance-integration --reporter=list
1 passed; 0 failed; 19.4 seconds (workflow 7.9 seconds).
```

The test creates a disposable tenant, administrator and outlet in the named
local test database. Authenticated API commands create two items with exact
`Food`/`food` categories, receive stock, open a shift and post a cash sale. The
browser then opens Stock → Manage items and categories, edits the complete
metadata snapshot, renames `Food` to `Meals`, merges `food` into that destination,
and archives/restores the zero-stock item. Captured requests verify current
product versions and both merge category versions. PostgreSQL assertions check
the final exact metadata, active states, product versions and retained merge
identity. Before/after balances, movements, order/line/payment rows, journal
entries/lines and receipt JSON compare equal. This workflow used the frozen
build from the 31-case focused run, with no intercepted business responses.

Review then found that the UI required three reason characters although the
canonical contract accepts one non-whitespace character through 500 characters.
The form now requires a nonempty trimmed reason, matching the server boundary.
The existing archive/restore browser case checks that whitespace submits no
command and a one-character reason reaches the original versioned command.
This small follow-up awaits a fresh build and focused rerun after the separately
running combined regressions release the frozen artifact.
