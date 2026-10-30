# Credential operation fencing - S00-03

Date: 20 October 2026, Africa/Nairobi. Status: implemented and tested locally against disposable PostgreSQL; production not changed.

## Operator outcome and fixed gap

G01 left password operations pending forever when the browser retained recovery metadata but the original request never arrived. A status 404 cannot establish that a delayed request will never arrive, so deleting that metadata or offering a local clear button would permit an unsafe replacement request.

The password panel now sends metadata-only reconciliation for the original operation ID. If the original request already committed, reconciliation returns its canonical stored result. If it never arrived, reconciliation records a terminal rejection with code `CREDENTIAL_OPERATION_FENCED`. A late original with that ID cannot change the credential. The panel unlocks a new operation only after it receives a complete terminal envelope matching the original ID. Password fields remain empty after submission.

## Contract, authority and atomicity

`POST /api/v1/auth/password/reconcile` accepts exactly:

```json
{
  "protocolVersion": 1,
  "commandId": "original-operation-uuid",
  "kind": "staff.password.set",
  "targetUserId": "original-target-uuid",
  "expectedCredentialVersion": 1
}
```

`kind` is `staff.password.set` or `auth.password.change`. The example identifier strings describe UUID fields and are not valid request identifiers. Passwords, secret fingerprints, actor overrides and extra fields are rejected. This endpoint uses the ordinary authenticated, same-origin, CSRF-protected API path; it is online only.

Both original credential execution and reconciliation revalidate the live session, membership, role, assignment and outlet inside a serializable transaction. Both lock the same tenant row before reading or inserting the command. Therefore the original either completes first and returns its stored result, or reconciliation commits the fence first and every delayed original is rejected. Serialization/deadlock retries remain in the existing database unit of work.

The original actor and outlet own recovery, and recovery checks the persisted command type against current permissions. A different actor/outlet receives 404; revoked reset authority receives 403; a revoked assignment/session receives 401. Another tenant cannot inspect the command or fence a target outside its membership. A self-change requires the target to be the current operator. Staff reset cannot be used to bypass self-change verification.

Existing command metadata must match the submitted kind, target and expected version. Mismatch returns 409 without replacing the original evidence. Original-body fingerprint mismatch also returns 409 and keeps local recovery metadata.

## Evidence and secret boundary

Migration `022_credential_operation_fencing.sql` adds `system.credential_operations`, linked to the tenant-scoped original command. It retains target UUID, expected credential version and whether the operation was fenced. Submitted target UUID is retained even for a rejected original command; membership validation remains in the domain and never becomes a foreign-key error.

A fence occupies the original `system.commands` ID with terminal `REJECTED` status, empty request hash and the safe public rejection code. It emits one `credential.operation.fenced` audit/outbox event with metadata only. It does not update a password, credential version, session, financial record or stock record. Successful original changes retain their existing keyed request fingerprint and Scrypt password storage behavior; no replayable password body is stored.

The existing IndexedDB version 1 journal remains compatible and keeps its explicit metadata-only projection. The API client retains unknown evidence after HTTP errors, malformed/incomplete responses, mismatched IDs and unsupported recovery endpoints. Confirmation must include the original target user, a safe positive credential version, a safe nonnegative session-revocation count and the self/staff operation's correct reauthentication flag. Rejection/conflict needs a nonempty code; idempotency mismatch remains unknown. Both outer and any nested command IDs must match. Only validated terminal responses remove the original metadata. There is no local discard operation.

## Upgrade and older clients

Applied migration files 001-021 are unchanged. The new migration neither rewrites old commands nor fabricates descriptors for them. Legacy commands without a descriptor recover using their persisted actor/outlet/type and original result. Upgrade and rerun acceptance compares existing commands and posted stock/journal/receipt evidence byte-for-byte.

Older clients can still use `GET /api/v1/commands/:commandId`: a fence appears as ordinary terminal `REJECTED` evidence. Their delayed originals encounter the occupied command ID and cannot execute. Older servers without the reconciliation route leave current-client metadata pending; restoring compatible server access is necessary before the UI allows another request. Downgrading an API must preserve command rows and must never erase fences.

After a confirmed self-change signs out sessions, the operator must sign in again before recovering a lost acknowledgement. They use whichever password actually succeeded. Recovery then uses the same original operation ID, without resending its password.

## Local acceptance evidence

Executed against disposable Docker PostgreSQL with each API test file isolated by `apps/api/test/support/isolate-database.mjs`:

```powershell
node --import ./apps/api/test/support/isolate-database.mjs --import tsx --test apps/api/test/credential-fencing.integration.test.ts apps/api/test/staff-security.integration.test.ts apps/api/test/command-recovery.integration.test.ts apps/api/test/product-import-upgrade.integration.test.ts
```

Observed: **26 passed, 0 failed, 0 skipped**. The new credential suite covers a request dropped before arrival, repeated reconciliation, delayed original, old-client status lookup, committed change/lost response, descriptor-free legacy result, concurrent arrival/reconciliation, cross actor/outlet/tenant isolation, role and assignment revocation after HTTP authentication, self-change reauthentication and malformed/secret-bearing metadata. Original password requests also reject array envelopes, coercible command IDs, array versions, extra version keys and unknown fields before retaining a command. Existing staff tests also verify password hashing, exact replay, current authority and sanitized actual structured logs. Upgrade/rerun acceptance preserves existing commands and posted business evidence through migration 022.

Final fresh-build `e2e/account-access.spec.ts` acceptance: **10 passed** in Chromium, including keyboard/responsive account access, retained unknown metadata without secrets, matching-ID fencing before a replacement operation, HTTP-rejection retention, session revocation and password-target switching. The tenth test covers an empty submission confirmation and malformed recovery confirmations (wrong target, invalid version/revocation count, wrong reauthentication flag and empty rejection code). The shared run used `--output=dist-artifacts/playwright-s00-directories` to keep artifacts separate from concurrent real-API tests. Credential fixtures supply complete canonical responses and the stock-policy read; the fence notice assertion is scoped separately from session-history status.

The Firefox mobile account check exposed bounding-box serialization of the existing 44px close control as `43.99999237060547`. The test normalizes dimensions to 0.001 CSS pixels before applying the same 44px minimum. The runtime minimum and keyboard/focus behavior are unchanged; this corrects a numeric assertion without weakening the target-size requirement. Firefox rerun acceptance is recorded with the final browser evidence.

On **25 October 2026, Africa/Nairobi**, the corrected cashier account case was rerun against the unchanged S00 static build dated 20 October: **1 passed** in Firefox. Command: `npx playwright test e2e/account-access.spec.ts --browser=firefox --grep 'cashier can reach' --output=dist-artifacts/playwright-s00-firefox-cashier-2026-10-25`. This closes the specific numeric-assertion failure; it does not reclassify the earlier 25/26 Firefox run as a full pass.

These checks do not establish hosted CI, deployed schema/API identity, installed-PWA upgrade, physical hardware or production acceptance.
