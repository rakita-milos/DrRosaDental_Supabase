SET search_path TO app, public;

ALTER TABLE doctors
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
