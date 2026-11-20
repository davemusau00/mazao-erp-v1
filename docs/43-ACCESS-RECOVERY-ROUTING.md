# Scoped navigation from command recovery

This slice completes the access/account navigation portion of audit F12. The count draft navigation and recovery-readiness safeguards are a separate change. It preserves the existing OLED surfaces, administration cards, navigation and access panels.

## Operator behavior

- `Open workspace` for staff membership commands opens Manage > Staff and selects the original operator. Staff session revocation also selects that operator before restoring the session-command evidence. An absent original operator is explained; another directory entry is not substituted.
- Workspace assignment commands open Manage > Assignments and identify the original assignment using its current server record. A missing assignment is explained without discarding the retained command.
- Own-session revocation opens My account for any signed-in role. It does not require Manage or staff-directory access.
- The clicked command ID takes priority over another retained command of the same kind. The existing status and explicit original-command retry controls retain their existing transport and server authorization.
- Configuration recovery opens the corresponding Business, Outlet and receipts, or Capabilities section and selects the clicked original settings command.
- Opening a destination only changes navigation and reads current server records. It does not submit, resend, authorize or otherwise execute a business command.

## Authority and recovery boundary

`src/app/commandRecoveryRouting.ts` is a deny-by-default mapping of recognized command types to destinations and current UI permission/capability requirements. The shell derives the route from that table, not from a payload URL. A retained record must match the current actor, tenant and workspace assignment before it can reopen a module. The API remains the authority for every read, status request and retry; this UI mapping is not an authorization grant.

Role loss, a disabled capability, an unsupported command type or another workspace assignment disables the open action and explains why. Existing retained evidence remains in IndexedDB. Actor and tenant filtering prevent another operator's records from appearing in the current list. There is no automatic resend, offline sale queue, credential transport change or migration in this slice. Password operations remain in their separate secret-free recovery journal.

The shell publishes a typed navigation request through a context scoped again against the current session. Manage consumes the selected section without a second discard prompt. Shared identity recovery matches the original command ID and rejects a stale asynchronous journal read when its target or navigation request changes. Staff and assignment forms inspect only their corresponding command kinds; operator sessions retain their own target-user scope.

The existing unsaved-navigation guard can cancel the transition. On accepted navigation, a discarded settings draft resets from the loaded server configuration once. The recovery center traps keyboard focus, closes with Escape, restores focus to its opener, and uses controls at least 44 pixels high. The destination retains its standard accessible account/access panels.

## Verification

The focused browser acceptance is `e2e/recovery-routing.spec.ts`. It uses actual IndexedDB retention and explicit HTTP read/status fixtures. Every navigation journey observes all API POST requests and requires zero. It covers multiple retained command IDs, exact operator and assignment targets, self-service without staff reads, missing targets, role/assignment/type blocks, actor/tenant separation and both outcomes of the unsaved-settings guard.

The staff recovery journey captures the recovery center before opening a module and the destination after status review at all seven specified sizes: 390x844, 800x1280, 1024x600, 1280x720, 1280x800, 1366x768 and 1920x1080. Assignment and self-session destination captures cover 1024x600 and 390x844. These are current implementation artifacts; comparison against missing approved original reference screenshots remains unproven.

Local verification on the current source: `npm run typecheck` passed; `npm run build` passed with the repository's existing native Vite loader and main-chunk advisories; focused Chromium browser acceptance passed 20/20, including seven viewport sizes, foreign actor/tenant filtering, role and assignment denial, unsaved-draft guard outcomes, exact command selection, and zero POSTs during navigation. Hosted exact-head Chromium/Firefox and release-workflow CI is still required before merge. This is a navigation-only change: no API contract or migration changed, and no production deployment is claimed.
