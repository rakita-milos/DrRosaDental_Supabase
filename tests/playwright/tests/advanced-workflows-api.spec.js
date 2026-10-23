const { test, expect } = require("@playwright/test");
const { cleanupRegressionData } = require("../utils/cleanup");
const { authenticate } = require('../utils/auth');
const { NewEntryPage } = require('../pages/NewEntryPage');
const { PatientDashboardPage } = require('../pages/PatientDashboardPage');
const {
  authHeaders,
  apiGet,
  apiPut,
  createPatient,
  createRecord,
  createTreatmentPlan,
  acceptTreatmentPlan,
  createPerioChart,
  createInvoice,
  addInvoicePayment,
  createInsuranceClaim,
  publicBookingOptions,
  publicAvailability,
  createPublicBooking
} = require("../utils/api");

const TEST_PREFIX = "ADVAPI";
const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

async function loseFirstPaymentResponse(page, pattern, failure) {
  const keys = [];
  await page.route(pattern, async route => {
    keys.push(route.request().headers()['idempotency-key']);
    if (keys.length === 1) {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      if (failure === 'network') await route.abort('failed');
      else await route.fulfill({ response, body: '{"incomplete":' });
    } else await route.continue();
  });
  return keys;
}

for (const failure of ['network', 'json']) {
  test(`visit payment controls recover a committed but lost ${failure} response${failure === 'json' ? ' on mobile' : ''}`, async ({ page, request, baseURL }) => {
    if (failure === 'json') await page.setViewportSize({ width: 390, height: 844 });
    const stamp = Date.now();
    const patient = await createPatient(request, baseURL, { firstName: `${TEST_PREFIX}${stamp}`, lastName: 'Retry', email: `retry.${stamp}@example.com` });
    const record = await createRecord(request, baseURL, { patientId: patient.id, amount: 300, totalAmount: 300, currency: 'RSD', paymentParts: [], note: `${TEST_PREFIX} lost response` });
    await authenticate(page, 'staff');
    const entry = new NewEntryPage(page);
    await entry.gotoPatient(patient.id);
    const keys = await loseFirstPaymentResponse(page, `**/api/records/${record.id}/payment-parts`, failure);
    await entry.openDebtPayment(record.id);
    await entry.debtPaymentAmount.fill('100');
    await entry.debtPaymentSubmit.click();
    await expect(entry.debtPaymentSubmit).toHaveText('Proveri uplatu');
    await expect(entry.debtPaymentContext).toContainText('nije potvrđen');
    await expect(entry.debtPaymentAmount).toBeDisabled();
    await entry.debtPaymentSubmit.click();
    await expect(entry.debtPaymentPanel).toBeHidden();
    let saved = await apiGet(request, baseURL, `/api/records/${record.id}`);
    expect(Number(saved.amount_due)).toBe(200);
    expect(saved.paymentParts).toHaveLength(1);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    await entry.openDebtPayment(record.id);
    await expect(entry.debtPaymentAmount).toBeEnabled();
    await entry.debtPaymentAmount.fill('100');
    await entry.debtPaymentSubmit.click();
    await expect(entry.debtPaymentPanel).toBeHidden();
    saved = await apiGet(request, baseURL, `/api/records/${record.id}`);
    expect(Number(saved.amount_due)).toBe(100);
    expect(saved.paymentParts).toHaveLength(2);
    expect(keys[2]).not.toBe(keys[0]);
  });

  test(`invoice payment controls recover a committed but lost ${failure} response${failure === 'json' ? ' on mobile' : ''}`, async ({ page, request, baseURL }) => {
    if (failure === 'json') await page.setViewportSize({ width: 390, height: 844 });
    const stamp = Date.now();
    const patient = await createPatient(request, baseURL, { firstName: `${TEST_PREFIX}${stamp}`, lastName: 'InvoiceRetry', email: `invoice.retry.${stamp}@example.com` });
    const invoice = await createInvoice(request, baseURL, patient.id, { currency: 'RSD', items: [{ description: 'Synthetic exam', quantity: 1, unitPrice: 300 }] });
    await authenticate(page, 'staff');
    const dashboard = new PatientDashboardPage(page);
    await dashboard.gotoPatient(patient.id);
    const keys = await loseFirstPaymentResponse(page, `**/api/invoices/${invoice.id}/payments`, failure);
    await dashboard.payInvoice(invoice.id, 100);
    await expect(dashboard.invoiceMessage).toContainText('nije potvrđen');
    await expect(dashboard.invoicePaymentButton(invoice.id)).toHaveText('Proveri uplatu');
    await dashboard.payInvoice(invoice.id);
    await expect(dashboard.invoiceMessage).toContainText('Uplata je sačuvana');
    await expect(dashboard.invoicePaymentButton(invoice.id)).toBeEnabled();
    let saved = (await apiGet(request, baseURL, `/api/patients/${patient.id}/invoices`)).find(row => row.id === invoice.id);
    expect(saved.amountPaid).toBe(100);
    expect(saved.payments).toHaveLength(1);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    await dashboard.payInvoice(invoice.id, 100);
    await expect.poll(async () => (await apiGet(request, baseURL, `/api/patients/${patient.id}/invoices`)).find(row => row.id === invoice.id).amountPaid).toBe(200);
    saved = (await apiGet(request, baseURL, `/api/patients/${patient.id}/invoices`)).find(row => row.id === invoice.id);
    expect(saved.payments).toHaveLength(2);
    expect(keys[2]).not.toBe(keys[0]);
  });
}

for (const outcome of ['success', 'network']) {
  for (const action of ['close', 'switch']) {
    test(`visit payment ${outcome} response respects a ${action === 'close' ? 'closed' : 'switched'} form`, async ({ page, request, baseURL }) => {
      const stamp = Date.now();
      const patient = await createPatient(request, baseURL, { firstName: `${TEST_PREFIX}${stamp}`, lastName: 'FormRace', email: `race.${stamp}@example.com` });
      const record = await createRecord(request, baseURL, { patientId: patient.id, amount: 300, totalAmount: 300, currency: 'RSD', paymentParts: [], note: `${TEST_PREFIX} original payment` });
      const other = action === 'switch'
        ? await createRecord(request, baseURL, { patientId: patient.id, amount: 250, totalAmount: 250, currency: 'RSD', paymentParts: [], note: `${TEST_PREFIX} other visit` })
        : null;
      await authenticate(page, 'staff');
      const entry = new NewEntryPage(page);
      await entry.gotoPatient(patient.id);
      await entry.openDebtPayment(record.id);
      await entry.debtPaymentAmount.fill('100');
      const errors = [], keys = [];
      page.on('pageerror', error => errors.push(error.message));
      let release, committed;
      const gate = new Promise(resolve => { release = resolve; });
      const commit = new Promise(resolve => { committed = resolve; });
      await page.route(`**/api/records/${record.id}/payment-parts`, async route => {
        keys.push(route.request().headers()['idempotency-key']);
        if (keys.length > 1) return route.continue();
        const response = await route.fetch();
        committed(response.status());
        await gate;
        if (outcome === 'network') await route.abort('failed');
        else await route.fulfill({ response });
      });
      try {
        await entry.debtPaymentSubmit.click();
        expect(await commit).toBe(201);
        await entry.debtPaymentCancel.click();
        if (other) {
          await entry.openDebtPayment(other.id);
          await entry.debtPaymentAmount.fill('77.25');
        }
        release();
        await expect(entry.alert).toContainText(outcome === 'network' ? 'Ishod uplate' : 'Uplata je dodata');
        if (other) {
          await expect(entry.debtPaymentPanel).toBeVisible();
          await expect(entry.debtPaymentRecordId).toHaveValue(String(other.id));
          await expect(entry.debtPaymentAmount).toHaveValue('77.25');
          await expect(entry.debtPaymentSubmit).toBeEnabled();
        } else await expect(entry.debtPaymentPanel).toBeHidden();
        if (outcome === 'network') {
          await entry.openDebtPayment(record.id);
          await expect(entry.debtPaymentSubmit).toHaveText('Proveri uplatu');
          await expect(entry.debtPaymentAmount).toBeDisabled();
          await expect(entry.debtPaymentAmount).toHaveValue('100');
          await entry.debtPaymentSubmit.click();
          await expect(entry.debtPaymentPanel).toBeHidden();
          expect(keys).toHaveLength(2);
          expect(keys[1]).toBe(keys[0]);
        }
        const saved = await apiGet(request, baseURL, `/api/records/${record.id}`);
        expect(saved.paymentParts).toHaveLength(1);
        expect(Number(saved.amount_due)).toBe(200);
        if (other) expect((await apiGet(request, baseURL, `/api/records/${other.id}`)).paymentParts).toHaveLength(0);
        expect(errors).toEqual([]);
      } finally { release(); }
    });
  }
}

function dateKeyInBelgrade(value) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(value));
  const part = type => parts.find(item => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

test.beforeEach(async ({ request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
});

test.afterEach(async ({ request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
  const restored = await apiPut(request, baseURL, "/api/director/public-booking/settings", { enabled: false }, "director");
  expect(restored.configuredEnabled).toBe(false);
});

test("api: public booking creates an appointment and patient", async ({ request, baseURL }) => {
  const feature = await apiPut(request, baseURL, "/api/director/public-booking/settings", { enabled: true }, "director");
  expect(feature.configuredEnabled).toBe(true);

  const stamp = Date.now();
  const options = await publicBookingOptions(request, baseURL);
  const procedureName = options.procedures[0]?.label;
  expect(procedureName).toBeTruthy();
  const future = new Date(`${dateKeyInBelgrade(Date.now())}T12:00:00Z`);
  future.setUTCDate(future.getUTCDate() + 7);
  while ([0, 6].includes(future.getUTCDay())) future.setUTCDate(future.getUTCDate() + 1);
  const bookingDate = dateKeyInBelgrade(future);
  const nextDay = new Date(future); nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const availability = await publicAvailability(request, baseURL, {
    date: bookingDate,
    doctor_id: options.doctors[0].id,
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
    procedureName,
    startsAt: slot.startsAt,
    durationMinutes: 30,
    notes: `${TEST_PREFIX} public booking`
  });
  expect(booking).toMatchObject({
    status: "booked",
    appointmentId: expect.any(Number),
    patientId: expect.any(Number)
  });

  const appointments = await apiGet(request, baseURL, `/api/appointments?from=${bookingDate}T00:00:00.000Z&to=${dateKeyInBelgrade(nextDay)}T00:00:00.000Z`, "staff");
  expect(appointments.find(item => item.id === booking.appointmentId)).toMatchObject({
    patientId: booking.patientId,
    doctorId: slot.doctorId,
    chairId: slot.chairId,
    procedureName,
    startsAt: slot.startsAt
  });
  const bookedPatient = await apiGet(request, baseURL, `/api/patients/${booking.patientId}`, "staff");
  expect(bookedPatient).toMatchObject({
    id: booking.patientId,
    first_name: `${TEST_PREFIX}${stamp}`,
    last_name: "Booking",
    email: `${TEST_PREFIX.toLowerCase()}.${stamp}@example.com`
  });

  const disabled = await apiPut(request, baseURL, "/api/director/public-booking/settings", { enabled: false }, "director");
  expect(disabled.configuredEnabled).toBe(false);
});

test("api: treatment plan, perio, invoice and insurance workflows", async ({ request, baseURL }) => {
  const stamp = Date.now();
  const patient = await createPatient(request, baseURL, {
    firstName: `${TEST_PREFIX}${stamp}`,
    lastName: "Patient",
    email: `${TEST_PREFIX.toLowerCase()}.${stamp}@example.com`
  });
  expect(patient).toMatchObject({
    id: expect.any(Number),
    first_name: `${TEST_PREFIX}${stamp}`,
    last_name: "Patient",
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
  expect(plan).toMatchObject({
    id: expect.any(Number),
    patientId: patient.id,
    title: `${TEST_PREFIX} plan`,
    status: "presented",
    currency: "EUR",
    total: 850
  });
  expect(plan.total).toBe(850);
  expect(plan.items).toHaveLength(2);

  let plans = await apiGet(request, baseURL, `/api/patients/${patient.id}/treatment-plans`);
  expect(plans.find(item => item.id === plan.id)).toMatchObject({ title: `${TEST_PREFIX} plan`, status: "presented", total: 850 });

  const accepted = await acceptTreatmentPlan(request, baseURL, plan.id, {
    signatureName: "ADVAPI Patient",
    signatureData: "ADVAPI Patient"
  });
  expect(accepted.status).toBe("accepted");
  expect(accepted.acceptedAt).toBeTruthy();
  expect(accepted.signatureName).toBe("ADVAPI Patient");
  plans = await apiGet(request, baseURL, `/api/patients/${patient.id}/treatment-plans`);
  expect(plans.find(item => item.id === plan.id)).toMatchObject({
    status: "accepted",
    signatureName: "ADVAPI Patient",
    acceptedAt: expect.any(String)
  });

  const perio = await createPerioChart(request, baseURL, patient.id, {
    chartDate: "2026-07-02",
    measurements: [
      { toothNumber: "16", site: "MB", pocketDepth: 6, bleeding: true, recession: 2, mobility: 1, furcation: 1 },
      { toothNumber: "16", site: "B", pocketDepth: 4, bleeding: false }
    ]
  });
  expect(perio.measurements).toHaveLength(2);
  expect(perio.measurements).toEqual(expect.arrayContaining([
    expect.objectContaining({ toothNumber: "16", site: "MB", pocketDepth: 6, bleeding: true, recession: 2, mobility: 1, furcation: 1 }),
    expect.objectContaining({ toothNumber: "16", site: "B", pocketDepth: 4, bleeding: false })
  ]));
  const perioCharts = await apiGet(request, baseURL, `/api/patients/${patient.id}/perio-charts`);
  expect(perioCharts.find(item => item.id === perio.id)?.measurements).toEqual(expect.arrayContaining([
    expect.objectContaining({ toothNumber: "16", site: "MB", pocketDepth: 6, bleeding: true })
  ]));

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
  expect(chartEntry).toMatchObject({
    id: expect.any(Number),
    patientId: patient.id,
    toothNumber: "16",
    surfaces: expect.arrayContaining(["MO"]),
    diagnosis: "ADVAPI caries",
    procedureCode: "restoration",
    status: "planned",
    notes: "ADVAPI charting"
  });
  const chartList = await request.get(`${baseURL}/api/patients/${patient.id}/clinical-chart`, {
    headers: authHeaders("staff")
  });
  expect((await chartList.json()).some(item => item.id === chartEntry.id)).toBeTruthy();

  const templates = await request.get(`${baseURL}/api/clinical-note-templates`, {
    headers: authHeaders("staff")
  });
  expect(templates.ok()).toBeTruthy();
  expect(Array.isArray(await templates.json())).toBeTruthy();

  const noteResponse = await request.post(`${baseURL}/api/patients/${patient.id}/clinical-notes`, {
    headers: authHeaders("staff"),
    data: {
      title: "ADVAPI clinical note",
      body: "Subjektivno: test. Objektivno: test."
    }
  });
  expect(noteResponse.status()).toBe(201);
  const note = await noteResponse.json();
  expect(note).toMatchObject({
    id: expect.any(Number),
    patientId: patient.id,
    title: "ADVAPI clinical note",
    body: "Subjektivno: test. Objektivno: test."
  });
  const signedNote = await request.post(`${baseURL}/api/clinical-notes/${note.id}/sign`, {
    headers: authHeaders("staff"),
    data: { signedBy: "ADVAPI Doctor" }
  });
  expect(signedNote.ok()).toBeTruthy();
  expect(signedNote.status()).toBe(200);
  expect(await signedNote.json()).toMatchObject({ id: note.id, signedBy: "ADVAPI Doctor", signedAt: expect.any(String) });
  const notes = await apiGet(request, baseURL, `/api/patients/${patient.id}/clinical-notes`);
  expect(notes.find(item => item.id === note.id)).toMatchObject({
    title: "ADVAPI clinical note",
    signedBy: "ADVAPI Doctor",
    signedAt: expect.any(String)
  });

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
  const consent = await consentResponse.json();
  expect(consent).toMatchObject({
    id: expect.any(Number),
    patientId: patient.id,
    consentType: "treatment",
    title: "ADVAPI consent",
    signerName: "ADVAPI Patient",
    signedAt: expect.any(String)
  });
  const consents = await apiGet(request, baseURL, `/api/patients/${patient.id}/consents`);
  expect(consents.find(item => item.id === consent.id)).toMatchObject({
    title: "ADVAPI consent",
    body: "Pacijent prihvata predlozeni tretman.",
    signerName: "ADVAPI Patient"
  });

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
  expect(invoice).toMatchObject({
    id: expect.any(Number),
    patientId: patient.id,
    currency: "EUR",
    subtotal: 550,
    amountPaid: 0,
    balance: 550,
    items: expect.arrayContaining([
      expect.objectContaining({ description: "Implant", toothNumber: "16", quantity: 1, unitPrice: 600, discount: 100 }),
      expect.objectContaining({ description: "Kontrola", quantity: 1, unitPrice: 50 })
    ])
  });
  let invoices = await apiGet(request, baseURL, `/api/patients/${patient.id}/invoices`);
  expect(invoices.find(item => item.id === invoice.id)).toMatchObject({ total: 550, amountPaid: 0, balance: 550 });

  const paid = await addInvoicePayment(request, baseURL, invoice.id, {
    amount: 200,
    paymentType: "installment",
    paymentMethod: "cash",
    paymentDate: "2026-07-02"
  });
  expect(paid.amountPaid).toBe(200);
  expect(paid.status).toBe("partially_paid");
  expect(paid.balance).toBe(350);
  const persistedPayment = paid.payments.find(item => item.amount === 200 && item.paymentType === "installment");
  expect(persistedPayment).toMatchObject({ amount: 200, paymentType: "installment", paymentMethod: "cash" });
  expect(dateKeyInBelgrade(persistedPayment.paymentDate)).toBe("2026-07-02");
  invoices = await apiGet(request, baseURL, `/api/patients/${patient.id}/invoices`);
  expect(invoices.find(item => item.id === invoice.id)).toMatchObject({ status: "partially_paid", amountPaid: 200, balance: 350 });

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
  expect(claim).toMatchObject({
    id: expect.any(Number),
    patientId: patient.id,
    provider: "ADVAPI Insurance",
    policyNumber: "POL-123",
    requestedAmount: 550
  });
  let claims = await apiGet(request, baseURL, `/api/patients/${patient.id}/insurance-claims`);
  expect(claims.find(item => item.id === claim.id)).toMatchObject({ provider: "ADVAPI Insurance", requestedAmount: 550 });

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
  expect(imagingUpload.status()).toBe(201);
  const image = await imagingUpload.json();
  expect(image).toMatchObject({
    id: expect.any(Number),
    patientId: patient.id,
    documentType: "rtg",
    title: "ADVAPI X-ray",
    originalFilename: "advapi-xray.png",
    mimeType: "image/png",
    imagingModality: "intraoral_xray",
    toothNumber: "16",
    claimAttachmentReady: true
  });
  let documents = await apiGet(request, baseURL, `/api/patients/${patient.id}/documents`);
  expect(documents.find(item => item.id === image.id)).toMatchObject({ title: "ADVAPI X-ray", imagingModality: "intraoral_xray", toothNumber: "16" });

  const analyzed = await request.post(`${baseURL}/api/documents/${image.id}/imaging/analyze`, {
    headers: authHeaders("staff")
  });
  expect(analyzed.status()).toBe(200);
  const analyzedDocument = await analyzed.json();
  expect(analyzedDocument.id).toBe(image.id);
  expect(analyzedDocument.aiFindings.length).toBeGreaterThan(0);
  documents = await apiGet(request, baseURL, `/api/patients/${patient.id}/documents`);
  expect(documents.find(item => item.id === image.id)?.aiFindings.length).toBeGreaterThan(0);

  const attachment = await request.post(`${baseURL}/api/insurance-claims/${claim.id}/attachments`, {
    headers: authHeaders("staff"),
    data: { documentId: image.id, attachmentType: "xray" }
  });
  expect(attachment.status()).toBe(201);
  expect((await attachment.json()).claim.attachments).toEqual(expect.arrayContaining([
    expect.objectContaining({ documentId: image.id, attachmentType: "xray" })
  ]));

  const eligibility = await request.post(`${baseURL}/api/insurance-claims/${claim.id}/check-eligibility`, {
    headers: authHeaders("staff")
  });
  expect(eligibility.status()).toBe(200);
  expect(await eligibility.json()).toMatchObject({ id: claim.id, eligibilityStatus: "active", payerControlNumber: expect.any(String) });

  const submitted = await request.post(`${baseURL}/api/insurance-claims/${claim.id}/submit`, {
    headers: authHeaders("staff")
  });
  expect(submitted.status()).toBe(200);
  expect(await submitted.json()).toMatchObject({ id: claim.id, status: "submitted", submittedAt: expect.any(String) });

  const era = await request.post(`${baseURL}/api/insurance-claims/${claim.id}/era`, {
    headers: authHeaders("staff"),
    data: { paidAmount: 300, approvedAmount: 300 }
  });
  expect(era.status()).toBe(200);
  const posted = await era.json();
  expect(posted.eraStatus).toBe("received");
  expect(posted.eob.paidAmount).toBe(300);
  expect(posted).toMatchObject({ id: claim.id, status: "partially_approved", approvedAmount: 300, paidAmount: 300, ledgerStatus: "reconciled" });

  claims = await apiGet(request, baseURL, `/api/patients/${patient.id}/insurance-claims`);
  expect(claims.find(item => item.id === claim.id)).toMatchObject({
    status: "partially_approved",
    eligibilityStatus: "active",
    eraStatus: "received",
    approvedAmount: 300,
    paidAmount: 300,
    ledgerStatus: "reconciled",
    attachments: expect.arrayContaining([expect.objectContaining({ documentId: image.id, attachmentType: "xray" })])
  });

  const ledger = await request.get(`${baseURL}/api/patients/${patient.id}/ledger`, {
    headers: authHeaders("staff")
  });
  expect(ledger.ok()).toBeTruthy();
  const ledgerBody = await ledger.json();
  expect(ledgerBody.entries.some(entry => entry.entryType === "insurance_payment")).toBeTruthy();
});

test("api: invalid billing and cross-patient document links do not persist partial data", async ({ request, baseURL }) => {
  const stamp = Date.now();
  const owner = await createPatient(request, baseURL, {
    firstName: `${TEST_PREFIX}Owner${stamp}`,
    lastName: "Patient",
    email: `${TEST_PREFIX.toLowerCase()}.owner.${stamp}@example.com`
  });
  const other = await createPatient(request, baseURL, {
    firstName: `${TEST_PREFIX}Other${stamp}`,
    lastName: "Patient",
    email: `${TEST_PREFIX.toLowerCase()}.other.${stamp}@example.com`
  });
  const ownerRecord = await createRecord(request, baseURL, {
    patientId: owner.id,
    visitDate: "2026-07-05",
    procedure: "Kontrola",
    amount: 100,
    note: `${TEST_PREFIX} owner visit ${stamp}`
  });

  const invoicesBefore = await apiGet(request, baseURL, `/api/patients/${other.id}/invoices`);
  const emptyInvoice = await request.post(`${baseURL}/api/patients/${other.id}/invoices`, {
    headers: authHeaders("staff"),
    data: { issueDate: "2026-07-05", currency: "EUR", items: [] }
  });
  expect(emptyInvoice.status()).toBe(400);
  expect(await emptyInvoice.json()).toHaveProperty("error", expect.stringContaining("stavku"));
  expect(await apiGet(request, baseURL, `/api/patients/${other.id}/invoices`)).toHaveLength(invoicesBefore.length);

  const claimsBefore = await apiGet(request, baseURL, `/api/patients/${other.id}/insurance-claims`);
  const zeroClaim = await request.post(`${baseURL}/api/patients/${other.id}/insurance-claims`, {
    headers: authHeaders("staff"),
    data: { provider: `${TEST_PREFIX} Insurance`, requestedAmount: 0 }
  });
  expect(zeroClaim.status()).toBe(400);
  expect(await zeroClaim.json()).toHaveProperty("error", expect.stringContaining("veci od 0"));
  expect(await apiGet(request, baseURL, `/api/patients/${other.id}/insurance-claims`)).toHaveLength(claimsBefore.length);

  const documentsBefore = await apiGet(request, baseURL, `/api/patients/${other.id}/documents`);
  const crossPatientDocument = await request.post(`${baseURL}/api/patients/${other.id}/documents`, {
    headers: authHeaders("staff"),
    data: {
      visitRecordId: ownerRecord.id,
      documentType: "photo",
      title: `${TEST_PREFIX} forbidden document`,
      originalFilename: "forbidden.png",
      mimeType: "image/png",
      fileBase64: ONE_PIXEL_PNG
    }
  });
  expect(crossPatientDocument.status()).toBe(400);
  expect(await crossPatientDocument.json()).toHaveProperty("error", "Visit record does not belong to this patient");
  expect(await apiGet(request, baseURL, `/api/patients/${other.id}/documents`)).toHaveLength(documentsBefore.length);

  const ownerInvoice = await createInvoice(request, baseURL, owner.id, {
    visitRecordId: ownerRecord.id,
    issueDate: "2026-07-05",
    currency: "EUR",
    items: [{ description: "Kontrola", quantity: 1, unitPrice: 100 }]
  });
  const crossPatientClaim = await request.post(`${baseURL}/api/patients/${other.id}/insurance-claims`, {
    headers: authHeaders("staff"),
    data: {
      provider: `${TEST_PREFIX} Insurance`,
      requestedAmount: 100,
      invoiceId: ownerInvoice.id
    }
  });
  expect(crossPatientClaim.status()).toBe(400);
  expect(await crossPatientClaim.json()).toHaveProperty("error", "Invoice does not belong to this patient");
  expect(await apiGet(request, baseURL, `/api/patients/${other.id}/insurance-claims`)).toHaveLength(claimsBefore.length);
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
