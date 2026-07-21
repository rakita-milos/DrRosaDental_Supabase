ALTER TABLE doctors
  ADD COLUMN IF NOT EXISTS google_color_id TEXT;

ALTER TABLE doctors
  ADD COLUMN IF NOT EXISTS calendar_color TEXT;

ALTER TABLE doctors
  ADD COLUMN IF NOT EXISTS calendar_text_color TEXT;
