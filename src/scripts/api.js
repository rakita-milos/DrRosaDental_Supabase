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
    // Real login/refresh tokens are stored as httpOnly cookies by the server.
    // Preserve explicit legacy/test tokens only when no cookie refresh metadata is present.
    if (data.token && !data.refreshExpiresAt) {
      localStorage.setItem("drrosa-token", data.token);
    } else {
      localStorage.removeItem("drrosa-token");
    }
    localStorage.removeItem("drrosa-refresh-token");
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
    // Server will read refresh token from httpOnly cookie when present.
    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: 'include'
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
      headers,
      credentials: 'include'
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
      credentials: "include",
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
    try {
      await request("/auth/logout", { method: "POST" }, false);
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

  async function updatePatientDocument(documentId, document) {
    return request(`/documents/${documentId}`, {
      method: "PUT",
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

  async function getClinicalChart(patientId) {
    return request(`/patients/${patientId}/clinical-chart`);
  }

  async function createClinicalChartEntry(patientId, entry) {
    return request(`/patients/${patientId}/clinical-chart`, {
      method: "POST",
      body: JSON.stringify(entry)
    });
  }

  async function updateClinicalChartEntry(entryId, entry) {
    return request(`/clinical-chart/${entryId}`, {
      method: "PUT",
      body: JSON.stringify(entry)
    });
  }

  async function deleteClinicalChartEntry(entryId) {
    return request(`/clinical-chart/${entryId}`, { method: "DELETE" });
  }

  async function getClinicalNoteTemplates() {
    return request("/clinical-note-templates");
  }

  async function getClinicalNotes(patientId) {
    return request(`/patients/${patientId}/clinical-notes`);
  }

  async function createClinicalNote(patientId, note) {
    return request(`/patients/${patientId}/clinical-notes`, {
      method: "POST",
      body: JSON.stringify(note)
    });
  }

  async function updateClinicalNote(noteId, note) {
    return request(`/clinical-notes/${noteId}`, {
      method: "PUT",
      body: JSON.stringify(note)
    });
  }

  async function deleteClinicalNote(noteId) {
    return request(`/clinical-notes/${noteId}`, { method: "DELETE" });
  }

  async function signClinicalNote(noteId, payload) {
    return request(`/clinical-notes/${noteId}/sign`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async function getPatientConsents(patientId) {
    return request(`/patients/${patientId}/consents`);
  }

  async function createPatientConsent(patientId, consent) {
    return request(`/patients/${patientId}/consents`, {
      method: "POST",
      body: JSON.stringify(consent)
    });
  }

  async function updatePatientConsent(consentId, consent) {
    return request(`/consents/${consentId}`, {
      method: "PUT",
      body: JSON.stringify(consent)
    });
  }

  async function deletePatientConsent(consentId) {
    return request(`/consents/${consentId}`, { method: "DELETE" });
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

  async function checkInsuranceEligibility(claimId) {
    return request(`/insurance-claims/${claimId}/check-eligibility`, { method: "POST" });
  }

  async function attachDocumentToClaim(claimId, payload) {
    return request(`/insurance-claims/${claimId}/attachments`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async function submitInsuranceClaim(claimId, payload = {}) {
    return request(`/insurance-claims/${claimId}/submit`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async function postInsuranceEra(claimId, payload) {
    return request(`/insurance-claims/${claimId}/era`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async function getPatientLedger(patientId) {
    return request(`/patients/${patientId}/ledger`);
  }

  async function getPatientImaging(patientId) {
    return request(`/patients/${patientId}/imaging`);
  }

  async function updateDocumentImaging(documentId, payload) {
    return request(`/documents/${documentId}/imaging`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  }

  async function analyzeDocumentImaging(documentId) {
    return request(`/documents/${documentId}/imaging/analyze`, { method: "POST" });
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

  async function testRestoreBackup(backupId) {
    return request(`/director/backups/${backupId}/test-restore`, { method: "POST" });
  }

  async function getSecurityStatus() {
    return request("/director/security/status");
  }

  async function getAuditLog(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") query.set(key, value);
    });
    return request(`/director/security/audit-log${query.toString() ? `?${query}` : ""}`);
  }

  async function getSecuritySessions() {
    return request("/director/security/sessions");
  }

  async function revokeSecuritySession(sessionId) {
    return request(`/director/security/sessions/${sessionId}`, { method: "DELETE" });
  }

  async function updateUserPermissions(userId, permissions) {
    return request(`/director/security/users/${userId}/permissions`, {
      method: "PUT",
      body: JSON.stringify({ permissions })
    });
  }

  async function getLegalExport() {
    return request("/director/legal-export");
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
    updatePatientDocument,
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
    getClinicalChart,
    createClinicalChartEntry,
    updateClinicalChartEntry,
    deleteClinicalChartEntry,
    getClinicalNoteTemplates,
    getClinicalNotes,
    createClinicalNote,
    updateClinicalNote,
    deleteClinicalNote,
    signClinicalNote,
    getPatientConsents,
    createPatientConsent,
    updatePatientConsent,
    deletePatientConsent,
    getInvoices,
    createInvoice,
    addInvoicePayment,
    getInsuranceClaims,
    createInsuranceClaim,
    checkInsuranceEligibility,
    attachDocumentToClaim,
    submitInsuranceClaim,
    postInsuranceEra,
    getPatientLedger,
    getPatientImaging,
    updateDocumentImaging,
    analyzeDocumentImaging,
    getExchangeRate,
    getBackupStatus,
    getBackups,
    createBackup,
    restoreBackup,
    testRestoreBackup,
    getSecurityStatus,
    getAuditLog,
    getSecuritySessions,
    revokeSecuritySession,
    updateUserPermissions,
    getLegalExport,
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

  function initializeCustomSelects() {
    if (window.DrRosaCustomSelects?.initialized) return;
    const state = { initialized: true, selects: new WeakSet() };
    window.DrRosaCustomSelects = state;

    const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
    if (valueDescriptor?.set && !HTMLSelectElement.prototype.__drRosaValuePatched) {
      Object.defineProperty(HTMLSelectElement.prototype, "value", {
        get: valueDescriptor.get,
        set(value) {
          valueDescriptor.set.call(this, value);
          this.dispatchEvent(new Event("drrosa-select-value"));
        }
      });
      Object.defineProperty(HTMLSelectElement.prototype, "__drRosaValuePatched", { value: true });
    }

    function closeAll(except) {
      document.querySelectorAll(".custom-select-wrap.open").forEach(wrap => {
        if (wrap !== except) {
          wrap.classList.remove("open");
          wrap.querySelector(".custom-select-button")?.setAttribute("aria-expanded", "false");
        }
      });
    }

    function selectedText(select) {
      return select.selectedOptions[0]?.textContent?.trim()
        || select.querySelector("option")?.textContent?.trim()
        || "Odaberite";
    }

    function syncSelect(select) {
      const wrap = select.closest(".custom-select-wrap");
      if (!wrap) return;
      const button = wrap.querySelector(".custom-select-button");
      const list = wrap.querySelector(".custom-select-list");
      if (!button || !list) return;

      button.textContent = selectedText(select);
      button.disabled = select.disabled;
      list.innerHTML = Array.from(select.options).map((option, index) => {
        const selected = option.selected ? "true" : "false";
        const disabled = option.disabled ? "true" : "false";
        return `
          <button class="custom-select-option" type="button" role="option"
            data-option-index="${index}" aria-selected="${selected}" aria-disabled="${disabled}">
            ${escapeHtml(option.textContent)}
          </button>
        `;
      }).join("");
    }

    function enhanceSelect(select) {
      if (state.selects.has(select) || select.multiple || select.closest(".custom-select-wrap")) return;
      state.selects.add(select);

      const wrap = document.createElement("span");
      wrap.className = "custom-select-wrap";
      const button = document.createElement("button");
      button.className = "custom-select-button";
      button.type = "button";
      button.setAttribute("aria-haspopup", "listbox");
      button.setAttribute("aria-expanded", "false");
      const list = document.createElement("span");
      list.className = "custom-select-list";
      list.setAttribute("role", "listbox");

      select.parentNode.insertBefore(wrap, select);
      wrap.appendChild(select);
      wrap.appendChild(button);
      wrap.appendChild(list);
      select.classList.add("custom-select-native");

      button.addEventListener("click", event => {
        event.preventDefault();
        button.scrollIntoView({ block: "center", inline: "nearest" });
        syncSelect(select);
        const willOpen = !wrap.classList.contains("open");
        closeAll(willOpen ? wrap : null);
        wrap.classList.toggle("open", willOpen);
        button.setAttribute("aria-expanded", String(willOpen));
        if (willOpen) {
          requestAnimationFrame(() => {
            const overflow = list.getBoundingClientRect().bottom - window.innerHeight + 12;
            if (overflow > 0) window.scrollBy({ top: overflow, behavior: "auto" });
          });
        }
      });

      button.addEventListener("keydown", event => {
        if (!["ArrowDown", "Enter", " "].includes(event.key)) return;
        event.preventDefault();
        button.click();
        list.querySelector('[aria-selected="true"], .custom-select-option:not([aria-disabled="true"])')?.focus();
      });

      list.addEventListener("click", event => {
        const optionButton = event.target.closest(".custom-select-option");
        if (!optionButton || optionButton.getAttribute("aria-disabled") === "true") return;
        const option = select.options[Number(optionButton.dataset.optionIndex)];
        if (!option) return;
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        syncSelect(select);
        closeAll();
        button.focus();
      });

      list.addEventListener("keydown", event => {
        const options = Array.from(list.querySelectorAll('.custom-select-option:not([aria-disabled="true"])'));
        const currentIndex = options.indexOf(document.activeElement);
        if (event.key === "Escape") {
          closeAll();
          button.focus();
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          document.activeElement.click();
          return;
        }
        if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
        event.preventDefault();
        const nextIndex = event.key === "ArrowDown"
          ? Math.min(options.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1);
        options[nextIndex]?.focus();
      });

      select.addEventListener("change", () => syncSelect(select));
      select.addEventListener("drrosa-select-value", () => syncSelect(select));

      new MutationObserver(() => syncSelect(select)).observe(select, {
        childList: true,
        subtree: true,
        attributes: true
      });
      syncSelect(select);
    }

    function enhanceAll() {
      document.querySelectorAll("select").forEach(enhanceSelect);
    }

    document.addEventListener("click", event => {
      if (!event.target.closest(".custom-select-wrap")) closeAll();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") closeAll();
    });
    new MutationObserver(enhanceAll).observe(document.documentElement, { childList: true, subtree: true });
    enhanceAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeCustomSelects);
  } else {
    initializeCustomSelects();
  }
})();
