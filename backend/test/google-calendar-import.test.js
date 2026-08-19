const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const serverSource = readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const googleSyncServiceSource = readFileSync(path.join(__dirname, '..', 'services', 'google-calendar-sync-service.js'), 'utf8');
const calendarRepoSource = readFileSync(path.join(__dirname, '..', 'db', 'calendar.js'), 'utf8');
const schemaSource = readFileSync(path.join(__dirname, '..', 'database.postgres.sql'), 'utf8');
const directorReportsSource = readFileSync(path.join(__dirname, '..', '..', 'src', 'scripts', 'director-reports.js'), 'utf8');
const directorPanelSource = readFileSync(path.join(__dirname, '..', '..', 'src', 'pages', 'director-panel.html'), 'utf8');
const apiSource = readFileSync(path.join(__dirname, '..', '..', 'src', 'scripts', 'api.js'), 'utf8');
const calendarSource = readFileSync(path.join(__dirname, '..', '..', 'src', 'scripts', 'calendar.js'), 'utf8');
const calendarPageSource = readFileSync(path.join(__dirname, '..', '..', 'src', 'pages', 'calendar.html'), 'utf8');
const stylesSource = readFileSync(path.join(__dirname, '..', '..', 'src', 'styles', 'styles.css'), 'utf8');
const vercelSource = readFileSync(path.join(__dirname, '..', '..', 'vercel.json'), 'utf8');

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
  assert.match(calendarRepoSource, /google_event_id, google_sync_status, google_event_type, google_sync_warning/);
  assert.match(calendarRepoSource, /appointment\.warning \? 'warning' : 'synced'/);
  assert.match(calendarRepoSource, /appointment\.googleEventType \|\| 'appointment'/);
});

test('Google color mapping is stored on doctors and used for import/export', () => {
  assert.match(schemaSource, /google_color_id TEXT/);
  assert.match(schemaSource, /calendar_color TEXT/);
  assert.match(schemaSource, /calendar_text_color TEXT/);
  assert.match(calendarRepoSource, /doctorByGoogleColor\(\{ googleColorId = null, calendarColor = null \}\)/);
  assert.match(calendarRepoSource, /\?::text IS NOT NULL AND google_color_id = \?::text/);
  assert.match(calendarRepoSource, /\?::text IS NOT NULL AND lower\(calendar_color\) = \?::text/);
  assert.match(calendarRepoSource, /google_color_id, calendar_color, calendar_text_color/);
  assert.match(calendarRepoSource, /d\.google_color_id as doctor_google_color_id/);
  assert.match(serverSource, /function googleEventColor\(event, colorContext = \{\}\)/);
  assert.match(serverSource, /eventLabelId,/);
  assert.match(serverSource, /colorId,/);
  assert.match(serverSource, /await calendarRepo\.doctorByGoogleColor/);
  assert.match(serverSource, /payload\.colorId = googleColorId/);
  assert.match(serverSource, /payload\.eventLabelId = googleColorId/);
  assert.match(serverSource, /eventLabelVersion=1/);
});

test('Google pull maps event color to doctor on both import and update', () => {
  assert.match(serverSource, /async function doctorForGoogleEvent\(event, colorContext, \{ fallbackDoctorId = null \} = \{\}\)/);
  assert.match(serverSource, /const googleColor = googleEventColor\(event, colorContext\)/);
  assert.match(serverSource, /doctorByGoogleColor\(\{\s*googleColorId: googleColor\.googleColorId,\s*calendarColor: googleColor\.background\s*\}\)/s);
  assert.match(serverSource, /if \(!matchedDoctor\?\.id && googleColor\.colorId && googleColor\.colorId !== googleColor\.googleColorId\)/);
  assert.match(serverSource, /googleColorId: googleColor\.colorId/);
  assert.match(serverSource, /const doctorChoice = await doctorForGoogleEvent\(event, colorContext\)/);
  assert.match(serverSource, /const doctorChoice = await doctorForGoogleEvent\(event, colorContext, \{ fallbackDoctorId: current\.doctor_id \}\)/);
  assert.match(serverSource, /String\(current\.doctor_id\) !== String\(doctor\?\.id \|\| current\.doctor_id\)/);
  assert.match(serverSource, /doctorId: doctor\?\.id \|\| current\.doctor_id/);
  assert.match(calendarRepoSource, /SET patient_id = \?, doctor_id = \?, chair_id = \?, starts_at = \?/);
  assert.match(calendarRepoSource, /\[patientId, doctorId, chairId, startsAt, endsAt/);
});

test('Google pull stores title and links patients only when confidently matched', () => {
  assert.match(schemaSource, /google_title TEXT/);
  assert.match(schemaSource, /google_patient_match_status TEXT/);
  assert.match(schemaSource, /google_patient_match_note TEXT/);
  assert.match(schemaSource, /patient_match_locked BOOLEAN NOT NULL DEFAULT false/);
  assert.match(serverSource, /function parseGooglePatientCandidate\(title\)/);
  assert.match(serverSource, /async function patientMatchForGoogleEvent\(event, googleEventType = 'appointment', current = null\)/);
  assert.match(serverSource, /findPatientsForGoogleTitle\(candidate\)/);
  assert.match(serverSource, /patientId: patientMatch\.patientId/);
  assert.match(serverSource, /googleTitle: patientMatch\.googleTitle/);
  assert.match(serverSource, /patientMatchStatus: patientMatch\.status/);
  assert.match(serverSource, /patientMatchNote: patientMatch\.note/);
  assert.match(calendarRepoSource, /findPatientsForGoogleTitle\(\{ firstName = '', lastName = '', phone = '' \}\)/);
  assert.match(calendarRepoSource, /google_title, google_patient_match_status,/);
  assert.match(calendarRepoSource, /google_patient_match_note, patient_match_locked/);
});

test('calendar appointment form exposes editable title copied from Google title', () => {
  assert.match(calendarPageSource, /id="appointment-title"/);
  assert.match(calendarSource, /appointment\.googleTitle \|\| appointment\.procedureName/);
  assert.match(calendarSource, /procedure_name: title/);
  assert.match(calendarSource, /function fillTitleFromProcedureIfEmpty\(\)/);
  assert.match(stylesSource, /\.appointment-form-section input,/);
});

test('manual patient selection on Google appointments is locked against future sync', () => {
  assert.match(serverSource, /lockPatientMatch: Boolean\(current\.google_event_id\) && String\(current\.patient_id\) !== String\(appointment\.patientId\)/);
  assert.match(calendarRepoSource, /patient_match_locked = CASE WHEN \? THEN true ELSE patient_match_locked END/);
  assert.match(calendarRepoSource, /google_patient_match_status = CASE WHEN \? THEN 'manual' ELSE google_patient_match_status END/);
  assert.match(serverSource, /if \(current\?\.patient_match_locked\)/);
  assert.match(serverSource, /Google sync ga ne menja/);
});

test('Google pull warns but keeps importing when event color has no doctor mapping', () => {
  assert.match(serverSource, /Google boja \$\{colorLabel\} nije povezana ni sa jednim aktivnim doktorom/);
  assert.match(serverSource, /\[googleColor\.eventLabelId, googleColor\.colorId, googleColor\.background\]/);
  assert.match(serverSource, /warningCode: hasGoogleColor \? 'google_doctor_color_unmapped' : null/);
  assert.match(serverSource, /function combineGoogleWarnings\(\.\.\.warnings\)/);
  assert.match(serverSource, /function combineGoogleWarningCodes\(\.\.\.codes\)/);
  assert.match(serverSource, /const conflictCode = parts\.find\(code => \['doctor_conflict', 'chair_conflict', 'chair_reassigned'\]\.includes\(code\)\)/);
  assert.match(serverSource, /return conflictCode \|\| parts\[0\] \|\| null/);
  assert.match(serverSource, /combineGoogleWarnings\(times\.warning, doctorChoice\.warning, chairChoice\.warning/);
  assert.match(serverSource, /combineGoogleWarningCodes\(times\.warningCode, doctorChoice\.warningCode, chairChoice\.warningCode/);
});

test('Google color picker loads colors dynamically without exposing secrets', () => {
  assert.match(serverSource, /app\.get\('\/api\/director\/google-calendar\/colors'/);
  assert.match(serverSource, /callGoogleCalendar\(settings, 'GET', '\/colors'\)/);
  assert.match(serverSource, /eventColors = Object\.entries\(colors\?\.event \|\| \{\}\)/);
  assert.match(serverSource, /colorId,\s*background:/);
  assert.match(serverSource, /res\.json\(\{\s*updated: colors\?\.updated \|\| '',\s*eventColors\s*\}\)/s);
  assert.match(apiSource, /async function getGoogleCalendarColors\(\)/);
  assert.match(apiSource, /request\("\/director\/google-calendar\/colors"\)/);
});

test('doctor admin color UI supports manual HEX fallback and Google swatches', () => {
  assert.match(directorPanelSource, /id="doctor-calendar-color" type="text"/);
  assert.match(directorPanelSource, /id="doctor-calendar-color-picker" type="color"/);
  assert.match(directorPanelSource, /id="doctor-google-color-swatches"/);
  assert.match(directorPanelSource, /id="doctor-color-preview"/);
  assert.match(directorReportsSource, /function normalizeDoctorHexColor\(value\)/);
  assert.match(directorReportsSource, /function isValidDoctorHexColor\(value\)/);
  assert.match(directorReportsSource, /function loadDoctorGoogleColors\(\)/);
  assert.match(directorReportsSource, /Google boje nisu dostupne\. Unesite HEX rucno/);
  assert.match(directorReportsSource, /doctor-google-color-swatch/);
  assert.doesNotMatch(directorReportsSource, /GOOGLE_EVENT_COLORS/);
  assert.doesNotMatch(directorReportsSource, /#a4bdfc/);
});

test('doctor admin table exposes activate action for inactive doctors', () => {
  assert.match(directorPanelSource, /class="admin-codebook-form doctor-admin-form"/);
  assert.match(directorPanelSource, /class="table-wrap doctor-admin-table-wrap"/);
  assert.match(directorPanelSource, /<table class="doctor-admin-table">/);
  assert.match(directorReportsSource, /function doctorPayloadFromExisting\(doctor, overrides = \{\}\)/);
  assert.match(directorReportsSource, /doctor-status-pill/);
  assert.match(directorReportsSource, /doctor-admin-actions/);
  assert.match(directorReportsSource, /activate-doctor-btn/);
  assert.match(directorReportsSource, /Aktiviraj/);
  assert.match(directorReportsSource, /updateDoctor\(doctor\.id, doctorPayloadFromExisting\(doctor, \{ isActive: true \}\)\)/);
  assert.doesNotMatch(directorReportsSource, /deactivate-doctor-btn"[^>]*disabled/);
});

test('doctor admin table fits desktop and becomes card layout on small screens', () => {
  assert.doesNotMatch(directorPanelSource, /<table class="doctor-admin-table">[\s\S]*?<th>Status<\/th>[\s\S]*?<tbody id="doctor-admin-table"/);
  assert.match(directorReportsSource, /<td data-label="Doktor">/);
  assert.match(directorReportsSource, /<td data-label="Akcije">/);
  assert.match(directorReportsSource, /colspan="6"/);
  assert.match(stylesSource, /\.doctor-admin-table-wrap\s*\{\s*overflow-x: visible;/);
  assert.match(stylesSource, /\.doctor-admin-table\s*\{\s*table-layout: fixed;/);
  assert.match(stylesSource, /@media \(max-width: 760px\)[\s\S]*\.doctor-admin-table[\s\S]*display: block;/);
  assert.match(stylesSource, /\.doctor-admin-table td::before[\s\S]*content: attr\(data-label\)/);
});

test('Google warning style does not override doctor color border', () => {
  assert.match(stylesSource, /\.google-event-warning\s*\{[\s\S]*box-shadow: inset 0 -2px 0 rgba\(245, 158, 11, 0\.58\);[\s\S]*\}/);
  assert.doesNotMatch(stylesSource, /\.google-event-warning\s*\{[\s\S]*border-left-color:\s*#f59e0b\s*!important/);
});

test('Google OAuth verification uses saved tokens without asking for a new code', () => {
  assert.match(serverSource, /app\.post\('\/api\/director\/google-calendar\/oauth\/verify'/);
  assert.match(serverSource, /callGoogleCalendar\(settings, 'GET', `\/calendars\/\$\{calendarId\}`\)/);
  assert.match(apiSource, /function verifyGoogleCalendarOAuth\(\)/);
  assert.match(apiSource, /request\("\/director\/google-calendar\/oauth\/verify", \{ method: "POST" \}\)/);
  assert.match(directorReportsSource, /function setGoogleOAuthUi\(settings, \{ reconnect = false \} = \{\}\)/);
  assert.match(directorReportsSource, /codeField\.hidden = !showCode/);
  assert.match(directorReportsSource, /settings\.oauthConnected && !googleOAuthReconnectMode/);
});

test('Manual Google pull uses a bounded date window and can complete all pages', () => {
  assert.match(serverSource, /async function pullGoogleCalendarChanges\(\{/);
  assert.match(serverSource, /complete = false/);
  assert.match(serverSource, /query\.set\('timeMax'/);
  assert.match(serverSource, /daysPast: req\.body\?\.daysPast/);
  assert.match(serverSource, /complete \? \(rangeMode \? 100 : 20\) : 2/);
  assert.match(apiSource, /pullGoogleCalendarChanges\(\{ reset = false, limit = 100, daysPast = 1, daysFuture = 14, complete = true, mode = "incremental"/);
  assert.match(directorReportsSource, /pullGoogleCalendarChanges\(\{ reset: false, limit: 50, daysPast: 1, daysFuture: 14 \}\)/);
  assert.doesNotMatch(directorReportsSource, /pullGoogleCalendarChanges\(\{ reset: true \}\)/);
});

test('Calendar Google sync can run through short async job steps to avoid Vercel timeout', () => {
  assert.match(schemaSource, /request_json TEXT/);
  assert.match(schemaSource, /cursor_json TEXT/);
  assert.match(schemaSource, /progress_json TEXT/);
  assert.match(schemaSource, /last_heartbeat_at TIMESTAMPTZ/);
  assert.match(serverSource, /function googlePullRequestFromBody/);
  assert.match(serverSource, /startGooglePullJobWithLock/);
  assert.match(serverSource, /processGooglePullJobStep/);
  assert.match(serverSource, /app\.post\('\/api\/calendar-sync\/pull-google\/step'/);
  assert.match(serverSource, /maxPagesOverride: 1/);
  assert.match(serverSource, /stepBudgetMs: 18000/);
  assert.match(serverSource, /deferMarkGooglePull: true/);
  assert.match(apiSource, /stepGoogleCalendarSync/);
  assert.match(calendarSource, /async: true/);
  assert.match(calendarSource, /limit: 25/);
  assert.match(calendarSource, /runGoogleSyncJob\(job\.id\)/);
  assert.doesNotMatch(calendarSource, /limit: 100,\s*\n\s*complete: true/);
});

test('Google Calendar auto sync watch can start from webhook and cron fallback', () => {
  assert.match(schemaSource, /watch_channel_id TEXT/);
  assert.match(schemaSource, /watch_resource_id TEXT/);
  assert.match(schemaSource, /watch_channel_token TEXT/);
  assert.match(schemaSource, /watch_expires_at TIMESTAMPTZ/);
  assert.match(schemaSource, /watch_last_message_number BIGINT/);
  assert.match(schemaSource, /last_webhook_at TIMESTAMPTZ/);
  assert.match(calendarRepoSource, /saveGoogleWatchChannel/);
  assert.match(calendarRepoSource, /saveGoogleWatchPending/);
  assert.match(calendarRepoSource, /markGoogleWebhookReceived/);
  assert.match(serverSource, /registerGoogleCalendarWatch/);
  assert.match(serverSource, /events\/watch/);
  assert.match(serverSource, /pendingInitialSync/);
  assert.match(serverSource, /app\.post\('\/api\/calendar-sync\/google\/webhook'/);
  assert.match(serverSource, /x-goog-channel-id/);
  assert.match(serverSource, /x-goog-resource-id/);
  assert.match(serverSource, /x-goog-message-number/);
  assert.match(serverSource, /startGooglePullJobWithLock\(\{ userId: null/);
  assert.match(serverSource, /app\.get\('\/api\/calendar-sync\/google\/cron'/);
  assert.match(vercelSource, /\/api\/calendar-sync\/google\/cron/);
  assert.match(apiSource, /renewGoogleCalendarWatch/);
  assert.match(directorReportsSource, /googleWatch/);
  assert.match(directorPanelSource, /google-renew-watch/);
});

test('Calendar page Google sync refreshes the visible date range instead of using incremental token mode', () => {
  assert.match(serverSource, /const rangeMode = mode === 'range'/);
  assert.match(serverSource, /if \(!rangeMode && !usedReset && settings\.events_sync_token\)/);
  assert.match(serverSource, /mode: rangeMode \? 'range' : 'incremental'/);
  assert.match(serverSource, /timeMin: rangeMode \? rangeStart : null/);
  assert.match(calendarSource, /function visibleSyncRange\(\)/);
  assert.match(calendarSource, /mode: "range"/);
  assert.match(calendarSource, /reset: true/);
  assert.match(calendarSource, /NIJE zavrseno sve - pokrenite sync ponovo/);
});

test('Google pull records warnings instead of skipping all-day and conflict events', () => {
  assert.match(googleSyncServiceSource, /function googleEventTimeInfo\(event\)/);
  assert.match(googleSyncServiceSource, /warningCode: 'all_day_event'/);
  assert.match(googleSyncServiceSource, /warningCode: 'invalid_time'/);
  assert.match(serverSource, /async function chairForGoogleEvent/);
  assert.match(serverSource, /action: warning \? 'imported_warning' : 'imported'/);
  assert.match(serverSource, /action: warning \? 'updated_warning' : 'updated'/);
  assert.match(serverSource, /stats\.importedWithWarning \+= 1/);
  assert.match(serverSource, /stats\.warningTotal \+= 1/);
  assert.match(serverSource, /stats\.skippedTotal = Number\(stats\.skippedExternal \|\| 0\)/);
  assert.match(serverSource, /stats\.doctorConflictWarnings \+= 1/);
  assert.match(serverSource, /stats\.chairConflictWarnings \+= 1/);
  assert.match(serverSource, /stats\.conflictWarningTotal \+= 1/);
  assert.match(calendarSource, /konflikti rasporeda kao upozorenje/);
  assert.match(calendarSource, /preskoceno: \$\{skipped\}/);
  assert.match(directorReportsSource, /konflikti rasporeda kao upozorenje/);
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS google_calendar_sync_jobs/);
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS app_notifications/);
});

test('Google all-day GO events are imported as doctor absence instead of patient appointments', () => {
  assert.match(googleSyncServiceSource, /function isGoogleDoctorAbsenceEvent\(event\)/);
  assert.match(googleSyncServiceSource, /googleEventType: 'doctor_absence'/);
  assert.match(serverSource, /function doctorFromGoogleTitle\(event\)/);
  assert.match(serverSource, /googleNotesForEvent\(event, times\.googleEventType\)/);
  assert.match(serverSource, /Ovaj dogadjaj ne blokira stolice/);
  assert.match(calendarRepoSource, /const filters = \['a\.starts_at < \?', 'a\.ends_at > \?'\]/);
  assert.match(calendarSource, /parseLocalDateTime\(item\.startsAt\) < dayEnd && parseLocalDateTime\(item\.endsAt\) > dayStart/);
  assert.match(calendarSource, /function weekVisibleAbsences\(days\)/);
  assert.match(calendarSource, /parseLocalDateTime\(appointment\.startsAt\) < weekEnd && parseLocalDateTime\(appointment\.endsAt\) > weekStart/);
});

test('Google import can infer preferred chair from event text', () => {
  assert.match(googleSyncServiceSource, /function chairIdFromGoogleEvent\(event, chairs = \[\]\)/);
  assert.match(googleSyncServiceSource, /googleEventChairSearchText\(event\)/);
  assert.match(googleSyncServiceSource, /\?:stolica\|chair\|s/);
  assert.match(serverSource, /chairIdFromGoogleEvent\(event, activeChairs\) \|\| preferredChairId/);
  assert.match(serverSource, /warningCode: 'chair_reassigned'/);
  assert.match(serverSource, /googleEventType: times\.googleEventType,\s*event/s);
});
