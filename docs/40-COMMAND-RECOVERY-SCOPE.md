# Command status and replay authorization

This slice addresses audit F10. A command UUID identifies recovery evidence; possessing it grants no authority to read another operator's result or bypass current permissions.

## Recovery policy

Every status lookup and replay requires a currently active authenticated identity, membership, session, outlet and workspace assignment. The current tenant comes from that session. The command must belong to the same original actor and outlet, and the actor must still have the command's current server permissions and enabled capabilities.

The original actor is recorded in `system.commands.actor_id`. Outlet scope comes from the command's recorded `device_id` and its tenant-scoped workspace assignment. Current assignment APIs can change a label or assigned operator, but cannot move an existing assignment to another outlet. A future relocation feature must preserve immutable command-origin scope before it is enabled.

- **Status:** another tenant, actor or outlet receives HTTP 404 without the stored response. The same actor can sign in again, including through another active assignment in the same outlet, and read authorized status.
- **Ordinary exact replay:** the request must retain its original command ID, tenant, device, occurred-at value, expected versions and payload. The current session must still use that original assignment: existing device preflight rejects another assignment before lookup. Use status lookup from an authorized same-outlet assignment to resolve an outcome without resubmitting. The server never rewrites the envelope, device or hash to manufacture a match.
- **Credential replay:** dedicated password endpoints retain their existing secret fingerprint and actor protections. Their stored results now also require the original outlet and current authority; a new active session in that same outlet can recover after a password change revoked the old session. Passwords are not copied into ordinary command envelopes or status responses.
- **Authority loss:** a revoked session/assignment is rejected with 401. Role loss is rejected with 403 `FORBIDDEN`; a removed operational capability is rejected with 403 `CAPABILITY_DISABLED`. Original stored outcomes remain intact. This policy does not grant administrators a general override to read another actor's command result.

Ordinary scope violations on replay return HTTP 403. Import replay preserves its existing HTTP-200 `REJECTED` envelope for permission/scope/capability denial; status uses normal HTTP errors. Dedicated credentials preserve their existing 404 for another actor. These denials never replace the canonical stored outcome.

## Shared command authority

`apps/api/src/commandAuthorization.ts` defines the baseline used by new execution, stored-result replay and status lookup. Recovery uses the **persisted command type**, never the caller's replacement type. Unknown stored types deny recovery. Unsupported new command types continue to produce the versioned rejected-command outcome.

| Commands | Current permissions | Capabilities |
| --- | --- | --- |
| Product create and CSV validation/revalidation/apply | `catalog.manage` | inventory |
| Receive stock | `inventory.receive` | inventory |
| Open/save count | `inventory.count` | inventory |
| Post/cancel count | `inventory.count.approve` | inventory |
| Open / cash movement / close shift | `shift.open` / `shift.payout` / `shift.close` | commerce |
| Settle / refund sale | `commerce.sell` / `commerce.refund` | commerce and inventory |
| Create/update customer account / collect repayment | `customers.manage` / `customers.settle` | commerce |
| Create room | `hotel.manage` | hospitality |
| Reservation/cancel/check-in/checkout | `hotel.frontdesk` | hospitality |
| Mark room ready | `hotel.housekeeping` | hospitality |
| Business/outlet/capability configuration | `config.manage` | None |
| Staff membership and managed session changes; initial/reset password | `staff.manage` | None |
| Workspace assignment changes | `devices.manage` | None |
| Own session revoke / own password change | Active original identity | None |

Payload-dependent gates remain inside domain services, including customer-account charging and opening-import stock receipt. Their currently assignable server roles grant those additional permissions alongside the baseline; custom grants are not introduced here. Any future granular grant system must extend recovery's recorded authority requirements before enabling a combination that separates those permissions.

Status revalidates identity and checks scope/authority inside one SERIALIZABLE transaction. Replay locks the original command, revalidates current authority within its transaction, checks the original scope and hash, then returns the persisted result. Staff's tenant access-change serialization and import/credential restrictions remain in force. New execution uses the same identity revalidation service and shared baseline.

## Atomicity and compatibility

Confirmed replay does not repeat the original stock, money, shift-open, expected-version or other domain-state checks. Those conditions may legitimately have changed since the original transaction. Only recovery authorization and exact identity/content are rechecked. No new stock movement, tender, journal, audit/outbox evidence or business command is created by returning a confirmed result.

This is an online authorization change. It introduces no offline execution, migration, contract envelope rewrite, browser journal change or API-client change. Existing same-actor/same-outlet recovery remains supported. A client previously relying on another actor's command result or obsolete permissions now receives a denial. Runtime rollback uses a prior compatible API image without changing stored command evidence; that also restores the earlier, weaker authorization behavior and requires a deliberate security decision.

## Acceptance evidence

The PostgreSQL adversarial suite `apps/api/test/command-recovery.integration.test.ts` checks:

- Other actors, outlets and tenants; fresh sessions; alternate same-outlet assignment status; unchanged original-assignment replay preflight.
- Role, capability, session and device revocation **after HTTP authentication but before the command/status transaction**, proving transaction-time revalidation.
- Replacement submitted types cannot borrow self-service authority to reveal a stored catalog/staff result; unknown stored types deny by default.
- Staff membership, workspace assignment, credential and self-session metadata outcomes obey the same scope. Dedicated credential replays cannot cross outlets.
- A completed cash sale replays after its shift closed and stock was exhausted, returning the original outcome without repeating effects.
- Stored command hashes/results and product/movement/stock/order/payment/journal/audit/outbox controls remain unchanged after denied recovery or confirmed replay.

Local acceptance on 16 October 2026: focused PostgreSQL cases passed **8/8**; standard parallel `npm run test:api` passed **76/76 with zero skips**; UI/API typecheck passed; `npm run test:integration` built the PWA and passed **10/10 real browser/API/PostgreSQL cases**, including existing original-command recovery and staff credentials. The task-owned disposable databases were `mazao_login_test` and `mazao_configuration_test` in the dedicated finishing-test PostgreSQL container; no hosted database or production deployment was used. The exact submitted commit still requires hosted CI acceptance.
