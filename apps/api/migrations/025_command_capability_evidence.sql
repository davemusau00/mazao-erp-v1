-- Trusted recovery evidence is independent of mutable item classification.
-- Version zero remains the default for rolling-upgrade/older API writers.
ALTER TABLE system.commands ADD COLUMN IF NOT EXISTS authority_version smallint NOT NULL DEFAULT 0;
ALTER TABLE system.commands ADD COLUMN IF NOT EXISTS required_capabilities text[] NOT NULL DEFAULT '{}';

-- Keep legacy rows distinguishable. Application recovery also uses a frozen
-- version-zero map, covering older writers inserting after this backfill.
UPDATE system.commands SET required_capabilities = ARRAY['inventory']::text[]
WHERE authority_version = 0 AND (
  command_type LIKE 'catalog.product.%' OR command_type LIKE 'catalog.category.%' OR command_type LIKE 'catalog.import.%'
);
UPDATE system.commands SET required_capabilities = ARRAY['commerce','inventory']::text[]
WHERE authority_version = 0 AND command_type IN ('sales.order.settle','sales.order.refund');
