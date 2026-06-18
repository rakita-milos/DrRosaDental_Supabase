const { test, expect } = require("@playwright/test");
const { authenticate, credentialsFor } = require("../utils/auth");
const { LoginPage } = require("../pages/LoginPage");
const { DashboardPage } = require("../pages/DashboardPage");
const { NewPatientPage } = require("../pages/NewPatientPage");
const { NewEntryPage } = require("../pages/NewEntryPage");
const { AllRecordsPage } = require("../pages/AllRecordsPage");
const { PatientDashboardPage } = require("../pages/PatientDashboardPage");
const { DirectorPanelPage } = require("../pages/DirectorPanelPage");
const { authHeaders } = require("../utils/api");

test.beforeEach(async ({ page }) => {
  await page.goto("/src/pages/login.html");
  await page.evaluate(() => localStorage.clear());
});

async function unlockStaffForLogin(request, baseURL) {
  const staff = credentialsFor("staff");
  const director = credentialsFor("director");
  await request.post(`${baseURL}/api/director/security/users/1/reset-password`, {
    headers: authHeaders("director"),
    data: { newPassword: director.password }
  });
  await request.post(`${baseURL}/api/director/security/users/2/reset-password`, {
    headers: authHeaders("director"),
    data: { newPassword: staff.password }
  });
  await request.post(`${baseURL}/api/director/security/users/2/unlock`, {
    headers: authHeaders("director")
  });
}

test("login smoke test for staff and director roles", async ({ page, request, baseURL }) => {
  await unlockStaffForLogin(request, baseURL);
  const loginPage = new LoginPage(page);

  await loginPage.loginAs("staff");
  await expect(page.locator("body")).toContainText(/Moderna klinika|Evidencija pacijenata/i);
  await page.locator("#logout-btn").click();
  await expect(page).toHaveURL(/login\.html/);

  await loginPage.loginAs("director");
  await expect(page.locator("#reports-grid")).toBeVisible();
});

test("staff navigation smoke test", async ({ page }) => {
  await authenticate(page, "staff");
  const dashboard = new DashboardPage(page);

  await dashboard.goto();
  await dashboard.openNewEntry();
  await expect(page.locator("#new-entry-form")).toBeVisible();

  await dashboard.goto();
  await dashboard.openNewPatient();
  await expect(page.locator("#patient-form")).toBeVisible();

  await dashboard.goto();
  await dashboard.openAllRecords();
  await expect(page.locator("#all-records-body tr").first()).toBeVisible();
});

test("full patient and visit CRUD smoke test", async ({ page }) => {
  await authenticate(page, "staff");

  const stamp = Date.now();
  const patient = {
    firstName: `Smoke${stamp}`,
    lastName: "Playwright",
    birthDate: "1986-05-08",
    email: `smoke${stamp}@example.com`,
    phone: "060123456"
  };
  const updatedPatient = {
    ...patient,
    firstName: `${patient.firstName}Edit`,
    phone: "061654321"
  };
  const fullName = `${patient.firstName} ${patient.lastName}`;
  const updatedFullName = `${updatedPatient.firstName} ${updatedPatient.lastName}`;

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
    note: "Automated Playwright visit create"
  });
  await newEntry.save();
  await expect(newEntry.alert).toContainText(/Unos je spremljen/i);

  await allRecords.goto();
  await allRecords.filterByPatient(fullName);
  await allRecords.expectPatientVisible(fullName);
  await allRecords.openPatient(fullName);
  await patientDashboard.expectLoaded(fullName);
  await patientDashboard.expectRecordVisible("Kontrola");

  await patientDashboard.editPatientDetails();
  await newPatient.fillPatient(updatedPatient);
  await newPatient.saveAndAcceptDialog("Pacijent azuriran");
  await patientDashboard.expectLoaded(updatedFullName);

  await patientDashboard.editFirstRecord();
  await newEntry.updateProcedureFromOpenedRecord("Plomba");
  await newEntry.save();
  await expect(newEntry.alert).toContainText(/Unos je azuriran/i);

  await allRecords.goto();
  await allRecords.openPatient(updatedFullName);
  await patientDashboard.expectRecordVisible("Plomba");
  await patientDashboard.expectPatientDeleteBlocked();

  await patientDashboard.deleteFirstRecord();
  await expect(patientDashboard.recordsBody).toContainText(/Nema zapisa/i);

  await patientDashboard.deleteCurrentPatient();
  await allRecords.expectPatientHidden(updatedFullName);
});

test("director panel reports smoke test", async ({ page }) => {
  await authenticate(page, "director");
  const directorPanel = new DirectorPanelPage(page);
  await directorPanel.goto();

  const reports = [
    { id: "financial-report", table: "#payment-table" },
    { id: "patients-report", table: "#patients-table" },
    { id: "doctors-report", table: "#doctors-table" },
    { id: "procedures-report", table: "#procedures-table" },
    { id: "excel-report", table: "#excel-sheet-table" }
  ];

  for (const report of reports) {
    await directorPanel.openReport(report.id, report.table);
    await directorPanel.exportCurrentReport(report.id);
    await directorPanel.backToReports(report.id);
  }

  await directorPanel.openCodebookAdmin();
  await directorPanel.createAndDeleteCodebookItem(`Test smena ${Date.now()}`);
  await directorPanel.expectCurrencyFormFields();
  await directorPanel.expectPaymentStatusSimpleFields();
  await directorPanel.expectActivitySimpleFields();
  await directorPanel.expectCurrencyCodeLockedOnEdit();
  await directorPanel.createEditAndDeleteActivity(`Test delatnost ${Date.now()}`, `Izmenjena delatnost ${Date.now()}`);
});
