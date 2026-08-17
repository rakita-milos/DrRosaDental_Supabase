const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { publicBookingSchema } = require('../validation');

const serverSource = readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const systemRoutesSource = readFileSync(path.join(__dirname, '..', 'routes', 'system-routes.js'), 'utf8');
const vercelSource = readFileSync(path.join(__dirname, '..', '..', 'vercel.json'), 'utf8');

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

test('director panel static assets are served only through director auth gates', () => {
  assert.match(systemRoutesSource, /app\.get\('\/src\/pages\/director-panel\.html', \.\.\.requireDirectorAsset/);
  assert.match(systemRoutesSource, /app\.get\('\/src\/scripts\/director-reports\.js', \.\.\.requireDirectorAsset/);
  assert.match(systemRoutesSource, /app\.use\('\/src', express\.static/);
  assert.ok(
    systemRoutesSource.indexOf("app.get('/src/pages/director-panel.html'") <
      systemRoutesSource.indexOf("app.use('/src', express.static"),
    'director panel route must be registered before public /src static files'
  );
  assert.match(vercelSource, /"source": "\/src\/pages\/director-panel\.html"[\s\S]*"destination": "\/api"/);
  assert.match(vercelSource, /"source": "\/src\/scripts\/director-reports\.js"[\s\S]*"destination": "\/api"/);
});

test('all director-prefixed API routes require director role', () => {
  const directorRouteLines = serverSource
    .split(/\r?\n/)
    .filter(line => /app\.(get|post|put|patch|delete)\('\/api\/director\//.test(line));
  assert.ok(directorRouteLines.length > 0, 'expected director API routes');
  directorRouteLines.forEach(line => {
    assert.match(line, /requireDirector/, line.trim());
  });
});

test('auth cookies cover protected director static routes and logout clears old api-path cookies', () => {
  assert.match(serverSource, /function cookieOptions\(maxAge\)[\s\S]*path: '\/'/);
  assert.match(serverSource, /res\.clearCookie\('drrosa_access', \{ path: '\/' \}\)/);
  assert.match(serverSource, /res\.clearCookie\('drrosa_refresh', \{ path: '\/' \}\)/);
  assert.match(serverSource, /res\.clearCookie\('drrosa_access', \{ path: '\/api' \}\)/);
  assert.match(serverSource, /res\.clearCookie\('drrosa_refresh', \{ path: '\/api' \}\)/);
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
