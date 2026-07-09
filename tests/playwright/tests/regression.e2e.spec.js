const { test, expect } = require("@playwright/test");
const { authenticate } = require("../utils/auth");
const { cleanupRegressionData } = require("../utils/cleanup");
const { apiGet, apiPut, createCodebookItem, createPatient, createPatientWithRecord, createRecord, updateCodebookItem } = require("../utils/api");
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
      email: `e2e.export.${stamp}@example.com`
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
    email: `e2e.proc.${stamp}@example.com`
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

test("regression: new visit without tooth map accepts split EUR and RSD payments", async ({ page, request, baseURL }) => {
  const stamp = Date.now();
  const patient = {
    firstName: `${TEST_PREFIX}SplitPay${stamp}`,
    lastName: "Patient",
    email: `e2e.splitpay.${stamp}@example.com`
  };
  const fullName = `${patient.firstName} ${patient.lastName}`;
  await createPatient(request, baseURL, patient, "staff");

  await authenticate(page, "staff");
  await page.goto(`/src/pages/new-entry.html?patient=${encodeURIComponent(fullName)}`);

  await page.locator("#last-visit").fill("2026-07-04");
  await page.locator("#procedure-activity").selectOption({ index: 1 });
  await expect(page.locator("#procedure")).toBeEnabled();
  await page.locator("#procedure").selectOption({ label: "Kontrola" });
  await page.locator("#status").selectOption({ index: 2 });
  await page.locator("#doctor").selectOption({ index: 0 });
  await page.locator("#shift").selectOption({ label: "Prva smena (08:00-14:00)" }).catch(async () => {
    await page.locator("#shift").selectOption({ label: "Prva smena" });
  });
  await page.locator("#currency").selectOption("EUR");
  const note = `${TEST_PREFIX} split payment visit without tooth map ${stamp}`;
  await page.locator("#note").fill(note);

  await page.locator("#add-payment-part").click();
  await page.locator(".payment-part-row").nth(0).locator(".payment-part-amount").fill("10");
  await page.locator(".payment-part-row").nth(0).locator(".payment-part-currency").selectOption("EUR");

  await page.locator("#add-payment-part").click();
  await page.locator(".payment-part-row").nth(1).locator(".payment-part-amount").fill("1000");
  await page.locator(".payment-part-row").nth(1).locator(".payment-part-currency").selectOption("RSD");

  const invalidControls = await page.locator("#new-entry-form").evaluate(form =>
    Array.from(form.elements)
      .filter(element => element.willValidate && !element.validity.valid)
      .map(element => ({
        id: element.id,
        name: element.name,
        value: element.value,
        validationMessage: element.validationMessage
      }))
  );
  expect(invalidControls).toEqual([]);

  await page.locator("#new-entry-form button[type='submit']").click();
  await expect(page.locator(".form-alert")).toContainText(/Unos je spremljen|Unos je sa/i);
  const records = await request.get(`${baseURL}/api/records`, {
    headers: { Authorization: `Bearer ${require("../utils/auth").tokenFor("staff")}` }
  });
  expect(records.ok()).toBeTruthy();
  expect((await records.json()).some(record =>
    `${record.first_name || ""} ${record.last_name || ""}`.trim() === fullName && record.notes === note
  )).toBeTruthy();
});

test("regression: new visit split payments works through visible custom selects", async ({ page, request, baseURL }) => {
  const stamp = Date.now();
  const patient = {
    firstName: `${TEST_PREFIX}SplitUi${stamp}`,
    lastName: "Patient",
    email: `e2e.splitui.${stamp}@example.com`
  };
  const fullName = `${patient.firstName} ${patient.lastName}`;
  await createPatient(request, baseURL, patient, "staff");

  const choose = async (selector, optionIndex = 1) => {
    const wrap = page.locator(selector).locator("xpath=ancestor::*[contains(@class, 'custom-select-wrap')][1]");
    await wrap.locator(".custom-select-button").click();
    await wrap.locator(".custom-select-option").nth(optionIndex).click();
  };

  await authenticate(page, "staff");
  await page.goto(`/src/pages/new-entry.html?patient=${encodeURIComponent(fullName)}`);

  await page.locator("#last-visit").fill("2026-07-04");
  await choose("#procedure-activity", 1);
  await expect(page.locator("#procedure")).toBeEnabled();
  await choose("#procedure", 1);
  await choose("#status", 2);
  await choose("#doctor", 0);
  await choose("#shift", 0);
  await choose("#currency", 0);
  const note = `${TEST_PREFIX} visible custom selects split payment ${stamp}`;
  await page.locator("#note").fill(note);

  await page.locator("#add-payment-part").click();
  await page.locator(".payment-part-row").nth(0).locator(".payment-part-amount").fill("10");
  await page.locator(".payment-part-row").nth(0).locator(".payment-part-currency").selectOption("EUR");

  await page.locator("#add-payment-part").click();
  await page.locator(".payment-part-row").nth(1).locator(".payment-part-amount").fill("1000");
  await page.locator(".payment-part-row").nth(1).locator(".payment-part-currency").selectOption("RSD");

  const stateBeforeSave = await page.locator("#new-entry-form").evaluate(form => ({
    invalid: Array.from(form.elements)
      .filter(element => element.willValidate && !element.validity.valid)
      .map(element => ({
        id: element.id,
        name: element.name,
        value: element.value,
        validationMessage: element.validationMessage
      })),
    values: {
      patient: form.elements.patient?.value,
      lastVisit: form.elements.lastVisit?.value,
      procedureActivity: form.elements.procedureActivity?.value,
      procedure: form.elements.procedure?.value,
      paymentStatus: form.elements.paymentStatus?.value,
      currency: form.elements.currency?.value
    }
  }));
  expect(stateBeforeSave.invalid).toEqual([]);

  await page.locator("#new-entry-form button[type='submit']").click();
  await expect(page.locator(".form-alert")).toContainText(/Unos je spremljen|Unos je sa/i);
  const records = await request.get(`${baseURL}/api/records`, {
    headers: { Authorization: `Bearer ${require("../utils/auth").tokenFor("staff")}` }
  });
  expect(records.ok()).toBeTruthy();
  expect((await records.json()).some(record =>
    `${record.first_name || ""} ${record.last_name || ""}`.trim() === fullName && record.notes === note
  )).toBeTruthy();
});

test("regression: zero-priced procedure can save split payments after manual total amount", async ({ page, request, baseURL }) => {
  const stamp = Date.now();
  const activityName = `${TEST_PREFIX} ManualTotal Activity ${stamp}`;
  const procedureName = `${TEST_PREFIX} ManualTotal Procedure ${stamp}`;
  const activityItem = await createCodebookItem(request, baseURL, {
    type: "activity",
    value: activityName,
    label: activityName,
    sortOrder: 95,
    isActive: true,
    metadata: {}
  });
  const procedureItem = await createCodebookItem(request, baseURL, {
    type: "procedure",
    value: procedureName,
    label: procedureName,
    groupName: activityName,
    price: 0,
    sortOrder: 96,
    isActive: true,
    metadata: {}
  });
  const patient = {
    firstName: `${TEST_PREFIX}ManualTotal${stamp}`,
    lastName: "Patient",
    email: `e2e.manualtotal.${stamp}@example.com`
  };
  const fullName = `${patient.firstName} ${patient.lastName}`;
  await createPatient(request, baseURL, patient, "staff");

  await authenticate(page, "staff");
  await page.goto(`/src/pages/new-entry.html?patient=${encodeURIComponent(fullName)}`);

  await page.locator("#last-visit").fill("2026-07-04");
  await page.locator("#procedure-activity").selectOption({ label: activityName });
  await expect(page.locator("#procedure")).toBeEnabled();
  await page.locator("#procedure").selectOption({ label: procedureName });
  await page.locator("#total-amount").fill("50");
  await page.locator("#status").selectOption({ index: 2 });
  await page.locator("#doctor").selectOption({ index: 0 });
  await page.locator("#shift").selectOption({ index: 0 });
  await page.locator("#currency").selectOption("EUR");
  const note = `${TEST_PREFIX} zero price split payment ${stamp}`;
  await page.locator("#note").fill(note);

  await page.locator("#add-payment-part").click();
  await page.locator(".payment-part-row").nth(0).locator(".payment-part-amount").fill("10");
  await page.locator(".payment-part-row").nth(0).locator(".payment-part-currency").selectOption("EUR");

  await page.locator("#add-payment-part").click();
  await page.locator(".payment-part-row").nth(1).locator(".payment-part-amount").fill("1000");
  await page.locator(".payment-part-row").nth(1).locator(".payment-part-currency").selectOption("RSD");

  await expect(page.locator("#payment-total-display")).toContainText("50.00 EUR");
  await page.locator("#new-entry-form button[type='submit']").click();
  await expect(page.locator(".form-alert")).toContainText(/Unos je spremljen|Unos je sa/i);

  const records = await request.get(`${baseURL}/api/records`, {
    headers: { Authorization: `Bearer ${require("../utils/auth").tokenFor("staff")}` }
  });
  expect(records.ok()).toBeTruthy();
  expect((await records.json()).some(record =>
    `${record.first_name || ""} ${record.last_name || ""}`.trim() === fullName && record.notes === note
  )).toBeTruthy();
  await updateCodebookItem(request, baseURL, procedureItem.id, { ...procedureItem, isActive: false });
  await updateCodebookItem(request, baseURL, activityItem.id, { ...activityItem, isActive: false });
});

test("regression: split payment without total amount shows actionable error", async ({ page, request, baseURL }) => {
  const stamp = Date.now();
  const activityName = `${TEST_PREFIX} NoTotal Activity ${stamp}`;
  const procedureName = `${TEST_PREFIX} NoTotal Procedure ${stamp}`;
  const activityItem = await createCodebookItem(request, baseURL, {
    type: "activity",
    value: activityName,
    label: activityName,
    sortOrder: 95,
    isActive: true,
    metadata: {}
  });
  const procedureItem = await createCodebookItem(request, baseURL, {
    type: "procedure",
    value: procedureName,
    label: procedureName,
    groupName: activityName,
    price: 0,
    sortOrder: 96,
    isActive: true,
    metadata: {}
  });
  const patient = {
    firstName: `${TEST_PREFIX}NoTotal${stamp}`,
    lastName: "Patient",
    email: `e2e.nototal.${stamp}@example.com`
  };
  const fullName = `${patient.firstName} ${patient.lastName}`;
  await createPatient(request, baseURL, patient, "staff");

  await authenticate(page, "staff");
  await page.goto(`/src/pages/new-entry.html?patient=${encodeURIComponent(fullName)}`);

  await page.locator("#last-visit").fill("2026-07-04");
  await page.locator("#procedure-activity").selectOption({ label: activityName });
  await expect(page.locator("#procedure")).toBeEnabled();
  await page.locator("#procedure").selectOption({ label: procedureName });
  await page.locator("#status").selectOption({ index: 2 });
  await page.locator("#doctor").selectOption({ index: 0 });
  await page.locator("#shift").selectOption({ index: 0 });
  await page.locator("#currency").selectOption("EUR");
  await page.locator("#note").fill(`${TEST_PREFIX} zero price requires total ${stamp}`);

  await page.locator("#add-payment-part").click();
  await page.locator(".payment-part-row").nth(0).locator(".payment-part-amount").fill("10");
  await page.locator(".payment-part-row").nth(0).locator(".payment-part-currency").selectOption("EUR");

  await page.locator("#new-entry-form button[type='submit']").click();
  await expect(page.locator(".form-alert")).toContainText(/Ukupno za naplatu/i);
  await updateCodebookItem(request, baseURL, procedureItem.id, { ...procedureItem, isActive: false });
  await updateCodebookItem(request, baseURL, activityItem.id, { ...activityItem, isActive: false });
});

test("regression: daily cash report counts only physical cash and manual outflows", async ({ request, baseURL }) => {
  const stamp = Date.now();
  const reportDate = `2026-07-${String(10 + (stamp % 18)).padStart(2, "0")}`;
  const reportShift = "Prva smena";
  const patient = {
    firstName: `${TEST_PREFIX}Cash${stamp}`,
    lastName: "Patient",
    email: `e2e.cash.${stamp}@example.com`
  };
  const created = await createPatient(request, baseURL, patient, "staff");

  await createRecord(request, baseURL, {
    patientId: created.id,
    visitDate: reportDate,
    shift: reportShift,
    procedure: "Kontrola",
    totalAmount: 17000,
    amount: 0,
    currency: "RSD",
    paymentStatus: "Placeno",
    paymentParts: [
      { amount: 12000, currency: "RSD", paymentMethod: "Gotovina", paymentDate: reportDate },
      { amount: 5000, currency: "RSD", paymentMethod: "Kartica", paymentDate: reportDate }
    ],
    note: `${TEST_PREFIX} daily cash ${stamp}`
  }, "staff");

  let report = await apiGet(request, baseURL, `/api/director/daily-cash-report?date=${reportDate}&shift=${encodeURIComponent(reportShift)}`, "director");
  expect(report.totals.cashIn.RSD).toBe(12000);
  expect(report.totals.totalRevenue.RSD).toBe(17000);
  expect(report.totals.remaining.RSD).toBe(12000);

  await apiPut(request, baseURL, "/api/director/daily-cash-report", {
    date: reportDate,
    shift: reportShift,
    lines: [
      { itemValue: "Kurir", amounts: { RSD: 800, EUR: 0 } }
    ]
  }, "director");

  report = await apiGet(request, baseURL, `/api/director/daily-cash-report?date=${reportDate}&shift=${encodeURIComponent(reportShift)}`, "director");
  expect(report.totals.manualOutflow.RSD).toBe(800);
  expect(report.totals.remaining.RSD).toBe(11200);
});
