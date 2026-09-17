const { test, expect } = require("@playwright/test");
const { authenticate, tokenFor } = require("../utils/auth");
const { cleanupRegressionData } = require("../utils/cleanup");
const { apiGet, createPatient } = require("../utils/api");

const TEST_PREFIX = "WFSMOKE";

function nextDayIso() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

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
  await expect(page.locator("#patient-appointment-panel")).toBeVisible();
  await expect(page.locator("#patient-appointment-context")).toContainText(fullName);
  const appointmentDate = nextDayIso();
  const appointmentDateDisplay = appointmentDate.split("-").reverse().join(".");
  const appointmentTitle = `${TEST_PREFIX} appointment ${stamp}`;
  await expect(page.locator("#patient-appointment-procedure option")).not.toHaveCount(0);
  await page.locator('[data-drrosa-for="patient-appointment-date"]').fill(appointmentDateDisplay);
  await page.locator('[data-drrosa-for="patient-appointment-date"]').press("Tab");
  await page.locator('[data-drrosa-for="patient-appointment-time"]').fill("10:15");
  await page.locator('[data-drrosa-for="patient-appointment-time"]').press("Tab");
  await page.locator("#patient-appointment-title").fill(appointmentTitle);
  await page.locator("#patient-appointment-duration").selectOption("30", { force: true });
  await page.locator("#patient-appointment-procedure").selectOption({ index: 1 }, { force: true });
  await page.locator("#patient-appointment-notes").fill(appointmentTitle);
  const appointmentSaved = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/appointments"
    && response.request().method() === "POST"
    && response.ok()
  );
  await page.locator("#patient-appointment-form button[type='submit']").click();
  await appointmentSaved;
  const followingDate = new Date(`${appointmentDate}T00:00:00.000Z`);
  followingDate.setUTCDate(followingDate.getUTCDate() + 1);
  const appointments = await apiGet(request, baseURL, `/api/appointments?from=${appointmentDate}T00:00:00.000Z&to=${followingDate.toISOString()}`, "staff");
  expect(appointments.some(appointment =>
    appointment.patientId === patient.id
    && appointment.procedureName === appointmentTitle
    && appointment.notes === appointmentTitle
  )).toBe(true);

  await page.goto(`/src/pages/new-entry.html?patientId=${patient.id}`);
  await expect(page.locator("#entry-patient-context")).toContainText(fullName);
  await page.locator('[data-drrosa-for="last-visit"]').fill("24.07.2026");
  await page.locator('[data-drrosa-for="last-visit"]').press("Tab");
  await page.locator("#toggle-procedure-fallback").click();
  await page.locator("#procedure-activity").selectOption({ index: 1 }, { force: true });
  await expect(page.locator("#procedure")).toBeEnabled();
  await page.locator("#procedure").selectOption({ index: 1 }, { force: true });
  const procedureName = await page.locator("#procedure option:checked").textContent();
  await page.locator("#total-amount").evaluate((input, value) => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, "100");
  await page.locator("#add-payment-part").click();
  await page.locator(".payment-part-row").first().locator(".payment-part-amount").fill("40");
  await expect(page.locator("#payment-status-display")).toContainText(/Delimi|Dug|Pla/);
  await expect(page.locator("#payment-debt-display")).toContainText(/60/);
  await page.locator("#note").fill(`${TEST_PREFIX} visit ${stamp}`);
  await page.getByRole("button", { name: /Sa.uvaj unos/i }).click();
  await expect(page).toHaveURL(/patient-dashboard\.html/);
  await expect(page.locator("#patient-activity-timeline")).toContainText(procedureName.trim());

  const recordsResponse = await request.get(`${baseURL}/api/records`, {
    headers: { Authorization: `Bearer ${tokenFor("staff")}` }
  });
  expect(recordsResponse.ok()).toBeTruthy();
  const records = await recordsResponse.json();
  expect(records.some(record => record.patient_id === patient.id || record.patientId === patient.id)).toBeTruthy();
});
