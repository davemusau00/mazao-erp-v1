# CI and release artifacts

## Pull request checks

The GitHub Actions workflow uses Bun 1.4.3 and PostgreSQL 16. It installs from the frozen bun.lock, applies migrations to a fresh test database and reruns them to verify checksums, runs TypeScript checks and API acceptance, then builds the PWA and runs browser acceptance. A failed check prevents release artifact publication.

## Main-branch publication

After the full check job passes on a push to main:

- The PWA dist directory is uploaded as mazao-pwa-<full-commit-sha>.
- Docker builds the API from Dockerfile.api, pushes ghcr.io/davemusau00/mazao-erp-v1/api:<full-commit-sha>, and uploads the same image as mazao-api-image-<full-commit-sha>.
- The API image artifact lets the VPS receive the exact CI-built image over SSH without storing registry credentials on that host.
- Artifacts expire after 90 days. Keep a release record of the workflow URL, source SHA, artifact names, and image digest.

The workflow does not deploy, run migrations against production, create a tenant, or enable business capabilities. Production activation is a separate operator action following docs/13-INFRA-DEPLOYMENT.md. Do not deploy local or uncommitted builds.

## Image and supply-chain boundaries

The API image is built for the VPS's linux/amd64 architecture. Its Bun base image is pinned by digest, PostgreSQL 16 is pinned in Compose, and the application image is identified by the complete source SHA. The image contains API runtime code and migration/bootstrap scripts but no environment file or tenant credentials. No worker image is published because there is no worker implementation in this repository.

This workflow currently does not sign images or produce SBOM attestations. Add those controls before claiming a signed or attested release.
