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
    this.advancedSearchToggle = page.locator("#advanced-search-toggle");
    this.advancedSearchPanel = page.locator("#advanced-search-panel");
    this.patientSelectWrap = page.locator("#search-input").locator("xpath=ancestor::*[contains(@class, 'custom-select-wrap')][1]");
    this.doctorFilter = page.locator("#doctor-filter");
    this.dateFilter = page.locator('[data-drrosa-for="date-filter"]');
    this.periodFilter = page.locator("#period-filter");
    this.activityFilter = page.locator("#activity-filter");
    this.procedureFilter = page.locator("#procedure-filter");
  }

  async goto() {
    await this.page.goto("/src/pages/all-records.html");
  }

  async filterByPatient(name) {
    await this.patientFilter.selectOption({ label: name });
  }

  async searchAndSelectPatient(name) {
    await this.patientSelectWrap.locator(".custom-select-button").click();
    await this.patientSelectWrap.locator(".custom-select-search-input").fill(name.slice(0, Math.min(name.length, 6)));
    await expect(this.patientSelectWrap.locator(".custom-select-option", { hasText: name })).toBeVisible();
    await this.patientSelectWrap.locator(".custom-select-option", { hasText: name }).click();
  }

  async showAdvancedSearch() {
    if (await this.advancedSearchPanel.isHidden()) {
      await this.advancedSearchToggle.click();
    }
  }

  async hideAdvancedSearch() {
    if (await this.advancedSearchPanel.isVisible()) {
      await this.advancedSearchToggle.click();
    }
  }

  async expectCoreElements() {
    await expect(this.patientFilter).toBeVisible();
    await expect(this.advancedSearchToggle).toBeVisible();
    await expect(this.advancedSearchToggle).toHaveText("Prikaži ostalu pretragu");
    await expect(this.advancedSearchPanel).toBeHidden();
    await expect(this.statusFilter).toBeHidden();
    await expect(this.doctorFilter).toBeHidden();
    await expect(this.dateFilter).toBeHidden();
    await expect(this.periodFilter).toBeHidden();
    await expect(this.activityFilter).toBeHidden();
    await expect(this.procedureFilter).toBeHidden();
    await expect(this.paymentFilter).toBeHidden();
    await expect(this.exportExcel).toBeVisible();
    await expect(this.exportPdf).toBeVisible();
    await expect(this.tableBody).toBeVisible();
  }

  async expectAdvancedSearchVisible() {
    await this.showAdvancedSearch();
    await expect(this.advancedSearchToggle).toHaveText("Sakrij ostalu pretragu");
    await expect(this.statusFilter).toBeVisible();
    await expect(this.doctorFilter).toBeVisible();
    await expect(this.dateFilter).toBeVisible();
    await expect(this.periodFilter).toBeVisible();
    await expect(this.activityFilter).toBeVisible();
    await expect(this.procedureFilter).toBeVisible();
    await expect(this.paymentFilter).toBeVisible();
  }

  async expectAdvancedSearchResetPreservesPatient(name) {
    await this.filterByPatient(name);
    await this.showAdvancedSearch();
    await this.statusFilter.selectOption("Zakazano");
    await this.hideAdvancedSearch();
    await expect(this.advancedSearchPanel).toBeHidden();
    await expect(this.statusFilter).toHaveValue("");
    await expect(this.patientFilter).toHaveValue(/.+/);
  }

  async expectSearchablePatientDropdown(name) {
    await this.searchAndSelectPatient(name);
    await expect(this.tableBody).toContainText(name);
    await this.patientSelectWrap.locator(".custom-select-button").click();
    await this.patientSelectWrap.locator(".custom-select-search-input").fill("zzzzzz-no-patient");
    await expect(this.patientSelectWrap.locator(".custom-select-empty")).toBeVisible();
    await this.page.keyboard.press("Escape");
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
    await this.showAdvancedSearch();
    await this.statusFilter.selectOption(status);
  }

  async filterByPaymentStatus(status) {
    await this.showAdvancedSearch();
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
