const { expect } = require("@playwright/test");

class DashboardPage {
  constructor(page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto("/src/pages/index.html");
  }

  async openNewEntry() {
    await this.page.getByRole("link", { name: "Novi unos" }).click();
    await expect(this.page).toHaveURL(/new-entry\.html/);
  }

  async openNewPatient() {
    await this.page.getByRole("link", { name: "Novi pacijent" }).first().click();
    await expect(this.page).toHaveURL(/new-patient\.html/);
  }

  async openAllRecords() {
    await this.page.getByRole("link", { name: /Kompletna evidencija/i }).click();
    await expect(this.page).toHaveURL(/all-records\.html/);
  }
}

module.exports = { DashboardPage };
