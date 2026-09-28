const LOCAL_DATABASE_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', 'postgres']);
const REQUIRED_DATABASE_NAME = 'drrosa_test';

function requireTestDatabaseUrl(env = process.env) {
  const databaseUrl = String(env.PLAYWRIGHT_TEST_DATABASE_URL || '').trim();
  if (!databaseUrl) {
    throw new Error('Set PLAYWRIGHT_TEST_DATABASE_URL to an isolated local PostgreSQL database. DATABASE_URL is intentionally not used as a fallback.');
  }
  return databaseUrl;
}

function assertSafeTestDatabase({ databaseUrl, env = process.env }) {
  if (env.NODE_ENV && env.NODE_ENV !== 'test') {
    throw new Error('Playwright database mutations require NODE_ENV=test.');
  }
  if (env.PLAYWRIGHT_ALLOW_DATABASE_MUTATION !== '1') {
    throw new Error('Set PLAYWRIGHT_ALLOW_DATABASE_MUTATION=1 only for the disposable local test database.');
  }

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('PLAYWRIGHT_TEST_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('PLAYWRIGHT_TEST_DATABASE_URL must use the PostgreSQL protocol.');
  }
  if (!LOCAL_DATABASE_HOSTS.has(parsed.hostname)) {
    throw new Error('Playwright may only mutate a local disposable PostgreSQL database; remote Supabase URLs are blocked.');
  }
  if (parsed.pathname.replace(/^\//, '') !== REQUIRED_DATABASE_NAME) {
    throw new Error(`Playwright test database must be named ${REQUIRED_DATABASE_NAME}.`);
  }
  return parsed;
}

module.exports = { requireTestDatabaseUrl, assertSafeTestDatabase };
