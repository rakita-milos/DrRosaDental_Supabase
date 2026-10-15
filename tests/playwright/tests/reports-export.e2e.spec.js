const { test, expect } = require("@playwright/test");
const { authenticate } = require("../utils/auth");
const { cleanupRegressionData } = require("../utils/cleanup");
const { createPatientWithRecord, createPatient, createRecord, apiGet } = require("../utils/api");
const { expectDownloadedExcelContains, expectPdfPopupContains } = require("../utils/exports");
const { AllRecordsPage } = require("../pages/AllRecordsPage");
const { DirectorPanelPage } = require("../pages/DirectorPanelPage");

const TEST_PREFIX = "EXPORTCHECK";

test('financial report keeps partial payments, currencies and same-name patients distinct in UI and exports', async ({ page, request, baseURL }, testInfo) => {
  const stamp = Date.now();
  const firstName = `${TEST_PREFIX}${stamp}`;
  const one = await createPatient(request, baseURL, { firstName, lastName: 'SameName', birthDate: '1980-01-01', phone: '0601112233', email: `one.${stamp}@example.com` });
  const two = await createPatient(request, baseURL, { firstName, lastName: 'SameName', birthDate: '1990-01-01', phone: '0601112244', email: `two.${stamp}@example.com` });
  const procedure = `${TEST_PREFIX} procedure ${stamp}`;
  await createRecord(request, baseURL, { patientId: one.id, procedure, currency: 'RSD', amount: 600, totalAmount: 1000, paymentParts: [{ amount: 400, currency: 'RSD' }], note: `${TEST_PREFIX} partial` });
  await createRecord(request, baseURL, { patientId: two.id, procedure, currency: 'EUR', amount: 60, totalAmount: 100, paymentParts: [{ amount: 40, currency: 'EUR', exchangeRateToRsd: 117 }], note: `${TEST_PREFIX} euro` });
  await authenticate(page, 'director');
  const panel = new DirectorPanelPage(page); await panel.goto();
  const report = await apiGet(request, baseURL, '/api/director/reports/financial', 'director');
  const revenueText = Object.entries(report.revenueByCurrency).filter(([, value]) => value > 0).map(([currency, value]) => `${value.toFixed(2)} ${currency}`).join(' / ');
  await expect(page.locator('#director-kpi-revenue')).toHaveText(revenueText);
  await panel.openReport('financial-report', '#payment-table');
  const rowOne = page.locator(`#payment-table tr[data-patient-id="${one.id}"]`);
  const rowTwo = page.locator(`#payment-table tr[data-patient-id="${two.id}"]`);
  await expect(rowOne.locator('td').nth(2)).toHaveText('1000.00 RSD');
  await expect(rowOne.locator('td').nth(3)).toHaveText('400.00 RSD');
  await expect(rowOne.locator('td').nth(4)).toHaveText('600.00 RSD');
  await expect(rowOne.locator('td').nth(5)).toHaveText('40.0%');
  await expect(rowTwo.locator('td').nth(3)).toHaveText('40.00 EUR');
  await expect(rowTwo.locator('td').nth(4)).toHaveText('60.00 EUR');
  await expect(page.locator('#total-revenue')).toHaveText(revenueText);
  await expect(page.locator('#financial-report .financial-summary')).toBeVisible();
  expect(await page.locator('#financial-report .financial-summary h3, #financial-report .financial-summary .stat-number').evaluateAll(elements =>
    elements.every(element => element.scrollWidth <= element.clientWidth + 1)
  )).toBe(true);
  await page.locator('#financial-report').screenshot({ path: testInfo.outputPath('financial-report.png') });
  const { download, popup } = await panel.exportCurrentReport('financial-report', { closePopup: false });
  await expectDownloadedExcelContains(download, [`(#${one.id})`, `(#${two.id})`, '1000.00 RSD', '400.00 RSD', '600.00 RSD', '40.00 EUR', '60.00 EUR', '40.0%']);
  await expectPdfPopupContains(popup, ['400.00 RSD', '40.00 EUR', '40.0%']); await popup.close();
  await panel.backToReports('financial-report');
  await page.route('**/api/director/reports/financial', route => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Missing rate', code: 'REPORT_RATE_MISSING' }) }));
  await panel.openReport('financial-report', '#payment-table');
  await expect(page.locator('#payment-table [role="alert"]')).toBeVisible();
  await expect(page.locator('#total-revenue')).toHaveText('Nedostupno');
  await expect(page.locator('#financial-report .export-report-excel')).toBeDisabled();
  await page.unroute('**/api/director/reports/financial');
  await page.locator('[data-retry-financial-report]').click();
  await expect(rowOne.locator('td').nth(3)).toHaveText('400.00 RSD');
  await expect(page.locator('#financial-report .export-report-excel')).toBeEnabled();
  await panel.backToReports('financial-report');
  await panel.openReport('procedures-report', '#procedures-table');
  await expect(page.locator('#procedures-table tr').filter({ hasText: procedure })).toContainText('6350.00 RSD');
  await panel.backToReports('procedures-report');
  await page.route('**/api/director/reports/procedures', route => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Missing rate' }) }));
  await panel.openReport('procedures-report', '#procedures-table');
  await expect(page.locator('#procedures-table [role="alert"]')).toBeVisible();
  await expect(page.locator('#procedures-report .export-report-excel')).toBeDisabled();
});

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
  await page.locator("#daily-cash-load").click();
  await expect(page.locator("#daily-cash-debts-table")).toContainText(fullName);

  const { download, popup } = await directorPanel.exportCurrentReport("daily-cash-report", { closePopup: false });
  await expectDownloadedExcelContains(download, ["DUŽNICI", fullName, "Kontrola", "432.00"]);
  await expectPdfPopupContains(popup, ["DUŽNICI", fullName, "Kontrola", "432.00"]);
  await popup.close();
});
