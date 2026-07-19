const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { publicBookingSchema } = require('../validation');

const serverSource = readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('Google Calendar settings response does not expose the OAuth client secret', () => {
  assert.doesNotMatch(serverSource, /clientSecret:\s*settings\.client_secret/);
  assert.match(serverSource, /clientSecretConfigured:\s*Boolean\(settings\.client_secret\)/);
});

test('critical director routes require password confirmation', () => {
  [
    "app.put('/api/director/security/users/:id/permissions', authenticateToken, requireDirector, requireDirectorPassword",
    "app.post('/api/director/security/users/:id/reset-password', authenticateToken, requireDirector, requireDirectorPassword",
    "app.put('/api/director/google-calendar/settings', authenticateToken, requireDirector, requireDirectorPassword",
    "app.get('/api/director/legal-export', authenticateToken, requireDirector, requireDirectorPassword"
  ].forEach(routeSignature => {
    assert.ok(serverSource.includes(routeSignature), routeSignature);
  });
});

test('public booking schema accepts captcha tokens', () => {
  const { error, value } = publicBookingSchema.validate({
    firstName: 'Ana',
    lastName: 'Petrovic',
    phone: '+381 60 123 456',
    doctorId: 1,
    procedureId: 1,
    startsAt: '2026-07-20T09:00:00.000Z',
    turnstileToken: 'captcha-token'
  }, { stripUnknown: true });

  assert.ifError(error);
  assert.equal(value.turnstileToken, 'captcha-token');
});
