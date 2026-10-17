# MAZAO ERP: Loading Reliability, Manage Performance, Staff Access & Security Completion Plan

**Audit date:** 16 October 2026  
**Repository:** https://github.com/davemusau00/mazao-erp-v1  
**Production release observed by operator:** `872514217272c154236fcab02bfda11417dd5dff`  
**Target:** `https://mazao.davemusau.co.ke`, VPS `93.127.131.55`  
**Method:** GitHub source and CI examination, prior operator-provided deployment commands and Firefox diagnostics. This plan includes an expanded all-workspace loading-reliability workstream requested after the initial audit. No production-shell access was performed by this audit; no code, credentials, database, or deployed service was changed.

**Revision:** v2, incorporating a product-wide P0 reliability gate: no indefinite loading, no silent failures, measured API/browser latencies, and secure recovery for read and write operations.

## Executive conclusion

**Four linked workstreams need to be handled together:**

1. **Manage eventually loads but sometimes stalls, and one previously observed response was malformed.** Actual browser evidence shows `GET /api/v1/configuration` once returned ~163 KB with an unterminated JSON string, another time returned 683,935 bytes of *valid* JSON with matching declared/actual byte lengths, and in a third test did not complete within 10 seconds. An authenticated `/auth/me` call returned HTTP 200. This proves intermittent failure/delay, *not* a particular serialization or proxy root cause.
2. **Staff administration already exists.** `Manage → Staff` implements tenant-scoped directory, role assignment, account activation, protected initial-password/reset workflows and session review; `Manage → Assignments` manages logical outlet/operator assignments. `GET /staff`, `GET /devices`, dedicated password operations, and staff/device commands are implemented. A separate **custom roles/per-permission editor** is **not** implemented. Fixed coarse server roles are intentional today, and receipt/printer/device pairing remains outside this slice.
3. **Slow and indefinite loading is a cross-product reliability defect, not merely a Manage bug.** All implemented workspaces should have measurable time-to-use, bounded request and loading behavior, independent data boundaries, clear errors, safe retries, and cancellation. No claims about other screens timing out are made until tested; the existing configuration evidence establishes an urgent need to test them.
4. **A read-only command-result authorization gap is present.** `/api/v1/commands/:commandId` checks tenant scope and certain special command kinds, but not actor/outlet for *all* other commands. A user with the same tenant and a known command UUID may retrieve another operator's stored result. This should be independently patched and regression-tested before expanding staff-control surfaces. Do not imply cross-tenant disclosure; the initial query is tenant-scoped.

## Evidence inventory

| Evidence | Finding | Classification |
|---|---|---|
| Live browser: config response 200, JSON error at ~163,546 characters | At least one malformed/incomplete response or viewer interpretation | Observed; cause unproven |
| Live browser: 683,935 bytes both declared and received, JSON valid | Large configured profile can be delivered successfully | Observed |
| Live browser: `/auth/me` HTTP 200; `/configuration` aborted after 10 s | Auth valid during this test; configuration slow/intermittent | Observed |
| Existing loader pattern: `BackendManageWorkspace` | Config loading is a page-level dependency and frontend uses a silent JSON parse fallback | Confirmed source, broader UX impact inferred |
| All connected and partial ERP workspaces | No systematic live time-to-use data supplied for Today, Sell, Stock, Shifts, Hotel, Reports, Staff etc. | **Unverified**; baseline is required before asserting widespread slowness |
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
| **P0** | Indefinite/very slow loading across implemented MAZAO workspaces | End-to-end route latency inventory, bounded GET waits, explicit retry/error/empty state and independent data loading | Every implemented route has terminal success/error/offline state; no endless spinner; timing evidence and cross-browser tests |
| **P0** | `/configuration` intermittent timeout/malformed delivery | Instrument all layers and reproduce with real PNG-sized fixture | Identify API-vs-proxy-vs-browser boundary and test before/after |
| **P0** | Hidden 200 JSON parse errors | Strict typed parser, distinguish headers/body timeout, visible retry UI | Invalid JSON never becomes `{}`; retry actually works |
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

### A2. PRODUCT-WIDE P0: eliminate indefinite loading and measure time-to-use

The request to "also fold loading taking forever into the plan" is **not satisfied** by optimizing `/configuration` alone. Treat reliable load behavior as a shared contract for all **implemented** workspaces, including authentication, Today, Sell, sales history, Stock, stock counts, Purchasing (connected slices), Hotel and reservations (connected slices), Customers, Shifts, Money/reports (connected slices), Manage, Staff, Assignments and setup. For deliberately unimplemented features, show an honest unavailable state, not a spinner or dead control.

#### Required inventory of every route and its dependencies

Build a typed **route-loading matrix** from `src/app/featureRegistry.ts` and actual API calls made by every workspace. For each route record:

| Field | Required evidence |
|---|---|
| Entry path and permission | Role/capability needed, first navigation and refresh navigation behavior |
| Data waterfall | Initial JS chunk, session restoration, API endpoints, queries and independent requests |
| Loading ownership | Which component owns pending/loaded/empty/error/unauthorized/offline states |
| Timing | Navigation start → visible shell; headers; body completion; parse/validation; first usable action |
| Failure outcome | Timeout, 401/403, 404, 429, 500/503, invalid/truncated JSON, disconnect, slow network, stale response |
| Recovery | Retry GET, reauthenticate, refresh single panel, preserve unsaved form/command evidence |
| Heavy records | Pagination/search for staff/products/orders, small summary responses rather than full histories |

**Baseline before changing code:** execute 30 serial and 10 controlled-concurrency navigations for each connected screen on migrated disposable PostgreSQL with **small and production-shaped fixtures** (many products, stock movements, receipts, staff, and up to two maximum-size PNGs). Repeat representative tests through the **actual Bun production API container**, Nginx and Firefox/Chromium PWA, not only Node/Playwright mocks. Profile first load, warm navigation, authenticated refresh, login after expiry, and poor/mobile networks. Record p50/p95/p99 with sample sizes; avoid inferring population p99 from 10 requests. Track failures separately from latency; a timed-out response cannot be hidden from percentile reporting. No synthetic writes in the live business.

**Instrument the complete path** using correlation IDs (generate/accept only trusted, safe identifiers): browser interaction and fetch timing → reverse proxy upstream timing → Fastify onRequest/preHandler/handler/onSend/onResponse → connection-pool wait → PostgreSQL query timings → JSON serialization and bytes. Restrict metrics to route **templates**, no tenant names, tokens, cookies, passwords, images, SQL parameters or response bodies. Use `Server-Timing`/`Timing-Allow-Origin` only as appropriate for same-origin debugging; never expose sensitive data. Check event-loop stalls, Bun memory/GC, PostgreSQL `pg_stat_activity`, transaction waits and `pg_stat_statements` **only if already safely enabled**. Diagnose large response writes and aborted sockets before changing proxy buffer settings. Ensure measurement does not log account or financial content.

#### Shared client request and loading-state contract

Provide a consistent, **strict** client transport for implemented GET endpoints with the following outcomes:

- `pending_headers`, `streaming_body`, `success`, `empty`, `unauthenticated`, `forbidden`, `offline`, `timed_out`, `invalid_payload`, `server_error`, and `cancelled` (adapt naming to the codebase, but preserve the distinctions). **Never resolve malformed 200 JSON as `{}`.** Validate mandatory fields of endpoints used to render UI.
- Use `AbortController` and `AbortSignal` composition to stop an obsolete **GET** on unmount, newer navigation or superseding reload. Avoid racing `setState` from old tenant/outlet/session requests into a new context. Aborting a read locally does not prove the backend stopped executing; profile server-side cancellation separately.
- Choose an initial timeout policy explicitly, e.g. **10-second soft warning and visible Retry, 20-second maximum for ordinary GETs in the browser**, with justified per-endpoint exceptions. These are *proposed policies*, not evidence that the present system achieves them. Time out **response headers and body consumption**, not `fetch()` alone. Show "Still contacting server" before the hard cap and a terminal actionable state at the cap. Distinguish deliberate cancellation from an error. Make limits configurable based on measured networks, but never allow infinity.
- One bounded retry for idempotent GETs may be acceptable with backoff/jitter and a no-store strategy. Do not loop indefinitely, stack overlapping requests or create a sign-in storm. A 401 should send the user through normal session restore/reauthentication once; 403 means lacking permission, not a retry. Respect 429 `Retry-After`; do not encourage brute-force sign-in retries.
- For **POST/financial/stock/staff commands**, maintain the existing original `commandId`, durable recovery journal, status query and controlled replay. A UI timeout on a write is an **unknown outcome**, not permission to submit another UUID. Never use a generic GET retry wrapper on mutations.
- Use panel-level **skeleton → loaded data / meaningful empty state / visible error** instead of blocking the entire shell. Staff/Assignments must remain usable if Business Settings is slow, and saved business information stays visible when a background refresh fails. Keep buttons disabled only for their own pending action, not unrelated modules.
- Add accessible progress announcements (`aria-live`/`role=status`) and descriptive errors (`role=alert`) without flooding screen readers; `Retry`, `Sign in`, or `Check original command status` must work. Provide request ID/copyable *safe* diagnostics in advanced details, not sensitive payloads.
- Keep any established visual design, sidebar, tab hierarchy, mobile touch targets, selected workspace, scroll/focus behavior, original IndexedDB command recovery, and unsaved drafts. Do not solve perceived slowness by hiding modules, clearing site storage, or faking success.

#### Target performance budgets, to validate and tune from the baseline

Proposed **release targets**, not measurements of today's production:

| Surface | Controlled baseline target (p95) | Hard requirement |
|---|---:|---|
| Session restore and first authenticated shell | ≤ 2 seconds on stable reference network | Visible response within 1 second; terminal error/reauthentication state within bounded timeout |
| Switch between already loaded workspaces | ≤ 300 ms to visible shell/heading | No full-page blackout while data refreshes |
| Small authenticated GETs (`/auth/me`, `/staff`, `/devices`) | ≤ 1 second API completion on controlled host | No full profile/image bytes in auth path |
| Configuration metadata GET after asset split | ≤ 1.5 seconds API completion on controlled host | Payload-size budget ≤ 32 KiB typical; measured and justified exceptions |
| Common operational workspace first usable state | ≤ 3 seconds on reference desktop/Wi-Fi | Error/empty/success state within bounded timeout even on unreliable network |
| Browser slow/mobile or temporarily unavailable server | No fixed p95 until network matrix establishes it | Show progressively informative states; ordinary GET never spins indefinitely |

Define dataset sizes, CI runner, concurrency, warm/cold cache, and network emulation in performance evidence. Targets are acceptance goals and may be adjusted based on production-shaped data. A healthy `/health/ready` endpoint **does not** qualify as a passing workspace-load check.

#### Fault-injection and nonregression matrix

Tests must cover: (1) 10–30 second delayed headers; (2) headers delivered but body stalls; (3) truncated 200 JSON; (4) wrong `Content-Length` or early close (when exercisable in the harness); (5) `200` with missing `configuration.business`/`outlet`; (6) oversized response with Unicode and two image fixtures; (7) 401 after session expiry, 403 role, 429 login throttle, 500 and 503; (8) poor network/offline and reconnection; (9) two rapid tab switches and out-of-order success; (10) sign-out/in as a different operator during inflight request; (11) active PWA service worker, cache update and old-client/new-API compatibility; (12) 100+ products, staff/history pagination, and controlled concurrent users; (13) unconfirmed save/stock posting during response loss, preserved original command evidence; (14) accessibility keyboard/mobile viewports and no duplicate `role=status` strict-locator collision.

**Non-destructive production follow-up:** After green CI and checksummed deployment, run read-only authenticated browser measurements and a small concurrent-read probe under operator supervision. Snapshot MAZAO-only logs and verify transaction counts/journal balances, staff/assignment permissions, PWA version, health and unrelated VPS app availability. No load testing against production financial writes, no rate-limit disabling, no Nginx-wide proxy restart, no database reset.

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

**PR 1 (P0): Cross-workspace load reliability + security isolation.** Audit **all implemented workspaces** and collect before-metrics. Fix command-status actor/outlet authorization. Introduce typed read transport, strict response parsing, bounded headers + body wait, cancellation and safe request correlation IDs; add visible error/retry/empty states. Do not auto-retry financial or staff mutations. Gate: no indefinite spinner under delayed/failed responses; account and command recovery remain intact; actor-isolation cases green.

**PR 2 (P0/P1): Fix the observed configuration delay at its source.** Investigate actual API vs Nginx vs browser path with matched body digests and realistic PNG fixtures; remove full `business_profile` reads from login and authenticated preHandler; profile DB acquisition/queries, serialization, and network writes. Gate: repeatable valid JSON, no image payload in normal auth path, measured p50/p95/p99 before/after, and 30+ production-runtime config GETs with no unexplained failures. Do **not** attribute the existing intermittent truncation to UTF-8/Nginx/Bun without proof.

**PR 3 (P1): Split settings images from metadata and eliminate oversized saves.** Authenticated asset endpoints, versioned legacy-asset compatibility, explicit keep/replace/remove, content hash, image validation, immutable receipt snapshots, bounded uploads and audit-safe metadata. Gate: metadata size target ≤32 KiB typical; old logo/QR and receipts unchanged; true maximum-size fixtures pass; no accidental image deletion from a normal edit.

**PR 4 (P1): Stabilize all connected/partial workspace load states.** Panel independence, common skeleton/empty/retry patterns, context-switch safeguards, pagination and data-loading waterfalls, service-worker old/new API compatibility, mobile performance, and preserve-on-error behavior. Gate: **every implemented sidebar route** verified for direct entry, reload, role/capability restrictions, slow network, 401, 403, 500, malformed JSON, offline and navigation races. Provide route-by-route evidence matrix.

**PR 5 (P1): Complete People & Access and staff first-use journey.** Visible Staff/Assignments navigation, stepwise operator creation→credential→logical workspace assignment→sign-in verification; status badges for unfinished setup, effective fixed-role matrix, scoped sessions/audit and permission explanations. Gate: real disposable PostgreSQL E2E with admin/manager/cashier/storekeeper, member create/refresh/retry and no lockout of last admin; no invented granular role toggles.

**PR 6 (P2, separate product decision): Fine-grained RBAC and device enrollment.** Only if requirements authorize it, design a normalized backend-enforced grant model, migration/compatibility approach, deny-by-default policy and tenant/outlet/supervisor boundaries. Physical device identity and printer pairing are separate from existing logical workspace assignments. Gate: least privilege and cross-tenant isolation proven.

**Stop conditions at every PR:** Red CI, changed accounting totals, unauthorized data disclosure, hidden 200 JSON errors, unbounded loader, loss of IndexedDB command evidence, broken mobile design, or failure to preserve historical receipts. Do not merge or deploy on optimistic manual smoke alone.

### Global release gate

```sh
bun run typecheck
bun run test:api
bun run test:e2e
bun run test:integration
```

Also pass GitHub Actions production-image build/ready smoke with Bun, isolated PostgreSQL upgrade migration checks, tenant/actor isolation, Firefox and Chromium on desktop/mobile, **route-by-route loading state assertions with network failure injection**, **p50/p95/p99 latency/payload/error-rate evidence on realistic fixtures**, and Nginx proxy response-accuracy tests. The failure-mode tests must generate 512-KiB raster assets and a real 684-KB-ish configuration response. Never use production accounts/data for automated tests. Resolve CI failures before merge, deploy only green `main` full-SHA artifacts, verify checksum, take a verified off-host backup, activate only MAZAO Compose project and PWA symlink, inspect public and localhost readiness, preserve previous release and unrelated services. No `docker compose down -v`, volume prune, migration reversal or clearing IndexedDB command recovery.

## Updated Codex master instruction (copy/paste as one task)

> **Mission:** Stabilize MAZAO ERP’s production PWA **across all implemented routes**, not just Manage. The operator observed `/configuration` sometimes returning malformed JSON, sometimes returning 683,935 bytes of valid JSON, sometimes timing out after 10 seconds, and eventually loading. These are distinct observed outcomes. Do not claim root cause without API/proxy/browser instrumentation. Source baseline: green `main` release `872514217272c154236fcab02bfda11417dd5dff` unless superseded by a newer verified green main commit. Preserve source design aesthetic, routes, authoritative server data and the existing non-destructive VPS process.
>
> 1. **Measure first:** Inventory all connected and partially connected screen loaders, API calls, session-restore dependencies, service worker handling, backend queries, response sizes and p50/p95/p99. Reproduce slow/stalled headers, incomplete bodies, malformed 200 JSON, huge PNG configuration, server downtime, 401/403 and poor network with disposable production-shaped data. Add safe request ID/correlation timing from browser → Nginx → Bun/Fastify → pg pool/SQL and back. No sensitive payload logging.
> 2. **Eliminate indefinite loaders system-wide:** Common typed strict JSON request parser, explicit timeout for headers and **entire body**, cancellation/race guards, bounded safe-GET retries, proper error/empty/offline/unauthorized states and actionable Retry. Display skeleton/feedback promptly, then either actual data or a clear terminal state; retain prior successful data and unsaved drafts. Never convert invalid HTTP 200 JSON to `{}` or silently render broken/empty settings. Do not auto-retry mutations using a new command ID; preserve existing durable exact-command recovery and operator status lookup.
> 3. **Fix expensive auth/Manage data path:** Narrow `t.business_profile` projections in login/session middleware to necessary fields (e.g., tax policy); investigate `getConfiguration` query and serialization latency, large image transfer and framing; split logo/payment QR storage and delivery into securely authenticated, durable, small-metadata endpoints with additive migration and explicit keep/replace/remove semantics. Preserve old images, financial receipts, historical snapshots, audits and hashes. Test 512 KiB images and combined request limits.
> 4. **Close same-tenant command-result authorization gap** in `/api/v1/commands/:commandId`: deny known foreign actor/outlet command reads with 404, preserve own lost-response recovery, keep special secret/import restrictions and prevent permission regressions. Add negative tests across tenant, actor, outlet, role and revoked session.
> 5. **Complete Staff & Assignments UX honestly:** Server-backed Staff directory, fixed-role effective permission matrix, guided Create operator → Set initial password → Assign outlet/workspace → Verify sign-in, safe resume and clear incomplete states. Retain current audited API authority and account safeguards. Custom role/per-permission editor is currently missing; do not invent fake UI controls or claim physical device pairing.
> 6. **Hard test and release gate:** Automated TypeScript, API integration, browser and real PostgreSQL E2E, green GitHub Actions both jobs, actual Bun container, Nginx proxy response integrity, Firefox and Chromium, desktop/mobile, offline/PWA refresh, at least 30 serial configuration GETs plus controlled concurrent reads. Ship before/after per-route latency tables, sample size, request completion/error rates, payload sizes, and a full role-based access matrix. Target ≤1.5 s p95 configuration metadata API and ≤3 s p95 first useful common workspace on a declared reference network; never allow indefinite loader even if targets cannot be met. No test writes to production. Roll out only immutable green `main` SHA artifacts after a verified encrypted off-host restore checkpoint. Update only MAZAO API/PWA; keep PostgreSQL data, previous release/rollback evidence, other VPS stacks, IndexedDB recovery and existing styling intact. No volume deletion, destructive migrations, blanket cache clearing, or Nginx-wide changes.
>
> Work as several **reviewable PRs**, with P0 load reliability + security first, profile/data-path reduction second, image separation third, all-route polish fourth, and staff onboarding fifth. Report unresolved evidence honestly; do not stop at a health endpoint returning 200.

**Boundary:** This plan is based on source review and user-supplied production observations. It does not claim that code fixes have already been implemented or that load problems in every MAZAO screen have been observed. All additional screens must be measured.
