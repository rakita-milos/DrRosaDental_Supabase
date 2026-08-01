const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const serverSource = readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const routeUtilsSource = readFileSync(path.join(__dirname, '..', 'route-utils.js'), 'utf8');

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
  assert.match(serverSource, /async function appointmentPayloadFromInput\(data/);
  assert.match(serverSource, /function boundedAppointmentDuration\(value\)/);
  assert.match(serverSource, /const payload = await appointmentPayloadFromInput\(req\.body\)/);
  assert.match(serverSource, /const payload = await appointmentPayloadFromInput\(\{ \.\.\.current, \.\.\.req\.body \}\)/);
  assert.match(serverSource, /if \(validateChair && !\(await calendarRepo\.rowExists\('chairs', chairId\)\)\)/);
});
