-- Preserve existing identities and introduce tenant-scoped operator profiles.
ALTER TABLE identity.memberships
  ADD COLUMN display_name text,
  ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version > 0);
UPDATE identity.memberships m SET display_name=u.full_name FROM identity.users u WHERE u.id=m.user_id;
ALTER TABLE identity.memberships ALTER COLUMN display_name SET NOT NULL;
ALTER TABLE identity.memberships ADD CONSTRAINT member_display_name_check CHECK (length(trim(display_name)) BETWEEN 1 AND 160);

ALTER TABLE identity.users
  ALTER COLUMN password_hash DROP NOT NULL,
  ADD COLUMN credential_version bigint NOT NULL DEFAULT 1 CHECK (credential_version > 0);
ALTER TABLE identity.devices
  ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN revoked_at timestamptz;
ALTER TABLE identity.sessions ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version > 0);
CREATE INDEX staff_sessions_scope_idx ON identity.sessions(tenant_id,user_id,created_at DESC);

-- Legacy operator text is captured once; later membership profile edits never
-- alter a posted receipt. New sales record the current tenant display name.
ALTER TABLE commerce.orders ADD COLUMN operator_name_snapshot text;
UPDATE commerce.orders o SET operator_name_snapshot=u.full_name FROM identity.users u WHERE u.id=o.operator_id;
ALTER TABLE commerce.orders ALTER COLUMN operator_name_snapshot SET NOT NULL;

-- Older bootstrap and fixture inserts retain their source operator name.
CREATE FUNCTION identity.initialize_member_display_name() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.display_name IS NULL THEN SELECT full_name INTO NEW.display_name FROM identity.users WHERE id=NEW.user_id; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER member_display_name_default BEFORE INSERT ON identity.memberships
  FOR EACH ROW EXECUTE FUNCTION identity.initialize_member_display_name();
CREATE FUNCTION commerce.initialize_order_operator_name() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.operator_name_snapshot IS NULL THEN
    SELECT COALESCE(m.display_name,u.full_name) INTO NEW.operator_name_snapshot
      FROM identity.users u LEFT JOIN identity.memberships m ON m.user_id=u.id AND m.tenant_id=NEW.tenant_id WHERE u.id=NEW.operator_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_operator_name_default BEFORE INSERT ON commerce.orders
  FOR EACH ROW EXECUTE FUNCTION commerce.initialize_order_operator_name();
