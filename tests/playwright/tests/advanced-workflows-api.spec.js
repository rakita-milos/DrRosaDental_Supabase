const { test, expect } = require("@playwright/test");
const { cleanupRegressionData } = require("../utils/cleanup");
const {
  authHeaders,
  apiGet,
  apiPut,
  createPatient,
  createTreatmentPlan,
  acceptTreatmentPlan,
  createPerioChart,
  createInvoice,
  addInvoicePayment,
  createInsuranceClaim,
  publicAvailability,
  createPublicBooking
} = require("../utils/api");

const TEST_PREFIX = "ADVAPI";
const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

test.beforeEach(async ({ request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
});

test.afterEach(async ({ request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
});

test("api: public booking creates an appointment and patient", async ({ request, baseURL }) => {
  const stamp = Date.now();
  const availability = await publicAvailability(request, baseURL, {
    date: "2026-07-01",
    doctor_id: 1,
    duration: 30
  });
  expect(availability.slots.length).toBeGreaterThan(0);
  const slot = availability.slots[0];

  const booking = await createPublicBooking(request, baseURL, {
    firstName: `${TEST_PREFIX}${stamp}`,
    lastName: "Booking",
    email: `${TEST_PREFIX.toLowerCase()}.${stamp}@example.com`,
    phone: "060111222",
    doctorId: slot.doctorId,
    chairId: slot.chairId,
    procedureName: "Kontrola",
    startsAt: slot.startsAt,
    durationMinutes: 30,
    notes: `${TEST_PREFIX} public booking`
  });
  expect(booking).toMatchObject({ status: "booked" });

  const appointments = await apiGet(request, baseURL, "/api/appointments?from=2026-07-01T00:00:00.000Z&to=2026-07-02T00:00:00.000Z", "staff");
  expect(appointments.some(item => item.id === booking.appointmentId)).toBeTruthy();
});

test("api: treatment plan, perio, invoice and insurance workflows", async ({ request, baseURL }) => {
  const stamp = Date.now();
  const patient = await createPatient(request, baseURL, {
    firstName: `${TEST_PREFIX}${stamp}`,
    lastName: "Patient",
    email: `${TEST_PREFIX.toLowerCase()}.${stamp}@example.com`
  });

  const plan = await createTreatmentPlan(request, baseURL, patient.id, {
    title: `${TEST_PREFIX} plan`,
    status: "presented",
    currency: "EUR",
    items: [
      { phase: 1, toothNumber: "16", procedureName: "Implant", quantity: 1, unitPrice: 600, discount: 50 },
      { phase: 2, toothNumber: "16", procedureName: "Krunica", quantity: 1, unitPrice: 300 }
    ]
  });
  expect(plan.total).toBe(850);

  const accepted = await acceptTreatmentPlan(request, baseURL, plan.id, {
    signatureName: "ADVAPI Patient",
    signatureData: "ADVAPI Patient"
  });
  expect(accepted.status).toBe("accepted");
  expect(accepted.acceptedAt).toBeTruthy();

  const perio = await createPerioChart(request, baseURL, patient.id, {
    chartDate: "2026-07-02",
    measurements: [
      { toothNumber: "16", site: "MB", pocketDepth: 6, bleeding: true, recession: 2, mobility: 1, furcation: 1 },
      { toothNumber: "16", site: "B", pocketDepth: 4, bleeding: false }
    ]
  });
  expect(perio.measurements).toHaveLength(2);
  expect(perio.measurements[0]).toHaveProperty("pocketDepth");

  const chartResponse = await request.post(`${baseURL}/api/patients/${patient.id}/clinical-chart`, {
    headers: authHeaders("staff"),
    data: {
      toothNumber: "16",
      surfaces: ["MO"],
      cdtCode: "D2391",
      adaCode: "2391",
      diagnosis: "ADVAPI caries",
      procedureCode: "restoration",
      status: "planned",
      phase: 1,
      notes: "ADVAPI charting"
    }
  });
  expect(chartResponse.status()).toBe(201);
  const chartEntry = await chartResponse.json();
  expect(chartEntry.surfaces).toContain("MO");
  const chartList = await request.get(`${baseURL}/api/patients/${patient.id}/clinical-chart`, {
    headers: authHeaders("staff")
  });
  expect((await chartList.json()).some(item => item.id === chartEntry.id)).toBeTruthy();

  const templates = await request.get(`${baseURL}/api/clinical-note-templates`, {
    headers: authHeaders("staff")
  });
  expect(templates.ok()).toBeTruthy();
  expect((await templates.json()).length).toBeGreaterThan(0);

  const noteResponse = await request.post(`${baseURL}/api/patients/${patient.id}/clinical-notes`, {
    headers: authHeaders("staff"),
    data: {
      title: "ADVAPI clinical note",
      body: "Subjektivno: test. Objektivno: test."
    }
  });
  expect(noteResponse.status()).toBe(201);
  const note = await noteResponse.json();
  const signedNote = await request.post(`${baseURL}/api/clinical-notes/${note.id}/sign`, {
    headers: authHeaders("staff"),
    data: { signedBy: "ADVAPI Doctor" }
  });
  expect(signedNote.ok()).toBeTruthy();
  expect((await signedNote.json()).signedBy).toBe("ADVAPI Doctor");

  const consentResponse = await request.post(`${baseURL}/api/patients/${patient.id}/consents`, {
    headers: authHeaders("staff"),
    data: {
      consentType: "treatment",
      title: "ADVAPI consent",
      body: "Pacijent prihvata predlozeni tretman.",
      signerName: "ADVAPI Patient",
      signatureData: "ADVAPI Patient"
    }
  });
  expect(consentResponse.status()).toBe(201);
  const consents = await request.get(`${baseURL}/api/patients/${patient.id}/consents`, {
    headers: authHeaders("staff")
  });
  expect((await consents.json()).some(item => item.title === "ADVAPI consent")).toBeTruthy();

  const invoice = await createInvoice(request, baseURL, patient.id, {
    issueDate: "2026-07-02",
    dueDate: "2026-07-12",
    currency: "EUR",
    items: [
      { description: "Implant", toothNumber: "16", quantity: 1, unitPrice: 600, discount: 100 },
      { description: "Kontrola", quantity: 1, unitPrice: 50 }
    ]
  });
  expect(invoice.invoiceNumber).toContain("DR-");
  expect(invoice.total).toBe(550);

  const paid = await addInvoicePayment(request, baseURL, invoice.id, {
    amount: 200,
    paymentType: "installment",
    paymentMethod: "cash",
    paymentDate: "2026-07-02"
  });
  expect(paid.amountPaid).toBe(200);
  expect(paid.status).toBe("partially_paid");

  const pdf = await request.get(`${baseURL}/api/invoices/${invoice.id}/pdf`, {
    headers: authHeaders("staff")
  });
  expect(pdf.ok()).toBeTruthy();
  expect(await pdf.text()).toContain(invoice.invoiceNumber);

  const claim = await createInsuranceClaim(request, baseURL, patient.id, {
    provider: "ADVAPI Insurance",
    policyNumber: "POL-123",
    status: "eligibility_checked",
    requestedAmount: 550,
    eligibilityNotes: "Eligibility checked"
  });
  expect(claim.status).toBe("eligibility_checked");
  expect(claim.requestedAmount).toBe(550);

  const imagingUpload = await request.post(`${baseURL}/api/patients/${patient.id}/documents`, {
    headers: authHeaders("staff"),
    data: {
      documentType: "rtg",
      title: "ADVAPI X-ray",
      originalFilename: "advapi-xray.png",
      mimeType: "image/png",
      fileBase64: ONE_PIXEL_PNG,
      imagingModality: "intraoral_xray",
      toothNumber: "16",
      claimAttachmentReady: true
    }
  });
  expect(imagingUpload.ok()).toBeTruthy();
  const image = await imagingUpload.json();
  expect(image.imagingModality).toBe("intraoral_xray");

  const analyzed = await request.post(`${baseURL}/api/documents/${image.id}/imaging/analyze`, {
    headers: authHeaders("staff")
  });
  expect(analyzed.ok()).toBeTruthy();
  expect((await analyzed.json()).aiFindings.length).toBeGreaterThan(0);

  const attachment = await request.post(`${baseURL}/api/insurance-claims/${claim.id}/attachments`, {
    headers: authHeaders("staff"),
    data: { documentId: image.id, attachmentType: "xray" }
  });
  expect(attachment.ok()).toBeTruthy();
  expect((await attachment.json()).claim.attachments).toHaveLength(1);

  const eligibility = await request.post(`${baseURL}/api/insurance-claims/${claim.id}/check-eligibility`, {
    headers: authHeaders("staff")
  });
  expect(eligibility.ok()).toBeTruthy();
  expect((await eligibility.json()).eligibilityStatus).toBe("active");

  const submitted = await request.post(`${baseURL}/api/insurance-claims/${claim.id}/submit`, {
    headers: authHeaders("staff")
  });
  expect(submitted.ok()).toBeTruthy();
  expect((await submitted.json()).status).toBe("submitted");

  const era = await request.post(`${baseURL}/api/insurance-claims/${claim.id}/era`, {
    headers: authHeaders("staff"),
    data: { paidAmount: 300, approvedAmount: 300 }
  });
  expect(era.ok()).toBeTruthy();
  const posted = await era.json();
  expect(posted.eraStatus).toBe("received");
  expect(posted.eob.paidAmount).toBe(300);

  const ledger = await request.get(`${baseURL}/api/patients/${patient.id}/ledger`, {
    headers: authHeaders("staff")
  });
  expect(ledger.ok()).toBeTruthy();
  const ledgerBody = await ledger.json();
  expect(ledgerBody.entries.some(entry => entry.entryType === "insurance_payment")).toBeTruthy();
});

test("api: director saves Google OAuth settings without exposing client secret", async ({ request, baseURL }) => {
  const update = await apiPut(request, baseURL, "/api/director/google-calendar/settings", {
    connectedEmail: "advapi.calendar@example.com",
    calendarId: "primary",
    calendarName: "ADVAPI Calendar",
    clientId: "advapi-client-id",
    clientSecret: "advapi-client-secret",
    redirectUri: "http://localhost:3000/src/pages/director-panel.html",
    syncEnabled: false,
    syncDirection: "app_to_google",
    defaultReminderMinutes: 1440
  }, "director");
  expect(update.client_secret).toBeUndefined();

  const settings = await apiGet(request, baseURL, "/api/director/google-calendar/settings", "director");
  expect(settings.clientId).toBe("advapi-client-id");
  expect(settings.redirectUri).toContain("director-panel.html");
  expect(settings).not.toHaveProperty("clientSecret");
});
