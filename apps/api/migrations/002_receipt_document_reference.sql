ALTER TABLE inventory.movements
  ADD COLUMN document_reference text;

ALTER TABLE inventory.movements
  ADD CONSTRAINT inventory_movement_document_reference_length
  CHECK (document_reference IS NULL OR length(document_reference) <= 120);
