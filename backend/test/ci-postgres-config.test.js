const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const workflow = readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8');

test('CI provisions isolated PostgreSQL instead of stale SQLite configuration', () => {
  assert.match(workflow, /services:\s+postgres:/);
  assert.match(workflow, /image: postgres:17-alpine/);
  assert.match(workflow, /DATABASE_URL: postgresql:\/\/drrosa_test:/);
  assert.match(workflow, /DOCUMENT_STORAGE_DRIVER: local/);
  assert.doesNotMatch(workflow, /SQLITE_DB_PATH|SQLITE_BACKUP_DIR/);
});

test('CI verifies the real browser password login path', () => {
  assert.match(workflow, /PLAYWRIGHT_USE_PASSWORD_LOGIN: "1"/);
  assert.match(workflow, /PLAYWRIGHT_VERIFY_PASSWORD_LOGIN: "1"/);
});

test('CI enables HTTP and PostgreSQL integration only after test migrations and seed', () => {
  const migrationStep = workflow.indexOf('npm run db:migrate:local');
  const seedStep = workflow.indexOf('npm run seed:runtime');
  const integrationStep = workflow.indexOf('SESSION_TEST_DATABASE_URL:');
  const backendTestStep = workflow.indexOf('npm test');
  assert.ok(migrationStep >= 0 && seedStep > migrationStep);
  assert.ok(integrationStep > seedStep && backendTestStep > integrationStep);
  assert.match(workflow, /SESSION_TEST_DATABASE_URL: \$\{\{ env\.DATABASE_URL \}\}/);
});
