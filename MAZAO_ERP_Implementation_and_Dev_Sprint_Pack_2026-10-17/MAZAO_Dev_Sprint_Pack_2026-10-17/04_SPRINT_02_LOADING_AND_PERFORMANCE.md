# Sprint 02 | Eliminate indefinite loading and actually measure performance

**Priority:** P0 · **Suggested effort:** 2–5 engineering days for stabilization, ongoing performance iteration · **Owner:** frontend/API/reliability · **Parallel with:** Sprint 01 diagnostics.  
**Status:** PR #18 adds 10-second slow warnings, 20-second GET deadlines, request IDs, timing telemetry, response validation, cancellations and many view-level retries. Its current CI has not run the required browser stages. **The underlying production `/configuration` stall remains unproven.**

## Non-negotiable user-facing contract

Every **connected** MAZAO route, including login/session restoration, Today, Sell, Sales, Stock, stock count, Purchasing, Hotel/Reservations, Customers, Shifts, Money, Reports, Manage, Staff, Assignments, My Account and CSV import must have:

- **State machine:** `idle → loading → usable|empty|error|offline|unauthorized|cancelled`, with a slow warning during loading. No dependency may leave the page permanently awaiting data.
- **Explicit bounded reads:** warning after 10 seconds, 20-second overall GET deadline including body consumption, visible retry, request ID and a failure message without raw sensitive response.
- **Honest partial rendering:** the independently loaded catalogue remains visible if stock movements fail; Staff/Assignments work if configuration GET fails; Today shell needn't await shift data.
- **Safe concurrent navigation:** cancel obsolete GET requests on route/filters/unmount; ignore stale responses with generation guards; preserve unsaved forms and in-flight commands.
- **Financial mutation discipline:** 30-second request deadline may return `OUTCOME_UNKNOWN`; retained original command and status inspection are mandatory. Never silently retry with new UUID.
- **Accessibility:** `role=status` for progress, `role=alert` for failures, keyboard-operable retry, visible focus, no multi-minute screen reader announcements.
- **Recovery durability:** do not delete IndexedDB, service-worker caches or pending command records as an indiscriminate 'loading fix'.

## Confirmed incident data, not assumptions

- Browser `GET /api/v1/auth/me` returned HTTP 200 in an authenticated session.
- `GET /api/v1/configuration` once delivered malformed JSON around character 163,546.
- The same endpoint later delivered a **683,935-byte**, HTTP 200, byte-consistent, valid JSON body.
- Another request aborted after 10 seconds before successful body completion.
- Service worker was active in Firefox. No end-to-end trace yet attributes fault to PostgreSQL vs Bun/Fastify vs Nginx vs browser.
- `main` auth middleware unnecessarily projected `t.business_profile` into every authorized read; PR #18 projects tax policy instead. That is a confirmed optimization, **not proof of the 10-second stall's cause**.

## Work package A: route inventory and UI loader review

Use `src/app/featureRegistry.ts`, the route component tree and `docs/43-LOADING-STAFF-BUILDOUT-STATUS-2026-10-16.md`. For every connected workspace record:

| Dimension | Required information |
|---|---|
| Initial reads | Endpoint sequence and waterfall/dependency edges |
| Permission | Role, capability and selected assignment required |
| Starting state | skeleton, loading label, editable controls enabled/disabled |
| Failure state | 401, 403, 429, 500, missing fields, invalid JSON, truncated body, offline, timeout |
| Actions | retry read, copy safe request ID, access recovery, sign-in or permission explanation |
| Navigation | abort on leave, preserve unsaved edits, retained command evidence |
| Performance | JS chunk, TTFB, body duration, parse, first usable state, request bytes |

Document each in the test matrix (file 08); add tests for the untested entries in `docs/43`. Never count a disabled restaurant card as a loaded server-backed restaurant module.

## Work package B: shared `apiClient` correctness

Review actual `src/services/apiClient.ts` on PR #18 rather than replacing it wholesale. It already defines `READ_TIMEOUT_MS=20_000`, slow warning, `ApiClientError`, `x-request-id`, server timing, response-shape checks and request cancellation.

Checklist:

1. Timeout covers both **fetch headers and response-body reading**, not just the header wait.
2. JSON failures throw explicit `INVALID_SERVER_RESPONSE`. Do not turn HTTP 200 into `{}` or `[]`.
3. A `401` that genuinely means authentication expired ends the session and shows sign-in; a `403` keeps the authenticated session while explaining permission denial. Neither should spin forever.
4. A `429` login response surfaces backoff and Retry-After; the rate limit is not bypassed.
5. Independent GET clients accept `AbortSignal`; aborted old route requests cannot update new route state.
6. Never use a GET retry mechanism automatically on mutations, credential uploads or commands.
7. Slow banner cleans itself up on success/failure/navigation; multiple simultaneous requests are aggregated rather than racing banners.
8. No PII, cookies, credentials, image contents, bearer tokens or raw response bodies in telemetry or public error IDs.
9. POST asset uploads and generic business commands must have **separate** retry contracts (idempotent upload draft vs unknown authoritative command).
10. Keep local pending command metadata until server confirms final status; 404 alone may be insufficient for secret operations.

## Work package C: three-hop `/configuration` diagnosis

**Never use real production credentials in command lines pasted to chat or committed tests.** In a controlled disposable environment, replay a tenant with both large 512 KiB PNGs, Unicode names and representative history. On the production system, collect only read-only metadata and sanitized timings under an authorized session.

### Hop 1: DB and API

- Inspect `pg_stat_activity`, transaction wait events, pool active/idle/waiting, slow queries, PostgreSQL logs, and `pg_column_size`/`octet_length` of image fields (sizes only). Do **not** output image strings.
- Instrument `pool.connect()` wait, auth preHandler SQL duration, `getConfiguration` subquery durations, JSON serialization and first-byte time. Prefer `Server-Timing` and safe request IDs.
- Examine snapshot transaction: capability count queries, initial readiness count subqueries, repeated `currencyLocked` EXISTS checks. Only optimize confirmed expensive paths; check indexes and query plans with disposable data.
- Measure serialized full profile vs projected `business_profile->'taxPolicy'`, and compact configuration vs legacy body. Test Unicode byte length.

### Hop 2: API container → Nginx

- On **disposable/staging**, compare direct API and reverse-proxied authenticated requests to the same fixture. Record HTTP status, TTFB, total, content encoding, byte length and digest, unique safe ID.
- If upstream complete and proxy truncates: examine `proxy_read_timeout`, buffering, upstream keepalive, premature close and HTTP framing. Avoid changing shared/global Nginx for other apps.
- If API itself stalls: investigate DB waits, Bun/Fastify, serialization and event loop under load.

### Hop 3: Nginx → Firefox PWA

- Use a controlled Firefox profile with and without service-worker interception (do not clear operator's actual IndexedDB), then Chromium desktop/mobile emulation.
- Repeat 30 cold/warm requests with a cache-busting query string; capture status, timing, byte count and JSON digest only. Tests should include Unicode and interrupted bodies.
- If response is intact but React page stays blank/spinning, inspect the state machine, stale request cancellation, render exceptions, content-security errors and workspace dependency waterfalls.

## Targets (provisional SLOs; baseline required)

| Measure | Target in documented reference setup |
|---|---|
| Typical configuration **metadata** JSON | <=32 KiB (existing PR fixture asserts this) |
| `GET /configuration` p95 | <=1.5 s at defined 30+ request baseline |
| Implemented common workspace p95 first usable | <=3 s, with 10 concurrent simulated operators |
| Slow-read user warning | At 10 s, with safe request ID |
| Ordinary GET terminal deadline | 20 s including headers and body |
| Non-financial error behavior | Visible useful error and functional Retry, never infinite spinner |
| Confirmed transaction | Status and receipts correct under lost response and repeated recovery |

Targets must state environment, fixture sizes, device/browser, request count, warm/cold condition, p50/p95/p99 and error rate. A fast mock does not substantiate a production SLO. If p95 misses the target, document the bottleneck and require another measured iteration before declaring performance complete.

## Failure injection matrix

For every connected workspace simulate: delayed headers, delayed body, truncated JSON with 200, invalid response shape, offline before and during GET, `401`, `403`, `429`, `500`, stale response after navigation, SW update/reload, concurrent operations and abandoned route. For stock, payment, shift, staff, hotel mutations also inject **response lost after commit** and prove exact original command recovery.

## Tests and source locations

- `e2e/configuration.spec.ts`: malformed JSON, warning, Retry and performance metadata, preserve Staff independent of configuration.
- `e2e/workspace-recovery-readiness.spec.ts`: reload, route change, local recovery, correct status locator scopes.
- `e2e/integration/configuration.spec.ts`, `staff-access.spec.ts`, `stock-count.spec.ts`: production-shaped PostgreSQL flows.
- `src/components/home/BackendTodayWorkspace.tsx`, `inventory/BackendInventoryWorkspace.tsx`, `inventory/BackendStockCountWorkspace.tsx`, `procurement/ProcurementWorkspace.tsx`, `hospitality/BackendHotelWorkspace.tsx`, `shifts/ShiftManagerView.tsx`, `manage/BackendManageWorkspace.tsx`, `AppShell.tsx`.
- Audited but not fully validated route matrix: `docs/43-LOADING-STAFF-BUILDOUT-STATUS-2026-10-16.md`.

## Done gate

- [ ] A root cause or narrowed causal boundary for intermittent config delay/truncation is documented with before-and-after evidence.
- [ ] Every connected route reaches a terminal usable/empty/error/offline/auth state within its contract; no silent swallowing of malformed JSON.
- [ ] State preserved across errors, refresh, cancellations, installation and session expiry.
- [ ] Real Firefox/Nginx/Bun and Chromium/staging acceptance run; representative datasets and network profiles recorded.
- [ ] Measured p95 targets met or formally blocked with explicit owner and incident reproducer; avoid claim of performance success from only timeout logic.
- [ ] Security and command integrity regression passes, including lost response after authoritative commit.
