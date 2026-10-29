-- Ordinals order admitted movement writes, not legacy timestamps or commit time.
-- Existing IDs, dates, quantities, values and financial links are preserved.
ALTER TABLE inventory.movements ADD COLUMN movement_seq bigint GENERATED ALWAYS AS IDENTITY;
CREATE UNIQUE INDEX inventory_movement_seq_unique ON inventory.movements(movement_seq);
CREATE INDEX inventory_movement_count_evidence_idx
  ON inventory.movements(tenant_id,outlet_id,product_id,movement_seq);

ALTER TABLE inventory.stock_counts
  ADD COLUMN recovery_protocol smallint NOT NULL DEFAULT 0 CHECK(recovery_protocol IN (0,1)),
  ADD COLUMN review_nonce uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN baseline_revision integer NOT NULL DEFAULT 1 CHECK(baseline_revision>0),
  ADD COLUMN recovery_coverage text NOT NULL DEFAULT 'LEGACY_CHECKPOINT' CHECK(recovery_coverage IN ('COMPLETE','LEGACY_CHECKPOINT')),
  ADD COLUMN last_event_id uuid,
  ADD COLUMN last_reviewed_at timestamptz,
  ADD COLUMN last_reviewed_by uuid REFERENCES identity.users(id);
ALTER TABLE inventory.stock_count_lines
  ADD COLUMN baseline_revision integer NOT NULL DEFAULT 1 CHECK(baseline_revision>0),
  ADD COLUMN reviewed_product_version bigint CHECK(reviewed_product_version>0),
  ADD COLUMN baseline_item_kind text CHECK(baseline_item_kind IN ('STOCKED_GOOD','SERVICE','PREPARED')),
  ADD COLUMN baseline_active boolean,
  ADD COLUMN movement_after bigint CHECK(movement_after>=0),
  ADD COLUMN counted_revision integer CHECK(counted_revision>0),
  ADD COLUMN requires_recount boolean NOT NULL DEFAULT false;
ALTER TABLE inventory.stock_counts ADD CONSTRAINT stock_count_reviewer_scope_fk
  FOREIGN KEY(tenant_id,last_reviewed_by) REFERENCES identity.memberships(tenant_id,user_id);
UPDATE inventory.stock_count_lines SET counted_revision=1 WHERE counted_quantity IS NOT NULL;

CREATE TABLE inventory.stock_count_events(
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  count_id uuid NOT NULL,
  count_version bigint NOT NULL CHECK(count_version>0),
  revision integer NOT NULL CHECK(revision>0),
  count_status text NOT NULL CHECK(count_status IN ('OPEN','POSTED','CANCELLED')),
  event_type text NOT NULL CHECK(event_type IN ('LEGACY_CHECKPOINT','OPENED','SAVED','REVIEWED','POSTED','CANCELLED')),
  command_id uuid,
  actor_id uuid REFERENCES identity.users(id),
  actor_name_snapshot text NOT NULL,
  reason text CHECK(reason IS NULL OR length(trim(reason)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,outlet_id,count_id,id),
  UNIQUE(tenant_id,outlet_id,count_id,count_version),
  UNIQUE(tenant_id,command_id),
  FOREIGN KEY(tenant_id,outlet_id,count_id) REFERENCES inventory.stock_counts(tenant_id,outlet_id,id),
  FOREIGN KEY(tenant_id,command_id) REFERENCES system.commands(tenant_id,command_id),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES identity.memberships(tenant_id,user_id),
  CHECK((event_type='LEGACY_CHECKPOINT' AND command_id IS NULL AND actor_id IS NULL)
    OR (event_type<>'LEGACY_CHECKPOINT' AND command_id IS NOT NULL AND actor_id IS NOT NULL)),
  CHECK(event_type<>'REVIEWED' OR reason IS NOT NULL)
);
CREATE TABLE inventory.stock_count_line_events(
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  count_id uuid NOT NULL,
  event_id uuid NOT NULL,
  product_id uuid NOT NULL,
  before_state jsonb CHECK(before_state IS NULL OR jsonb_typeof(before_state)='object'),
  after_state jsonb NOT NULL CHECK(jsonb_typeof(after_state)='object'),
  PRIMARY KEY(tenant_id,outlet_id,count_id,event_id,product_id),
  FOREIGN KEY(tenant_id,outlet_id,count_id,event_id) REFERENCES inventory.stock_count_events(tenant_id,outlet_id,count_id,id),
  FOREIGN KEY(tenant_id,outlet_id,product_id) REFERENCES catalog.products(tenant_id,outlet_id,id)
);
CREATE INDEX stock_count_events_history_idx
  ON inventory.stock_count_events(tenant_id,outlet_id,count_id,count_version DESC);

-- This is an upgrade-time checkpoint of surviving facts. It does not reconstruct
-- overwritten saves, original product versions or a historical ordinal boundary.
INSERT INTO inventory.stock_count_events(id,tenant_id,outlet_id,count_id,count_version,revision,count_status,event_type,actor_name_snapshot)
  SELECT gen_random_uuid(),tenant_id,outlet_id,id,version,1,status,'LEGACY_CHECKPOINT','Legacy checkpoint at migration 026'
  FROM inventory.stock_counts;
INSERT INTO inventory.stock_count_line_events(tenant_id,outlet_id,count_id,event_id,product_id,before_state,after_state)
  SELECT l.tenant_id,l.outlet_id,l.count_id,e.id,l.product_id,NULL,to_jsonb(l)
  FROM inventory.stock_count_lines l JOIN inventory.stock_count_events e
    ON e.tenant_id=l.tenant_id AND e.outlet_id=l.outlet_id AND e.count_id=l.count_id;
UPDATE inventory.stock_counts c SET last_event_id=e.id FROM inventory.stock_count_events e
  WHERE e.tenant_id=c.tenant_id AND e.outlet_id=c.outlet_id AND e.count_id=c.id;
ALTER TABLE inventory.stock_counts ADD CONSTRAINT stock_count_last_event_fk
  FOREIGN KEY(tenant_id,outlet_id,id,last_event_id)
  REFERENCES inventory.stock_count_events(tenant_id,outlet_id,count_id,id) DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION inventory.reject_count_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Inventory movement and count event evidence is immutable.' USING ERRCODE='55000';
END $$;
CREATE TRIGGER stock_count_events_immutable BEFORE UPDATE OR DELETE ON inventory.stock_count_events
  FOR EACH ROW EXECUTE FUNCTION inventory.reject_count_evidence_mutation();
CREATE TRIGGER stock_count_line_events_immutable BEFORE UPDATE OR DELETE ON inventory.stock_count_line_events
  FOR EACH ROW EXECUTE FUNCTION inventory.reject_count_evidence_mutation();
CREATE TRIGGER inventory_movement_evidence_immutable BEFORE UPDATE OR DELETE ON inventory.movements
  FOR EACH ROW EXECUTE FUNCTION inventory.reject_count_evidence_mutation();

CREATE FUNCTION inventory.guard_count_header_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.status<>'OPEN' THEN
    RAISE EXCEPTION 'Completed count projections and count history cannot be removed or rewritten.' USING ERRCODE='55000';
  END IF;
  IF ROW(NEW.id,NEW.tenant_id,NEW.outlet_id,NEW.count_mode,NEW.area_label,NEW.baseline_at,NEW.opened_by,NEW.opened_at,NEW.review_nonce)
      IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.outlet_id,OLD.count_mode,OLD.area_label,OLD.baseline_at,OLD.opened_by,OLD.opened_at,OLD.review_nonce) THEN
    RAISE EXCEPTION 'Original count identity and opening evidence is immutable.' USING ERRCODE='55000';
  END IF;
  IF NEW.version<>OLD.version AND NEW.version<>OLD.version+1 THEN
    RAISE EXCEPTION 'A count transition must advance exactly one version.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stock_count_header_immutable BEFORE UPDATE OR DELETE ON inventory.stock_counts
  FOR EACH ROW EXECUTE FUNCTION inventory.guard_count_header_mutation();

CREATE FUNCTION inventory.guard_count_line_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE status text;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Count lines cannot be deleted.' USING ERRCODE='55000';
  END IF;
  SELECT c.status INTO status FROM inventory.stock_counts c WHERE c.tenant_id=NEW.tenant_id AND c.outlet_id=NEW.outlet_id AND c.id=NEW.count_id;
  IF status IS NOT NULL AND status<>'OPEN' THEN
    RAISE EXCEPTION 'Completed count lines cannot be added or rewritten.' USING ERRCODE='55000';
  END IF;
  IF TG_OP='UPDATE' AND ROW(NEW.tenant_id,NEW.outlet_id,NEW.count_id,NEW.product_id)
      IS DISTINCT FROM ROW(OLD.tenant_id,OLD.outlet_id,OLD.count_id,OLD.product_id) THEN
    RAISE EXCEPTION 'Count line identity is immutable.' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stock_count_line_write_guard BEFORE INSERT OR UPDATE OR DELETE ON inventory.stock_count_lines
  FOR EACH ROW EXECUTE FUNCTION inventory.guard_count_line_write();

-- Evidence children cannot be appended later to a sealed event. New event
-- writes occur while the originating command is EXECUTING and the count OPEN.
CREATE FUNCTION inventory.guard_count_evidence_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c inventory.stock_counts%ROWTYPE; e inventory.stock_count_events%ROWTYPE; command_status text; command_actor uuid; command_outlet uuid;
BEGIN
  SELECT * INTO c FROM inventory.stock_counts WHERE tenant_id=NEW.tenant_id AND outlet_id=NEW.outlet_id AND id=NEW.count_id;
  IF c.status<>'OPEN' THEN RAISE EXCEPTION 'Completed count evidence is sealed.' USING ERRCODE='55000'; END IF;
  IF TG_TABLE_NAME='stock_count_events' THEN e=NEW;
  ELSE SELECT * INTO e FROM inventory.stock_count_events WHERE tenant_id=NEW.tenant_id AND outlet_id=NEW.outlet_id AND count_id=NEW.count_id AND id=NEW.event_id;
  END IF;
  IF e.event_type='LEGACY_CHECKPOINT' AND c.recovery_protocol=0 AND c.last_event_id IS NULL THEN RETURN NEW; END IF;
  SELECT cmd.status,cmd.actor_id,d.outlet_id INTO command_status,command_actor,command_outlet
    FROM system.commands cmd JOIN identity.devices d ON d.tenant_id=cmd.tenant_id AND d.id=cmd.device_id
    WHERE cmd.tenant_id=e.tenant_id AND cmd.command_id=e.command_id;
  IF command_status IS DISTINCT FROM 'EXECUTING' OR command_actor IS DISTINCT FROM e.actor_id OR command_outlet IS DISTINCT FROM e.outlet_id THEN
    RAISE EXCEPTION 'Count evidence must belong to its executing actor/outlet transition.' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stock_count_event_insert_guard BEFORE INSERT ON inventory.stock_count_events
  FOR EACH ROW EXECUTE FUNCTION inventory.guard_count_evidence_insert();
CREATE TRIGGER stock_count_line_event_insert_guard BEFORE INSERT ON inventory.stock_count_line_events
  FOR EACH ROW EXECUTE FUNCTION inventory.guard_count_evidence_insert();

CREATE FUNCTION inventory.require_count_header_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c inventory.stock_counts%ROWTYPE; e inventory.stock_count_events%ROWTYPE;
BEGIN
  SELECT * INTO c FROM inventory.stock_counts WHERE tenant_id=NEW.tenant_id AND outlet_id=NEW.outlet_id AND id=NEW.id;
  -- A rolling old writer may open a labeled legacy draft. It cannot save/post
  -- a transition without matching evidence, or post without a reviewed baseline.
  IF TG_OP='INSERT' AND c.recovery_protocol=0 AND c.last_event_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO e FROM inventory.stock_count_events WHERE tenant_id=c.tenant_id AND outlet_id=c.outlet_id AND count_id=c.id AND id=c.last_event_id;
  IF NOT FOUND OR e.count_version<>c.version OR e.revision<>c.baseline_revision OR e.count_status<>c.status THEN
    RAISE EXCEPTION 'A count transition requires matching immutable evidence.' USING ERRCODE='23514';
  END IF;
  IF c.status='POSTED' AND (c.recovery_protocol<>1 OR c.recovery_coverage<>'COMPLETE' OR e.event_type<>'POSTED') THEN
    RAISE EXCEPTION 'Posting requires a compatible writer and reviewed count evidence.' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER stock_count_header_evidence AFTER INSERT OR UPDATE ON inventory.stock_counts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION inventory.require_count_header_evidence();

CREATE FUNCTION inventory.require_count_line_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c inventory.stock_counts%ROWTYPE; line inventory.stock_count_lines%ROWTYPE; evidence jsonb;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Count lines cannot be deleted; cancel the preserved count instead.' USING ERRCODE='55000';
  END IF;
  SELECT * INTO c FROM inventory.stock_counts WHERE tenant_id=NEW.tenant_id AND outlet_id=NEW.outlet_id AND id=NEW.count_id;
  SELECT * INTO line FROM inventory.stock_count_lines WHERE tenant_id=NEW.tenant_id AND outlet_id=NEW.outlet_id AND count_id=NEW.count_id AND product_id=NEW.product_id;
  IF TG_OP='INSERT' AND c.recovery_protocol=0 AND c.last_event_id IS NULL THEN RETURN NULL; END IF;
  SELECT after_state INTO evidence FROM inventory.stock_count_line_events
    WHERE tenant_id=c.tenant_id AND outlet_id=c.outlet_id AND count_id=c.id AND event_id=c.last_event_id AND product_id=line.product_id;
  IF NOT FOUND OR evidence IS DISTINCT FROM to_jsonb(line) THEN
    RAISE EXCEPTION 'Count line changes require matching immutable evidence.' USING ERRCODE='23514';
  END IF;
  IF line.counted_quantity IS NOT NULL AND line.counted_revision IS DISTINCT FROM line.baseline_revision THEN
    RAISE EXCEPTION 'A physical count must be saved against its baseline revision.' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER stock_count_line_evidence AFTER INSERT OR UPDATE OR DELETE ON inventory.stock_count_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION inventory.require_count_line_evidence();
