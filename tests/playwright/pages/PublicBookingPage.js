const { expect } = require("@playwright/test");

class PublicBookingPage {
  constructor(page) {
    this.page = page;
    this.form = page.locator("#public-booking-form");
    this.firstName = page.locator("#booking-first-name");
    this.lastName = page.locator("#booking-last-name");
    this.email = page.locator("#booking-email");
    this.phone = page.locator("#booking-phone");
    this.date = page.locator('[data-drrosa-for="booking-date"]');
    this.doctor = page.locator("#booking-doctor");
    this.procedure = page.locator("#booking-procedure");
    this.slot = page.locator("#booking-slot");
    this.notes = page.locator("#booking-notes");
    this.message = page.locator("#booking-message");
  }

  async goto() {
    await this.page.goto("/src/pages/public-booking.html");
    await expect(this.form).toBeVisible();
  }

  async book({ firstName, lastName, email, phone, date, note }) {
    await this.firstName.fill(firstName);
    await this.lastName.fill(lastName);
    await this.email.fill(email);
    await this.phone.fill(phone || "060123456");
    const [year, month, day] = date.split("-");
    await this.date.fill(`${day}.${month}.${year}`);
    await this.date.press("Tab");
    await this.doctor.selectOption({ index: 0 });
    await this.page.locator("#refresh-slots").click();
    await expect(this.slot).toBeEnabled();
    await expect(this.message).toContainText(/Izaberite termin|Nema slobodnih/i);
    await this.selectFirstAvailableSlot();
    await this.notes.fill(note || "Playwright public booking");
    await this.form.getByRole("button", { name: /Zakazi termin/i }).click();
    await expect(this.message).toContainText(/Termin je zakazan/i);
  }

  async selectFirstAvailableSlot() {
    await expect.poll(async () => this.slot.locator("option").evaluateAll(options =>
      options.some(option => option.value)
    )).toBe(true);
    const value = await this.slot.locator("option").evaluateAll(options =>
      options.find(option => option.value)?.value || null
    );
    if (!value) throw new Error("No public booking slot is available.");
    await this.slot.selectOption(value, { force: true });
  }

  async expectCoreElements() {
    await expect(this.form).toBeVisible();
    if (await this.firstName.isHidden()) {
      await expect(this.message).toContainText(/trenutno nije dostupno/i);
      return;
    }
    await expect(this.firstName).toBeVisible();
    await expect(this.lastName).toBeVisible();
    await expect(this.email).toBeVisible();
    await expect(this.phone).toBeVisible();
    await expect(this.date).toBeVisible();
    await expect(this.doctor).toBeVisible();
    await expect(this.procedure).toBeVisible();
    await expect(this.slot).toBeVisible();
    await expect(this.notes).toBeVisible();
  }

  async expectInvalidPhoneRejected() {
    await this.firstName.fill("Test");
    await this.lastName.fill("Pacijent");
    const date = await this.page.evaluate(() => {
      const next = new Date();
      next.setDate(next.getDate() + 1);
      return window.DrRosaDateUtils.formatDate(next);
    });
    await this.date.fill(date);
    await this.date.press("Tab");
    await this.doctor.selectOption({ index: 0 }, { force: true });
    await this.page.locator("#refresh-slots").click();
    await expect(this.slot).toBeEnabled();
    await this.selectFirstAvailableSlot();
    await this.phone.fill("abc");
    await this.form.getByRole("button", { name: /Zakazi termin/i }).click();
    await expect(this.message).toContainText(/telefona nije u ispravnom formatu/i);
  }
}

module.exports = { PublicBookingPage };
