const { test, expect } = require("@playwright/test");
const { authenticate, tokenFor } = require("../utils/auth");
const { cleanupRegressionData } = require("../utils/cleanup");
const { createPatient } = require("../utils/api");

const TEST_PREFIX = "E2ENewEntry";

test.beforeEach(async ({ page, request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
  await page.goto("/src/pages/login.html");
  await page.evaluate(() => localStorage.clear());
});

test.afterEach(async ({ request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
});

async function createTestPatient(request, baseURL, stamp, suffix = "Patient") {
  const patient = {
    firstName: `${TEST_PREFIX}${stamp}`,
    lastName: suffix,
    email: `e2e.new-entry.${stamp}.${suffix.toLowerCase()}@example.com`
  };
  await createPatient(request, baseURL, patient, "staff");
  return `${patient.firstName} ${patient.lastName}`;
}

async function gotoNewEntry(page, fullName) {
  await authenticate(page, "staff");
  await page.goto(`/src/pages/new-entry.html?patient=${encodeURIComponent(fullName)}`);
  await expect(page.locator("#patient-name")).toHaveValue(fullName);
  await expect(page.locator("#procedure-activity")).toBeEnabled();
}

async function setFormValue(page, selector, value) {
  await page.locator(selector).evaluate((element, nextValue) => {
    element.value = nextValue;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function openGeneralProcedures(page) {
  const toggle = page.locator("#toggle-procedure-fallback");
  if (await toggle.getAttribute("aria-expanded") !== "true") {
    await toggle.click();
  }
  await expect(page.locator("#add-general-treatment")).toBeVisible();
}

async function fillBasicVisit(page, { note, date = "2026-07-06", total = "120" } = {}) {
  const [year, month, day] = date.split("-");
  await page.locator('[data-drrosa-for="last-visit"]').fill(`${day}.${month}.${year}`);
  await openGeneralProcedures(page);
  await page.locator("#procedure-activity").selectOption({ index: 1 }, { force: true });
  await expect(page.locator("#procedure")).toBeEnabled();
  await page.locator("#procedure").selectOption({ label: "Kontrola" }, { force: true });
  await page.locator("#doctor").selectOption({ index: 0 }, { force: true });
  await page.locator("#shift").selectOption({ index: 0 }, { force: true });
  await setFormValue(page, "#total-amount", total);
  await page.locator("#note").fill(note);
}

async function expectRecordWithNote(request, baseURL, fullName, note) {
  await expect.poll(async () => {
    const response = await request.get(`${baseURL}/api/records`, {
      headers: { Authorization: `Bearer ${tokenFor("staff")}` }
    });
    if (!response.ok()) return false;
    const records = await response.json();
    return records.some(record =>
      `${record.first_name || ""} ${record.last_name || ""}`.trim() === fullName
      && record.notes === note
    );
  }).toBeTruthy();
}

function saveEntryButton(page) {
  return page.getByRole("button", { name: /Sa.uvaj unos/i });
}

test("new entry: tooth map keeps clinical FDI orientation", async ({ page, request, baseURL }) => {
  const stamp = Date.now();
  const fullName = await createTestPatient(request, baseURL, stamp, "Orientation");

  await gotoNewEntry(page, fullName);
  const boxFor = async tooth => page.locator(`.tooth-node[data-tooth='${tooth}']`).boundingBox();
  const upperRightCentral = await boxFor("11");
  const upperLeftCentral = await boxFor("21");
  const lowerRightCentral = await boxFor("41");
  const lowerLeftCentral = await boxFor("31");

  expect(upperRightCentral).toBeTruthy();
  expect(upperLeftCentral).toBeTruthy();
  expect(lowerRightCentral).toBeTruthy();
  expect(lowerLeftCentral).toBeTruthy();
  expect(upperRightCentral.x).toBeLessThan(upperLeftCentral.x);
  expect(lowerRightCentral.x).toBeLessThan(lowerLeftCentral.x);
});

test("new entry: saves a fully populated visit without selecting teeth", async ({ page, request, baseURL }) => {
  const stamp = Date.now();
  const fullName = await createTestPatient(request, baseURL, stamp);
  const note = `${TEST_PREFIX} no tooth save ${stamp}`;

  await gotoNewEntry(page, fullName);
  await fillBasicVisit(page, { note });
  await expect(page.locator(".tooth-node.selected")).toHaveCount(0);
  await expect(page.locator("#new-entry-form form")).toHaveCount(0);
  const mainFormOwnsPreviousDebtFields = await page.locator("#new-entry-form").evaluate(form =>
    Array.from(form.elements).some(element => element.id?.startsWith("previous-debt-payment-"))
  );
  expect(mainFormOwnsPreviousDebtFields).toBe(false);

  await page.route("**/api/records", async route => {
    if (route.request().method() === "POST") {
      await page.waitForTimeout(250);
    }
    await route.continue();
  });

  await saveEntryButton(page).click();
  await expect(page.locator("#save-status")).toContainText(/Čuvanje|Cuvanje/i);
  await expectRecordWithNote(request, baseURL, fullName, note);
});

test("new entry: explains why save is blocked when no procedure or tooth treatment is selected", async ({ page, request, baseURL }) => {
  const stamp = Date.now();
  const fullName = await createTestPatient(request, baseURL, stamp, "Validation");

  await gotoNewEntry(page, fullName);
  await page.locator('[data-drrosa-for="last-visit"]').fill("06.07.2026");
  await page.locator("#doctor").selectOption({ index: 0 }, { force: true });
  await page.locator("#shift").selectOption({ index: 0 }, { force: true });
  await setFormValue(page, "#total-amount", "30");

  await saveEntryButton(page).click();
  await expect(page.locator("#save-status")).toContainText(/odaberite osnovnu delatnost|postupak|mapi zuba/i);
});

test("new entry: tooth map treatment can be added and saved", async ({ page, request, baseURL }) => {
  const stamp = Date.now();
  const fullName = await createTestPatient(request, baseURL, stamp, "Tooth");
  const note = `${TEST_PREFIX} tooth map save ${stamp}`;

  await gotoNewEntry(page, fullName);
  await page.locator(".tooth-node[data-tooth='11']").click();
  await expect(page.locator("#tooth-treatment-panel")).toBeVisible();
  await page.locator("#treatment-activity").selectOption({ index: 1 }, { force: true });
  await expect(page.locator("#treatment-type")).toBeEnabled();
  await page.locator("#treatment-type").selectOption({ label: "Kontrola" }, { force: true });
  await page.locator("#treatment-note").fill("Rad na zubu 11");
  await page.locator("#save-treatment").click();
  await expect(page.locator("#teeth-summary")).toContainText(/Zub 11|Kontrola/);

  await page.locator('[data-drrosa-for="last-visit"]').fill("06.07.2026");
  await page.locator("#doctor").selectOption({ index: 0 }, { force: true });
  await page.locator("#shift").selectOption({ index: 0 }, { force: true });
  await page.locator("#note").fill(note);

  await page.locator("#new-entry-form").evaluate(form => {
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
  });
  await expectRecordWithNote(request, baseURL, fullName, note);
});

test("new entry: general procedure draft can be cleared before saving tooth-map work", async ({ page, request, baseURL }) => {
  const stamp = Date.now();
  const fullName = await createTestPatient(request, baseURL, stamp, "ClearGeneralDraft");
  const note = `${TEST_PREFIX} clear general draft ${stamp}`;
  let postedRecord;

  await gotoNewEntry(page, fullName);
  await expect(page.locator("#clear-general-treatment-draft")).toBeHidden();
  await openGeneralProcedures(page);
  await expect(page.locator("#clear-general-treatment-draft")).toBeHidden();

  await page.locator("#procedure-activity").selectOption({ index: 1 }, { force: true });
  await expect(page.locator("#procedure")).toBeEnabled();
  await page.locator("#procedure").selectOption({ index: 1 }, { force: true });
  const draftProcedure = await page.locator("#procedure").inputValue();
  await expect(page.locator("#clear-general-treatment-draft")).toBeVisible();
  await expect(page.locator("#preview-procedure")).toContainText(draftProcedure);

  await page.locator("#toggle-procedure-fallback").click();
  await expect(page.locator("#procedure-fallback-block")).toBeHidden();
  await expect(page.locator("#clear-general-treatment-draft")).toBeHidden();
  await openGeneralProcedures(page);
  await expect(page.locator("#clear-general-treatment-draft")).toBeVisible();

  await page.locator("#clear-general-treatment-draft").click();
  await expect(page.locator("#clear-general-treatment-draft")).toBeHidden();
  await expect(page.locator("#procedure-activity")).toHaveValue("");
  await expect(page.locator("#procedure")).toHaveValue("");
  await expect(page.locator("#procedure")).toBeDisabled();
  await expect(page.locator("#preview-procedure")).toHaveText("Rad nije dodat");

  await page.locator(".tooth-node[data-tooth='11']").click();
  await page.locator("#treatment-activity").selectOption({ index: 1 }, { force: true });
  await expect(page.locator("#treatment-type")).toBeEnabled();
  const toothOptionCount = await page.locator("#treatment-type option").count();
  await page.locator("#treatment-type").selectOption({ index: toothOptionCount > 2 ? 2 : 1 }, { force: true });
  const toothProcedure = await page.locator("#treatment-type").inputValue();
  await page.locator("#save-treatment").click();
  await expect(page.locator("#teeth-summary")).toContainText(/Zub 11/);

  await page.locator('[data-drrosa-for="last-visit"]').fill("06.07.2026");
  await page.locator("#doctor").selectOption({ index: 0 }, { force: true });
  await page.locator("#shift").selectOption({ index: 0 }, { force: true });
  await page.locator("#note").fill(note);

  await page.route("**/api/records", async route => {
    if (route.request().method() === "POST") {
      postedRecord = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: 1001, message: "Record created successfully" })
      });
      return;
    }
    await route.continue();
  });

  await page.locator("#new-entry-form").evaluate(form => {
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
  });
  await expect.poll(() => postedRecord).toBeTruthy();
  expect(postedRecord.generalTreatments).toHaveLength(0);
  expect(postedRecord.treatments["11"]).toHaveLength(1);
  expect(postedRecord.procedure).toContain("zub 11");
  expect(postedRecord.procedure).toContain(toothProcedure);
  expect(postedRecord.procedure).not.toContain(draftProcedure);
});

test("new entry: multiple procedures can be added to multiple selected teeth", async ({ page, request, baseURL }) => {
  const stamp = Date.now();
  const fullName = await createTestPatient(request, baseURL, stamp, "MultiTreatment");
  let postedRecord;

  await gotoNewEntry(page, fullName);
  await page.locator(".tooth-node[data-tooth='11']").click();
  await page.locator(".tooth-node[data-tooth='12']").click();
  await expect(page.locator("#selected-tooth")).toContainText("11, 12");

  await page.locator("#treatment-activity").selectOption({ index: 1 }, { force: true });
  await expect(page.locator("#treatment-type")).toBeEnabled();
  await page.locator("#treatment-type").selectOption({ index: 1 }, { force: true });
  await page.locator("#treatment-note").fill("Prvi postupak");
  await page.locator("#add-treatment-item").click();
  await expect(page.locator(".pending-treatment-item")).toHaveCount(1);

  const procedureOptions = await page.locator("#treatment-type option").count();
  await page.locator("#treatment-type").selectOption({ index: procedureOptions > 2 ? 2 : 1 }, { force: true });
  await page.locator("#treatment-note").fill("Drugi postupak");
  await page.locator("#add-treatment-item").click();
  await expect(page.locator(".pending-treatment-item")).toHaveCount(2);

  await page.locator("#save-treatment").click();
  await expect(page.locator("#teeth-summary")).toContainText(/Zub 11/);
  await expect(page.locator("#teeth-summary")).toContainText(/Zub 12/);

  await page.locator('[data-drrosa-for="last-visit"]').fill("06.07.2026");
  await page.locator("#doctor").selectOption({ index: 0 }, { force: true });
  await page.locator("#shift").selectOption({ index: 0 }, { force: true });
  await page.locator("#note").fill(`${TEST_PREFIX} multiple procedures ${stamp}`);

  await page.route("**/api/records", async route => {
    if (route.request().method() === "POST") {
      postedRecord = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: 999, message: "Record created successfully" })
      });
      return;
    }
    await route.continue();
  });

  await saveEntryButton(page).click();
  await expect.poll(() => postedRecord).toBeTruthy();
  expect(postedRecord.treatments["11"]).toHaveLength(2);
  expect(postedRecord.treatments["12"]).toHaveLength(2);
});

test("new entry: general procedures and tooth-map treatments are combined in totals", async ({ page, request, baseURL }) => {
  const stamp = Date.now();
  const fullName = await createTestPatient(request, baseURL, stamp, "GeneralPlusMap");
  let postedRecord;

  await gotoNewEntry(page, fullName);
  await openGeneralProcedures(page);

  await page.locator("#procedure-activity").selectOption({ index: 1 }, { force: true });
  await expect(page.locator("#procedure")).toBeEnabled();
  await page.locator("#procedure").selectOption({ index: 1 }, { force: true });
  await page.locator("#add-general-treatment").click();
  await expect(page.locator(".general-treatment-item")).toHaveCount(1);

  const generalOptionCount = await page.locator("#procedure option").count();
  await page.locator("#procedure-activity").selectOption({ index: 1 }, { force: true });
  await page.locator("#procedure").selectOption({ index: generalOptionCount > 2 ? 2 : 1 }, { force: true });
  await page.locator("#add-general-treatment").click();
  await expect(page.locator(".general-treatment-item")).toHaveCount(2);

  await page.locator(".tooth-node[data-tooth='11']").click();
  await page.locator(".tooth-node[data-tooth='12']").click();
  await page.locator("#treatment-activity").selectOption({ index: 1 }, { force: true });
  await expect(page.locator("#treatment-type")).toBeEnabled();
  await page.locator("#treatment-type").selectOption({ index: 1 }, { force: true });
  await page.locator("#add-treatment-item").click();
  await page.locator("#save-treatment").click();

  await page.locator('[data-drrosa-for="last-visit"]').fill("06.07.2026");
  await page.locator("#doctor").selectOption({ index: 0 }, { force: true });
  await page.locator("#shift").selectOption({ index: 0 }, { force: true });
  await page.locator("#note").fill(`${TEST_PREFIX} general plus map ${stamp}`);

  await page.route("**/api/records", async route => {
    if (route.request().method() === "POST") {
      postedRecord = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: 1000, message: "Record created successfully" })
      });
      return;
    }
    await route.continue();
  });

  await saveEntryButton(page).click();
  await expect.poll(() => postedRecord).toBeTruthy();

  const generalTotal = postedRecord.generalTreatments.reduce((sum, treatment) => sum + Number(treatment.price || 0), 0);
  const toothTotal = Object.values(postedRecord.treatments)
    .flat()
    .reduce((sum, treatment) => sum + Number(treatment.price || 0), 0);
  expect(postedRecord.generalTreatments).toHaveLength(2);
  expect(postedRecord.treatments["11"]).toHaveLength(1);
  expect(postedRecord.treatments["12"]).toHaveLength(1);
  expect(Number(postedRecord.total_amount)).toBeCloseTo(generalTotal + toothTotal, 2);
  expect(postedRecord.procedure).toContain(postedRecord.generalTreatments[0].type);
  expect(postedRecord.procedure).toContain("zub 11");
});

test("new entry: split payments update preview and can be removed", async ({ page, request, baseURL }) => {
  const stamp = Date.now();
  const fullName = await createTestPatient(request, baseURL, stamp, "Payments");
  const note = `${TEST_PREFIX} payment builder ${stamp}`;

  await gotoNewEntry(page, fullName);
  await fillBasicVisit(page, { note, total: "100" });

  await page.locator("#add-payment-part").click();
  await page.locator(".payment-part-row").nth(0).locator(".payment-part-amount").fill("40");
  await expect(page.locator("#payment-paid-display")).toContainText(/40/);
  await expect(page.locator("#payment-debt-display")).toContainText(/60/);

  await page.locator(".payment-part-remove").click();
  await expect(page.locator(".payment-part-row")).toHaveCount(0);
  await expect(page.locator("#payment-paid-display")).toContainText(/0/);
  await expect(page.locator("#payment-debt-display")).toContainText(/100/);
});
