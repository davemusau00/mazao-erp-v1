# MAZAO production release evidence — 19 October 2026

## Release decision

**Deployment: PASS.** Release `ce5b8aba597ca5077aa1b4eb45e2aabc12a4a847` is active on production. Exact-main CI, artifact integrity, the current-data isolated restore, migrations, post-release data checks, browser smoke, and protected-service checks passed.

**Technical performance acceptance remains FAIL.** The product owner accepted the documented performance exceptions in [the performance report](44-PERFORMANCE-ACCEPTANCE-2026-10-18.md). This deployment does not establish the 1.5-second API-read or 3-second first-usable-workspace targets and is not a claim that the earlier loading issue is fixed.

## Release identity and artifacts

| Property | Evidence |
|---|---|
| Main commit | `ce5b8aba597ca5077aa1b4eb45e2aabc12a4a847` |
| Pull request | [PR #22](https://github.com/davemusau00/mazao-erp-v1/pull/22), merged to `main` |
| Exact-main CI | [Run 39154620144](https://github.com/davemusau00/mazao-erp-v1/actions/runs/39154620144), success on the exact release SHA |
| API image | `ghcr.io/davemusau00/mazao-erp-v1/api:ce5b8aba597ca5077aa1b4eb45e2aabc12a4a847` |
| API registry manifest | `sha256:21e71c43d32152117669a03b685f424517d3634202845cc24c2b2c02ca8868e0` |
| API transfer ZIP SHA-256 | `9ca177b38ffd27494ca10e5c430072963d37025ab501422a6d655656d7be4b66` |
| PWA transfer archive SHA-256 | `84c3c513f07c43210594bbcfd35f3b1f38779ae340b52e832821b7a983fbec75` |
| Activation helper SHA-256 | `e7f013f9825ee749c375e061377cc16e4c9d63b5a714c3ad62f65b326ac544df` |
| Active API and static release | Commit `ce5b8aba597ca5077aa1b4eb45e2aabc12a4a847` |

The checksum-gated activation helper applied migrations 018–020 and reran migration checksums. All 20 migrations through `020_account_display_catalog` were present with matching checksums. The API container became healthy and the release helper completed its readiness checks.

## Recovery checkpoint

A fresh production dump was captured at 2026-10-19 13:41:48 UTC and saved as the Windows DPAPI-encrypted checkpoint `20261019T164112-e192d97609644eb68b366e0df9d0a119.dump.dpapi`.

- Encrypted checkpoint SHA-256: `22c62711156da69c37986880a0457f3b11b3f3ed5c45cfa27f8e8a8694a3177e`.
- Restore result: **PASS**, restored with PostgreSQL 16.15 in a temporary workstation instance bound only to `127.0.0.1`.
- Source schema: 17 migrations, head `017_configuration_assets`.
- Restored controls: 1 tenant, 34 orders, 55 order lines, 24 payments, 103 journal entries, 214 journal lines, 81 inventory balances, 234 inventory movements, and zero unbalanced journals.
- Restore metadata records `restoreVerified=true`; the encrypted backup remains available under the operator's Windows DPAPI account.

The temporary restore server was stopped after validation. The production-host plaintext dump and the backup script's transfer scratch were removed. **Local cleanup is incomplete:** automatic action review blocked deletion of the task-specific restore directory `%TEMP%\mazao-pg16-restore-94245ffc67ac440e8f327023a805e60d`, which still contains plaintext restore files and database scratch under an ACL restricted to the current Windows account. Do not treat workstation plaintext cleanup as passed.

## Database integrity

The pre-release and post-release fingerprints cover existing business tables across core, catalogue, commerce, finance, hospitality, inventory, system, and audit schemas. They exclude only the schema-migration ledger and the candidate's explicitly additive columns.

| Evidence | Result | SHA-256 |
|---|---|---|
| Before activation, 33 existing tables | Captured from production immediately before activation | `b304dc2019bb51dad1d0de4a062cde177f4cc04e3575cd0a0348f13359988693` |
| After activation, 49 tables | 33 existing tables match exactly; 16 finance tables were added by migrations 018–020 | `3d679d74af810552357150548a75296b0f479a194d874061af20406216123ffc` |

Machine-readable evidence: [before](performance/production-2026-10-19/data-integrity-before.txt) and [after](performance/production-2026-10-19/data-integrity-after.txt). The restore workstation used UTC when generating comparison fingerprints, matching production timestamp serialization.

After activation, production reported 20 migrations through `020_account_display_catalog`, one tenant, 34 orders, 55 order lines, 24 payments, 103 journal entries, 214 journal lines, 81 inventory balances, 234 inventory movements, no missing migration checksums, and zero unbalanced journals. Existing-table fingerprints show no release-time changes to stored orders, lines, payments, receipt snapshots, journals, stock balances, movements, or historical records.

## Production smoke checks

- API liveness and readiness: **PASS**, HTTP 200; readiness reported the database available.
- Production API image and PWA symlink: **PASS**, both resolve to release `ce5b8aba597ca5077aa1b4eb45e2aabc12a4a847`.
- PWA artifact integrity: **PASS**, all 18 deployed files matched the exact CI package by SHA-256.
- Public PWA: root, referenced CSS/JavaScript/assets, `registerSW.js`, `sw.js`, and `manifest.webmanifest` returned HTTP 200. The service worker and manifest were served with `Cache-Control: no-cache`.
- Signed-out auth checks: `/api/v1/auth/me` and `/api/v1/configuration` returned HTTP 401 as expected.
- Firefox and Chromium signed-out smoke: **4/4** desktop/mobile cases rendered the sign-in screen, had no page errors or server 5xx responses, and had no horizontal overflow. Chromium logged the expected signed-out `auth/me` 401.
- Screenshots and structured results: [browser-smoke.json](performance/production-2026-10-19/browser-smoke.json), [Chromium desktop](performance/production-2026-10-19/chromium-desktop.png), [Chromium mobile](performance/production-2026-10-19/chromium-mobile.png), [Firefox desktop](performance/production-2026-10-19/firefox-desktop.png), and [Firefox mobile](performance/production-2026-10-19/firefox-mobile.png).
- Nginx: privileged `nginx -t` **PASS**. All 20 Nginx configuration file hashes matched the pre-release baseline.
- Protected services: all 21 containers remained present with the same image and published-port inventory except the expected Mazao API image update; the Mazao database and all unrelated ServOS/SMS containers retained their baseline.
- Protected public roots retained expected responses: `detailskilonzo.com` 200, `serveos.davemusau.co.ke` 200, `serveosapi.davemusau.co.ke` 404, `sms.detailskilonzo.com` 307, and `africa.detailskilonzo.com` 307.

The exact-main CI run covered type/API checks, real PostgreSQL integration, production-container migration/readiness smoke, PWA/browser acceptance, and the Chromium/Firefox desktop/mobile matrix. No financial mutations were submitted to live production as part of the smoke checks.

## Acceptance

| Gate | Result |
|---|---|
| Exact-main CI on release SHA | **PASS** |
| API and PWA artifact integrity | **PASS** |
| Fresh current-data isolated restore and journal balance | **PASS** |
| Migrations 018–020 and migration checksum rerun | **PASS** |
| Pre-existing business-table fingerprints | **PASS**, 33/33 unchanged |
| API readiness, PWA assets, browser smoke | **PASS** |
| Protected services and Nginx configuration | **PASS** |
| Workstation plaintext cleanup | **INCOMPLETE**, automated action review blocked task-temp directory removal |
| Technical performance targets | **FAIL**, documented exceptions accepted by product owner |

Production is updated, but the technical performance issue remains open for measurement and remediation. The live browser checks were signed out; financial workflows were validated in CI against disposable PostgreSQL data rather than by writing test transactions to production.