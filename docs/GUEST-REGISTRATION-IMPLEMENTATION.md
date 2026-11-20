# Guest registration and arrival integration

Implementation branch: `feat/guest-registration`, based on main `0de9799`.

Scope: the first delivery in [the approved plan](GUEST-REGISTRATION-AND-CHECK-IN-PLAN.md), with identity verification required for every adult occupant. Validation evidence is recorded below as checks complete. Production activation is a separate release step.

## Operator workflow

Reservations capture stay dates, adult/child counts, a primary guest and structured booking contact. Booker and staying guest are separate roles. Extra contact, nationality, residence, emergency contact, company/reference and arrival details use progressive sections.

Reserved arrival opens a prefilled guest registration review. Walk-ins use the same registration editor. Every adult needs an accepted document type, number, issuing country and receptionist verification before the server permits check-in. Children link to an adult in the same party. A private draft saves guest information; confirmed check-in creates the stay/folio and occupies the room exactly once.

Authorized guest-detail corrections create revision evidence with a reason. Full identity reveal uses a controlled review-purpose selection recorded in the audit, and reveal/retention have separate permissions. Ordinary lists, housekeeping, finance, receipts, command responses and audit/outbox events do not expose full identity numbers.

## Identity encryption configuration

These are API-only settings. Keep them out of PWA build variables and Git:

- `GUEST_IDENTITY_KEYS`: a JSON object mapping key version to an independently generated 32-byte key encoded as 64 hexadecimal characters.
- `GUEST_IDENTITY_ACTIVE_KEY`: the version used for new encrypted identity values.

The existing stable `CREDENTIAL_FINGERPRINT_KEY` is also required for keyed private-operation replay fingerprints. It is separate from the versioned encryption keys.

Generate the key material through the deployment's secret-management procedure. Set the map and active version in the restricted API environment, then review the property's registration notice and retention settings before capturing identity. Missing usable encryption configuration must fail private ID capture safely.

Rotation adds a new version to the map and selects it as active. Retain older versions while any retained occupant or registration revision needs them. Back up the keys separately from database backups and verify decryption during an isolated restore. Replacing the only old key loses access to existing encrypted records.

The deployment Compose examples pass these settings to the API. Empty placeholders permit existing services to start, but do not configure identity capture. CI/browser keys are disposable test values and must never be used for production.

## Private input and recovery

Guest registration save/correction uses a dedicated protected-input path. Before transmission, the browser stores only safe operation metadata: original command identity, tenant/actor/outlet/device scope, registration ID and expected version. Storage failure prevents transmission. Raw identity values are held only in form memory. The private request includes the captured scope, and the server compares it with both the authenticated request and revalidated transaction authority; a cookie/workspace race cannot redirect private input to another context.

Status/reconciliation can use another current authorized device assignment for the same actor and outlet. The original operation's descriptor is retained; cross-device recovery never resends a private body from durable browser storage.

A lost private response is recovered through the server's canonical operation result. If the original input was never received, reconciliation records a durable rejection/fence for that same operation before re-entry is offered. A late original cannot defeat the fence. Saving new input uses a new operation only after the earlier outcome is terminal. This uses the existing credential-fencing design: immutable operation/registration/version metadata and a shared authoritative lock, rather than an extra server-issued input-slot endpoint.

Reservation and check-in commands contain a registration reference and expected versions. Their ordinary durable journal preserves the exact original envelope, without identity numbers. Unknown outcomes retain the original command and use status lookup/replay.

## Migration and compatibility

Migration `030_guest_registration` adds private registration/occupant/revision/operation records and nullable room capacity. Applied migrations remain unchanged. Existing reservations and active stays retain their original fields and checkout path. Their missing registration is represented honestly rather than fabricated or auto-verified.

Known legacy command shapes remain admissible for canonical replay. New check-ins must satisfy the every-adult registration rules. Existing rooms with unknown capacity display a transition warning; explicit versioned capacity edits validate current/future allocations.

Guest registration saves, corrections, policy, capacity and retention operations do not post stock or financial entries. Existing hotel calendar, concurrency, folio and checkout tests are regression gates. Retention removes the new private identity/contact payload and revisions after the approved period; existing guest-name billing anchors and canonical historical command outcomes remain separate evidence.

An older API can read the additive schema but cannot enforce the new every-adult registration policy. Release rollback planning must pause hotel writes while an older API is in service, retain migration 030 and the encryption keys, and verify a forward fix before reopening arrival operations. Treat schema compatibility and policy-enforcement compatibility as distinct release checks.

## Validation record

Checks are in progress. Required evidence includes:

- TypeScript and production PWA build.
- Fresh migration, checksum-safe rerun and upgrade from migration 029.
- Authenticated PostgreSQL API tests for every-adult identity, guardians, scope/role/device, encryption, canonical replay, protected-input fencing, corrections and retention.
- Existing hotel date/checkout and broad API regressions.
- Browser reservation, reserved/walk-in arrival, masked edits, local storage privacy and unknown outcome recovery at compact desktop/mobile and Chromium/Firefox.
- Exact-commit hosted CI and API container acceptance before any release claim.

Returning-guest CRM/profile merging, registration exports/printing and document attachments are subsequent plan slices.
