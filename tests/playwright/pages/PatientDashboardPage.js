const { expect } = require("@playwright/test");

class PatientDashboardPage {
  constructor(page) {
    this.page = page;
    this.title = page.locator("#patient-name-title");
    this.recordsBody = page.locator("#patient-records-body");
    this.editPatient = page.locator("#edit-patient-link");
    this.deletePatient = page.locator("#delete-patient-btn");
    this.plansTab = page.locator('[data-patient-tab="plans-card"]');
    this.perioTab = page.locator('[data-patient-tab="perio-card"]');
    this.invoicesTab = page.locator('[data-patient-tab="invoices-card"]');
    this.insuranceTab = page.locator('[data-patient-tab="insurance-card"]');
    this.plansBody = page.locator("#treatment-plans-body");
    this.perioBody = page.locator("#perio-charts-body");
    this.invoicesBody = page.locator("#invoices-body");
    this.claimsBody = page.locator("#insurance-claims-body");
  }

  async expectLoaded(name) {
    await expect(this.title).toContainText(name);
  }

  async expectRecordVisible(text) {
    await expect(this.recordsBody).toContainText(text);
  }

  async openAdvancedTab(tabName) {
    const tabs = {
      plans: this.plansTab,
      perio: this.perioTab,
      invoices: this.invoicesTab,
      insurance: this.insuranceTab
    };
    await tabs[tabName].click();
  }

  async createTreatmentPlan({ title, procedure, tooth = "11", price = "120" }) {
    await this.openAdvancedTab("plans");
    await this.page.locator("#plan-title").fill(title);
    await this.page.locator("#plan-item-tooth").fill(tooth);
    await this.page.locator("#plan-item-procedure").fill(procedure);
    await this.page.locator("#plan-item-price").fill(String(price));
    await this.page.locator("#add-plan-item-btn").click();
    await expect(this.page.locator("#plan-items-preview")).toContainText(procedure);
    await this.page.locator("#treatment-plan-form").getByRole("button", { name: /Sacuvaj plan/i }).click();
    await expect(this.plansBody).toContainText(title);
  }

  async createPerioChart({ tooth = "16", pocket = "6" }) {
    await this.openAdvancedTab("perio");
    await this.page.locator("#perio-tooth").fill(tooth);
    await this.page.locator("#perio-pocket").fill(String(pocket));
    await this.page.locator("#perio-bleeding").check();
    await this.page.locator("#add-perio-measurement-btn").click();
    await expect(this.page.locator("#perio-measurements-preview")).toContainText(`Zub ${tooth}`);
    await this.page.locator("#perio-form").getByRole("button", { name: /Sacuvaj perio chart/i }).click();
    await expect(this.perioBody).toContainText(/dubokih dzepova/i);
  }

  async createInvoice({ description, price = "150" }) {
    await this.openAdvancedTab("invoices");
    await this.page.locator("#invoice-item-description").fill(description);
    await this.page.locator("#invoice-item-price").fill(String(price));
    await this.page.locator("#add-invoice-item-btn").click();
    await expect(this.page.locator("#invoice-items-preview")).toContainText(description);
    await this.page.locator("#invoice-form").getByRole("button", { name: /Kreiraj racun/i }).click();
    await expect(this.invoicesBody).toContainText(/DR-/);
  }

  async createInsuranceClaim({ provider, amount = "200" }) {
    await this.openAdvancedTab("insurance");
    await this.page.locator("#insurance-provider").fill(provider);
    await this.page.locator("#insurance-policy").fill("POL-E2E");
    await this.page.locator("#insurance-requested").fill(String(amount));
    await this.page.locator("#insurance-notes").fill("Eligibility checked by Playwright");
    await this.page.locator("#insurance-form").getByRole("button", { name: /Sacuvaj claim/i }).click();
    await expect(this.claimsBody).toContainText(provider);
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

  async expectPatientDeleteBlocked(messagePattern = /povezanu istoriju|posete/i) {
    const messages = [];
    const acceptDialog = async (dialog) => {
      messages.push(dialog.message());
      await dialog.accept();
    };

    this.page.on("dialog", acceptDialog);
    await this.deletePatient.click();
    await expect.poll(() => messages.length).toBeGreaterThanOrEqual(2);
    this.page.off("dialog", acceptDialog);

    expect(messages[messages.length - 1]).toMatch(messagePattern);
    await expect(this.page).toHaveURL(/patient-dashboard\.html/);
  }
}

module.exports = { PatientDashboardPage };
