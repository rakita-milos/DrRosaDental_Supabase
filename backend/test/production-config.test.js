const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

function runServerImport(extraEnv = {}, removeEnv = []) {
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: '3999',
    SQLITE_DB_PATH: path.join(mkdtempSync(path.join(tmpdir(), 'drrosa-config-')), 'config.sqlite'),
    BACKUP_DIR: path.join(mkdtempSync(path.join(tmpdir(), 'drrosa-backup-')), 'backups'),
    UPLOAD_DIR: path.join(mkdtempSync(path.join(tmpdir(), 'drrosa-upload-')), 'uploads'),
    SCANNER_IMPORT_DIR: path.join(mkdtempSync(path.join(tmpdir(), 'drrosa-scan-')), 'scanner'),
    CORS_ORIGIN: 'https://drrosa.example.com',
    JWT_SECRET: 'production-config-test-jwt-secret-32-chars',
    BACKUP_ENCRYPTION_KEY: 'production-config-test-backup-secret-32-chars',
    STAFF_DEFAULT_PERMISSIONS: 'patients:read,records:read'
  };
  Object.assign(env, extraEnv);
  for (const key of removeEnv) delete env[key];
  return spawnSync(process.execPath, ['-e', "require('./server.js')"], {
    cwd: path.join(__dirname, '..'),
    env,
    encoding: 'utf8',
    timeout: 5000
  });
}

test('production startup rejects missing staff permission configuration', () => {
  const result = runServerImport({}, ['STAFF_DEFAULT_PERMISSIONS']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /STAFF_DEFAULT_PERMISSIONS/);
});

test('production startup rejects localhost CORS origins', () => {
  const result = runServerImport({ CORS_ORIGIN: 'http://localhost:3000' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /localhost origins/);
});

test('production startup rejects unknown staff permissions', () => {
  const result = runServerImport({ STAFF_DEFAULT_PERMISSIONS: 'patients:read,invalid:permission' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid:permission/);
});
