const { test, expect } = require("@playwright/test");
const { authHeaders } = require("../utils/api");
const { authenticate, credentialsFor } = require("../utils/auth");

test("api: director manages encrypted backups and security status", async ({ request, baseURL }) => {
  const statusResponse = await request.get(`${baseURL}/api/director/backups/status`, {
    headers: authHeaders("director")
  });
  expect(statusResponse.ok()).toBeTruthy();
  const initialStatus = await statusResponse.json();
  expect(initialStatus).toHaveProperty("warning");

  const createResponse = await request.post(`${baseURL}/api/director/backups`, {
    headers: authHeaders("director")
  });
  expect(createResponse.status()).toBe(201);
  const backup = await createResponse.json();
  expect(backup).toMatchObject({ backupType: "manual", encrypted: true, status: "ready" });
  expect(backup.filename).toContain(".sqlite.enc");

  const listResponse = await request.get(`${baseURL}/api/director/backups`, {
    headers: authHeaders("director")
  });
  expect(listResponse.ok()).toBeTruthy();
  const backups = await listResponse.json();
  expect(backups.map(item => item.id)).toContain(backup.id);

  const badRestore = await request.post(`${baseURL}/api/director/backups/${backup.id}/restore`, {
    headers: authHeaders("director"),
    data: { confirmation: "NE" }
  });
  expect(badRestore.status()).toBe(400);

  const securityResponse = await request.get(`${baseURL}/api/director/security/status`, {
    headers: authHeaders("director")
  });
  expect(securityResponse.ok()).toBeTruthy();
  const security = await securityResponse.json();
  expect(security.users.some(user => user.role === "director")).toBeTruthy();
  expect(security.accessTokenTtl).toBeTruthy();
});

test("api: login issues refresh token and failed login increments lockout counter", async ({ request, baseURL }) => {
  const credentials = credentialsFor("staff");
  const badLogin = await request.post(`${baseURL}/api/auth/login`, {
    data: {
      email: credentials.email,
      password: `wrong-${Date.now()}`,
      role: credentials.role
    }
  });
  expect([401, 423]).toContain(badLogin.status());

  const login = await request.post(`${baseURL}/api/auth/login`, {
    data: credentials
  });
  expect(login.ok()).toBeTruthy();
  const session = await login.json();
  expect(session.token).toBeTruthy();
  expect(session.refreshToken).toBeTruthy();

  const refresh = await request.post(`${baseURL}/api/auth/refresh`, {
    data: { refreshToken: session.refreshToken }
  });
  expect(refresh.ok()).toBeTruthy();
  const refreshed = await refresh.json();
  expect(refreshed.token).toBeTruthy();
  expect(refreshed.refreshToken).toBeTruthy();

  await request.post(`${baseURL}/api/auth/logout`, {
    headers: { Authorization: `Bearer ${refreshed.token}` },
    data: { refreshToken: refreshed.refreshToken }
  });
});

test("smoke: director opens backup and security panel", async ({ page }) => {
  await authenticate(page, "director");
  await page.goto("/src/pages/director-panel.html");
  await page.locator("[data-report-id='backup-security-report']").click();
  await expect(page.locator("#backup-security-report")).toHaveClass(/active/);
  await expect(page.locator("#create-backup-btn")).toBeVisible();
  await expect(page.locator("#security-users-table")).toContainText("director@drosa.com");
});
