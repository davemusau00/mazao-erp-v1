# Count conflict recovery design

Date: 27 October 2026, Africa/Nairobi. Plan ticket: S01-03.

**IN PROGRESS. Local S01-03 acceptance is complete and the implementation is
integrated in the primary `feat/codebase-truth-s01` worktree as uncommitted
changes based on checkpoint `f36509061cf0f8a69319b11dea6a5ae920dd4a06` plus the
preserved S01-02 follow-ups.** Count development originated in isolated worktree
`mazao-erp-count-recovery` on `feat/codebase-truth-count-recovery`; its base-file
manifest is `dist-artifacts/s01-03-base-files-2026-10-27.json`. Only the verified
count delta and required migration-fixture corrections were integrated. The
primary checkout's newer S01-02 source, browser tests and evidence remain
preserved. Exact-head hosted CI and release gates remain open. The full
requirement remains [CODEBASE-TRUTH.md](../CODEBASE-TRUTH.md), and the shared
execution register is [docs/48](48-CODEBASE-TRUTH-EXECUTION.md).
The full requirement remains [CODEBASE-TRUTH.md](../CODEBASE-TRUTH.md).

## Chosen count policy

Use explicit movement-aware review followed by physical recount of affected
items. Keep the existing count ID and its original opening evidence. A manager
reviews the old baseline, saved physical count, subsequent movements and current
stock. The review command establishes a new baseline revision for affected
items and clears their physical counts and variance reasons. An operator then
counts those items again. Unaffected saved lines remain available.

Never calculate a new physical count from the old count plus or minus intervening
movements. Never copy an earlier counted quantity into a replacement baseline
as a confirmed recount. Reviewing a baseline does not alter balances, delete
movements, post a count adjustment or create a journal.

Sales, receiving and refunds continue while a count is open. Their existing
short transaction admission locks serialize a snapshot/review/post with stock
writes; there is no count-long trading block. A further movement after review
requires another review and recount before posting that affected line.

Keep the existing catalog controls: ordinary stocked creation/import,
stocked archive/restore, reference-cost changes and item-kind changes remain
blocked by an open count where currently required. Service creation remains
independent of physical membership. S01-03 does not silently relax those
S01-01/S01-02 safeguards.

## Current source anchors and gaps

| Source | Current behavior | Planned change |
| --- | --- | --- |
| `apps/api/src/commands.ts#openStockCount` (line 409) | Snapshots active stocked goods, balance versions, quantity, carrying value and reference cost | Capture baseline revision, reviewed product state and a reliable movement boundary; append opening evidence |
| `commands.ts#saveStockCount` (line 447) | Saves every line under the count version; overwrites prior quantity, reason, counting actor and time; audit contains the header result | Append changed-line before/after evidence and bind counted quantity to its baseline revision |
| `commands.ts#postStockCount` (line 499) | Rejects stale balances/catalog membership; posts exact weighted-average movements and gross gain/shrinkage journal | Return actionable review details; require current reviewed baselines and physical counts for those revisions before existing posting |
| `commands.ts#cancelStockCount` (line 599) | Cancels under expected count version and preserves current rows | Append cancellation evidence while preserving every revision |
| `apps/api/src/app.ts#readInventoryCount` (line 261) | Reads header and lines through separate pool queries | Move count detail/review reads into one scoped repeatable-read snapshot |
| `apps/api/src/catalogMaintenance.ts#lockCatalogOutlet` (line 35) | Shared outlet authority row lock plus shared/exclusive catalog advisory admission | Reuse this admission key and existing write ordering |
| `src/components/inventory/BackendStockCountWorkspace.tsx` | A posting conflict reloads the same stale baseline; no changed-item review/recount action exists | Open review, preserve prior evidence, focus affected recounts and retain unknown-command recovery |
| `src/services/apiClient.ts`, `src/services/apiMessages.ts`, `apps/api/src/commandCatalogue.ts` | Existing count contracts remain domain-validated; generic confirmation handling is insufficient proof for a new reviewed transition | Add strict new input/output and terminal acknowledgement checks |

These line numbers locate the reviewed checkpoint and may move during
implementation. The function names are the stable anchors.

## Planned additive persistence

Use the next unapplied migration, provisionally
`026_count_recovery.sql`; confirm the available version before implementation.
Never edit applied migrations 001-025.

The count header retains original `baseline_at`, `opened_at`, opening actor and
count ID. Add the current baseline-review revision and last review metadata
without replacing those original fields. Each line records its own baseline
revision, relevant product state, reviewed product version, movement boundary
and the revision under which its current physical quantity was saved. Lines
unaffected by a review retain their earlier valid revision and saved count.

Add scoped append-only count events and line-event snapshots. Events identify
the command, count version, event kind, actor/name snapshot, reason and time.
Line evidence preserves before/after baseline quantity/value/cost/versions,
physical quantity, variance reason, counting actor/time and review disposition.
Use scoped foreign keys and uniqueness tied to the command/count version.
Database guards reject update or deletion of this evidence.

Opening, saving, reviewing, posting and cancellation write their evidence in
the same transaction as the durable count projection. Saving a different
quantity or reason must preserve the earlier saved entry. Review preserves
the complete previous line state before clearing its physical fields. Posting
retains the final reviewed physical evidence even for a zero-variance line.
Exact replay produces no duplicate revision, event, movement or journal.

Existing rows receive a labeled legacy checkpoint containing only facts
present at upgrade. Do not claim earlier overwritten saves can be recovered.
Do not infer an original product version or movement boundary from current
metadata. Legacy coverage remains explicit until a new reviewed checkpoint
is established.

## Reliable movement boundary

`inventory.movements.created_at` currently defaults to PostgreSQL `now()`,
which is the transaction start time. The count's `baseline_at` also uses
`now()`. A sale can start before count opening, wait for catalog admission,
then write and commit after the count snapshot with a movement timestamp
earlier than that snapshot. A timestamp-only predicate such as
`created_at > baseline_at` would omit real intervening evidence.

Add a movement ordinal, provisionally
`movement_seq bigint GENERATED ALWAYS AS IDENTITY`, plus an index scoped by
tenant, outlet, product and ordinal. Preserve every existing movement ID,
timestamp, quantity, cost, carrying value, command/reference and journal link.
Ordinals added to legacy rows are metadata, not a reconstructed historical
commit order. Gaps from aborted transactions are valid.

Capture the per-product movement high-water under the exclusive count admission
lock when opening or reviewing a baseline. Current writers insert movements
after acquiring admission/product/balance locks; their new ordinals therefore
follow the captured boundary even when their transactions started earlier.
Verify this ordering against every supported movement writer, including
opening import, sale, refund, receiving, count adjustment and stock-exception
resolution. A writer that does not obey it cannot be treated as covered merely
because an ordinal exists.

Return and compare movement ordinals as decimal strings, using bigint-safe
operations. Never convert them to JavaScript `Number`. A review movement page
is bounded by the line's captured lower and upper ordinals, with scoped stable
continuation, matching totals and an explicit coverage label. It must reach
every relevant movement; a preview limit cannot become a terminal cap.

An open legacy count has no defensible original ordinal boundary. Its review
shows honestly labeled full historical evidence and establishes a fresh
checkpoint with physical recount. It must not invent a boundary by ordering
legacy timestamps or UUIDs.

## Planned API and command contracts

`GET /api/v1/inventory/counts/:countId/review` will validate UUID/query shapes,
recheck inventory and count-read permissions, and read count/header/lines,
current products, balances and movement boundaries in one repeatable-read
snapshot. Tenant/outlet constraints apply to every relation. Cost/value fields
retain the existing catalog-management/finance permission boundary.

The response identifies the count version, changed lines and reasons, previous
baseline and saved physical evidence, current reviewed facts, movement coverage
and continuation, and a fingerprint of the complete reviewed changed set.
Fingerprints bind facts for concurrency comparison; they grant no authority.
Later movement pages remain bound to that review's upper ordinal. A mutation
after the preview requires a new preview rather than extending it silently.

`inventory.count.review` will be online only and require
`inventory.count.approve` plus inventory. Its strict payload contains the count
ID, nonempty review reason, reviewed changed set/fingerprint and explicit
affected product identities. Expected versions include `count:<id>` and the
fresh `product:<id>`/`balance:<id>` entries for the reviewed affected lines.
No client-supplied quantity/value becomes authoritative baseline state.

Inside the existing serializable command transaction, recompute the full
changed set and its current facts. Reject a stale version, omitted/extra item,
changed membership or mismatched fingerprint before writing any projection or
evidence. Append the previous line state, advance affected baselines to the
locked current facts and ordinal, clear their counted quantity/reason/actor/time,
and mark the new revisions as requiring physical recount. The count stays OPEN
and its version advances atomically.

The result must identify the count, new count version, review event/revision
and affected-line count. Add a strict output contract and client terminal
validation matching the original target. Incomplete or contradictory replies
retain the original journal entry, ID, payload and expected versions.
Current actor/outlet/permission/capability checks apply to status and replay.

Count-relevant changes are balance version/quantity/value, reference-cost
basis and physical membership/kind. Price, name and category edits preserve
existing count snapshots; a product version change alone must not silently
rewrite a physical baseline. Fresh product versions still protect an explicit
review from concurrent metadata changes. Unexpected legacy-writer additions
must be shown and explicitly admitted as new uncounted lines under reviewed
versions; never silently exclude an active stocked good. Missing or ineligible
identities require a controlled explanation and preserved cancel/restart path,
never deletion of their prior count evidence.

The existing full-draft save limit is 5,000 lines while opening is currently
uncapped. Implementation must make capacity explicit and consistent before
claiming counts are recoverable at that boundary; no response or command may
silently truncate membership to fit a limit.

## Transaction and lock ordering

Retain command-ID deduplication, fresh operator authority, persisted command
requirements and the existing serializable retry wrapper. Reuse the existing
catalog advisory key in exclusive mode for count open/save/review/post/cancel.
Sales/refunds/receiving/resolution retain shared admission for their short
transactions.

Within admission, acquire the count header, product rows ordered by ID, then
balances ordered by product ID. Posting must take product locks before balance
locks as well, including when movement triggers inspect the product. Avoid
shared-to-exclusive lock upgrades. Capture facts and append evidence before
releasing the transaction; there is no user interaction while locks are held.

Save binds each entered physical quantity to the current line revision. Post
requires every included line to have a valid physical quantity/reason for its
own revision and rechecks the current reviewed balance and product basis. If
anything relevant moved again, return an actionable conflict without changing
stock, count evidence or financial records. Existing weighted-average and
gross gain/shrinkage posting remain authoritative under ADR 0006.

## Planned operator flow and recovery

A conflict offers **Review changed items**. The review shows the earlier saved
quantity/reason, old and current stock, movement details and any cost-basis
change. The confirmation explains that affected saved physical counts will
remain in history and those items must be counted again. Confirmation creates
the reviewed baseline; it never posts stock.

After a confirmed review, retain unaffected quantities, clear affected inputs,
show which items require recount and focus the first affected input. Save and
posting remain separate actions. History exposes prior revisions and saved
quantities/reasons so an apparent variance cannot disappear without evidence.
Review/post controls must remain reachable by keyboard and at 1024×600 and
390×844.

An unknown review outcome freezes dependent edits and another review/post.
Reload restores the original command through the existing command journal;
status/retry uses its original ID, intent and versions. Only a validated
terminal outcome unlocks dependent work. A changed actor, outlet or revoked
authority cannot substitute a replacement review request.

Crash-safe persistence of unsubmitted edits remains S01-04. Guided missing-line
review remains S01-05, estimated gain valuation remains S01-06, and spot/blind
counts and unknown barcodes remain S01-07. This design must not claim those
later tickets are implemented.

## Required acceptance evidence

All items below are pending implementation and execution:

- Fresh migration, populated upgrade and checksum-safe rerun. Preserve existing
  count rows, movement IDs/amounts/timestamps, receipts and journals; label legacy
  evidence limits and reject mutation/deletion of new history.
- A sale during counting causes review; affected physical quantities are cleared,
  unaffected saved lines/reasons remain, recount posts without overwriting the
  sale, and all prior evidence remains readable.
- A differently costed receipt and a restocked refund change the reviewed
  baseline and exact carrying value correctly. A nonrestocked refund does not
  invent physical movement or invalidate an unchanged physical basis.
- A transaction begun before count opening but admitted afterward appears in
  review by movement ordinal despite its earlier `created_at`.
- Existing stocked creation/import, reference-cost, lifecycle and kind-change
  gates remain controlled during the count; service creation remains excluded.
  Any supported legacy new-membership review requires explicit fresh versions.
- Another movement between preview and review, or between review/recount and
  post, returns conflict with no partial evidence/projection/stock/journal write.
- Competing reviews, saves and posts preserve one canonical transition; exact
  concurrent/later replay produces one revision/event and one eventual posting.
- Invalid IDs/shapes, unknown fields, stale count/product/balance versions,
  omitted/extra affected lines, wrong fingerprints, permissions/capabilities and
  cross-tenant/outlet/actor recovery fail under the documented boundary.
- Lost response before arrival and after review commit, restart, status recovery,
  quota failure and malformed acknowledgements retain the original command and
  never copy an earlier physical count into a new revision automatically.
- Full movement continuation reaches beyond the first page with stable scope,
  totals and boundary. Cost fields remain redacted for unauthorized count readers.
- Known-value decimal fixtures reconcile balances, immutable movements and gross
  gain/shrinkage journals through review, recount, posting and a later sale.
- Real API/PostgreSQL browser review → recount → save → post, including a lost
  review response, succeeds at 1024×600 and 390×844. Existing mixed-count and
  command-recovery suites remain green.
- Typecheck, production build, relevant full regressions, exact-head CI and
  release gates are recorded separately. Local checks do not imply production,
  physical device, backup/restore or performance acceptance.

## Migration compatibility and delivery boundary

Adding ordinal/history metadata can lock or rewrite/index populated tables;
measure the migration on representative disposable data and document its
operational cost before release. No production migration is authorized by this
design. Preserve checksum rules and existing additive database history.

An older API does not know the new review/recount evidence and must not be
assumed compatible merely because it can still read old columns. A rollback
requires a compatible API build or the separately approved, verified recovery
procedure. Never drop evidence/constraints, delete a count, renumber historical
movements or restore an earlier physical count to make an old writer pass.

The initial planning update changed only this document. Subsequent isolated
implementation checkpoints follow; none establishes deployment or full-slice
acceptance without the required evidence above.

## Isolated UI and contract checkpoint, 27 October 2026

The strict `inventory.count.review` payload is
`{countId,reason,reviewFingerprint,affectedProductIds}`. The original envelope
contains the count and every affected current product/balance version. Its
result is `{countId,version,reviewId,revision,affectedProductIds}`. The shared
contract validator now supports bounded typed arrays and uniqueness without
coercing values or changing their hashed order. The command remains online
only, requires count approval plus inventory and is included in the existing
schema/policy/dispatch drift checks.

Client terminal validation requires the original command and count IDs, a valid
review ID/revision, the count version exactly one above the original expected
version and the exact nonempty affected identity set. Missing/extra/duplicate
identities, incomplete results and contradictory status envelopes retain the
original command journal. The client carries original expected versions into
both submission and status validation.

The count workspace now has a changed-item review dialog and opens it after a
posting conflict. It shows previous baseline/count/reason, current stock, cost
fields only for authorized readers, movement continuation and honest full-history
legacy coverage. A manager supplies a reason and explicitly acknowledges that
only affected physical counts will be cleared for a new recount. Confirmed
review reloads the authoritative count and focuses the first affected input;
unaffected server-saved lines remain available. Legacy and outstanding-recount
states cannot use the normal posting action prematurely.

Read-only review preserves unsent entries. Accepting a new baseline requires
the operator to save those entries first through **Save edits and refresh
review**, so prior quantities/reasons become server evidence and survive an
unknown review/reload. A stale save preserves local fields and offers an explicit
replacement from the current saved draft. It does not silently reload over
unsent edits. This is not S01-04 crash-safe storage for unsubmitted drafts.

Count history includes paged saved/reviewed events and selected before/after
line evidence. Failed movement/history/detail reads keep their earlier rows and
continuation for explicit retry. The new review and evidence components load
only when opened. Pending review recovery displays the original item set and
reason, freezes replacement actions and checks/retries the same ID and versions.
The shared dialog focus correction from S01-02 was copied into the isolated
base by the coordinating agent; it is not a separate S01-03 fix.

Observed isolated checks before browser/database acceptance:

```text
npm run typecheck
Passed UI and API projects.

node --import tsx --test apps/api/test/contract-arrays.test.ts apps/api/test/command-catalogue.test.ts apps/api/test/api-messages.test.ts apps/api/test/count-recovery-validation.test.ts
23 passed; 0 failed; 0 skipped.
```

The first frontend typecheck found three narrowing errors in the new read
validator. Explicit type predicates and a captured validated movement page
corrected them. The first combined NodeNext check also required a `.js` type
import suffix in that helper; the full check above includes that correction.
The earlier targeted run passed seven focused new safety checks. These pure
results include decimal-string movement boundaries above JavaScript's safe
integer range, exact review acknowledgement identity/version/set proof and
malformed read/array rejection; they do not prove database or browser behavior.

The intercept browser suite completed **12/12** at 1024×600 and 390×844,
covering lost/malformed/before-arrival review outcomes, stale-save preservation,
legacy counter access, read retry, stale preview, empty review, movement/event
continuations and detail retry. A delayed review response no longer steals
keyboard focus from a counter typing in another field: the queued animation
frame is cancelled on cleanup and focus is skipped when another input is active.
The added race regression covers this case.

The real API/PostgreSQL browser workflow completed **2/2** at 1024×600 and
390×844. It covers a sale during an open count, movement-aware review, recount,
preserved earlier evidence, exact valuation/journal effects, and recovery of a
committed review after its response is lost. The fresh generated database was
`mazao_count_e2e_56c9a7eab1a0458490a0bdda69d9a1ab`; migration 026 was applied
there with checksum `13a318cfc63f5fbcc4e340fc02168ac28e406f7810f60e12283db6588572f407`.
Logs are `dist-artifacts/count-e2e-browser-mazao_count_e2e_56c9a7eab1a0458490a0bdda69d9a1ab.log`
and `dist-artifacts/count-e2e-migrations-mazao_count_e2e_56c9a7eab1a0458490a0bdda69d9a1ab.log`.

The pre-existing PostgreSQL stock-count integration assertion was corrected to
expect `COUNT_REVIEW_REQUIRED` and its changed product IDs when a receipt makes
the saved count balance stale. The focused rerun passed. This preserves the
review-required semantics of the implementation and still checks unchanged
balances, movements and valuation when posting is blocked.

The first complete sequential API run reported **232 passed, 7 failed, 0
skipped (239 tests)**. All failures were migration-fixture drift found after
adding migration 026: three legacy snapshots included the newly added
`inventory.movements.movement_seq` when asserting their original fields stayed
unchanged; two upgrade fixtures hard-coded the old total of 25 migrations; and
the public route contract omitted the new UUID `eventId`. The upgrade fixtures
now compare original movement fields while the 025→026 suite independently
checks ordinal evidence, derive the current migration count from migration files,
and include `eventId` in strict path validation and the negative route regression.

The four affected test files passed **16/16** on fresh standard isolated
databases. The corrected full sequential API rerun passed **239/239 tests, 0
failed, 0 skipped** in 426.50 seconds using the unchanged isolation preload and
generated per-file databases. The first full run is retained at
`dist-artifacts/count-api-full-2026-10-29.log`; focused rerun at
`dist-artifacts/count-api-compat-regressions-2026-10-29.log`; final full pass at
`dist-artifacts/count-api-full-green-2026-10-29.log`. The original `mazao_test`
fixture still reports `025_command_capability_evidence`; no migration-026 run
touched it.

Local S01-03 acceptance now includes the 12/12 intercepted browser cases, 2/2
real API/PostgreSQL viewport workflows, populated upgrade and count-domain
tests, and the 239/239 API regression. Exact-head hosted CI, production,
backup/restore, physical-device and performance acceptance remain separate; no
deployment or production write is claimed.

## 29 October primary-worktree integration verification

The verified count delta was integrated into the primary worktree. The first
primary typecheck caught that the backend `countRecovery.ts` module had not been
copied with its importers; adding the verified source fixed that integration
gap, and the primary `npm run typecheck` then passed both UI and API projects.
The primary `npm run build` passed: `index-Cvreg54l.js` 512.68 kB / 139.65 kB
gzip, 22 PWA precache entries / 868.74 KiB. The existing chunk-size warning is
not a performance acceptance result.

The primary artifact passed the intercepted count review suite **12/12** in
`dist-artifacts/count-browser-primary-2026-10-29.log`. An initial disposable
browser database setup stopped because the 026 SQL file was missing from the
primary copy; the verified file was added and matched the migration checksum
above. A fresh database
`mazao_count_e2e_59d315215b6e4a79be180205d8b193ba` applied migrations 001–026;
the primary real API/PostgreSQL count review then passed **2/2** at 1024×600 and
390×844 in `dist-artifacts/count-primary-real-browser-2026-10-29.log`.
`mazao_test` remains at `025_command_capability_evidence`; no migration 026 was
applied to it.

The existing count UI cases passed **2/2** on the same primary artifact, and
the existing real API/PostgreSQL count readiness and mixed-variance workflows
passed **3/3** on the generated 026 database. Their logs are
`dist-artifacts/count-legacy-browser-primary-2026-10-29.log` and
`dist-artifacts/count-existing-real-browser-primary-2026-10-29.log`.

## S01-04 local unsent count recovery, 29 October 2026

`src/services/countDraftStore.ts` stores only the count ID/version and per-product
quantity/reason values. Its key includes tenant, actor, outlet and count; its
revision is checked in the IndexedDB write transaction so another tab cannot
silently replace newer edits. This store is separate from the command journal
and never grants offline posting authority. A current-version draft restores as
unsent edits. A changed count version or line set opens a review dialog; the
operator must explicitly restore the values, after which nothing is sent or
posted automatically. Quota/open failures leave the current values on screen,
show that persistence failed and allow a retry.

`e2e/count-local-draft.spec.ts` passed **8/8** in Chromium. It covers reload,
server-save transition, stale review, quota failure, blocked-store retry,
two-tab revision conflict, actor isolation, lost save acknowledgement and
cancellation recovery. `e2e/workspace-recovery-readiness.spec.ts` also updates
the earlier navigation case to expect local restoration rather than screen-only
discard. UI/API typecheck and the production PWA build passed. The built entry
is 523.88 kB / 142.95 kB gzip with 22 PWA entries / 879.71 KiB; Vite's existing
over-500-kB warning remains and no performance acceptance is inferred. These
are local browser/build checks; exact-head CI, installed-PWA storage behavior,
production and release gates remain separate.

S01-05 count readiness and validation guidance is implemented in the primary
worktree. The open-count screen now shows server-saved totals, missing quantity
and reason counts, invalid quantities, and item links that focus the matching
quantity or reason input. It states that an entered zero is a physical count
and a blank field is still uncounted. Hidden-by-search totals are calculated
from the complete loaded baseline lines. `e2e/count-readiness.spec.ts` passed
**4/4** at desktop and mobile sizes, including scanner focus, missing-entry
links, zero, server save/reload of reasons, saved-line totals, hidden search
counts, and reachable post confirmation. The artifact's PWA build reports
`index-BI4q23jy.js` at 527.79 kB / 143.66 kB gzip, 22 precache entries / 883.53
KiB. The existing >500-kB chunk warning remains; this is not a performance
acceptance result. S01-05 has local slice acceptance only.

## S01-06 zero-baseline valuation review, 29 October 2026

The count-post command now requires a valuation reason whenever positive stock
is added from a zero-quantity baseline. The count review shows the opening
reference unit cost and its rounded extended estimate, identifies the source,
and requires a cost-authorized approver to acknowledge and explain the value.
When that reference cost is zero, policy permits the quantity to post at zero
value only after that explicit approval and reason. The reason and valuation
origin/value are retained in count-event and audit evidence; stock-exception
provisional COGS remains a separate flow. Gross gains, gross shrinkage, existing
movement values and weighted-average sale costing are unchanged by this review
gate.

The API count-recovery suite passed **10/10**, including the known-value
2.5-unit estimate, rejection without a reason, exact movement and balance,
balanced gain journal, count-event/audit reason and a later 1.5-unit sale whose
185-minor-unit COGS leaves exactly 123 minor units in inventory. A separate
zero-reference-cost case passed with a zero-valued movement/balance and an
explicit manager reason. Existing mixed gain/shrinkage plus separate stock
exception provisional-COGS suites passed **8/8**. The new browser valuation
suite passed **2/2** for estimate/origin rendering, zero-cost explanation,
acknowledgement and reason gating, and the command payload. UI/API typecheck and
production PWA build pass. The artifact is `index-B0hTPVqF.js` (531.56 kB /
144.77 kB gzip; 22 precache entries / 887.35 KiB); the existing chunk-size
warning is not performance acceptance. These tests used generated
`mazao_api_<uuid>` databases on the local disposable PostgreSQL container; the
source `mazao_truth` database and production were not migrated. No schema change
was needed: the immutable count-event reason field and existing movement/audit
records carry the evidence. Hosted CI, release, restore and production gates
remain open.

## S01-07 selected and blind count implementation, 29 October 2026

Migration 027 adds an immutable `blind_count` flag and permits `FULL` and
`SELECTED` count modes. `inventory.count.open` validates selected IDs against
active stocked goods at the current outlet, snapshots only those lines, and
records the scope in command output and count events. A selected count accepts
new catalog products outside its saved line set; review, recount and posting
continue to operate only on the immutable selected lines. A full count still
guards catalog additions. The API rejects duplicate, unavailable, inactive,
non-stocked and out-of-outlet IDs.

Blind counts redact expected quantities and opening costs in current-count and
count-event line evidence for operators without `inventory.count.approve`.
Baseline review/movement endpoints also reject those operators. Cost fields
remain separately gated by catalog/finance cost permission. The UI offers scope
and blind mode before opening, labels the saved scope, keeps outside products
out of scan results and readiness totals, and exposes an unknown-barcode path
only to catalog managers. That path opens the existing catalog maintenance
workspace with an explicit review banner and prefills the scanned barcode; it
does not link or create an item automatically. Count history displays spot and
blind status even when a custom area label is present.

The source has migration and integration coverage in
`apps/api/test/count-recovery.integration.test.ts` for scope isolation,
baseline redaction, forbidden review, forged out-of-scope lines, invalid
selections, and receiving/creating stock outside a selected scope. The last
isolated PostgreSQL run before the final guard change used generated database
`mazao_api_28e5077844b1467e8155f929e0fa0b23`: all existing cases passed, while
the new selected-scope case exposed that catalog creation was still blocked.
That guard was changed to allow new stocked goods during a selected count while
retaining the full-count block. The acceptance rerun could not run on 29 October
because Docker Desktop was stopped and port 55435 refused connections. No
database-backed pass is claimed for the final guard change. The earlier attempt
against named `mazao_truth` accidentally inserted test setup fixtures before
failing; no cleanup or further access to that source database was performed.

After the final history-label wording change, `npm run typecheck`,
`npm run build` and `git diff --check` passed. The build produced artifact
`index-B7E2kJ3X.js` (537.75 kB / 146.02 kB gzip) and 22 precache entries
(894.20 KiB); the existing >500-kB chunk warning remains informational and is
not a performance result. Browser acceptance for the selected/blind flow and
catalog handoff remains pending, as do exact-head CI, release and production
gates.

### Location-count dependency

The roadmap's location-count requirement depends on first-class stock locations
and per-location balances, which are absent from this checkout and are planned
under S03-02. A count `areaLabel` is descriptive only and cannot grant location
authority. Location-scoped counts remain unimplemented until the location
balance model exists and provides an authoritative quantity to snapshot.
