const assert = require('node:assert');
const { test } = require('node:test');
const { createPool } = require('../db/postgres');

test('PostgreSQL pool defaults to one connection and supports verified CA TLS', () => {
  const previous = {
    PGSSL: process.env.PGSSL,
    PG_POOL_MAX: process.env.PG_POOL_MAX,
    PGSSL_CA: process.env.PGSSL_CA,
    PGSSL_REJECT_UNAUTHORIZED: process.env.PGSSL_REJECT_UNAUTHORIZED
  };
  try {
    process.env.PGSSL = 'true';
    process.env.PG_POOL_MAX = '';
    process.env.PGSSL_CA = 'test-ca\\nline-two';
    process.env.PGSSL_REJECT_UNAUTHORIZED = 'true';
    const pool = createPool('postgresql://user:password@127.0.0.1:5432/drrosa_test');
    assert.equal(pool.options.max, 1);
    assert.equal(pool.options.ssl.rejectUnauthorized, true);
    assert.equal(pool.options.ssl.ca, 'test-ca\nline-two');
    pool.end();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
