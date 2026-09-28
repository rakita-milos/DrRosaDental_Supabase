const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const serverSource = readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const migrationSource = readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260911125448_align_runtime_schema_and_document_storage.sql'), 'utf8');
const ciSource = readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8');
const { assertIsolatedMigrationDatabase } = require('../scripts/local-migration-safety');

test('runtime readiness performs a health query instead of DDL or seed mutations', () => {
  const readiness = serverSource.match(/async function ensureRuntimeReady\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(readiness, /pgPool\.query\('SELECT 1'\)/);
  assert.doesNotMatch(readiness, /initializePostgresSchema|seedDatabase/);
});

test('migration aligns runtime-only schema objects and guards Supabase Storage for plain PostgreSQL CI', () => {
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS google_calendar_sync_jobs/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS app_notifications/);
  assert.match(migrationSource, /patient_documents_visit_patient_fkey/);
  assert.match(migrationSource, /VALIDATE CONSTRAINT patient_documents_visit_patient_fkey/);
  assert.match(migrationSource, /Duplicate google_event_id rows exist/);
  assert.match(migrationSource, /pg_namespace WHERE nspname = 'storage'/);
  assert.match(ciSource, /npm run db:migrate:local/);
  assert.match(ciSource, /npm run seed:runtime/);
});

test('local migration runner requires an explicit local drrosa_test database', () => {
  const localUrl = 'postgresql://drrosa_test:password@127.0.0.1:5432/drrosa_test';
  assert.doesNotThrow(() => assertIsolatedMigrationDatabase({ databaseUrl: localUrl, allowLocalMigrations: true }));
  assert.throws(() => assertIsolatedMigrationDatabase({ databaseUrl: localUrl, allowLocalMigrations: false }), /--allow-local/);
  assert.throws(() => assertIsolatedMigrationDatabase({ databaseUrl: 'postgresql://user:password@db.example.com:5432/drrosa_test', allowLocalMigrations: true }), /non-local/);
  assert.throws(() => assertIsolatedMigrationDatabase({ databaseUrl: 'postgresql://drrosa_test:password@127.0.0.1:5432/production', allowLocalMigrations: true }), /named drrosa_test/);
});
