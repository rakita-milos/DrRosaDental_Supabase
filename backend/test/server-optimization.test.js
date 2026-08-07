const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const serverSource = readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const routeUtilsSource = readFileSync(path.join(__dirname, '..', 'route-utils.js'), 'utf8');
const appointmentServiceSource = readFileSync(path.join(__dirname, '..', 'services', 'appointment-service.js'), 'utf8');
const systemRoutesSource = readFileSync(path.join(__dirname, '..', 'routes', 'system-routes.js'), 'utf8');
const clinicalRepoSource = readFileSync(path.join(__dirname, '..', 'db', 'clinical.js'), 'utf8');
const recordsRepoSource = readFileSync(path.join(__dirname, '..', 'db', 'records-payments.js'), 'utf8');
const patientsRepoSource = readFileSync(path.join(__dirname, '..', 'db', 'patients.js'), 'utf8');
const calendarRepoSource = readFileSync(path.join(__dirname, '..', 'db', 'calendar.js'), 'utf8');
const postgresSchemaSource = readFileSync(path.join(__dirname, '..', 'database.postgres.sql'), 'utf8');

test('route utils provide reusable async and error helpers', () => {
  assert.match(routeUtilsSource, /function asyncRoute\(handler\)/);
  assert.match(routeUtilsSource, /Promise\.resolve\(handler\(req, res, next\)\)\.catch\(next\)/);
  assert.match(routeUtilsSource, /function sendError\(res, error/);
  assert.match(serverSource, /const \{ asyncRoute, sendError \} = require\('\.\/route-utils'\)/);
});

test('Google sync routes use shared route helpers', () => {
  assert.match(serverSource, /app\.get\('\/api\/director\/calendar-sync', authenticateToken, requireDirector, asyncRoute/);
  assert.match(serverSource, /app\.get\('\/api\/calendar-sync\/google\/status', authenticateToken, requirePermission\('calendar:read'\), asyncRoute/);
  assert.match(serverSource, /sendError\(res, error, \{/);
});

test('appointments create and update share payload normalization', () => {
  assert.match(appointmentServiceSource, /function createAppointmentService\(/);
  assert.match(appointmentServiceSource, /async function payloadFromInput\(data/);
  assert.match(appointmentServiceSource, /function boundedAppointmentDuration\(value\)/);
  assert.match(serverSource, /createAppointmentService\(\{/);
  assert.match(serverSource, /const payload = await appointmentService\.payloadFromInput\(req\.body\)/);
  assert.match(serverSource, /const payload = await appointmentService\.payloadFromInput\(\{ \.\.\.current, \.\.\.req\.body \}\)/);
  assert.match(appointmentServiceSource, /if \(validateChair && !\(await calendarRepo\.rowExists\('chairs', chairId\)\)\)/);
});

test('critical calendar write routes use request body schemas', () => {
  assert.match(serverSource, /appointmentWriteSchema/);
  assert.match(serverSource, /appointmentStatusSchema/);
  assert.match(serverSource, /googlePullSchema/);
  assert.match(serverSource, /app\.post\('\/api\/appointments', authenticateToken, requirePermission\('calendar:write'\), validateBody\(appointmentWriteSchema\)/);
  assert.match(serverSource, /app\.put\('\/api\/appointments\/:id', authenticateToken, requirePermission\('calendar:write'\), validateBody\(appointmentWriteSchema\)/);
  assert.match(serverSource, /app\.patch\('\/api\/appointments\/:id\/status', authenticateToken, requirePermission\('calendar:write'\), validateBody\(appointmentStatusSchema\)/);
  assert.match(serverSource, /app\.post\('\/api\/calendar-sync\/pull-google', googleSyncLimiter, authenticateToken, requirePermission\('calendar:write'\), validateBody\(googlePullSchema\)/);
});

test('staff internal comments use patient permissions instead of full clinical write access', () => {
  assert.match(serverSource, /app\.get\('\/api\/patients\/:id\/internal-comments', authenticateToken, requirePermission\('patients:read'\)/);
  assert.match(serverSource, /app\.post\('\/api\/patients\/:id\/internal-comments', authenticateToken, requirePermission\('patients:write'\)/);
  assert.match(serverSource, /title: 'Interni komentar'/);
  assert.match(serverSource, /action: 'internal_comment_created'/);
  assert.match(clinicalRepoSource, /internalCommentsByPatient\(patientId\)/);
  assert.match(clinicalRepoSource, /WHERE patient_id = \? AND title = \?/);
});

test('public booking requires a global feature flag in addition to director settings', () => {
  assert.match(serverSource, /function publicBookingFeatureAvailable\(\)/);
  assert.match(serverSource, /process\.env\.PUBLIC_BOOKING_FEATURE_ENABLED \|\| '0'/);
  assert.match(serverSource, /return publicBookingFeatureAvailable\(\) && await appSetting\('public_booking_enabled', '0'\) === '1'/);
  assert.match(serverSource, /featureAvailable: publicBookingFeatureAvailable\(\)/);
  assert.match(serverSource, /requirePublicBookingEnabled/);
});

test('system routes are registered from a dedicated route module', () => {
  assert.match(systemRoutesSource, /function registerSystemRoutes\(app/);
  assert.match(systemRoutesSource, /app\.get\('\/api\/health'/);
  assert.match(systemRoutesSource, /app\.use\('\/src'/);
  assert.match(serverSource, /const \{ registerSystemRoutes \} = require\('\.\/routes\/system-routes'\)/);
  assert.match(serverSource, /registerSystemRoutes\(app, \{/);
});

test('records endpoint hydrates treatments and payments in batches', () => {
  const recordsRoute = serverSource.match(/app\.get\('\/api\/records'[\s\S]*?\n\}\);/)?.[0] || '';
  assert.match(recordsRepoSource, /treatmentsForRecords\(visitRecordIds\)/);
  assert.match(recordsRepoSource, /paymentPartsForRecords\(visitRecordIds\)/);
  assert.match(recordsRepoSource, /WHERE visit_record_id = ANY\(\?::int\[\]\)/);
  assert.match(recordsRoute, /Promise\.all\(\[/);
  assert.match(recordsRoute, /treatmentsByRecord/);
  assert.match(recordsRoute, /paymentsByRecord/);
  assert.doesNotMatch(recordsRoute, /await recordsPaymentsRepo\.treatmentsForRecord/);
  assert.doesNotMatch(recordsRoute, /await recordsPaymentsRepo\.paymentPartsForRecord/);
});

test('patients and records list endpoints support bounded pagination search parameters', () => {
  assert.match(serverSource, /function paginationFromQuery\(query/);
  assert.match(serverSource, /Math\.min\(requestedLimit, maxLimit\)/);
  assert.match(serverSource, /patientsRepo\.listPatients\(paginationFromQuery\(req\.query/);
  assert.match(serverSource, /recordsPaymentsRepo\.listRecords\(paginationFromQuery\(req\.query/);
  assert.match(patientsRepoSource, /listPatients\(\{ search = '', limit = null, offset = 0 \} = \{\}\)/);
  assert.match(recordsRepoSource, /function recordsListSql\(\{ search = '', limit = null, offset = 0 \} = \{\}\)/);
  assert.match(patientsRepoSource, /LIMIT \? OFFSET \?/);
  assert.match(recordsRepoSource, /LIMIT \? OFFSET \?/);
});

test('patient delete dependency check covers clinical and billing tables', () => {
  assert.match(patientsRepoSource, /appointments/);
  assert.match(patientsRepoSource, /patient_documents/);
  assert.match(patientsRepoSource, /clinical_chart_entries/);
  assert.match(patientsRepoSource, /clinical_notes/);
  assert.match(patientsRepoSource, /invoices/);
  assert.match(patientsRepoSource, /insurance_claims/);
  assert.match(patientsRepoSource, /patient_ledger_entries/);
  assert.match(serverSource, /Object\.values\(related\)\.some\(count => Number\(count\) > 0\)/);
  assert.match(serverSource, /related/);
});

test('dynamic row existence helpers are table-whitelisted', () => {
  assert.match(recordsRepoSource, /const ROW_EXISTS_TABLES = new Set\(\['patients'\]\)/);
  assert.match(calendarRepoSource, /const ROW_EXISTS_TABLES = new Set\(\['patients', 'doctors', 'chairs', 'codebook_items'\]\)/);
  assert.match(recordsRepoSource, /if \(!ROW_EXISTS_TABLES\.has\(table\)\) throw new Error/);
  assert.match(calendarRepoSource, /if \(!ROW_EXISTS_TABLES\.has\(table\)\) throw new Error/);
});

test('cron Google pull uses timing-safe secret comparison', () => {
  assert.match(serverSource, /function timingSafeSecretEqual\(actual, expected\)/);
  assert.match(serverSource, /crypto\.timingSafeEqual\(actualBuffer, expectedBuffer\)/);
  assert.match(serverSource, /if \(!timingSafeSecretEqual\(provided, secret\)\) return res\.status\(401\)/);
  assert.doesNotMatch(serverSource, /provided !== secret/);
});

test('patient duplicate and lookup searches have matching functional indexes', () => {
  assert.match(postgresSchemaSource, /idx_patients_name_normalized/);
  assert.match(postgresSchemaSource, /lower\(btrim\(first_name\)\), lower\(btrim\(last_name\)\)/);
  assert.match(postgresSchemaSource, /idx_patients_email_normalized/);
  assert.match(postgresSchemaSource, /idx_patients_phone_digits/);
  assert.match(postgresSchemaSource, /regexp_replace\(COALESCE\(phone, ''\), '\\D', '', 'g'\)/);
});
