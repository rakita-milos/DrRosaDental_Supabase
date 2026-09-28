const { test, expect } = require("@playwright/test");
const { cleanupRegressionData } = require("../utils/cleanup");
const { authHeaders, apiGet, apiPost, createAppointment, createPatient, firstChairId, firstDoctorId, firstProcedure } = require("../utils/api");

const TEST_PREFIX = "CALAPI";

test.beforeEach(async ({ request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
});

test.afterEach(async ({ request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [TEST_PREFIX]);
});

test("api: creates, lists, updates status and creates visit from appointment", async ({ request, baseURL }) => {
  const stamp = Date.now();
  const patient = await createPatient(request, baseURL, {
    firstName: `${TEST_PREFIX}${stamp}`,
    lastName: "Patient",
    email: `${TEST_PREFIX.toLowerCase()}.${stamp}@example.com`
  });
  expect(patient).toMatchObject({
    id: expect.any(Number),
    first_name: `${TEST_PREFIX}${stamp}`,
    last_name: "Patient"
  });
  const procedure = await firstProcedure(request, baseURL);

  const appointment = await createAppointment(request, baseURL, {
    patientId: patient.id,
    startsAt: "2026-06-02T08:00:00.000Z",
    durationMinutes: 45,
    procedureId: procedure.id,
    procedure: procedure.name,
    note: `${TEST_PREFIX} create list update visit`
  });
  expect(appointment.status).toBe("scheduled");
  expect(["skipped", "synced", "pending"]).toContain(appointment.googleSyncStatus);
  expect(appointment).toMatchObject({
    id: expect.any(Number),
    patientId: patient.id,
    procedureName: procedure.name,
    startsAt: "2026-06-02T08:00:00.000Z",
    durationMinutes: 45,
    notes: `${TEST_PREFIX} create list update visit`
  });

  const appointments = await apiGet(request, baseURL, "/api/appointments?from=2026-06-02T00:00:00.000Z&to=2026-06-03T00:00:00.000Z", "staff");
  expect(appointments.some(item => item.id === appointment.id)).toBeTruthy();

  const statusResponse = await request.patch(`${baseURL}/api/appointments/${appointment.id}/status`, {
    headers: authHeaders("staff"),
    data: { status: "confirmed" }
  });
  expect(statusResponse.status()).toBe(200);
  expect(await statusResponse.json()).toMatchObject({ id: appointment.id, status: "confirmed" });
  let persistedAppointments = await apiGet(request, baseURL, "/api/appointments?from=2026-06-02T00:00:00.000Z&to=2026-06-03T00:00:00.000Z", "staff");
  expect(persistedAppointments.find(item => item.id === appointment.id)?.status).toBe("confirmed");

  const invalidStatus = await request.patch(`${baseURL}/api/appointments/${appointment.id}/status`, {
    headers: authHeaders("staff"),
    data: { status: "deleted" }
  });
  expect(invalidStatus.status()).toBe(400);
  expect(await invalidStatus.json()).toHaveProperty("error");
  persistedAppointments = await apiGet(request, baseURL, "/api/appointments?from=2026-06-02T00:00:00.000Z&to=2026-06-03T00:00:00.000Z", "staff");
  expect(persistedAppointments.find(item => item.id === appointment.id)?.status).toBe("confirmed");

  const visitResponse = await request.post(`${baseURL}/api/appointments/${appointment.id}/create-visit`, {
    headers: authHeaders("staff"),
    data: { amount: 75, payment_status: "Placeno" }
  });
  expect(visitResponse.status()).toBe(201);
  const visit = await visitResponse.json();
  expect(visit).toMatchObject({ id: expect.any(Number), appointmentId: appointment.id, message: "Visit created from appointment" });
  const records = await apiGet(request, baseURL, "/api/records", "staff");
  expect(records.find(item => item.id === visit.id)).toMatchObject({
    patient_id: patient.id,
    procedure: procedure.name,
    amount_paid: 0,
    total_amount: 75,
    payment_status: "Dugovanje"
  });
  persistedAppointments = await apiGet(request, baseURL, "/api/appointments?from=2026-06-02T00:00:00.000Z&to=2026-06-03T00:00:00.000Z", "staff");
  expect(persistedAppointments.find(item => item.id === appointment.id)).toMatchObject({ status: "completed", visitRecordId: visit.id });
});

test("api regression: prevents doctor and chair overlapping active appointments", async ({ request, baseURL }) => {
  const stamp = Date.now();
  const doctorId = await firstDoctorId(request, baseURL);
  const chairId = await firstChairId(request, baseURL);
  const procedure = await firstProcedure(request, baseURL);
  const patient = await createPatient(request, baseURL, {
    firstName: `${TEST_PREFIX}Conflict${stamp}`,
    lastName: "Patient",
    email: `${TEST_PREFIX.toLowerCase()}.conflict.${stamp}@example.com`
  });

  const firstAppointment = await createAppointment(request, baseURL, {
    patientId: patient.id,
    doctorId,
    chairId,
    startsAt: "2026-06-03T09:00:00.000Z",
    durationMinutes: 60,
    procedureId: procedure.id,
    procedure: procedure.name,
    note: `${TEST_PREFIX} conflict first`
  });

  const response = await request.post(`${baseURL}/api/appointments`, {
    headers: authHeaders("staff"),
    data: {
      patient_id: patient.id,
      doctor_id: doctorId,
      chair_id: chairId,
      procedure_id: procedure.id,
      procedure_name: procedure.name,
      starts_at: "2026-06-03T09:30:00.000Z",
      duration_minutes: 30,
      notes: `${TEST_PREFIX} conflict overlap`
    }
  });

  expect(response.status()).toBe(409);
  expect(await response.json()).toMatchObject({ error: expect.stringContaining("preklapa") });
  const appointments = await apiGet(request, baseURL, "/api/appointments?from=2026-06-03T00:00:00.000Z&to=2026-06-04T00:00:00.000Z", "staff");
  expect(appointments.filter(item => item.id === firstAppointment.id)).toHaveLength(1);
  expect(appointments.some(item => item.notes === `${TEST_PREFIX} conflict overlap`)).toBe(false);
});

test("integration: director configures Google Calendar settings and sync queue is processed locally", async ({ request, baseURL }) => {
  const settings = await apiPost(request, baseURL, "/api/director/google-calendar/test-sync", {}, "director");
  expect(settings).toHaveProperty("processed");

  const update = await request.put(`${baseURL}/api/director/google-calendar/settings`, {
    headers: authHeaders("director"),
    data: {
      connectedEmail: "ordinacija.drrosa@example.com",
      calendarId: "primary",
      calendarName: "Dr Rosa - Termini",
      syncEnabled: true,
      syncDirection: "app_to_google",
      defaultReminderMinutes: 1440
    }
  });
  expect(update.status()).toBe(200);
  expect(await update.json()).toMatchObject({
    connectedEmail: "ordinacija.drrosa@example.com",
    calendarId: "primary",
    syncEnabled: true,
    syncDirection: "app_to_google",
    defaultReminderMinutes: 1440
  });

  const saved = await apiGet(request, baseURL, "/api/director/google-calendar/settings", "director");
  expect(saved.connectedEmail).toBe("ordinacija.drrosa@example.com");
  expect(saved.syncEnabled).toBeTruthy();
});
