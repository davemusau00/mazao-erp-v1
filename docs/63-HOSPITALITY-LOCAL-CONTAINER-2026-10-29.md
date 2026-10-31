# Hospitality configuration: local API container evidence

Verified **29 October 2026 (Africa/Nairobi)** for the unpublished restaurant
configuration worktree described in [P1.1](62-RESTAURANT-CONFIGURATION.md).
This is local disposable-image acceptance, not hosted CI or deployment evidence.

## Image and source identity

| Evidence | Observed value |
| --- | --- |
| Local image tag | `mazao-hospitality-p1:20261029-config` |
| Docker image ID | `sha256:a4f4feddb0319a0b7b48a0eecc581d98e53e996f2d0fad6d73650d7f44d61dfc` |
| Platform manifest | `sha256:cdb79bf948cefc0c8834843eef1973de41c77b8605fe784d8074ff8d479f6152` |
| Base | `oven/bun:1.4.3-slim@sha256:14a223fa35747ec728bce300ef85888bc5f7958164d15bbba6a54b22b52a3288` |
| Runtime | Bun `1.4.3`, Linux `amd64`, configured user `bun`, observed UID `1000` |
| Source base | `e595d9789270192bcf6f37a28e8346b055e3c59d`, with unpublished worktree changes |
| Context manifest SHA-256 | `754a14c83c75f808057da7f94b95382df388aa9c206204339eb32aec7f8c48b5` |
| Migration 029 SHA-256 | `b6cbf43ad2c14e6004e650d4b81685f8e6208df5b319019c66e398aea93d9602` |

The restricted build context contains **77 files**: only `Dockerfile.api`,
`package.json`, `bun.lock`, and `apps/api/{src,migrations,scripts}`. It excludes
workspace artifacts, environment files, tests, frontend output and documentation.
All 77 files still matched their source checksums after acceptance. The image
labels record `local.mazao.source-base`, `local.mazao.context-sha256` and
`local.mazao.dirty=true`. Inherited `org.opencontainers` labels describe the Bun
base image and must not be mistaken for a committed Mazao release identity.

Build used the existing pinned Dockerfile with `--pull --platform linux/amd64`
and `bun install --frozen-lockfile --production`; matching Docker layers were
cached. The first PowerShell invocation stopped on Docker's progress output
written to stderr. Rerunning with separate process log redirection completed
successfully. No source or dependency changes were made for the container check.

## Acceptance performed

Created only database
`mazao_restaurant_container_acc87660e6ab4140935dc9cc6b2a66d6` in the existing
task-owned disposable PostgreSQL container on local port `55435`. Container
connections used `host.docker.internal`; credentials and the generated disposable
fingerprint key stayed in process environment variables and were omitted from
evidence output.

| Check | Result |
| --- | --- |
| Fresh migrations inside built image | All **29** applied, ending at `029_restaurant_configuration` |
| Second migration pass inside same image | All **29** existing checksums matched |
| Fresh database migration state | Count `29`, head and 029 checksum matched source |
| Production runtime without `APP_ORIGINS` | Rejected before listening, exit `1` |
| Production runtime without fingerprint key | Rejected before listening, exit `1` |
| Production runtime with malformed fingerprint key | Rejected before listening, exit `1` |
| Valid production runtime | Started with read-only root filesystem and temporary `/tmp` |
| `GET /api/v1/health/live` | `200`, `status=live` |
| `GET /api/v1/health/ready` | `200`, database available |
| Unauthenticated restaurant configuration | `401` |
| Nine malformed login attempts | First eight `400`; ninth `429` with `Retry-After: 60` |

The generated API container bound only `127.0.0.1:4411`. Its logs were collected,
then that exact container was stopped and removed. The existing PostgreSQL
container remained running. The generated database, local image and sanitized
artifacts were retained. No production database, unrelated container, shared
image cleanup, registry publish or remote action occurred.

## Retained artifacts and limits

Artifacts are under `dist-artifacts/hospitality-p1-configuration/`:

- `container-context-manifest.json` and restricted `container-context/`.
- `container-build.stdout.log`, `container-build.stderr.log`.
- `container-migration-1.log`, `container-migration-2.log`,
  `container-migration-state.json`.
- `container-runtime-missing-origin.log`, `container-runtime-missing-key.log`,
  `container-runtime-invalid-key.log`.
- `container-acceptance.json`, `container-final-checks.json`, `container-api.log`.
- Task container start/stop/remove logs and `validate-local-container.ps1`.

This smoke checks the production dependency image, fresh/rerun migration path,
runtime validation, readiness, authentication boundary and login throttle.
Authenticated restaurant mutation/browser journeys are covered by the separate
API and browser acceptance runs, not claimed as container smoke results.
Hosted exact-head CI, production activation/schema, backup/restore acceptance,
physical KOT printing, KDS devices and full-v1 acceptance remain separate gates.
