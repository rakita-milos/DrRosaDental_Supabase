const { expect } = require("@playwright/test");

class AllRecordsPage {
  constructor(page) {
    this.page = page;
    this.patientFilter = page.locator("#search-input");
    this.tableBody = page.locator("#all-records-body");
  }

  async goto() {
    await this.page.goto("/src/pages/all-records.html");
  }

  async filterByPatient(name) {
    await this.patientFilter.selectOption(name);
  }

  async expectPatientVisible(name) {
    await expect(this.tableBody).toContainText(name);
  }

  async expectPatientHidden(name) {
    await expect(this.tableBody).not.toContainText(name);
  }

  async openPatient(name) {
    await this.filterByPatient(name);
    await this.tableBody.getByRole("link", { name: "Otvori" }).click();
    await expect(this.page).toHaveURL(/patient-dashboard\.html/);
  }
}

module.exports = { AllRecordsPage };
