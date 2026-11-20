ALTER TABLE hospitality.rooms
  ADD COLUMN max_adults integer CHECK (max_adults BETWEEN 1 AND 100),
  ADD COLUMN max_children integer CHECK (max_children BETWEEN 0 AND 100),
  ADD COLUMN max_occupants integer CHECK (max_occupants BETWEEN 1 AND 100),
  ADD CONSTRAINT room_capacity_complete CHECK ((max_adults IS NULL AND max_children IS NULL AND max_occupants IS NULL) OR (max_adults IS NOT NULL AND max_children IS NOT NULL AND max_occupants IS NOT NULL AND max_adults <= max_occupants AND max_children <= max_occupants));

CREATE TABLE hospitality.guest_registration_policies (
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK(version > 0),
  policy jsonb NOT NULL CHECK(jsonb_typeof(policy)='object'),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,outlet_id),
  FOREIGN KEY(tenant_id,outlet_id) REFERENCES core.outlets(tenant_id,id),
  FOREIGN KEY(tenant_id,updated_by) REFERENCES identity.memberships(tenant_id,user_id)
);

CREATE TABLE hospitality.guest_registrations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  reservation_id uuid,
  stay_id uuid,
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','FINAL')),
  version bigint NOT NULL DEFAULT 1 CHECK(version>0),
  policy_version bigint NOT NULL CHECK(policy_version>0),
  adult_count integer NOT NULL CHECK(adult_count BETWEEN 1 AND 100),
  child_count integer NOT NULL CHECK(child_count BETWEEN 0 AND 100),
  booker jsonb NOT NULL CHECK(jsonb_typeof(booker)='object'),
  emergency_contact jsonb NOT NULL CHECK(jsonb_typeof(emergency_contact)='object'),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  data_erased_at timestamptz,
  UNIQUE(tenant_id,outlet_id,id),
  UNIQUE(tenant_id,outlet_id,reservation_id),
  UNIQUE(tenant_id,outlet_id,stay_id),
  FOREIGN KEY(tenant_id,outlet_id) REFERENCES core.outlets(tenant_id,id),
  FOREIGN KEY(tenant_id,outlet_id,reservation_id) REFERENCES hospitality.reservations(tenant_id,outlet_id,id),
  FOREIGN KEY(tenant_id,outlet_id,stay_id) REFERENCES hospitality.stays(tenant_id,outlet_id,id),
  FOREIGN KEY(tenant_id,created_by) REFERENCES identity.memberships(tenant_id,user_id),
  FOREIGN KEY(tenant_id,updated_by) REFERENCES identity.memberships(tenant_id,user_id),
  CHECK((status='FINAL')=(stay_id IS NOT NULL AND finalized_at IS NOT NULL))
);

CREATE TABLE hospitality.guest_registration_occupants (
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  registration_id uuid NOT NULL,
  id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('ADULT','CHILD')),
  is_primary boolean NOT NULL DEFAULT false,
  details jsonb NOT NULL CHECK(jsonb_typeof(details)='object'),
  guardian_id uuid,
  document_type text CHECK(document_type IN ('NATIONAL_ID','PASSPORT','RESIDENT_ID','OTHER')),
  issuing_country char(2),
  document_expires_on date,
  document_ciphertext text,
  document_key_version text,
  document_suffix text,
  verified_by uuid,
  verified_at timestamptz,
  PRIMARY KEY(tenant_id,outlet_id,registration_id,id),
  FOREIGN KEY(tenant_id,outlet_id,registration_id) REFERENCES hospitality.guest_registrations(tenant_id,outlet_id,id),
  FOREIGN KEY(tenant_id,outlet_id,registration_id,guardian_id) REFERENCES hospitality.guest_registration_occupants(tenant_id,outlet_id,registration_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(tenant_id,verified_by) REFERENCES identity.memberships(tenant_id,user_id),
  CHECK(NOT is_primary OR kind='ADULT'),
  CHECK((kind='CHILD' AND guardian_id IS NOT NULL AND guardian_id<>id) OR (kind='ADULT' AND guardian_id IS NULL)),
  CHECK((document_ciphertext IS NULL AND document_key_version IS NULL AND document_suffix IS NULL AND document_type IS NULL AND issuing_country IS NULL AND verified_at IS NULL AND verified_by IS NULL) OR (document_ciphertext IS NOT NULL AND document_key_version IS NOT NULL AND document_suffix IS NOT NULL AND document_type IS NOT NULL AND issuing_country IS NOT NULL)),
  CHECK((verified_by IS NULL)=(verified_at IS NULL))
);
CREATE UNIQUE INDEX guest_registration_primary ON hospitality.guest_registration_occupants(tenant_id,outlet_id,registration_id) WHERE is_primary;

CREATE TABLE hospitality.guest_registration_revisions (
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  registration_id uuid NOT NULL,
  version bigint NOT NULL,
  command_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  reason text NOT NULL,
  private_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  erased_at timestamptz,
  PRIMARY KEY(tenant_id,outlet_id,registration_id,version),
  FOREIGN KEY(tenant_id,outlet_id,registration_id) REFERENCES hospitality.guest_registrations(tenant_id,outlet_id,id),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES identity.memberships(tenant_id,user_id)
);

CREATE TABLE system.guest_registration_operations (
  tenant_id uuid NOT NULL,
  command_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  registration_id uuid NOT NULL,
  expected_version bigint NOT NULL CHECK(expected_version>=0),
  reservation_id uuid,
  expected_reservation_version bigint,
  fenced boolean NOT NULL,
  PRIMARY KEY(tenant_id,command_id),
  FOREIGN KEY(tenant_id,command_id) REFERENCES system.commands(tenant_id,command_id),
  FOREIGN KEY(tenant_id,outlet_id) REFERENCES core.outlets(tenant_id,id)
);

ALTER TABLE hospitality.reservations ADD COLUMN guest_registration_id uuid,
  ADD CONSTRAINT reservation_guest_registration_fk FOREIGN KEY(tenant_id,outlet_id,guest_registration_id) REFERENCES hospitality.guest_registrations(tenant_id,outlet_id,id);
ALTER TABLE hospitality.stays ADD COLUMN guest_registration_id uuid,
  ADD CONSTRAINT stay_guest_registration_fk FOREIGN KEY(tenant_id,outlet_id,guest_registration_id) REFERENCES hospitality.guest_registrations(tenant_id,outlet_id,id);
CREATE UNIQUE INDEX reservation_guest_registration_unique ON hospitality.reservations(tenant_id,outlet_id,guest_registration_id) WHERE guest_registration_id IS NOT NULL;
CREATE UNIQUE INDEX stay_guest_registration_unique ON hospitality.stays(tenant_id,outlet_id,guest_registration_id) WHERE guest_registration_id IS NOT NULL;
CREATE INDEX guest_registration_retention_idx ON hospitality.guest_registrations(tenant_id,outlet_id,status,updated_at) WHERE data_erased_at IS NULL;
