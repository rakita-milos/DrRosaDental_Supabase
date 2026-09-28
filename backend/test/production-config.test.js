const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

function runServerImport(extraEnv = {}, removeEnv = []) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'drrosa-config-cwd-'));
  const serverPath = path.join(__dirname, '..', 'server.js');
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: '3999',
    DB_CLIENT: 'postgres',
    DATABASE_URL: 'postgres://user:pass@127.0.0.1:1/drrosa_test',
    PGSSL: 'true',
    PG_POOL_MAX: '1',
    PGSSL_REJECT_UNAUTHORIZED: 'true',
    PGSSL_CA: 'production-config-test-ca',
    DOCUMENT_STORAGE_DRIVER: 'supabase',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'production-config-test-service-role-key',
    DOCUMENT_STORAGE_BUCKET: 'patient-documents',
    UPLOAD_DIR: path.join(mkdtempSync(path.join(tmpdir(), 'drrosa-upload-')), 'uploads'),
    SCANNER_IMPORT_DIR: path.join(mkdtempSync(path.join(tmpdir(), 'drrosa-scan-')), 'scanner'),
    CORS_ORIGIN: 'https://drrosa.example.com',
    TRUST_PROXY: 'loopback',
    JWT_SECRET: 'production-config-test-jwt-secret-32-chars',
    STAFF_DEFAULT_PERMISSIONS: 'patients:read,records:read'
  };
  Object.assign(env, extraEnv);
  for (const key of removeEnv) delete env[key];
  return spawnSync(process.execPath, ['-e', `require(${JSON.stringify(serverPath)})`], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 20000
  });
}

function assertStartupRejected(result, message) {
  assert.equal(result.error?.code, undefined, `Server import timed out or failed to start the process: ${result.error?.message || ''}`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, message);
}

test('production startup rejects missing staff permission configuration', () => {
  const result = runServerImport({}, ['STAFF_DEFAULT_PERMISSIONS']);
  assertStartupRejected(result, /STAFF_DEFAULT_PERMISSIONS/);
});

test('production startup rejects localhost CORS origins', () => {
  const result = runServerImport({ CORS_ORIGIN: 'http://localhost:3000' });
  assertStartupRejected(result, /localhost origins/);
});

test('production startup rejects unknown staff permissions', () => {
  const result = runServerImport({ STAFF_DEFAULT_PERMISSIONS: 'patients:read,invalid:permission' });
  assertStartupRejected(result, /invalid:permission/);
});

test('production startup rejects missing trust proxy decision', () => {
  const result = runServerImport({}, ['TRUST_PROXY']);
  assertStartupRejected(result, /TRUST_PROXY/);
});

test('public origins must not run in development mode', () => {
  const result = runServerImport({ NODE_ENV: 'development', CORS_ORIGIN: 'https://drrosa.example.com' });
  assertStartupRejected(result, /NODE_ENV=production/);
});

test('production startup rejects non-durable local document storage', () => {
  const result = runServerImport({ DOCUMENT_STORAGE_DRIVER: 'local' });
  assertStartupRejected(result, /must use DOCUMENT_STORAGE_DRIVER=supabase/);
});

test('production startup rejects unverifiable TLS and oversized serverless pools', () => {
  let result = runServerImport({ PGSSL_REJECT_UNAUTHORIZED: 'false' });
  assertStartupRejected(result, /must verify the server certificate/);

  result = runServerImport({ PG_POOL_MAX: '2' });
  assertStartupRejected(result, /PG_POOL_MAX must be 1/);
});
