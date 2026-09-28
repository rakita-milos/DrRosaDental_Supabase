const { expect } = require("@playwright/test");

class NewEntryPage {
  constructor(page) {
    this.page = page;
    this.patientName = page.locator("#patient-name");
    this.lastVisit = page.locator('[data-drrosa-for="last-visit"]');
    this.activity = page.locator("#procedure-activity");
    this.procedure = page.locator("#procedure");
    this.status = page.locator("#status");
    this.paymentStatus = page.locator("#payment-status");
    this.currency = page.locator("#currency");
    this.shift = page.locator("#shift");
    this.amountPaid = page.locator("#amount-paid");
    this.amountDue = page.locator("#amount-due");
    this.totalAmount = page.locator("#total-amount");
    this.note = page.locator("#note");
    this.submit = page.getByRole("button", { name: /Sačuvaj unos|Sacuvaj unos/i });
    this.alert = page.locator("#save-status");
  }

  async goto(recordId, patientName) {
    const params = new URLSearchParams();
    if (patientName) params.set("patient", patientName);
    if (recordId) params.set("record", recordId);
    const query = params.toString();
    const codebooksLoaded = this.page.waitForResponse(response =>
      new URL(response.url()).pathname === "/api/codebooks"
      && response.request().method() === "GET"
      && response.ok()
    );
    await this.page.goto(`/src/pages/new-entry.html${query ? `?${query}` : ""}`);
    await codebooksLoaded;
  }

  async fillVisit(data) {
    await this.patientName.fill(data.patientName);
    await this.lastVisit.fill(data.lastVisitDisplay || "08.05.2026");
    await this.lastVisit.press("Tab");
    if (!(await this.page.locator("#procedure-fallback-block").isVisible())) {
      await this.page.locator("#toggle-procedure-fallback").click();
    }
    if (data.activityLabel) {
      await expect(this.activity.locator("option", { hasText: data.activityLabel })).toHaveCount(1);
      await this.activity.selectOption({ label: data.activityLabel }, { force: true });
    } else {
      await this.selectFirstAvailableOption(this.activity, data.activityIndex);
    }
    await expect(this.procedure).toBeEnabled();
    if (data.procedureLabel) {
      await expect(this.procedure.locator("option", { hasText: data.procedureLabel })).toHaveCount(1);
      await this.procedure.selectOption({ label: data.procedureLabel }, { force: true });
    } else {
      await this.selectFirstAvailableOption(this.procedure, data.procedureIndex);
    }
    await this.shift.selectOption(data.shift || "Prva smena", { force: true });
    if (data.totalAmount !== undefined) {
      await this.totalAmount.fill(String(data.totalAmount));
    }
    if (data.amountDue !== undefined) {
      await expect(this.amountDue).toHaveValue(String(data.amountDue));
    }
    await this.note.fill(data.note || "Automated Playwright visit smoke test");
  }

  async selectFirstAvailableOption(locator, requestedIndex) {
    if (requestedIndex !== undefined) {
      await locator.selectOption({ index: requestedIndex }, { force: true });
      return;
    }
    const value = await locator.locator("option").evaluateAll(options =>
      options.find(option => !option.disabled && option.value)?.value || null
    );
    if (!value) throw new Error("No selectable option is available.");
    await locator.selectOption(value, { force: true });
  }

  async updateProcedureFromOpenedRecord(label) {
    await this.procedure.selectOption({ label }, { force: true });
  }

  async save() {
    const saved = this.page.waitForResponse(response =>
      /\/api\/records(?:\/\d+)?$/.test(new URL(response.url()).pathname)
      && ["POST", "PUT"].includes(response.request().method())
      && response.ok()
    );
    const navigation = this.page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10_000 }).catch(() => null);
    await this.page.locator("#new-entry-form").evaluate(form => {
      form.noValidate = true;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await saved;
    await navigation;
  }

  async expectCoreElements() {
    await expect(this.page.locator(".tooth-node").first()).toBeVisible();
    await expect(this.patientName).toBeVisible();
    await expect(this.lastVisit).toBeVisible();
    await expect(this.page.locator("#toggle-procedure-fallback")).toBeVisible();
    await expect(this.paymentStatus).toBeHidden();
    await expect(this.shift).toBeVisible();
    await expect(this.amountPaid).toBeHidden();
    await expect(this.page.locator("#payment-parts-list")).toBeVisible();
    await expect(this.page.locator("#payment-total-display")).toBeVisible();
    await expect(this.note).toBeVisible();
  }

  async expectRequiredValidation() {
    await this.page.locator("#new-entry-form").evaluate(form => {
      form.noValidate = true;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await expect(this.alert).toContainText(/Ispunite pacijenta|odaberite postupak/i);
  }
}

module.exports = { NewEntryPage };
