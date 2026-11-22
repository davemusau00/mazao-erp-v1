# Restaurant durable station print queue (P03)

**Status:** implemented on `codex/restaurant-print-queue` from the mainline that
contains merged PR #26. This is an online development slice. It has not been
merged or deployed, and it does not complete M2.

## Operator workflow

Firing an order stores one durable `QUEUED` print job per immutable station
ticket in the same database transaction. The assigned station operator loads
the queue, claims a job, prepares the 80 mm browser document, opens the system
print dialog, inspects the paper and records the result. A failed attempt needs
a reason. A confirmed or failed job can create a separately identified,
clearly labelled copy linked to its source job and original document hash.

Claims are bound to the authenticated actor and logical device and expire after
five minutes. An expired claim can be recovered by another authorized operator;
the original ticket and document snapshot remain unchanged. The queue exposes
the current status and only returns a claim identifier to the actor/device that
owns it. Unknown command outcomes keep their original command ID for status
recovery before another print action is allowed.

The browser reports operator input, not printer telemetry. `OPERATOR_CONFIRMED`
means the operator said paper printed. It does not establish delivery to the
printer, cutter, paper path or cash drawer. Physical printer outage, duplicate
output, paper-out, cutter and reconnect acceptance remain hardware release
gates. Printing is online-only; a stale queue cannot authorize a print action.
The refreshed queue shows the reporting operator and time, and preserves the
failure reason alongside the failed status.

## Persistence and authority

Migration `034_restaurant_print_queue.sql` adds station-scoped jobs and
append-only job events. It does not enqueue historical fired tickets during
upgrade, so migration cannot silently cause old orders to print. Ticket
documents are immutable snapshots. Copy jobs preserve the source document hash
and use a distinct `COPY n` label. Claims, confirmations and failures are
versioned commands with expected job versions, current restaurant-ticket
authority, tenant/outlet scope, audit and original-command idempotency.

The station read is
`GET /api/v1/restaurant/stations/:stationId/print-jobs`. Queue actions reuse
`restaurant.ticket.work`; cooks and bartenders still need current assignment to
the station. A browser-supplied station ID does not grant access. The queue does
not create a sale, stock move, recipe consumption, journal entry or guest folio
charge. `READY` remains distinct from `SERVED`.

## Local implementation and evidence

The slice adds migration 034, command/result contracts and handlers, the scoped
queue read, an 80 mm print document and queue UI, terminal-result validation,
API integration/upgrade coverage and browser coverage for claim, print-template
rendering, operator confirmation, failure-reason visibility and a reprint copy.

At the current worktree:

- `npm run typecheck` and `npm run build` passed; the existing main-bundle size
  and Vite config-loader warnings remain.
- `npm run test:api` passed 109 tests with zero failures; 39 PostgreSQL-backed
  cases were skipped because `TEST_DATABASE_URL` is not configured.
- `npx playwright test e2e/restaurant-orders.spec.ts --reporter=line` passed
  all 26 restaurant browser cases, including print-media rendering, expired
  claim recovery from the station UI,
  operator confirmation, copy creation and the existing responsive flows.
- Fresh/populated PostgreSQL migration and checksum-rerun evidence still
  requires a disposable database or green exact-head hosted CI. Physical
  printer acceptance has not been performed.

The owner-confirmed VPS address is `38.247.142.209`. This source branch has not
verified the SSH host identity or which live hostname/release is served by that
address. Country at `country.mazaoyako.co.ke` and Yako at `mazaoyako.co.ke`
remain separate tenants, databases and release artifacts. No production
activation is implied.

## Next M2 work

1. Finish exact-head migration, API and browser acceptance, including the
   populated upgrade, checksum rerun, permissions, claim expiry/reclaim, lost
   responses, failures and immutable copies.
2. Obtain hosted CI and physical printer/cutter/paper acceptance before merging
   or claiming the printer gate complete.
3. Deliver served/void and waiter handoff, then settlement/split tender and
   recipe/location slices as separate reviewed vertical slices.
4. Keep restaurant sales, stock and accounting workflows unavailable until the
   complete two-station order-to-payment reconciliation gate passes.
