const { test, expect } = require("@playwright/test");
const { cleanupRegressionData } = require("../utils/cleanup");
const { authHeaders, apiGet, apiPost, createAppointment, createPatient, firstChairId, firstDoctorId } = require("../utils/api");

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
    email: `${TEST_PREFIX.toLowerCase()}.${stamp}@example.test`
  });

  const appointment = await createAppointment(request, baseURL, {
    patientId: patient.id,
    startsAt: "2026-06-02T08:00:00.000Z",
    durationMinutes: 45,
    procedure: "Kontrola",
    note: `${TEST_PREFIX} create list update visit`
  });
  expect(appointment.status).toBe("scheduled");
  expect(["skipped", "synced", "pending"]).toContain(appointment.googleSyncStatus);

  const appointments = await apiGet(request, baseURL, "/api/appointments?from=2026-06-02T00:00:00.000Z&to=2026-06-03T00:00:00.000Z", "staff");
  expect(appointments.some(item => item.id === appointment.id)).toBeTruthy();

  const statusResponse = await request.patch(`${baseURL}/api/appointments/${appointment.id}/status`, {
    headers: authHeaders("staff"),
    data: { status: "confirmed" }
  });
  expect(statusResponse.ok()).toBeTruthy();
  expect((await statusResponse.json()).status).toBe("confirmed");

  const visitResponse = await request.post(`${baseURL}/api/appointments/${appointment.id}/create-visit`, {
    headers: authHeaders("staff"),
    data: { amount: 75, payment_status: "Placeno" }
  });
  expect(visitResponse.ok()).toBeTruthy();
  const visit = await visitResponse.json();
  expect(visit.appointmentId).toBe(appointment.id);
});

test("api regression: prevents doctor and chair overlapping active appointments", async ({ request, baseURL }) => {
  const stamp = Date.now();
  const doctorId = await firstDoctorId(request, baseURL);
  const chairId = await firstChairId(request, baseURL);
  const patient = await createPatient(request, baseURL, {
    firstName: `${TEST_PREFIX}Conflict${stamp}`,
    lastName: "Patient",
    email: `${TEST_PREFIX.toLowerCase()}.conflict.${stamp}@example.test`
  });

  await createAppointment(request, baseURL, {
    patientId: patient.id,
    doctorId,
    chairId,
    startsAt: "2026-06-03T09:00:00.000Z",
    durationMinutes: 60,
    note: `${TEST_PREFIX} conflict first`
  });

  const response = await request.post(`${baseURL}/api/appointments`, {
    headers: authHeaders("staff"),
    data: {
      patient_id: patient.id,
      doctor_id: doctorId,
      chair_id: chairId,
      procedure_name: "Plomba",
      starts_at: "2026-06-03T09:30:00.000Z",
      duration_minutes: 30,
      notes: `${TEST_PREFIX} conflict overlap`
    }
  });

  expect(response.status()).toBe(409);
  expect(await response.json()).toMatchObject({ error: expect.stringContaining("preklapa") });
});

test("integration: director configures Google Calendar settings and sync queue is processed locally", async ({ request, baseURL }) => {
  const settings = await apiPost(request, baseURL, "/api/director/google-calendar/test-sync", {}, "director");
  expect(settings).toHaveProperty("processed");

  const update = await request.put(`${baseURL}/api/director/google-calendar/settings`, {
    headers: authHeaders("director"),
    data: {
      connectedEmail: "ordinacija.drrosa@example.test",
      calendarId: "primary",
      calendarName: "Dr Rosa - Termini",
      syncEnabled: true,
      syncDirection: "app_to_google",
      defaultReminderMinutes: 1440
    }
  });
  expect(update.ok()).toBeTruthy();

  const saved = await apiGet(request, baseURL, "/api/director/google-calendar/settings", "director");
  expect(saved.connectedEmail).toBe("ordinacija.drrosa@example.test");
  expect(saved.syncEnabled).toBeTruthy();
});
