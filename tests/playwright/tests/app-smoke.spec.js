const { test, expect } = require("@playwright/test");
const { authenticate } = require("../utils/auth");

const STAFF_PAGES = [
  { path: "/src/pages/index.html", heading: /Dr Rosa|Moderna klinika/i },
  { path: "/src/pages/calendar.html", heading: /Kalendar termina/i },
  { path: "/src/pages/new-entry.html", heading: /Dodaj pregled/i },
  { path: "/src/pages/new-patient.html", heading: /Unos novog pacijenta/i },
  { path: "/src/pages/all-records.html", heading: /Pregled svih zapisa/i }
];

const DIRECTOR_PAGES = [
  ...STAFF_PAGES,
  { path: "/src/pages/director-panel.html", heading: /Direktor panel/i }
];

test.beforeEach(async ({ page }) => {
  await page.goto("/src/pages/login.html");
  await page.evaluate(() => localStorage.clear());
});

test("public booking page loads without authentication", async ({ page }) => {
  await page.goto("/src/pages/public-booking.html");
  await expect(page.getByRole("heading", { name: /Zakazivanje termina/i })).toBeVisible();
  await expect(page.locator("#public-booking-form")).toBeVisible();
  await expect(page.locator("#booking-first-name")).toBeVisible();
  await expect(page.locator("#booking-slot")).toBeVisible();
});

test.describe("page smoke by role", () => {
  for (const entry of STAFF_PAGES) {
    test(`staff can load ${entry.path}`, async ({ page }) => {
      await authenticate(page, "staff");
      await page.goto(entry.path);
      await expect(page.locator("body")).toContainText(entry.heading);
      await expect(page.locator("body")).not.toContainText(/Cannot|Failed to load|Server error/i);
    });
  }

  for (const entry of DIRECTOR_PAGES) {
    test(`director can load ${entry.path}`, async ({ page }) => {
      await authenticate(page, "director");
      await page.goto(entry.path);
      await expect(page.locator("body")).toContainText(entry.heading);
      await expect(page.locator("body")).not.toContainText(/Cannot|Failed to load|Server error/i);
    });
  }
});

test("unauthenticated users are redirected away from protected pages", async ({ page }) => {
  for (const entry of DIRECTOR_PAGES) {
    await page.evaluate(() => localStorage.clear()).catch(() => {});
    await page.goto(entry.path);
    await expect(page).toHaveURL(/login\.html/);
  }
});

test("staff and director navigation expose the right role surface", async ({ page }) => {
  await authenticate(page, "staff");
  await page.goto("/src/pages/index.html");
  await expect(page.locator("#director-panel-link")).toBeHidden();
  await page.goto("/src/pages/director-panel.html");
  await expect(page).toHaveURL(/index\.html/);

  await authenticate(page, "director");
  await page.goto("/src/pages/index.html");
  await expect(page.locator("#director-panel-link")).toBeVisible();
  await page.locator("#director-panel-link").click();
  await expect(page).toHaveURL(/director-panel\.html/);
  await expect(page.getByRole("heading", { name: /Direktor panel/i })).toBeVisible();
});

test("director admin codebooks expose all expected sections", async ({ page }) => {
  await authenticate(page, "director");
  await page.goto("/src/pages/director-panel.html");
  await page.locator('[data-report-id="admin-codebooks-report"]').click();

  const sections = ["Delatnosti", "Postupci", "Statusi posete", "Statusi placanja", "Valute", "Smene"];
  for (const section of sections) {
    await expect(page.locator("#codebook-grid")).toContainText(section);
  }
});
