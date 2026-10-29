-- New tenants created by the supported bootstrap path stay in setup until an
-- owner has reviewed the saved first-sale readiness checks.
CREATE TABLE core.tenant_onboarding (
  tenant_id uuid PRIMARY KEY REFERENCES core.tenants(id),
  bootstrap_key_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'SETUP' CHECK (status IN ('SETUP','LIVE','LEGACY_ACTIVE')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reviewed_by uuid REFERENCES identity.users(id),
  reviewed_at timestamptz,
  review_reason text,
  go_live_command_id uuid UNIQUE,
  CHECK (status <> 'LIVE' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL AND go_live_command_id IS NOT NULL))
);

-- Existing businesses predate a persisted go-live review. Keep their current
-- access and label the status so the API does not invent a historical review.
INSERT INTO core.tenant_onboarding(tenant_id,bootstrap_key_hash,status)
SELECT id,'legacy:'||id::text,'LEGACY_ACTIVE' FROM core.tenants
ON CONFLICT (tenant_id) DO NOTHING;

CREATE FUNCTION core.guard_tenant_onboarding_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status <> 'SETUP' OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.review_reason IS NOT NULL OR NEW.go_live_command_id IS NOT NULL THEN
      RAISE EXCEPTION 'New tenants must start in unreviewed setup status.' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Tenant onboarding evidence cannot be deleted.' USING ERRCODE='55000';
  END IF;
  IF ROW(NEW.tenant_id,NEW.bootstrap_key_hash,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.tenant_id,OLD.bootstrap_key_hash,OLD.created_at) THEN
    RAISE EXCEPTION 'Tenant bootstrap identity is immutable.' USING ERRCODE='55000';
  END IF;
  IF OLD.status <> 'SETUP' OR NEW.status <> 'LIVE' THEN
    RAISE EXCEPTION 'Only a pending tenant can transition once to reviewed live status.' USING ERRCODE='55000';
  END IF;
  IF NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL OR NEW.review_reason IS NULL OR NEW.go_live_command_id IS NULL THEN
    RAISE EXCEPTION 'Reviewed go-live evidence is required.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tenant_onboarding_guard BEFORE INSERT OR UPDATE OR DELETE ON core.tenant_onboarding
  FOR EACH ROW EXECUTE FUNCTION core.guard_tenant_onboarding_mutation();

CREATE INDEX tenant_onboarding_status_idx ON core.tenant_onboarding(status,created_at);
