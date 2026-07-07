const { expect } = require("@playwright/test");

class PatientDashboardPage {
  constructor(page) {
    this.page = page;
    this.title = page.locator("#patient-name-title");
    this.recordsBody = page.locator("#patient-records-body");
    this.editPatient = page.locator("#edit-patient-link");
    this.deletePatient = page.locator("#delete-patient-btn");
    this.clinicalChartTab = page.locator('[data-patient-tab="clinical-chart-card"]');
    this.clinicalChartBody = page.locator("#clinical-chart-body");
    this.clinicalNotesTab = page.locator('[data-patient-tab="clinical-notes-card"]');
    this.clinicalNotesBody = page.locator("#clinical-notes-body");
    this.consentsTab = page.locator('[data-patient-tab="consents-card"]');
    this.consentsBody = page.locator("#patient-consents-body");
    this.plansTab = page.locator('[data-patient-tab="plans-card"]');
    this.perioTab = page.locator('[data-patient-tab="perio-card"]');
    this.invoicesTab = page.locator('[data-patient-tab="invoices-card"]');
    this.insuranceTab = page.locator('[data-patient-tab="insurance-card"]');
    this.plansBody = page.locator("#treatment-plans-body");
    this.perioBody = page.locator("#perio-charts-body");
    this.invoicesBody = page.locator("#invoices-body");
    this.claimsBody = page.locator("#insurance-claims-body");
    this.documentsTab = page.locator('[data-patient-tab="documents-card"]');
    this.documentsBody = page.locator("#patient-documents-body");
    this.imagingViewer = page.locator("#imaging-viewer");
    this.imagingImage = page.locator("#imaging-image");
  }

  async expectLoaded(name) {
    await expect(this.title).toContainText(name);
  }

  async goto(patientName) {
    await this.page.goto(`/src/pages/patient-dashboard.html?patient=${encodeURIComponent(patientName)}`);
  }

  async expectCoreElements() {
    await expect(this.title).not.toHaveText("");
    await expect(this.editPatient).toBeVisible();
    await expect(this.deletePatient).toBeVisible();
    await expect(this.page.locator('[data-patient-tab="medical-card"]')).toBeVisible();
    await expect(this.page.locator('[data-patient-tab="clinical-chart-card"]')).toBeVisible();
    await expect(this.page.locator('[data-patient-tab="clinical-notes-card"]')).toBeVisible();
    await expect(this.page.locator('[data-patient-tab="consents-card"]')).toBeVisible();
    await expect(this.page.locator('[data-patient-tab="documents-card"]')).toBeVisible();
    await expect(this.plansTab).toBeVisible();
    await expect(this.perioTab).toBeVisible();
    await expect(this.invoicesTab).toBeVisible();
    await expect(this.insuranceTab).toBeVisible();
    await expect(this.recordsBody).toBeVisible();
  }

  async openDocumentViewer(title) {
    await this.documentsTab.click();
    const row = this.documentsBody.locator("tr", { hasText: title }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Pregled", exact: true }).click();
    await expect(this.imagingViewer).toBeVisible();
    await expect(this.imagingImage).toBeVisible();
    await expect(this.page.locator("#imaging-viewer-title")).toContainText(title);
    await expect(this.page.locator('[data-imaging-tool="zoom-in"]')).toBeVisible();
    await expect(this.page.locator('[data-imaging-tool="rotate-right"]')).toBeVisible();
    await expect(this.page.locator("#imaging-brightness")).toBeVisible();
    await expect(this.page.locator("#imaging-contrast")).toBeVisible();
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

  async createAndEditDentalStatus({ tooth = "16", diagnosis, updatedDiagnosis, price = "100", currency = "EUR" }) {
    await this.clinicalChartTab.click();
    await this.page.locator("#clinical-tooth").fill(tooth);
    await this.page.locator("#clinical-surfaces").fill("MO");
    await this.page.locator("#clinical-diagnosis").fill(diagnosis);
    await this.page.locator("#clinical-price").fill(String(price));
    await this.page.locator("#clinical-currency").selectOption(currency);
    await expect(this.page.locator("#clinical-price-preview")).toContainText("RSD");
    await this.page.locator("#clinical-chart-form").getByRole("button", { name: /Sacuvaj zubni status/i }).click();
    await expect(this.clinicalChartBody).toContainText(diagnosis);
    await expect(this.clinicalChartBody).toContainText(currency);
    await expect(this.clinicalChartBody).toContainText("RSD");

    const row = this.clinicalChartBody.locator("tr", { hasText: diagnosis }).first();
    await row.getByRole("button", { name: "Uredi" }).click();
    await expect(this.page.locator("#cancel-clinical-chart-edit-btn")).toBeVisible();
    await this.page.locator("#clinical-diagnosis").fill(updatedDiagnosis);
    await this.page.locator("#clinical-chart-form").getByRole("button", { name: /Sacuvaj izmenu/i }).click();
    await expect(this.clinicalChartBody).toContainText(updatedDiagnosis);
  }

  async createEditAndDeleteClinicalNote({ title, updatedTitle }) {
    await this.clinicalNotesTab.click();
    await this.page.locator("#clinical-note-title").fill(title);
    await this.page.locator("#clinical-note-body").fill("Subjektivno: test\nObjektivno: test");
    await this.page.locator("#clinical-note-form").getByRole("button", { name: /Sacuvaj belesku/i }).click();
    await expect(this.clinicalNotesBody).toContainText(title);

    let row = this.clinicalNotesBody.locator("tr", { hasText: title }).first();
    await row.getByRole("button", { name: "Uredi" }).click();
    await this.page.locator("#clinical-note-title").fill(updatedTitle);
    await this.page.locator("#clinical-note-form").getByRole("button", { name: /Sacuvaj izmenu/i }).click();
    await expect(this.clinicalNotesBody).toContainText(updatedTitle);

    row = this.clinicalNotesBody.locator("tr", { hasText: updatedTitle }).first();
    this.page.once("dialog", dialog => dialog.accept());
    await row.getByRole("button", { name: /Obri/i }).click();
    await expect(this.clinicalNotesBody).not.toContainText(updatedTitle);
  }

  async createEditAndDeleteConsent({ title, updatedTitle }) {
    await this.consentsTab.click();
    await this.page.locator("#consent-title").fill(title);
    await this.page.locator("#consent-signer").fill("Pacijent Test");
    await this.page.locator("#consent-body").fill("Saglasan sam sa predlozenom terapijom.");
    await this.page.locator("#consent-signature").fill("Pacijent Test");
    await this.page.locator("#patient-consent-form").getByRole("button", { name: /Sacuvaj saglasnost/i }).click();
    await expect(this.consentsBody).toContainText(title);

    let row = this.consentsBody.locator("tr", { hasText: title }).first();
    await row.getByRole("button", { name: "Uredi" }).click();
    await this.page.locator("#consent-title").fill(updatedTitle);
    await this.page.locator("#patient-consent-form").getByRole("button", { name: /Sacuvaj izmenu/i }).click();
    await expect(this.consentsBody).toContainText(updatedTitle);

    row = this.consentsBody.locator("tr", { hasText: updatedTitle }).first();
    this.page.once("dialog", dialog => dialog.accept());
    await row.getByRole("button", { name: /Obri/i }).click();
    await expect(this.consentsBody).not.toContainText(updatedTitle);
  }

  async editAndDeleteDocument({ title, updatedTitle }) {
    await this.documentsTab.click();
    let row = this.documentsBody.locator("tr", { hasText: title }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Uredi" }).click();
    await this.page.locator("#document-title").fill(updatedTitle);
    await this.page.locator("#document-form").getByRole("button", { name: /Sacuvaj dokument/i }).click();
    await expect(this.documentsBody).toContainText(updatedTitle);

    row = this.documentsBody.locator("tr", { hasText: updatedTitle }).first();
    this.page.once("dialog", dialog => dialog.accept());
    await row.getByRole("button", { name: /Obri/i }).click();
    await expect(this.documentsBody).not.toContainText(updatedTitle);
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
    await this.page.locator("#perio-form").getByRole("button", { name: /Sacuvaj parodontalni chart/i }).click();
    await expect(this.perioBody).toContainText(/dubokih dzepova/i);
  }

  async createPerioChartDirectly({ tooth = "17", pocket = "5" }) {
    await this.openAdvancedTab("perio");
    await this.page.locator("#perio-tooth").fill(tooth);
    await this.page.locator("#perio-pocket").fill(String(pocket));
    await this.page.locator("#perio-form").getByRole("button", { name: /Sacuvaj parodontalni chart/i }).click();
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

  async createInvoiceDirectly({ description, price = "175" }) {
    await this.openAdvancedTab("invoices");
    await this.page.locator("#invoice-item-description").fill(description);
    await this.page.locator("#invoice-item-price").fill(String(price));
    await this.page.locator("#invoice-form").getByRole("button", { name: /Kreiraj racun/i }).click();
    await expect(this.invoicesBody).toContainText(/DR-/);
    await expect(this.invoicesBody).toContainText(Number(price).toFixed(2));
  }

  async createInsuranceClaim({ provider, amount = "200" }) {
    await this.openAdvancedTab("insurance");
    await this.page.locator("#insurance-provider").fill(provider);
    await this.page.locator("#insurance-policy").fill("POL-E2E");
    await this.page.locator("#insurance-requested").fill(String(amount));
    await this.page.locator("#insurance-notes").fill("Provera podobnosti kroz Playwright");
    await this.page.locator("#insurance-form").getByRole("button", { name: /Sacuvaj zahtev/i }).click();
    await expect(this.claimsBody).toContainText(provider);
  }

  async editFirstRecord() {
    await this.recordsBody.getByRole("link", { name: "Uredi" }).first().click();
    await expect(this.page).toHaveURL(/new-entry\.html/);
  }

  async deleteFirstRecord() {
    this.page.once("dialog", dialog => dialog.accept());
    await this.recordsBody.getByRole("button", { name: /Obri/i }).first().click();
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
