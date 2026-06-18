const { test, expect } = require("@playwright/test");
const { authenticate } = require("../utils/auth");
const { cleanupRegressionData } = require("../utils/cleanup");
const { createPatient } = require("../utils/api");
const { LoginPage } = require("../pages/LoginPage");
const { DashboardPage } = require("../pages/DashboardPage");
const { CalendarPage } = require("../pages/CalendarPage");
const { NewEntryPage } = require("../pages/NewEntryPage");
const { NewPatientPage } = require("../pages/NewPatientPage");
const { AllRecordsPage } = require("../pages/AllRecordsPage");
const { PatientDashboardPage } = require("../pages/PatientDashboardPage");
const { PublicBookingPage } = require("../pages/PublicBookingPage");
const { DirectorPanelPage } = require("../pages/DirectorPanelPage");

const TEST_PREFIX = "POCOVER";

test.beforeEach(async ({ request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
});

test.afterEach(async ({ request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
});

test("page objects expose core elements for every application page", async ({ page, request, baseURL }) => {
  const stamp = Date.now();
  const patient = await createPatient(request, baseURL, {
    firstName: `${TEST_PREFIX}${stamp}`,
    lastName: "Pacijent",
    email: `${TEST_PREFIX.toLowerCase()}.${stamp}@example.com`
  });
  const fullName = `${patient.firstName || `${TEST_PREFIX}${stamp}`} ${patient.lastName || "Pacijent"}`;

  const login = new LoginPage(page);
  await login.goto();
  await login.expectCoreElements();

  await authenticate(page, "staff");

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  await dashboard.expectCoreElements();

  const calendar = new CalendarPage(page);
  await calendar.goto();
  await calendar.expectCoreElements();
  await calendar.switchView("day", /calendar-board-day/);
  await calendar.switchView("month", /calendar-board-month/);
  await calendar.switchView("week", /calendar-board-week/);

  const newEntry = new NewEntryPage(page);
  await newEntry.goto();
  await newEntry.expectCoreElements();

  const newPatient = new NewPatientPage(page);
  await newPatient.goto();
  await newPatient.expectCoreElements();

  const allRecords = new AllRecordsPage(page);
  await allRecords.goto();
  await allRecords.expectCoreElements();

  const patientDashboard = new PatientDashboardPage(page);
  await patientDashboard.goto(fullName);
  await patientDashboard.expectLoaded(fullName);
  await patientDashboard.expectCoreElements();

  const publicBooking = new PublicBookingPage(page);
  await publicBooking.goto();
  await publicBooking.expectCoreElements();

  await authenticate(page, "director");
  const directorPanel = new DirectorPanelPage(page);
  await directorPanel.goto();
  await directorPanel.expectCoreElements();
});

test("failure paths: login, required fields and page validation reject bad input", async ({ page }) => {
  const login = new LoginPage(page);
  await login.expectRejectedLogin();

  await authenticate(page, "staff");

  const newPatient = new NewPatientPage(page);
  await newPatient.goto();
  await newPatient.expectRequiredValidation();

  const newEntry = new NewEntryPage(page);
  await newEntry.goto();
  await newEntry.expectRequiredValidation();

  const calendar = new CalendarPage(page);
  await calendar.goto();
  await calendar.expectRequiredValidation();

  const publicBooking = new PublicBookingPage(page);
  await publicBooking.goto();
  await publicBooking.expectInvalidPhoneRejected();
});

test("failure paths: protected director functionality blocks staff and validates codebook form", async ({ page }) => {
  await authenticate(page, "staff");
  await page.goto("/src/pages/director-panel.html");
  await expect(page).not.toHaveURL(/director-panel\.html/);

  await authenticate(page, "director");
  const directorPanel = new DirectorPanelPage(page);
  await directorPanel.goto();
  await directorPanel.expectCodebookValidation();
});
