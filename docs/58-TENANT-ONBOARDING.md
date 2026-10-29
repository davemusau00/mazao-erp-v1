# Tenant bootstrap and reviewed first use

## State and authority

Migration `028_tenant_onboarding` adds tenant-scoped state:

- `SETUP`: a supported bootstrap created the tenant. Authenticated requests are limited to the setup routes needed to configure the business, catalog, initial inventory, staff and workspace assignments. The API rejects ordinary reads and commands with `ONBOARDING_REQUIRED`.
- `LIVE`: the owner submitted `configuration.go_live.approve` with a current business version, an explicit review reason and confirmation in the UI. The API recomputes every first-sale check in the command transaction, writes audit and outbox evidence, and records the reviewed actor, time, reason and command ID. This transition is one-time and immutable.
- `LEGACY_ACTIVE`: migration backfilled a tenant that existed before reviewed go-live. Its prior access is preserved and no historical review is fabricated.

The gate is enforced by the API for reads and writes and by the command transaction for commands. The workspace navigation follows the server session status, but it is not the security boundary. Status reads and setup actions always use the authenticated tenant and outlet context.

The review currently covers business and outlet identity, reviewed tax policy, commerce capability, an active catalog item, a service or positive stocked inventory, and an active operator and assigned device. This is the defined first-sale review. Physical terminal pairing, additional outlets, transfers and per-location stock remain separate roadmap work.

## Initial tenant bootstrap

Apply migrations using `npm run db:migrate`, then run `npm run api:bootstrap` from a private interactive terminal. The supported command requires the exact confirmation phrase and prompts for business, outlet, owner, workspace and capability details. It requests the owner password twice with terminal echo disabled. It rejects `ADMIN_PASSWORD` and non-interactive invocation. It creates random identities atomically, stores only a password hash, initializes tax as unreviewed, and leaves the tenant in `SETUP`.

Bootstrap is limited to an empty business database. It prints a random request UUID so an operator can recover the result if the command response is lost. Set `BOOTSTRAP_REQUEST_ID` to that same UUID and provide the same setup details to retrieve the existing IDs. A repeated request does not create records or replace the original password. Store the UUID securely until setup is confirmed.

The initial device is a logical assigned workspace to enable the owner to sign in and finish setup. It does not claim that a physical terminal has been paired or verified.

## Acceptance status

Source implementation, migration, owner UI and a disposable-database integration case are present. `npm run typecheck` has passed after the implementation. The database integration case has not been rerun after the current changes because the disposable PostgreSQL service is unavailable. Do not use the named `mazao_truth` fixture as a substitute. Migration upgrade/rerun, tenant isolation, direct-route denial, incomplete-review rejection, successful go-live, and post-review access remain pending isolated database acceptance.
