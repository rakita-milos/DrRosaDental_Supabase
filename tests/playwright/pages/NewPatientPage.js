const { expect } = require("@playwright/test");

class NewPatientPage {
  constructor(page) {
    this.page = page;
    this.firstName = page.locator("#first-name");
    this.lastName = page.locator("#last-name");
    this.birthDate = page.locator("#birth-date");
    this.gender = page.locator("#gender");
    this.address = page.locator("#address");
    this.phone = page.locator("#phone");
    this.email = page.locator("#email");
    this.emergencyContact = page.locator("#emergency-contact");
    this.medicalHistory = page.locator("#medical-history");
    this.allergies = page.locator("#allergies");
    this.currentMedications = page.locator("#current-medications");
    this.previousTreatments = page.locator("#previous-treatments");
    this.submit = page.locator("#patient-form button[type='submit']");
  }

  async goto(patientId) {
    await this.page.goto(patientId ? `/src/pages/new-patient.html?patient=${patientId}` : "/src/pages/new-patient.html");
  }

  async fillPatient(data) {
    await this.firstName.fill(data.firstName);
    await this.lastName.fill(data.lastName);
    await this.birthDate.fill(data.birthDate || "1986-05-08");
    await this.gender.selectOption({ index: data.genderIndex || 1 });
    await this.address.fill(data.address || "Playwright smoke address");
    await this.phone.fill(data.phone || "060123456");
    await this.email.fill(data.email);
    await this.emergencyContact.fill(data.emergencyContact || "Smoke Contact");
    await this.medicalHistory.fill(data.medicalHistory || "Automated smoke patient");
  }

  async expectCoreElements() {
    await expect(this.firstName).toBeVisible();
    await expect(this.lastName).toBeVisible();
    await expect(this.birthDate).toBeVisible();
    await expect(this.gender).toBeVisible();
    await expect(this.address).toBeVisible();
    await expect(this.phone).toBeVisible();
    await expect(this.email).toBeVisible();
    await expect(this.emergencyContact).toBeVisible();
    await expect(this.allergies).toBeVisible();
    await expect(this.medicalHistory).toBeVisible();
    await expect(this.currentMedications).toBeVisible();
    await expect(this.previousTreatments).toBeVisible();
  }

  async expectRequiredValidation() {
    await this.submit.click();
    const valid = await this.page.locator("#patient-form").evaluate(form => form.checkValidity());
    expect(valid).toBe(false);
  }

  async saveAndAcceptDialog(expectedText) {
    const dialogPromise = new Promise((resolve) => {
      this.page.once("dialog", dialog => {
        const message = dialog.message();
        resolve(message);
        dialog.accept().catch(() => {});
      });
    });
    await this.submit.click();
    const message = await dialogPromise;
    if (expectedText) expect(message).toContain(expectedText);
  }
}

module.exports = { NewPatientPage };
