const LOCAL_POSTGRES_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const REQUIRED_DATABASE_NAME = 'drrosa_test';

function assertIsolatedMigrationDatabase({ databaseUrl, allowLocalMigrations }) {
  if (allowLocalMigrations !== true) {
    throw new Error('Refusing to apply migrations without the explicit --allow-local flag. Production migrations must use the reviewed Supabase deployment workflow.');
  }

  let url;
  try {
    url = new URL(String(databaseUrl || ''));
  } catch {
    throw new Error('DATABASE_URL must be a valid local PostgreSQL URL.');
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use the PostgreSQL protocol.');
  }
  if (!LOCAL_POSTGRES_HOSTS.has(url.hostname)) {
    throw new Error('Refusing to apply local migrations to a non-local PostgreSQL host.');
  }

  const databaseName = decodeURIComponent(url.pathname || '').replace(/^\//, '');
  if (databaseName !== REQUIRED_DATABASE_NAME) {
    throw new Error(`Refusing to apply local migrations unless the database is named ${REQUIRED_DATABASE_NAME}.`);
  }
}

module.exports = { assertIsolatedMigrationDatabase, REQUIRED_DATABASE_NAME };
