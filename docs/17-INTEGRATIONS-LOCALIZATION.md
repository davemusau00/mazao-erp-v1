# Regional settings and integrations

## Kenya-first defaults
KES formatted correctly; Africa/Nairobi as business timezone, tenant selectable; support receipt business/legal naming, staff PIN, till identification, M-Pesa payment reference, VAT classification by effective rule and unit conversions. English initial copy and internationalization keys from outset; Kiswahili translation curated by human review. Country-specific policy injected through provider adapters, not scattered conditionals.

## Payment gateway boundaries
Manual M-Pesa: cashier records customer-confirmed payment as `CLAIMED/UNVERIFIED` or follows approved manual policy, and reconciliation links provider evidence. No invented provider payment status. Future Daraja/STK callback adapter validates provider signatures/credentials per current official requirements, correlates unique merchant references, idempotently transitions pending/confirmed/failed and handles reversals. Split tender supports CASH, M-PESA, CARD (via supported terminal/provider) and customer credit subject to policy.

## eTIMS and tax
Treat eTIMS integration and Kenya tax compliance as external projects requiring up-to-date KRA requirements, supported provider onboarding and real acceptance. Basic thermal receipt is not an eTIMS invoice; never claim otherwise. Maintain effective-dated tax policies, document numbering and integration status. Avoid assuming a fixed standard VAT rate applies to every product.

## Future integration interfaces
`PaymentProvider`, `FiscalDocumentProvider`, `NotificationProvider`, `PrinterAdapter`, `IdentityProvider`, `AccountingExportProvider`, `BookingChannelProvider`; each has versioned request schemas, idempotency, structured provider status, retries/dead-letter and sandbox integration tests. External failure must not roll back already finalized cash receipt or overwrite authoritative internal accounting.
