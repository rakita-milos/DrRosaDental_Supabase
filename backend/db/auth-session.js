const {
  execute,
  insertReturningId,
  queryMany,
  queryOne,
  withTransaction
} = require('./postgres');
function createAuthSessionRepository({ pgPool }) {
  if (!pgPool) throw new Error('pgPool is required for postgres auth repository.');
  return createPostgresAuthSessionRepository(pgPool);
}

const USER_AUTH_COLUMNS = `
  id, email, password_hash, name, role, permissions_json,
  failed_login_attempts, locked_until, password_changed_at,
  two_factor_secret, two_factor_enabled, created_at, updated_at
`;

const USER_SECURITY_COLUMNS = `
  id, email, name, role, permissions_json,
  failed_login_attempts, locked_until, password_changed_at,
  two_factor_enabled, created_at, updated_at
`;

const REFRESH_TOKEN_COLUMNS = `
  id, user_id, user_agent, ip_address, expires_at, revoked_at, created_at
`;

const SESSION_COLUMNS = `s.id, s.user_id, s.token_hash, s.previous_token_hash,
  s.previous_valid_until, s.generation, s.user_agent, s.ip_address,
  s.expires_at, s.last_activity_at, s.revoked_at, s.created_at,
  u.email, u.name, u.role, u.permissions_json, u.two_factor_enabled, u.locked_until, u.password_changed_at`;

function createPostgresAuthSessionRepository(pool) {
  return {
    createSession({ userId, tokenHash, userAgent, ipAddress, expiresAt }) {
      return queryOne(pool, `INSERT INTO auth_sessions
        (user_id, token_hash, user_agent, ip_address, expires_at)
        VALUES (?, ?, ?, ?, ?) RETURNING id, user_id, expires_at, last_activity_at, created_at`,
      [userId, tokenHash, userAgent, ipAddress, expiresAt]);
    },

    findSessionById(id, userId) {
      return queryOne(pool, `SELECT ${SESSION_COLUMNS} FROM auth_sessions s
        JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.user_id = ?`, [id, userId]);
    },

    touchSession(id, userId, idleTimeoutMs) {
      return queryOne(pool, `WITH touched AS (
        UPDATE auth_sessions SET last_activity_at = clock_timestamp()
        WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > clock_timestamp()
        AND last_activity_at > clock_timestamp() - (? * interval '1 millisecond') RETURNING *
      ) SELECT ${SESSION_COLUMNS} FROM touched s JOIN users u ON u.id = s.user_id`,
      [id, userId, idleTimeoutMs]);
    },

    rotateSession(tokenHash, prepare, graceMs) {
      return withTransaction(pool, async client => {
        const row = await queryOne(client, `SELECT ${SESSION_COLUMNS} FROM auth_sessions s
          JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ? OR s.previous_token_hash = ? FOR UPDATE OF s`, [tokenHash, tokenHash]);
        const previous = Boolean(row && row.previous_token_hash === tokenHash);
        const next = prepare(row, previous);
        if (!previous) {
          await execute(client, `UPDATE auth_sessions SET previous_token_hash = token_hash,
            previous_valid_until = clock_timestamp() + (? * interval '1 millisecond'),
            token_hash = ?, generation = generation + 1 WHERE id = ?`, [graceMs, next.tokenHash, row.id]);
        }
        return next.result;
      });
    },

    revokeSessionByTokenHash(tokenHash) {
      return queryOne(pool, `UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, clock_timestamp())
        WHERE token_hash = ? OR previous_token_hash = ? RETURNING id, user_id`, [tokenHash, tokenHash]);
    },

    revokeSessionById(id, userId) {
      return queryOne(pool, `UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, clock_timestamp())
        WHERE id = ? AND user_id = ? RETURNING id, user_id`, [id, userId]);
    },

    usersForPasswordRotation() {
      return queryMany(pool, 'SELECT id, email, password_hash, role FROM users');
    },

    updateUserPasswordHash(userId, passwordHash) {
      return execute(pool, 'UPDATE users SET password_hash = ?, updated_at = now() WHERE id = ?', [passwordHash, userId]);
    },



    findUserById(id) {
      return queryOne(pool, `SELECT ${USER_AUTH_COLUMNS} FROM users WHERE id = ?`, [id]);
    },

    findUserByEmail(email) {
      return queryOne(pool, `SELECT ${USER_AUTH_COLUMNS} FROM users WHERE email = ?`, [email]);
    },

    listSecurityUsers() {
      return queryMany(pool, `SELECT ${USER_SECURITY_COLUMNS} FROM users ORDER BY role, email`);
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



    revokeRefreshTokenById(id) {
      return execute(pool, 'UPDATE auth_sessions SET revoked_at = now() WHERE id = ?', [id]);
    },



    revokeRefreshTokensByUserId(userId) {
      return execute(pool, 'UPDATE auth_sessions SET revoked_at = now() WHERE user_id = ?', [userId]);
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
        SELECT rt.id, rt.user_id, rt.user_agent, rt.ip_address, rt.expires_at,
               rt.revoked_at, rt.created_at, u.email, u.name, u.role
        FROM auth_sessions rt
        LEFT JOIN users u ON u.id = rt.user_id
        WHERE rt.revoked_at IS NULL AND rt.expires_at > now()
          AND rt.last_activity_at > now() - (? * interval '1 millisecond')
        ORDER BY rt.created_at DESC
        LIMIT ?
      `, [Number(process.env.SESSION_IDLE_MINUTES || 20) * 60000, limit]);
    },

    findRefreshTokenById(id) {
      return queryOne(pool, `SELECT ${REFRESH_TOKEN_COLUMNS} FROM auth_sessions WHERE id = ?`, [id]);
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
