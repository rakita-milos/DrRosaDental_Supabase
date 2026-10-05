(function () {
  const API_BASE = window.DRROSA_API_BASE || "/api";
  const { escapeHtml, escapeAttribute } = window.DrRosaSecurity;
  let refreshPromise = null;
  let rescheduleLifecycle = () => {};
  const authEpoch = () => localStorage.getItem('drrosa-auth-epoch') || '';
  const advanceAuthEpoch = () => localStorage.setItem('drrosa-auth-epoch', `${Date.now()}-${Math.random()}`);

  function getSession() {
    try { return JSON.parse(localStorage.getItem("drrosa-session") || "null"); }
    catch { return null; }
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
    const previous = getSession();
    const session = {
      ...(data.user || data),
      loginTime: previous?.loginTime || new Date().toISOString(),
      refreshExpiresAt: data.refreshExpiresAt || previous?.refreshExpiresAt || null,
      sessionId: data.sessionId || previous?.sessionId || null,
      sessionExpiresAt: data.sessionExpiresAt || previous?.sessionExpiresAt || null,
      idleExpiresAt: data.idleExpiresAt || previous?.idleExpiresAt || null,
      idleTimeoutMs: data.idleTimeoutMs || previous?.idleTimeoutMs || 1200000,
      clockOffsetMs: data.serverTime ? Date.parse(data.serverTime) - Date.now() : previous?.clockOffsetMs || 0
    };
    localStorage.setItem("drrosa-session", JSON.stringify(session));
    syncDirectorNavigation(session);
    rescheduleLifecycle();
  }

  function clearSession() {
    localStorage.removeItem("drrosa-token");
    localStorage.removeItem("drrosa-refresh-token");
    localStorage.removeItem("drrosa-session");
    clearReferenceCache();
    syncDirectorNavigation(null);
  }

  function apiError(message, status, code) {
    const error = new Error(message || "API request failed");
    if (status) error.status = status;
    if (code) error.code = code;
    return error;
  }

  function isAuthFailure(error) {
    return ['SESSION_ENDED', 'REFRESH_REJECTED', 'ACCOUNT_LOCKED'].includes(error?.code);
  }

  async function refreshSession() {
    if (refreshPromise) return refreshPromise;
    const epoch = authEpoch();
    const renew = async () => {
      if (authEpoch() !== epoch || localStorage.getItem('drrosa-logout-pending')) throw apiError('Prijava je promenjena.', 401, 'SESSION_CHANGED');
      // A different tab may already have renewed the shared cookies while waiting.
      const checked = await fetch(`${API_BASE}/auth/verify`, { method: 'POST', credentials: 'include', cache: 'no-store' });
      const checkedData = await checked.json().catch(() => ({}));
      if (checked.ok) {
        if (authEpoch() !== epoch) throw apiError('Prijava je promenjena.', 401, 'SESSION_CHANGED');
        setSession(checkedData);
        return checkedData;
      }
      if (checked.status !== 401 || checkedData.code !== 'ACCESS_EXPIRED') {
        throw apiError(checkedData.error, checked.status, checkedData.code);
      }
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', cache: 'no-store'
      });
      const data = await response.json().catch(() => ({}));
      if (authEpoch() !== epoch) throw apiError('Prijava je promenjena.', 401, 'SESSION_CHANGED');
      if (!response.ok) throw apiError(data.error, response.status, data.code);
      setSession(data);
      return data;
    };
    refreshPromise = (window.navigator?.locks
      ? window.navigator.locks.request('drrosa-session-refresh', renew) : renew()).finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  async function request(path, options = {}, retry = true) {
    const epoch = authEpoch();
    if (localStorage.getItem('drrosa-logout-pending')) throw apiError('Odjava čeka potvrdu servera.', 401, 'SESSION_CHANGED');
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

    const data = await response.json().catch(() => ({}));
    if (authEpoch() !== epoch) throw apiError('Prijava je promenjena.', 401, 'SESSION_CHANGED');
    if (!response.ok) {
      try {
        if (response.status === 401 && data.code === 'ACCESS_EXPIRED' && retry) {
          await refreshSession();
          return request(path, options, false);
        }
        throw apiError(data.error || 'API request failed', response.status, data.code);
      } catch (error) {
        if (isAuthFailure(error) && authEpoch() === epoch) lockSession(error.message);
        throw error;
      }
    }

    return data;
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

  function withAuthLock(work) {
    return window.navigator?.locks ? window.navigator.locks.request('drrosa-session-refresh', work) : work();
  }

  function login(email, password, role, twoFactorCode) {
    return withAuthLock(() => performLogin(email, password, role, twoFactorCode));
  }

  async function performLogin(email, password, role, twoFactorCode) {
    if (localStorage.getItem('drrosa-logout-pending')) {
      const cleanup = await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include', cache: 'no-store' });
      if (!cleanup.ok) throw new Error('Prethodna odjava nije potvrđena. Pokušajte ponovo.');
      localStorage.removeItem('drrosa-logout-pending');
    }
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
    advanceAuthEpoch();
    clearSession();
    setSession(data);
    return data.user;
  }

  async function logout() {
    localStorage.setItem('drrosa-logout-pending', '1');
    advanceAuthEpoch();
    clearSession();
    try {
      const response = await withAuthLock(() => fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include', cache: 'no-store' }));
      if (!response.ok) throw apiError('Serverska odjava nije potvrđena.', response.status);
      localStorage.removeItem('drrosa-logout-pending');
      localStorage.setItem('drrosa-auth-event', JSON.stringify({ type: 'logout', at: Date.now() }));
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
    if (localStorage.getItem('drrosa-logout-pending')) { clearSession(); return null; }
    const session = getSession();
    if (!session) return null;
    if (requiredRole && session.role !== requiredRole) return null;
    syncDirectorNavigation(session);
    try {
      const data = await request("/auth/verify", { method: "POST" });
      if (requiredRole && data.user.role !== requiredRole) return null;
      setSession(data);
      return data.user;
    } catch (error) {
      if (error.code === 'SESSION_CHANGED') return null;
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

  const sessionLock = window.createDrRosaSessionLock({ getSession, advanceAuthEpoch, clearSession, login });
  const lockSession = (...args) => sessionLock.lock(...args);
  const unlockSession = () => sessionLock.unlock();

  async function reportActivity() {
    const before = getSession();
    if (!before) return;
    const data = await request('/auth/activity', { method: 'POST' });
    if (getSession()?.sessionId === before.sessionId) setSession({ ...data, user: before });
  }

  function initializeSessionLifecycle() {
    let lastAttempt = 0;
    let activityPending = false;
    let lastInteraction = 0;
    let activityTimer;
    let deadlineTimer;
    let lastKnownSession = getSession();
    async function onActivity(event) {
      if (!event.isTrusted || document.visibilityState === 'hidden' || !getSession()) return;
      activityPending = true;
      lastInteraction = Date.now();
      await flushActivity();
    }
    async function flushActivity() {
      if (!activityPending || !getSession()) return;
      const send = async () => {
        const session = getSession();
        if (!session) return;
        let shared;
        try { shared = JSON.parse(localStorage.getItem('drrosa-activity') || 'null'); } catch {}
        const last = shared?.sessionId === session.sessionId ? shared.at : lastAttempt;
        if (last && last >= lastInteraction) { activityPending = false; return; }
        const delay = 15000 - (Date.now() - (last || 0));
        if (delay > 0) {
          window.clearTimeout(activityTimer);
          activityTimer = window.setTimeout(flushActivity, delay);
          return;
        }
        lastAttempt = Date.now();
        activityPending = false;
        localStorage.setItem('drrosa-activity', JSON.stringify({sessionId:session.sessionId,at:lastAttempt}));
        try { await reportActivity(); } catch { /* Server deadlines remain authoritative. */ }
      };
      if (window.navigator?.locks) await window.navigator.locks.request('drrosa-session-activity', send);
      else await send();
    }
    ['pointerdown', 'keydown', 'input', 'scroll'].forEach(name => document.addEventListener(name, onActivity, { passive: true }));
    function checkDeadline() {
      const session = getSession();
      if (!session) {
        if (lastKnownSession) lockSession('Prijava je prekinuta. Prijavite se ponovo.', lastKnownSession);
        return;
      }
      if (lastKnownSession && (lastKnownSession.id !== session.id || lastKnownSession.role !== session.role)) {
        location.reload();
        return;
      }
      lastKnownSession = session;
      const serverNow = Date.now() + (session.clockOffsetMs || 0);
      const deadline = Math.min(Date.parse(session.idleExpiresAt), Date.parse(session.sessionExpiresAt));
      if (!Number.isFinite(deadline)) return;
      if (serverNow >= deadline) { lockSession(); return; }
      let warning = document.getElementById('drrosa-session-warning');
      if (deadline - serverNow > 60000) { warning?.remove(); return; }
      if (!warning) {
        warning = document.createElement('p');
        warning.id = 'drrosa-session-warning';
        warning.className = 'session-warning';
        warning.setAttribute('role', 'status');
        document.body.appendChild(warning);
      }
      const absolute = Date.parse(session.sessionExpiresAt) <= Date.parse(session.idleExpiresAt);
      warning.textContent = absolute
        ? 'Prijava uskoro ističe zbog maksimalnog trajanja. Biće potrebna ponovna prijava.'
        : 'Prijava uskoro ističe zbog neaktivnosti. Nastavite rad da produžite sesiju.';
    }
    window.addEventListener('storage', event => {
      if (event.key === 'drrosa-session') {
        rescheduleLifecycle();
        const previous = event.oldValue ? JSON.parse(event.oldValue) : null;
        const next = event.newValue ? JSON.parse(event.newValue) : null;
        if (!next && previous) lockSession('Prijava je prekinuta u drugom tabu.', previous);
        else if (next && sessionLock.user?.id === next.id && !localStorage.getItem('drrosa-logout-pending')) unlockSession();
        else if (next && ((previous && previous.id !== next.id) || (sessionLock.user && sessionLock.user.id !== next.id))) location.reload();
      }
      if (event.key === 'drrosa-logout-pending' && event.newValue) lockSession('Odjava je pokrenuta u drugom tabu.');
      if (event.key === 'drrosa-auth-event' && event.newValue) location.replace('login.html');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') {
        rescheduleLifecycle();
        if (getSession()) verifySession().catch(() => {});
      }
    });
    window.addEventListener('pageshow', event => {
      rescheduleLifecycle();
      if (event.persisted && getSession()) verifySession().catch(() => {});
    });
    function scheduleDeadline() {
      window.clearTimeout(deadlineTimer);
      checkDeadline();
      const session = getSession();
      if (!session) return;
      const deadline = Math.min(Date.parse(session.idleExpiresAt), Date.parse(session.sessionExpiresAt));
      const remaining = deadline - Date.now() - (session.clockOffsetMs || 0);
      if (Number.isFinite(remaining) && remaining > 0) {
        deadlineTimer = window.setTimeout(scheduleDeadline, remaining > 60000 ? remaining - 60000 : remaining);
      }
    }
    rescheduleLifecycle = scheduleDeadline;
    scheduleDeadline();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeSessionLifecycle);
  else initializeSessionLifecycle();

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
