# Account self-service and credential target safety

Date: 2026-10-16. This slice addresses audit findings F04 and F07. It does not deploy a release or change the API, permission map, database schema, or credential recovery protocol.

Every authenticated operator can open **My account** by selecting their identity in the application header. This includes cashier, receptionist, manager, and roles without Manage access. The dialog shows the current business/outlet/role, the operator's own sessions, and the existing protected password-change form. It does not require or request a staff-directory permission.

The session list uses `GET /api/v1/auth/sessions`; self-session sign-out submits the existing versioned `auth.session.revoke` command. Password change uses `POST /api/v1/auth/password`, CSRF protection, and the credential version supplied by the server. A confirmed password change revokes existing sessions and returns the operator to sign-in. Current and new passwords are cleared from the form before the request and never written to the command journal. The existing private recovery journal stores operation IDs, identity scope, versions, and state only.

In **Manage → Staff**, selecting a different operator remounts that operator's credential and session panels. Entered passwords, password visibility, errors, and conflict state therefore cannot carry into the new target. Operator selection and refresh are disabled during a password request. Workspace navigation, management-section changes, opening another account panel, and account-dialog dismissal are blocked until an active password submission/status check finishes. A browser departure receives the native unsaved-operation warning. Once a response is unknown, the operator can close the dialog or select another staff record; reopening the original target restores its retained operation reference without restoring any password.

The existing OLED surfaces, blue actions, responsive dialog, keyboard focus trap, Escape dismissal, and focus restoration are retained. The identity trigger and dialog close control have at least a 44px touch target, including desktop sizes.

## Acceptance evidence

- `npm run typecheck` and `npm run build` pass.
- The complete mocked-API Playwright suite passes **31/31**, including the seven account tests. The dedicated PostgreSQL/browser account journey passes **1/1** against the disposable local test database. Test-only runner overrides used PWA port 3003 and API port 4103 to avoid other worktrees; no runner override or disposable credential is part of the commit.
- `e2e/account-access.spec.ts` covers cashier/receptionist/manager access without staff-directory requests, keyboard opening/Escape/focus restoration, 390×844/1024×600/1280×720 layouts and 44px controls, correct credential version and CSRF, active-request dismissal/navigation protection, unknown password outcome recovery after closing/reopening, absence of passwords from IndexedDB metadata, versioned self-session revocation, and staff target clearing/locking.
- `e2e/integration/account-access.spec.ts` uses a uniquely provisioned disposable PostgreSQL tenant and a cashier identity. It opens My account, revokes a second browser session, confirms persisted revocation, changes the password, checks the credential version and confirmed command rows, rejects the old password, and signs in with the new password. It does not truncate or reuse another test's records.
- Screenshot artifacts from the account tests capture the three sizes above. These are regression evidence, not approval of the entire seven-viewport UI parity or a completed screen-reader/contrast/hardware review.

## Remaining credential recovery gap (F08)

A password request can be retained locally but never reach the API. The current status lookup then returns 404, and the private operation remains pending. The UI continues to block a new password command for that target and offers another status check. This slice deliberately does not discard that evidence or invent a new operation ID. A separate server-backed reconciliation design is required to distinguish an operation that never arrived from one still executing and allow a safe resolution without retaining or replaying a secret.

Automatic first-login password expiry, physical workstation pairing, custom role grants, and a full accessibility/visual acceptance matrix remain outside this slice. No production or physical-device acceptance is claimed.
