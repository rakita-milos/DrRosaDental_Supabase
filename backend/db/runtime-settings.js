const { execute, queryOne } = require('./postgres');
function createRuntimeSettingsRepository({ pgPool }) {
  if (!pgPool) throw new Error('pgPool is required for postgres runtime settings repository.');
  return createPostgresRuntimeSettingsRepository(pgPool);
}

function createPostgresRuntimeSettingsRepository(pool) {
  return {
    cleanupRateLimitHits(now) {
      return execute(pool, 'DELETE FROM rate_limit_hits WHERE reset_at <= ?', [now]);
    },

    rateLimitHit(key) {
      return queryOne(pool, 'SELECT count, reset_at FROM rate_limit_hits WHERE key = ?', [key]);
    },

    upsertRateLimitHit({ key, count, resetAt }) {
      return execute(pool, `
        INSERT INTO rate_limit_hits (key, count, reset_at, updated_at)
        VALUES (?, ?, ?, now())
        ON CONFLICT(key) DO UPDATE SET count = excluded.count, reset_at = excluded.reset_at, updated_at = now()
      `, [key, count, resetAt]);
    },

    updateRateLimitCount({ key, count }) {
      return execute(pool, 'UPDATE rate_limit_hits SET count = ?, updated_at = now() WHERE key = ?', [count, key]);
    },

    appSetting(key) {
      return queryOne(pool, 'SELECT value, updated_at FROM app_settings WHERE key = ?', [key]);
    },

    async setAppSetting({ key, value }) {
      await execute(pool, `
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (?, ?, now())
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = now()
      `, [key, value]);
      return this.appSetting(key);
    }
  };
}

module.exports = {
  createRuntimeSettingsRepository
};
