const { expect } = require("@playwright/test");

class AllRecordsPage {
  constructor(page) {
    this.page = page;
    this.patientFilter = page.locator("#search-input");
    this.tableBody = page.locator("#all-records-body");
    this.statusFilter = page.locator("#status-filter");
    this.paymentFilter = page.locator("#payment-filter");
    this.exportExcel = page.locator("#export-excel-btn");
    this.exportPdf = page.locator("#export-pdf-btn");
    this.doctorFilter = page.locator("#doctor-filter");
    this.dateFilter = page.locator("#date-filter");
    this.periodFilter = page.locator("#period-filter");
    this.activityFilter = page.locator("#activity-filter");
    this.procedureFilter = page.locator("#procedure-filter");
  }

  async goto() {
    await this.page.goto("/src/pages/all-records.html");
  }

  async filterByPatient(name) {
    await this.patientFilter.selectOption(name);
  }

  async expectCoreElements() {
    await expect(this.patientFilter).toBeVisible();
    await expect(this.statusFilter).toBeVisible();
    await expect(this.doctorFilter).toBeVisible();
    await expect(this.dateFilter).toBeVisible();
    await expect(this.periodFilter).toBeVisible();
    await expect(this.activityFilter).toBeVisible();
    await expect(this.procedureFilter).toBeVisible();
    await expect(this.paymentFilter).toBeVisible();
    await expect(this.exportExcel).toBeVisible();
    await expect(this.exportPdf).toBeVisible();
    await expect(this.tableBody).toBeVisible();
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

  async filterByStatus(status) {
    await this.statusFilter.selectOption(status);
  }

  async filterByPaymentStatus(status) {
    await this.paymentFilter.selectOption(status);
  }

  async exportFilteredTable({ closePopup = true } = {}) {
    const downloadPromise = this.page.waitForEvent("download");
    await this.exportExcel.click();
    const download = await downloadPromise;

    const popupPromise = this.page.waitForEvent("popup");
    await this.exportPdf.click();
    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded").catch(() => {});
    if (closePopup) await popup.close();
    return { download, popup };
  }
}

module.exports = { AllRecordsPage };
