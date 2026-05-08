const { expect } = require("@playwright/test");
const { credentialsFor } = require("../utils/auth");

class LoginPage {
  constructor(page) {
    this.page = page;
    this.email = page.locator("#email");
    this.role = page.locator("#role");
    this.password = page.locator("#password");
    this.submit = page.getByRole("button", { name: "Prijavi se" });
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
}

module.exports = { LoginPage };
