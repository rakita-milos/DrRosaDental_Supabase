const { test, expect } = require("@playwright/test");
const { credentialsFor } = require("../utils/auth");

test.describe("password login", () => {
  test.skip(process.env.PLAYWRIGHT_VERIFY_PASSWORD_LOGIN !== "1", "Set PLAYWRIGHT_VERIFY_PASSWORD_LOGIN=1 to verify real seed credentials.");

  test("seed staff account can log in through the real auth endpoint", async ({ request, baseURL }) => {
    const credentials = credentialsFor("staff");
    const response = await request.post(`${baseURL}/api/auth/login`, { data: credentials });
    expect(response.ok(), `staff login should succeed, got ${response.status()}`).toBeTruthy();
    const body = await response.json();
    expect(body.user.email).toBe(credentials.email);
    expect(body.user.role).toBe("staff");
  });
});
