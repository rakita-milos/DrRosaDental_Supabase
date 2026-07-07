const { test, expect } = require("@playwright/test");
const { authenticate, tokenFor } = require("../utils/auth");
const { cleanupRegressionData } = require("../utils/cleanup");
const { createPatient } = require("../utils/api");

const TEST_PREFIX = "E2ENewEntry";

test.beforeEach(async ({ page, request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
  await page.goto("/src/pages/login.html");
  await page.evaluate(() => localStorage.clear());
});

test.afterEach(async ({ request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
});

async function createTestPatient(request, baseURL, stamp, suffix = "Patient") {
  const patient = {
    firstName: `${TEST_PREFIX}${stamp}`,
    lastName: suffix,
    email: `e2e.new-entry.${stamp}.${suffix.toLowerCase()}@example.com`
  };
  await createPatient(request, baseURL, patient, "staff");
  return `${patient.firstName} ${patient.lastName}`;
}

async function gotoNewEntry(page, fullName) {
  await authenticate(page, "staff");
  await page.goto(`/src/pages/new-entry.html?patient=${encodeURIComponent(fullName)}`);
  await expect(page.locator("#patient-name")).toHaveValue(fullName);
  await expect(page.locator("#procedure-activity")).toBeEnabled();
}

async function fillBasicVisit(page, { note, date = "2026-07-06", total = "120" } = {}) {
  await page.locator("#last-visit").fill(date);
  await page.locator("#procedure-activity").selectOption({ index: 1 });
  await expect(page.locator("#procedure")).toBeEnabled();
  await page.locator("#procedure").selectOption({ label: "Kontrola" });
  await page.locator("#status").selectOption({ index: 2 });
  await page.locator("#doctor").selectOption({ index: 0 });
  await page.locator("#shift").selectOption({ index: 0 });
  await page.locator("#currency").selectOption("EUR");
  await page.locator("#total-amount").fill(total);
  await page.locator("#note").fill(note);
}

async function expectRecordWithNote(request, baseURL, fullName, note) {
  const response = await request.get(`${baseURL}/api/records`, {
    headers: { Authorization: `Bearer ${tokenFor("staff")}` }
  });
  expect(response.ok()).toBeTruthy();
  const records = await response.json();
  expect(records.some(record =>
    `${record.first_name || ""} ${record.last_name || ""}`.trim() === fullName
    && record.notes === note
  )).toBeTruthy();
}

test("new entry: saves a fully populated visit without selecting teeth", async ({ page, request, baseURL }) => {
  const stamp = Date.now();
  const fullName = await createTestPatient(request, baseURL, stamp);
  const note = `${TEST_PREFIX} no tooth save ${stamp}`;

  await gotoNewEntry(page, fullName);
  await fillBasicVisit(page, { note });
  await expect(page.locator(".tooth-node.selected")).toHaveCount(0);

  await page.route("**/api/records", async route => {
    if (route.request().method() === "POST") {
      await page.waitForTimeout(250);
    }
    await route.continue();
  });

  await page.locator("#new-entry-form button[type='submit']").click();
  await expect(page.locator("#save-status")).toContainText(/Čuvanje|Cuvanje/i);
  await expect(page.locator("#save-status")).toContainText(/Unos je spremljen|Unos je sa/i);
  await expectRecordWithNote(request, baseURL, fullName, note);
});

test("new entry: explains why save is blocked when no procedure or tooth treatment is selected", async ({ page, request, baseURL }) => {
  const stamp = Date.now();
  const fullName = await createTestPatient(request, baseURL, stamp, "Validation");

  await gotoNewEntry(page, fullName);
  await page.locator("#last-visit").fill("2026-07-06");
  await page.locator("#doctor").selectOption({ index: 0 });
  await page.locator("#shift").selectOption({ index: 0 });
  await page.locator("#total-amount").fill("30");

  await page.locator("#new-entry-form button[type='submit']").click();
  await expect(page.locator("#save-status")).toContainText(/odaberite osnovnu delatnost|postupak|mapi zuba/i);
});

test("new entry: tooth map treatment can be added and saved", async ({ page, request, baseURL }) => {
  const stamp = Date.now();
  const fullName = await createTestPatient(request, baseURL, stamp, "Tooth");
  const note = `${TEST_PREFIX} tooth map save ${stamp}`;

  await gotoNewEntry(page, fullName);
  await page.locator(".tooth-node[data-tooth='11']").click();
  await expect(page.locator("#tooth-treatment-panel")).toBeVisible();
  await page.locator("#treatment-activity").selectOption({ index: 1 });
  await expect(page.locator("#treatment-type")).toBeEnabled();
  await page.locator("#treatment-type").selectOption({ label: "Kontrola" });
  await page.locator("#treatment-note").fill("Rad na zubu 11");
  await page.locator("#save-treatment").click();
  await expect(page.locator("#teeth-summary")).toContainText(/Zub 11|Kontrola/);

  await page.locator("#last-visit").fill("2026-07-06");
  await page.locator("#status").selectOption({ index: 2 });
  await page.locator("#doctor").selectOption({ index: 0 });
  await page.locator("#shift").selectOption({ index: 0 });
  await page.locator("#currency").selectOption("EUR");
  await page.locator("#note").fill(note);

  await page.locator("#new-entry-form button[type='submit']").click();
  await expect(page.locator("#save-status")).toContainText(/Unos je spremljen|Unos je sa/i);
  await expectRecordWithNote(request, baseURL, fullName, note);
});

test("new entry: split payments update preview and can be removed", async ({ page, request, baseURL }) => {
  const stamp = Date.now();
  const fullName = await createTestPatient(request, baseURL, stamp, "Payments");
  const note = `${TEST_PREFIX} payment builder ${stamp}`;

  await gotoNewEntry(page, fullName);
  await fillBasicVisit(page, { note, total: "100" });

  await page.locator("#add-payment-part").click();
  await page.locator(".payment-part-row").nth(0).locator(".payment-part-amount").fill("40");
  await expect(page.locator("#payment-paid-display")).toContainText(/40/);
  await expect(page.locator("#payment-debt-display")).toContainText(/60/);
  await expect(page.locator("#preview-payment-parts")).toContainText(/40/);

  await page.locator(".payment-part-remove").click();
  await expect(page.locator(".payment-part-row")).toHaveCount(0);
  await expect(page.locator("#payment-paid-display")).toContainText(/0/);
  await expect(page.locator("#payment-debt-display")).toContainText(/100/);
});
