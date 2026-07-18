const {
  execute,
  insertReturningId,
  queryMany,
  queryOne
} = require('./postgres');
function createAuthSessionRepository({ pgPool }) {
  if (!pgPool) throw new Error('pgPool is required for postgres auth repository.');
  return createPostgresAuthSessionRepository(pgPool);
}

function createPostgresAuthSessionRepository(pool) {
  return {
    usersForPasswordRotation() {
      return queryMany(pool, 'SELECT id, email, password_hash, role FROM users');
    },

    updateUserPasswordHash(userId, passwordHash) {
      return execute(pool, 'UPDATE users SET password_hash = ?, updated_at = now() WHERE id = ?', [passwordHash, userId]);
    },

    findUserByIdEmail(id, email) {
      return queryOne(pool, 'SELECT * FROM users WHERE id = ? AND email = ?', [id, email]);
    },

    findUserById(id) {
      return queryOne(pool, 'SELECT * FROM users WHERE id = ?', [id]);
    },

    findUserByEmail(email) {
      return queryOne(pool, 'SELECT * FROM users WHERE email = ?', [email]);
    },

    listSecurityUsers() {
      return queryMany(pool, 'SELECT * FROM users ORDER BY role, email');
    },

    listAuditEntries({ action = null, userId = null, limit = 100 }) {
      const filters = [];
      const params = [];
      if (action) {
        filters.push(`a.action = ?`);
        params.push(action);
      }
      if (userId) {
        filters.push(`a.user_id = ?`);
        params.push(userId);
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      return queryMany(pool, `
        SELECT a.*, u.email
        FROM audit_log a
        LEFT JOIN users u ON u.id = a.user_id
        ${where}
        ORDER BY a.created_at DESC
        LIMIT ?
      `, [...params, limit]);
    },

    insertAuditLog({ userId = null, action, entityType = null, entityId = null, ipAddress = null, metadata = null }) {
      return insertReturningId(pool, `
        INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [userId, action, entityType, entityId, ipAddress, metadata]);
    },

    createRefreshToken({ userId, tokenHash, userAgent, ipAddress, expiresAt }) {
      return insertReturningId(pool, `
        INSERT INTO refresh_tokens (user_id, token_hash, user_agent, ip_address, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `, [userId, tokenHash, userAgent, ipAddress, expiresAt]);
    },

    updateFailedLogin({ userId, attempts, lockedUntil }) {
      return execute(pool, `
        UPDATE users
        SET failed_login_attempts = ?, locked_until = COALESCE(?, locked_until), updated_at = now()
        WHERE id = ?
      `, [attempts, lockedUntil, userId]);
    },

    clearFailedLogins(userId) {
      return execute(pool, 'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = ?', [userId]);
    },

    findRefreshSessionByTokenHash(tokenHash) {
      return queryOne(pool, `
        SELECT rt.*, u.email, u.name, u.role, u.two_factor_enabled
        FROM refresh_tokens rt
        JOIN users u ON u.id = rt.user_id
        WHERE rt.token_hash = ?
      `, [tokenHash]);
    },

    revokeRefreshTokenById(id) {
      return execute(pool, 'UPDATE refresh_tokens SET revoked_at = now() WHERE id = ?', [id]);
    },

    revokeRefreshTokenByHash(tokenHash) {
      return execute(pool, 'UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = ?', [tokenHash]);
    },

    revokeRefreshTokensByUserId(userId) {
      return execute(pool, 'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = ?', [userId]);
    },

    updatePasswordAndMarkChanged({ userId, passwordHash }) {
      return execute(pool, `
        UPDATE users
        SET password_hash = ?, password_changed_at = now(), updated_at = now()
        WHERE id = ?
      `, [passwordHash, userId]);
    },

    listActiveSessions(limit) {
      return queryMany(pool, `
        SELECT rt.*, u.email, u.name, u.role
        FROM refresh_tokens rt
        LEFT JOIN users u ON u.id = rt.user_id
        WHERE rt.revoked_at IS NULL AND rt.expires_at > now()
        ORDER BY rt.created_at DESC
        LIMIT ?
      `, [limit]);
    },

    findRefreshTokenById(id) {
      return queryOne(pool, 'SELECT * FROM refresh_tokens WHERE id = ?', [id]);
    },

    updateUserPermissions({ userId, permissionsJson }) {
      return execute(pool, 'UPDATE users SET permissions_json = ?, updated_at = now() WHERE id = ?', [permissionsJson, userId]);
    },

    resetUserPassword({ userId, passwordHash }) {
      return execute(pool, `
        UPDATE users
        SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL, password_changed_at = now(), updated_at = now()
        WHERE id = ?
      `, [passwordHash, userId]);
    },

    setTwoFactorSecret({ userId, secret }) {
      return execute(pool, 'UPDATE users SET two_factor_secret = ?, updated_at = now() WHERE id = ?', [secret, userId]);
    },

    enableTwoFactor(userId) {
      return execute(pool, 'UPDATE users SET two_factor_enabled = true, updated_at = now() WHERE id = ?', [userId]);
    },

    disableTwoFactor(userId) {
      return execute(pool, 'UPDATE users SET two_factor_enabled = false, two_factor_secret = NULL, updated_at = now() WHERE id = ?', [userId]);
    }
  };
}

module.exports = {
  createAuthSessionRepository
};
