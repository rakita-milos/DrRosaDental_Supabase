const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

test('isolated Playwright runner raises public-booking limits without changing production defaults', () => {
  const runner = readFileSync(path.join(__dirname, '..', '..', 'tests', 'playwright', 'scripts', 'run-with-server.js'), 'utf8');
  const server = readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(runner, /PUBLIC_BOOKING_READ_RATE_LIMIT_MAX.*\|\| "1000"/);
  assert.match(runner, /PUBLIC_BOOKING_RATE_LIMIT_MAX.*\|\| "1000"/);
  assert.match(server, /PUBLIC_BOOKING_READ_RATE_LIMIT_MAX \|\| 120/);
  assert.match(server, /PUBLIC_BOOKING_RATE_LIMIT_MAX \|\| 20/);
});
