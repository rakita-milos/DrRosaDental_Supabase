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
