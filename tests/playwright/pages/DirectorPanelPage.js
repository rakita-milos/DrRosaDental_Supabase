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

  async openCodebookAdmin() {
    await this.page.locator('[data-report-id="admin-codebooks-report"]').click();
    await expect(this.page.locator("#admin-codebooks-report")).toHaveClass(/active/);
    await expect(this.page.locator("#codebook-grid")).toContainText("Smene");
  }

  async openCodebookType(type) {
    const backButton = this.page.locator(".back-to-codebooks");
    if (await backButton.isVisible()) {
      await backButton.click();
    }
    await this.page.locator(`[data-codebook-type="${type}"]`).click();
    await expect(this.page.locator("#admin-codebook-editor")).toHaveClass(/active/);
  }

  async createAndDeleteCodebookItem(value) {
    await this.openCodebookType("shift");
    await expect(this.page.locator("#codebook-editor-title")).toContainText("Smene");
    await expect(this.page.locator("#codebook-value-field")).toBeHidden();
    await this.page.locator("#codebook-label").fill(value);
    await this.page.locator("#codebook-sort").fill("99");
    await this.page.locator("#shift-time-from").fill("09:00");
    await this.page.locator("#shift-time-to").fill("17:00");
    await this.page.locator('input[name="shift-days"][value="monday"]').check();
    await this.page.locator('input[name="shift-days"][value="wednesday"]').check();
    await this.page.getByRole("button", { name: "Sačuvaj šifru" }).click();
    await expect(this.page.locator("#codebook-table")).toContainText(value);
    await expect(this.page.locator("#codebook-table")).toContainText("09:00-17:00");
    await expect(this.page.locator("#codebook-table")).toContainText("Ponedeljak");
    await expect(this.page.locator("#codebook-table")).toContainText("Sreda");

    const row = this.page.locator("#codebook-table tr", { hasText: value }).first();
    this.page.once("dialog", dialog => dialog.accept());
    await row.getByRole("button", { name: "Obrisi" }).click();
    await expect(this.page.locator("#codebook-table")).not.toContainText(value);
  }

  async expectCurrencyFormFields() {
    await this.openCodebookType("currency");
    await expect(this.page.locator("#codebook-editor-title")).toContainText("Valute");
    await expect(this.page.locator("#codebook-value-field")).toBeVisible();
    await expect(this.page.locator("#codebook-detail-header")).toHaveText("Kurs");
    await expect(this.page.locator(".codebook-group-field")).toBeHidden();
    await expect(this.page.locator(".codebook-price-field")).toBeHidden();
    await expect(this.page.locator("#currency-fields")).toBeVisible();
    await expect(this.page.locator("#fetch-currency-rate")).toBeVisible();
  }

  async expectPaymentStatusSimpleFields() {
    await this.openCodebookType("payment_status");
    await expect(this.page.locator("#codebook-editor-title")).toContainText("Statusi placanja");
    await expect(this.page.locator("#codebook-value-field")).toBeHidden();
    await expect(this.page.locator("#codebook-detail-header")).toBeHidden();
    await expect(this.page.locator(".codebook-group-field")).toBeHidden();
    await expect(this.page.locator(".codebook-price-field")).toBeHidden();
    await expect(this.page.locator("#currency-fields")).toBeHidden();
    await expect(this.page.locator("#shift-fields")).toBeHidden();
  }

  async expectActivitySimpleFields() {
    await this.openCodebookType("activity");
    await expect(this.page.locator("#codebook-editor-title")).toContainText("Delatnosti");
    await expect(this.page.locator("#codebook-value-field")).toBeHidden();
    await expect(this.page.locator(".codebook-group-field")).toBeHidden();
    await expect(this.page.locator(".codebook-price-field")).toBeHidden();
    await expect(this.page.locator("#codebook-detail-header")).toBeHidden();
  }

  async expectCurrencyCodeLockedOnEdit() {
    await this.openCodebookType("currency");
    const firstRow = this.page.locator("#codebook-table tr").first();
    const code = await firstRow.locator("td").first().innerText();
    await firstRow.getByRole("button", { name: "Uredi" }).click();
    await expect(this.page.locator("#codebook-value")).toHaveValue(code.trim());
    await expect(this.page.locator("#codebook-value")).toBeDisabled();
  }

  async createEditAndDeleteActivity(originalName, updatedName) {
    await this.page.locator(".back-to-codebooks").click();
    await this.page.locator('[data-codebook-type="activity"]').click();
    await expect(this.page.locator("#admin-codebook-editor")).toHaveClass(/active/);
    await this.page.locator("#codebook-label").fill(originalName);
    await this.page.locator("#codebook-sort").fill("98");
    await this.page.getByRole("button", { name: "Sačuvaj šifru" }).click();
    await expect(this.page.locator("#codebook-table")).toContainText(originalName);

    const row = this.page.locator("#codebook-table tr", { hasText: originalName }).first();
    const originalCode = await row.locator("td").first().innerText();
    await row.getByRole("button", { name: "Uredi" }).click();
    await this.page.locator("#codebook-label").fill(updatedName);
    await this.page.getByRole("button", { name: "Sačuvaj šifru" }).click();

    const updatedRow = this.page.locator("#codebook-table tr", { hasText: updatedName }).first();
    await expect(updatedRow).toBeVisible();
    await expect(updatedRow.locator("td").first()).toHaveText(originalCode.trim());

    this.page.once("dialog", dialog => dialog.accept());
    await updatedRow.getByRole("button", { name: "Obrisi" }).click();
    await expect(this.page.locator("#codebook-table")).not.toContainText(updatedName);
  }

  async createActivity(name) {
    await this.openCodebookType("activity");
    await this.page.locator("#codebook-label").fill(name);
    await this.page.getByRole("button", { name: "Sačuvaj šifru" }).click();
    await expect(this.page.locator("#codebook-table")).toContainText(name);
  }

  async createProcedure({ name, activity, price = "75" }) {
    await this.openCodebookType("procedure");
    await expect(this.page.locator("#codebook-detail-header")).toHaveText("Delatnost");
    await this.page.locator("#codebook-label").fill(name);
    await this.page.locator("#codebook-group").fill(activity);
    await this.page.locator("#codebook-price").fill(String(price));
    await this.page.getByRole("button", { name: "Sačuvaj šifru" }).click();
    await expect(this.page.locator("#codebook-table")).toContainText(name);
    await expect(this.page.locator("#codebook-table")).toContainText(activity);
  }
}

module.exports = { DirectorPanelPage };
