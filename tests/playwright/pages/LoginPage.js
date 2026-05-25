const { expect } = require("@playwright/test");
const { credentialsFor } = require("../utils/auth");

class LoginPage {
  constructor(page) {
    this.page = page;
    this.email = page.locator("#email");
    this.role = page.locator("#role");
    this.password = page.locator("#password");
    this.submit = page.getByRole("button", { name: "Prijavi se" });
    this.error = page.locator("#error-msg");
  }

  async goto() {
    await this.page.goto("/src/pages/login.html");
  }

  async loginAs(role = "staff") {
    const credentials = credentialsFor(role);
    await this.goto();
    await this.email.fill(credentials.email);
    await this.role.selectOption(credentials.role);
    await this.password.fill(credentials.password);
    await this.submit.click();
    await expect(this.page).toHaveURL(new RegExp(role === "director" ? "director-panel\\.html" : "index\\.html"));
  }

  async expectCoreElements() {
    await expect(this.email).toBeVisible();
    await expect(this.role).toBeVisible();
    await expect(this.password).toBeVisible();
    await expect(this.submit).toBeVisible();
  }

  async expectRejectedLogin() {
    await this.goto();
    await this.email.fill("missing@example.com");
    await this.role.selectOption("staff");
    await this.password.fill("WrongLoginValue2026!");
    await this.submit.click();
    await expect(this.error).toBeVisible();
    await expect(this.error).toContainText(/invalid|neisprav|email/i);
  }
}

module.exports = { LoginPage };
