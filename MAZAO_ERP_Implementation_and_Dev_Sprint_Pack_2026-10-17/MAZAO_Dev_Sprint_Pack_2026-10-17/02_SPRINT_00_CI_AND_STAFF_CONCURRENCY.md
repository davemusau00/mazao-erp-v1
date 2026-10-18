# Sprint 00 | Unblock CI without breaking staff safeguards

**Urgency:** P0 · **Suggested effort:** 0.5–1.5 focused engineering days plus hosted CI · **Owner:** backend/security/test engineer · **Branch:** existing PR #18 after main reconciliation.  
**Start gate:** `main` green at `8725142`; PR #18 head `0e350e0` failed GitHub Actions run `39040137815`.

## Verified failure

At `apps/api/test/staff-security.integration.test.ts`, test *“parallel administrator removals or assignment transfers cannot strand the business”* currently builds two asynchronous actions. Each action reads the other actor's membership/assignment **inside** the same `Promise.all` that starts concurrent access-changing commands. When one action succeeds first, the other actor's session can legitimately be revoked before its **preflight GET**. The helper `members()` asserts `200` but receives `401 UNAUTHENTICATED`.

CI output: 95 cases, **93 pass / 2 fail** (failing subtest and parent). Typecheck and migrations pass; normal browser, real database browser and image job skip because `test:api` fails. This is a genuine test-race defect in the orchestration, **not permission to weaken server revocation**, and does not prove that all real administrator races are safe.

## Surgical correction design

### Red/green method

1. Run the single file against a **disposable migrated localhost** test database; repeat enough times to expose the race. Capture the exact HTTP transitions and expected audit entries, without logging credentials.
2. Split **read preflight** from **mutation concurrency**: gather both target membership versions or target device versions while both actors are known authenticated. Build two complete immutable command envelopes with independently generated UUIDs **before** starting the race.
3. Issue only the prepared commands concurrently, e.g. `Promise.all([submit(owner, preparedOwner), submit(peer, preparedPeer)])`; never issue fresh GETs as part of these concurrent workers. Preserve concurrency in the actual mutation path.
4. Assert exactly one command is `CONFIRMED` when the preconditions demand one winner; the loser is either a documented `REJECTED/CONFLICT`, or an authentication/authority rejection such as `401/403`, depending on whether revocation occurs before the handler's session check. Require **zero HTTP 500s** and **zero unauthorized CONFIRMEDs**.
5. Query PostgreSQL afterward using test-only DB access: exactly one usable tenant administrator with an active membership, password and active outlet assignment remains; no orphaned active assignments; no unexpected sessions; audit/outbox and stored command outcomes match actual committed effects.
6. Repeat reversed order and several dozen iterations with distinct disposable tenant fixtures. Ensure same-actor simultaneous changes, cross-tenant targets, current-session self-reassignment and open-till restrictions remain denied. Use deterministic barriers only when necessary; don't sleep arbitrarily to manufacture ordering.
7. Keep the existing fast test suite; preserve high-value independent mutation concurrency within each isolated DB test file.

### Representative test shape (illustrative, adapt to real types)

```ts
// Before race: BOTH actors are authenticated and all versions are fetched.
const peerVersion = (await member(app, owner, peer.userId)).version;
const ownerVersion = (await member(app, peer, owner.userId)).version;
const disablePeer = command(owner, 'staff.member.set_active',
  { userId: peer.userId, active: false, reason: 'Last administrator race' },
  { [`staff:${peer.userId}`]: peerVersion });
const disableOwner = command(peer, 'staff.member.set_active',
  { userId: owner.userId, active: false, reason: 'Last administrator race' },
  { [`staff:${owner.userId}`]: ownerVersion });

const responses = await Promise.all([
  submit(app, owner, disablePeer),
  submit(app, peer, disableOwner),
]);
// Normalize both HTTP response and command envelope; allow a legitimately
// revoked actor's 401, but never allow two confirmed removals or HTTP 500.
```

Use an analogous preflight for `devices.assignment.update`. This snippet is **not a ready-to-apply patch**, and its exact expected codes must be derived from the actual app handler.

## Merge/rebase containment

`feat/product-finishing` is 3 commits behind and 9 ahead of main. Use `git fetch origin` and a new worktree; integrate `origin/main` via merge (safer audit trail) or a deliberately controlled rebase on a private branch. Important duplicated work:

- `apps/api/test/support/isolate-database.mjs` and `package.json` already fixed on main. Keep **main's last accepted test isolation** unless current branch adds proven improvements.
- Historical migration upgrade fixture cleanup already accepted on main; preserve it.
- `fix/mixed-stock-count` PR #14, `fix/account-self-service` PR #15, `fix/hotel-calendar-dates` PR #16 are older parallel lines. Relevant fixes are already included in main or PR #18, so do **not** blindly merge all their commits.
- Check migration `017_configuration_assets.sql` against any later `017_credential_operation_fencing` local worktree before staging a release; assign unique immutable numbers before application.

## Acceptance gates

- [ ] Focused staff concurrency case 30–100 disposable iterations, including each race type and reversed scheduling; no lost last admin.
- [ ] `bun run typecheck` green.
- [ ] `bun run test:api` green with **0 failures, 0 unintended skips** and meaningful DB-backed coverage.
- [ ] CI Playwright regular and real PostgreSQL browser suites subsequently run and pass; do not claim victory after only fixing the API stage.
- [ ] Production API image smoke job runs and passes on exact candidate SHA.
- [ ] No privilege/rate-limit relaxation, no removed assertions, no global serialization of otherwise legitimate stock/sale transaction races.
- [ ] PR updated with the original CI log citation and explanation of why 401 was legitimate for the losing actor.

## Failure escalation

If both removal commands can commit, if all admins are lost, or a revoked actor posts a new authoritative command, **this is a product security defect**, not a flaky test. Stop and fix `staff.ts`, transaction locks, session revalidation and last-admin checks with a targeted real-DB regression before restarting integration.
