# MAZAO ERP: Manage Performance, Staff Access & Security Completion Audit

**Audit date:** 16 October 2026  
**Repository:** https://github.com/davemusau00/mazao-erp-v1  
**Production release observed by operator:** `872514217272c154236fcab02bfda11417dd5dff`  
**Target:** `https://mazao.davemusau.co.ke`, VPS `93.127.131.55`  
**Method:** GitHub source and CI examination, prior operator-provided deployment commands and Firefox diagnostics. No production-shell access was performed by this audit; no code, credentials, database, or deployed service was changed.

## Executive conclusion

**Three separate concerns have been conflated:**

1. **Manage eventually loads but sometimes stalls, and one previously observed response was malformed.** Actual browser evidence shows `GET /api/v1/configuration` once returned ~163 KB with an unterminated JSON string, another time returned 683,935 bytes of *valid* JSON with matching declared/actual byte lengths, and in a third test did not complete within 10 seconds. An authenticated `/auth/me` call returned HTTP 200. This proves intermittent failure/delay, *not* a particular serialization or proxy root cause.
2. **Staff administration already exists.** `Manage → Staff` implements tenant-scoped directory, role assignment, account activation, protected initial-password/reset workflows and session review; `Manage → Assignments` manages logical outlet/operator assignments. `GET /staff`, `GET /devices`, dedicated password operations, and staff/device commands are implemented. A separate **custom roles/per-permission editor** is **not** implemented. Fixed coarse server roles are intentional today, and receipt/printer/device pairing remains outside this slice.
3. **A read-only command-result authorization gap is present.** `/api/v1/commands/:commandId` checks tenant scope and certain special command kinds, but not actor/outlet for *all* other commands. A user with the same tenant and a known command UUID may retrieve another operator's stored result. This should be independently patched and regression-tested before expanding staff-control surfaces. Do not imply cross-tenant disclosure; the initial query is tenant-scoped.

## Evidence inventory

| Evidence | Finding | Classification |
|---|---|---|
| Live browser: config response 200, JSON error at ~163,546 characters | At least one malformed/incomplete response or viewer interpretation | Observed; cause unproven |
| Live browser: 683,935 bytes both declared and received, JSON valid | Large configured profile can be delivered successfully | Observed |
| Live browser: `/auth/me` HTTP 200; `/configuration` aborted after 10 s | Auth valid during this test; configuration slow/intermittent | Observed |
| `apps/api/src/app.ts` preHandler | All authenticated calls `SELECT ... t.business_profile`, then parse only taxPolicy for the session | Confirmed unnecessary large DB transfer |
| `apps/api/src/app.ts` login handler | Assignment query also loads `t.business_profile`, then returns only taxPolicy | Confirmed unnecessary data load |
| `apps/api/src/configuration.ts` `getConfiguration` | Full `business_profile` returned, including raw data-URL logo/QR; REPEATABLE READ transaction with sequential reads | Confirmed design issue; not proven root of 10-second delay |
| `apps/api/src/app.ts` buildApp | Fastify `bodyLimit: 1_048_576`; per-image PNG limit 512 KiB in `configuration.ts` | Combined sufficiently large images can exceed overall request limit when business form sends entire profile |
| `src/services/apiClient.ts` request | `response.json().catch(() => ({}))` hides malformed-JSON errors on HTTP 200 | Confirmed defect |
| `src/components/manage/BackendManageWorkspace.tsx` | Manage config GET gates Business/Outlet/Capabilities content; Staff/Assignments are separate child section and not gated by configuration | Confirmed rendering structure |
| `src/components/manage/StaffAccessWorkspace.tsx` | Create/edit/suspend staff, passwords, sessions, logical assignments implemented | Confirmed |
| `src/app/featureRegistry.ts` | `permissions` management feature is marked `not_connected`; staff and devices marked connected | Confirmed missing granular editor |
| `apps/api/src/contracts.ts` | Fixed role map, admin/owner have `staff.manage` & `devices.manage`; manager has read access | Confirmed |
| `docs/31-STAFF-PROVISIONING.md` | 3-step onboarding: create member → set password → assign outlet/workspace | Confirmed contract |
| `e2e/integration/staff-access.spec.ts` | Real PostgreSQL browser journey tests that 3-step workflow on disposable data | Test exists; not live operator acceptance |
| `apps/api/src/app.ts` command-status handler | Special password/import checks, no generic same-actor rule | Confirmed security gap |

**Source URLs:**
- https://github.com/davemusau00/mazao-erp-v1/blob/872514217272c154236fcab02bfda11417dd5dff/apps/api/src/app.ts
- https://github.com/davemusau00/mazao-erp-v1/blob/872514217272c154236fcab02bfda11417dd5dff/apps/api/src/configuration.ts
- https://github.com/davemusau00/mazao-erp-v1/blob/872514217272c154236fcab02bfda11417dd5dff/src/services/apiClient.ts
- https://github.com/davemusau00/mazao-erp-v1/blob/872514217272c154236fcab02bfda11417dd5dff/src/components/manage/BackendManageWorkspace.tsx
- https://github.com/davemusau00/mazao-erp-v1/blob/872514217272c154236fcab02bfda11417dd5dff/src/components/manage/StaffAccessWorkspace.tsx
- https://github.com/davemusau00/mazao-erp-v1/blob/872514217272c154236fcab02bfda11417dd5dff/src/app/featureRegistry.ts
- https://github.com/davemusau00/mazao-erp-v1/blob/872514217272c154236fcab02bfda11417dd5dff/docs/31-STAFF-PROVISIONING.md

## Prioritized fix register

| Priority | Issue | Minimal deliverable | Gate |
|---|---|---|---|
| **P0** | Command result same-tenant actor-scope leak | Explicit actor and, where appropriate, outlet validation for every command type, including staff/device command results; secure 404 | Cross-actor same-tenant known UUID returns 404; own original command recovery works |
| **P0** | `/configuration` intermittent timeout/malformed delivery | Instrument all layers and reproduce with real PNG-sized fixture | Identify API-vs-proxy-vs-browser boundary and test before/after |
| **P0** | Hidden 200 JSON parse errors | Strict typed parser, bounded read timeout for GETs, visible retry UI | Invalid JSON never becomes `{}`; retry actually works |
| **P1** | Giant profile loaded in auth preHandler and login | Project only needed `taxPolicy` from JSONB | Same login/session claims, less data per authenticated request |
| **P1** | Giant inline images on configuration GET and each business save | Authenticated asset reads, lightweight metadata, explicit keep/remove/replace semantics | Existing stored images preserved; new edits unaffected; response small |
| **P1** | Staff settings confusing/missing-to-user | Dedicated “People & Access” navigation/overview with staff, roles matrix, assignments, sessions, passwords | Role-authorized first-time journey clear, no hidden controls |
| **P1** | Account provisioning is a fragmented 3-step procedure | Guided wizard + readiness states per member | Create, password, assignment, verify; safe resume |
| **P2** | Fixed coarse role grants, no custom permissions | Separate design/DB/RBAC project after security hardening | Effective grants enforced server-side, tested with deny matrix |
| **P2** | Staff pagination, filtering, operator audit | Scalable and accessible views with version conflict and recovery | 500+ members/deep history acceptance |

## Root-cause investigation and high-value implementation details

### A. Trace the stalled configuration endpoint

The current `getConfiguration` function opens a `REPEATABLE READ READ ONLY` transaction, fetches the complete tenant `business_profile` and outlet profile, then reads capabilities, computes counts, checks currency lock, and returns full business/outlet profiles. Raw base64 asset data returned in business settings explains why this endpoint can reach hundreds of kilobytes. It does **not** by itself explain why a request takes over 10 seconds or ends early. The earlier 163-KB malformed response and later valid 684-KB response require differential tests.

**Required diagnostic evidence, no data modification:**
1. Authenticated Firefox timings: `/auth/me`, `/configuration`, `/staff`, `/devices`: HTTP status, time-to-headers, body duration, Content-Length, received bytes, JSON validation, no raw response bodies. Run repeated and uncached configuration requests; preserve any intermittently failing HAR **privately** (HAR can contain cookies, names and images; never post publicly).
2. API-side timings, with safe structured fields: route template, request ID, duration-to-headers, duration-to-complete, response-byte count, DB acquisition time, query timings, exception code. **Never log cookies, CSRF, passwords, images, raw profiles or request payloads**.
3. PostgreSQL: `pg_stat_activity` state and wait events, pool saturation, `pg_column_size(business_profile)`, sizes of `logoUrl` and `receiptQrImage`, not the image contents. Check application error logs under the exact request window.
4. Proxy: measure direct loopback API versus public Nginx via the same locally controlled authenticated test session; do not paste auth cookies in chat or logs. Test body digest and byte count on both paths with exact same business version, and Nginx upstream timings if enabled.
5. Runtime: actual production API image Bun 1.4.3, Fastify, Nginx, Firefox PWA; verify SW interception behavior, without deleting service-worker state or IndexedDB. Compare browser network behavior with a new clean **separate** profile only when safe.

**Isolation decision tree:**
- API-side duration long: examine session preHandler `business_profile` transfer, pool waits, config transaction query execution, Bun serialization.
- API fast / Nginx slow or mismatched digest: investigate reverse proxy buffering, connection closure, framing, compression/transfer-encoding, upstream errors.
- API + proxy valid / Firefox intermittent: check service worker, stalled body reader, browsers/extensions, cached assets, client cancellation and network variability.
- API response valid but UI stuck: check `response.json()` swallowing, React state transitions and error boundary.

**Do not edit Nginx globally, raise SQL limits blindly, or alter the production database to test.**

### B. Stop reading full images for every authenticated route

`apps/api/src/app.ts` contains both:

```
SELECT ... t.business_profile ...
// followed by
readBusinessProfile(r.business_profile).taxPolicy
```

That loads and deserializes potentially 684 KB of base64 strings for ordinary `/auth/me`, `/staff`, `/catalog/items`, etc., even though session construction only needs tax policy. Replace that selection with a narrow projection, e.g. `(t.business_profile->'taxPolicy') AS tax_policy` and normalize with safe default/validation logic. Make the same reduction in the login assignment read. Preserve the exact auth response shape and failure behavior. PostgreSQL JSONB extraction itself can still read/decompress the profile internally, so a dedicated normalized tax-policy column would be a later optimization if benchmarks justify it. Add regression coverage for empty/legacy profiles, non-ASCII values, large images, identity changes, all roles, failed auth and currency/time-zone parity.

### C. Separate binary assets from settings data

Recommended long-term asset contract:
- Keep existing `business_profile` images/legacy receipt snapshots intact through additive migration or compatibility logic; no destructive backfill.
- New uploads stored in tenant-scoped, private durable storage (DB bytea asset table or protected object storage), with content hash, type, byte length, version, actor and audit. Deny SVG, remote URI schemes, arbitrary MIME, overlarge files. Validate PNG signature and actual decoded data; enforce safe raster handling.
- `GET /api/v1/configuration` returns lightweight metadata plus stable asset references; never embeds full base64. `GET /api/v1/configuration/assets/{kind}` returns authenticated `image/png`, correct byte framing, `nosniff`, `Cache-Control: private, no-store` or properly versioned private cache; tenant authorization required.
- Business form uses explicit image-action semantics: `keep`, `replace`, `remove`, guarded by expected business version. **Do not convert omitted image fields to empty strings**, which would erase existing artwork. Keep existing `logoUrl` HTTPS URL support where currently allowed. Reconcile image actions with idempotent settings commands and unknown-result recovery.
- Preserve historical immutable receipt snapshots, including historical images. New receipt asset references must be durable and content-versioned, not "latest logo" pointers.
- Existing business audit/outbox payloads may contain base64 images. For new records, log/handoff identifiers and SHA-256 image digests, not image bytes. Avoid duplicating full image values into each audit/outbox/receipt event.
- API `bodyLimit` is 1 MiB while each of two PNGs is allowed up to 512 KiB decoded; full-profile JSON can exceed this if both are large. Test cumulative payload limit explicitly. Prefer separate endpoints for large uploads with bounded streaming; preserve auth, CSRF and command recovery.
- Target: typical configuration metadata <= 32 KiB; avoid sending binary payloads on staff management or login. Treat this as a target, not a currently measured outcome.

If quick relief is needed, ship session-query projection and strict JSON errors in a small first PR, then asset separation in a second PR. Do not introduce a large image-migration change before the user has a functioning Manage screen.

### D. Fix client parsing and loading UX

`src/services/apiClient.ts` currently does:

```
const body = await response.json().catch(() => ({}));
```

This masks malformed HTTP 200 JSON. A robust replacement should:
- Distinguish failed connection, timed-out headers, interrupted/truncated body, invalid JSON, HTTP error, and successful typed response. A 200 with invalid JSON must throw a clear recoverable `INVALID_SERVER_RESPONSE`, not return `{}`.
- Set a bounded client **read timeout for safe GETs** with explicit retry UI. Do not automatically retry mutations with fresh command IDs; unknown command outcome must go through existing original-command recovery.
- Validate required `configuration.business` and `configuration.outlet` shape before assigning state. Keep last-known-good server settings visible with “refresh failed” warning rather than blanking the whole view.
- `BackendManageWorkspace` should render independent Staff and Assignments while configuration is slow, with permission-specific states. It already renders the child `StaffAccessWorkspace` outside the configuration branch, so keep that separation.
- Add cancellation/ignore-stale-response guards on navigation and `load`, preserve drafts and prevent stale responses from overwriting newer edits. Accessible progress, elapsed-time message, retry and diagnostics/request ID.

### E. Staff: what is actually connected vs what is missing

Already connected in the deployed source:
- Staff directory: `GET /api/v1/staff` (`staff.view`).
- Staff member creation/rename/role update/activate or suspend via versioned commands (`staff.manage`).
- Initial password/reset via protected dedicated endpoint, credential version & session invalidation (`staff.manage`).
- User's own password/session management, accessible through My Account.
- Logical workspace/outlet assignment create/update/revoke: `GET /api/v1/devices`, `devices.*` commands (`devices.view` / `devices.manage`).
- Tenant-scope protections, separation of data, no-self-lockout guards, open shift check before revoking access.

Intentionally absent or only partial:
- Role permission grant editor / custom role templates: `managementFeatures.permissions.availability === 'not_connected'`.
- Detailed scoped permissions beyond fixed coarse roles; editing role labels is **not** a grant change.
- Physical terminal enroll/pair/health/print acknowledgement.
- Guided single-flow staff provisioning; the current process is Create → Set password → Assign workspace.
- First-login forced password rotation, emailed invitations and self-service forgotten-password recovery.
- Fast directory search/filter/pagination beyond current bounded first 500, action logs and comprehensive access review.

**UI ambiguity:** The screenshot shows **Staff** and **Assignments** tabs present on Manage; they were not absent from the release. It also shows business configuration still loading, which could make other settings appear unresponsive. The actual role-permissions card is knowingly disabled; do not claim the implementation is present but hidden in the backend.

Proposed People & Access information architecture:

```
Manage
 ├─ Business profile
 ├─ Outlet & receipts
 ├─ People & access
 │   ├─ Overview (active staff, no-password, no-assignment, pending)
 │   ├─ Staff directory (search, status, current roles)
 │   ├─ Add operator wizard (identity > role > password > assignment > verify)
 │   ├─ Roles & permissions (read-only effective matrix now; editable custom grants only after new authoritative server model)
 │   ├─ Workspace assignments (logical; not physical devices)
 │   ├─ Sessions & security (revoke, history, password recovery)
 │   └─ Access audit history (read-only, scoped)
 ├─ Capabilities
 └─ Setup checks
```

Permissions: owner/admin manage, manager view-only, cashier no Staff/Assignments management. Secure backend checks remain authoritative. Read-only role matrix must clearly say “Fixed server roles; granular edits not available”. Avoid dead tabs or placeholder buttons that imply the feature works.

Onboarding wizard must use existing canonical command envelopes, retain original command IDs for uncertain outcomes, re-read server versions after each confirmed step, keep at least one operational admin, display next required step and allow safe resume after browser refresh. It must **not** locally synthesize users/assignments, store passwords in generic IndexedDB, expose session tokens, or automatically rotate existing staff credentials.

### F. Security: tighten command-status authorization before widening the UI

The `GET /api/v1/commands/:commandId` query filters on tenant and UUID, but only extra-checks special command categories (credentials and CSV import). For normal commands, the response can be returned to a different actor within the tenant if they know its UUID. Need explicit per-command authorization:

- Default: require original actor ID == session.userId and original operation outlet == session.outletId; return 404 for foreign scoped evidence.
- If supervisors genuinely require cross-operator reconciliation, add a separately authorized and audited endpoint with the exact permissions/scope, metadata minimization, and justifiable records access; do not make a blanket exception for managers.
- Maintain existing staff password and import confidentiality restrictions as additional checks.
- Assert `GET` read does not allow command writes; verify rejected actor with a UUID gets neither existence nor body, and original actor still receives recoverable status and canonical result.
- Test same tenant/different actor, same actor/different outlet, separate tenant, revoked member/device, cashier/admin, secret operations, command-ID enumeration, and response loss/reload. Preserve intentionally legitimate original-command recovery.

## No-risk live evidence collection

In Firefox console after sign-in, execute read-only requests with a 20-second timeout. **Do not print response bodies, names, credentials, image data, cookies, or bearer tokens:**

```js
(async()=>{
  const endpoints=['/auth/me','/configuration','/staff','/devices'];
  const results=await Promise.all(endpoints.map(async path=>{
    const started=performance.now();let headersAt=null;
    try{
      const response=await fetch('/api/v1'+path+'?diagnostic='+Date.now(),{
        credentials:'include',cache:'no-store',signal:AbortSignal.timeout(20000)
      });
      headersAt=performance.now();
      const text=await response.text();let valid=false;
      try{JSON.parse(text);valid=true;}catch{}
      return {path,status:response.status,headersMs:Math.round(headersAt-started),
        bodyMs:Math.round(performance.now()-headersAt),bytes:new TextEncoder().encode(text).length,valid};
    }catch(error){return {path,error:error.name,elapsedMs:Math.round(performance.now()-started),headersReceived:headersAt!==null};}
  }));
  console.table(results);
})();
```

On VPS only, to see stored JSONB size and current database wait states (read-only):

```sh
docker exec -i mazao-db-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off' <<'SQL'
SELECT pg_column_size(business_profile) profile_bytes,
       length(coalesce(business_profile->>'logoUrl','')) logo_characters,
       length(coalesce(business_profile->>'receiptQrImage','')) qr_characters
FROM core.tenants;
SELECT state,wait_event_type,wait_event,count(*)
FROM pg_stat_activity WHERE datname=current_database()
GROUP BY state,wait_event_type,wait_event ORDER BY count(*) DESC;
SQL
```

Use anonymized results and sanitized log summaries. Retain release snapshot and prior encrypted, verified backup.

## Implementation order and PR acceptance gates

**PR 1: Security and diagnostics (P0).** Tighten command recovery authorization and preserve all original-command cases. Add structured bounded route timing, no PII logging, and user-facing invalid response errors. Run unit, integration, E2E, security and production container checks. No migration required unless introduced deliberately.

**PR 2: Auth/session performance (P1).** Replace unnecessarily broad tenant profile selects in authentication and session preHandler, add large-image fixtures, confirm consistent role/time-zone/tax behavior. Measure backend query and request cost with controlled 0-byte vs maximum-image payloads. Do not claim fixed latency without evidence.

**PR 3: Manage reliability (P1).** Strict GET decode and schema, separate loading boundaries for configuration vs staff/assignments, cancellation on navigation, visible retry/timeout, non-destructive UI preservation and network test matrix. Regression-test incomplete 200 response, JSON parse error, delayed headers, delayed body and 401 transitions.

**PR 4: Config assets and payload reduction (P1).** Add private asset storage + reference endpoints with legacy compatibility, explicit keep/remove/replace image semantics, immutable receipt versions, cumulative size enforcement, safe audit metadata; migrate additively with restore checkpoint. Run existing posted receipt equivalence tests and security/permission matrix.

**PR 5: Staff usability and information architecture (P1).** Make People & Access discoverable. Guided onboarding, operational readiness indicators, fixed-role matrix, permissions-aware actions and error guidance, row-level recovery and mobile support. No fabricated custom permission toggles.

**PR 6: Fine-grained RBAC, separately scoped (P2).** Only after agreeing a domain policy, design normalized roles/permissions, tenant overrides vs outlet-scoped grants, fallback compatibility, least privilege and deny-by-default. API must enforce permissions; a frontend toggle alone never grants or revokes authority. Evidence must include least-privilege tests and historical sessions.

### Global release gate

```sh
bun run typecheck
bun run test:api
bun run test:e2e
bun run test:integration
```

Also pass GitHub Actions production-image build/ready smoke with Bun, isolated PostgreSQL upgrade migration checks, tenant/actor isolation, Firefox and Chromium on desktop/mobile, and Nginx proxy response-accuracy tests. The failure-mode tests must generate 512-KiB raster assets and a real 684-KB-ish configuration response. Never use production accounts/data for automated tests. Resolve CI failures before merge, deploy only green `main` full-SHA artifacts, verify checksum, take a verified off-host backup, activate only MAZAO Compose project and PWA symlink, inspect public and localhost readiness, preserve previous release and unrelated services. No `docker compose down -v`, volume prune, migration reversal or clearing IndexedDB command recovery.

## Suggested Codex brief (copy exactly as a task, not as a claim of completion)

> Inspect `main` from `872514217272c154236fcab02bfda11417dd5dff` or newer. Perform an evidence-first, code-complete hardening sprint for MAZAO Manage, Staff, Assignments and command recovery. Start by reproducing intermittent slow/truncated `GET /api/v1/configuration` with maximum PNG data and proxy/runtime testing. Fix the generic `/commands/:id` same-tenant cross-actor information exposure. Remove unnecessary full `business_profile` reads from login/session middleware. Make JSON parse errors and slow loading visible and retryable without breaking idempotent command recovery. Separate settings image bytes from ordinary GET settings using private, compatible image endpoints and preserve old financial receipts/images. Complete discoverable Staff/Assignments journeys with an accessible guided create → password → outlet assignment flow and a truthful read-only server-role matrix. Do not invent granular role editing unless implementing an explicit authoritative RBAC domain with migrations and server enforcement. Test permission denies, stale versions, mixed Unicode/images, normal/failing response framing, delayed headers/bodies, browser refresh and original-command recovery. Keep past transactional data, design aesthetic, PWA/IndexedDB command evidence and unrelated VPS stacks intact. Ship small reviewable PRs in priority order, obtain green CI, then follow the existing checksummed immutable release and off-host verified restore process. Provide performance evidence and a before/after capability matrix; do not claim a fix solely from HTTP health checks or a single successful JSON request.

**Boundary:** This audit is a source-based plan. There are no new PRs, production data modifications, patches, or live server command executions in this deliverable.
