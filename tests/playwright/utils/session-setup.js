const { readEnv } = require('./env');
const { assertSafeTestDatabase, requireTestDatabaseUrl } = require('./test-database-safety');

module.exports = async function setupSessions(config) {
  assertSafeTestDatabase({ databaseUrl: requireTestDatabaseUrl(process.env), env: process.env });
  const env = readEnv();
  const baseURL = config.projects[0].use.baseURL;
  for (const role of ['staff', 'director']) {
    const response = await fetch(new URL('/api/auth/login', baseURL), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `${role}@drosa.com`, role,
        password: role === 'director' ? env.INITIAL_DIRECTOR_PASSWORD : env.INITIAL_STAFF_PASSWORD })
    });
    if (!response.ok) throw new Error(`Session fixture login failed for ${role}: ${response.status}`);
    const data = await response.json();
    if (!data.token || !data.sessionId) throw new Error('Session fixtures require the isolated non-production runtime.');
    process.env[`PLAYWRIGHT_${role.toUpperCase()}_TOKEN`] = data.token;
  }
};
