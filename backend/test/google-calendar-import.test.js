const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const serverSource = readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const calendarRepoSource = readFileSync(path.join(__dirname, '..', 'db', 'calendar.js'), 'utf8');
const schemaSource = readFileSync(path.join(__dirname, '..', 'database.postgres.sql'), 'utf8');

test('Google pull imports external calendar events instead of filtering them out', () => {
  assert.match(serverSource, /async function importAppointmentFromGoogleEvent\(event, times, colorContext\)/);
  assert.match(serverSource, /return importAppointmentFromGoogleEvent\(event, times, colorContext\)/);
  assert.match(serverSource, /result\.action === 'imported'/);
  assert.match(serverSource, /stats\.imported \+= 1/);
  assert.doesNotMatch(serverSource, /privateExtendedProperty['"], ['"]drrosaSource=drrosa/);
});

test('Google import preserves external event title and records unmatched patient context', () => {
  assert.match(serverSource, /const procedureName = cleanText\(event\.summary, \{ max: 255 \}\) \|\| 'Google Calendar termin'/);
  assert.match(serverSource, /Google naslov:/);
  assert.match(serverSource, /Pacijent nije povezan sa kartonom u aplikaciji/);
});

test('Google import repository creates fallback patient and synced appointment', () => {
  assert.match(calendarRepoSource, /ensureGoogleImportPatient\(\)/);
  assert.match(calendarRepoSource, /first_name = 'Google Calendar' AND last_name = 'Import'/);
  assert.match(calendarRepoSource, /INSERT INTO patients \(first_name, last_name, medical_history\)/);
  assert.match(calendarRepoSource, /importAppointmentFromGoogle\(appointment\)/);
  assert.match(calendarRepoSource, /google_event_id, google_sync_status, created_by, updated_by/);
  assert.match(calendarRepoSource, /VALUES \(\?, \?, \?, NULL, \?, \?, \?, \?, \?, \?, \?, 'synced', NULL, NULL\)/);
});

test('Google color mapping is stored on doctors and used for import/export', () => {
  assert.match(schemaSource, /google_color_id TEXT/);
  assert.match(schemaSource, /calendar_color TEXT/);
  assert.match(schemaSource, /calendar_text_color TEXT/);
  assert.match(calendarRepoSource, /doctorByGoogleColor\(\{ googleColorId = null, calendarColor = null \}\)/);
  assert.match(calendarRepoSource, /google_color_id, calendar_color, calendar_text_color/);
  assert.match(calendarRepoSource, /d\.google_color_id as doctor_google_color_id/);
  assert.match(serverSource, /function googleEventColor\(event, colorContext = \{\}\)/);
  assert.match(serverSource, /await calendarRepo\.doctorByGoogleColor/);
  assert.match(serverSource, /payload\.colorId = googleColorId/);
  assert.match(serverSource, /payload\.eventLabelId = googleColorId/);
  assert.match(serverSource, /eventLabelVersion=1/);
});
