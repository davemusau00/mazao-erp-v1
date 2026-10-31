# Restaurant configuration: P1.1

Development started **29 October 2026 (Africa/Nairobi)** under the hospitality-first
[master instruction](../MAZAO_ERP_P0-P4_MASTER_DEVELOPMENT_INSTRUCTION_2026-10-29.md).
The exact green starting head, GitHub jobs, migration review, source gap map and
PR dependency are preserved in [the P0 evidence](61-HOSPITALITY-P0-BASELINE-2026-10-29.md).

This first vertical slice connects restaurant configuration from React through
authenticated Fastify commands to PostgreSQL. It does not accept the restaurant
service loop. Orders, fire, KOT/BOT documents, a print queue, live KDS, serving,
settlement and room charges remain unavailable.

## Scope and operator journey

An owner enables **Restaurant setup** alongside Sales. An administrator or manager
opens **Tables & kitchen**, creates service areas, tables and kitchen/bar/pass
stations, selects existing menu items and assigns their preparation stations.
Administrators can assign those stations to existing logical outlet workspace
assignments. Reload reads the saved configuration. Waiter, cook and bartender
roles can review setup; these roles cannot order, prepare, change prices or take
payments in this slice.

The existing local prototype remains unreachable. The new workspace uses current
authenticated data, current versions and original-command recovery. Its capacity
and unavailable actions are visible. Menu selection searches the full authorized
catalogue and continues beyond the first page; it does not silently omit older
items.

## Authority, contracts and effects

All five commands use protocol/schema version 1 and are `ONLINE_ONLY`. The
canonical payload/result schemas are in `apps/api/src/restaurantContracts.ts`
and the generated-at-runtime command catalogue. Extra fields, client-supplied
outlet scope, malformed identities and coercion are rejected. Tenant, outlet,
actor and logical device come from the revalidated session.

| Command | Payload | Reviewed versions | Result |
| --- | --- | --- | --- |
| `restaurant.section.save` | Optional `sectionId`, `name`, `active` | `section:<id>` on edit | `sectionId`, `version`, `active` |
| `restaurant.table.save` | Optional `tableId`, `name`, nullable `sectionId`, integer `seats`, `active` | `table:<id>` on edit | `tableId`, `version`, `active` |
| `restaurant.station.save` | Optional `stationId`, `name`, `kind`, `charactersPerLine`, `active` | `station:<id>` on edit | `stationId`, `version`, `active` |
| `restaurant.menu.save` | `productId`, distinct `stationIds`, `preparationLabel`, `instructions`, `available` | Current `product:<id>`; `menu:<productId>` on edit | `productId`, `version` |
| `restaurant.station.assign` | `deviceId`, distinct `stationIds` (empty revokes) | Current `device:<id>`; `stationAssignment:<deviceId>` on edit | `deviceId`, `version` |

`restaurant.manage` authorizes configuration commands; station assignment also
requires `devices.manage`. `restaurant.view` authorizes setup reads. Both
`restaurant` and `commerce` capabilities are required. Fixed-role additions
grant admin/owner/manager management and cashier/waiter/cook/bartender review.
Food-service roles are assignable only while both capabilities are enabled.
No kitchen, cashier, expeditor or physical-terminal authority is implied by
these setup permissions. Existing tenant SETUP admission allows the exact five
configuration commands and two reads, without admitting future restaurant
commands or trading before go-live.

`GET /api/v1/restaurant/configuration` returns all saved section/table/station/menu
identities, explicit limits, role-appropriate logical assignments, current menu
item metadata and the initial product candidate page. It includes six explicit
false availability flags. Costs, credentials, sessions and payment data are not
part of this projection. Product candidates and assignment identities are omitted
from view-only users. `GET /api/v1/restaurant/products?q=&limit=&after=` requires
management authority and returns matching totals and scope-bound continuation.

Example command (IDs must identify records in the authenticated outlet):

```json
{
  "protocolVersion": 1,
  "commandId": "48786e56-f343-4672-8238-5598d1d7878d",
  "deviceId": "ed8c79ad-9eec-41fa-ab82-bc1fc0177c51",
  "type": "restaurant.section.save",
  "occurredAt": "2026-10-29T18:00:00Z",
  "expectedVersions": {},
  "payload": {"name": "Dining room", "active": true}
}
```

A successful response contains the same command ID, `CONFIRMED`, and
`value:{sectionId,version:1,active:true}`. A stale reviewed version yields
`CONFLICT` / `VERSION_CONFLICT`; a missing reviewed version yields
`REJECTED` / `VALIDATION_FAILED`. A name collision returns
`RESTAURANT_IDENTITY_CONFLICT`. Dependent active records block retirement with
`RESTAURANT_RESOURCE_IN_USE`; capacity returns `RESTAURANT_CAPACITY_EXCEEDED`.
Foreign or absent record identities return `NOT_FOUND`. HTTP access denials
remain denials of current access, never fabricated terminal business outcomes.

Each confirmed mutation records one audit event with before/after state and
actor/device attribution and one transactional outbox record, inside the same
transaction as its configuration rows and stored command response. Replay returns
the original response. A changed request under the original ID is rejected.
No command here creates a stock movement, inventory value, sale, tender, receipt,
guest charge or journal entry. The outbox record proves persistence only.

## Persistence and lifecycle

Additive migration **029_restaurant_configuration** creates sections, tables,
stations, menu routes and relational route/assignment links in schema
`restaurant`. Composite tenant/outlet foreign keys prevent attaching another
outlet's product, service area, station or logical device. Existing migrations
and posted business evidence are unchanged. No restaurant data or capabilities
are automatically seeded for existing businesses.

Names are unique ignoring case within their directory/outlet, including retired
identities. Names are limited to 100 characters; tables have 1–100 seats; station
kind is KITCHEN/BAR/EXPO; formatting preference is 32–64 characters per line.
Routes and logical assignments support up to eight distinct stations. These
formatting preferences do not configure or accept a physical printer.

Capacity includes retained inactive records: 100 areas, 500 tables, 100 stations
and 2,000 menu routes per outlet. Creation is rejected at capacity; restoration
and edits remain possible. All saved directory entries are returned; product
candidates use pagination instead of a capacity cutoff.

An area with active tables cannot retire. Active tables require an active area;
an inactive table may retain its original inactive area for later metadata
correction. Stations with available routes or live logical assignments cannot
retire until those dependencies are withdrawn. Existing unavailable menu routes
can retain retired item/station identities while being corrected or withdrawn;
making a route available requires current active references. `effectiveAvailable`
also observes current item and station state, so a later item archive does not
silently remain available in setup. Menu configuration does not freeze a sale
price or tax snapshot: that belongs to the next source-order contract.

Station assignment stores the reviewed logical device version. `effectiveActive`
is false after device reassignment/version change, device/member/user retirement,
station retirement or revocation. An existing assignment can be revoked using
current versions even after the logical device retires. Physical enrollment is
still absent. A future KDS feed must independently check this authority on every
read and transition; selecting an ID in the browser grants no station access.

## Concurrency and recovery

Two edits at one reviewed version must produce one confirmation and one conflict.
Initial testing found that ten simultaneous independent creates exhausted the
existing serializable retries and exposed HTTP 500. Moving transaction-scoped
locks before command-ledger insertion still reproduced that failure because
waiting queries had already established transaction snapshots.

Restaurant HTTP commands therefore opt into same-connection admission before
`BEGIN`: shared catalogue scope, then exclusive restaurant/outlet scope.
Transactions retain reentrant domain locks and the existing three-attempt
serialization/deadlock retry policy. Session admission locks release in reverse
order after commit/rollback; uncertain admission, rollback or unlock discards
the connection so pooled sessions cannot retain authority/locks. Other commands
retain their existing transaction path. No in-memory queue or external side
effect is used inside a retryable transaction.

The UI reads retained operation evidence before enabling writes. An unknown
response locks further setup changes and offers status recovery under the
original ID. Invalid or incomplete confirmations remain recoverable, including
wrong identity, missing/mismatched lifecycle status and wrong version advance.
Failed refreshes preserve visible data but disable mutation. Offline setup is
explicitly stale and read-only; reconnect requires a successful refresh. Unsent
form changes use discard confirmation and are separate from accepted records.

Menu and station-access editors retain the record existence and versions reviewed
when opened or explicitly selected. A reconnect refresh or product search cannot
silently replace those reviewed versions while retaining older form contents.
Independent review found that the initial implementation recomputed them from
the refreshed configuration, allowing a stale form to overwrite another
manager's change. A regression reproduced that overwrite on the earlier built
artifact. The follow-up freezes product/menu and device/assignment authority,
including reviewed absence for creation. Already-configured menu items direct
the operator to Edit. Stale versions conflict; a concurrently created record
without a reviewed version retains the domain's controlled validation rejection.
Neither path silently adopts another manager's current version.

## Verification checkpoint

Do not infer green CI for the changed worktree from the starting PR #24 run.
The following are local Windows/Node/PostgreSQL observations, with the existing
npm-installed dependencies; the separate production-container check uses pinned
Bun 1.4.3 and its frozen production dependency install.

| Check | Observed evidence |
| --- | --- |
| Initial focused API/upgrade/catalogue | 19 passed, zero skipped |
| Expanded serializable stress reproduction | 11 passed, 2 failed (ten-create scenario and parent); HTTP 500 reproduced even after transaction-scoped pre-ledger locking |
| Final expanded setup scenarios | 13 passed, zero skipped, including the fixed ten-create case |
| Pure strict command/recovery contracts | 6 passed, zero skipped |
| Full isolated API regression | **267 passed, 0 failed, 0 skipped**, 294.50 seconds; `api-full-final.log` |
| Focused Chromium setup/recovery/viewport suite | Initial 13 passed; final **19 passed**, 41.1 seconds, including six editor-authority regressions; `browser-focused-final.log` |
| Local production API container | Passed pinned-image build, all 29 migrations/rerun, configuration rejection, readiness, unauthenticated boundary and login throttle; [container evidence](63-HOSPITALITY-LOCAL-CONTAINER-2026-10-29.md) |
| Complete final Chromium browser suite | **159 passed**, 4.3 minutes, including the six added editor-authority scenarios; `browser-complete.log` and `browser-complete-html/index.html` |
| Final real Fastify/PostgreSQL browser suite | **22 passed**, 1.7 minutes; restaurant journey 5.9 seconds, with unchanged nonempty posted stock/sales/payment/receipt/journal evidence; `real-complete.log` and `real-complete-report/index.html` |
| Expanded Chromium/Firefox desktop/mobile matrix | **112 passed**, 5.0 minutes; `browser-matrix.log` and `browser-matrix-report/index.html` |
| Hosted CI for new configuration changes | Not run; the green baseline belongs to PR #24's starting SHA |
| Physical printer, KDS tablet, screen reader and installed PWA | Not exercised |

API command:

```powershell
node --import ./apps/api/test/support/isolate-database.mjs --import tsx --test --test-concurrency=2 apps/api/test/*.test.ts
```

`TEST_DATABASE_URL` identified only the task-owned disposable local PostgreSQL
server on port 55435; the preload created a distinct generated database for each
test file. Existing named business/test fixtures were preserved. The corrected
full run follows an initial **266 passed / 1 failed** run: its cross-outlet
assignment constraint probe omitted the newly required `device_version`, so
NOT NULL rejection occurred before the intended foreign-key check. Supplying
that required field restores the intended foreign-key assertion. No runtime
guard was weakened.

Initial focused browser traces reproduced implicit wrapped select labels that
included option text. Four explicit visible label associations fix the new
workspace without changing the shared dialog primitive. A broader intercepted
run then finished **124 passed / 1 failed / 28 not run** because the test helper
tested navigation visibility before sign-in restoration completed. The analogous
real-browser helper had the same reload race (**17 passed / 1 failed / 4 not
run**). Both now wait for the signed-in operator before selecting navigation.
The next real-browser attempt hit a native Chromium GPU-process crash after
15 passing tests while concurrent tools exhausted Windows commit memory; a
concurrent native TypeScript invocation also failed `VirtualAlloc` with errno
1455. These are retained failed/environmental attempts, not acceptance passes.
The final complete suites then passed sequentially without per-test retries,
as recorded above. Failed attempts remain retained rather than being relabeled.

The native compiler also discovered the copied API sources in the local
container build context because the root TypeScript configuration previously
included every directory. The configuration now excludes only generated
`dist`, `dist-artifacts` and the usual `node_modules`; original UI, API and test
sources remain checked. The subsequent full typecheck passed with task-local
`GOMAXPROCS=2`. The canonical cross-browser matrix now includes the restaurant
spec and explicitly excludes the separate real-integration directory, whose
matching filename must run only under its PostgreSQL configuration.

Final UI artifact after the editor-authority follow-up: `index-B5uKh6ah.js`, SHA-256
`e1849e698e450a67cb141bfe8e3ead16d0e5768666774643eaec2f692b650fae`.
Lazy restaurant chunk: `BackendRestaurantWorkspace-_bHuP24s.js`, SHA-256
`8eaa50ef876ab7a051e2e1c58d0035301595503c5fdb6a56e74aaebc1f742eea`.
The earlier artifact `index-BRBH5yCp.js` passed all 153 then-existing Chromium
tests before independent review added the missing stale-editor scenario. That
new regression failed on the earlier artifact, then passed with the frozen
authority fix. Full regression of the final artifact is recorded separately.
Migration 029 SHA-256:
`b6cbf43ad2c14e6004e650d4b81685f8e6208df5b319019c66e398aea93d9602`.

Seven standalone PNGs are retained at
`dist-artifacts/hospitality-p1-configuration/visual-inspection/restaurant-menu-<width>x<height>.png`:
1024×600, 1280×720, 1280×800, 800×1280, 1366×768, 1920×1080 and 390×844.
Manual inspection of the 1024×600 and 390×844 images found visible footer actions,
readable labels and no horizontal page overflow; the Save control measured
152×44 pixels. These use intercepted HTTP fixtures on the built artifact.
Earlier body-only test attachments were not persisted by the list reporter, so
the standalone PNGs were captured explicitly. No before-change screenshot,
formal contrast audit or screen-reader acceptance is claimed.
Those standalone images precede the editor-authority follow-up; the final
19-case focused HTML report at `browser-focused-final-report/index.html` retains
seven fresh viewport PNG attachments for the final artifact.
The final real-browser HTML report also retains real PostgreSQL-backed desktop
1024×600 and mobile 390×844 restaurant screenshots. Both were visually reviewed:
saved routing and instructions are visible, the unsupported-workflow notice is
clear, tabs wrap and actions remain reachable.

## Changed-file map

The slice is separate from the inherited PR #24 changes.

- Persistence/domain: `apps/api/migrations/029_restaurant_configuration.sql`,
  `apps/api/src/restaurant.ts`, `restaurantContracts.ts` and migration runner;
  command catalogue/dispatch, contracts/roles, staff/capability setup and HTTP
  routes; opt-in admission in `apps/api/src/db.ts`.
- UI: `src/components/service/BackendRestaurantWorkspace.tsx`,
  `src/types/restaurant.ts`, API adapter/terminal-response checks, task/recovery
  navigation, capability labels, workspace read readiness and operator labels.
- API acceptance: `restaurant-configuration.integration.test.ts`,
  `restaurant-contracts.test.ts`, `restaurant-upgrade.integration.test.ts`,
  `transaction-admission.integration.test.ts`; existing catalogue/configuration
  expectations include the new supported restaurant capability.
- Browser acceptance: `e2e/restaurant-configuration.spec.ts` and its real
  `e2e/integration/restaurant-configuration.spec.ts` counterpart; the cross-browser
  matrix includes the new intercepted suite. Root TypeScript excludes generated
  validation/build artifacts while retaining the canonical source/test trees.
- Documentation: README, completion/integration/execution registers and docs
  61–63 record source gaps, dependency identity, contracts, failures, final checks
  and the local container boundary.

## Release boundaries and next dependency

This branch explicitly depends on unmerged PR #24's exact green head
`e595d9789270192bcf6f37a28e8346b055e3c59d`; its schema includes 022–028.
Migration 029 has no destructive rollback. Disable restaurant capability and
retain the additive tables/evidence if rolling back the application. An older
API does not understand restaurant setup/capabilities, so compatible rollback
must be reviewed; arbitrary old writers against all prior expansion migrations
are not accepted automatically.

Pre-transaction admission relies on the checked-out PostgreSQL connection
retaining one database session. Direct PostgreSQL/session-preserving connections
are required; introducing a transaction-pooling proxy needs a separate reviewed
admission design and acceptance. No production connection mode was inspected.

No production connection, backup, deployment, main merge, PR closure or branch
policy change is authorized by this development instruction. Physical printer,
scanner, Android/Windows KDS, installed PWA, production restore and runtime
acceptance remain unverified. The lazy restaurant bundle does not establish a
measured performance SLO; existing main-bundle warnings remain.

The next slice is durable source orders and exactly-once fire, with stable order
and line identity, immutable per-station ticket batches, price/tax/kind snapshots,
authoritative recovery and scoped waiter/kitchen permissions. Preparation,
printing, add-on/void and settlement follow the master's ordered dependencies.
Prepared payment remains blocked until recipe consumption is accepted. Later
cashier settlement must preserve source lines and price/tax snapshots rather
than rebuild a current-price POS basket. Room charges wait for P2 folio authority.

The dependent 30 October [P1.2 continuation](64-RESTAURANT-ORDERS-FIRE.md) now
implements source orders and NEW/ADD-ON station tickets. Its source and
acceptance are recorded separately. This document preserves the accepted P1.1
configuration artifact and does not extend its test counts to later changes.
