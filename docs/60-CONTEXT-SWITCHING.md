# Authenticated outlet context switching

## Server authority

`GET /api/v1/auth/assignments` lists only active logical workspace assignments owned by the current authenticated user. `POST /api/v1/auth/context` accepts only a `deviceId`; tenant, outlet and actor scope always come from server records.

The context command validates the session and selected assignment in a serializable transaction. It locks the current session and selected active user, membership, device, tenant and outlet rows, then updates the existing session's tenant/outlet/device scope and version. The token and CSRF secret remain unchanged, so a lost response can be recovered by reading `/auth/me`. A rejected assignment leaves the session untouched. The server records `AUTH_CONTEXT_SWITCHED` in the prior tenant/outlet audit stream with the target scope. No business command is replayed as part of a switch.

## Browser recovery and state boundary

Before showing choices, the client dispatches the existing unsaved-navigation guard and a POS guard. The POS guard asks before clearing a nonempty basket or payment details. The client then checks the current actor/device's unknown business commands, imports, password operations and unsent count drafts. Storage inspection failure blocks switching. Operators resolve the listed records or save their count draft to the server before retrying.

Immediately before switching, pending reads are aborted. An uncertain response triggers `/auth/me`; the client accepts the switch only if the server confirms the requested device. If the context cannot be confirmed, the old workspace is cleared and the UI requires sign-in. A successful context change resets navigation and receipt state and remounts workspace components under the new user/tenant/outlet identity. Other tabs hide the old workspace when a switch begins, then restore their session after the transition finishes.

The existing login flow still requires password verification before presenting multiple authorized assignments. Context switching reuses the active session; it does not claim a physical terminal identity. Device enrollment and revocation remain S02-04.

## Verification state

`npm run typecheck` passed for UI and API TypeScript. `npm run build` passed; artifact `index-BIxqB31C.js` is 540.70 kB (146.05 kB gzip), with 22 PWA precache entries (914.51 KiB). Vite's existing native config-loader and large-chunk warnings remain informational.

The focused browser regression passed locally (**1/1**) against intercepted authorized assignments, an unsaved POS basket and distinct source/target catalogs. The PostgreSQL API integration case is included but was not run locally because the disposable PostgreSQL service is unavailable and the stopped Docker environment must not be restarted. Do not use the named `mazao_truth` database. Exact-head hosted CI, isolated API/migration upgrade/rerun acceptance for migrations 026-028, real API/browser acceptance, and production release checks remain open. This is source/build/browser-fixture evidence, not deployment or full S02-03 acceptance.
