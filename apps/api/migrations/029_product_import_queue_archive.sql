ALTER TABLE catalog.product_import_batches
  ADD COLUMN queue_archived_at timestamptz,
  ADD COLUMN queue_archived_by uuid,
  ADD CONSTRAINT product_import_queue_archive_actor_fk
    FOREIGN KEY (tenant_id, queue_archived_by)
    REFERENCES identity.memberships(tenant_id, user_id),
  ADD CONSTRAINT product_import_queue_archive_actor_pair_check
    CHECK ((queue_archived_at IS NULL) = (queue_archived_by IS NULL)),
  ADD CONSTRAINT product_import_queue_archive_invalid_only_check
    CHECK (queue_archived_at IS NULL OR status = 'INVALID');

CREATE INDEX product_import_active_history_idx
  ON catalog.product_import_batches(tenant_id, outlet_id, created_at DESC)
  WHERE queue_archived_at IS NULL;
