const { expect } = require("@playwright/test");

class PatientDashboardPage {
  constructor(page) {
    this.page = page;
    this.title = page.locator("#patient-name-title");
    this.recordsBody = page.locator("#patient-records-body");
    this.editPatient = page.locator("#edit-patient-link");
    this.deletePatient = page.locator("#delete-patient-btn");
  }

  async expectLoaded(name) {
    await expect(this.title).toContainText(name);
  }

  async expectRecordVisible(text) {
    await expect(this.recordsBody).toContainText(text);
  }

  async editFirstRecord() {
    await this.recordsBody.getByRole("link", { name: "Uredi" }).first().click();
    await expect(this.page).toHaveURL(/new-entry\.html/);
  }

  async deleteFirstRecord() {
    this.page.once("dialog", dialog => dialog.accept());
    await this.recordsBody.getByRole("button", { name: "Obrisi" }).first().click();
  }

  async editPatientDetails() {
    await this.editPatient.click();
    await expect(this.page).toHaveURL(/new-patient\.html/);
  }

  async deleteCurrentPatient() {
    this.page.once("dialog", dialog => dialog.accept());
    await this.deletePatient.click();
    await expect(this.page).toHaveURL(/all-records\.html/);
  }
}

module.exports = { PatientDashboardPage };
