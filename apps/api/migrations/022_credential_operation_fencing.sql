-- Metadata only: never store a password, replayable body or new fingerprint.
-- Pre-upgrade command rows remain recoverable through their original scope.
CREATE TABLE system.credential_operations (
  tenant_id uuid NOT NULL,
  command_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  expected_credential_version bigint NOT NULL CHECK (expected_credential_version > 0),
  fenced boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, command_id),
  FOREIGN KEY (tenant_id, command_id) REFERENCES system.commands(tenant_id, command_id)
);
-- The submitted target is evidence even when a credential command is rejected
-- because that target is absent or belongs to another tenant. Domain membership
-- checks still guard execution and never-received reconciliation.
