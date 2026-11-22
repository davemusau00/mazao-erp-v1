-- Persist station tickets for explicit, recoverable browser print dispatch.
-- This records operator confirmation, not device-level proof that paper emerged.
CREATE TABLE restaurant.print_jobs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  order_id uuid NOT NULL,
  ticket_id uuid NOT NULL,
  station_id uuid NOT NULL,
  job_type text NOT NULL CHECK (job_type IN ('NEW','ADD_ON','COPY')),
  copy_number integer NOT NULL CHECK (copy_number >= 0),
  source_job_id uuid,
  document_hash char(64) NOT NULL CHECK (document_hash ~ '^[a-f0-9]{64}$'),
  document_snapshot jsonb NOT NULL CHECK (jsonb_typeof(document_snapshot)='object'),
  status text NOT NULL CHECK (status IN ('QUEUED','CLAIMED','OPERATOR_CONFIRMED','FAILED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  claim_id uuid,
  claimed_by_actor_id uuid,
  claimed_by_device_id uuid,
  claim_expires_at timestamptz,
  created_by_command_id uuid NOT NULL,
  created_by_actor_id uuid NOT NULL,
  created_by_device_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id,outlet_id,id),
  UNIQUE (tenant_id,outlet_id,ticket_id,id),
  UNIQUE (tenant_id,outlet_id,ticket_id,copy_number),
  FOREIGN KEY (tenant_id,outlet_id,order_id,ticket_id,station_id)
    REFERENCES restaurant.tickets(tenant_id,outlet_id,order_id,id,station_id),
  FOREIGN KEY (tenant_id,outlet_id,ticket_id,source_job_id)
    REFERENCES restaurant.print_jobs(tenant_id,outlet_id,ticket_id,id),
  FOREIGN KEY (tenant_id,created_by_command_id)
    REFERENCES system.commands(tenant_id,command_id),
  FOREIGN KEY (tenant_id,created_by_actor_id)
    REFERENCES identity.memberships(tenant_id,user_id),
  FOREIGN KEY (tenant_id,outlet_id,created_by_device_id)
    REFERENCES identity.devices(tenant_id,outlet_id,id),
  FOREIGN KEY (tenant_id,claimed_by_actor_id)
    REFERENCES identity.memberships(tenant_id,user_id),
  FOREIGN KEY (tenant_id,outlet_id,claimed_by_device_id)
    REFERENCES identity.devices(tenant_id,outlet_id,id),
  CHECK ((job_type='COPY' AND copy_number>0) OR (job_type IN ('NEW','ADD_ON') AND copy_number=0 AND source_job_id IS NULL)),
  CHECK ((status='CLAIMED' AND claim_id IS NOT NULL AND claimed_by_actor_id IS NOT NULL AND claimed_by_device_id IS NOT NULL AND claim_expires_at IS NOT NULL)
    OR (status<>'CLAIMED' AND claim_expires_at IS NULL))
);
CREATE UNIQUE INDEX restaurant_print_original_job_idx
  ON restaurant.print_jobs(tenant_id,outlet_id,ticket_id)
  WHERE job_type IN ('NEW','ADD_ON');
CREATE INDEX restaurant_print_station_queue_idx
  ON restaurant.print_jobs(tenant_id,outlet_id,station_id,status,created_at,id);

CREATE TABLE restaurant.print_job_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  job_id uuid NOT NULL,
  event_version integer NOT NULL CHECK (event_version > 0),
  event_type text NOT NULL CHECK (event_type IN ('QUEUED','CLAIMED','CLAIM_EXPIRED','OPERATOR_CONFIRMED','FAILED')),
  command_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  actor_name_snapshot text NOT NULL,
  device_id uuid NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id,outlet_id,job_id,event_version),
  FOREIGN KEY (tenant_id,outlet_id,job_id)
    REFERENCES restaurant.print_jobs(tenant_id,outlet_id,id),
  FOREIGN KEY (tenant_id,command_id)
    REFERENCES system.commands(tenant_id,command_id),
  FOREIGN KEY (tenant_id,actor_id)
    REFERENCES identity.memberships(tenant_id,user_id),
  FOREIGN KEY (tenant_id,outlet_id,device_id)
    REFERENCES identity.devices(tenant_id,outlet_id,id)
);
CREATE INDEX restaurant_print_event_history_idx
  ON restaurant.print_job_events(tenant_id,outlet_id,job_id,event_version DESC);

CREATE FUNCTION restaurant.guard_print_job_event_append() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_version integer;
  current_type text;
BEGIN
  SELECT event_version,event_type INTO current_version,current_type
  FROM restaurant.print_job_events
  WHERE tenant_id=NEW.tenant_id AND outlet_id=NEW.outlet_id AND job_id=NEW.job_id
  ORDER BY event_version DESC LIMIT 1 FOR UPDATE;

  IF NOT FOUND THEN
    IF NEW.event_version<>1 OR NEW.event_type<>'QUEUED' THEN
      RAISE EXCEPTION 'A restaurant print job must begin in QUEUED.' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.event_version<>current_version+1
    OR NOT (
      (current_type='QUEUED' AND NEW.event_type='CLAIMED') OR
      (current_type='CLAIMED' AND NEW.event_type IN ('CLAIM_EXPIRED','OPERATOR_CONFIRMED','FAILED')) OR
      (current_type='CLAIM_EXPIRED' AND NEW.event_type='CLAIMED')
    ) THEN
    RAISE EXCEPTION 'Restaurant print job events must advance in order.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER restaurant_print_job_event_sequence
  BEFORE INSERT ON restaurant.print_job_events
  FOR EACH ROW EXECUTE FUNCTION restaurant.guard_print_job_event_append();

CREATE FUNCTION restaurant.reject_print_job_event_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Restaurant print job history is append-only.' USING ERRCODE='23514';
END $$;
CREATE TRIGGER restaurant_print_job_event_immutable
  BEFORE UPDATE OR DELETE ON restaurant.print_job_events
  FOR EACH ROW EXECUTE FUNCTION restaurant.reject_print_job_event_change();

CREATE FUNCTION restaurant.guard_print_job_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.tenant_id,OLD.outlet_id,OLD.order_id,OLD.ticket_id,OLD.station_id,OLD.job_type,OLD.copy_number,OLD.source_job_id,OLD.document_hash,OLD.document_snapshot,OLD.created_by_command_id,OLD.created_by_actor_id,OLD.created_by_device_id,OLD.created_at)
     IS DISTINCT FROM
     ROW(NEW.tenant_id,NEW.outlet_id,NEW.order_id,NEW.ticket_id,NEW.station_id,NEW.job_type,NEW.copy_number,NEW.source_job_id,NEW.document_hash,NEW.document_snapshot,NEW.created_by_command_id,NEW.created_by_actor_id,NEW.created_by_device_id,NEW.created_at) THEN
    RAISE EXCEPTION 'Restaurant print job documents are immutable.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER restaurant_print_job_document_immutable
  BEFORE UPDATE ON restaurant.print_jobs
  FOR EACH ROW EXECUTE FUNCTION restaurant.guard_print_job_document();
