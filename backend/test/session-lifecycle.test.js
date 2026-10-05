const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSessionService } = require('../services/session-service');

function fixture() {
  let time = Date.now();
  let row = { id: '1', user_id: 2, email: 'test@example.test', role: 'staff', name: 'Test',
    created_at: new Date(time).toISOString(), last_activity_at: new Date(time).toISOString(),
    expires_at: new Date(time + 8 * 3600000).toISOString(), token_hash: 'unused', generation: 0 };
  const repository = {
    findSessionById: async () => row,
    touchSession: async () => row,
    rotateSession: async (_hash, prepare) => prepare(row, false).result
  };
  const service = createSessionService({ repository, refreshKey: 'test-only-key',
    signAccessToken: () => 'test-access', now: () => time });
  return { service, row, advance: ms => { time += ms; } };
}

test('idle expiration is enforced even with an unexpired access token', async () => {
  const f = fixture();
  await f.service.verify('1', 2);
  f.advance(20 * 60000);
  await assert.rejects(f.service.verify('1', 2), { code: 'SESSION_ENDED' });
  await assert.rejects(f.service.renew('old-token'), { code: 'SESSION_ENDED' });
});

test('user activity cannot extend the absolute deadline', async () => {
  const f = fixture();
  f.advance(8 * 3600000);
  f.row.last_activity_at = new Date(Date.now() + 8 * 3600000).toISOString();
  await assert.rejects(f.service.verify('1', 2), { code: 'SESSION_ENDED' });
});

test('revoked, locked and password-reset sessions are rejected', async () => {
  for (const update of [
    { revoked_at: new Date().toISOString() },
    { locked_until: new Date(Date.now() + 60000).toISOString() },
    { password_changed_at: new Date(Date.now() + 1000).toISOString() }
  ]) {
    const f = fixture(); Object.assign(f.row, update);
    await assert.rejects(f.service.verify('1', 2));
  }
});

test('refresh does not move last activity or absolute expiration', async () => {
  const f = fixture(); const before = f.service.payload(f.row);
  f.advance(60000);
  const renewed = await f.service.renew('old-token');
  assert.equal(renewed.idleExpiresAt, before.idleExpiresAt);
  assert.equal(renewed.sessionExpiresAt, before.sessionExpiresAt);
  assert.equal(renewed.sessionId, before.sessionId);
});
