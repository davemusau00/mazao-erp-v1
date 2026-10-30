-- Preserve identities and financial/stock evidence. Ambiguous legacy keys need
-- reviewed repair before this migration; never choose or merge a product here.
DO $$
DECLARE conflicts jsonb;
BEGIN
  SELECT jsonb_agg(to_jsonb(c)) INTO conflicts FROM (
    SELECT tenant_id,outlet_id,upper(btrim(sku)) normalized_sku,array_agg(id ORDER BY id) product_ids
    FROM catalog.products GROUP BY tenant_id,outlet_id,upper(btrim(sku)) HAVING count(*)>1
  ) c;
  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'Catalog SKU ambiguity requires reviewed identity repair before migration 023.'
      USING ERRCODE='23505',DETAIL=conflicts::text;
  END IF;
  SELECT jsonb_agg(id) INTO conflicts FROM catalog.products
    WHERE category<>btrim(category) OR category ~ '[[:cntrl:]]';
  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy category labels require review before migration 023.'
      USING ERRCODE='23514',DETAIL=conflicts::text;
  END IF;
END $$;

CREATE UNIQUE INDEX products_outlet_normalized_sku_unique
  ON catalog.products(tenant_id,outlet_id,upper(btrim(sku)));

CREATE TABLE catalog.categories (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  name text NOT NULL CHECK (name=btrim(name) AND length(name) BETWEEN 1 AND 80 AND name !~ '[[:cntrl:]]'),
  active boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1 CHECK (version>0),
  merged_into uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,outlet_id,id),
  UNIQUE(tenant_id,outlet_id,id,name),
  UNIQUE(tenant_id,outlet_id,name),
  FOREIGN KEY(tenant_id,outlet_id) REFERENCES core.outlets(tenant_id,id),
  FOREIGN KEY(tenant_id,outlet_id,merged_into) REFERENCES catalog.categories(tenant_id,outlet_id,id),
  CHECK (merged_into IS NULL OR (NOT active AND merged_into<>id))
);

-- Exact labels remain distinct, including case variants. Merge is a later
-- explicit versioned command, never an implicit backfill decision.
INSERT INTO catalog.categories(id,tenant_id,outlet_id,name)
  SELECT gen_random_uuid(),tenant_id,outlet_id,category FROM catalog.products
  WHERE category<>'' GROUP BY tenant_id,outlet_id,category;
ALTER TABLE catalog.products ADD COLUMN category_id uuid;
UPDATE catalog.products p SET category_id=c.id FROM catalog.categories c
  WHERE c.tenant_id=p.tenant_id AND c.outlet_id=p.outlet_id AND c.name=p.category;
ALTER TABLE catalog.products
  ADD CONSTRAINT product_category_reference_present CHECK ((category_id IS NULL)=(category='')),
  ADD CONSTRAINT product_category_scope_fk FOREIGN KEY(tenant_id,outlet_id,category_id,category)
    REFERENCES catalog.categories(tenant_id,outlet_id,id,name) ON UPDATE CASCADE;
CREATE INDEX products_outlet_category_idx ON catalog.products(tenant_id,outlet_id,category_id,id);
