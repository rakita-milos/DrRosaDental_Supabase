const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const serverSource = readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const calendarRepoSource = readFileSync(path.join(__dirname, '..', 'db', 'calendar.js'), 'utf8');
const schemaSource = readFileSync(path.join(__dirname, '..', 'database.postgres.sql'), 'utf8');
const authHelperSource = readFileSync(path.join(__dirname, '..', '..', 'tests', 'playwright', 'utils', 'auth.js'), 'utf8');

test('Google sync has server-side throttling and does not accept cron secret in query string', () => {
  assert.match(serverSource, /const googleSyncLimiter = createRateLimiter/);
  assert.match(serverSource, /app\.post\('\/api\/calendar-sync\/pull-google', googleSyncLimiter, authenticateToken/);
  assert.match(serverSource, /app\.post\('\/api\/calendar-sync\/daily-google-pull', googleSyncLimiter/);
  assert.match(serverSource, /const provided = req\.headers\['x-cron-secret'\]/);
  assert.doesNotMatch(serverSource, /req\.query\.secret/);
});

test('Google sync job lock is backed by a partial unique index and stale lock cleanup', () => {
  assert.match(schemaSource, /idx_google_calendar_sync_jobs_one_running/);
  assert.match(schemaSource, /WHERE status = 'running'/);
  assert.match(calendarRepoSource, /Google sync lock expired before completion/);
  assert.match(calendarRepoSource, /error\?\.code === '23505'/);
});

test('Appointment overlap protection exists at API and database layers', () => {
  assert.match(schemaSource, /CREATE EXTENSION IF NOT EXISTS btree_gist/);
  assert.match(schemaSource, /appointments_doctor_no_overlap/);
  assert.match(schemaSource, /appointments_chair_no_overlap/);
  assert.match(schemaSource, /EXCLUDE USING gist/);
  assert.match(schemaSource, /CREATE OR REPLACE FUNCTION prevent_appointment_overlap/);
  assert.match(schemaSource, /pg_advisory_xact_lock\(21400, NEW\.doctor_id\)/);
  assert.match(schemaSource, /CONSTRAINT = 'appointments_runtime_no_overlap'/);
  assert.match(schemaSource, /NEW\.google_sync_warning_code IN \('doctor_conflict', 'chair_conflict', 'chair_reassigned'\)/);
  assert.match(schemaSource, /google_sync_warning_code IS NULL/);
  assert.match(serverSource, /function isAppointmentOverlapConstraintError/);
  assert.match(serverSource, /error\?\.code === '23P01'/);
  assert.match(serverSource, /return sendAppointmentConflictError\(res\)/);
});

test('Playwright password login mode fails closed instead of falling back to token auth', () => {
  assert.match(authHelperSource, /PLAYWRIGHT_USE_PASSWORD_LOGIN !== "1"/);
  assert.match(authHelperSource, /throw new Error\(`Login setup failed/);
  assert.match(authHelperSource, /authenticateWithSignedToken/);
});
