SET search_path TO app, public;

ALTER TABLE google_calendar_settings
  ADD COLUMN IF NOT EXISTS watch_channel_id TEXT,
  ADD COLUMN IF NOT EXISTS watch_resource_id TEXT,
  ADD COLUMN IF NOT EXISTS watch_channel_token TEXT,
  ADD COLUMN IF NOT EXISTS watch_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS watch_last_message_number BIGINT,
  ADD COLUMN IF NOT EXISTS watch_status TEXT NOT NULL DEFAULT 'inactive',
  ADD COLUMN IF NOT EXISTS last_webhook_at TIMESTAMPTZ;

ALTER TABLE google_calendar_settings
  DROP CONSTRAINT IF EXISTS google_calendar_settings_watch_status_check;

ALTER TABLE google_calendar_settings
  ADD CONSTRAINT google_calendar_settings_watch_status_check
  CHECK (watch_status IN ('inactive', 'active', 'expired', 'stopped', 'error'));

UPDATE google_calendar_settings
SET watch_status = 'inactive'
WHERE watch_status IS NULL;
