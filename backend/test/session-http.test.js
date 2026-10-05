const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

test('real HTTP login, refresh, activity, protected assets and logout', {skip: !process.env.SESSION_TEST_DATABASE_URL}, async t => {
  const url = new URL(process.env.SESSION_TEST_DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname === '/drrosa_test');
  Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: url.toString(), PGSSL: 'false',
    JWT_SECRET: 'session-http-test-secret-at-least-32-characters', DOCUMENT_STORAGE_DRIVER: 'local',
    SESSION_IDLE_MINUTES: '20', SESSION_ABSOLUTE_HOURS: '8' });
  const { createPool } = require('../db/postgres');
  const bcrypt = require('bcryptjs');
  const pool = createPool();
  const password = 'Session-local-test-123!';
  const hash = await bcrypt.hash(password, 4);
  const users = [];
  for (const role of ['staff','director']) users.push((await pool.query(`INSERT INTO users(email,password_hash,name,role)
    VALUES($1,$2,'HTTP fixture',$3) RETURNING id,email,role`, [`http-${crypto.randomUUID()}@example.com`, hash, role])).rows[0]);
  const backend = require('../server');
  await backend.ensureRuntimeReady();
  const server = await new Promise(resolve => { const instance = backend.app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  function browser() {
    const jar = new Map();
    return { jar, async call(path, body, extra = {}) {
      const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type':'application/json', Cookie: Array.from(jar, ([key,value]) => `${key}=${value}`).join('; '), ...extra },
        ...(body === undefined ? {} : {body:JSON.stringify(body)}), redirect:'manual' });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';')[0], at = pair.indexOf('=');
        if (pair.slice(at+1)) jar.set(pair.slice(0,at), pair.slice(at+1)); else jar.delete(pair.slice(0,at));
      }
      const data = await response.clone().json().catch(() => null);
      return {response, data};
    }};
  }
  const credentials = user => ({email:user.email,password,role:user.role});
  try {
    const one = browser(), two = browser();
    const loginOne = await one.call('/api/auth/login', credentials(users[0]));
    const loginTwo = await two.call('/api/auth/login', credentials(users[0]));
    assert.equal(loginOne.response.status,200); assert.equal(loginTwo.response.status,200);
    assert.notEqual(loginOne.data.sessionId, loginTwo.data.sessionId);
    assert.ok(loginOne.response.headers.getSetCookie().every(value => /HttpOnly/.test(value) && /SameSite=Strict/.test(value)));
    const access = loginOne.data.token;
    await t.test('parallel HTTP refreshes converge and preserve expiration', async () => {
      const originalCookie = Array.from(one.jar, ([k,v]) => `${k}=${v}`).join('; ');
      const responses = await Promise.all(Array.from({length:6}, () => fetch(base+'/api/auth/refresh', {
        method:'POST',headers:{Cookie:originalCookie,'Content-Type':'application/json'},body:'{}'
      })));
      const bodies = await Promise.all(responses.map(r => r.json()));
      assert.ok(responses.every(r => r.status===200));
      assert.equal(new Set(bodies.map(b=>b.refreshToken)).size,1);
      assert.ok(bodies.every(b=>b.sessionExpiresAt===loginOne.data.sessionExpiresAt));
      const saved=(await pool.query('SELECT generation FROM auth_sessions WHERE id=$1',[loginOne.data.sessionId])).rows[0];
      assert.equal(saved.generation,1);
      one.jar.set('drrosa_refresh',bodies[0].refreshToken);
    });
    await t.test('logout works without access cookie and rejects the old access token', async () => {
      one.jar.delete('drrosa_access');
      const loggedOut=await one.call('/api/auth/logout',{});
      assert.equal(loggedOut.response.status,200); assert.equal(one.jar.size,0);
      const stale=await one.call('/api/auth/verify',{}, {Authorization:`Bearer ${access}`});
      assert.equal(stale.response.status,401); assert.equal(stale.data.code,'SESSION_ENDED');
      assert.equal((await two.call('/api/auth/verify',{})).response.status,200);
      assert.ok((await pool.query('SELECT revoked_at FROM auth_sessions WHERE id=$1',[loginOne.data.sessionId])).rows[0].revoked_at);
    });
    await t.test('idle expiration cannot be revived by activity or refresh', async () => {
      await pool.query("UPDATE auth_sessions SET last_activity_at=clock_timestamp()-interval '21 minutes' WHERE id=$1",[loginTwo.data.sessionId]);
      for(const path of ['/api/auth/verify','/api/auth/activity','/api/auth/refresh']) {
        const result=await two.call(path,{}); assert.equal(result.response.status,401); assert.equal(result.data.code,'SESSION_ENDED');
      }
    });
    await t.test('director HTML renews expired access; staff still cannot open it', async () => {
      const director=browser(); assert.equal((await director.call('/api/auth/login',credentials(users[1]))).response.status,200);
      director.jar.delete('drrosa_access');
      const page=await director.call('/src/pages/director-panel.html');
      assert.equal(page.response.status,200); assert.ok(director.jar.has('drrosa_access'));
      const staff=browser(); await staff.call('/api/auth/login',credentials(users[0]));
      assert.equal((await staff.call('/src/pages/director-panel.html')).response.status,403);
    });
    await t.test('legacy access without session id is rejected', async () => {
      const jwt=require('jsonwebtoken');
      const legacy=jwt.sign({id:users[0].id,email:users[0].email},process.env.JWT_SECRET,{expiresIn:'15m'});
      assert.equal((await browser().call('/api/auth/verify',{}, {Authorization:`Bearer ${legacy}`})).response.status,401);
    });
  } finally {
    server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
    await pool.query('DELETE FROM users WHERE id=ANY($1::int[])',[users.map(u=>u.id)]);
    await pool.end(); await backend.closePostgresPool();
  }
});
