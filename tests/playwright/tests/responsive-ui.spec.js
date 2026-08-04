const { test, expect } = require("@playwright/test");
const { authenticate } = require("../utils/auth");
const { cleanupRegressionData } = require("../utils/cleanup");
const { apiGet, createAppointment, createPatient, createRecord, firstChairId } = require("../utils/api");

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
    document.querySelectorAll(".appointment-compact,.week-appointment,.agenda-appointment,.appointment-card")
  ).map(element => {
    const rect = element.getBoundingClientRect();
    const childLeaks = Array.from(element.children).some(child => (
      child.scrollWidth > child.clientWidth + 2
      || child.getBoundingClientRect().right > rect.right + 2
    ));
    return {
      ok: !childLeaks && element.scrollWidth <= element.clientWidth + 2,
      text: element.textContent.trim().replace(/\s+/g, " ").slice(0, 80)
    };
  }).filter(item => !item.ok));
  expect(leakingEvents).toEqual([]);
}

async function freeAppointmentStart(request, baseURL, role = "director") {
  const chairId = await firstChairId(request, baseURL, role);
  const from = "2026-08-02T00:00:00.000Z";
  const to = "2026-08-08T23:59:59.999Z";
  const appointments = await apiGet(request, baseURL, `/api/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, role);
  const occupied = new Set(appointments
    .filter(appointment => String(appointment.chairId || appointment.chair_id) === String(chairId))
    .map(appointment => new Date(appointment.startsAt || appointment.starts_at).toISOString().slice(0, 16)));

  for (let day = 2; day <= 8; day += 1) {
    for (let hour = 8; hour <= 19; hour += 1) {
      for (const minute of [5, 20, 35, 50]) {
        const startsAt = `2026-08-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
        const key = new Date(startsAt).toISOString().slice(0, 16);
        if (!occupied.has(key)) return { startsAt, chairId };
      }
    }
  }
  throw new Error("No free responsive test slot found");
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
    const freeSlot = await freeAppointmentStart(request, baseURL, "director");
    await createAppointment(request, baseURL, {
      patientId: patient.id,
      chairId: freeSlot.chairId,
      startsAt: freeSlot.startsAt,
      durationMinutes: 30,
      procedure: "Kontrola"
    }, "director");

    await authenticate(page, "director");

    await page.goto("/src/pages/calendar.html");
    await page.locator("#calendar-view").selectOption("week");
    await page.locator("#today-btn").click();
    await expect(page.locator("#calendar-board")).toContainText(TEST_PREFIX);
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
