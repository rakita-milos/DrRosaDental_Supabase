const crypto = require('node:crypto');

function sessionError(message, code = 'SESSION_ENDED', status = 401) {
  return Object.assign(new Error(message), { code, status });
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createSessionService({ repository, signAccessToken, refreshKey,
  idleTimeoutMs = 20 * 60 * 1000, absoluteTimeoutMs = 8 * 60 * 60 * 1000,
  refreshGraceMs = 30000, now = Date.now }) {
  function assertActive(row) {
    const time = now();
    if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= time ||
        new Date(row.last_activity_at).getTime() + idleTimeoutMs <= time) {
      throw sessionError('Sesija je istekla. Prijavite se ponovo.');
    }
    if (row.locked_until && new Date(row.locked_until).getTime() > time) {
      throw sessionError('Nalog je privremeno zaključan.', 'ACCOUNT_LOCKED', 423);
    }
    if (row.password_changed_at && new Date(row.password_changed_at).getTime() >= new Date(row.created_at).getTime()) {
      throw sessionError('Prijavite se ponovo nakon promene lozinke.');
    }
    return row;
  }

  function payload(row) {
    return {
      sessionId: String(row.id),
      sessionExpiresAt: new Date(row.expires_at).toISOString(),
      idleExpiresAt: new Date(new Date(row.last_activity_at).getTime() + idleTimeoutMs).toISOString(),
      serverTime: new Date(now()).toISOString(),
      idleTimeoutMs,
      user: { id: row.user_id, email: row.email, name: row.name, role: row.role,
        twoFactorEnabled: Boolean(row.two_factor_enabled) }
    };
  }

  function issue(row, refreshToken) {
    return { ...payload(row), accessToken: signAccessToken(row), refreshToken };
  }

  return {
    assertActive,
    payload,
    async create(user, metadata) {
      const token = crypto.randomBytes(48).toString('base64url');
      const row = await repository.createSession({ userId: user.id, tokenHash: hashToken(token),
        ...metadata, expiresAt: new Date(now() + absoluteTimeoutMs).toISOString() });
      Object.assign(row, { email: user.email, name: user.name, role: user.role,
        two_factor_enabled: user.two_factor_enabled });
      return issue(row, token);
    },
    async verify(sessionId, userId) {
      return assertActive(await repository.findSessionById(sessionId, userId));
    },
    async activity(sessionId, userId) {
      const row = await repository.touchSession(sessionId, userId, idleTimeoutMs);
      return payload(assertActive(row));
    },
    async renew(token) {
      if (!token) throw sessionError('Sesija nije dostupna. Prijavite se ponovo.');
      return repository.rotateSession(hashToken(token), (row, previous) => {
        assertActive(row);
        if (previous && new Date(row.previous_valid_until).getTime() < now()) {
          throw sessionError('Token za obnovu više nije važeći.', 'REFRESH_REJECTED');
        }
        const generation = Number(row.generation) + (previous ? 0 : 1);
        // Deterministic successor lets simultaneous requests receive the SAME token;
        // the database stores hashes only. The short overlap never extends the session.
        const next = crypto.createHmac('sha256', refreshKey)
          .update(`session:${row.id}:generation:${generation}:token:${token}`).digest('base64url');
        if (previous && hashToken(next) !== row.token_hash) {
          throw sessionError('Obnova je već napredovala. Pokušajte ponovo.', 'REFRESH_CONFLICT', 409);
        }
        return { tokenHash: hashToken(next), result: issue(row, next) };
      }, refreshGraceMs);
    },
    async revoke(token) {
      return token ? repository.revokeSessionByTokenHash(hashToken(token)) : null;
    }
  };
}

module.exports = { createSessionService, sessionError, hashToken };
