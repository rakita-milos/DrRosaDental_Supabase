const { expect } = require("@playwright/test");

class DirectorPanelPage {
  constructor(page) {
    this.page = page;
    this.reportsGrid = page.locator("#reports-grid");
  }

  async goto() {
    await this.page.goto("/src/pages/director-panel.html");
  }

  async openReport(reportId, tableSelector) {
    await this.page.locator(`[data-report-id="${reportId}"]`).click();
    await expect(this.page.locator(`#${reportId}`)).toHaveClass(/active/);
    await expect(this.page.locator(`${tableSelector} tr`).first()).toBeVisible();
  }

  async exportCurrentReport(reportId) {
    await this.page.locator(`#${reportId} .export-report-excel`).click();
    await this.page.locator(`#${reportId} .export-report-pdf`).click();
  }

  async backToReports(reportId) {
    await this.page.locator(`#${reportId} .back-to-reports`).click();
    await expect(this.reportsGrid).toBeVisible();
  }
}

module.exports = { DirectorPanelPage };
