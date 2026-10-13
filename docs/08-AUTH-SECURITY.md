# Security, identity and privacy

## Threat model
Tenant cross-access, stolen staff PIN, reused operator session, compromised kiosk browser, malicious CSV/QR, forged offline grant, forged print-job origin, replay/double tender, privilege escalation, stale client, backup theft, exposed API tokens, worker privilege, injection, and supply-chain compromise.

## Identity
Prefer reputable OIDC or hardened first-party identity with modern password hashing, secure server sessions, optional passkeys/MFA for admins and financial roles. Staff fast-switch PIN is a short local operator re-auth step scoped to enrolled device and provisioned session, not a global login credential; throttle attempts and centrally revoke. Web sessions secure `HttpOnly; Secure; SameSite` cookies where possible with CSRF protection and explicit CORS allowlists. Rotate refresh tokens and revalidate permissions for sensitive actions.

## Permissions
Deny-by-default granular RBAC plus ABAC checks on tenant, outlet, device, shift, ownership, approval, operation amount, and offline capability. Manager approval is short-lived, action+target+amount-bound, single-use and audited. Never accept arbitrary approval UUID from user without server lookup/validation. Separate vendor superadmin plane from tenant operator/admin plane.

## Tenant separation
Scope all reads/writes by server-derived tenant membership, including imports, reporting and search. Composite tenant FKs, test deliberate cross-tenant IDs for every route. DB connection users least-privilege; audit bypass paths. PII/guest information minimized and retained according to approved local policy; include subject access/export and retention workstream.

## Data protection
TLS 1.2+ configured to current standards, keys in secrets manager or root-owned environment, not Git. At-rest encryption on server/backups; protect locally stored operational data, lock kiosk profiles, minimize card data. Never store payment card PAN/CVV. Receipt QR uploads sanitized, image limits and allowlisted MIME; SVG only after sanitization or reject. CSV formulas neutralized on export. Attachment virus scanning where practical.

## Software supply chain
Pinned dependency lockfile, audit policy, secret scanners and SAST, SBOM, signed build provenance, protected branches, reviewed migrations, no production credentials in CI logs. Scheduled penetration and disaster recovery exercises. Align controls with current OWASP ASVS and verify against actual standards at implementation time.

## Audit
Append-only evidence for login, financial posting, stock correction, refund, permission change, device enrollment/revocation, offline lease, import apply, period close, and admin access. Audit retention and access restrictions. Hash chain optional defense, not a substitute for restricted DB permissions and offsite records.

## Security release gates
Authorization tests across tenants/roles, API fuzz/schema negative tests, CSRF/CORS, session expiration, offline grant forgery, replay attacks, print bridge origin validation, upload sanitization, secret scan, backup recovery encryption and annual policy review.
