# Engineering governance and release lifecycle

## Branch and PR policy
Protected `main`, short-lived `feat/*` and `fix/*` branches, pull request required, review owner for domain/finance/offline/security, CI green, design acceptance for operator-facing journeys. Conventional commits optional; every release tagged with immutable SHA and changelog. Production branches never edited from UI-only quick patches without acceptance.

## Definition of ready
Workflow actor, UX design, schemas, policy/permissions, offline eligibility, accounting and stock side-effects, acceptance, migration/risk assessment and measurable outcome documented. If unresolved, task returns to design rather than coding assumptions.

## Definition of done
Typed validated contract; domain tests and invariant checks; tenant-scoped API handler; transaction atomicity; idempotent recovery; accessible responsive UI; permissions; logging/metrics; migration; CLI/runbook; exact acceptance evidence; no TODO pretending full feature. Screens labelled "demo" cannot be used for customer production.

## ADR discipline
Record decision, considered alternatives, tradeoffs, revisitation trigger and status. Accepted: greenfield isolation, modular monolith, PostgreSQL truth, task-first design, bounded offline. Deferred: microservices, native mobile shell, AI autonomous actions, multiregion writes.

## Version policy
API v1 and generated contract types. Protocol compatibility matrix covers active service worker/PWA versions. A client with unsupported schema blocks high-risk transactional actions and explains upgrade required; never partially apply unknown command. PWA SW update defers while cash/local draft or print delivery unresolved.
