const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const serverSource = readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const routeUtilsSource = readFileSync(path.join(__dirname, '..', 'route-utils.js'), 'utf8');
const appointmentServiceSource = readFileSync(path.join(__dirname, '..', 'services', 'appointment-service.js'), 'utf8');
const systemRoutesSource = readFileSync(path.join(__dirname, '..', 'routes', 'system-routes.js'), 'utf8');
const clinicalRepoSource = readFileSync(path.join(__dirname, '..', 'db', 'clinical.js'), 'utf8');

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
