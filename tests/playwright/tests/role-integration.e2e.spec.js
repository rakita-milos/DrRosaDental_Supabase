const { test, expect } = require("@playwright/test");
const { authenticate } = require("../utils/auth");
const { cleanupRegressionData } = require("../utils/cleanup");
const { createPatientWithRecord, createCodebookItem } = require("../utils/api");
const { AllRecordsPage } = require("../pages/AllRecordsPage");
const { NewEntryPage } = require("../pages/NewEntryPage");
const { DirectorPanelPage } = require("../pages/DirectorPanelPage");

const TEST_PREFIX = "ROLEFLOW";

test.beforeEach(async ({ page, request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
  await page.goto("/src/pages/login.html");
  await page.evaluate(() => localStorage.clear());
});

test.afterEach(async ({ request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
});

test("staff-created patient and visit are visible to director reports", async ({ page, request, baseURL }) => {
  const stamp = Date.now();
  const { fullName } = await createPatientWithRecord(request, baseURL, {
    patient: {
      firstName: `${TEST_PREFIX}Staff${stamp}`,
      lastName: "Visible",
      email: `${TEST_PREFIX.toLowerCase()}.staff.${stamp}@example.com`
    },
    record: {
      visitDate: "2026-05-11",
      procedure: "Kontrola",
      amount: 345,
      currency: "RSD",
      paymentStatus: "Dugovanje",
      note: `${TEST_PREFIX} staff creates director sees`
    }
  }, "staff");

  await authenticate(page, "director");
  const directorPanel = new DirectorPanelPage(page);
  await directorPanel.goto();

  await directorPanel.openReport("financial-report", "#payment-table");
  await expect(page.locator("#payment-table")).toContainText(fullName);
  await expect(page.locator("#payment-table")).toContainText("345.00 RSD");
  await directorPanel.backToReports("financial-report");

  await directorPanel.openReport("patients-report", "#patients-table");
  await expect(page.locator("#patients-table")).toContainText(fullName);
  await expect(page.locator("#patients-table")).toContainText("Dugovanje");
  await directorPanel.backToReports("patients-report");

  await directorPanel.openReport("procedures-report", "#procedures-table");
  await expect(page.locator("#procedures-table")).toContainText("Kontrola");
});

test("director-created patient and visit are visible to staff work screens", async ({ page, request, baseURL }) => {
  const stamp = Date.now();
  const { fullName } = await createPatientWithRecord(request, baseURL, {
    patient: {
      firstName: `${TEST_PREFIX}Director${stamp}`,
      lastName: "Visible",
      email: `${TEST_PREFIX.toLowerCase()}.director.${stamp}@example.com`
    },
    record: {
      visitDate: "2026-05-11",
      procedure: "Plomba",
      amount: 210,
      currency: "EUR",
      paymentStatus: "Placeno",
      note: `${TEST_PREFIX} director creates staff sees`
    }
  }, "director");

  await authenticate(page, "staff");
  const allRecords = new AllRecordsPage(page);
  await allRecords.goto();
  await allRecords.filterByPatient(fullName);
  await allRecords.expectPatientVisible(fullName);

  await allRecords.openPatient(fullName);
  await expect(page.locator("#patient-records-body")).toContainText("Plomba");
  await expect(page.locator("#patient-records-body")).toContainText("210.00 EUR");
});

test("director codebook changes become available to staff entry workflow", async ({ page, request, baseURL }) => {
  const stamp = Date.now();
  const activityName = `${TEST_PREFIX} Delatnost ${stamp}`;
  const procedureName = `${TEST_PREFIX} Procedura ${stamp}`;

  await createCodebookItem(request, baseURL, {
    type: "activity",
    value: activityName,
    label: activityName,
    sortOrder: 90,
    isActive: true,
    metadata: {}
  });
  await createCodebookItem(request, baseURL, {
    type: "procedure",
    value: procedureName,
    label: procedureName,
    groupName: activityName,
    price: 99,
    sortOrder: 91,
    isActive: true,
    metadata: {}
  });

  await authenticate(page, "staff");
  const newEntry = new NewEntryPage(page);
  await newEntry.goto();
  await newEntry.activity.selectOption({ label: activityName });
  await expect(newEntry.procedure).toBeEnabled();
  await newEntry.procedure.selectOption({ label: procedureName });
  await expect(newEntry.procedure).toHaveValue(procedureName);
  await expect.poll(async () => page.evaluate((name) => window.DrRosaProcedureCatalog.getPrice(name), procedureName)).toBe(99);
});
