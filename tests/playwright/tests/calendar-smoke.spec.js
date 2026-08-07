const { test, expect } = require("@playwright/test");
const { authenticate } = require("../utils/auth");
const { cleanupRegressionData } = require("../utils/cleanup");
const { createPatient } = require("../utils/api");

const TEST_PREFIX = "CALSMOKE";

test.beforeEach(async ({ request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
});

test.afterEach(async ({ request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
});

test("smoke: authorized user creates appointment from calendar page and sees it on the week board", async ({ page, request, baseURL }) => {
  const stamp = Date.now();
  const fullName = `${TEST_PREFIX}${stamp} Patient`;
  await createPatient(request, baseURL, {
    firstName: `${TEST_PREFIX}${stamp}`,
    lastName: "Patient",
    email: `${TEST_PREFIX.toLowerCase()}.${stamp}@example.com`
  }, "director");

  await authenticate(page, "director");
  await page.goto("/src/pages/calendar.html");
  await expect(page.locator("#calendar-board")).toBeVisible();
  await expect(page.locator("#appointment-panel")).toBeHidden();
  await page.locator("#calendar-view").selectOption("day");
  await page.locator("#today-btn").click();
  const appointmentDate = await page.locator(".day-chair-board").getAttribute("data-date");

  await expect(page.locator("#calendar-board")).toHaveClass(/calendar-board-day/);
  await expect(page.locator(".day-chair-column").first()).toBeVisible();
  await page.locator("#calendar-view").selectOption("month");
  await expect(page.locator("#calendar-board")).toHaveClass(/calendar-board-month/);
  await page.locator("#calendar-view").selectOption("week");
  await expect(page.locator("#calendar-board")).toHaveClass(/calendar-board-week/);

  await page.getByRole("button", { name: /Novi termin/i }).click();
  await expect(page.locator("#appointment-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: /Otka[zž]i termin/i })).toBeHidden();
  await page.locator("#appointment-patient").selectOption({ label: fullName });
  const [year, month, day] = appointmentDate.split("-");
  await page.locator('[data-drrosa-for="appointment-date"]').fill(`${day}.${month}.${year}`);
  await page.locator('[data-drrosa-for="appointment-time"]').fill("10:15");
  await page.locator("#appointment-duration").selectOption("45");
  await page.locator("#appointment-procedure").selectOption({ label: "Kontrola" });
  await page.locator("#appointment-notes").fill(`${TEST_PREFIX} UI smoke appointment`);
  await page.locator('#appointment-form button[type="submit"]').click();

  await expect(page.locator("#appointment-alert")).toContainText(/Termin je sa[cč]uvan/i);
  await expect(page.locator("#calendar-board")).toContainText(`${TEST_PREFIX}${stamp} P.`);
  await expect(page.locator("#calendar-board")).toContainText("10:15-11:00");
  await expect(page.locator(".week-grid")).toBeVisible();

  await page.getByRole("button", { name: /Odustani/i }).click();
  await expect(page.locator("#appointment-panel")).toBeHidden();
  await page.getByRole("button", { name: new RegExp(`${TEST_PREFIX}${stamp} P\\.`) }).click();
  await expect(page.locator("#create-visit-btn")).toBeEnabled();
  await expect(page.getByRole("button", { name: /Otka[zž]i termin/i })).toBeEnabled();
  await page.getByRole("button", { name: /Odustani/i }).click();
  await expect(page.locator("#appointment-panel")).toBeHidden();
  await expect(page.locator("#calendar-board")).toContainText(`${TEST_PREFIX}${stamp} P.`);

  await page.locator("#calendar-view").selectOption("month");
  await expect(page.locator(".appointment-compact").first()).toBeVisible();
  await page.locator("#calendar-view").selectOption("day");
  await page.locator("#today-btn").click();
  await expect(page.locator(".day-chair-board")).toBeVisible();
  await expect(page.locator(".day-chair-board")).toContainText(fullName);

  await page.getByRole("button", { name: fullName }).click();
  await page.getByRole("button", { name: /Otka[zž]i termin/i }).click();
  await expect(page.locator("#appointment-panel")).toBeHidden();
  await expect(page.locator("#calendar-board")).not.toContainText(fullName);
});
