const assert = require('node:assert');
const { test } = require('node:test');
const { requireTestDatabaseUrl, assertSafeTestDatabase } = require('../../tests/playwright/utils/test-database-safety');

const safeEnv = {
  NODE_ENV: 'test',
  PLAYWRIGHT_ALLOW_DATABASE_MUTATION: '1',
  PLAYWRIGHT_TEST_DATABASE_URL: 'postgresql://drrosa_test:password@127.0.0.1:5432/drrosa_test'
};

test('Playwright requires an explicit disposable test database URL', () => {
  assert.throws(() => requireTestDatabaseUrl({ DATABASE_URL: safeEnv.PLAYWRIGHT_TEST_DATABASE_URL }), /intentionally not used/);
  assert.equal(requireTestDatabaseUrl(safeEnv), safeEnv.PLAYWRIGHT_TEST_DATABASE_URL);
});

test('Playwright blocks remote and non-test database mutation targets', () => {
  assert.doesNotThrow(() => assertSafeTestDatabase({ databaseUrl: safeEnv.PLAYWRIGHT_TEST_DATABASE_URL, env: safeEnv }));
  assert.throws(() => assertSafeTestDatabase({ databaseUrl: 'postgresql://postgres:password@db.example.supabase.co:5432/postgres', env: safeEnv }), /remote Supabase URLs are blocked/);
  assert.throws(() => assertSafeTestDatabase({ databaseUrl: 'postgresql://drrosa_test:password@127.0.0.1:5432/production', env: safeEnv }), /must be named drrosa_test/);
  assert.throws(() => assertSafeTestDatabase({ databaseUrl: safeEnv.PLAYWRIGHT_TEST_DATABASE_URL, env: { ...safeEnv, PLAYWRIGHT_ALLOW_DATABASE_MUTATION: '0' } }), /ALLOW_DATABASE_MUTATION/);
});
