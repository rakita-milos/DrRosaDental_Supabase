const { expect } = require("@playwright/test");

class DashboardPage {
  constructor(page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto("/src/pages/index.html");
  }

  async expectCoreElements() {
    await expect(this.page.locator("body")).toContainText(/Moderna klinika|Evidencija pacijenata/i);
    await expect(this.page.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(this.page.getByRole("link", { name: "Kalendar" })).toBeVisible();
    await expect(this.page.getByRole("link", { name: "Novi unos" })).toBeVisible();
    await expect(this.page.getByRole("link", { name: "Novi pacijent" })).toBeVisible();
    await expect(this.page.getByRole("link", { name: "Evidencija", exact: true })).toBeVisible();
    await expect(this.page.locator("#record-table-body")).toBeVisible();
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
