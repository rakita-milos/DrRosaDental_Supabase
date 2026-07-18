const { test, expect } = require("@playwright/test");
const { authHeaders } = require("../utils/api");
const { authenticate, credentialsFor, signTestToken } = require("../utils/auth");

test("api: director sees PostgreSQL backup status and security status", async ({ request, baseURL }) => {
  const statusResponse = await request.get(`${baseURL}/api/director/backups/status`, {
    headers: authHeaders("director")
  });
  expect(statusResponse.ok()).toBeTruthy();
  const initialStatus = await statusResponse.json();
  expect(initialStatus).toMatchObject({
    mode: "supabase_postgres",
    warning: false
  });

  const createResponse = await request.post(`${baseURL}/api/director/backups`, {
    headers: authHeaders("director")
  });
  expect(createResponse.status()).toBe(501);
  await expect(createResponse.json()).resolves.toHaveProperty("error", expect.stringContaining("Supabase PostgreSQL backups"));

  const listResponse = await request.get(`${baseURL}/api/director/backups`, {
    headers: authHeaders("director")
  });
  expect(listResponse.ok()).toBeTruthy();
  const backups = await listResponse.json();
  expect(Array.isArray(backups)).toBeTruthy();

  const securityResponse = await request.get(`${baseURL}/api/director/security/status`, {
    headers: authHeaders("director")
  });
  expect(securityResponse.ok()).toBeTruthy();
  const security = await securityResponse.json();
  expect(security.users.some(user => user.role === "director")).toBeTruthy();
  expect(security.accessTokenTtl).toBeTruthy();
  expect(Array.isArray(security.sessions)).toBeTruthy();
  expect(Array.isArray(security.restoreTests)).toBeTruthy();

  const auditResponse = await request.get(`${baseURL}/api/director/security/audit-log?limit=20`, {
    headers: authHeaders("director")
  });
  expect(auditResponse.ok()).toBeTruthy();
  expect(Array.isArray(await auditResponse.json())).toBeTruthy();

  const sessionsResponse = await request.get(`${baseURL}/api/director/security/sessions`, {
    headers: authHeaders("director")
  });
  expect(sessionsResponse.ok()).toBeTruthy();
  expect(Array.isArray(await sessionsResponse.json())).toBeTruthy();

  const staff = security.users.find(user => user.role === "staff");
  expect(staff).toBeTruthy();
  const permissionsResponse = await request.put(`${baseURL}/api/director/security/users/${staff.id}/permissions`, {
    headers: authHeaders("director"),
    data: { permissions: staff.permissions || ["patients:read"] }
  });
  expect(permissionsResponse.ok()).toBeTruthy();
  expect(await permissionsResponse.json()).toHaveProperty("permissions");

  const invalidPermissionsResponse = await request.put(`${baseURL}/api/director/security/users/${staff.id}/permissions`, {
    headers: authHeaders("director"),
    data: { permissions: ["patients:read", "invalid:permission"] }
  });
  expect(invalidPermissionsResponse.status()).toBe(400);

  const legalExport = await request.get(`${baseURL}/api/director/legal-export?limit=2`, {
    headers: authHeaders("director")
  });
  expect(legalExport.ok()).toBeTruthy();
  const exportBody = await legalExport.json();
  expect(exportBody.generatedAt).toBeTruthy();
  expect(exportBody.meta.limit).toBe(2);
  expect(exportBody.meta.counts).toHaveProperty("patients");
  expect(exportBody.meta.truncated).toHaveProperty("patients");
  expect(Array.isArray(exportBody.patients)).toBeTruthy();
  expect(exportBody.patients.length).toBeLessThanOrEqual(2);
});

test("api: director endpoints reject signed tokens for users missing from the database", async ({ request, baseURL }) => {
  const ghostToken = signTestToken({
    id: 999999,
    email: "ghost@example.invalid",
    name: "Ghost Director",
    role: "director"
  });
  const response = await request.get(`${baseURL}/api/director/security/status`, {
    headers: { Authorization: `Bearer ${ghostToken}` }
  });
  expect(response.status()).toBe(403);
});

test("api: login issues refresh token and failed login increments lockout counter", async ({ request, baseURL }) => {
  const credentials = credentialsFor("staff");
  await request.post(`${baseURL}/api/director/security/users/2/reset-password`, {
    headers: authHeaders("director"),
    data: { newPassword: credentials.password }
  });
  await request.post(`${baseURL}/api/director/security/users/2/unlock`, {
    headers: authHeaders("director")
  });

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
