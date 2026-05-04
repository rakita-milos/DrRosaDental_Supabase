(function () {
  const API_BASE = "http://localhost:3000/api";

  const defaultRecords = [
    { patient: "Ana Kovac", lastVisit: "2026-04-28", procedure: "Kontrola i ciscenje", status: "Zakazano", note: "Follow-up za 2 tjedna", doctor: "Dr Rosa", visits: 1, paymentStatus: "Placeno", amountDue: 0 },
    { patient: "Marko Petrovic", lastVisit: "2026-04-18", procedure: "Plomba", status: "Zavrseno", note: "Nema naplata", doctor: "Dr Rosa", visits: 2, paymentStatus: "Placeno", amountDue: 0 },
    { patient: "Ivana Babic", lastVisit: "2026-04-22", procedure: "Izbeljivanje", status: "U tijeku", note: "Na 3 posjete", doctor: "Dr Rosa", visits: 3, paymentStatus: "Delimicno", amountDue: 150 },
    { patient: "Luka Horvat", lastVisit: "2026-04-30", procedure: "Most", status: "Zakazano", note: "Potrebna dodatna anamneza", doctor: "Dr Rosa", visits: 1, paymentStatus: "Placeno", amountDue: 0 },
    { patient: "Petar Juric", lastVisit: "2026-04-25", procedure: "Endodontija", status: "U tijeku", note: "Drugi termin zahtjevan", doctor: "Dr Novak", visits: 2, paymentStatus: "Dugovanje", amountDue: 200 }
  ];

  const demoUsers = {
    "director@drosa.com": { password: "password123", role: "director", name: "Dr Rosa Basic" },
    "staff@drosa.com": { password: "password123", role: "staff", name: "Ana - Medicinska sestra" }
  };

  function getToken() {
    return localStorage.getItem("drrosa-token");
  }

  function getSession() {
    return JSON.parse(localStorage.getItem("drrosa-session") || "null");
  }

  function setSession(data) {
    localStorage.setItem("drrosa-token", data.token || "");
    localStorage.setItem("drrosa-session", JSON.stringify({
      ...(data.user || data),
      loginTime: new Date().toISOString()
    }));
  }

  function clearSession() {
    localStorage.removeItem("drrosa-token");
    localStorage.removeItem("drrosa-session");
  }

  async function request(path, options = {}) {
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

  async function login(email, password, selectedRole) {
    try {
      const data = await request("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      if (selectedRole && data.user.role !== selectedRole) {
        throw new Error("Odabrana uloga ne odgovara vasem nalogu");
      }
      setSession(data);
      return data.user;
    } catch (error) {
      const user = demoUsers[email];
      if (!user || user.password !== password || user.role !== selectedRole) {
        throw error;
      }
      setSession({ token: "", user: { email, name: user.name, role: user.role, demo: true } });
      return user;
    }
  }

  async function verifySession(requiredRole) {
    const session = getSession();
    if (!session) return null;
    if (requiredRole && session.role !== requiredRole) return null;
    if (!getToken()) return session;
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
    if (!getToken()) return getLocalPatients();
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
    if (!getToken()) {
      const patients = getLocalPatients();
      patients.push({ ...patient, id: Date.now().toString(), createdAt: new Date().toISOString() });
      localStorage.setItem("drrosa-patients", JSON.stringify(patients));
      return patient;
    }
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

  async function getDoctors() {
    if (!getToken()) {
      return [
        { id: 1, name: "Dr Rosa" },
        { id: 2, name: "Dr Novak" },
        { id: 3, name: "Dr Horvat" }
      ];
    }
    return request("/doctors");
  }

  async function getRecords() {
    if (!getToken()) return getLocalRecords();
    const records = await request("/records");
    return records.map(normalizeRecord);
  }

  async function createRecord(record) {
    if (!getToken()) {
      const existing = JSON.parse(localStorage.getItem("drrosa-records") || "[]");
      const visits = existing.filter(item => item.patient === record.patient).length + 1;
      existing.unshift({ ...record, visits, createdAt: new Date().toISOString() });
      localStorage.setItem("drrosa-records", JSON.stringify(existing));
      return record;
    }

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
        payment_status: record.paymentStatus,
        treatments: record.treatments
      })
    });
  }

  async function getDirectorReport(type) {
    return request(`/director/reports/${type}`);
  }

  window.DrRosaApi = {
    login,
    verifySession,
    clearSession,
    getSession,
    getPatients,
    createPatient,
    getDoctors,
    getRecords,
    createRecord,
    getDirectorReport,
    normalizeRecord,
    getLocalRecords
  };
})();
