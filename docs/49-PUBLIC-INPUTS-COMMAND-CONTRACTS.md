# Public input validation and command contracts

Date: 20 October 2026, Africa/Nairobi. Plan ticket: S00-02.

Sign-in now checks the JSON object and every supplied field before reading the
database. Numeric, array, null, malformed and overlong emails return HTTP 400
with `VALIDATION_FAILED`. Passwords must be strings of 1 to 256 characters;
assignment IDs must be UUIDs. Unknown sign-in fields are rejected. Email trimming
and lowercasing happen after validation, while password bytes are preserved.
Malformed or empty JSON also returns a controlled 400 instead of an internal
error. Rate limiting remains active on the same route.

A shared request boundary runs before authenticated handlers and database
work. It validates the ten current UUID path parameters (`userId`, `assetId`,
`batchId`, `shortfallId`, `countId`, `shiftId`, `orderId`, `customerId`,
`journalEntryId`, `commandId`) and rejects repeated query values represented as
arrays, NUL and other control characters. Current query contracts accept scalar strings. Opaque `kind` route
segments retain their existing enum validation; they are not UUIDs. This closes
raw malformed UUID casts and array `.trim()` failures while retaining the
domain-specific query checks. Route-inventory tests fail if a new identifier
route is added without the boundary being updated.

The command envelope requires protocol 1, genuine UUID command/assignment IDs,
an optional genuine UUID tenant ID, an ISO timestamp with a real calendar date
and explicit timezone, an object payload, and an object of positive safe integer
versions. Arrays and null cannot stand in for objects. Unknown envelope fields
are rejected without modifying the original object or its hash. Existing
tenant/assignment checks, atomic command recording, recovery and transaction
authority checks remain in force. Authentication can still read the database
before a protected command is rejected; the zero-query guarantee concerns
public sign-in validation.

`apps/api/src/commandCatalogue.ts` is the source of the 51 baseline command
policies, including the two operations served through dedicated credential
endpoints. Every entry declares versioned input/output schema boundaries,
permissions, capabilities, domain handler, effects, online mode, audit/outbox,
transaction, approval and idempotency boundaries. All entries are `ONLINE_ONLY`;
the recovery journal does not authorize offline financial posting. Existing
payload-dependent authority checks remain in the referenced domain service.

Four commands have migrated strict payload and result schemas: `shift.open`,
`hotel.room.mark_ready`, `auth.session.revoke`, and `staff.sessions.revoke`.
Their payload schemas run during execution and reject unknown fields, coerced
types and invalid identifiers. Result schemas describe the confirmed `value`,
not the command outcome wrapper. Result validation is a catalogue contract;
it does not replace atomic domain posting or reject a committed result.

Session-revocation reason schemas retain the existing domain rule: 1 to 500
characters after trimming, with no control characters in the original input.
Outer whitespace is accepted without rewriting the bytes retained in the
command hash. A focused compatibility review found and removed an initial
raw-length restriction that would have rejected a valid padded reason.

Other entries explicitly say `DOMAIN_PAYLOAD`: their object schemas and domain
handler references catalogue the current boundary, and their detailed payload
and output schemas still require incremental migration. They must not be
treated as complete generated client contracts. Unknown payload properties in
these legacy operations remain governed by their existing domain validators.
The dedicated credential input schemas describe the existing request shape;
the credential service continues to perform their validation and recovery.

The existing `test:api` CI glob includes `command-catalogue.test.ts`. It checks
both directions between actual dispatch cases and catalogue entries, rejects
duplicate dispatch, verifies referenced domain functions and schemas, and
exercises catalogue authority for every existing role and capability. A changed
dispatch layout fails explicitly until the check is updated. Authorization now
reads the catalogue directly, eliminating a second drifting policy list.
An independent read-only comparison against `HEAD:apps/api/src/commandAuthorization.ts`
also verified all 51 original policies against catalogue permissions and
capabilities: 51 matched, zero differences. All four migrated result field
sets were checked against their actual handlers and receive focused schema
regression coverage. The disposable HTTP/database directory suite executes
all four handlers, checks their actual confirmed values against their declared
result schemas, and confirms both ordinary-space and nonbreaking-space padded
500-character reasons remain accepted by the session operations.

Verification performed locally:

```text
node --import tsx --test apps/api/test/public-inputs.test.ts apps/api/test/command-catalogue.test.ts apps/api/test/login-runtime.test.ts
18 tests passed; 0 failed; 0 skipped.

TEST_DATABASE_URL=<disposable PostgreSQL> node --import tsx --import ./apps/api/test/support/isolate-database.mjs --test apps/api/test/command-recovery.integration.test.ts apps/api/test/staff-security.integration.test.ts
16 tests passed; 0 failed; 0 skipped.

TEST_DATABASE_URL=<disposable PostgreSQL> node --import tsx --import ./apps/api/test/support/isolate-database.mjs --test apps/api/test/directory-pagination.integration.test.ts
8 tests passed; 0 failed; 0 skipped, including all four migrated handler results.
```

The actual Fastify route tests replace pool query/connect methods with failing
counters and verify zero database calls for malformed public sign-in, UUID
paths and repeated query fields. Valid UUID paths and opaque kinds still
continue to authentication. This proves
the HTTP boundary, not production sign-in or deployed identity. Database,
browser and full repository validation are recorded separately in the execution
register. No migration, deployment or production data change is required by
this ticket.
