(function () {
  const API_BASE = window.DRROSA_API_BASE || "/api";

  const defaultRecords = [
    { patient: "Ana Kovac", lastVisit: "2026-04-28", procedure: "Kontrola i ciscenje", status: "Zakazano", note: "Follow-up za 2 tjedna", doctor: "Dr Rosa", visits: 1, paymentStatus: "Placeno", amountDue: 0 },
    { patient: "Marko Petrovic", lastVisit: "2026-04-18", procedure: "Plomba", status: "Zavrseno", note: "Nema naplata", doctor: "Dr Rosa", visits: 2, paymentStatus: "Placeno", amountDue: 0 },
    { patient: "Ivana Babic", lastVisit: "2026-04-22", procedure: "Izbeljivanje", status: "U tijeku", note: "Na 3 posjete", doctor: "Dr Rosa", visits: 3, paymentStatus: "Delimicno", amountDue: 150 },
    { patient: "Luka Horvat", lastVisit: "2026-04-30", procedure: "Most", status: "Zakazano", note: "Potrebna dodatna anamneza", doctor: "Dr Rosa", visits: 1, paymentStatus: "Placeno", amountDue: 0 },
    { patient: "Petar Juric", lastVisit: "2026-04-25", procedure: "Endodontija", status: "U tijeku", note: "Drugi termin zahtjevan", doctor: "Dr Novak", visits: 2, paymentStatus: "Dugovanje", amountDue: 200 }
  ];

  function getToken() {
    return localStorage.getItem("drrosa-token");
  }

  function getRefreshToken() {
    return localStorage.getItem("drrosa-refresh-token");
  }

  function getSession() {
    return JSON.parse(localStorage.getItem("drrosa-session") || "null");
  }

  function setSession(data) {
    localStorage.setItem("drrosa-token", data.token);
    if (data.refreshToken) {
      localStorage.setItem("drrosa-refresh-token", data.refreshToken);
    }
    localStorage.setItem("drrosa-session", JSON.stringify({
      ...(data.user || data),
      loginTime: new Date().toISOString(),
      refreshExpiresAt: data.refreshExpiresAt || null
    }));
  }

  function clearSession() {
    localStorage.removeItem("drrosa-token");
    localStorage.removeItem("drrosa-refresh-token");
    localStorage.removeItem("drrosa-session");
  }

  async function refreshSession() {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return null;
    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken })
    });
    if (!response.ok) {
      clearSession();
      return null;
    }
    const data = await response.json();
    setSession(data);
    return data;
  }

  async function request(path, options = {}, retry = true) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {})
    };

    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers
    });

    if (!response.ok) {
      if ((response.status === 401 || response.status === 403) && retry && path !== "/auth/refresh") {
        const refreshed = await refreshSession();
        if (refreshed) return request(path, options, false);
      }
      const message = await response.json().catch(() => ({}));
      throw new Error(message.error || "API request failed");
    }

    return response.json();
  }

  function fullName(patient) {
    return [patient.first_name || patient.firstName, patient.last_name || patient.lastName]
      .filter(Boolean)
      .join(" ");
  }

  function normalizeRecord(row) {
    if (row.patient && row.lastVisit) return row;
    const patient = row.patient || `${row.first_name || ""} ${row.last_name || ""}`.trim();
    return {
      id: row.id,
      patientId: row.patient_id,
      doctorId: row.doctor_id,
      patient,
      lastVisit: row.visit_date ? String(row.visit_date).slice(0, 10) : row.lastVisit,
      procedure: row.procedure,
      status: row.status,
      note: row.notes || row.note || "-",
      doctor: row.doctor_name || row.doctor || "-",
      visits: Number(row.visits || 1),
      paymentStatus: row.payment_status || row.paymentStatus || "Placeno",
      amountDue: Number(row.amount_due ?? row.amountDue ?? 0),
      currency: row.currency || row.paymentCurrency || "EUR",
      shift: row.shift || "Prva smena",
      totalDiscount: Number(row.total_discount ?? row.totalDiscount ?? 0),
      treatments: row.treatments || {}
    };
  }

  function getLocalRecords() {
    const saved = JSON.parse(localStorage.getItem("drrosa-records") || "[]");
    return saved.length > 0 ? saved : defaultRecords;
  }

  function getLocalPatients() {
    return JSON.parse(localStorage.getItem("drrosa-patients") || "[]");
  }

  async function login(email, password, role, twoFactorCode) {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, role, twoFactorCode })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok && data.requires2fa) return data;
    if (!response.ok) throw new Error(data.error || "API request failed");
    if (data.requires2fa) return data;
    setSession(data);
    return data.user;
  }

  async function logout() {
    const refreshToken = getRefreshToken();
    try {
      if (getToken()) {
        await request("/auth/logout", {
          method: "POST",
          body: JSON.stringify({ refreshToken })
        }, false);
      }
    } finally {
      clearSession();
    }
  }

  async function changePassword(currentPassword, newPassword) {
    return request("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword })
    });
  }

  async function verifySession(requiredRole) {
    const session = getSession();
    if (!session) return null;
    if (requiredRole && session.role !== requiredRole) return null;
    try {
      const data = await request("/auth/verify", { method: "POST" });
      if (requiredRole && data.user.role !== requiredRole) return null;
      setSession({ token: getToken(), user: data.user });
      return data.user;
    } catch (_error) {
      clearSession();
      return null;
    }
  }

  async function getPatients() {
    const patients = await request("/patients");
    return patients.map(patient => ({
      ...patient,
      firstName: patient.first_name,
      lastName: patient.last_name,
      birthDate: patient.date_of_birth,
      emergencyContact: patient.emergency_contact,
      fullName: fullName(patient)
    }));
  }

  async function createPatient(patient) {
    return request("/patients", {
      method: "POST",
      body: JSON.stringify({
        first_name: patient.firstName,
        last_name: patient.lastName,
        date_of_birth: patient.birthDate,
        email: patient.email,
        phone: patient.phone,
        address: patient.address,
        emergency_contact: patient.emergencyContact,
        gender: patient.gender,
        medical_history: patient.medicalHistory
      })
    });
  }

  async function updatePatient(patientId, patient) {
    return request(`/patients/${patientId}`, {
      method: "PUT",
      body: JSON.stringify({
        first_name: patient.firstName,
        last_name: patient.lastName,
        date_of_birth: patient.birthDate,
        email: patient.email,
        phone: patient.phone,
        address: patient.address,
        emergency_contact: patient.emergencyContact,
        gender: patient.gender,
        medical_history: patient.medicalHistory
      })
    });
  }

  async function deletePatient(patientId) {
    return request(`/patients/${patientId}`, { method: "DELETE" });
  }

  async function getMedicalProfile(patientId) {
    return request(`/patients/${patientId}/medical-profile`);
  }

  async function updateMedicalProfile(patientId, profile) {
    return request(`/patients/${patientId}/medical-profile`, {
      method: "PUT",
      body: JSON.stringify(profile)
    });
  }

  async function getPatientDocuments(patientId) {
    return request(`/patients/${patientId}/documents`);
  }

  async function createPatientDocument(patientId, document) {
    return request(`/patients/${patientId}/documents`, {
      method: "POST",
      body: JSON.stringify(document)
    });
  }

  async function importPatientScan(patientId, payload) {
    return request(`/patients/${patientId}/documents/import-scan`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async function deleteDocument(documentId) {
    return request(`/documents/${documentId}`, { method: "DELETE" });
  }

  async function getDoctors() {
    return request("/doctors");
  }

  async function getChairs() {
    return request("/chairs");
  }

  async function getAppointments(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") query.set(key, value);
    });
    return request(`/appointments${query.toString() ? `?${query}` : ""}`);
  }

  async function createAppointment(appointment) {
    return request("/appointments", {
      method: "POST",
      body: JSON.stringify(appointment)
    });
  }

  async function updateAppointment(appointmentId, appointment) {
    return request(`/appointments/${appointmentId}`, {
      method: "PUT",
      body: JSON.stringify(appointment)
    });
  }

  async function updateAppointmentStatus(appointmentId, status) {
    return request(`/appointments/${appointmentId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
  }

  async function deleteAppointment(appointmentId, { hard = false } = {}) {
    return request(`/appointments/${appointmentId}${hard ? "?hard=1" : ""}`, { method: "DELETE" });
  }

  async function createVisitFromAppointment(appointmentId, payload = {}) {
    return request(`/appointments/${appointmentId}/create-visit`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async function getGoogleCalendarSettings() {
    return request("/director/google-calendar/settings");
  }

  async function updateGoogleCalendarSettings(settings) {
    return request("/director/google-calendar/settings", {
      method: "PUT",
      body: JSON.stringify(settings)
    });
  }

  async function retryCalendarSync() {
    return request("/director/calendar-sync/retry", { method: "POST" });
  }

  async function testGoogleCalendarSync() {
    return request("/director/google-calendar/test-sync", { method: "POST" });
  }

  async function exchangeGoogleCalendarCode(code) {
    return request("/director/google-calendar/oauth/exchange", {
      method: "POST",
      body: JSON.stringify({ code })
    });
  }

  async function getPublicBookingOptions() {
    const response = await fetch(`${API_BASE}/public/booking/options`);
    if (!response.ok) throw new Error("Booking options unavailable");
    return response.json();
  }

  async function getPublicAvailability(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") query.set(key, value);
    });
    const response = await fetch(`${API_BASE}/public/booking/availability?${query}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Availability unavailable");
    return data;
  }

  async function createPublicBooking(payload) {
    const response = await fetch(`${API_BASE}/public/booking`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Booking failed");
    return data;
  }

  async function getTreatmentPlans(patientId) {
    return request(`/patients/${patientId}/treatment-plans`);
  }

  async function createTreatmentPlan(patientId, plan) {
    return request(`/patients/${patientId}/treatment-plans`, {
      method: "POST",
      body: JSON.stringify(plan)
    });
  }

  async function updateTreatmentPlan(planId, plan) {
    return request(`/treatment-plans/${planId}`, {
      method: "PUT",
      body: JSON.stringify(plan)
    });
  }

  async function acceptTreatmentPlan(planId, payload) {
    return request(`/treatment-plans/${planId}/accept`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async function getPerioCharts(patientId) {
    return request(`/patients/${patientId}/perio-charts`);
  }

  async function createPerioChart(patientId, chart) {
    return request(`/patients/${patientId}/perio-charts`, {
      method: "POST",
      body: JSON.stringify(chart)
    });
  }

  async function getInvoices(patientId) {
    return request(`/patients/${patientId}/invoices`);
  }

  async function createInvoice(patientId, invoice) {
    return request(`/patients/${patientId}/invoices`, {
      method: "POST",
      body: JSON.stringify(invoice)
    });
  }

  async function addInvoicePayment(invoiceId, payment) {
    return request(`/invoices/${invoiceId}/payments`, {
      method: "POST",
      body: JSON.stringify(payment)
    });
  }

  async function getInsuranceClaims(patientId) {
    return request(`/patients/${patientId}/insurance-claims`);
  }

  async function createInsuranceClaim(patientId, claim) {
    return request(`/patients/${patientId}/insurance-claims`, {
      method: "POST",
      body: JSON.stringify(claim)
    });
  }

  async function getRecords() {
    const records = await request("/records");
    return records.map(normalizeRecord);
  }

  async function createRecord(record) {
    return request("/records", {
      method: "POST",
      body: JSON.stringify({
        patient_id: record.patientId,
        doctor_id: record.doctorId,
        visit_date: record.lastVisit,
        procedure: record.procedure,
        status: record.status,
        notes: record.note,
        amount: record.amountDue,
        currency: record.currency,
        payment_status: record.paymentStatus,
        shift: record.shift,
        total_discount: record.totalDiscount,
        treatments: record.treatments
      })
    });
  }

  async function updateRecord(recordId, record) {
    return request(`/records/${recordId}`, {
      method: "PUT",
      body: JSON.stringify({
        procedure: record.procedure,
        status: record.status,
        notes: record.note,
        shift: record.shift
      })
    });
  }

  async function deleteRecord(recordId) {
    return request(`/records/${recordId}`, { method: "DELETE" });
  }

  async function getDirectorReport(type) {
    return request(`/director/reports/${type}`);
  }

  async function getCodebooks(type) {
    return request(`/codebooks${type ? `?type=${encodeURIComponent(type)}` : ""}`);
  }

  async function getAdminCodebooks(type) {
    return request(`/director/codebooks${type ? `?type=${encodeURIComponent(type)}` : ""}`);
  }

  async function createCodebookItem(item) {
    return request("/director/codebooks", {
      method: "POST",
      body: JSON.stringify(item)
    });
  }

  async function updateCodebookItem(itemId, item) {
    return request(`/director/codebooks/${itemId}`, {
      method: "PUT",
      body: JSON.stringify(item)
    });
  }

  async function deleteCodebookItem(itemId) {
    return request(`/director/codebooks/${itemId}`, { method: "DELETE" });
  }

  async function getExchangeRate(currency, base = "EUR") {
    return request(`/director/exchange-rate?base=${encodeURIComponent(base)}&currency=${encodeURIComponent(currency)}`);
  }

  async function getBackupStatus() {
    return request("/director/backups/status");
  }

  async function getBackups() {
    return request("/director/backups");
  }

  async function createBackup() {
    return request("/director/backups", { method: "POST" });
  }

  async function restoreBackup(backupId, confirmation) {
    return request(`/director/backups/${backupId}/restore`, {
      method: "POST",
      body: JSON.stringify({ confirmation })
    });
  }

  async function getSecurityStatus() {
    return request("/director/security/status");
  }

  async function unlockUser(userId) {
    return request(`/director/security/users/${userId}/unlock`, { method: "POST" });
  }

  async function resetUserPassword(userId, newPassword) {
    return request(`/director/security/users/${userId}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ newPassword })
    });
  }

  async function setupTwoFactor() {
    return request("/auth/2fa/setup", { method: "POST" });
  }

  async function verifyTwoFactor(code) {
    return request("/auth/2fa/verify", {
      method: "POST",
      body: JSON.stringify({ code })
    });
  }

  async function disableTwoFactor(password) {
    return request("/auth/2fa/disable", {
      method: "POST",
      body: JSON.stringify({ password })
    });
  }

  window.DrRosaApi = {
    login,
    logout,
    verifySession,
    changePassword,
    clearSession,
    getSession,
    getPatients,
    createPatient,
    updatePatient,
    deletePatient,
    getMedicalProfile,
    updateMedicalProfile,
    getPatientDocuments,
    createPatientDocument,
    importPatientScan,
    deleteDocument,
    getDoctors,
    getChairs,
    getAppointments,
    createAppointment,
    updateAppointment,
    updateAppointmentStatus,
    deleteAppointment,
    createVisitFromAppointment,
    getRecords,
    createRecord,
    updateRecord,
    deleteRecord,
    getDirectorReport,
    getCodebooks,
    getAdminCodebooks,
    createCodebookItem,
    updateCodebookItem,
    deleteCodebookItem,
    getGoogleCalendarSettings,
    updateGoogleCalendarSettings,
    retryCalendarSync,
    testGoogleCalendarSync,
    exchangeGoogleCalendarCode,
    getPublicBookingOptions,
    getPublicAvailability,
    createPublicBooking,
    getTreatmentPlans,
    createTreatmentPlan,
    updateTreatmentPlan,
    acceptTreatmentPlan,
    getPerioCharts,
    createPerioChart,
    getInvoices,
    createInvoice,
    addInvoicePayment,
    getInsuranceClaims,
    createInsuranceClaim,
    getExchangeRate,
    getBackupStatus,
    getBackups,
    createBackup,
    restoreBackup,
    getSecurityStatus,
    unlockUser,
    resetUserPassword,
    setupTwoFactor,
    verifyTwoFactor,
    disableTwoFactor,
    normalizeRecord,
    getLocalRecords
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function cell(value, className) {
    const td = document.createElement("td");
    if (className) td.className = className;
    td.textContent = value ?? "-";
    return td;
  }

  window.DrRosaSecurity = { escapeHtml, cell };
})();
