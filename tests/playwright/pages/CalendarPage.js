const { expect } = require("@playwright/test");

class CalendarPage {
  constructor(page) {
    this.page = page;
    this.title = page.locator("#calendar-title");
    this.view = page.locator("#calendar-view");
    this.doctorFilter = page.locator("#doctor-filter");
    this.statusFilter = page.locator("#status-filter");
    this.board = page.locator("#calendar-board");
    this.newAppointment = page.locator("#new-appointment-btn");
    this.panel = page.locator("#appointment-panel");
    this.alert = page.locator("#appointment-alert");
    this.patient = page.locator("#appointment-patient");
    this.date = page.locator("#appointment-date");
    this.time = page.locator("#appointment-time");
    this.duration = page.locator("#appointment-duration");
    this.doctor = page.locator("#appointment-doctor");
    this.chair = page.locator("#appointment-chair");
    this.status = page.locator("#appointment-status");
    this.procedure = page.locator("#appointment-procedure");
    this.notes = page.locator("#appointment-notes");
    this.save = page.getByRole("button", { name: /Sacuvaj termin/i });
    this.dismiss = page.getByRole("button", { name: /Odustani/i });
    this.createVisit = page.locator("#create-visit-btn");
    this.cancelAppointment = page.locator("#cancel-appointment-btn");
  }

  async goto() {
    await this.page.goto("/src/pages/calendar.html");
    await expect(this.title).toBeVisible();
    await expect(this.board).toBeVisible();
  }

  async expectCoreElements() {
    await expect(this.view).toBeVisible();
    await expect(this.doctorFilter).toBeVisible();
    await expect(this.statusFilter).toBeVisible();
    await expect(this.newAppointment).toBeVisible();
    await expect(this.board).toHaveClass(/calendar-board-week/);
  }

  async switchView(mode, expectedClass) {
    await this.view.selectOption(mode);
    await expect(this.board).toHaveClass(expectedClass);
  }

  async openNewAppointment() {
    await this.newAppointment.click();
    await expect(this.panel).toBeVisible();
    await expect(this.patient).toBeVisible();
    await expect(this.date).toBeVisible();
    await expect(this.time).toBeVisible();
    await expect(this.doctor).toBeVisible();
    await expect(this.chair).toBeVisible();
    await expect(this.procedure).toBeVisible();
  }

  async expectRequiredValidation() {
    await this.openNewAppointment();
    await this.save.click();
    const valid = await this.page.locator("#appointment-form").evaluate(form => form.checkValidity());
    expect(valid).toBe(false);
  }
}

module.exports = { CalendarPage };
