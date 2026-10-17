# Sprint 01 | Tenant, operator, assignment and command-recovery security

**Priority:** P0 · **Suggested effort:** 1–3 focused engineering days · **Depends on:** Sprint 00 core CI green.  
**Status at 17 Oct:** implementation exists on PR #18 but is not yet accepted in GitHub's complete pipeline; production `main` lacks the new generic recovery policy.

## Security goals

1. Only the actor who originated a command, in the correct tenant and authorized outlet/assignment, may read its stored result or replay its exact envelope, unless a separately designed delegated capability is explicitly introduced.
2. Permissions and capability status must be recomputed from current authoritative server state. Changing role, disabling a capability, revoking an assignment or session must not leave a stale right to inspect old sensitive results or post new commands.
3. Never mistake a server status-query `404` for proof that a secret or financial operation was never accepted. An unknown credential operation must remain fenced pending authoritative resolution.
4. A confirmed original command replay returns the original outcome **once** with no second effect, even if a shift is now closed or stock has changed.
5. Stored financial evidence, receipts, stock balances, audit and outbox must remain unchanged after a forbidden replay/read.

## Code audit map

- `apps/api/src/commandAuthorization.ts`: new `policies`, `requireCommandAuthority`, `requireCommandRecoveryAuthority`.
- `apps/api/src/app.ts`: `POST /api/v1/commands` replay branch, `GET /api/v1/commands/:commandId`, request preHandler, credential routes.
- `apps/api/src/identityAuthority.ts`: `revalidateOperator` at command time; retain original assigned outlet and role in validated scope.
- `apps/api/src/staff.ts`: membership/device updates, tenant row serialization, last administrator and open shift checks, session revocation.
- `apps/api/src/credentials.ts`: dedicated password writes, idempotent fingerprint key, accepted/unknown/replayed boundaries.
- `apps/api/test/command-recovery.integration.test.ts`, `apps/api/test/staff-security.integration.test.ts`.
- `src/services/commandJournal.ts`, `secretOperationJournal.ts`, `apiClient.ts`, `identityUi.tsx` and credential UI.

## Work package A: shared execution and recovery authority

- Inventory every currently supported `CommandEnvelope.type` by searching `commands.ts`, `staff.ts`, `configuration.ts`, `productImport.ts`, `credentials.ts`. Compare with every key in `commandAuthorization.ts`. Unregistered types must deny by default; do not leave aliases that allow stronger permissions on replay than at initial execution.
- Ensure `GET /commands/:id` performs tenant-scoped lookup and exact actor/outlet comparison without revealing whether a foreign ID exists; return sanitized 404 for unauthorized result discovery.
- Ensure `POST /commands` duplicate path checks **persisted** type and request hash, actor, tenant, outlet/assignment and current role. A forged replacement payload must not change the authorization policy. Preserve import-specific definite-rejection contracts only where already explicit.
- Check execution and recovery permissions are at least equally restrictive. Any payload-dependent checks (refund amount, current shift, target staff, management access) must be covered by either a documented recovery exception or an independent gate that never broadens privilege.
- Protect read-only `GET` responses against secrets in command-result JSON, including staff operations. Avoid logging credential payloads.

## Work package B: credential-operation fencing

- Existing `staff.password.set` and `auth.password.change` use protected password endpoints, **not** generic command payloads. Do not place passwords in URL, audit, logs, IndexedDB, queue, service-worker cache or sessionStorage.
- Review the still-separate credential fencing work carefully. It may require another migration that once used number `017`, while PR #18 now uses `017_configuration_assets.sql`. Before integration, allocate an unused migration number (likely `018_...` if 017 is not applied anywhere), update the ordered manifest, and test fresh/upgrade/rerun.
- A timed-out password submission can have succeeded. Retain only command UUID/target/version/kind metadata and show 'Check original status'; no new command until definite resolution or explicitly documented safe fencing.
- After target password reset, server revokes target sessions; after own password change, server revokes current session. Do not show success or reopen privileged UI after revoked credentials.
- Do not rotate `CREDENTIAL_FINGERPRINT_KEY` during redeploy. This production secret anchors the credential idempotency fingerprint and needs controlled durable handling.

## Work package C: concurrency and adversarial checks

| Attack/edge case | Required server outcome |
|---|---|
| Cashier knows admin command UUID in same tenant | Sanitized 404; no outcome leak |
| Same user, different outlet/assignment | Deny status/replay unless explicitly authorized by a documented policy |
| Cross-tenant UUID | 404, no foreign data |
| Operator downgraded to role without permission | Deny even if original write was valid |
| Assignment/session revoked between authentication and command transaction | Deny new authority, preserve committed history |
| Duplicate original receipt/sale after till closes | Return original committed result, no second ledger/stock effect when current recovery policy permits |
| Replay with same UUID but modified payload | Idempotency mismatch / definite rejection; no new effects |
| Replay with another actor's device/session | Deny; retain original stored hash/result |
| Parallel last-admin membership/assignment changes | At least one usable admin remains; no HTTP 500 |
| Password accepted but network response lost | Never resend password from storage; resolve original status safely |

## Evidence to capture

- HTTP status + generic code (no secrets), current actor/outlet/tenant roles, number of row mutations in disposable fixtures; negative cases across manager/cashier/admin.
- `system.commands`, journal, stock, shifts, receipts, audit and outbox row counts/hashes before and after unauthorized probes.
- Target-specific frontend password inputs cleared on member change; no secret value in persisted browser journals.
- Test true session revocation after command authorizer has authenticated but before its transactional preflight, avoiding mock-only assertions.

## Completion criteria

- [ ] Authorization inventory exhaustively matches supported command types.
- [ ] Tests cover execution, status, exact replay, forged same UUID/different type, role downgrade and outlet switch.
- [ ] Zero unauthorized result disclosures and duplicate authoritative effects.
- [ ] Credential fencing/migration collision decided and documented, not silently skipped.
- [ ] CI/API/PostgreSQL/browser tests green, with no weakening of rate limits or last-admin guards.
- [ ] Prod untouched; security note documents remaining known limitations and threat assumptions.
