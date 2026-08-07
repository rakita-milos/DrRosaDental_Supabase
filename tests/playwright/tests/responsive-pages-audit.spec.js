const { test, expect } = require("@playwright/test");
const { authenticate } = require("../utils/auth");
const { apiGet } = require("../utils/api");

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 390, height: 844 }
];

function layoutAudit() {
  const viewportWidth = window.innerWidth;
  const isVisible = element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const label = element => (element.getAttribute("aria-label")
    || element.getAttribute("title")
    || element.textContent
    || element.value
    || element.id
    || element.name
    || element.tagName)
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
  const controls = Array.from(document.querySelectorAll("a,button,input,select,textarea,[role='button'],[title],[data-tooltip],[aria-describedby]"))
    .filter(isVisible)
    .filter(element => !element.classList.contains("custom-select-native"));
  const offscreenControls = controls.map(element => {
    const rect = element.getBoundingClientRect();
    return rect.left < -2 || rect.right > viewportWidth + 2
      ? {
        tag: element.tagName.toLowerCase(),
        id: element.id || "",
        text: label(element),
        left: Math.round(rect.left),
        right: Math.round(rect.right)
      }
      : null;
  }).filter(Boolean);

  return {
    path: location.pathname + location.search,
    overflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - viewportWidth,
    offscreenControls,
    mobileToggleVisible: Boolean(document.querySelector(".mobile-menu-toggle") && isVisible(document.querySelector(".mobile-menu-toggle"))),
    navVisible: Boolean(document.querySelector(".topbar nav") && isVisible(document.querySelector(".topbar nav"))),
    topbarActionsVisible: Boolean(document.querySelector(".topbar-actions") && isVisible(document.querySelector(".topbar-actions")))
  };
}

test("all main pages keep responsive layout and mobile menu usable", async ({ page, request, baseURL }) => {
  test.setTimeout(180_000);
  const patients = await apiGet(request, baseURL, "/api/patients", "director");
  const patientId = patients?.[0]?.id || 1;
  const pages = [
    { name: "Login", url: "/src/pages/login.html", auth: false },
    { name: "Kontrolna tabla", url: "/src/pages/index.html", auth: true },
    { name: "Kalendar", url: "/src/pages/calendar.html", auth: true },
    { name: "Novi unos", url: "/src/pages/new-entry.html", auth: true },
    { name: "Novi pacijent", url: "/src/pages/new-patient.html", auth: true },
    { name: "Evidencija", url: "/src/pages/all-records.html", auth: true },
    { name: "Karton pacijenta", url: `/src/pages/patient-dashboard.html?patientId=${patientId}`, auth: true },
    { name: "Direktor panel", url: "/src/pages/director-panel.html", auth: true },
    { name: "Online zakazivanje", url: "/src/pages/public-booking.html", auth: false }
  ];

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const target of pages) {
      if (target.auth) {
        await authenticate(page, "director");
      } else {
        await page.context().clearCookies();
        await page.goto("/src/pages/login.html", { waitUntil: "domcontentloaded" }).catch(() => {});
        await page.evaluate(() => localStorage.clear()).catch(() => {});
      }
      await page.goto(target.url, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(250);

      const beforeMenu = await page.evaluate(layoutAudit);
      expect(beforeMenu.overflowX, `${target.name} ${viewport.name} should not create page overflow`).toBeLessThanOrEqual(2);
      expect(beforeMenu.offscreenControls, `${target.name} ${viewport.name} controls should stay inside viewport`).toEqual([]);

      if (beforeMenu.mobileToggleVisible) {
        await page.locator(".mobile-menu-toggle").click();
        await page.waitForTimeout(200);
        const afterMenu = await page.evaluate(layoutAudit);
        expect(afterMenu.overflowX, `${target.name} ${viewport.name} open menu should not create page overflow`).toBeLessThanOrEqual(2);
        expect(afterMenu.offscreenControls, `${target.name} ${viewport.name} open menu controls should stay inside viewport`).toEqual([]);
        expect(afterMenu.navVisible, `${target.name} ${viewport.name} nav should open`).toBeTruthy();
        expect(afterMenu.topbarActionsVisible, `${target.name} ${viewport.name} actions should open`).toBeTruthy();
      }
    }
  }
});
