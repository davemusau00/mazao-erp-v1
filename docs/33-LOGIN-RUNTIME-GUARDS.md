# Login throttling and production runtime guards

This slice addresses audit F01 and the runtime configuration part of F06. It does not configure GitHub branch protection or activate a release.

## Operator behavior and HTTP contract

`POST /api/v1/auth/login` permits eight requests per client IP in a one-minute window. The ninth returns HTTP `429`, the normal API error shape `{ "error": { "code": "RATE_LIMITED", "message": "Too many sign-in attempts. Try again shortly." } }`, and `Retry-After` in seconds. Rate-limit headers report the remaining allowance. The sign-in form displays the server's retry message and stays signed out. Successful logins and authenticated workspace-choice requests also count; changing an email or adding a forwarding header does not reset the client's allowance.

The login route registers after the rate-limit plugin's route hook is installed. `buildApp()` remains synchronous; callers continue to use `await app.ready()` or `app.listen()`. Boot errors are propagated, and the API error handler preserves HTTP 429 instead of converting it to an internal error. The limit is held in the current API process; restarting clears its counters. This slice does not claim a shared limit across multiple API replicas.

## Trusted ingress

`TRUSTED_PROXY_IPS` accepts at most 16 comma-separated literal IP addresses. Empty means no trusted proxy: the socket peer determines the client IP and client-supplied forwarding headers are ignored. Wildcards, hostnames, CIDRs, boolean blanket trust, and malformed lists fail startup. Every configured address must belong to verified ingress under operator control.

The current deployment uses host Nginx and a loopback-published Docker API port. Verify the exact socket peer observed by the API before setting this value; with Docker port forwarding it may be the dedicated bridge gateway rather than `127.0.0.1`. Configure that exact address in `/srv/mazao/.env`, using the Compose pass-through in `infra/docker-compose.example.yml`. Do not guess a bridge address or trust an entire private network. If it changes, verify and update the setting before activation. An unset value remains safe against header spoofing, but clients seen through the same ingress will share one login allowance.

Nginx must retain `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`. With the exact ingress trusted, Fastify walks from the socket toward the first untrusted peer. A client-supplied address prepended before Nginx's actual peer cannot rotate the effective IP; independent real clients have independent allowances. Deployments with additional proxies require separately verified ingress configuration.

## Production configuration gate

Before a production API can listen, application construction requires exact `APP_ORIGINS` and a `CREDENTIAL_FINGERPRINT_KEY` of exactly 64 hexadecimal characters. Errors name the setting and required format without printing its supplied value. The existing database URL requirement also remains in force. Development may omit the credential key; credential-changing operations continue to reject an unconfigured service.

Generate the credential key once with `openssl rand -hex 32`, keep it outside Git in the protected production environment, and preserve it across releases, restarts, and restores. Replacing it is not a routine repair: existing credential-command fingerprints depend on it. Readiness continues to check database connectivity, while invalid required production configuration now prevents the process from reaching readiness at all.

The production-container CI lane checks that missing and malformed credential keys cause startup failure, then starts the same built image with a generated disposable key and verifies PostgreSQL readiness. The generated key is not echoed. Staff credential integration acceptance still exercises the protected password operations and their persisted effects.

## Acceptance and delivery boundaries

- Focused API tests exercise the actual login route: requests 1-8, ninth-request 429 and retry headers, independent clients, ignored headers on untrusted sockets, and spoofed prefixes through a verified ingress. These checks reject malformed credentials before any database query; they do not mock the rate-limit plugin.
- Configuration tests cover missing/malformed production keys, secret-free errors, application-construction failure, and bounded proxy configuration.
- The real browser integration lane submits invalid credentials against the actual API and PostgreSQL, verifies the ninth rejection's retry message, and confirms another client remains available. It creates no business records. Existing configuration, CSV, and staff fixtures represent separate terminals through an explicitly trusted disposable loopback ingress; they keep the same production limit enabled.
- No database migration, financial/stock mutation, UI permission expansion, or offline operation is introduced. Runtime rollback uses the prior compatible API image; preserve the existing credential key and forward database history. GitHub policy changes and production deployment require their own actions.

Local verification on 16 October 2026: UI/API typecheck passed; migrations 001-016 passed fresh and checksum rerun in the task-owned PostgreSQL 16 database; the full API suite passed **68/68 with zero skips** using `npx tsx --test --test-concurrency=1 apps/api/test/*.test.ts`. An earlier parallel run on a database shared with other active work exhausted existing serialization retries in room/import cases; it was not a login-throttle failure. Parallel release-CI behavior still needs the exact submitted commit's hosted checks. `npm run test:integration` built the PWA and passed **10/10 real browser/API/PostgreSQL cases**, including login throttling and the existing configuration, CSV and staff journeys. The browser suite used the separate task-owned `mazao_configuration_test` database. Image results are recorded in the accompanying delivery report once completed.
