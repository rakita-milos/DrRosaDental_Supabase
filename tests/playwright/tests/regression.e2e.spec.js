const { test, expect } = require("@playwright/test");
const { authenticate } = require("../utils/auth");
const { cleanupRegressionData } = require("../utils/cleanup");
const { NewPatientPage } = require("../pages/NewPatientPage");
const { NewEntryPage } = require("../pages/NewEntryPage");
const { AllRecordsPage } = require("../pages/AllRecordsPage");
const { PatientDashboardPage } = require("../pages/PatientDashboardPage");
const { DirectorPanelPage } = require("../pages/DirectorPanelPage");

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

test("regression: filtered records export uses visible filtered rows", async ({ page }) => {
  await authenticate(page, "staff");

  const stamp = Date.now();
  const patient = {
    firstName: `${TEST_PREFIX}Export${stamp}`,
    lastName: "Patient",
    email: `e2e.export.${stamp}@example.test`
  };
  const fullName = `${patient.firstName} ${patient.lastName}`;

  const newPatient = new NewPatientPage(page);
  const newEntry = new NewEntryPage(page);
  const allRecords = new AllRecordsPage(page);
  const patientDashboard = new PatientDashboardPage(page);

  await newPatient.goto();
  await newPatient.fillPatient(patient);
  await newPatient.saveAndAcceptDialog("Pacijent sacuvan");

  await newEntry.goto(null, fullName);
  await newEntry.fillVisit({
    patientName: fullName,
    procedureLabel: "Kontrola",
    statusIndex: 3,
    paymentIndex: 1,
    amountDue: 120,
    note: `${TEST_PREFIX} filtered export cleanup`
  });
  await newEntry.save();
  await expect(newEntry.alert).toContainText(/Unos je spremljen/i);

  await allRecords.goto();
  await allRecords.filterByPatient(fullName);
  await allRecords.filterByPaymentStatus("Dugovanje");
  await allRecords.expectPatientVisible(fullName);
  await allRecords.exportFilteredTable();

  await allRecords.openPatient(fullName);
  await patientDashboard.deleteFirstRecord();
  await expect(patientDashboard.recordsBody).toContainText(/Nema zapisa/i);
  await patientDashboard.deleteCurrentPatient();
});

test("regression: director-created procedure is available in visit entry and cleans up", async ({ page }) => {
  await authenticate(page, "director");

  const stamp = Date.now();
  const activityName = `${TEST_PREFIX} Delatnost ${stamp}`;
  const procedureName = `${TEST_PREFIX} Procedura ${stamp}`;

  const directorPanel = new DirectorPanelPage(page);
  await directorPanel.goto();
  await directorPanel.openCodebookAdmin();
  await directorPanel.createActivity(activityName);
  await directorPanel.createProcedure({ name: procedureName, activity: activityName, price: "88" });

  await authenticate(page, "staff");
  const patient = {
    firstName: `${TEST_PREFIX}Proc${stamp}`,
    lastName: "Patient",
    email: `e2e.proc.${stamp}@example.test`
  };
  const fullName = `${patient.firstName} ${patient.lastName}`;

  const newPatient = new NewPatientPage(page);
  const newEntry = new NewEntryPage(page);
  const allRecords = new AllRecordsPage(page);
  const patientDashboard = new PatientDashboardPage(page);

  await newPatient.goto();
  await newPatient.fillPatient(patient);
  await newPatient.saveAndAcceptDialog("Pacijent sacuvan");

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
