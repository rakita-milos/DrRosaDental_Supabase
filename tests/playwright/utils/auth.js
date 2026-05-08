const { readEnv } = require("./env");
const crypto = require("crypto");

const backendEnv = readEnv();

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
  const isDirector = role === "director";
  return signTestToken({
    id: isDirector ? 1 : 2,
    email: isDirector ? "director@drosa.com" : "staff@drosa.com",
    name: isDirector ? "Dr Rosa Basic" : "Ana - Medicinska sestra",
    role
  });
}

async function authenticate(page, role = "staff") {
  const isDirector = role === "director";
  const user = {
    id: isDirector ? 1 : 2,
    email: isDirector ? "director@drosa.com" : "staff@drosa.com",
    name: isDirector ? "Dr Rosa Basic" : "Ana - Medicinska sestra",
    role
  };
  const token = tokenFor(role);
  await page.evaluate(() => localStorage.clear()).catch(() => {});
  await page.goto("/src/pages/login.html");
  await page.evaluate(({ token, user }) => {
    localStorage.setItem("drrosa-token", token);
    localStorage.setItem("drrosa-session", JSON.stringify({
      ...user,
      loginTime: new Date().toISOString()
    }));
  }, { token, user });
}

module.exports = { authenticate, credentialsFor, tokenFor };
