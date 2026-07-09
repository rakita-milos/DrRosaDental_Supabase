const { expect } = require("@playwright/test");
const { tokenFor } = require("./auth");

function authHeaders(role = "staff") {
  return {
    Authorization: `Bearer ${tokenFor(role)}`,
    "Content-Type": "application/json"
  };
}

async function apiGet(request, baseURL, path, role = "staff") {
  const response = await request.get(`${baseURL}${path}`, { headers: authHeaders(role) });
  expect(response.ok(), `${path} should return OK`).toBeTruthy();
  return response.json();
}

async function apiPost(request, baseURL, path, body, role = "staff") {
  const response = await request.post(`${baseURL}${path}`, {
    headers: authHeaders(role),
    data: body
  });
  expect(response.ok(), `${path} should create successfully`).toBeTruthy();
  return response.json();
}

async function apiPut(request, baseURL, path, body, role = "staff") {
  const response = await request.put(`${baseURL}${path}`, {
    headers: authHeaders(role),
    data: body
  });
  expect(response.ok(), `${path} should update successfully`).toBeTruthy();
  return response.json();
}

async function apiDelete(request, baseURL, path, role = "staff") {
  const response = await request.delete(`${baseURL}${path}`, { headers: authHeaders(role) });
  expect(response.ok(), `${path} should delete successfully`).toBeTruthy();
  return response.json();
}

async function createPatient(request, baseURL, data, role = "staff") {
  return apiPost(request, baseURL, "/api/patients", {
    first_name: data.firstName,
    last_name: data.lastName,
    date_of_birth: data.birthDate || "1986-05-08",
    gender: data.gender || "female",
    email: data.email,
    phone: data.phone || "060123456",
    address: data.address || "Playwright integration address",
    emergency_contact: data.emergencyContact || "Integration Contact",
    medical_history: data.medicalHistory || "Automated integration patient"
  }, role);
}

async function firstDoctorId(request, baseURL, role = "staff") {
  const doctors = await apiGet(request, baseURL, "/api/doctors", role);
  expect(doctors.length, "seeded doctors should exist").toBeGreaterThan(0);
  return doctors[0].id;
}

async function firstChairId(request, baseURL, role = "staff") {
  const chairs = await apiGet(request, baseURL, "/api/chairs", role);
  expect(chairs.length, "seeded chairs should exist").toBeGreaterThan(0);
  return chairs[0].id;
}

async function createRecord(request, baseURL, data, role = "staff") {
  const doctorId = data.doctorId || await firstDoctorId(request, baseURL, role);
  return apiPost(request, baseURL, "/api/records", {
    patient_id: data.patientId,
    doctor_id: doctorId,
    visit_date: data.visitDate || "2026-05-11",
    procedure: data.procedure || "Kontrola",
    status: data.status || "Zavrseno",
    shift: data.shift || "Prva smena",
    amount: data.amount ?? 120,
    total_amount: data.totalAmount,
    currency: data.currency || "EUR",
    paymentParts: data.paymentParts,
    payment_status: data.paymentStatus || "Dugovanje",
    total_discount: data.totalDiscount || 0,
    notes: data.note || "Automated integration visit",
    treatments: data.treatments || {
      "11": {
        type: data.procedure || "Kontrola",
        status: "Zavrseno",
        note: data.note || "Automated integration treatment",
        price: data.price ?? data.amount ?? 120,
        discount: 0
      }
    }
  }, role);
}

async function createAppointment(request, baseURL, data, role = "staff") {
  const doctorId = data.doctorId || await firstDoctorId(request, baseURL, role);
  const chairId = data.chairId || await firstChairId(request, baseURL, role);
  return apiPost(request, baseURL, "/api/appointments", {
    patient_id: data.patientId,
    doctor_id: doctorId,
    chair_id: chairId,
    procedure_name: data.procedure || "Kontrola",
    starts_at: data.startsAt,
    duration_minutes: data.durationMinutes || 30,
    status: data.status || "scheduled",
    notes: data.note || "Automated appointment"
  }, role);
}

async function createPatientWithRecord(request, baseURL, options, role = "staff") {
  const patient = await createPatient(request, baseURL, options.patient, role);
  const record = await createRecord(request, baseURL, {
    ...options.record,
    patientId: patient.id
  }, role);
  return { patient, record, fullName: `${options.patient.firstName} ${options.patient.lastName}` };
}

async function createCodebookItem(request, baseURL, item) {
  return apiPost(request, baseURL, "/api/director/codebooks", item, "director");
}

async function updateCodebookItem(request, baseURL, id, item) {
  return apiPut(request, baseURL, `/api/director/codebooks/${id}`, item, "director");
}

async function publicBookingOptions(request, baseURL) {
  const response = await request.get(`${baseURL}/api/public/booking/options`);
  expect(response.ok(), "public booking options should load").toBeTruthy();
  return response.json();
}

async function publicAvailability(request, baseURL, params) {
  const query = new URLSearchParams(params);
  const response = await request.get(`${baseURL}/api/public/booking/availability?${query}`);
  expect(response.ok(), "public availability should load").toBeTruthy();
  return response.json();
}

async function createPublicBooking(request, baseURL, body) {
  const response = await request.post(`${baseURL}/api/public/booking`, { data: body });
  expect(response.ok(), "public booking should create appointment").toBeTruthy();
  return response.json();
}

async function createTreatmentPlan(request, baseURL, patientId, body, role = "staff") {
  return apiPost(request, baseURL, `/api/patients/${patientId}/treatment-plans`, body, role);
}

async function acceptTreatmentPlan(request, baseURL, planId, body, role = "staff") {
  return apiPost(request, baseURL, `/api/treatment-plans/${planId}/accept`, body, role);
}

async function createPerioChart(request, baseURL, patientId, body, role = "staff") {
  return apiPost(request, baseURL, `/api/patients/${patientId}/perio-charts`, body, role);
}

async function createInvoice(request, baseURL, patientId, body, role = "staff") {
  return apiPost(request, baseURL, `/api/patients/${patientId}/invoices`, body, role);
}

async function addInvoicePayment(request, baseURL, invoiceId, body, role = "staff") {
  return apiPost(request, baseURL, `/api/invoices/${invoiceId}/payments`, body, role);
}

async function createInsuranceClaim(request, baseURL, patientId, body, role = "staff") {
  return apiPost(request, baseURL, `/api/patients/${patientId}/insurance-claims`, body, role);
}

module.exports = {
  authHeaders,
  apiGet,
  apiPost,
  apiPut,
  apiDelete,
  createPatient,
  createRecord,
  createAppointment,
  createPatientWithRecord,
  firstDoctorId,
  firstChairId,
  createCodebookItem,
  updateCodebookItem,
  publicBookingOptions,
  publicAvailability,
  createPublicBooking,
  createTreatmentPlan,
  acceptTreatmentPlan,
  createPerioChart,
  createInvoice,
  addInvoicePayment,
  createInsuranceClaim
};
