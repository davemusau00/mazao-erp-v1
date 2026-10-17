CREATE TABLE core.configuration_assets (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES core.tenants(id),
  kind text NOT NULL CHECK (kind IN ('logo', 'receipt_qr')),
  draft_id uuid NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES identity.users(id),
  content bytea NOT NULL,
  sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32),
  byte_length integer NOT NULL CHECK (byte_length BETWEEN 1 AND 524288),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'RETIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  retired_at timestamptz,
  CHECK (octet_length(content) = byte_length),
  CHECK (substring(content FROM 1 FOR 8) = decode('89504e470d0a1a0a', 'hex')),
  UNIQUE (tenant_id, draft_id, kind)
);

CREATE UNIQUE INDEX configuration_assets_one_active_kind
  ON core.configuration_assets (tenant_id, kind)
  WHERE status = 'ACTIVE';

CREATE INDEX configuration_assets_tenant_kind_status
  ON core.configuration_assets (tenant_id, kind, status, created_at DESC);
