const { expect } = require("@playwright/test");

class PatientDashboardPage {
  constructor(page) {
    this.page = page;
    this.title = page.locator("#patient-name-title");
    this.recordsBody = page.locator("#patient-activity-timeline");
    this.editPatient = page.locator("#edit-patient-link");
    this.deletePatient = page.locator("#delete-patient-btn");
    this.clinicalNotesTab = page.locator('.patient-group-tab[data-patient-group="clinical"]');
    this.clinicalNotesBody = page.locator("#clinical-notes-body");
    this.consentsTab = page.locator('.patient-group-tab[data-patient-group="clinical"]');
    this.consentsBody = page.locator("#patient-consents-body");
    this.invoicesTab = page.locator('.patient-group-tab[data-patient-group="finance"]');
    this.insuranceTab = page.locator('.patient-group-tab[data-patient-group="admin"]');
    this.invoicesBody = page.locator("#invoices-body");
    this.claimsBody = page.locator("#insurance-claims-body");
    this.documentsTab = page.locator('.patient-group-tab[data-patient-group="documents"]');
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
    await expect(this.page.locator('.patient-group-tab[data-patient-group="clinical"]')).toBeVisible();
    await expect(this.page.locator('.patient-group-tab[data-patient-group="teeth"]')).toBeVisible();
    await expect(this.page.locator('.patient-group-tab[data-patient-group="documents"]')).toBeVisible();
    await expect(this.invoicesTab).toBeVisible();
    await expect(this.insuranceTab).toBeVisible();
    await expect(this.recordsBody).toBeVisible();
  }

  async openDocumentViewer(title) {
    await this.documentsTab.click();
    await expect(this.documentsBody).toHaveAttribute("data-document-actions-ready", "1");
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
      invoices: this.invoicesTab,
      insurance: this.insuranceTab
    };
    await tabs[tabName].click();
  }

  async createEditAndDeleteClinicalNote({ title, updatedTitle }) {
    await this.clinicalNotesTab.click();
    await this.page.locator("#clinical-note-title").fill(title);
    await this.page.locator("#clinical-note-body").fill("Subjektivno: test\nObjektivno: test");
    await this.page.locator("#clinical-note-form button[type='submit']").click();
    await expect(this.clinicalNotesBody).toContainText(title);

    let row = this.clinicalNotesBody.locator("tr", { hasText: title }).first();
    await row.getByRole("button", { name: "Uredi" }).click();
    await this.page.locator("#clinical-note-title").fill(updatedTitle);
    await this.page.locator("#clinical-note-form button[type='submit']").click();
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
    await this.page.locator("#patient-consent-form button[type='submit']").click();
    await expect(this.consentsBody).toContainText(title);

    let row = this.consentsBody.locator("tr", { hasText: title }).first();
    await row.getByRole("button", { name: "Uredi" }).click();
    await this.page.locator("#consent-title").fill(updatedTitle);
    await this.page.locator("#patient-consent-form button[type='submit']").click();
    await expect(this.consentsBody).toContainText(updatedTitle);

    row = this.consentsBody.locator("tr", { hasText: updatedTitle }).first();
    this.page.once("dialog", dialog => dialog.accept());
    await row.getByRole("button", { name: /Obri/i }).click();
    await expect(this.consentsBody).not.toContainText(updatedTitle);
  }

  async editAndDeleteDocument({ title, updatedTitle }) {
    await this.documentsTab.click();
    await expect(this.documentsBody).toHaveAttribute("data-document-actions-ready", "1");
    let row = this.documentsBody.locator("tr", { hasText: title }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Uredi" }).click();
    await expect(this.page.locator("#document-id")).not.toHaveValue("");
    await this.page.locator("#document-title").fill(updatedTitle);
    const saved = this.page.waitForResponse(response =>
      /^\/api\/documents\/\d+$/.test(new URL(response.url()).pathname)
      && response.request().method() === "PUT"
    );
    await this.page.locator("#document-form button[type='submit']").click();
    const response = await saved;
    expect(response.ok(), "document update should succeed").toBeTruthy();
    await expect(this.documentsBody).toContainText(updatedTitle);

    row = this.documentsBody.locator("tr", { hasText: updatedTitle }).first();
    this.page.once("dialog", dialog => dialog.accept());
    await row.getByRole("button", { name: /Obri/i }).click();
    await expect(this.documentsBody).not.toContainText(updatedTitle);
  }

  async createInvoice({ description, price = "150" }) {
    await this.openAdvancedTab("invoices");
    await this.page.locator("#invoice-item-description").fill(description);
    await this.page.locator("#invoice-item-price").fill(String(price));
    await this.page.locator("#add-invoice-item-btn").click();
    await expect(this.page.locator("#invoice-items-preview")).toContainText(description);
    await this.page.locator("#invoice-form button[type='submit']").click();
    await expect(this.invoicesBody).toContainText(/DR-/);
  }

  async createInvoiceDirectly({ description, price = "175" }) {
    await this.openAdvancedTab("invoices");
    await this.page.locator("#invoice-item-description").fill(description);
    await this.page.locator("#invoice-item-price").fill(String(price));
    await this.page.locator("#invoice-form button[type='submit']").click();
    await expect(this.invoicesBody).toContainText(/DR-/);
    await expect(this.invoicesBody).toContainText(Number(price).toFixed(2));
  }

  async createInsuranceClaim({ provider, amount = "200" }) {
    await this.openAdvancedTab("insurance");
    await this.page.locator("#insurance-provider").fill(provider);
    await this.page.locator("#insurance-policy").fill("POL-E2E");
    await this.page.locator("#insurance-requested").fill(String(amount));
    await this.page.locator("#insurance-notes").fill("Provera podobnosti kroz Playwright");
    await this.page.locator("#insurance-form button[type='submit']").click();
    await expect(this.claimsBody).toContainText(provider);
  }

  async editFirstRecord() {
    await this.recordsBody.getByRole("link", { name: "Uredi" }).first().click();
    await expect(this.page).toHaveURL(/new-entry\.html/);
  }

  async deleteFirstRecord() {
    const deleted = this.page.waitForResponse(response =>
      /^\/api\/records\/\d+$/.test(new URL(response.url()).pathname)
      && response.request().method() === "DELETE"
      && response.ok()
    );
    const navigation = this.page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10_000 }).catch(() => null);
    this.page.once("dialog", dialog => dialog.accept());
    await this.recordsBody.getByRole("button", { name: /Obri/i }).first().click();
    await deleted;
    await navigation;
  }

  async editPatientDetails() {
    const loaded = this.page.waitForResponse(response =>
      new URL(response.url()).pathname === "/api/patients"
      && response.request().method() === "GET"
      && response.ok()
    );
    await this.editPatient.click();
    await expect(this.page).toHaveURL(/new-patient\.html/);
    await loaded;
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
