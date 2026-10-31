# Restaurant KDS preparation state slice

**Status:** locally implemented on `feat/hospitality-kds-lifecycle`. This is a
development slice, not an accepted production release or complete restaurant
milestone.

## Operator outcome

An authorized cook or bartender can move an assigned station ticket through
`NEW -> ACKNOWLEDGED -> PREPARING -> READY`. A fire command creates the initial
`NEW` state in the same transaction as the immutable ticket. Each later change
adds a versioned event; the fired ticket document and its line snapshots remain
unchanged.

The station feed returns the current status, version, timestamp and actor name.
It refreshes every eight seconds while online, blocks actions while stale or
offline, and retains the original command for status recovery if the response
is lost. Expected ticket versions and an outlet-scoped advisory lock prevent a
stale or competing device from advancing the same ticket twice.

## Authority and effects

- `restaurant.ticket.work` is assigned to cook, bartender, manager, owner and
  administrator roles. A cook or bartender also needs a current logical device
  assignment to the ticket station. Manager roles use their existing
  configuration authority.
- The command is online-only, tenant/outlet-scoped and records the actor,
  station, device, previous state, new state, command ID and event version.
- Ticket state changes do not create sales, payment, stock movement, ingredient
  consumption, journal entries or guest-folio charges.
- Physical 80 mm KOT/BOT printing and paper-delivery evidence are unavailable.
  `READY` does not mean served. `SERVED`, cancellation/void, print queues,
  transfer/split and settlement remain unsupported. The restaurant/KDS
  availability gate remains closed until its full acceptance boundary passes.

## Changed files

- `apps/api/migrations/031_restaurant_ticket_lifecycle.sql` adds an append-only
  state-event table, backfills existing fired tickets as `NEW`, validates
  sequential inserts, and protects events from update/delete.
- `apps/api/src/restaurantOrders.ts`, `apps/api/src/commandCatalogue.ts`,
  `apps/api/src/restaurantOrderContracts.ts`, `apps/api/src/commands.ts` and
  `apps/api/src/contracts.ts` implement scoped transition authority,
  version-conflict handling and command recovery.
- `src/components/service/RestaurantStationTicketsWorkspace.tsx`,
  `src/components/service/RestaurantTicketCards.tsx`,
  `src/services/apiClient.ts`, `src/services/apiMessages.ts` and
  `src/types/restaurantOrders.ts` add status display, polling, guarded actions
  and original-command recovery.
- API contract/recovery tests, database integration/upgrade tests, and focused
  Playwright acceptance cover state progression, stale versions, role and
  station authority, lost acknowledgements, offline behavior and responsive
  station screens.

## Local evidence

Recorded on 31 October 2026:

- `npm run typecheck` passed for the UI and API.
- `npm run build` passed. Vite reports the repository's existing bundle-size
  warning for the 542.63 kB main chunk.
- `npm run test:api` passed with 107 tests, zero failures and 37 expected
  skips because `TEST_DATABASE_URL` is absent. A fresh run after this slice
  passed 108 tests, zero failures and the same 37 expected skips. The focused
  contract/recovery rerun passed 25 tests, zero failures and zero skips.
- `npm run build` passed with `index-kfAW_u2k.js` (542.63 kB / 146.52 kB gzip).
  Vite reports the existing main-chunk size warning and config-loader warning.
- `npx playwright test e2e/restaurant-orders.spec.ts --reporter=line` passed
  all 24 browser cases, including both new KDS queue viewport cases.
- Docker Desktop is unavailable in this workstation session. Therefore the
  new PostgreSQL migration/backfill, real API/PostgreSQL state races and
  container lane have not been run locally. Hosted exact-head CI must prove
  them before merge.

Mocked browser tests are not a substitute for database or hosted CI evidence.
No PR, merge or deployment evidence is claimed by this document.

## Next dependencies

1. P1.3: immutable, station-specific NEW/ADD-ON/VOID/COPY 80 mm documents,
   durable print attempts and recoverable printer outage behavior.
2. P1.4 continuation: out-of-stock/hold/cancel approval states, waiter-ready
   visibility, served handoff, reconnect/event history and role adversarial
   acceptance.
3. P1 settlement and P2: use the saved order/line identities for exactly-once
   payment or an authorized checked-in guest-folio charge, followed by checkout
   and source reconciliation.
4. P3: location/transfer, package, recipe, consumption and supplier slices only
   after the restaurant-to-hotel authority boundaries are accepted.
