const { readEnv } = require("./env");
const crypto = require("crypto");

const backendEnv = readEnv();
const sessionTokens = new Map();

function credentialsFor(role = "staff") {
  const isDirector = role === "director";
  return {
    email: isDirector ? "director@drosa.com" : "staff@drosa.com",
    password: isDirector ? backendEnv.INITIAL_DIRECTOR_PASSWORD : backendEnv.INITIAL_STAFF_PASSWORD,
    role
  };
}

function base64Url(value) {
  return Buffer.from(JSON.stringify(value))
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signTestToken(user) {
  const header = base64Url({ alg: "HS256", typ: "JWT" });
  const payload = base64Url({
    ...user,
    exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60
  });
  const signature = crypto
    .createHmac("sha256", backendEnv.JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${header}.${payload}.${signature}`;
}

function tokenFor(role = "staff") {
  const token = sessionTokens.get(role) || process.env[`PLAYWRIGHT_${role.toUpperCase()}_TOKEN`];
  if (!token) throw new Error(`Authenticate ${role} through the real login before requesting its access token.`);
  return token;
}

async function authenticate(page, role = "staff") {
  await page.evaluate(() => localStorage.clear()).catch(() => {});
  await page.goto("/src/pages/login.html");
  if (process.env.PLAYWRIGHT_USE_PASSWORD_LOGIN !== "1") {
    await authenticateWithSignedToken(page, role);
    return;
  }
  const credentials = credentialsFor(role);
  const response = await page.request.post("/api/auth/login", {
    data: credentials
  });
  if (!response.ok()) {
    throw new Error(`Login setup failed for ${role}: ${response.status()}`);
  }
  const session = await response.json();
  sessionTokens.set(role, session.token);
  await page.evaluate(({ session }) => {
    localStorage.setItem("drrosa-session", JSON.stringify({
      ...session.user,
      sessionId: session.sessionId,
      sessionExpiresAt: session.sessionExpiresAt,
      idleExpiresAt: session.idleExpiresAt,
      idleTimeoutMs: session.idleTimeoutMs,
      loginTime: new Date().toISOString(),
      refreshExpiresAt: session.refreshExpiresAt || null
    }));
  }, { session });
}

async function authenticateWithSignedToken(page, role = "staff") {
  // Retain the helper name for existing suites, but never bypass server sessions.
  const response = await page.request.post('/api/auth/login', { data: credentialsFor(role) });
  if (!response.ok()) throw new Error(`Login setup failed for ${role}: ${response.status()}`);
  const session = await response.json();
  sessionTokens.set(role, session.token);
  await page.evaluate(session => {
    localStorage.setItem('drrosa-session', JSON.stringify({ ...session.user, sessionId: session.sessionId,
      sessionExpiresAt: session.sessionExpiresAt, idleExpiresAt: session.idleExpiresAt, idleTimeoutMs: session.idleTimeoutMs,
      loginTime: new Date().toISOString(), refreshExpiresAt: session.refreshExpiresAt }));
  }, session);
}

module.exports = { authenticate, authenticateWithSignedToken, credentialsFor, tokenFor, signTestToken };
