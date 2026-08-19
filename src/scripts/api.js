(function () {
  const API_BASE = window.DRROSA_API_BASE || "/api";
  const { escapeHtml, escapeAttribute } = window.DrRosaSecurity;

  function getSession() {
    return JSON.parse(localStorage.getItem("drrosa-session") || "null");
  }

  function syncDirectorNavigation(session = getSession()) {
    const isDirector = session?.role === "director";
    document.querySelectorAll("#director-panel-link").forEach(link => {
      link.hidden = !isDirector;
      link.style.display = isDirector ? "" : "none";
    });
  }

  function setSession(data) {
    localStorage.removeItem("drrosa-refresh-token");
    localStorage.removeItem("drrosa-token");
    const session = {
      ...(data.user || data),
      loginTime: new Date().toISOString(),
      refreshExpiresAt: data.refreshExpiresAt || null
    };
    localStorage.setItem("drrosa-session", JSON.stringify(session));
    syncDirectorNavigation(session);
  }

  function clearSession() {
    localStorage.removeItem("drrosa-token");
    localStorage.removeItem("drrosa-refresh-token");
    localStorage.removeItem("drrosa-session");
    clearReferenceCache();
    syncDirectorNavigation(null);
  }

  function apiError(message, status) {
    const error = new Error(message || "API request failed");
    if (status) error.status = status;
    return error;
  }

  function isAuthFailure(error) {
    return error?.status === 401 || error?.status === 403;
  }

  async function refreshSession() {
    // Server will read refresh token from httpOnly cookie when present.
    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: 'include'
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) clearSession();
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

    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      cache: "no-store",
      credentials: 'include'
    });

    if (!response.ok) {
      if ((response.status === 401 || response.status === 403) && retry && path !== "/auth/refresh") {
        const refreshed = await refreshSession();
        if (refreshed) return request(path, options, false);
      }
      const message = await response.json().catch(() => ({}));
      throw apiError(message.error || "API request failed", response.status);
    }

    return response.json();
  }

  const cachedRequests = new Map();

  function cachedRequest(key, loader, { forceRefresh = false } = {}) {
    if (!forceRefresh && cachedRequests.has(key)) return cachedRequests.get(key);
    const promise = loader().catch(error => {
      cachedRequests.delete(key);
      throw error;
    });
    cachedRequests.set(key, promise);
    return promise;
  }

  function clearReferenceCache(prefix) {
    if (!prefix) {
      cachedRequests.clear();
      return;
    }
    Array.from(cachedRequests.keys()).forEach(key => {
      if (key === prefix || key.startsWith(`${prefix}:`)) cachedRequests.delete(key);
    });
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
      paymentStatus: row.payment_status || row.paymentStatus || "Plaćeno",
      amountDue: Number(row.amount_due ?? row.amountDue ?? 0),
      amountPaid: Number(row.amount_paid ?? row.amountPaid ?? 0),
      totalAmount: Number(row.total_amount ?? row.totalAmount ?? 0),
      currency: row.currency || row.paymentCurrency || "RSD",
      paymentParts: row.paymentParts || row.payment_parts || [],
      shift: row.shift || "Prva smena",
      generalTreatments: row.generalTreatments || row.general_treatments || [],
      treatments: row.treatments || {}
    };
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
    syncDirectorNavigation(session);
    try {
      const data = await request("/auth/verify", { method: "POST" });
      if (requiredRole && data.user.role !== requiredRole) return null;
      setSession({ user: data.user });
      return data.user;
    } catch (error) {
      if (isAuthFailure(error)) {
        clearSession();
        return null;
      }
      // Fast page changes can abort /auth/verify; keep the local session and
      // let protected API routes continue to enforce access server-side.
      syncDirectorNavigation(session);
      return session;
    }
  }

  function queryString(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") query.set(key, value);
    });
    return query.toString();
  }

  async function getPatients(params = {}) {
    const query = queryString(params);
    const patients = await request(`/patients${query ? `?${query}` : ""}`);
    return patients.map(patient => ({
      ...patient,
      firstName: patient.first_name,
      lastName: patient.last_name,
      birthDate: patient.date_of_birth,
      emergencyContact: patient.emergency_contact,
      fullName: fullName(patient)
    }));
  }

  async function getPatient(patientId) {
    const patient = await request(`/patients/${patientId}`);
    return {
      ...patient,
      firstName: patient.first_name,
      lastName: patient.last_name,
      birthDate: patient.date_of_birth,
      emergencyContact: patient.emergency_contact,
      fullName: fullName(patient)
    };
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

  async function getDoctors(options = {}) {
    return cachedRequest("doctors", () => request("/doctors"), options);
  }

  async function getDirectorDoctors() {
    return request("/director/doctors");
  }

  async function createDoctor(doctor) {
    const result = await request("/director/doctors", {
      method: "POST",
      body: JSON.stringify(doctor)
    });
    clearReferenceCache("doctors");
    return result;
  }

  async function updateDoctor(doctorId, doctor) {
    const result = await request(`/director/doctors/${doctorId}`, {
      method: "PUT",
      body: JSON.stringify(doctor)
    });
    clearReferenceCache("doctors");
    return result;
  }

  async function deactivateDoctor(doctorId) {
    const result = await request(`/director/doctors/${doctorId}`, { method: "DELETE" });
    clearReferenceCache("doctors");
    return result;
  }

  async function getChairs(options = {}) {
    return cachedRequest("chairs", () => request("/chairs"), options);
  }

  async function getAppointments(params = {}) {
    const query = queryString(params);
    return request(`/appointments${query ? `?${query}` : ""}`);
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

  async function updateGoogleCalendarSettings(settings, directorPassword) {
    return request("/director/google-calendar/settings", {
      method: "PUT",
      body: JSON.stringify({ ...settings, directorPassword })
    });
  }

  async function getGoogleCalendarColors() {
    return request("/director/google-calendar/colors");
  }

  async function retryCalendarSync() {
    return request("/director/calendar-sync/retry", { method: "POST" });
  }

  async function pullGoogleCalendarChanges({ reset = false, limit = 100, daysPast = 1, daysFuture = 14, complete = true, mode = "incremental", timeMin = null, timeMax = null, async: asyncJob = false } = {}) {
    return request("/calendar-sync/pull-google", {
      method: "POST",
      body: JSON.stringify({ reset, limit, daysPast, daysFuture, complete, mode, timeMin, timeMax, async: asyncJob })
    });
  }

  async function stepGoogleCalendarSync({ jobId = null } = {}) {
    return request("/calendar-sync/pull-google/step", {
      method: "POST",
      body: JSON.stringify({ jobId })
    });
  }

  async function getGoogleCalendarSyncStatus() {
    return request("/calendar-sync/google/status");
  }

  async function renewGoogleCalendarWatch() {
    return request("/director/google-calendar/watch/renew", { method: "POST" });
  }

  async function stopGoogleCalendarWatch() {
    return request("/director/google-calendar/watch/stop", { method: "POST" });
  }

  async function getNotifications({ sinceId = 0, limit = 20, latest = false } = {}) {
    const query = new URLSearchParams();
    if (sinceId) query.set("sinceId", sinceId);
    if (limit) query.set("limit", limit);
    if (latest) query.set("latest", "true");
    return request(`/notifications${query.toString() ? `?${query}` : ""}`);
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

  async function verifyGoogleCalendarOAuth() {
    return request("/director/google-calendar/oauth/verify", { method: "POST" });
  }

  async function getPublicBookingSettings() {
    return request("/director/public-booking/settings");
  }

  async function updatePublicBookingSettings(settings) {
    return request("/director/public-booking/settings", {
      method: "PUT",
      body: JSON.stringify(settings)
    });
  }

  async function getPublicBookingStatus() {
    const response = await fetch(`${API_BASE}/public/booking/status`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Booking status unavailable");
    return data;
  }

  function updatePublicBookingNavigation(enabled) {
    document.querySelectorAll('.topbar-actions a[href$="public-booking.html"]').forEach(link => {
      link.hidden = !enabled;
    });
  }

  async function initializePublicBookingNavigation() {
    try {
      const status = await getPublicBookingStatus();
      updatePublicBookingNavigation(Boolean(status.enabled));
    } catch (error) {
      console.warn("Public booking status unavailable:", error);
    }
  }

  async function getPublicBookingOptions() {
    const response = await fetch(`${API_BASE}/public/booking/options`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Booking options unavailable");
    return data;
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

  async function getPatientInternalComments(patientId) {
    return request(`/patients/${patientId}/internal-comments`);
  }

  async function createPatientInternalComment(patientId, comment) {
    return request(`/patients/${patientId}/internal-comments`, {
      method: "POST",
      body: JSON.stringify(comment)
    });
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

  async function getRecords(params = {}) {
    const query = queryString(params);
    const records = await request(`/records${query ? `?${query}` : ""}`);
    return records.map(normalizeRecord);
  }

  async function getRecord(recordId) {
    return normalizeRecord(await request(`/records/${recordId}`));
  }

  async function getPatientSummaries(params = {}) {
    const query = queryString(params);
    return request(`/patient-summaries${query ? `?${query}` : ""}`);
  }

  async function getPatientPaymentHistory(patientId, params = {}) {
    const query = queryString(params);
    return request(`/patients/${patientId}/payment-history${query ? `?${query}` : ""}`);
  }

  async function addRecordPaymentPart(recordId, paymentPart) {
    return request(`/records/${recordId}/payment-parts`, {
      method: "POST",
      body: JSON.stringify(paymentPart)
    });
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
        total_amount: record.totalAmount,
        amount: record.amountDue,
        amount_paid: record.amountPaid,
        currency: record.currency,
        payment_status: record.paymentStatus,
        paymentParts: record.paymentParts || [],
        shift: record.shift,
        generalTreatments: record.generalTreatments || [],
        treatments: record.treatments
      })
    });
  }

  async function updateRecord(recordId, record) {
    return request(`/records/${recordId}`, {
      method: "PUT",
      body: JSON.stringify({
        visit_date: record.lastVisit,
        procedure: record.procedure,
        status: record.status,
        notes: record.note,
        shift: record.shift,
        total_amount: record.totalAmount,
        amount: record.amountDue,
        amount_paid: record.amountPaid,
        currency: record.currency,
        payment_status: record.paymentStatus,
        paymentParts: record.paymentParts || [],
        generalTreatments: record.generalTreatments || [],
        treatments: record.treatments
      })
    });
  }

  async function deleteRecord(recordId) {
    return request(`/records/${recordId}`, { method: "DELETE" });
  }

  async function getDirectorReport(type) {
    return request(`/director/reports/${type}`);
  }

  async function getCodebooks(type, options = {}) {
    const cacheKey = type ? `codebooks:${type}` : "codebooks";
    return cachedRequest(cacheKey, () => request(`/codebooks${type ? `?type=${encodeURIComponent(type)}` : ""}`), options);
  }

  async function getAdminCodebooks(type) {
    return request(`/director/codebooks${type ? `?type=${encodeURIComponent(type)}` : ""}`);
  }

  async function createCodebookItem(item) {
    const result = await request("/director/codebooks", {
      method: "POST",
      body: JSON.stringify(item)
    });
    clearReferenceCache("codebooks");
    return result;
  }

  async function updateCodebookItem(itemId, item) {
    const result = await request(`/director/codebooks/${itemId}`, {
      method: "PUT",
      body: JSON.stringify(item)
    });
    clearReferenceCache("codebooks");
    return result;
  }

  async function deleteCodebookItem(itemId) {
    const result = await request(`/director/codebooks/${itemId}`, { method: "DELETE" });
    clearReferenceCache("codebooks");
    return result;
  }

  async function getExchangeRate(currency, base = "RSD") {
    return request(`/director/exchange-rate?base=${encodeURIComponent(base)}&currency=${encodeURIComponent(currency)}`);
  }

  async function getDailyCashReport(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") query.set(key, value);
    });
    return request(`/director/daily-cash-report${query.toString() ? `?${query}` : ""}`);
  }

  async function saveDailyCashReport(payload) {
    return request("/director/daily-cash-report", {
      method: "PUT",
      body: JSON.stringify(payload)
    });
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

  async function updateUserPermissions(userId, permissions, directorPassword) {
    return request(`/director/security/users/${userId}/permissions`, {
      method: "PUT",
      body: JSON.stringify({ permissions, directorPassword })
    });
  }

  async function getLegalExport(directorPassword) {
    return request("/director/legal-export", {
      headers: { "X-DrRosa-Director-Password": directorPassword || "" }
    });
  }

  async function unlockUser(userId) {
    return request(`/director/security/users/${userId}/unlock`, { method: "POST" });
  }

  async function resetUserPassword(userId, newPassword, directorPassword) {
    return request(`/director/security/users/${userId}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ newPassword, directorPassword })
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

  function actionButtonFor(target, selector) {
    if (!target) return null;
    if (selector) return target.querySelector?.(selector) || document.querySelector(selector);
    if (target.matches?.("button, a")) return target;
    return target.querySelector?.("button[type='submit'], .primary-btn, .secondary-btn, .danger-btn") || null;
  }

  async function withActionLock(target, action, options = {}) {
    if (!target || typeof action !== "function") return action?.();
    if (target.dataset.drrosaBusy === "1") return undefined;
    const button = actionButtonFor(target, options.buttonSelector);
    if (button?.dataset.drrosaBusy === "1") return undefined;

    const originalText = button?.textContent;
    const wasDisabled = button?.disabled;
    target.dataset.drrosaBusy = "1";
    target.setAttribute?.("aria-busy", "true");
    if (button) {
      button.dataset.drrosaBusy = "1";
      button.disabled = true;
      button.classList.add("is-loading");
      if (options.loadingText) button.textContent = options.loadingText;
    }

    try {
      return await action();
    } finally {
      if (!options.keepLocked) {
        delete target.dataset.drrosaBusy;
        target.removeAttribute?.("aria-busy");
        if (button) {
          delete button.dataset.drrosaBusy;
          button.disabled = Boolean(wasDisabled);
          button.classList.remove("is-loading");
          if (options.loadingText && originalText != null) button.textContent = originalText;
        }
      }
    }
  }

  window.DrRosaUi = {
    withActionLock
  };

  window.DrRosaApi = {
    login,
    logout,
    verifySession,
    changePassword,
    clearSession,
    getSession,
    clearReferenceCache,
    getPatients,
    getPatient,
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
    getDirectorDoctors,
    createDoctor,
    updateDoctor,
    deactivateDoctor,
    getChairs,
    getAppointments,
    createAppointment,
    updateAppointment,
    updateAppointmentStatus,
    deleteAppointment,
    createVisitFromAppointment,
    getPatientSummaries,
    getRecords,
    getRecord,
    getPatientPaymentHistory,
    addRecordPaymentPart,
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
    getGoogleCalendarColors,
    retryCalendarSync,
    pullGoogleCalendarChanges,
    stepGoogleCalendarSync,
    getGoogleCalendarSyncStatus,
    renewGoogleCalendarWatch,
    stopGoogleCalendarWatch,
    getNotifications,
    testGoogleCalendarSync,
    exchangeGoogleCalendarCode,
    verifyGoogleCalendarOAuth,
    getPublicBookingSettings,
    updatePublicBookingSettings,
    getPublicBookingStatus,
    updatePublicBookingNavigation,
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
    getPatientInternalComments,
    createPatientInternalComment,
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
    getDailyCashReport,
    saveDailyCashReport,
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
    normalizeRecord
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializePublicBookingNavigation);
  } else {
    initializePublicBookingNavigation();
  }

  function showGlobalNotification(notification) {
    if (!notification?.message) return;
    let wrap = document.querySelector(".global-notification-stack");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "global-notification-stack";
      wrap.setAttribute("aria-live", "polite");
      document.body.appendChild(wrap);
    }
    const toast = document.createElement("article");
    toast.className = `global-notification ${String(notification.type || "").includes("failed") ? "error" : "info"}`;
    toast.innerHTML = `
      <strong>${escapeHtml(notification.title || "Obavestenje")}</strong>
      <span>${escapeHtml(notification.message)}</span>
    `;
    wrap.appendChild(toast);
    window.setTimeout(() => toast.remove(), 9000);
  }

  function initializeNotifications() {
    if (window.DrRosaNotificationsStarted || location.pathname.endsWith("/login.html")) return;
    window.DrRosaNotificationsStarted = true;
    let lastId = Number(localStorage.getItem("drrosa-last-notification-id") || 0);
    const startedAt = Date.now();
    const historicalToastGraceMs = 5000;
    const baselineReady = lastId > 0
      ? Promise.resolve()
      : getNotifications({ latest: true, limit: 1 })
        .then(notifications => {
          const newestId = Math.max(0, ...notifications.map(notification => Number(notification.id || 0)));
          if (newestId > 0) {
            lastId = newestId;
            localStorage.setItem("drrosa-last-notification-id", String(lastId));
          }
        })
        .catch(() => {
          // Notification baseline must never interrupt clinical workflows.
        });

    async function poll() {
      if (!getSession()) return;
      try {
        await baselineReady;
        const notifications = await getNotifications({ sinceId: lastId, limit: 10 });
        notifications.forEach(notification => {
          lastId = Math.max(lastId, Number(notification.id || 0));
          const createdAt = Date.parse(notification.createdAt || "");
          if (Number.isFinite(createdAt) && createdAt >= startedAt - historicalToastGraceMs) {
            showGlobalNotification(notification);
          }
        });
        localStorage.setItem("drrosa-last-notification-id", String(lastId));
      } catch (_error) {
        // Notification polling must never interrupt clinical workflows.
      }
    }

    window.setTimeout(poll, 2500);
    window.setInterval(poll, 12000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeNotifications);
  } else {
    initializeNotifications();
  }

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

    function foldSearchText(value) {
      return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    }

    function visibleOptionButtons(list) {
      return Array.from(list.querySelectorAll('.custom-select-option:not([aria-disabled="true"])'))
        .filter(option => !option.hidden);
    }

    function filterSelectOptions(wrap, term) {
      const list = wrap.querySelector(".custom-select-list");
      if (!list) return;
      const query = foldSearchText(term);
      const options = Array.from(list.querySelectorAll(".custom-select-option"));
      let visibleCount = 0;

      options.forEach(option => {
        const isMatch = !query || foldSearchText(option.textContent).includes(query);
        option.hidden = !isMatch;
        if (isMatch) visibleCount += 1;
      });

      const empty = list.querySelector(".custom-select-empty");
      if (empty) empty.hidden = visibleCount > 0;
    }

    function syncSelect(select) {
      const wrap = select.closest(".custom-select-wrap");
      if (!wrap) return;
      const button = wrap.querySelector(".custom-select-button");
      const list = wrap.querySelector(".custom-select-list");
      if (!button || !list) return;

      const isSearchable = select.dataset.searchable === "true";
      const searchMarkup = isSearchable
        ? `<span class="custom-select-search-wrap"><input class="custom-select-search-input" type="search" autocomplete="off" placeholder="${escapeAttribute(select.dataset.searchPlaceholder || "Pretraga...")}" aria-label="${escapeAttribute(select.dataset.searchPlaceholder || "Pretraga opcija")}" /></span>`
        : "";
      button.textContent = selectedText(select);
      button.disabled = select.disabled;
      list.innerHTML = searchMarkup + Array.from(select.options).map((option, index) => {
        const selected = option.selected ? "true" : "false";
        const disabled = option.disabled ? "true" : "false";
        return `
          <button class="custom-select-option" type="button" role="option"
            data-option-index="${index}" aria-selected="${selected}" aria-disabled="${disabled}">
            ${escapeHtml(option.textContent)}
          </button>
        `;
      }).join("") + (isSearchable ? `<span class="custom-select-empty" hidden>Nema rezultata</span>` : "");
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
            const search = list.querySelector(".custom-select-search-input");
            if (search) {
              search.value = "";
              filterSelectOptions(wrap, "");
              search.focus();
            }
            const overflow = list.getBoundingClientRect().bottom - window.innerHeight + 12;
            if (overflow > 0) window.scrollBy({ top: overflow, behavior: "auto" });
          });
        }
      });

      button.addEventListener("keydown", event => {
        if (!["ArrowDown", "Enter", " "].includes(event.key)) return;
        event.preventDefault();
        button.click();
        if (select.dataset.searchable === "true") {
          list.querySelector(".custom-select-search-input")?.focus();
          return;
        }
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

      list.addEventListener("input", event => {
        if (!event.target.classList.contains("custom-select-search-input")) return;
        filterSelectOptions(wrap, event.target.value);
      });

      list.addEventListener("keydown", event => {
        const searchField = event.target.closest(".custom-select-search-input");
        if (searchField) {
          if (event.key === "Escape") {
            closeAll();
            button.focus();
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            visibleOptionButtons(list)[0]?.focus();
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            visibleOptionButtons(list)[0]?.click();
            return;
          }
          return;
        }

        const options = visibleOptionButtons(list);
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => syncDirectorNavigation());
  } else {
    syncDirectorNavigation();
  }

  function initializeResponsiveMenu() {
    const topbar = document.querySelector(".topbar");
    const nav = topbar?.querySelector(".topbar-actions");
    if (!topbar || !nav || topbar.querySelector(".mobile-menu-toggle")) return;

    const button = document.createElement("button");
    const navId = nav.id || "primary-navigation";
    nav.id = navId;
    button.className = "mobile-menu-toggle";
    button.type = "button";
    button.setAttribute("aria-controls", navId);
    button.setAttribute("aria-expanded", "false");
    button.innerHTML = "<span></span><span></span><span></span><strong>Meni</strong>";

    topbar.insertBefore(button, nav);

    function setOpen(isOpen) {
      topbar.classList.toggle("menu-open", isOpen);
      button.setAttribute("aria-expanded", String(isOpen));
    }

    button.addEventListener("click", () => {
      setOpen(!topbar.classList.contains("menu-open"));
    });

    nav.addEventListener("click", event => {
      if (event.target.closest("a, button")) setOpen(false);
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") setOpen(false);
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 980) setOpen(false);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeResponsiveMenu);
  } else {
    initializeResponsiveMenu();
  }
})();
