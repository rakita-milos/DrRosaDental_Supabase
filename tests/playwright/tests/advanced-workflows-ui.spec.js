const { test, expect } = require("@playwright/test");
const { cleanupRegressionData } = require("../utils/cleanup");
const { authHeaders, apiGet, apiPut, createPatient } = require("../utils/api");
const { authenticate } = require("../utils/auth");
const { PatientDashboardPage } = require("../pages/PatientDashboardPage");
const { PublicBookingPage } = require("../pages/PublicBookingPage");

const TEST_PREFIX = "ADVUI";
const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

function nextDayIso() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function minimalDicomBase64() {
  const bytes = Buffer.alloc(132 + 12 * 7 + 2);
  bytes.write("DICM", 128, "ascii");
  let offset = 132;
  const writeU16Tag = (group, element, value) => {
    bytes.writeUInt16LE(group, offset);
    bytes.writeUInt16LE(element, offset + 2);
    bytes.write("US", offset + 4, "ascii");
    bytes.writeUInt16LE(2, offset + 6);
    bytes.writeUInt16LE(value, offset + 8);
    offset += 10;
  };
  const writeStringTag = (group, element, vr, value) => {
    const length = value.length + (value.length % 2);
    bytes.writeUInt16LE(group, offset);
    bytes.writeUInt16LE(element, offset + 2);
    bytes.write(vr, offset + 4, "ascii");
    bytes.writeUInt16LE(length, offset + 6);
    bytes.write(value, offset + 8, "ascii");
    offset += 8 + length;
  };
  writeStringTag(0x0028, 0x0004, "CS", "MONOCHROME2");
  writeU16Tag(0x0028, 0x0010, 1);
  writeU16Tag(0x0028, 0x0011, 1);
  writeU16Tag(0x0028, 0x0100, 16);
  writeU16Tag(0x0028, 0x0103, 0);
  bytes.writeUInt16LE(0x7fe0, offset);
  bytes.writeUInt16LE(0x0010, offset + 2);
  bytes.write("OW", offset + 4, "ascii");
  bytes.writeUInt16LE(0, offset + 6);
  bytes.writeUInt32LE(2, offset + 8);
  bytes.writeUInt16LE(3000, offset + 12);
  return bytes.toString("base64");
}

test.beforeEach(async ({ request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
});

test.afterEach(async ({ request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
  const restored = await apiPut(request, baseURL, "/api/director/public-booking/settings", { enabled: false }, "director");
  expect(restored.configuredEnabled).toBe(false);
});

test("ui: public booking page loads options and books a free slot", async ({ page, request, baseURL }) => {
  const feature = await apiPut(request, baseURL, "/api/director/public-booking/settings", { enabled: true }, "director");
  expect(feature.configuredEnabled).toBe(true);

  const stamp = Date.now();
  const email = `${TEST_PREFIX.toLowerCase()}.${stamp}@example.com`;
  const bookingDate = nextDayIso();
  const precedingDate = new Date(`${bookingDate}T00:00:00.000Z`);
  precedingDate.setUTCDate(precedingDate.getUTCDate() - 1);
  const followingDate = new Date(`${bookingDate}T00:00:00.000Z`);
  followingDate.setUTCDate(followingDate.getUTCDate() + 2);
  const booking = new PublicBookingPage(page);
  await booking.goto();
  await booking.book({
    firstName: `${TEST_PREFIX}${stamp}`,
    lastName: "Booking",
    email,
    date: bookingDate,
    note: `${TEST_PREFIX} UI public booking`
  });

  const patients = await apiGet(request, baseURL, "/api/patients", "staff");
  const bookedPatient = patients.find(item => item.email === email);
  expect(bookedPatient).toMatchObject({
    id: expect.any(Number),
    first_name: `${TEST_PREFIX}${stamp}`,
    last_name: "Booking",
    email
  });
  const appointments = await apiGet(request, baseURL, `/api/appointments?from=${precedingDate.toISOString()}&to=${followingDate.toISOString()}`, "staff");
  expect(appointments.some(item => item.patientId === bookedPatient.id && item.notes === `${TEST_PREFIX} UI public booking`)).toBe(true);

  const disabled = await apiPut(request, baseURL, "/api/director/public-booking/settings", { enabled: false }, "director");
  expect(disabled.configuredEnabled).toBe(false);
});

test("ui: patient dashboard persists current clinical, finance and admin workflows", async ({ page, request, baseURL }) => {
  const stamp = Date.now();
  const patient = await createPatient(request, baseURL, {
    firstName: `${TEST_PREFIX}${stamp}`,
    lastName: "Patient",
    email: `${TEST_PREFIX.toLowerCase()}.${stamp}@example.com`
  });
  const fullName = `${patient.first_name} ${patient.last_name}`;

  await authenticate(page, "staff");
  await page.goto(`/src/pages/patient-dashboard.html?patient=${encodeURIComponent(fullName)}`);

  const dashboard = new PatientDashboardPage(page);
  await dashboard.expectLoaded(fullName);
  await expect(page.locator("#patient-clinical-section")).toBeVisible();

  await page.locator('.patient-group-tab[data-patient-group="clinical"]').click();
  await page.locator("#medical-allergies").fill(`${TEST_PREFIX} Penicilin`);
  await page.locator("#medical-contraindications").fill(`${TEST_PREFIX} Antikoagulansi`);
  await page.locator("#medical-diabetes").check();
  await page.locator("#medical-profile-form").getByRole("button", { name: /Sa.uvaj karton/i }).click();
  await expect(page.locator("#medical-profile-message")).toContainText(/Karton je sa/i);
  await dashboard.createEditAndDeleteClinicalNote({
    title: `${TEST_PREFIX} beleska`,
    updatedTitle: `${TEST_PREFIX} izmenjena beleska`
  });
  await dashboard.createEditAndDeleteConsent({
    title: `${TEST_PREFIX} saglasnost`,
    updatedTitle: `${TEST_PREFIX} izmenjena saglasnost`
  });
  await dashboard.createInvoice({ description: `${TEST_PREFIX} invoice item`, price: "210" });
  await dashboard.createInvoiceDirectly({ description: `${TEST_PREFIX} direct invoice item`, price: "175" });
  await dashboard.createInsuranceClaim({ provider: `${TEST_PREFIX} Insurance`, amount: "210" });

  const medicalProfile = await apiGet(request, baseURL, `/api/patients/${patient.id}/medical-profile`);
  expect(medicalProfile).toMatchObject({
    patientId: patient.id,
    allergies: `${TEST_PREFIX} Penicilin`,
    contraindications: `${TEST_PREFIX} Antikoagulansi`,
    diabetes: true
  });
  const notes = await apiGet(request, baseURL, `/api/patients/${patient.id}/clinical-notes`);
  expect(notes.some(item => item.title === `${TEST_PREFIX} izmenjena beleska`)).toBe(false);
  const consents = await apiGet(request, baseURL, `/api/patients/${patient.id}/consents`);
  expect(consents.some(item => item.title === `${TEST_PREFIX} izmenjena saglasnost`)).toBe(false);
  const invoices = await apiGet(request, baseURL, `/api/patients/${patient.id}/invoices`);
  expect(invoices).toEqual(expect.arrayContaining([
    expect.objectContaining({ total: 210, items: expect.arrayContaining([expect.objectContaining({ description: `${TEST_PREFIX} invoice item`, unitPrice: 210 })]) }),
    expect.objectContaining({ total: 175, items: expect.arrayContaining([expect.objectContaining({ description: `${TEST_PREFIX} direct invoice item`, unitPrice: 175 })]) })
  ]));
  const claims = await apiGet(request, baseURL, `/api/patients/${patient.id}/insurance-claims`);
  expect(claims).toEqual(expect.arrayContaining([
    expect.objectContaining({ provider: `${TEST_PREFIX} Insurance`, requestedAmount: 210 })
  ]));

  const documentTitle = `${TEST_PREFIX} dokument`;
  const upload = await request.post(`${baseURL}/api/patients/${patient.id}/documents`, {
    headers: authHeaders("staff"),
    data: {
      documentType: "photo",
      title: documentTitle,
      originalFilename: "dokument.png",
      mimeType: "image/png",
      fileBase64: ONE_PIXEL_PNG
    }
  });
  expect(upload.status()).toBe(201);
  const uploadedDocument = await upload.json();
  expect(uploadedDocument).toMatchObject({ id: expect.any(Number), patientId: patient.id, title: documentTitle, source: "upload" });
  await page.reload();
  await dashboard.expectLoaded(fullName);
  await dashboard.editAndDeleteDocument({ title: documentTitle, updatedTitle: `${TEST_PREFIX} izmenjen dokument` });
  const documentsAfterDelete = await apiGet(request, baseURL, `/api/patients/${patient.id}/documents`);
  expect(documentsAfterDelete.some(item => item.id === uploadedDocument.id)).toBe(false);
});

test("ui: patient dashboard opens uploaded xray in controlled imaging viewer", async ({ page, request, baseURL }) => {
  const stamp = Date.now();
  const patient = await createPatient(request, baseURL, {
    firstName: `${TEST_PREFIX}${stamp}`,
    lastName: "Xray",
    email: `${TEST_PREFIX.toLowerCase()}.xray.${stamp}@example.com`
  });
  const fullName = `${patient.first_name} ${patient.last_name}`;
  const title = `${TEST_PREFIX} RTG 16`;

  const upload = await request.post(`${baseURL}/api/patients/${patient.id}/documents`, {
    headers: authHeaders("staff"),
    data: {
      documentType: "rtg",
      title,
      originalFilename: "rtg-16.png",
      mimeType: "image/png",
      fileBase64: ONE_PIXEL_PNG,
      imagingModality: "intraoral_xray",
      toothNumber: "16"
    }
  });
  expect(upload.status()).toBe(201);
  expect(await upload.json()).toMatchObject({
    patientId: patient.id,
    title,
    mimeType: "image/png",
    imagingModality: "intraoral_xray",
    toothNumber: "16"
  });

  await authenticate(page, "staff");
  await page.goto(`/src/pages/patient-dashboard.html?patient=${encodeURIComponent(fullName)}`);

  const dashboard = new PatientDashboardPage(page);
  await dashboard.expectLoaded(fullName);
  await dashboard.openDocumentViewer(title);
});

test("ui: patient dashboard opens uploaded dicom in viewer", async ({ page, request, baseURL }) => {
  const stamp = Date.now();
  const patient = await createPatient(request, baseURL, {
    firstName: `${TEST_PREFIX}${stamp}`,
    lastName: "Dicom",
    email: `${TEST_PREFIX.toLowerCase()}.dicom.${stamp}@example.com`
  });
  const fullName = `${patient.first_name} ${patient.last_name}`;
  const title = `${TEST_PREFIX} DICOM 11`;

  const upload = await request.post(`${baseURL}/api/patients/${patient.id}/documents`, {
    headers: authHeaders("staff"),
    data: {
      documentType: "rtg",
      title,
      originalFilename: "rtg-11.dcm",
      mimeType: "application/dicom",
      fileBase64: minimalDicomBase64(),
      imagingModality: "intraoral_xray",
      toothNumber: "11",
      dicomStudyUid: `1.2.826.0.1.${stamp}`
    }
  });
  expect(upload.status()).toBe(201);
  expect(await upload.json()).toMatchObject({
    patientId: patient.id,
    title,
    mimeType: "application/dicom",
    imagingModality: "intraoral_xray",
    toothNumber: "11",
    dicomStudyUid: `1.2.826.0.1.${stamp}`
  });

  await authenticate(page, "staff");
  await page.goto(`/src/pages/patient-dashboard.html?patient=${encodeURIComponent(fullName)}`);

  const dashboard = new PatientDashboardPage(page);
  await dashboard.expectLoaded(fullName);
  await dashboard.documentsTab.click();
  const row = dashboard.documentsBody.locator("tr", { hasText: title }).first();
  await row.getByRole("button", { name: "Pregled", exact: true }).click();
  await expect(page.locator("#imaging-dicom-canvas")).toBeVisible();
});
