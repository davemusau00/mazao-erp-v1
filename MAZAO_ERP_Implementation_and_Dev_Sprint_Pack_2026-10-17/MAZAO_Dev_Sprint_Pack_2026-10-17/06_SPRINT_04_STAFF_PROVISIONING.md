# Sprint 04 | Finish People & Access, operator provisioning and role transparency

**Priority:** P1 · **Suggested effort:** 2–5 focused engineering days · **Depends on:** CI, security and bounded reads.  
**Status:** Server-backed Staff and Assignments are in production; PR #18 adds a guided four-step setup and fixed-role access matrix. The candidate still requires hosted browser and human first-use acceptance.

## Actual supported identity model

- `identity.users`: global unique identity and password credentials.
- `identity.memberships`: tenant-scoped role and display name, active flag and version.
- `identity.devices`: logical operator ↔ outlet workspace assignment. **Not a hardware-bound device enrollment or printer pairing mechanism.**
- `identity.sessions`: revocable sessions scoped to active assignment/tenant/outlet. Password change/reset revokes relevant sessions.
- `ROLE_PERMISSIONS` in `apps/api/src/contracts.ts`: fixed coarse backend grants, **not editable custom RBAC templates**.
- Admin/owner have staff and assignment write rights; manager has relevant read access; cashier lacks staff administration. Storekeeper can count but cannot approve/post stock counts.
- Roles `waiter`, `cook`, `bartender` are currently not assignable by the staff API because supported server workflows/permissions are absent. Receptionist/housekeeper require hospitality capability.
- The documented production secret `CREDENTIAL_FINGERPRINT_KEY` is required for credential operations; it must remain stable across releases and restores.

## User journey to make unmistakable

1. **Create identity and tenant membership:** display name, unique email, allowed fixed role. Output identity ID and `hasCredential=false`.
2. **Set initial password:** protected credential endpoint, server-provided `credentialVersion`, password 12–256 chars, exact command ID. Never store password in reusable browser journals or URLs.
3. **Create logical workspace assignment:** active outlet, assigned member, human-readable label such as `Front Desk POS`; server checks `devices.manage` and tenant-scope version.
4. **Verify actual sign-in:** operator authenticates with assigned account, selects a valid assignment if several, and server confirms active session. Status shows `ready`, `awaiting first sign-in` or concrete incomplete reason.

New PR #18 UI uses `sessionStorage` to remember **only** user ID and wizard step. Server, not browser state, is authoritative about password/assignment/session completion. Confirm a switch to another staff member cannot carry over unsaved credentials.

## UX requirements and design-preservation rules

- Preserve MAZAO's existing dark shell, typography, spacing, borders, control styles and layout. Reorganize discoverability only where directly beneficial; do not remove existing Staff/Assignments tabs or break URLs/navigation.
- Top-level Manage can show a concise **People & Access** summary linking to Staff, Assignments, effective roles, sessions and My Account. Keep useful existing sections intact.
- Staff directory cards show: full display name, email, fixed role, membership state, credentials present/missing, number of active assignments, active sessions, version and honest next action.
- Selected member detail and credential panel must be `key`ed/scoped by `userId`. On target switch or unmount: clear all password inputs and stale notifications. Block navigation while secret POST is in flight.
- Distinguish user disabled vs no password vs no assignment vs expired session vs wrong role. Avoid generic 'access settings missing'.
- Progressive setup with retry/resume after reload; wizard cannot claim complete solely because local step says complete. When server marks session active, confirm original operator and outlet.
- Roles/permissions display is **read only** until tenant-scoped custom RBAC design, schema, authoritative middleware and negative tests exist. Never offer decorative checkboxes that imply grant management.
- When Manager opens read-authorized section, show controls read-only instead of a broken wizard. For cashier, provide own My Account sessions/password only, not unauthorized staff directory.
- Pagination/search is required for >500 members before scaling to large tenants; current API returns at most 500. Scope to future release if not needed for pilot, but show that as a limitation.

## API and code tasks

- `GET /api/v1/staff`, `GET /api/v1/devices`, `GET /api/v1/staff/:userId/sessions`, `GET /api/v1/auth/sessions`: honor roles, current server state, tenant/outlet scope, sensible empty values, request IDs and bounded reads.
- Commands `staff.member.create/update/set_active`, `devices.assignment.create/update/revoke`, `staff.sessions.revoke`, `auth.session.revoke`: keep optimistic versioning, tenant transaction lock and last-admin/open-shift protection.
- `POST /api/v1/staff/:userId/password`, `/auth/password`: protected CSRF, no ordinary command payload secret, idempotent accepted/replayed response handling, version and session revocation.
- Password target-specific UI in `PasswordOperationPanel.tsx`; session details in `OperatorSessionsPanel.tsx`; recovery in `identityUi.tsx` and `useCommandRecoveryReadiness.ts`.
- Audit event and outbox must identify who changed whom, in which tenant/outlet, before/after role/activity/assignment, reason, not password contents.

## Required matrix

| Actor | Staff view | Staff write | Assignment view/write | Own account | Expected |
|---|---|---|---|---|---|
| Admin / Owner | yes | yes | yes/yes | yes | Full staged provisioning + last-admin limits |
| Manager | yes | no | yes/no | yes | Explain restricted edits, 403 on forged POST |
| Cashier | no | no | no/no | yes | Own sessions/password only |
| Storekeeper | no | no | no/no | yes | Can count, cannot approve count |
| Receptionist | role-dependent | no | no/no | yes | Hospitality capability rules honored |
| Cross-tenant actor | no foreign data | no | no/no | own only | Sanitized 404/403, no enumeration |

## Acceptance matrix

- [ ] Brand-new staff account created, initial password set, active outlet assigned and first actual sign-in completed (real API+PostgreSQL+browser).
- [ ] Account without password or without assignment cannot sign in and the UI shows exact missing step.
- [ ] Role change impacts effective permissions immediately; manager/cashier forged writes are denied by API.
- [ ] Revoked membership, assignment or credential invalidates active sessions and blocks subsequent operations.
- [ ] Two-admin simultaneous removals/transfers cannot strand the business; open till blocks reassignments where applicable.
- [ ] Changing selected person during password edit clears secret input; pending requests cannot target the wrong account.
- [ ] Interrupted password POST preserves metadata-only original-operation recovery; no password persisted in logs/storage.
- [ ] Server-read failure exposes retry with bounded state; Staff/Assignments still load even if `/configuration` is down.
- [ ] Keyboard/mobile/tablet usability, accessible labels and visual parity snapshots pass without generic redesign.
- [ ] Verified with owner/admin, manager and cashier accounts in disposable data and a controlled pilot walkthrough after release.

## Explicit non-goals

Custom per-permission editing, hierarchical job roles, branch-defined grants, first-login mandatory expiry, HR/payroll, hardware pairing, printer enrollment and restaurant waiter/cook/bartender operational grant sets. Put these on the full-v1 roadmap only when server workflows exist and an authorization model is reviewed.
