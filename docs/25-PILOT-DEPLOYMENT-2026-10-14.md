# Mazao pilot deployment evidence — 14 October 2026

## Initial release

- Host: 93.127.131.55; canonical origin: https://mazao.davemusau.co.ke.
- Initial API and PWA source: b38496ae577264e771426360bca9d0acdf9c7f28.
- [Initial release CI](https://github.com/davemusau00/mazao-erp-v1/actions/runs/38569102463): 10 API tests passed, no failures/skips; 3 browser tests passed; TypeScript, fresh migrations, checksum replay and production-container readiness passed.
- Published GHCR digest: sha256:a2e575de4212ce948aa9c5fb91194fd244b9727f916f3c40f90767f189b04474.
- API artifact ZIP digest matched GitHub's sha256:31a040666b1cf71d32ac7e93cf693d4129f38213fa686a2880f4bf1c3ae0db9a. Local and server image archive hashes also matched.
- Dedicated Compose project mazao, network mazao-private, PostgreSQL volume mazao-postgres-data; no database host port. API publishes only 127.0.0.1:4101.
- All 13 migrations applied on the VPS. A second run verified all applied checksums. Both containers reported healthy.
- The application TLS certificate was issued for mazao.davemusau.co.ke and expires on 12 January 2027. Its renewal uses the dedicated /var/www/mazao/acme webroot.
- HTTPS app and /api/v1/health/ready returned 200 from the host and public origin. The initial PWA rendered at 1280×720 and 390×844 without uncaught JavaScript errors.

## Protected services

All six baseline hashes for the existing Nginx main configuration and five enabled sites matched after Mazao activation. The existing domains retained their baseline responses: business site 200, ServOS PWA 200, ServOS API root 404, and the two SMS roots 307. The API root's 404 was present before Mazao deployment and is not a readiness test. Existing containers remained running with their original images and ports. No existing application's database or Compose project was used for Mazao.

## Off-host recovery

An encrypted Windows DPAPI checkpoint was downloaded from the new database, decrypted, and restored into a disposable PostgreSQL 16 container with no network. A second checkpoint after initial tenant setup also restored successfully: 13 migrations, one tenant, zero orders, zero journals and zero unbalanced journals. The temporary restore container and plaintext dump files were removed.

The Windows PC has a daily encrypted backup task at 02:15 Nairobi time and a Sunday restore verification task at 02:45. The daily task was manually triggered and returned result 0. The tasks run as the logged-in Windows account; this PC must be on and the account available. No cloud destination, continuous backup guarantee, portable encryption recovery, measured RPO/RTO or provider integrations are claimed.

## Authentication correction

The initial frontend showed its prototype preview after an unauthenticated session response. The production build now requires server sign-in and provides no demo fallback. The shared sign-in form submits actual input values, including password-manager autofill. Tests cover rejected credentials, sign-out and the production session boundary.

The initial local setup helper created the owner-supplied tenant and administrator. Its subsequent report probe failed because the request omitted the required asOf date; the helper was corrected. The live administrator has one active membership/device/outlet assignment. No duplicate tenant or demonstration transactions were created. Passwords remain in local interactive prompts and are never recorded in this evidence.

## Rollback

The initial Nginx snapshot and previous Mazao site configuration are under /srv/mazao/backups. Immutable PWA releases are under /var/www/mazao/releases. For rollback, restore only the previous Mazao static symlink, compatible API image and Mazao site, validate Nginx, and reload gracefully. Preserve the PostgreSQL volume and applied migrations; never run Compose down with volume deletion or restore an unrelated application.
