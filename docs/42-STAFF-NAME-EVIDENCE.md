# Tenant staff names and posted operator evidence

Date: 2026-10-16. Addresses audit finding F11 for current session identity, sale receipts/history, and cash-close reports.

The same global identity can belong to several businesses with different tenant-local staff display names. Login and authenticated session projection now use the selected tenant's `identity.memberships.display_name`. A profile rename is visible in an existing session's next `/auth/me` response and in fresh login responses; it does not change the global identity's email, password, or `identity.users.full_name`, or another tenant's membership. The browser displays a refreshed identity when its server session is restored or reloaded; this slice adds no push mechanism.

Posted operator evidence follows its recorded snapshot:

| Record | Name source and capture point |
| --- | --- |
| Sale receipt and sales history | `commerce.orders.operator_name_snapshot`, captured when the sale is inserted |
| New cash-close/Z report | Current tenant membership display name, captured at shift close |
| Previously posted receipt, sale history row or closed Z report | Existing stored snapshot, preserved after later renames |

Migration 016 already supplies the required order snapshot. Its one-time legacy backfill records the original global identity name, and its insert trigger records the current tenant membership name for new sales. Receipt and sales-history reads now consume that authoritative snapshot instead of joining a mutable global profile. The cash-close command reads the current membership within its existing posting transaction. No migration or historical data rewrite is needed; migrations 001–016 remain unchanged.

The existing staff-update policy remains in place. A display-name-only edit may occur while the operator has an open shift, and it does not revoke their sessions. A combined name/role change, suspension, or reassignment still requires the operator's open tills to be closed. This slice changes name projections, not authority, staff mutation contracts, or access guards.

## Verification

`apps/api/test/staff-name-evidence.integration.test.ts` contains two real PostgreSQL tests. Both fail against the preceding source because login/session names still come from the global identity. Both pass with this change.

- The first gives one global cashier different names and assignments in two tenants. It checks login and existing-session identity, records real cash sales and Z reports, renames one tenant's membership, and checks new receipts and close-time names. It compares complete old receipt/history/Z projections after later renames and verifies the other tenant's membership, sessions, receipts, history and close reports remain unchanged. Global email/name/password evidence is compared before and after.
- The second allows a name-only edit during an open till, then attempts a bundled role change, suspension and assignment transfer. Each access change is rejected with `OPEN_SHIFT_CONFLICT`; the successful name, membership role/status/version, assignment and access remain intact. Closing the till records the updated tenant-local name.

The focused tests pass **2/2** using unique fixtures in the task-owned disposable local `mazao_staff_names_test` database with migrations 001–016. Typecheck passes. Existing staff-security and PostgreSQL operational regression tests also pass **9/9** with sequential file execution. Broader aggregate acceptance is recorded with the integrated release evidence; no deployment or physical-device acceptance is claimed here.

## Boundaries

Historical snapshot names are evidence, so correcting a current staff name does not retroactively relabel older transactions. This slice does not change stock-count opened/posted actor-name projections or shift cash-movement actor-name projections; their current-profile versus historical-snapshot presentation policy remains separate work.
