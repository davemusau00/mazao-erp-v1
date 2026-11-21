-- Durable source orders and immutable station ticket batches. This migration
-- does not post ingredient consumption, payments, sales, folios or journals.
CREATE TABLE restaurant.orders (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  table_id uuid,
  table_name_snapshot text,
  service_label text NOT NULL CHECK (length(trim(service_label)) BETWEEN 1 AND 100),
  owner_id uuid NOT NULL,
  owner_name_snapshot text NOT NULL,
  created_by_device_id uuid NOT NULL,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','FIRED','CANCELLED')),
  held boolean NOT NULL DEFAULT false,
  instructions text NOT NULL DEFAULT '' CHECK (length(instructions)<=500),
  version bigint NOT NULL DEFAULT 1 CHECK (version>0),
  fire_revision integer NOT NULL DEFAULT 0 CHECK (fire_revision>=0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id,outlet_id,id),
  FOREIGN KEY (tenant_id,outlet_id) REFERENCES core.outlets(tenant_id,id),
  FOREIGN KEY (tenant_id,outlet_id,table_id) REFERENCES restaurant.tables(tenant_id,outlet_id,id),
  FOREIGN KEY (tenant_id,owner_id) REFERENCES identity.memberships(tenant_id,user_id),
  FOREIGN KEY (tenant_id,outlet_id,created_by_device_id) REFERENCES identity.devices(tenant_id,outlet_id,id),
  CHECK ((status='DRAFT' AND fire_revision=0) OR (status='FIRED' AND fire_revision>0) OR (status='CANCELLED' AND fire_revision=0 AND NOT held))
);
CREATE UNIQUE INDEX restaurant_active_tab_label_idx ON restaurant.orders(tenant_id,outlet_id,coalesce(table_id,'00000000-0000-0000-0000-000000000000'::uuid),lower(service_label)) WHERE status<>'CANCELLED';
CREATE INDEX restaurant_orders_history_idx ON restaurant.orders(tenant_id,outlet_id,created_at DESC,id DESC);
CREATE INDEX restaurant_orders_table_idx ON restaurant.orders(tenant_id,outlet_id,table_id,status);

CREATE TABLE restaurant.order_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  order_id uuid NOT NULL,
  product_id uuid NOT NULL,
  sku_snapshot text NOT NULL,
  name_snapshot text NOT NULL,
  item_kind_snapshot text NOT NULL CHECK (item_kind_snapshot IN ('STOCKED_GOOD','SERVICE','PREPARED')),
  base_unit_snapshot text NOT NULL,
  currency char(3) NOT NULL,
  quantity numeric(20,6) NOT NULL CHECK (quantity>0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor BETWEEN 0 AND 9007199254740991),
  tax_rate_bps integer NOT NULL CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  line_subtotal_minor bigint NOT NULL CHECK (line_subtotal_minor BETWEEN 0 AND 9007199254740991),
  line_tax_minor bigint NOT NULL CHECK (line_tax_minor BETWEEN 0 AND 9007199254740991),
  product_version bigint NOT NULL CHECK (product_version>0),
  menu_version bigint NOT NULL CHECK (menu_version>0),
  preparation_label text NOT NULL,
  preparation_instructions text NOT NULL,
  modifiers jsonb NOT NULL CHECK (jsonb_typeof(modifiers)='array' AND jsonb_array_length(modifiers)<=8),
  instructions text NOT NULL CHECK (length(instructions)<=500),
  station_snapshots jsonb NOT NULL CHECK (jsonb_typeof(station_snapshots)='array' AND jsonb_array_length(station_snapshots) BETWEEN 1 AND 8),
  fire_revision integer CHECK (fire_revision>0),
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id,outlet_id,order_id,id),
  FOREIGN KEY (tenant_id,outlet_id,order_id) REFERENCES restaurant.orders(tenant_id,outlet_id,id),
  FOREIGN KEY (tenant_id,outlet_id,product_id) REFERENCES catalog.products(tenant_id,outlet_id,id),
  CHECK (fire_revision IS NULL OR removed_at IS NULL)
);
CREATE INDEX restaurant_order_lines_order_idx ON restaurant.order_lines(tenant_id,outlet_id,order_id,created_at,id);

CREATE TABLE restaurant.fire_batches (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  order_id uuid NOT NULL,
  fire_revision integer NOT NULL CHECK (fire_revision>0),
  ticket_type text NOT NULL CHECK (ticket_type IN ('NEW','ADD_ON')),
  original_batch_id uuid,
  command_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  device_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id,outlet_id,order_id,id),
  UNIQUE (tenant_id,outlet_id,order_id,fire_revision),
  UNIQUE (tenant_id,command_id),
  FOREIGN KEY (tenant_id,outlet_id,order_id) REFERENCES restaurant.orders(tenant_id,outlet_id,id),
  FOREIGN KEY (tenant_id,outlet_id,order_id,original_batch_id) REFERENCES restaurant.fire_batches(tenant_id,outlet_id,order_id,id),
  FOREIGN KEY (tenant_id,command_id) REFERENCES system.commands(tenant_id,command_id),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES identity.memberships(tenant_id,user_id),
  FOREIGN KEY (tenant_id,outlet_id,device_id) REFERENCES identity.devices(tenant_id,outlet_id,id),
  CHECK ((ticket_type='NEW' AND fire_revision=1 AND original_batch_id IS NULL) OR (ticket_type='ADD_ON' AND fire_revision>1 AND original_batch_id IS NOT NULL))
);
CREATE TABLE restaurant.tickets (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  order_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  station_id uuid NOT NULL,
  station_name_snapshot text NOT NULL,
  station_kind_snapshot text NOT NULL CHECK (station_kind_snapshot IN ('KITCHEN','BAR','EXPO')),
  document_hash char(64) NOT NULL CHECK (document_hash ~ '^[a-f0-9]{64}$'),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id,outlet_id,order_id,id),
  UNIQUE (tenant_id,outlet_id,batch_id,station_id),
  UNIQUE (tenant_id,outlet_id,order_id,id,station_id),
  FOREIGN KEY (tenant_id,outlet_id,order_id,batch_id) REFERENCES restaurant.fire_batches(tenant_id,outlet_id,order_id,id),
  FOREIGN KEY (tenant_id,outlet_id,station_id) REFERENCES restaurant.stations(tenant_id,outlet_id,id)
);
CREATE INDEX restaurant_ticket_station_history_idx ON restaurant.tickets(tenant_id,outlet_id,station_id,created_at DESC,id DESC);
CREATE INDEX restaurant_ticket_order_history_idx ON restaurant.tickets(tenant_id,outlet_id,order_id,created_at DESC,id DESC);
CREATE TABLE restaurant.ticket_lines (
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  order_id uuid NOT NULL,
  ticket_id uuid NOT NULL,
  order_line_id uuid NOT NULL,
  station_id uuid NOT NULL,
  PRIMARY KEY (tenant_id,outlet_id,ticket_id,order_line_id),
  UNIQUE (tenant_id,outlet_id,order_line_id,station_id),
  FOREIGN KEY (tenant_id,outlet_id,order_id,ticket_id,station_id) REFERENCES restaurant.tickets(tenant_id,outlet_id,order_id,id,station_id),
  FOREIGN KEY (tenant_id,outlet_id,order_id,order_line_id) REFERENCES restaurant.order_lines(tenant_id,outlet_id,order_id,id),
  FOREIGN KEY (tenant_id,outlet_id,station_id) REFERENCES restaurant.stations(tenant_id,outlet_id,id)
);

CREATE FUNCTION restaurant.reject_immutable_ticket_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Fired restaurant evidence is immutable.' USING ERRCODE='23514';
END $$;
CREATE TRIGGER restaurant_batch_immutable BEFORE UPDATE OR DELETE ON restaurant.fire_batches FOR EACH ROW EXECUTE FUNCTION restaurant.reject_immutable_ticket_change();
CREATE TRIGGER restaurant_ticket_immutable BEFORE UPDATE OR DELETE ON restaurant.tickets FOR EACH ROW EXECUTE FUNCTION restaurant.reject_immutable_ticket_change();
CREATE TRIGGER restaurant_ticket_line_immutable BEFORE UPDATE OR DELETE ON restaurant.ticket_lines FOR EACH ROW EXECUTE FUNCTION restaurant.reject_immutable_ticket_change();
CREATE FUNCTION restaurant.guard_fired_order_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.fire_revision IS NOT NULL THEN
    RAISE EXCEPTION 'Fired restaurant lines cannot be changed or removed.' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER restaurant_fired_line_immutable BEFORE UPDATE OR DELETE ON restaurant.order_lines FOR EACH ROW EXECUTE FUNCTION restaurant.guard_fired_order_line();
