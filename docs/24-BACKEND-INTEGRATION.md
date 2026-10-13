# Backend integration register (v1 foundation)

This register describes the actual authenticated API boundary. Browser demo storage is not a backend; a local draft is not committed state; an outbox row is not remote delivery; and a cash command is not a card or mobile-money provider confirmation.

## Runtime and first operator

The API is a Fastify modular monolith at `apps/api/src/server.ts`; PostgreSQL is required through `DATABASE_URL`. The Vite development server proxies `/api/v1` to `http://127.0.0.1:4101`. Production needs TLS termination and an explicit API route. Do not expose the development bind address publicly.

1. Start PostgreSQL and provide `DATABASE_URL` (optionally `DATABASE_SSL=require` and `DB_POOL_SIZE`).
2. Run `npm run db:migrate`. The runner applies checksummed migrations `001_initial` through `004_hospitality` in order. Before an unapplied migration 003, it normalizes the original generated order-status constraint name to the name expected by that migration. Before unapplied migration 004, it creates the missing `hospitality` schema. Already-applied versions are checksum checked and these compatibility steps are skipped. Use the runner; applying SQL files manually bypasses these repairs.
3. Set `BOOTSTRAP_CONFIRM=CREATE_INITIAL_TENANT`, `TENANT_NAME`, `TENANT_CURRENCY`, `TENANT_TIME_ZONE`, `OUTLET_NAME`, `OUTLET_TIME_ZONE`, `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` (12+ characters), and `DEVICE_LABEL`; then run `npm run api:bootstrap` once. `TENANT_CAPABILITIES` is a comma-separated list and defaults to `retail,inventory,commerce`; include `hospitality` to enable hotel routes and commands. Bootstrap stores a scrypt password hash and prints generated IDs, never the password.
4. Run `npm run api:dev` and `npm run dev`. Sign in through **Connect backend**. Login requires one active membership and one active outlet/device assignment for the account.

`APP_ORIGINS` is an exact-origin allowlist for unsafe methods; set it in production. `SESSION_HOURS` defaults to 12. Session cookies are HttpOnly and SameSite Strict, Secure in production, with a CSRF cookie/header pair. User, membership, device and session are rechecked on every request. Login throttling is per process; multi-replica deployments need a shared gateway limiter. Keep secrets out of source control.

## HTTP and command contracts

Routes use `/api/v1`; JSON errors have `{ error: { code, message } }` shape. The browser adapter is `src/services/apiClient.ts`. Authenticated routes use the server session to select tenant, outlet, operator, device, role and capabilities; caller-supplied tenant or actor values do not grant authority.

| Route | Authorization | Behavior |
| --- | --- | --- |
| `GET /health/live` | Public | Process liveness only. |
| `GET /health/ready` | Public | Confirms PostgreSQL connectivity only. |
| `POST /auth/login` | Public, rate limited | Password verification, active membership/device resolution, server session and CSRF cookies. |
| `GET /auth/me` | Session | Current user, tenant, currency, tenant time zone, capabilities, outlet and device. |
| `POST /auth/logout` | Session + CSRF | Revokes the current session. |
| `GET /catalog/items` | Session + catalog, inventory receive or sell role | Tenant/outlet product and balance snapshot. Quantity is a decimal string; money is integer minor units. Current projection also includes cost price; see security gap below. |
| `GET /inventory/movements` | Session + inventory receive role | Latest 250 tenant/outlet movements with quantity delta and balance evidence. |
| `GET /shifts/current` | Session + shift open/close role | Current operator's open shift, if any. |
| `GET /sales/orders` | Session + sell, refund or finance role | Latest 250 outlet orders with line, tender, cost and refund totals. Cost projection is overbroad for cashiers and remains a P1 issue. |
| `GET /hospitality/rooms` | Session + hospitality capability + hotel view role | Outlet room status, rate snapshot and active guest summary. |
| `GET /hospitality/reservations` | Session + hospitality capability + front desk/manage role | Confirmed reservations for the outlet. |
| `GET /hospitality/stays` | Session + hospitality capability + front desk/manage role | Active stays and an estimate based on booked nights and the stored tax-rate snapshot. |
| `POST /commands` | Session + CSRF | Idempotent command receipt; the canonical stored outcome is returned unchanged on exact replay. Domain mutation, audit and outbox are one serializable transaction. |
| `GET /commands/:commandId` | Session | Tenant-scoped command status and stored outcome for unknown-result recovery. |

Command envelope: `{ protocolVersion: 1, commandId, tenantId?, deviceId, type, occurredAt, expectedVersions, payload }`. The authenticated session determines authority. Reusing a command ID with different content is rejected. Domain errors are durably recorded as `REJECTED` or `CONFLICT`; confirmed outcomes are retained. Exact replay returns the same outcome shape and does not run the mutation again. On transport failure, retain the ID and check status before retrying.

| Command | Permission / capability | Required input and expected versions | Committed effects |
| --- | --- | --- | --- |
| `catalog.product.create` | `catalog.manage` | SKU, name, base unit, tenant currency, integer sell/cost minor units, tax basis points | Product, zero stock balance, audit and outbox. |
| `inventory.receive` | `inventory.receive` | Product lines with decimal quantity strings and integer unit cost; optional supplier text and delivery reference | Locks products, increases stock, writes immutable receipt movement, balanced inventory/accrual journal, audit and outbox. |
| `shift.open` | `shift.open` | Opening float minor units | One open operator/outlet shift, opening journal if nonzero, audit and outbox. |
| `shift.close` | `shift.close` | Shift ID, counted cash; expected key `shift:<id>` | Version-checked close and variance journal, audit and outbox. |
| `sales.order.settle` | `commerce.sell` | Product lines, cash tender allocations and `shift:<id>` | Checks stock and tender coverage, posts sale/tax/COGS, consumes stock, records cash allocation, advances shift, audit and outbox. |
| `sales.order.refund` | `commerce.refund` (admin/owner/manager) | Order, reason, return lines and `shift:<id>` | Locks original order/lines, caps returned quantity, apportions original subtotal/tax/COGS, requires available drawer cash, optionally restores stock, posts VAT-aware reversals, audit and outbox. |
| `hotel.room.create` | `hotel.manage` + `hospitality` | Room number/type, positive nightly rate, tax basis points | Tenant-currency room and audit/outbox. |
| `hotel.reservation.create` | `hotel.frontdesk` + `hospitality` | Room, guest, date range and expected `room:<id>` version | Checks overlaps under a serializable transaction, creates reservation, advances room version to serialize competing availability changes, audit/outbox. |
| `hotel.reservation.cancel` | `hotel.frontdesk` + `hospitality` | Reservation and expected `reservation:<id>` version | Cancels confirmed reservation, advances room version, audit/outbox. |
| `hotel.checkin` | `hotel.frontdesk` + `hospitality` | Reservation or walk-in details; expected room and reservation versions | Checks outlet-local business date and availability, creates stay and open folio, occupies room, advances versions, audit/outbox. Walk-ins must start on the current outlet business date. |
| `hotel.checkout` | `hotel.frontdesk` + `hospitality` | Stay, cash tender/currency, current shift; expected stay, room and shift versions | On/after booked departure date, settles booked nights by cash, posts room revenue/VAT/cash, closes folio/stay, dirties room, advances shift, audit/outbox. |
| `hotel.room.mark_ready` | `hotel.housekeeping` + `hospitality` | Dirty room and expected `room:<id>` version | Marks room ready, records housekeeping event, audit/outbox. |

Sale tender values express cash handed over; only the amount due is recorded as payment, with excess returned as change. Cash is the only confirmed sale/refund tender. Card, M-Pesa and mixed-provider settlement remain rejected until a provider can verify them. Money is integer minor units, quantities are decimal strings (six places maximum), and tax is stored as basis points. Outlet time zone determines hotel business-date checks.

Hotel checkout is deliberately narrow: the current command settles the booked room nights in full for cash and does not support deposits, ancillary charges, split folios, partial balance, early-departure recalculation or payment-provider confirmation. It must not be represented as the full hotel folio lifecycle from `docs/11-HOSPITALITY.md`.

## UI connection state

- **Today** uses the authenticated tenant/outlet/operator and current server shift. It does not include local demo sales or stock figures.
- **Sell** fetches the server catalog and shift. Once signed in, it cannot fall through to `storage.processSale` when the catalog is unavailable; server checkout is disabled until both catalog and shift state load. Cash is the only accepted tender. Unknown results retain the command in IndexedDB and offer status recovery.
- **Sales history** loads outlet orders from the API. Authorized managers can refund eligible line quantities for cash and choose whether returned stock is restored. Provider reversals, refund approvals and immutable receipt documents are not connected.
- **Stock** loads server catalog/movements and supports manager item setup. **Purchasing** can post reviewed delivery receipts. Supplier text and document references are evidence only; supplier masters, purchase orders and accounts payable are not implemented.
- **Shifts** uses server open/close commands and current shift state. Cash movement evidence, payouts, supervisor approvals and a complete Z report are absent.
- **Hotel and Reservations** use the authenticated room, reservation and stay queries with idempotent server commands. Front desk can create/cancel reservations and check in/check out; housekeeping can mark dirty rooms ready. Checkout limits are listed above. The old preview remains active only when no backend session exists.
- **Navigation** filters by current server role and tenant capability. In server mode, unsupported food service, stock count, customers, ledger/reports, manage and onboarding screens are hidden instead of showing their local demo behavior as authoritative.
- An unresolved command shows its recovery action. A status `404` means no server command record exists; only then may the same retained command ID be resent. A confirmed status displays the stored outcome.

## Module coverage and remaining service boundaries

| Module / journey | Current integration | Remaining work |
| --- | --- | --- |
| Identity, tenant, outlet and device session | Connected for one active membership/device | Invitations, password reset, MFA, multi-outlet switching, session/device administration, granular tenant-scoped grants. |
| Catalog, cash POS, order history and cash refunds | Server-authoritative for current documented cash slice | Split tenders, customer/guest credit, cost projection least privilege, cost layers, durable receipt document/reprint, provider payment/refund. |
| Stock item setup and movement history | Server product create, receipt, sale/refund movements and read models | Counts, transfers, adjustments, packages/barcodes, recipes, cost valuation and reviewed concurrency workflow. |
| Purchasing | Reviewed receipt posts to stock and inventory/accrual journal | Supplier master, purchase orders, approvals, invoice matching, AP and landed costs. |
| Shifts | Open/close, version check and variance journal | Till movement/payout evidence, cash-up reconciliation, approvals and Z report. |
| Hotel reservations, room lifecycle and cash checkout | Server room/reservation/stay/folio foundation plus signed-in UI; PostgreSQL acceptance pending | Deposits, ancillary charges, actual-night policy, early/late departure, multiple tenders, room move, maintenance, housekeeping inspection and occupancy reports. |
| Restaurant tables, kitchen/bar tickets and settlement | Local preview only; hidden in server mode | Persistent table/order/ticket commands, station routing, modifiers, inventory consumption and settlement. |
| Customer accounts and repayments | Local preview only; hidden in server mode | Credit policy, receivable ledger, repayment allocations, statements and aging. |
| Accounting and reports | Balanced journals are posted for supported commands; no report workspace in server mode | Permission-scoped ledger/report APIs, completeness and freshness metadata, drill-through, period controls and verified reconciliation. |
| Offline and external delivery | IndexedDB retains unknown commands; local demo queue remains separate | Server replay policy, change feed/cursor, offline grants, outbox worker/retries/dead-letter and multi-terminal reconciliation. |
| Printing and cash drawer | Browser preview only | Immutable receipt document and paired-device acknowledgement/status. No verified ESC/POS hardware integration. |
| Import, staff administration and business settings | Local design surfaces only; hidden in server mode | Staged imports, server-side users/permissions/devices/capabilities and audited configuration commands. |

The outbox is written in the same transaction as connected commands, but no worker publishes it. It does not mean remote synchronization. `/health/ready` checks only PostgreSQL. High-risk commands are online-only. Role permissions are coarse server role maps rather than tenant-specific grants.

## Integrity, security and acceptance status

The migration runner keeps applied SQL checksums immutable. Its targeted compatibility preparation addresses the known 003 constraint-name mismatch and 004 missing-schema issue only before those versions are first applied. CI starts disposable PostgreSQL, applies migrations to an empty database, reruns the migration command, and exercises API commands. The latest run, [38458774590](https://github.com/davemusau00/mazao-erp-v1/actions/runs/38458774590), failed on a test expectation (`0` versus the normalized API quantity `0.000000`); migrations, authenticated login, catalog read and exact command replay passed before that assertion. The expected quantity is corrected in the current worktree, which also expands the test to cover receiving, cross-tenant rejection, cash sale/refund, shift close, journal balance and overlapping reservations. That expanded test has not run yet. Local `npm run typecheck` and `npm run build` pass; the production build warns about Vite's `__dirname` config loader and a 653 kB main JS chunk. No local PostgreSQL migration, browser journey, physical printer or deployment was run for this update.

Known remaining risks include cost price exposure in catalog/sales history projections, mutable current cost used for sale COGS, incomplete composite tenant/outlet FKs in older tables, no provider-backed tenders, no outbox worker, no complete finance report verification, no server-side approval grants, and no browser end-to-end acceptance. Do not treat the API slice as production-ready or claim the ERP implementation complete.
