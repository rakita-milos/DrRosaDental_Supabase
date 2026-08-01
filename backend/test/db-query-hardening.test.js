const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const authSessionSource = readFileSync(path.join(__dirname, '..', 'db', 'auth-session.js'), 'utf8');

test('auth session repository avoids broad selects for security-facing data', () => {
  assert.match(authSessionSource, /const USER_AUTH_COLUMNS/);
  assert.match(authSessionSource, /const USER_SECURITY_COLUMNS/);
  assert.match(authSessionSource, /const REFRESH_TOKEN_COLUMNS/);
  assert.match(authSessionSource, /SELECT \$\{USER_SECURITY_COLUMNS\} FROM users ORDER BY role, email/);
  assert.doesNotMatch(authSessionSource, /SELECT \* FROM users/);
  assert.doesNotMatch(authSessionSource, /SELECT rt\.\*, u\.email/);
  assert.doesNotMatch(authSessionSource, /SELECT \* FROM refresh_tokens/);
});
