# Command recovery readiness and count draft protection

Date: **16 October 2026, Africa/Nairobi**. Scope: audit F05 and the unsaved-count portion of F12.

## Operator behavior

Receiving, full stock counts, hotel operations and till shifts now wait for both their server reads and the current operator/assignment's saved command inspection before enabling a new write. A slow IndexedDB open shows a checking message. A failed inspection keeps new actions disabled, explains the storage problem and offers **Retry recovery check** with a minimum 44px target.

An unresolved original command keeps new mutations and editable operation fields locked. Its status controls remain available, including inside delivery, count, hotel and cash-movement dialogs. Repeated activation is protected by a synchronous in-flight ref rather than relying only on a later React render. Hotel checkout takes this lock before its asynchronous shift lookup.

Every retry retains the original ID, timestamp, payload, device and expected versions. A status 404 can resubmit that exact original envelope; it does not generate a replacement command or erase uncertainty. If the browser cannot write recovery data before transport, the command stays in memory with the transport's explicit **not sent** message and a status/retry action. The operator can repair storage and retry that same envelope. No business success is inferred from a network or journal failure.

After a terminal confirmed/rejected/conflict outcome, the workspace inspects recovery again before reopening mutations. If another saved command exists for this workspace and assignment, it becomes the next unresolved operation. A failed rescan remains blocked and retryable.

The command journal retains its version-1 database/store and existing records. Failed or blocked opens no longer permanently cache a rejected connection promise: retry can open the existing database again after the browser condition changes. No journal is dropped, recreated or cleared by this change.

## Full-count navigation

An edited count prompts before leaving through the existing cancelable `mazao:before-navigate` event. Dismissing the prompt keeps the quantities/reasons intact. Explicitly accepting discards only unsaved screen edits; the durable server draft remains available when the operator returns.

Unsaved edits also install a native browser unload guard. An in-flight count operation blocks in-app navigation until its current attempt finishes, retaining its original command controls. A saved draft or a durably retained unresolved posting can still be reloaded and recovered. These guards do not rewrite a server count or discard a journal record.

## Implementation boundaries

- Shared hook: `src/hooks/useCommandRecoveryReadiness.ts`; shared accessible message: `src/components/common/CommandRecoveryReadiness.tsx`.
- Connected workspaces: `ProcurementWorkspace`, `BackendStockCountWorkspace`, `BackendHotelWorkspace`, `ShiftManagerView`.
- Journal change: reset only the failed connection attempt in `src/services/commandJournal.ts`.
- No HTTP contract, API client transport, server permission, financial/stock policy or database migration changed. Commands remain online-only; the journal remains recovery evidence rather than permission to transact offline.
- AppShell and staff/device recovery routing were not changed. That separate F12 routing work and F10 server recovery authorization remain outside this slice.

## Acceptance evidence

`e2e/workspace-recovery-readiness.spec.ts` contains 14 focused browser cases:

- Delayed inspection and failed-open/retry behavior for all four workspaces.
- Failed-open retry preserves an existing retained receipt; a 404 replays its complete original envelope exactly.
- Temporary quota/write failure sends no business request. Rapid repeated activation creates one retained operation, and rapid status activation retries its exact original envelope once, for each workspace.
- Unsaved count navigation can be canceled, unload is guarded, and explicitly leaving still permits reopening the saved server draft.

`e2e/integration/count-recovery-readiness.spec.ts` uses actual Chromium, API and PostgreSQL at **1024 x 600**. It verifies:

1. A quota failure before count-draft transport creates no server command.
2. Repairing storage and checking the original ID submits that same save once.
3. Reload restores the saved count quantity and reason.
4. Losing the response after a real posting commit exposes recovery inside the review dialog.
5. Reload and status lookup confirm that posting with exactly one adjustment/audit event and the correct final quantity/value.

Observed checks:

| Check | Result |
| --- | --- |
| Existing plus new browser regression | **38 passed**, 2.5 minutes, before two final defensive guard refinements. |
| Final focused recovery browser cases | **14 passed**, 28.7 seconds. |
| Final actual API/PostgreSQL count browser journey | **1 passed**, 14.8 seconds. |
| UI/API TypeScript | `npm run typecheck` passed. |
| Production PWA | `npm run build` passed; existing Vite `__dirname` and terminal-color warnings remain. |

Local tests used temporary ports **3004/4104** and the explicitly owned disposable PostgreSQL 16 instance at loopback **55437**. Its existing migrated test database was retained; no hosted database, SSH or deployment was used. Temporary test configuration files are excluded from the committed slice.

The focused tests use real IndexedDB with controlled open/quota failures and mocked business API outcomes; the separate count journey supplies real server/database recovery evidence. Chromium service workers are blocked by the existing test configurations. Full installed-PWA upgrade/storage-loss acceptance, all business workflows, the full accessibility/viewport matrix and physical hardware remain broader release gates.
