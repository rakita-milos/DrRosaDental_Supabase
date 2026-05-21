const { test, expect } = require("@playwright/test");
const { cleanupRegressionData } = require("../utils/cleanup");
const { createPatient } = require("../utils/api");
const { authenticate } = require("../utils/auth");
const { PatientDashboardPage } = require("../pages/PatientDashboardPage");
const { PublicBookingPage } = require("../pages/PublicBookingPage");

const TEST_PREFIX = "ADVUI";

test.beforeEach(async ({ request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
});

test.afterEach(async ({ request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
});

test("ui: public booking page loads options and books a free slot", async ({ page }) => {
  const stamp = Date.now();
  const booking = new PublicBookingPage(page);
  await booking.goto();
  await booking.book({
    firstName: `${TEST_PREFIX}${stamp}`,
    lastName: "Booking",
    email: `${TEST_PREFIX.toLowerCase()}.${stamp}@example.test`,
    date: "2026-07-03",
    note: `${TEST_PREFIX} UI public booking`
  });
});

test("ui: patient dashboard advanced tabs create plan, perio, invoice and claim", async ({ page, request, baseURL }) => {
  const stamp = Date.now();
  const patient = await createPatient(request, baseURL, {
    firstName: `${TEST_PREFIX}${stamp}`,
    lastName: "Patient",
    email: `${TEST_PREFIX.toLowerCase()}.${stamp}@example.test`
  });
  const fullName = `${patient.first_name} ${patient.last_name}`;

  await authenticate(page, "staff");
  await page.goto(`/src/pages/patient-dashboard.html?patient=${encodeURIComponent(fullName)}`);

  const dashboard = new PatientDashboardPage(page);
  await dashboard.expectLoaded(fullName);
  await expect(page.locator("#patient-clinical-section")).toBeVisible();

  await dashboard.createTreatmentPlan({
    title: `${TEST_PREFIX} plan`,
    procedure: `${TEST_PREFIX} implant`,
    price: "620"
  });
  await dashboard.createPerioChart({ tooth: "16", pocket: "6" });
  await dashboard.createInvoice({ description: `${TEST_PREFIX} invoice item`, price: "210" });
  await dashboard.createInsuranceClaim({ provider: `${TEST_PREFIX} Insurance`, amount: "210" });
});
