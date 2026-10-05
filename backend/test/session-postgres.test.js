const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createPool } = require('../db/postgres');
const { createAuthSessionRepository } = require('../db/auth-session');
const { createSessionService, hashToken } = require('../services/session-service');

test('PostgreSQL session concurrency, rollback, revocation and per-device deadlines', {
  skip: !process.env.SESSION_TEST_DATABASE_URL
}, async t => {
  const url = new URL(process.env.SESSION_TEST_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/drrosa_test', 'isolated local DB only');
  const pool = createPool(url.toString());
  const repository = createAuthSessionRepository({ pgPool: pool });
  const service = createSessionService({ repository, refreshKey: 'postgres-test-key', signAccessToken: row => `access-${row.id}` });
  const user = (await pool.query(`INSERT INTO users(email,password_hash,name,role)
    VALUES($1,'test-only','Session fixture','staff') RETURNING id,email,name,role`, [`session-${crypto.randomUUID()}@example.test`])).rows[0];
  try {
    const first = await service.create(user, {});
    const second = await service.create(user, {});
    assert.notEqual(first.sessionId, second.sessionId);
    await t.test('verification and activity each use one database round trip and retain permissions', async () => {
      let queries = 0;
      const measured = createAuthSessionRepository({pgPool:{query(...args) { queries++; return pool.query(...args); }}});
      await pool.query('UPDATE users SET permissions_json=$1 WHERE id=$2', [JSON.stringify(['patients:read']),user.id]);
      const verified = await measured.findSessionById(first.sessionId,user.id);
      assert.equal(queries,1);
      assert.deepEqual(JSON.parse(verified.permissions_json),['patients:read']);
      queries = 0;
      const touched = await measured.touchSession(second.sessionId,user.id,20*60000);
      assert.equal(queries,1);
      assert.equal(String(touched.id),second.sessionId);
      assert.ok(new Date(touched.last_activity_at).getTime() >= new Date(verified.last_activity_at).getTime());
    });
    await t.test('parallel refreshes across service instances return the same successor', async () => {
      const otherInstance = createSessionService({ repository, refreshKey: 'postgres-test-key', signAccessToken: row => `access-${row.id}` });
      const results = await Promise.all(Array.from({length: 8}, (_, index) =>
        (index % 2 ? service : otherInstance).renew(first.refreshToken)));
      assert.equal(new Set(results.map(result => result.refreshToken)).size, 1);
      assert.ok(results.every(result => result.sessionId === first.sessionId));
      const persisted = (await pool.query('SELECT generation,token_hash,last_activity_at FROM auth_sessions WHERE id=$1', [first.sessionId])).rows[0];
      assert.equal(persisted.generation, 1);
      assert.equal(persisted.token_hash, hashToken(results[0].refreshToken));
      assert.equal(new Date(persisted.last_activity_at).toISOString(), new Date(Date.parse(first.idleExpiresAt) - first.idleTimeoutMs).toISOString());
      first.refreshToken = results[0].refreshToken;
    });
    await t.test('SQL failure rolls back rotation and keeps the old token usable', async () => {
      await pool.query(`CREATE FUNCTION app.session_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated rotation failure'; END $$`);
      await pool.query(`CREATE TRIGGER session_test_fail AFTER UPDATE ON auth_sessions FOR EACH ROW WHEN (NEW.user_id = ${user.id}) EXECUTE FUNCTION app.session_test_fail()`);
      try {
        await assert.rejects(service.renew(first.refreshToken), /simulated rotation failure/);
        const persisted = (await pool.query('SELECT token_hash,generation FROM auth_sessions WHERE id=$1', [first.sessionId])).rows[0];
        assert.equal(persisted.token_hash, hashToken(first.refreshToken));
        assert.equal(persisted.generation, 1);
      } finally {
        await pool.query('DROP TRIGGER session_test_fail ON auth_sessions');
        await pool.query('DROP FUNCTION app.session_test_fail()');
      }
      first.refreshToken = (await service.renew(first.refreshToken)).refreshToken;
    });
    await t.test('activity on device two does not extend device one', async () => {
      await pool.query("UPDATE auth_sessions SET last_activity_at=clock_timestamp()-interval '21 minutes' WHERE id=$1", [first.sessionId]);
      await service.activity(second.sessionId, user.id);
      await assert.rejects(service.verify(first.sessionId, user.id), {code:'SESSION_ENDED'});
      await assert.rejects(service.renew(first.refreshToken), {code:'SESSION_ENDED'});
      await service.verify(second.sessionId, user.id);
    });
    await t.test('logout invalidates access on one device and leaves the other session valid', async () => {
      await service.revoke(second.refreshToken);
      await assert.rejects(service.verify(second.sessionId, user.id), {code:'SESSION_ENDED'});
      const third = await service.create(user, {});
      await service.verify(third.sessionId, user.id);
      await pool.query("UPDATE auth_sessions SET created_at=clock_timestamp()-interval '9 hours',expires_at=clock_timestamp()-interval '1 second',last_activity_at=clock_timestamp() WHERE id=$1", [third.sessionId]);
      await assert.rejects(service.verify(third.sessionId, user.id), {code:'SESSION_ENDED'});
    });
  } finally { await pool.query('DELETE FROM users WHERE id=$1', [user.id]); await pool.end(); }
});
