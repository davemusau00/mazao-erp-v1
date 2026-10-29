-- S01-07: selected-item spot counts and blind baseline confidentiality.
-- Scope is captured by immutable count lines; no free-text label grants location
-- authority. Location scope remains unavailable until stock locations exist.
ALTER TABLE inventory.stock_counts
  DROP CONSTRAINT stock_counts_count_mode_check,
  ADD CONSTRAINT stock_counts_count_mode_check CHECK (count_mode IN ('FULL', 'SELECTED')),
  ADD COLUMN blind_count boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION inventory.guard_count_header_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.status<>'OPEN' THEN
    RAISE EXCEPTION 'Completed count projections and count history cannot be removed or rewritten.' USING ERRCODE='55000';
  END IF;
  IF ROW(NEW.id,NEW.tenant_id,NEW.outlet_id,NEW.count_mode,NEW.blind_count,NEW.area_label,NEW.baseline_at,NEW.opened_by,NEW.opened_at,NEW.review_nonce)
      IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.outlet_id,OLD.count_mode,OLD.blind_count,OLD.area_label,OLD.baseline_at,OLD.opened_by,OLD.opened_at,OLD.review_nonce) THEN
    RAISE EXCEPTION 'Original count identity and opening evidence is immutable.' USING ERRCODE='55000';
  END IF;
  IF NEW.version<>OLD.version AND NEW.version<>OLD.version+1 THEN
    RAISE EXCEPTION 'A count transition must advance exactly one version.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
