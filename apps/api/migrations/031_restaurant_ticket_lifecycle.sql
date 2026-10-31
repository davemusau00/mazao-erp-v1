-- Durable station preparation state is append-only and separate from the
-- immutable KOT/BOT snapshot. NEW is created atomically with each fired ticket.
CREATE TABLE restaurant.ticket_state_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  order_id uuid NOT NULL,
  ticket_id uuid NOT NULL,
  station_id uuid NOT NULL,
  event_version integer NOT NULL CHECK (event_version > 0),
  status text NOT NULL CHECK (status IN ('NEW','ACKNOWLEDGED','PREPARING','READY')),
  previous_status text CHECK (previous_status IS NULL OR previous_status IN ('NEW','ACKNOWLEDGED','PREPARING','READY')),
  command_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  actor_name_snapshot text NOT NULL,
  device_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id,outlet_id,ticket_id,event_version),
  UNIQUE (tenant_id,outlet_id,ticket_id,command_id),
  FOREIGN KEY (tenant_id,outlet_id,order_id,ticket_id,station_id)
    REFERENCES restaurant.tickets(tenant_id,outlet_id,order_id,id,station_id),
  FOREIGN KEY (tenant_id,command_id) REFERENCES system.commands(tenant_id,command_id),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES identity.memberships(tenant_id,user_id),
  FOREIGN KEY (tenant_id,outlet_id,device_id) REFERENCES identity.devices(tenant_id,outlet_id,id)
);
CREATE INDEX restaurant_ticket_state_latest_idx
  ON restaurant.ticket_state_events(tenant_id,outlet_id,ticket_id,event_version DESC);

-- Existing fired tickets begin in NEW. The original fire command is retained
-- as their source evidence, including its actor and device identity.
INSERT INTO restaurant.ticket_state_events(
  id,tenant_id,outlet_id,order_id,ticket_id,station_id,event_version,status,
  previous_status,command_id,actor_id,actor_name_snapshot,device_id,created_at
)
SELECT gen_random_uuid(),t.tenant_id,t.outlet_id,t.order_id,t.id,t.station_id,1,'NEW',
  NULL,b.command_id,b.actor_id,u.full_name,b.device_id,t.created_at
FROM restaurant.tickets t
JOIN restaurant.fire_batches b
  ON b.tenant_id=t.tenant_id AND b.outlet_id=t.outlet_id AND b.order_id=t.order_id AND b.id=t.batch_id
JOIN identity.users u ON u.id=b.actor_id;

CREATE FUNCTION restaurant.guard_ticket_state_append() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_version integer;
  current_status text;
BEGIN
  SELECT event_version,status INTO current_version,current_status
  FROM restaurant.ticket_state_events
  WHERE tenant_id=NEW.tenant_id AND outlet_id=NEW.outlet_id AND ticket_id=NEW.ticket_id
  ORDER BY event_version DESC LIMIT 1 FOR UPDATE;

  IF NOT FOUND THEN
    IF NEW.event_version<>1 OR NEW.status<>'NEW' OR NEW.previous_status IS NOT NULL THEN
      RAISE EXCEPTION 'A fired restaurant ticket must begin in NEW.' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.event_version<>current_version+1
    OR NEW.previous_status IS DISTINCT FROM current_status
    OR NOT (
      (current_status='NEW' AND NEW.status='ACKNOWLEDGED') OR
      (current_status='ACKNOWLEDGED' AND NEW.status='PREPARING') OR
      (current_status='PREPARING' AND NEW.status='READY')
    ) THEN
    RAISE EXCEPTION 'Restaurant ticket states must advance one step in order.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER restaurant_ticket_state_sequence
  BEFORE INSERT ON restaurant.ticket_state_events
  FOR EACH ROW EXECUTE FUNCTION restaurant.guard_ticket_state_append();

CREATE FUNCTION restaurant.reject_immutable_ticket_state_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Restaurant ticket state history is append-only.' USING ERRCODE='23514';
END $$;
CREATE TRIGGER restaurant_ticket_state_immutable
  BEFORE UPDATE OR DELETE ON restaurant.ticket_state_events
  FOR EACH ROW EXECUTE FUNCTION restaurant.reject_immutable_ticket_state_change();
