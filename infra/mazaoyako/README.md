# Mazao Yako VPS deployment

This is an additive deployment for `mazaoyako.co.ke` and `api.mazaoyako.co.ke` on `38.247.142.209`. It owns Compose project `mazaoyako`, database volume `mazaoyako-postgres-data`, network `mazaoyako-private`, API loopback port `127.0.0.1:4102`, and two new Nginx site names. PostgreSQL has no published host port.

## Release gate

Use a successful push-to-main workflow for one full source commit SHA. Confirm that the workflow completed the migration fresh/rerun checks, API tests, PWA browser and cross-browser suites, real PostgreSQL browser integration, Yako cross-origin acceptance, production PWA build, and production API image validation. Download only `mazaoyako-pwa-<sha>` and `mazao-api-image-<sha>` from that run. The PR run is not a release artifact.

The API workflow artifact contains the exact `mazao-api-image.tar` file. Keep its contents byte-for-byte and name the local copy `api-<sha>.tar`. Extract the Yako PWA workflow artifact, then package its contents without changing files:

```powershell
tar -czf pwa-<sha>.tar.gz -C .\mazaoyako-pwa-<sha> .
Get-FileHash .\api-<sha>.tar -Algorithm SHA256
Get-FileHash .\pwa-<sha>.tar.gz -Algorithm SHA256
```

Keep the workflow URL, commit SHA, artifact names, hashes, and published API image digest in the release record. Upload those two files to `/srv/mazaoyako/incoming/` after host preparation. The activation script rejects a PWA archive with absolute paths, parent traversal, links, or special files and verifies the API image's embedded source revision.

## Prepare host and HTTPS

Run these steps as the VPS `administrator` account after confirming the DNS A records still point to this server and before introducing a tenant:

1. Copy `infra/mazaoyako/` from the reviewed release to a temporary directory on the VPS. Do not copy `.env.example` over a live `.env`.
2. Run `bash prepare-host.sh <full-main-sha>`. This refuses an existing `/srv/mazaoyako`, generates independent database and credential-fingerprint secrets, writes them only to `/srv/mazaoyako/.env`, and installs the dedicated Compose file.
3. Run `bash install-nginx-sites.sh`. It adds only `/etc/nginx/sites-available/mazaoyako` and `/etc/nginx/sites-available/api.mazaoyako.co.ke`, enables only their corresponding symlinks, obtains certificates with the ACME webroot challenge, validates Nginx, then gracefully reloads it. It stops if either site name already belongs to another file or symlink.
4. Upload the two artifact files and their SHA-256 values, then run `bash activate-release.sh <sha> <api-tar-sha256> <pwa-tar-gz-sha256>` from the staged configuration directory.

The existing Mazao API sees Nginx's loopback-published connection from its Docker bridge gateway (`172.25.0.1`). Yako pins its own non-overlapping bridge to `172.26.0.0/24` and trusts only that network's host gateway (`172.26.0.1`), so Fastify can use Nginx's client forwarding header without trusting other containers or client IP ranges. The activation record must include the same held-open socket check on the Yako API before owner bootstrap.

## Initial owner and browser acceptance

The activation script runs both migration passes against the new empty database, starts only the Yako API and database, checks their bindings and readiness, verifies allowed and rejected CORS preflights, activates the static PWA by an atomic symlink, and checks both HTTPS hosts.

Run `bash bootstrap-initial-tenant.sh` interactively after activation. It refuses a non-empty tenant table and uses the application's terminal prompts for actual owner/business details and a hidden password. Do not put the owner password in a command, shell history, `.env`, or deployment artifact. Record the business name and owner email, but not the password.

Complete a real browser session on `https://mazaoyako.co.ke` with the owner account. Verify login, reload/session restoration, a CSRF-protected settings change, protected image loading, a CSV download, logout, and rejection of a foreign Origin. Record the observed API image digest, database identity, TLS certificate names/expiry, and acceptance results.

## Preservation checks

Capture before and after evidence for all existing container IDs, status and health; Docker volumes, networks, listening ports; hashes of every pre-existing Nginx site block; and existing Mazao, ServeOS and SMS health endpoints. The before snapshot for this pilot is `yako-predeploy-baseline-20261030.txt`. A changed existing project or site hash is a stop condition. Do not run Compose commands without the `--project-name mazaoyako` and dedicated `-f /srv/mazaoyako/compose.yml` arguments.

## Checkpoint limitation

The initial encrypted same-server checkpoint and isolated restores are recorded in [`../BACKUP-RUNBOOK.md`](../BACKUP-RUNBOOK.md). Its VPS SHA-256 and pre-encryption database, volume, image, uploaded-file, and host-config restore checks passed. The entire encrypted 9.46 GB object was not downloaded, decrypted, and extracted off-host because the measured transfer was about 0.3 MB/s. This remains an explicit initial-pilot exception; complete and verify an independent off-host restore before routine business writes.
