const { expect } = require("@playwright/test");

class DashboardPage {
  constructor(page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto("/src/pages/index.html");
  }

  async expectCoreElements() {
    await expect(this.page.locator("body")).toContainText(/Kontrolna tabla|Danas u ordinaciji/i);
    const nav = this.page.getByLabel("Glavna navigacija");
    await expect(nav.getByRole("link", { name: "Kontrolna tabla" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Kalendar" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Novi unos" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Novi pacijent" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Evidencija", exact: true })).toBeVisible();
    await expect(this.page.locator("#dashboard-next-chairs")).toBeVisible();
  }

  async openNewEntry() {
    await this.page.getByLabel("Glavna navigacija").getByRole("link", { name: "Novi unos" }).click();
    await expect(this.page).toHaveURL(/new-entry\.html/);
  }

  async openNewPatient() {
    await this.page.getByLabel("Glavna navigacija").getByRole("link", { name: "Novi pacijent" }).click();
    await expect(this.page).toHaveURL(/new-patient\.html/);
  }

  async openAllRecords() {
    await this.page.getByLabel("Glavna navigacija").getByRole("link", { name: "Evidencija", exact: true }).click();
    await expect(this.page).toHaveURL(/all-records\.html/);
  }
}

module.exports = { DashboardPage };
