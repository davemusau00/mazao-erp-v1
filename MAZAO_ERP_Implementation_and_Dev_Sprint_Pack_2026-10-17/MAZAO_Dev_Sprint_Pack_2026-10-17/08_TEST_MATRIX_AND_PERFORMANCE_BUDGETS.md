# MAZAO | Regression, acceptance and performance evidence matrix

**Rule:** a missing test, skipped required check, unmeasured SLO or failure masked by stubs is NOT a pass. Record exact SHA, browser/runtime, database fixture, run timestamp, pass/fail/skips and artifact links. Never run destructive tests on production.

## Evidence tiers

- **L0 static:** source review, typecheck, schema diff, unit tests.
- **L1 disposable API+PostgreSQL:** migrations, actual SQL constraints, concurrent requests and monetary invariants.
- **L2 browser+real API+PostgreSQL:** authenticated users, recoverable commands, navigation and responsive surfaces.
- **L3 production-image/proxy/staging:** Bun container, Nginx framing, Firefox installed PWA/service worker, degraded networks, realistic sizes.
- **L4 live non-destructive smoke:** verified release identity, readiness and read-only selected business screens, tenant isolation and operator sign-in. Never generate fake stock or sales in the real business.

## Required CI stages

| Stage | Command/job | Gate |
|---|---|---|
| Install | `bun install --frozen-lockfile` | Lockfile unchanged unless reviewed |
| Fresh schema | `bun run db:migrate` on disposable DB | All migrations apply, no collision |
| Rerun | `bun run db:migrate` same DB | Checksums match |
| Typecheck | `bun run typecheck` | 0 errors |
| API | `bun run test:api` | All required real-DB cases green |
| Browser | `bun run test:e2e` | All supported UI tests green |
| Real DB browser | `bun run test:integration` | All accepted journeys green |
| Image | `.github/workflows/ci.yml` publish-api-image job | Container smoke, key guard, 429, readiness green |
| Promotion | main push with both build jobs green | Immutable API/PWA same full SHA |

The latest candidate CI run `39040137815` stopped at `test:api` (93/95), skipping browser/image stages. **Do not infer those stages passed because earlier local docs recorded success.**

## Critical business invariant cases

| Case | API+DB | Real browser | Assertions |
|---|---|---|---|
| Mixed stock count gains > losses | yes | yes | Gross debit/credit lines one-sided, balanced journal, exact quantity/value |
| Mixed gains = losses | yes | yes | Both gross adjustments retained, no net-value shortcut losing evidence |
| Stale count after sale | yes | yes | Explicit conflict, physical draft preserved, no partial mutation |
| Existing 74-line unposted count | simulated clone only | controlled | No automatic reset or opening import overwrite |
| Sale lost response after DB commit | yes | yes | Original command ID replay, one order/payment/journal |
| Same UUID different payload | yes | yes | Safe idempotency mismatch/rejection |
| Staff cross-actor status lookup | yes | yes | Sanitized 404, no result data leak |
| Last-admin concurrent changes | repeat race | yes | One admin remains, no 500 |
| Password reset after response lost | yes | yes | No secret persisted; original status fenced |
| Configuration large PNG/Unicode | yes | yes | Exact asset bytes, small GET, no truncated JSON |
| Receipt after logo/tax/settings changed | yes | yes | Historical snapshot reprints unchanged |
| Hotel midnight/DST/timezone | yes | yes | Calendar date text accurate, no accidental day shifts |
| Customer statement concurrent posting | yes | yes | Consistent snapshot, balance/source match |
| Session revoked while loading | yes | yes | Sign-in/error transition, no stale privileged data |
| Role downgraded during write | yes | yes | Transaction-time denial, history still readable per policy |

## Per-route read fault matrix

Run per **connected** route, not mock-only smoke:

| Fault | Expected UI result | Safe retry? |
|---|---|---|
| HTTP 200 valid empty record/list | Honest empty state | yes when refreshed |
| HTTP 200 truncated JSON | Invalid-response error; no empty fake data | GET yes |
| HTTP 200 wrong shape | Invalid-response error | GET yes |
| 401 | Auth lost; sign in; don't treat as no records | after auth |
| 403 | Permission denied, session retained | after authorized change |
| 429 | Visible throttling/backoff | respect Retry-After |
| 500/502/504 | Available portion remains usable; error with request ID | GET yes |
| Headers delayed 11 s | Slow warning, still waiting within deadline | GET yes after failure |
| Body stalls to 20 s | Terminal timeout and retry | GET yes |
| Offline before fetch | Offline message / retry after reconnect | GET yes |
| Navigate away mid-read | Cancel request, no stale UI overwrite | not required |
| Service worker upgrade | Correct assets/version and local command journal intact | recover |
| POST response lost **after commit** | Outcome unknown + retained original UUID | status or identical replay only |

## Latency budgets, measurement methodology

These are **targets**, not existing measured guarantees:

| Signal | Budget | Sample method |
|---|---|---|
| `/configuration` compact body | <32 KiB for representative configured tenant | Body bytes over 30 reads |
| `/configuration` p95 | ≤1.5s | 30+ GETs, warm/cold separately |
| Common route first usable p95 | ≤3s | 10 concurrent operators, real fixture data |
| Read slow warning | 10s | Inject 11s header/body waits |
| GET max wait | 20s incl. body | Inject never-ending stream |
| Business mutation unknown outcome | visibly fenced after 30s client deadline | Delay commit response then status query |
| Integrity/error rate | 0 truncated-success bodies and 0 silent blanking in sampled test | Compare byte/digest and JSON parse |

Collect per request: route template, browser/runtime version, status, service-worker state, warm/cold flag, response `content-length`, actual bytes, TTFB, download/body time, JSON parse time, first usable render, total time, database size profile and server app timing header. Calculate p50, p95, p99 with actual observations and attach summaries; don't print cookies, names, image data or raw HAR publicly.

## Reference fixture profile

Prepare **disposable** tenant(s) with: 1/10/500 staff, at least two outlets, 1,000 product rows, 74 stock count lines including mixed variances, 10,000 inventory movements (or a documented bounded substitute), realistic shift/order/customer history, 100+ booked hotel nights, maximum supported PNG logo and payment QR, Unicode names and varied role permissions. Derive distribution only from safe synthetic data, not production PII. Add both cold and warm browser cache fixtures.

## Accessibility and UX checks

- Seven PRD viewports plus desktop, tablet and phone touch input; check Staff, Manage, stock counts, Sell and hotel screens.
- Keyboard-only navigation to Retry, field errors and protected confirmation; visible focus; ARIA live announcements not duplicated.
- Large image/media + slow network must not block all settings tabs.
- Screen must never display 'Loading...' permanently; timeout and Retry are observable in the DOM and by assistive technology.
- Current visual style/spacing/cards/menu must remain equivalent. Store before/after screenshots in test artifacts.

## Release evidence worksheet

```text
Candidate commit SHA:
Main ancestry reconciled: YES / NO
Migration list and checksums:
Schema upgrade source + destination fixture:
Typecheck:
API tests (pass/fail/skips):
Mock browser (pass/fail/skips):
Real API/Postgres browser (pass/fail/skips):
Production Bun container job:
Firefox + Nginx + SW delayed-response tests:
Before/after p50/p95/p99, config bytes:
Auth/command replay/cross-actor evidence:
Staff provisioning owner-manager-cashier matrix:
Receipt/logo/QR and stock count preservation:
Off-host encrypted backup timestamp + restoreVerified:
Deployment SHA / previous SHA:
Unrelated services verification:
Decision: PASS / HOLD / ROLLBACK
Reviewed by:
```
