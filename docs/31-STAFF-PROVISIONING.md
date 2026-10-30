# Staff provisioning and workspace access

Use the server-backed **Manage → Staff** and **Workspace assignments** screens, or the authenticated API, to provision each operator as an individual identity. Staff creation, password setup, and workspace assignment are separate operations. They do not enroll or pair a physical device.

## Before provisioning

- The API must have `CREDENTIAL_FINGERPRINT_KEY` configured. Generate a value with `openssl rand -hex 32`; it must be exactly 64 hexadecimal characters. Store it as a production secret in `/srv/mazao/.env` with owner-only permissions. Keep the same value across restarts, releases, and restores. Changing it can prevent idempotency checks from recognizing prior credential operations. Never put the real value in source control or support logs.
- Only an operator with the server `staff.manage` permission can create identities or set another member's initial password. Workspace assignment requires `devices.manage`. These are server checks; hiding a control in the UI does not grant or remove authority.
- Use the staff directory to read the server's current `credentialVersion` and the tenant's active outlets. Do not invent identifiers or reuse command IDs.
- Keep at least one active owner/admin with a working password and an active workspace assignment to avoid locking the business out.

## Provision an operator

1. **Create an identity and membership.** Submit `staff.member.create` with the unique email, display name, and supported role. The transaction creates a user and tenant membership, returns `userId`, and leaves `hasCredential` false. Passwords are not accepted in generic command payloads.
2. **Set an initial password.** Send `POST /api/v1/staff/{userId}/password` using the authenticated session and CSRF protection. Supply `protocolVersion: 1`, a fresh UUID `commandId`, `expectedVersions` containing `credential:{userId}` with the current credential version (new members start at version 1), and `newPassword` of 12–256 characters. The server requires the configured fingerprint key, checks the member belongs to the operator's tenant, and records the operation through its idempotent audit/outbox path. Never send the password in a URL, generic command, or log.
3. **Assign a workspace.** Submit `devices.assignment.create` with `assignedUserId`, an active `outletId`, and a meaningful label such as `Front Desk POS`. This creates an authorized logical workspace assignment. It does not bind access to a specific physical computer, tablet, or printer.
4. **Verify access with the operator.** They sign in with their email and initial password. The API verifies credentials before returning workspace choices. If they have multiple active assignments, they choose one after authentication; only their authorized tenant/outlet assignments are offered. Verify the selected tenant/outlet and role-limited operations, including a denied operation outside the role's permissions. Ask them to change the initial password through **My account**. Automatic first-login expiry is not implemented.

Credential changes increment the credential version and revoke the target's existing sessions. On a successful self-service password change, the current session is also revoked and the operator must sign in again. If a command result is unknown, query/recover the original command using its original ID; do not create a second credential command until its status is resolved.

## Current roles

The API uses fixed, coarse permission sets. These descriptions summarize current server grants; they are not custom role templates.

| Role | Current server scope | Availability / limits |
| --- | --- | --- |
| Owner / Admin | Staff and workspace administration, configuration, catalog, inventory, sales, shifts, finance, customer accounts, and hospitality permissions | The permission maps are currently identical. Protect these accounts carefully. |
| Manager | Configuration read, catalog, inventory receiving/counting/approval, sales/refunds, shifts, finance, customers, and hospitality | Cannot manage staff, assignments, or business configuration. |
| Cashier | Sales, opening/closing own shift, customer viewing, charges, and settlements | No staff, inventory management, or finance review permission. |
| Storekeeper | Inventory receiving and counting | Count posting/approval is not included in this role. |
| Accountant | Finance and customer account read access | No posting or staff administration permission. |
| Receptionist | Hotel front desk and shift open/close | Available only when the tenant has the hospitality capability. |
| Housekeeper | Hotel housekeeping | Available only when the tenant has the hospitality capability. |

Restaurant roles such as waiter, cook, and bartender are not assignable through staff provisioning today; their current permission sets are empty. Custom roles and per-permission editing are not implemented. The frontend may show a role label in future contexts, but only server-accepted roles and permissions authorize operations.

## Related implementation

- Staff directory and workspace assignments: `GET /api/v1/staff`, `GET /api/v1/devices`.
- Credential endpoints: `POST /api/v1/staff/{userId}/password` and `POST /api/v1/auth/password`.
- Never-received/lost-response recovery: metadata-only `POST /api/v1/auth/password/reconcile`; see [migration 022 and terminal fencing](50-CREDENTIAL-OPERATION-FENCING.md). A 404 alone never clears an operation.
- Directory/assignment/session continuation and complete server search: [directory contracts](54-DIRECTORY-CONTINUATION.md) and [staff UI acceptance](53-STAFF-SESSION-HISTORY.md).
- API implementation and permission map: `apps/api/src/staff.ts`, `apps/api/src/credentials.ts`, and `apps/api/src/contracts.ts`.
