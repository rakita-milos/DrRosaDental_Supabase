const { test, expect } = require("@playwright/test");
const { authenticate, tokenFor } = require("../utils/auth");
const { cleanupRegressionData } = require("../utils/cleanup");
const { createPatient } = require("../utils/api");

const TEST_PREFIX = "WFSMOKE";

test.beforeEach(async ({ request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
});

test.afterEach(async ({ request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
});

test("smoke: patient card links into appointment and visit payment workflow", async ({ page, request, baseURL }) => {
  const stamp = Date.now();
  const patient = await createPatient(request, baseURL, {
    firstName: `${TEST_PREFIX}${stamp}`,
    lastName: "Patient",
    email: `${TEST_PREFIX.toLowerCase()}.${stamp}@example.com`
  }, "staff");
  const fullName = `${TEST_PREFIX}${stamp} Patient`;

  await authenticate(page, "staff");
  await page.goto(`/src/pages/patient-dashboard.html?patientId=${patient.id}`);
  await expect(page.locator("#patient-name-title")).toContainText(fullName);
  await expect(page.locator("#patient-workspace")).toBeVisible();

  await page.locator("#schedule-patient-link").click();
  await expect(page).toHaveURL(/calendar\.html/);
  await expect(page.locator("#appointment-panel")).toBeVisible();
  await expect(page.locator("#appointment-patient-context")).toContainText(fullName);
  await page.locator('[data-drrosa-for="appointment-date"]').fill("24.07.2026");
  await page.locator('[data-drrosa-for="appointment-time"]').fill("10:15");
  await page.locator("#appointment-duration").selectOption("30");
  await page.locator("#appointment-procedure").selectOption({ label: "Kontrola" });
  await page.locator("#appointment-notes").fill(`${TEST_PREFIX} appointment ${stamp}`);
  await page.locator("#appointment-form button[type='submit']").click();
  await expect(page.locator("#appointment-alert")).toContainText(/Termin je/);

  await page.goto(`/src/pages/new-entry.html?patientId=${patient.id}`);
  await expect(page.locator("#entry-patient-context")).toContainText(fullName);
  await page.locator('[data-drrosa-for="last-visit"]').fill("24.07.2026");
  await page.locator("#procedure-activity").selectOption({ index: 1 });
  await expect(page.locator("#procedure")).toBeEnabled();
  await page.locator("#procedure").selectOption({ label: "Kontrola" });
  await page.locator("#status").selectOption({ index: 2 });
  await page.locator("#currency").selectOption("EUR");
  await page.locator("#total-amount").fill("100");
  await page.locator("#add-payment-part").click();
  await page.locator(".payment-part-row").first().locator(".payment-part-amount").fill("40");
  await expect(page.locator("#payment-status-display")).toContainText(/Delimi|Dug|Pla/);
  await expect(page.locator("#payment-debt-display")).toContainText(/60/);
  await page.locator("#note").fill(`${TEST_PREFIX} visit ${stamp}`);
  await page.getByRole("button", { name: /Sa.uvaj unos/i }).click();
  await expect(page).toHaveURL(/patient-dashboard\.html/);
  await expect(page.locator("#patient-activity-timeline")).toContainText("Kontrola");

  const recordsResponse = await request.get(`${baseURL}/api/records`, {
    headers: { Authorization: `Bearer ${tokenFor("staff")}` }
  });
  expect(recordsResponse.ok()).toBeTruthy();
  const records = await recordsResponse.json();
  expect(records.some(record => record.patient_id === patient.id || record.patientId === patient.id)).toBeTruthy();
});
