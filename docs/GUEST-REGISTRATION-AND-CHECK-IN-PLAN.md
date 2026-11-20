# Guest registration, reservations and check-in plan

Date: 1 November 2026, Africa/Nairobi.

Status: first implementation slice in progress on `feat/guest-registration`; see [implementation and validation evidence](GUEST-REGISTRATION-IMPLEMENTATION.md). Production activation is separate.

## 1. Intended operator outcome

Reception can make a quick reservation, complete the actual guest registration on arrival, verify identity, record the other occupants, and check the party into a room in one clear workflow. Walk-ins use the same arrival form. Guest details remain available for authorized review and correction during the stay.

Confirmed policy decision, 1 November 2026: collect a primary guest name, a booking contact, dates and party counts when reserving. Complete identity verification at check-in. **Every adult occupant must have ID/passport details recorded and verified before check-in can complete.** Each adult needs their own registration; the primary guest's document does not cover the other adults. Record children under a responsible adult in the same registration. Identity details remain optional at the reservation stage and become mandatory for every adult at arrival.

## 2. Verified starting point

Source baseline: deployed commit `0de9799aef2486547ed54b3d3a78b0475b11c231` and the supplied reservation screenshot.

- Both Hotel and Reservations navigation render `BackendHotelWorkspace.tsx`. `ReservationWorkspace.tsx` is an unconnected availability demo and is not the live implementation target.
- The live reservation dialog has room, guest name, one free-text guest contact, arrival and departure.
- Reserved-guest **Check in** immediately sends `hotel.checkin`; it has no arrival-registration screen. The server takes the reservation's saved name/contact rather than accepting a reviewed replacement.
- The separate walk-in form also collects only name/contact/dates.
- Migration `004_hospitality.sql` stores name/contact on reservations and stays. There is no registration roster, identity record or configured room capacity.
- Hotel commands currently enter the ordinary IndexedDB journal with their complete payload. New identity numbers need a protected-input recovery path.
- Existing hotel date, room-locking, command-replay, folio and checkout behavior provides the regression baseline.

## 3. Guest information to capture

Required below describes the proposed hotel workflow, subject to an approved property policy; it is not a claim that every field is legally compulsory.

| Information | Reservation | Arrival/check-in | Rules |
| --- | --- | --- | --- |
| Primary guest name | Required | Confirm full legal name | One Unicode full-name field; support names without Western first/last-name assumptions. |
| Booker/contact person | Default to primary guest; separate if another person or agent books | Retain booking context | Booker and staying guest are distinct roles. |
| Main phone | Phone or email needed for booking follow-up | Confirm available contact | International numbers; permit an explicit in-person/no-contact exception according to policy. |
| Email | Optional alternative contact | Optional | Validate when supplied; keep booking communications separate from marketing preferences. |
| Alternative phone | Optional | Optional | Separate field instead of overloading the existing contact string. |
| Adult and child counts | Required for new bookings | Confirm actual occupants | At least one responsible adult; validate totals and configured room capacity. |
| Additional occupants | Names can be completed later | Adult full names and required identity details | Identify the primary guest; record child name/age band and responsible adult only as needed. |
| Document type | Optional before arrival | Required for every adult occupant | National ID, passport, alien/foreign resident ID, and property-approved other identification. |
| Document number | Optional before arrival | Required for every adult occupant | Treat as a string; preserve leading zeros. Validate by type and issuing country. |
| Issuing country | Optional before arrival | Required for the recorded document | Keep separate from nationality and country of residence. |
| Identity verification | Pending | Document sighted and confirmed by receptionist | Record verifier and server timestamp. This records the operator's verification, not a government authenticity check. |
| Nationality | Optional | Recommended registration detail; required only by approved policy | Country selector; support a missing/unknown value with an appropriate policy exception. |
| Country and town/city of residence | Optional | Recommended | Request a street/postal address only for a defined operational requirement. |
| Passport/document expiry | Conditional | Check when relevant to document type/policy | Offer another accepted document or a specifically authorized exception when necessary. |
| Date of birth | Conditional | Capture where needed for document or age handling | Avoid making full DOB universal when an age band is sufficient. |
| Emergency contact | Optional | Optional | Name and phone; relationship only when useful and provided. Explain the purpose. |
| Company/agent and booking reference | Optional | Retain | Keep corporate billing instructions separate from guest identity and any credit authorization. |
| Expected arrival time, visit-purpose category, operational notes | Optional | Confirm useful arrival details | Short bounded notes; guide staff toward service information. |

Gender, occupation, marital status, religion and health information are not proposed default requirements. Additional fields need a documented purpose and access policy. A tax PIN is a separate billing field and should not serve as a guest identity document.

## 4. Forms and guest journey

### Reservation

Use a wider responsive dialog with three clear sections:

1. **Stay:** room, arrival/departure, adults, children, and current rate summary.
2. **Guest and booking contact:** primary guest name, phone/email, and “Someone else is making this booking” to reveal booker fields.
3. **Additional details:** optional known occupants, arrival time, company/reference, residence and pre-arrival identity.

Keep the current primary guest name requirement in the first delivery. Anonymous group allocations with guest names to be supplied later are a separate booking-policy extension.

The confirmation summary shows room, dates, party count, guest and contact before **Confirm reservation**. Saving private guest details alone must never show a reservation-confirmed message or hold a room.

Reservation rows expose **Review guest details** and **Prepare check-in**. Display a simple registration-completeness indicator such as “Identity details pending” for authorized reception staff.

### Reserved arrival

**Prepare check-in** opens a prefilled registration form rather than immediately occupying the room:

1. Review the reservation, room, dates and rate summary.
2. Confirm the primary guest's legal name, contact, nationality/residence and identity document.
3. Complete adult occupants and child/guardian associations.
4. Review required-field completion and verification, then choose **Complete check-in**.

Reception can save arrival details before the guest arrives. The room becomes occupied only after the server confirms the final check-in. A different arriving guest can be recorded through a reviewed, versioned amendment rather than silently overwriting the booking contact.

### Walk-in

Use the same registration sections and requirements. Prefill the selected room and outlet business date, request departure and party details, then review and check in. Walk-in parity prevents identity rules diverging between the two arrival paths.

### During the stay

Authorized reception can open **Guest details**, see masked identity information, and make a reviewed correction. Post-arrival corrections record a reason and a new registration revision. Preserve the original stay registration and the separate billing evidence.

### Layout and accessibility

- Reuse the shared responsive dialog, field-error and focus-management patterns.
- Use two columns where space permits and one on mobile. Group optional details in expandable sections.
- Keep cancel/save/confirm reachable in a stable footer while the form scrolls.
- Support keyboard navigation, focus on the first invalid field, accessible error summaries, and visible required/optional labels.
- Cover 1024x600 and 390x844, including the on-screen keyboard and long international names.

## 5. Persistence and contracts

Implement a minimal registration model before introducing a full guest CRM:

- `hospitality.guest_registrations`: tenant/outlet scope, optional reservation/stay links, version, DRAFT/FINAL state, booker/contact fields, party counts, registration-policy version and completion metadata.
- `hospitality.guest_registration_occupants`: registration link, primary/adult/child role, legal name, structured contacts/residence, conditional age/guardian details, protected identity fields, verification actor/time, and row/revision identity.
- Append-only registration revisions or equivalent immutable snapshots preserve what was registered at arrival. A later correction creates linked evidence.
- Enforce a single primary adult, actual roster totals matching the declared adult/child counts, and each child guardian pointing to an adult in the same registration. A draft can bind to one reservation and its resulting stay; a finalized registration cannot be reused or directly edited.
- Link reservations to pre-arrival registration and stays to the finalized arrival snapshot. Preserve existing name/contact fields for compatibility and current financial displays.
- Add explicit room capacity metadata if enforcing occupancy limits. New room setup collects capacity. Existing rooms retain “capacity not configured” until reviewed; migrate without inventing capacities. Recommended transition: allow booking/check-in with a visible capacity warning for those legacy rooms, while continuing to enforce guest-registration requirements. The owner configures actual capacity through a supported room-edit action.
- Provide a small owner-authorized guest registration policy section in hotel settings showing the confirmed every-adult identity requirement, accepted documents, conditional fields and permitted exceptions. Version the policy, show the effective requirements at arrival, and revalidate against the current policy before confirming check-in. The requirement for this delivery is every adult occupant.

Use tenant/outlet composite foreign keys and server-derived scope. Keep existing rows valid, mark missing registrations as legacy/incomplete, and prompt for required arrival information on their next check-in. Existing active stays retain access to checkout.

A later reusable guest profile can link to registrations. Returning-guest reuse must be an explicit operator selection; matching a name or shared phone must not merge identities automatically.

### Commands and reads

- `hotel.registration.save`: strict canonical schema; create/update a draft with expected registration and, when applicable, reservation version. It saves guest information without allocating occupancy or creating financial entries.
- `hotel.reservation.create`: accept a reviewed registration reference for the new flow; derive its display name/contact server-side and bind it atomically to the reservation.
- `hotel.checkin`: consume the reviewed registration ID/version with the existing room/reservation versions. Revalidate current required fields, policy and availability inside the check-in transaction; finalize registration, stay, folio and room state exactly once.
- `hotel.registration.correct`: versioned, authorized correction with a reason and linked revision evidence.
- `hotel.room.capacity.update`: `hotel.manage` authority, expected room version and audited total/adult/child capacity changes. Reject a capacity reduction below known current or confirmed future party counts; resolve those allocations first. For relevant legacy parties with unknown counts, require review of actual counts or a documented manager transition exception. Preserve the existing reservations and stays rather than changing their counts automatically.
- Protected registration detail reads provide only the fields needed by the authenticated role. Ordinary room/reservation/stay lists remain lightweight.

Introduce strict schemas while accepting the known legacy envelope shape for compatibility. Existing confirmed command responses must replay unchanged. A new legacy-format check-in missing required registration receives a canonical, actionable terminal outcome; the client resolves that command before creating a new reviewed command. Never change an already retained command's payload under its original UUID.

## 6. Protect identity data and preserve recovery

The design must keep raw ID/passport numbers out of localStorage, generic IndexedDB journals, URLs, routine list/search responses, logs, normal audit/outbox payloads, command-status results and ordinary receipts.

Use the existing protected-operation journal/fencing principles from `secretOperationJournal.ts` and `credentials.ts` as a design reference, with a guest-specific implementation:

1. Prepare the private save and persist safe recovery metadata before sending the private input: operation/command identity, scope, expected versions and safe status information. A browser storage failure prevents submission. The durable metadata contains no raw identity number.
2. Submit protected registration input over the authenticated, CSRF-protected API; store raw identity fields encrypted server-side with a key version. Recover a confirmed save through status lookup to obtain the registration reference. Remove recovery metadata only after validating a terminal response for the original operation and authenticated scope.
3. Implementation refinement: use the proven credential-operation fencing model with an immutable original command/registration/expected-version descriptor, rather than allocating a separate input slot. Bind private input to the captured authenticated scope; serialize private save and reconciliation on the same authoritative tenant lock. A missing status alone does not authorize replacing an in-flight save. Reconciliation records a durable terminal rejection/fence for that original operation when it is absent; a late original reads the fence before attempting private changes. Recover reconciliation's canonical outcome before explicit re-entry with a new operation. This preserves the planned late-request protection without retaining or reconstructing the private payload.
4. The room reservation/check-in command journals the exact reference-based envelope. A timeout retains that original command for status recovery and exact replay.
5. Use version checks so an edited registration cannot be substituted after its check-in review.

Mask saved identity numbers. Expose explicit **Keep existing**, **Replace**, and authorized **Remove** semantics; masked display strings are never accepted as replacement document numbers. Capture full numbers in memory only for entry or authorized reveal, and clear them when the form closes or the session changes.

Front desk can enter/verify required details. Full reveal, bulk guest-register export and retention administration receive explicit permissions and audit. Housekeeping and finance projections receive their operational data without inheriting full identity access. Use `Cache-Control: no-store` for private detail/reveal responses and keep them out of service-worker caches.

Use encryption keys held outside Git/database payloads, support rotation and verified encrypted-backup recovery, and use a tenant-scoped keyed HMAC if exact document matching is later required. Avoid unkeyed ID hashes and global uniqueness constraints. Domain errors identify the field without echoing the private value.

Document the collection purpose and privacy notice, separate optional marketing preferences, and approve retention/deletion rules for drafts, guest identity, exports and backups. Retention can remove or anonymize private identity while preserving required non-identifying stay/accounting anchors. The ODPC describes necessity, purpose, accuracy, retention and data-subject rights as core principles: [ODPC rights and principles](https://www.odpc.go.ke/rights-of-a-data-subject/).

The property's mandatory ID/occupant fields and retention duration should be confirmed against its applicable registration obligations before enforcement is enabled. This plan does not assign an arbitrary legal retention period.

## 7. Proposed implementation sequence

### First slice: complete guest registration and arrival

Deliver the schema, protected-input recovery, strict commands, private read projections, policy rules and both real UI paths together. Include:

- Structured primary guest and booking contacts, party counts, nationality/residence, document type/number/country and verification.
- Actual adult/child occupants and policy validation.
- Optional emergency/company/reference/arrival details in progressive sections.
- Prefilled reserved-arrival form, shared walk-in registration, masked detail review and audited correction.
- Owner-reviewed registration policy settings and configured retention execution, including expired private drafts. Store the policy version with registration and audit specifically authorized exceptions.
- Additive migration, backward-compatible reads/replay, privacy-safe audit/outbox and complete acceptance coverage.

### Second slice: repeat guests and registration documents

Add explicit returning-guest lookup, profile reuse and duplicate review; reviewed guest-register export and print with permission/audit; richer policy controls and retention operation screens. Validate register content against the property's actual reporting needs.

### Later extension: document attachments

Evaluate optional ID/passport attachments after approving their purpose and retention. A dedicated private attachment service needs size/type validation, malware handling, encrypted storage, per-object authorization and audited access. It should be designed separately from public configuration images.

Broader deposits, extra folio charges, room moves and rate-policy changes remain separate hotel delivery workstreams. Guest-registration implementation preserves current room concurrency, outlet dates, existing rate behavior, folio creation and checkout accounting.

## 8. Acceptance gates

1. Reserve with minimum booking details; optionally supply pre-arrival identity. A private draft alone creates no reservation or occupancy.
2. Capture a different booker and primary staying guest, and retain that distinction at arrival.
3. Reserved check-in opens the registration review and prefills saved details. Walk-ins use the same required-field logic.
4. Record multiple adults/children, guardian links, party totals and known room capacities; display migration-era unknown capacity honestly.
5. Preserve leading-zero document numbers, support foreign passports, and show field-level errors for missing/inconsistent document information.
6. Keep an existing masked ID through unrelated edits. Replace/remove only through the explicit authorized operation.
7. Enforce registration policy on the server even when a client skips validation or submits an old payload. For a party of two adults, reject check-in when only the primary adult has ID details or verification; allow it after both adults meet the requirement. Confirm that children link to a responsible adult without being required to supply an adult identity document.
8. Reject cross-tenant/outlet/device access and unauthorized reveal/export. Verify housekeeping/finance/list/search responses and errors expose no full identity data.
9. Inspect browser storage, PWA caches, logs, audit/outbox, command responses and exports for unintended identity leakage.
10. Lose the private-save response, reload, and recover its reference without retaining raw ID locally; cover confirmed-missing input and late-save fencing.
11. Lose a check-in response and retry the original command: exactly one stay, folio and room occupation. Cover concurrent check-in, registration edits and cancellation races.
12. Upgrade existing reservations and active stays with no fabricated identity; preserve confirmed command replay and valid checkout.
13. Guest-detail saves/corrections create no charges, stock movements or journals. Existing checkout regression checks remain balanced.
14. Run fresh/upgrade migration checks, API authorization and actual PostgreSQL integration, plus browser acceptance at 1024x600 and 390x844 and supported Chromium/Firefox projects. Wire new specs into each relevant test configuration so they actually run in CI.
15. Record keyboard/screen-reader behavior, long content and mobile keyboard usability. Deployment remains a separate exact-commit backup/restore/rollback and production-smoke step after implementation acceptance.
16. Verify encryption-key failure and rotation, restore protected registration data with the separately secured keys, and execute approved draft/identity retention while preserving stay/accounting anchors. Use disposable test identities and assert that test output also redacts private values.

## 9. Implementation map

| Area | Existing targets / proposed files |
| --- | --- |
| Live reservation, walk-in and arrival UI | `src/components/hospitality/BackendHotelWorkspace.tsx` |
| Shared form sections | Proposed `GuestContactFields`, `GuestIdentityFields`, `OccupantEditor`, `GuestRegistrationReview` in the hospitality component folder |
| Client DTOs and recovery | `src/services/apiClient.ts`, `src/services/commandJournal.ts`, `src/services/secretOperationJournal.ts`, `src/hooks/useCommandRecoveryReadiness.ts` |
| API commands and schema admission | `apps/api/src/commands.ts`, `apps/api/src/commandCatalogue.ts`, `apps/api/src/contracts.ts`; extract registration domain logic into its own module |
| Protected read projections | `apps/api/src/app.ts`, `apps/api/src/hospitalityDirectory.ts`, proposed guest registration service |
| Schema | New additive migration chosen from the implementation branch's actual migration head; preserve applied migration 004 |
| API acceptance | Proposed guest-registration security/recovery/upgrade integration tests alongside `apps/api/test/hotel-calendar.integration.test.ts` |
| Browser acceptance | Proposed guest-registration specs alongside `e2e/integration/hotel-calendar.spec.ts`; update relevant Playwright matchers |
| Documentation | `docs/11-HOSPITALITY.md`, `docs/08-AUTH-SECURITY.md`, `docs/24-BACKEND-INTEGRATION.md`, completion register and this plan |

This planning pass ran no tests, migrations or production mutations. Existing unrelated worktree changes were preserved.
