const { test, expect } = require("@playwright/test");
const { authenticate } = require("../utils/auth");
const { cleanupRegressionData } = require("../utils/cleanup");
const { createPatient, createRecord } = require("../utils/api");

const TEST_PREFIX = "RESPUI";
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 390, height: 844 }
];

async function expectNoPageOverflow(page) {
  const overflow = await page.evaluate(() => Math.max(
    document.documentElement.scrollWidth,
    document.body.scrollWidth
  ) - window.innerWidth);
  expect(overflow, `horizontal page overflow should stay within tolerance`).toBeLessThanOrEqual(2);
}

async function expectCalendarEventsStayInsideCards(page) {
  const leakingEvents = await page.evaluate(() => Array.from(
    document.querySelectorAll(".appointment-compact,.week-appointment,.agenda-appointment,.appointment-card,.week-absence-bar,.month-absence-bar,.week-absence-card")
  ).map(element => {
    const rect = element.getBoundingClientRect();
    const childLeaks = Array.from(element.children).some(child => (
      child.getBoundingClientRect().right > rect.right + 2
      || child.getBoundingClientRect().left < rect.left - 2
    ));
    const viewportLeaks = rect.left < -2 || rect.right > window.innerWidth + 2;
    return {
      ok: !viewportLeaks && !childLeaks,
      text: element.textContent.trim().replace(/\s+/g, " ").slice(0, 80)
    };
  }).filter(item => !item.ok));
  expect(leakingEvents).toEqual([]);
}

test.beforeEach(async ({ request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
});

test.afterEach(async ({ request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
});

for (const viewport of VIEWPORTS) {
  test(`responsive layout holds on ${viewport.name}`, async ({ page, request, baseURL }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    const stamp = Date.now();
    const patient = await createPatient(request, baseURL, {
      firstName: `${TEST_PREFIX}${stamp}`,
      lastName: "PacijentSaDugimPrezimenomZaResponsiveProveru",
      email: `${TEST_PREFIX.toLowerCase()}.${stamp}@example.com`
    }, "director");
    await createRecord(request, baseURL, {
      patientId: patient.id,
      visitDate: "2026-08-02",
      procedure: "Kontrola responsive kartice sa duzim tekstom",
      paymentStatus: "Dugovanje",
      amount: 125
    }, "director");
    await authenticate(page, "director");

    await page.goto("/src/pages/calendar.html");
    await page.locator("#calendar-view").selectOption("week");
    await page.locator("#today-btn").click();
    await expect(page.locator("#calendar-board")).toBeVisible();
    await expectNoPageOverflow(page);
    await expectCalendarEventsStayInsideCards(page);

    await page.goto("/src/pages/new-entry.html");
    await expect(page.locator(".entry-step-strip")).toBeVisible();
    await expect(page.locator(".ortomapa")).toBeVisible();
    await expectNoPageOverflow(page);

    await page.goto("/src/pages/all-records.html");
    await expect(page.locator("body")).toContainText(TEST_PREFIX);
    if (viewport.width <= 980) {
      await expect(page.locator(".table-wrap")).toBeHidden();
      await expect(page.locator("#all-records-cards .record-mobile-card").first()).toBeVisible();
    } else {
      await expect(page.locator(".table-wrap")).toBeVisible();
    }
    await expectNoPageOverflow(page);
  });
}
