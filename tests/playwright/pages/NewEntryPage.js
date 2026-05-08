const { expect } = require("@playwright/test");

class NewEntryPage {
  constructor(page) {
    this.page = page;
    this.patientName = page.locator("#patient-name");
    this.lastVisit = page.locator("#last-visit");
    this.activity = page.locator("#procedure-activity");
    this.procedure = page.locator("#procedure");
    this.status = page.locator("#status");
    this.paymentStatus = page.locator("#payment-status");
    this.currency = page.locator("#currency");
    this.shift = page.locator("#shift");
    this.amountDue = page.locator("#amount-due");
    this.note = page.locator("#note");
    this.submit = page.getByRole("button", { name: /Spremi unos/i });
    this.alert = page.locator(".form-alert");
  }

  async goto(recordId, patientName) {
    const params = new URLSearchParams();
    if (patientName) params.set("patient", patientName);
    if (recordId) params.set("record", recordId);
    const query = params.toString();
    await this.page.goto(`/src/pages/new-entry.html${query ? `?${query}` : ""}`);
  }

  async fillVisit(data) {
    await this.patientName.fill(data.patientName);
    await this.lastVisit.fill(data.lastVisit || "2026-05-08");
    await this.activity.selectOption({ index: data.activityIndex || 1 });
    await expect(this.procedure).toBeEnabled();
    if (data.procedureLabel) {
      await this.procedure.selectOption({ label: data.procedureLabel });
    } else {
      await this.procedure.selectOption({ index: data.procedureIndex || 1 });
    }
    await this.status.selectOption({ index: data.statusIndex || 2 });
    await this.paymentStatus.selectOption({ index: data.paymentIndex || 0 });
    await this.currency.selectOption(data.currency || "EUR");
    await this.shift.selectOption(data.shift || "Prva smena");
    await this.amountDue.fill(String(data.amountDue ?? 0));
    await this.note.fill(data.note || "Automated Playwright visit smoke test");
  }

  async updateProcedureFromOpenedRecord(label) {
    await this.procedure.selectOption({ label });
  }

  async save() {
    await this.submit.click();
  }
}

module.exports = { NewEntryPage };
