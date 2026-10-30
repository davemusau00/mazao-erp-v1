# Complete directory and reservation navigation

Date: 20 October 2026, Africa/Nairobi. Plan ticket: S00-05.

Customer accounts, staff, workspace assignments, operator sessions and confirmed
reservations now expose authenticated continuation and server search through
their existing read endpoints. Their former 500/500/500/100/250 row ceilings
no longer end navigation. Responses retain their original arrays and add
`page: { nextCursor, asOf, totalCount, hasMore, limit }`. `q` searches the full
authorized source, `after` continues its applied filter, and `limit` accepts
1 to 250. Default pages contain 100 customers/staff/assignments/reservations or
50 sessions. Unsupported query fields and invalid/cross-resource cursors are
controlled 400 errors.

Continuation timestamps also reject impossible calendar dates and clock values;
JavaScript date normalization cannot pass a malformed cursor into PostgreSQL.
Real microsecond cursor text is preserved. Search rejects NUL and other control
characters before query parameter construction, avoiding invalid PostgreSQL
text and keeping these requests in the controlled 400 contract.

The implementation uses `historyPagination.ts` inside `inReadSnapshot`: page
rows and filter counts come from one repeatable-read transaction. Immutable
creation timestamps and UUIDs provide deterministic descending continuation,
including timestamps that differ only by microseconds. The first page fixes an
`asOf` cutoff; ordinary new records do not appear in that continuation. A refresh
starts a new view. This is a continuation view over current authorized records;
it does not preserve historical snapshots of later edits, status changes or
deletions. Searches and counts can therefore change when existing rows change.
Staff order uses the global identity creation timestamp because memberships
have no creation timestamp. Current staff creation creates a new identity; a
future workflow attaching an existing identity must introduce its own immutable
membership ordering before promising insertion isolation for that workflow.

Customer/staff/assignment directories remain tenant-wide under their existing
permissions. Reservations remain outlet-scoped and include only confirmed
reservations. Sessions remain tenant-and-target-user scoped; staff views require
`staff.view`, while an operator may read their own sessions. Cursor scope also
binds actor, outlet, resource/target and applied search, and every request
revalidates the live session. Switching a reservation cursor to another outlet,
or a session cursor to another target, fails. A tenant-wide customer directory
continues to show the same authorized business accounts from another outlet.

Customer search includes name, phone, email and account UUID. Staff search
includes membership display name, email, role and user UUID. Assignment search
includes assignment identity/label, outlet and operator. Sessions search their
identity, terminal label and outlet; reservations search guest/contact, room,
dates and reservation UUID. UUID searches support refreshing a selected or
provisioned staff member outside a page.

The customer directory, customer-credit picker and reservation workspace show
coverage and append older rows. Their search controls query the server.
Concurrent search responses use generation guards. Failed hotel/picker searches
retain the last successful applied filter/cursor. The customer directory also
retains read errors and explicit retry, while selected statement reads continue
to use their existing independent generation guard. Customer local status
filters apply to the loaded accounts and say so in the screen. The API separately
aggregates customer portfolio balances/approved limits/debtor and suspended
counts across the entire tenant in the same read snapshot; pagination or a
search cannot turn a page subtotal into a business total. Status-tab counts use
loaded rows, avoiding negative zero-balance counts when the business has more
debtors than the loaded page.

Staff/session/assignment controls and preservation of a selected or provisioned
operator are documented in [Staff, workspace assignment and session history](53-STAFF-SESSION-HISTORY.md).
The HTTP client read methods accept `HistoryOptions` after their existing abort
signal argument. Optional page typing retains compatibility with earlier
intercepted UI fixtures; the new server always supplies page metadata.

Source boundaries:

- `apps/api/src/customerAccounts.ts`: customer continuation and full portfolio totals.
- `apps/api/src/staff.ts`: staff/assignment/session continuation and live authority.
- `apps/api/src/hospitalityDirectory.ts`: confirmed reservation continuation.
- `apps/api/src/app.ts`: existing authenticated routes forward validated query objects.
- `src/services/apiClient.ts`, customer/POS/hotel workspaces and staff/session panels: read contracts and visible controls.

Local verification:

```text
npm run typecheck
Passed for UI and API.

TEST_DATABASE_URL=<disposable PostgreSQL> node --import tsx --import ./apps/api/test/support/isolate-database.mjs --test apps/api/test/directory-pagination.integration.test.ts
8 tests passed; 0 failed; 0 skipped.

node --import tsx --test apps/api/test/history-query-validation.test.ts
2 tests passed; 0 failed; 0 skipped.
```

The isolated PostgreSQL suite traverses 501 customers, 502 staff, 502 assignments,
102 sessions and 251 reservations without duplicate identifiers. It includes
equal timestamps, microsecond ties, oldest-record search, exact user lookup,
full customer totals under a one-row search, concurrent customer insertion,
filter/resource/target rejection, tenant isolation, cross-outlet reservation
scope, forged impossible-date cursors, NUL/control searches and permission changes between pages. SQL fixture inserts are disposable
read acceptance data; they are not new financial posting acceptance.
The same suite executes the four migrated commands and validates their real
result schemas, including padded maximum-length session reasons. It posts no
paid sale: the shift opens with a zero float, the room receives a housekeeping
transition, and two existing disposable sessions are revoked.

Browser acceptance source `e2e/directory-history.spec.ts` covers customer list
append/search with full portfolio totals, a customer beyond the first page in
the POS picker, and reservation append/search. The final coordinated Chromium
run used the fresh production build and a separate output directory:

```text
npx playwright test e2e/directory-history.spec.ts e2e/customer-accounts.spec.ts e2e/account-access.spec.ts e2e/staff-history.spec.ts e2e/history-pagination.spec.ts --output=dist-artifacts/playwright-s00-directories
23 passed in 1.3 minutes; 0 failed.
```

This includes all three new directory cases, three existing customer cases,
three staff/session/picker cases, ten account/recovery cases and four stock/
cash-up/evidence navigation cases. Assertions use the established whole-money
format and accessible names that include availability. Browser artifacts use a
separate output path so parallel API browser checks cannot remove each other's
traces. Existing customer/staff behavior is checked by the related regression
suites. No deployment, production-data query, physical
device acceptance or hosted CI claim follows from these local checks. Search
latency on production-sized directories remains a separate performance gate.
