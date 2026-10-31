# Restaurant source orders and immutable fire

P1.2 continuation of the [29 October master instruction](../MAZAO_ERP_P0-P4_MASTER_DEVELOPMENT_INSTRUCTION_2026-10-29.md),
implemented on `feat/hospitality-orders-fire`. This branch starts at the locally
accepted P1.1 configuration commit `92e25973601b1b8a5ab575edccc8e4811c20076e`,
which depends on unmerged PR #24 at `e595d978`. The [P0 checkpoint](61-HOSPITALITY-P0-BASELINE-2026-10-29.md)
records hosted CI for that inherited head. New orders/fire changes need their own
exact-head CI, review and release acceptance. No deployment is implied.

## Supported operator flow

**Tables & kitchen → Orders** opens shared outlet tabs for restaurant operators.
A waiter chooses a table, or explicitly chooses takeaway/counter, and supplies a
distinct tab label. Multiple tabs at a table remain separate. An active label is
unique without regard to case within that table or the takeaway group.

The operator adds menu items, quantity, preparation choices and notes, then saves
the draft before firing. Preparation choices are plain text and carry no extra
price. Repeated menu items remain separate stable source lines so different
choices and preparation notes cannot be merged accidentally. Hold/resume affects
future unsent items; it does not stop production from an already saved ticket.
Only an order that has never fired may be discarded, with a recorded reason.

Save snapshots the server's reviewed product, menu route, station, price, tax,
unit and item kind. Fire requires the saved versions to remain current. It never
reprices the order. A changed price or route requires an explicit review of all
unfired lines followed by a new saved draft. Reloads, reconnects, menu searches
and background reads preserve the editor's reviewed authority. A change by
another waiter produces a version conflict; it does not renew an old draft.

Fire creates one immutable NEW ticket per routed station in a single durable
batch. Later unsent items create an ADD_ON batch linked to the first batch. Fired
source rows and previous ticket snapshots remain exact. A source item routed to
both kitchen and pass still represents one commercial quantity. Tickets include
table/tab, original waiter, firing actor/device/time, preparation choices and
stable source line IDs; they exclude prices, tax, cost and tender details.

**Station tickets** lets kitchen/bar operators review only stations currently
assigned to their logical workspace. Managers can review all outlet stations.
Assignment revocation, device-version changes and session/role/capability changes
are checked by the server. These are read-only saved-ticket histories, refreshed
explicitly. They are not live KDS preparation states or delivery acknowledgements.

## Authority, contracts and persistence

Both `restaurant` and `commerce` capabilities are required. The first-use SETUP
state permits only the existing five configuration commands and two setup reads;
operational orders, menu and ticket feeds require the reviewed trading state.

| Permission | Fixed roles |
| --- | --- |
| `restaurant.order.view`, `restaurant.order` | Owner, administrator, manager, waiter |
| `restaurant.ticket.view` | Owner, administrator, manager, cook, bartender |
| Configuration review | Existing restaurant-view roles, including cashier |
| Configuration/station access management | Existing P1.1 restaurant/device management authority |

Cooks and bartenders cannot obtain the outlet order book or commercial quotes by
guessing order IDs. A station ID supplied by a browser never grants feed access.
Tenant, outlet, actor, session and device derive from authenticated authority.
Shared tabs retain their creator attribution when a different waiter edits/fire.

| Command | Payload | Reviewed version keys |
| --- | --- | --- |
| `restaurant.order.create` | `tableId` or null, `serviceLabel` | Selected `table:<id>` |
| `restaurant.order.save` | `orderId`, `instructions`, complete unfired `lines` | `order:<id>` and every submitted `product:<id>`, `menu:<productId>`, routed `station:<id>` |
| `restaurant.order.hold` | `orderId`, `held`, `reason` | `order:<id>` |
| `restaurant.order.cancel` | `orderId`, `reason` | `order:<id>`; never-fired orders only |
| `restaurant.order.fire` | `orderId` | `order:<id>` and all saved unfired product/menu/station versions |

Save replaces only unfired draft rows. Omitted fired rows stay in the order;
explicit attempts to edit a fired line fail. An existing line ID cannot change
its product. Removed unfired identities stay in history. Limits are 200 open
tabs per outlet, 100 current lines per order and 500 retained historical line
identities. Quantities use exact decimal arithmetic with at most six fractional
digits; amounts use checked integer minor units and existing tax rounding.
Unsafe totals, repeated trimmed choices and control characters are rejected.

Every command has a strict payload/result schema, reviewed version checks,
current permission/capability checks, the existing serializable transaction and
original-command idempotency, and audit/outbox evidence. Restaurant admission
uses P1.1's pre-transaction session-preserving PostgreSQL connection locks.
Uncertain acknowledgements retain the original envelope and command ID. Setup
recovery accepts only its five configuration commands; it cannot present an
unfinished fire as a setup save. Invalid/incomplete terminal responses retain
recovery evidence. Incomplete order reads disable saving instead of hiding
unfired rows that a later whole-draft save could otherwise remove.

Migration **030** adds `restaurant.orders`, `order_lines`, `fire_batches`,
`tickets` and `ticket_lines` with composite scope foreign keys. Batch revision,
command, station ticket and source-line/station links are unique. Database
triggers reject changes/deletes to fired lines, batches, tickets and ticket
links. Ticket document hashes are SHA-256 of stable serialized snapshots.
Migrations 001–029 are unchanged. Open orders block table/outlet retirement and
restaurant-capability removal; retained tickets block station retirement until
the completion contract exists. Even an empty durable order locks its currency.

The new reads are:

- `/restaurant/orders`, `/restaurant/orders/:id` and `/restaurant/menu`;
- `/restaurant/orders/:id/tickets`;
- `/restaurant/ticket-stations` and `/restaurant/stations/:id/tickets`.

Lists use server search, matching totals and scope/filter-bound continuation
cursors. Detail reads contain saved quote snapshots separately from current
quotes. The client checks line counts, unique identities, totals, source/ticket
bindings and required fields before enabling writes. Failed continuation keeps
the existing rows and cursor available for an explicit retry. Unauthorized
station-feed responses clear protected displayed tickets.

## Validation evidence

Artifacts are local and ignored under `dist-artifacts/hospitality-p1-orders/`.
Initial focused acceptance passed 32 API tests. Full current API acceptance
passed **285 tests, zero failures and zero skips** (`api-full.log`), including:

- two waiters and ten simultaneous fire attempts: one confirmed batch, nine
  controlled conflicts, exact original-command replay and status recovery;
- distinct duplicate-SKU choices, quote/station drift, holds, original fired
  snapshots and add-on linkage, direct database immutability attempts;
- foreign tenant/outlet identities, role separation, device-version revocation,
  scoped station paging, complete order search/continuation and setup fencing;
- real preexisting stock receipt, cash sale, tender, shift, immutable receipt and
  balanced journals remain unchanged throughout the restaurant workflow;
- populated 029→030 upgrade preserving every preexisting domain row, complete
  migration/checksum rerun, scoped foreign keys and strict contracts.

UI/API TypeScript and the PWA production build passed. The build precaches 27
entries / 988.50 KiB; the main bundle remains above the existing 500 kB warning.
The final cancelled-draft acknowledgement guard also passed all 10 API message
tests (`api-messages-final.log`) after the full API run above.

| Artifact | SHA-256 |
| --- | --- |
| `030_restaurant_orders_fire.sql` | `b61c65cf8c08e03fccdc1470a7de20a1c865b13fb0756859ae58de499c659118` |
| `index-DMxolK_m.js` | `809c9a9936e0f0f1840bca9a19d28975774b9e61f7d49320b63eea18bff8f2e9` |
| `BackendRestaurantOrdersWorkspace-BhQDybWD.js` | `edebd2a29fc4aef80409bf1dc550c923f9e991e3e08fcb3493738f28118c45e8` |
| `RestaurantWorkspace-C8fFnyme.js` | `1e7a8c0d541ee7482f6992a5802963aa68ac2e0a37dcf266f1b71d74f999d052` |

The final focused browser run passed **41/41** restaurant configuration/order
cases (`browser-focused-final.log`). Its HTML report retains seven configuration
and seven fire-dialog viewport PNGs. Visual review of the 390×844 and 1024×600
fire dialogs confirmed readable text and reachable confirmation actions; the
automated checks require at least 44-pixel action height and no page overflow.
These are intercepted HTTP fixtures on the built artifact.

Full browser/matrix, real PostgreSQL/browser and container evidence is pending in
this working record and must be recorded before full local acceptance.
The first TypeScript pass caught a test helper's overly narrow UUID inference;
that diagnostic is retained in `typecheck-first.log`.

The first focused browser run passed 25 cases before a test inspected its POST
array before the asynchronous save arrived. The retained failure is
`browser-focused.log`; the regression now waits for the actual conflict response
before verifying that the original reviewed version was sent. No source version
guard was relaxed. Docker Desktop then became unavailable; real browser and
container checks cannot use the stopped engine without resolving its ownership.

## Remaining dependencies and release boundaries

This slice creates source orders and immutable preparation evidence. Physical
80mm KOT/BOT documents, durable printer jobs/copy/reprint evidence, printing
failures, live KDS acknowledgement/preparing/ready/served states, cancellation
after fire, void tickets, transfers/splits and exactly-once source settlement
remain P1 work. A ticket row/outbox event does not prove kitchen or paper delivery.

No restaurant payment, stock reservation/consumption, recipe COGS, journal,
receipt or hotel folio charge is created here. Prepared-item payment retains the
existing recipe-consumption guard. Future cashier settlement must consume these
saved source identities/prices, not rebuild a current-price POS basket. P2 must
provide real checked-in guest folio authority before room charging is enabled.

P2 hotel completion, P3 inventory/back-office expansion and P4 offline/full
acceptance remain part of the active master goal. No main merge, remote PR
closure, branch-policy mutation, SSH, production database access or deployment
is authorized by this development instruction. Physical printer/KDS device,
installed-PWA, backup/restore and current production SHA/schema remain unverified.
