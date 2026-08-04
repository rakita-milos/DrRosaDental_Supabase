ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS google_title TEXT;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS google_patient_match_status TEXT;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS google_patient_match_note TEXT;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS patient_match_locked BOOLEAN NOT NULL DEFAULT false;
