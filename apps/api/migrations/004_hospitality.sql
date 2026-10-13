CREATE TABLE core.tenant_capabilities (
  tenant_id uuid NOT NULL REFERENCES core.tenants(id),
  capability text NOT NULL CHECK (capability ~ '^[a-z][a-z0-9_]{1,63}$'),
  enabled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,capability)
);

CREATE TABLE hospitality.rooms (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  room_number text NOT NULL CHECK (length(trim(room_number)) BETWEEN 1 AND 24),
  room_type text NOT NULL CHECK (length(trim(room_type)) BETWEEN 1 AND 80),
  nightly_rate_minor bigint NOT NULL CHECK (nightly_rate_minor > 0),
  tax_rate_bps integer NOT NULL CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  currency char(3) NOT NULL,
  status text NOT NULL DEFAULT 'READY' CHECK (status IN ('READY','OCCUPIED','DIRTY','MAINTENANCE')),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,outlet_id,id),
  UNIQUE (tenant_id,outlet_id,room_number),
  FOREIGN KEY (tenant_id,outlet_id) REFERENCES core.outlets(tenant_id,id)
);

CREATE TABLE hospitality.reservations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  room_id uuid NOT NULL,
  guest_name text NOT NULL CHECK (length(trim(guest_name)) BETWEEN 1 AND 160),
  guest_contact text CHECK (guest_contact IS NULL OR length(guest_contact)<=80),
  check_in_date date NOT NULL,
  check_out_date date NOT NULL,
  nightly_rate_minor bigint NOT NULL CHECK (nightly_rate_minor > 0),
  tax_rate_bps integer NOT NULL CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  currency char(3) NOT NULL,
  status text NOT NULL CHECK (status IN ('CONFIRMED','CANCELLED','CHECKED_IN')),
  version bigint NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,outlet_id,room_id) REFERENCES hospitality.rooms(tenant_id,outlet_id,id),
  CHECK (check_out_date > check_in_date),
  UNIQUE (tenant_id,outlet_id,id)
);
CREATE INDEX hospitality_reservations_room_dates_idx ON hospitality.reservations(tenant_id,outlet_id,room_id,check_in_date,check_out_date) WHERE status='CONFIRMED';

CREATE TABLE hospitality.stays (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  room_id uuid NOT NULL,
  reservation_id uuid,
  guest_name text NOT NULL CHECK (length(trim(guest_name)) BETWEEN 1 AND 160),
  guest_contact text CHECK (guest_contact IS NULL OR length(guest_contact)<=80),
  check_in_date date NOT NULL,
  expected_check_out_date date NOT NULL,
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  checked_out_at timestamptz,
  nightly_rate_minor bigint NOT NULL CHECK (nightly_rate_minor > 0),
  tax_rate_bps integer NOT NULL CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  currency char(3) NOT NULL,
  status text NOT NULL CHECK (status IN ('CHECKED_IN','CHECKED_OUT')),
  version bigint NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.users(id),
  FOREIGN KEY (tenant_id,outlet_id,room_id) REFERENCES hospitality.rooms(tenant_id,outlet_id,id),
  FOREIGN KEY (tenant_id,outlet_id,reservation_id) REFERENCES hospitality.reservations(tenant_id,outlet_id,id),
  CHECK (expected_check_out_date > check_in_date),
  UNIQUE (tenant_id,outlet_id,id)
);
CREATE UNIQUE INDEX hospitality_one_active_stay_per_room ON hospitality.stays(tenant_id,outlet_id,room_id) WHERE status='CHECKED_IN';

CREATE TABLE hospitality.folios (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  stay_id uuid NOT NULL,
  currency char(3) NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','SETTLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,outlet_id,stay_id),
  UNIQUE (tenant_id,outlet_id,id),
  FOREIGN KEY (tenant_id,outlet_id,stay_id) REFERENCES hospitality.stays(tenant_id,outlet_id,id)
);

CREATE TABLE hospitality.folio_entries (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  folio_id uuid NOT NULL,
  command_id uuid NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('ROOM_CHARGE','CASH_PAYMENT')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,command_id,entry_type),
  FOREIGN KEY (tenant_id,outlet_id,folio_id) REFERENCES hospitality.folios(tenant_id,outlet_id,id)
);

CREATE TABLE hospitality.housekeeping_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  room_id uuid NOT NULL,
  command_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES identity.users(id),
  from_status text NOT NULL,
  to_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,command_id),
  FOREIGN KEY (tenant_id,outlet_id,room_id) REFERENCES hospitality.rooms(tenant_id,outlet_id,id)
);
