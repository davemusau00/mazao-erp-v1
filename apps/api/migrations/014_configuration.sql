-- Business configuration is versioned independently from financial evidence.
ALTER TABLE core.tenants
  ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN business_profile jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(business_profile) = 'object');

ALTER TABLE core.outlets
  ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN outlet_profile jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(outlet_profile) = 'object');

-- Existing receipts intentionally retain an empty configuration snapshot rather
-- than inheriting new legal/contact information that was unknown at sale time.
ALTER TABLE commerce.orders
  ADD COLUMN receipt_profile_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(receipt_profile_snapshot) = 'object');
