const { test, expect } = require("@playwright/test");
const { authenticate } = require("../utils/auth");
const { cleanupRegressionData } = require("../utils/cleanup");
const { createCodebookItem, createPatient, createPatientWithRecord } = require("../utils/api");
const { NewEntryPage } = require("../pages/NewEntryPage");
const { AllRecordsPage } = require("../pages/AllRecordsPage");
const { PatientDashboardPage } = require("../pages/PatientDashboardPage");

const TEST_PREFIX = "E2E";

test.beforeEach(async ({ page, request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
  await page.goto("/src/pages/login.html");
  await page.evaluate(() => localStorage.clear());
});

test.afterEach(async ({ request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
});

test("regression: staff cannot open director admin area", async ({ page }) => {
  await authenticate(page, "staff");
  await page.goto("/src/pages/director-panel.html");
  await expect(page).toHaveURL(/index\.html/);
  await expect(page).not.toHaveURL(/director-panel\.html/);
});

test("regression: filtered records export uses visible filtered rows", async ({ page, request, baseURL }) => {
  await authenticate(page, "staff");

  const stamp = Date.now();
  const { fullName } = await createPatientWithRecord(request, baseURL, {
    patient: {
      firstName: `${TEST_PREFIX}Export${stamp}`,
      lastName: "Patient",
      email: `e2e.export.${stamp}@example.test`
    },
    record: {
      procedure: "Kontrola",
      status: "Zavrseno",
      paymentStatus: "Dugovanje",
      amount: 120,
      note: `${TEST_PREFIX} filtered export cleanup`
    }
  }, "staff");

  const allRecords = new AllRecordsPage(page);

  await allRecords.goto();
  await allRecords.filterByPatient(fullName);
  await allRecords.filterByPaymentStatus("Dugovanje");
  await allRecords.expectPatientVisible(fullName);
  await allRecords.exportFilteredTable();
});

test("regression: director-created procedure is available in visit entry and cleans up", async ({ page, request, baseURL }) => {
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
    price: 88,
    sortOrder: 91,
    isActive: true,
    metadata: {}
  });

  await authenticate(page, "staff");
  const patient = {
    firstName: `${TEST_PREFIX}Proc${stamp}`,
    lastName: "Patient",
    email: `e2e.proc.${stamp}@example.test`
  };
  const fullName = `${patient.firstName} ${patient.lastName}`;
  await createPatient(request, baseURL, patient, "staff");

  const newEntry = new NewEntryPage(page);
  const allRecords = new AllRecordsPage(page);
  const patientDashboard = new PatientDashboardPage(page);

  await newEntry.goto(null, fullName);
  await newEntry.fillVisit({
    patientName: fullName,
    activityLabel: activityName,
    procedureLabel: procedureName,
    note: `${TEST_PREFIX} custom procedure cleanup`
  });
  await newEntry.save();
  await expect(newEntry.alert).toContainText(/Unos je spremljen/i);

  await allRecords.goto();
  await allRecords.openPatient(fullName);
  await patientDashboard.expectRecordVisible(procedureName);
  await patientDashboard.deleteFirstRecord();
  await expect(patientDashboard.recordsBody).toContainText(/Nema zapisa/i);
  await patientDashboard.deleteCurrentPatient();
});
