const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { authHeaders, createPatient } = require("../utils/api");
const { cleanupRegressionData } = require("../utils/cleanup");

const TEST_PREFIX = "DOCAPI";
const scannerInbox = path.join(__dirname, "../.scanner-inbox");

test.beforeEach(async ({ request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
  fs.mkdirSync(scannerInbox, { recursive: true });
});

test.afterEach(async ({ request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
});

test("api: patient medical profile, upload document and import latest scan", async ({ request, baseURL }) => {
  const stamp = Date.now();
  const patient = await createPatient(request, baseURL, {
    firstName: `${TEST_PREFIX}${stamp}`,
    lastName: "Patient",
    email: `${TEST_PREFIX.toLowerCase()}.${stamp}@example.com`
  }, "staff");

  const profileResponse = await request.put(`${baseURL}/api/patients/${patient.id}/medical-profile`, {
    headers: authHeaders("staff"),
    data: {
      allergies: "Penicilin",
      contraindications: "Antikoagulansi",
      diabetes: true
    }
  });
  expect(profileResponse.status()).toBe(200);
  const profile = await profileResponse.json();
  expect(profile).toMatchObject({ patientId: patient.id, allergies: "Penicilin", contraindications: "Antikoagulansi", diabetes: true });
  const persistedProfileResponse = await request.get(`${baseURL}/api/patients/${patient.id}/medical-profile`, {
    headers: authHeaders("staff")
  });
  expect(persistedProfileResponse.status()).toBe(200);
  expect(await persistedProfileResponse.json()).toMatchObject({
    patientId: patient.id,
    allergies: "Penicilin",
    contraindications: "Antikoagulansi",
    diabetes: true
  });

  const pdfBase64 = Buffer.from("%PDF-1.4\n% Test PDF\n").toString("base64");
  const uploadResponse = await request.post(`${baseURL}/api/patients/${patient.id}/documents`, {
    headers: authHeaders("staff"),
    data: {
      documentType: "finding",
      title: "DOCAPI upload test",
      originalFilename: "upload-test.pdf",
      mimeType: "application/pdf",
      fileBase64: pdfBase64
    }
  });
  expect(uploadResponse.status()).toBe(201);
  const uploadedDocument = await uploadResponse.json();
  expect(uploadedDocument).toMatchObject({
    id: expect.any(Number),
    patientId: patient.id,
    title: "DOCAPI upload test",
    source: "upload",
    originalFilename: "upload-test.pdf",
    mimeType: "application/pdf"
  });

  const scanPath = path.join(scannerInbox, `docapi-scan-${stamp}.pdf`);
  fs.writeFileSync(scanPath, Buffer.from("%PDF-1.4\n% Scan PDF\n"));
  const scanResponse = await request.post(`${baseURL}/api/patients/${patient.id}/documents/import-scan`, {
    headers: authHeaders("staff"),
    data: {
      documentType: "consent",
      title: "DOCAPI scanner test"
    }
  });
  expect(scanResponse.status()).toBe(201);
  const scannedDocument = await scanResponse.json();
  expect(scannedDocument).toMatchObject({
    id: expect.any(Number),
    patientId: patient.id,
    title: "DOCAPI scanner test",
    source: "scanner",
    mimeType: "application/pdf"
  });

  const listResponse = await request.get(`${baseURL}/api/patients/${patient.id}/documents`, {
    headers: authHeaders("staff")
  });
  expect(listResponse.ok()).toBeTruthy();
  const documents = await listResponse.json();
  expect(documents.find(document => document.id === uploadedDocument.id)).toMatchObject({
    title: "DOCAPI upload test",
    source: "upload",
    originalFilename: "upload-test.pdf",
    mimeType: "application/pdf"
  });
  expect(documents.find(document => document.id === scannedDocument.id)).toMatchObject({
    title: "DOCAPI scanner test",
    source: "scanner",
    mimeType: "application/pdf"
  });
});
