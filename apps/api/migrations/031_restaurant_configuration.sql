-- Configuration and logical assignment only. No kitchen orders, consumption,
-- payments or printer acknowledgement are created by this migration.
CREATE SCHEMA restaurant;

CREATE TABLE restaurant.sections (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  active boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,outlet_id,id),
  FOREIGN KEY (tenant_id,outlet_id) REFERENCES core.outlets(tenant_id,id)
);
CREATE UNIQUE INDEX restaurant_section_name_idx ON restaurant.sections(tenant_id,outlet_id,lower(name));
CREATE TABLE restaurant.tables (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  section_id uuid,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  seats integer NOT NULL CHECK (seats BETWEEN 1 AND 100),
  active boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,outlet_id,id),
  FOREIGN KEY (tenant_id,outlet_id) REFERENCES core.outlets(tenant_id,id),
  FOREIGN KEY (tenant_id,outlet_id,section_id) REFERENCES restaurant.sections(tenant_id,outlet_id,id)
);
CREATE UNIQUE INDEX restaurant_table_name_idx ON restaurant.tables(tenant_id,outlet_id,lower(name));
CREATE INDEX restaurant_table_section_idx ON restaurant.tables(tenant_id,outlet_id,section_id);
CREATE TABLE restaurant.stations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  kind text NOT NULL CHECK (kind IN ('KITCHEN','BAR','EXPO')),
  characters_per_line integer NOT NULL CHECK (characters_per_line BETWEEN 32 AND 64),
  active boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,outlet_id,id),
  FOREIGN KEY (tenant_id,outlet_id) REFERENCES core.outlets(tenant_id,id)
);
CREATE UNIQUE INDEX restaurant_station_name_idx ON restaurant.stations(tenant_id,outlet_id,lower(name));
CREATE TABLE restaurant.menu_routes (
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  product_id uuid NOT NULL,
  preparation_label text NOT NULL CHECK (length(trim(preparation_label)) BETWEEN 1 AND 100),
  instructions text NOT NULL CHECK (length(instructions) <= 500),
  available boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,outlet_id,product_id),
  FOREIGN KEY (tenant_id,outlet_id,product_id) REFERENCES catalog.products(tenant_id,outlet_id,id)
);
CREATE TABLE restaurant.menu_route_stations (
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  product_id uuid NOT NULL,
  station_id uuid NOT NULL,
  PRIMARY KEY (tenant_id,outlet_id,product_id,station_id),
  FOREIGN KEY (tenant_id,outlet_id,product_id) REFERENCES restaurant.menu_routes(tenant_id,outlet_id,product_id),
  FOREIGN KEY (tenant_id,outlet_id,station_id) REFERENCES restaurant.stations(tenant_id,outlet_id,id)
);
CREATE INDEX restaurant_routes_station_idx ON restaurant.menu_route_stations(tenant_id,outlet_id,station_id);
-- A logical authenticated workspace assignment is not physical enrollment.
CREATE TABLE restaurant.station_assignments (
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  device_id uuid NOT NULL,
  device_version bigint NOT NULL CHECK (device_version > 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,outlet_id,device_id),
  FOREIGN KEY (tenant_id,outlet_id,device_id) REFERENCES identity.devices(tenant_id,outlet_id,id)
);
CREATE TABLE restaurant.station_assignment_links (
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  device_id uuid NOT NULL,
  station_id uuid NOT NULL,
  PRIMARY KEY (tenant_id,outlet_id,device_id,station_id),
  FOREIGN KEY (tenant_id,outlet_id,device_id) REFERENCES restaurant.station_assignments(tenant_id,outlet_id,device_id),
  FOREIGN KEY (tenant_id,outlet_id,station_id) REFERENCES restaurant.stations(tenant_id,outlet_id,id)
);
CREATE INDEX restaurant_assignments_station_idx ON restaurant.station_assignment_links(tenant_id,outlet_id,station_id);
