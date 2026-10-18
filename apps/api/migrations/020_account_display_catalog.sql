-- Display labels are configurable. Economic classifications and control-account
-- identities remain fixed; no posted journal or historical document is rewritten.
ALTER TABLE core.tenants ADD COLUMN account_catalog_version bigint NOT NULL DEFAULT 1 CHECK(account_catalog_version>0);
CREATE TABLE finance.account_label_revisions (
  id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES core.tenants(id),
  account_code text NOT NULL CHECK(account_code~'^[A-Z0-9_]{1,64}$'),
  label text NOT NULL CHECK(length(trim(label)) BETWEEN 1 AND 120),
  catalog_version bigint NOT NULL CHECK(catalog_version>1),command_id uuid NOT NULL,
  actor_id uuid NOT NULL,operator_name_snapshot text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,catalog_version),UNIQUE(tenant_id,command_id),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES identity.memberships(tenant_id,user_id)
);
CREATE INDEX account_labels_latest ON finance.account_label_revisions(tenant_id,account_code,catalog_version DESC);
CREATE TRIGGER account_labels_immutable BEFORE UPDATE OR DELETE ON finance.account_label_revisions
  FOR EACH ROW EXECUTE FUNCTION finance.reject_accounting_evidence_mutation();
