const { test, expect } = require("@playwright/test");
const { authenticate } = require("../utils/auth");
const { cleanupRegressionData } = require("../utils/cleanup");
const { createPatientWithRecord } = require("../utils/api");
const { expectDownloadedExcelContains, expectPdfPopupContains } = require("../utils/exports");
const { AllRecordsPage } = require("../pages/AllRecordsPage");
const { DirectorPanelPage } = require("../pages/DirectorPanelPage");

const TEST_PREFIX = "EXPORTCHECK";

test.beforeEach(async ({ page, request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
  await page.goto("/src/pages/login.html");
  await page.evaluate(() => localStorage.clear());
});

test.afterEach(async ({ request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
});

async function createExportFixture(request, baseURL) {
  const stamp = Date.now();
  return createPatientWithRecord(request, baseURL, {
    patient: {
      firstName: `${TEST_PREFIX}${stamp}`,
      lastName: "Patient",
      email: `${TEST_PREFIX.toLowerCase()}.${stamp}@example.com`
    },
    record: {
      visitDate: "2026-05-11",
      procedure: "Kontrola",
      amount: 432,
      currency: "RSD",
      paymentStatus: "Dugovanje",
      shift: "Prva smena",
      note: `${TEST_PREFIX} export data validation`
    }
  }, "staff");
}

test("staff all-records Excel and PDF exports contain filtered application data", async ({ page, request, baseURL }) => {
  const { fullName } = await createExportFixture(request, baseURL);

  await authenticate(page, "staff");
  const allRecords = new AllRecordsPage(page);
  await allRecords.goto();
  await allRecords.filterByPatient(fullName);
  await allRecords.filterByPaymentStatus("Dugovanje");
  await allRecords.expectPatientVisible(fullName);

  const { download, popup } = await allRecords.exportFilteredTable({ closePopup: false });
  await expectDownloadedExcelContains(download, [fullName, "Dugovanje", "RSD", "432.00 RSD"]);
  await expectPdfPopupContains(popup, [fullName, "Dugovanje", "RSD", "432.00 RSD"]);
  await popup.close();
});

test("director financial report exports contain the same cross-role data", async ({ page, request, baseURL }) => {
  const { fullName } = await createExportFixture(request, baseURL);

  await authenticate(page, "director");
  const directorPanel = new DirectorPanelPage(page);
  await directorPanel.goto();
  await directorPanel.openReport("financial-report", "#payment-table");
  await expect(page.locator("#payment-table")).toContainText(fullName);

  const { download, popup } = await directorPanel.exportCurrentReport("financial-report", { closePopup: false });
  await expectDownloadedExcelContains(download, [fullName, "432.00 RSD", "0%"]);
  await expectPdfPopupContains(popup, [fullName, "432.00 RSD", "0%"]);
  await popup.close();
});

test("director Excel-style report export includes monthly Pazari values", async ({ page, request, baseURL }) => {
  await createExportFixture(request, baseURL);

  await authenticate(page, "director");
  const directorPanel = new DirectorPanelPage(page);
  await directorPanel.goto();
  await directorPanel.openReport("excel-report", "#excel-sheet-table");
  await page.locator("#excel-month-select").selectOption("4");
  await page.locator("#excel-year-select").selectOption("2026");
  await expect(page.locator("#excel-sheet-table")).toContainText("432,00");

  const { download, popup } = await directorPanel.exportCurrentReport("excel-report", { closePopup: false });
  await expectDownloadedExcelContains(download, ["PAZARI", "432,00"]);
  await expectPdfPopupContains(popup, ["PAZARI", "432,00"]);
  await popup.close();
});

test("director daily cash export includes debtor details", async ({ page, request, baseURL }) => {
  const { fullName } = await createExportFixture(request, baseURL);

  await authenticate(page, "director");
  const directorPanel = new DirectorPanelPage(page);
  await directorPanel.goto();
  await directorPanel.openReport("daily-cash-report", "#daily-cash-auto-table");
  await page.locator("#daily-cash-date").evaluate((input, value) => {
    input.value = value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, "2026-05-11");
  await page.locator("#daily-cash-shift").selectOption("Prva smena");
  await page.locator("#daily-cash-load").click();
  await expect(page.locator("#daily-cash-debts-table")).toContainText(fullName);

  const { download, popup } = await directorPanel.exportCurrentReport("daily-cash-report", { closePopup: false });
  await expectDownloadedExcelContains(download, ["DUŽNICI", fullName, "Kontrola", "432.00"]);
  await expectPdfPopupContains(popup, ["DUŽNICI", fullName, "Kontrola", "432.00"]);
  await popup.close();
});
