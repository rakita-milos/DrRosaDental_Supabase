const { expect } = require("@playwright/test");

class PublicBookingPage {
  constructor(page) {
    this.page = page;
    this.form = page.locator("#public-booking-form");
    this.firstName = page.locator("#booking-first-name");
    this.lastName = page.locator("#booking-last-name");
    this.email = page.locator("#booking-email");
    this.phone = page.locator("#booking-phone");
    this.date = page.locator("#booking-date");
    this.doctor = page.locator("#booking-doctor");
    this.procedure = page.locator("#booking-procedure");
    this.slot = page.locator("#booking-slot");
    this.notes = page.locator("#booking-notes");
    this.message = page.locator("#booking-message");
  }

  async goto() {
    await this.page.goto("/src/pages/public-booking.html");
    await expect(this.page.getByRole("heading", { name: /Zakazivanje termina/i })).toBeVisible();
    await expect(this.form).toBeVisible();
  }

  async book({ firstName, lastName, email, phone, date, note }) {
    await this.firstName.fill(firstName);
    await this.lastName.fill(lastName);
    await this.email.fill(email);
    await this.phone.fill(phone || "060123456");
    await this.date.fill(date);
    await this.doctor.selectOption({ index: 0 });
    await this.page.locator("#refresh-slots").click();
    await expect(this.message).toContainText(/Izaberite termin|Nema slobodnih/i);
    await expect(this.slot.locator("option")).not.toHaveCount(0);
    await this.slot.selectOption({ index: 0 });
    await this.notes.fill(note || "Playwright public booking");
    await this.form.getByRole("button", { name: /Zakazi termin/i }).click();
    await expect(this.message).toContainText(/Termin je zakazan/i);
  }
}

module.exports = { PublicBookingPage };
