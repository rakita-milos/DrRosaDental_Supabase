async function requireAccess() {
  const session = await window.DrRosaApi.verifySession();
  if (!session) {
    window.location.href = "login.html";
    return false;
  }

  const directorPanelLink = document.getElementById("director-panel-link");
  if (directorPanelLink && session.role === "director") {
    directorPanelLink.style.display = "";
  }

  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", (event) => {
      event.preventDefault();
      window.DrRosaApi.logout().finally(() => {
        window.location.href = "login.html";
      });
    });
  }

  return true;
}

const body = document.getElementById("all-records-body");
const cardsBody = document.getElementById("all-records-cards");
const summaryCards = document.getElementById("summary-cards");
const searchInput = document.getElementById("search-input");
const statusFilter = document.getElementById("status-filter");
const doctorFilter = document.getElementById("doctor-filter");
const dateFilter = document.getElementById("date-filter");
const periodFilter = document.getElementById("period-filter");
const activityFilter = document.getElementById("activity-filter");
const procedureFilter = document.getElementById("procedure-filter");
const paymentFilter = document.getElementById("payment-filter");
const appointmentFilter = document.getElementById("appointment-filter");
const advancedSearchToggle = document.getElementById("advanced-search-toggle");
const advancedSearchPanel = document.getElementById("advanced-search-panel");
const exportExcelBtn = document.getElementById("export-excel-btn");
const exportPdfBtn = document.getElementById("export-pdf-btn");
const procedureCatalog = window.DrRosaProcedureCatalog;

let allPatientRows = [];
let allPatientOptions = [];
let allAppointments = [];
let allDoctors = [];
let currentExportRows = [];

const urlParams = new URLSearchParams(window.location.search);

function applyUrlFilters() {
  const paymentParam = urlParams.get("payment") || urlParams.get("filter");
  if (paymentParam === "debtors" && paymentFilter) {
    paymentFilter.value = "debtors";
    syncSelectControl(paymentFilter);
  }
  if (urlParams.get("appointment") && appointmentFilter) {
    appointmentFilter.value = urlParams.get("appointment");
    syncSelectControl(appointmentFilter);
  }
}

function syncSelectControl(select) {
  if (!select) return;
  select.dispatchEvent(new Event("drrosa-select-value"));
}

function resetAdvancedFilters() {
  [statusFilter, doctorFilter, dateFilter, periodFilter, activityFilter, procedureFilter, paymentFilter, appointmentFilter]
    .filter(Boolean)
    .forEach(input => {
      input.value = "";
      syncSelectControl(input);
    });
  populateProcedureFilter();
  syncSelectControl(procedureFilter);
}

function hasAdvancedFilterValue() {
  return [statusFilter, doctorFilter, dateFilter, periodFilter, activityFilter, procedureFilter, paymentFilter, appointmentFilter]
    .some(input => Boolean(input?.value));
}

function setAdvancedSearchOpen(open) {
  if (!advancedSearchToggle || !advancedSearchPanel) return;
  advancedSearchPanel.hidden = !open;
  advancedSearchToggle.setAttribute("aria-expanded", String(open));
  advancedSearchToggle.textContent = open ? "Sakrij ostalu pretragu" : "Prikaži ostalu pretragu";
}

function formatDate(dateString) {
  if (!dateString) return "-";
  return window.DrRosaDateUtils.formatDate(dateString);
}

function isDebt(record) {
  return ["dugovanje", "delimično"].includes(fold(record.paymentStatus)) || Number(record.amountDue || 0) > 0;
}

function fold(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function addCurrencyAmount(target, currency, amount) {
  const key = currency || "RSD";
  target[key] = (target[key] || 0) + Number(amount || 0);
}

function formatCurrencyAmounts(amounts) {
  const entries = Object.entries(amounts).filter(([, amount]) => amount > 0);
  return entries.length
    ? entries.map(([currency, amount]) => window.DrRosaCurrencyUtils ? window.DrRosaCurrencyUtils.formatMoney(amount, currency) : `${amount.toFixed(2)} ${currency}`).join(" / ")
    : "0.00";
}

function patientFullName(patient) {
  return patient.fullName || `${patient.firstName || patient.first_name || ""} ${patient.lastName || patient.last_name || ""}`.trim();
}

function nextAppointmentForPatient(patient) {
  const now = Date.now();
  return allAppointments
    .filter(appointment => {
      const appointmentPatientId = appointment.patientId || appointment.patient_id;
      const appointmentPatientName = appointment.patientName || appointment.patient_name;
      return patient.patientId
        ? String(appointmentPatientId) === String(patient.patientId)
        : appointmentPatientName === patient.patient;
    })
    .filter(appointment => {
      const startsAt = new Date(appointment.startsAt || appointment.starts_at).getTime();
      const status = fold(appointment.status);
      return Number.isFinite(startsAt) && startsAt >= now && !["cancelled", "completed", "no_show"].includes(status);
    })
    .sort((a, b) => new Date(a.startsAt || a.starts_at) - new Date(b.startsAt || b.starts_at))[0] || null;
}

function option(value, label = value) {
  return `<option value="${window.DrRosaSecurity.escapeAttribute(value)}">${window.DrRosaSecurity.escapeHtml(label)}</option>`;
}

function populateActivityFilter() {
  if (!activityFilter || !procedureCatalog) return;
  activityFilter.innerHTML = option("", "Sve delatnosti") + procedureCatalog.getActivities().map(activity => option(activity)).join("");
}

function populatePatientFilter() {
  if (!searchInput) return;
  const patients = allPatientOptions
    .map(patient => ({ id: patient.patientId, name: patient.patient }))
    .filter(patient => patient.id && patient.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  searchInput.innerHTML = option("", "Svi pacijenti") + patients.map(patient => option(String(patient.id), patient.name)).join("");
}

function doctorName(doctor) {
  return doctor.name || doctor.fullName || doctor.full_name || [doctor.firstName || doctor.first_name, doctor.lastName || doctor.last_name].filter(Boolean).join(" ").trim();
}

function populateDoctorFilter() {
  if (!doctorFilter) return;
  const current = doctorFilter.value;
  const doctors = allDoctors
    .map(doctor => doctorName(doctor))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  doctorFilter.innerHTML = option("", "Svi doktori") + doctors.map(doctor => option(doctor)).join("");
  if (current && doctors.some(doctor => fold(doctor) === fold(current))) {
    doctorFilter.value = current;
  }
}

function populateProcedureFilter() {
  if (!procedureFilter || !procedureCatalog) return;
  const activity = activityFilter?.value || "";
  const procedures = activity ? procedureCatalog.getProcedures(activity) : [];
  procedureFilter.innerHTML = option("", activity ? "Svi postupci" : "Prvo odaberi delatnost") + procedures.map(procedure => option(procedure)).join("");
  procedureFilter.disabled = !activity;
}

function summaryFilterParams() {
  const params = {};
  if (searchInput?.value) params.patientId = searchInput.value;
  if (statusFilter?.value) params.status = statusFilter.value;
  if (doctorFilter?.value) params.doctor = doctorFilter.value;
  if (dateFilter?.value) params.date = dateFilter.value;
  if (periodFilter?.value) params.period = periodFilter.value;
  if (paymentFilter?.value) params.payment = paymentFilter.value;
  if (procedureFilter?.value) {
    params.procedure = procedureFilter.value;
  } else if (activityFilter?.value && procedureCatalog) {
    const procedures = procedureCatalog.getProcedures(activityFilter.value);
    if (procedures.length) params.procedures = JSON.stringify(procedures);
  }
  return params;
}

function normalizePatientSummary(row) {
  return {
    patientId: row.patientId || row.patient_id,
    patient: row.patient || row.patient_name || "",
    lastVisit: row.lastVisit || row.last_visit || "",
    visits: Number(row.visits || 0),
    hasDebt: Boolean(row.hasDebt || row.has_debt),
    totalDebt: row.totalDebt || row.total_debt || {},
    currencies: Array.isArray(row.currencies) ? row.currencies : [],
    shifts: Array.isArray(row.shifts) ? row.shifts : []
  };
}

async function loadPatientSummaries(params = {}) {
  const rows = window.DrRosaApi.getPatientSummaries
    ? await window.DrRosaApi.getPatientSummaries(params)
    : [];
  return rows.map(normalizePatientSummary);
}

async function populateCodebookFilters() {
  const mappings = [
    { type: "visit_status", select: statusFilter, placeholder: "Svi statusi" },
    { type: "payment_status", select: paymentFilter, placeholder: "Sva placanja", extras: [{ value: "debtors", label: "Dužnici" }] }
  ];

  await Promise.all(mappings.map(async ({ type, select, placeholder, extras = [] }) => {
    if (!select || !window.DrRosaApi?.getCodebooks) return;
    try {
      const current = select.value;
      const items = await window.DrRosaApi.getCodebooks(type);
      if (!items.length) return;
      select.innerHTML = option("", placeholder)
        + items.map(item => option(item.value, item.label)).join("")
        + extras.map(item => option(item.value, item.label)).join("");
      select.value = current;
    } catch (error) {
      console.error(`${type} filter codebook load error:`, error);
    }
  }));
}

function treatmentListForValue(treatments) {
  if (!treatments) return [];
  return Array.isArray(treatments) ? treatments : [treatments];
}

function recordProcedureValues(record) {
  const values = [record.procedure];
  if (record.treatments) {
    Object.values(record.treatments).forEach(treatments => {
      treatmentListForValue(treatments).forEach(treatment => values.push(treatment?.type));
    });
  }
  return values.filter(Boolean);
}

function matchesProcedure(record, procedure) {
  if (!procedure) return true;
  const target = fold(procedure);
  return recordProcedureValues(record).some(value => {
    const source = fold(value);
    return source === target || source.includes(target) || target.includes(source);
  });
}

function buildPatientRows(patients, records) {
  const patientMap = {};

  patients.forEach(patient => {
    const name = patientFullName(patient);
    if (!patient.id || !name) return;
    patientMap[`id:${patient.id}`] = {
      patientId: patient.id,
      patient: name,
      lastVisit: "",
      lastProcedure: "-",
      visits: 0,
      hasDebt: false,
      totalDebt: {},
      currencies: new Set(),
      shifts: new Map(),
      records: []
    };
  });

  records.forEach(record => {
    const patientKey = record.patientId ? `id:${record.patientId}` : `name:${record.patient}`;
    if (!patientMap[patientKey]) {
      patientMap[patientKey] = {
        patientId: record.patientId,
        patient: record.patient,
        lastVisit: "",
        lastProcedure: "-",
        visits: 0,
        hasDebt: false,
        totalDebt: {},
        currencies: new Set(),
        shifts: new Map(),
        records: []
      };
    }
    const row = patientMap[patientKey];
    row.records.push(record);
    row.visits += 1;
    row.currencies.add(record.currency || "RSD");
    const shift = record.shift || "Prva smena";
    row.shifts.set(shift, (row.shifts.get(shift) || 0) + 1);
    if (isDebt(record)) {
      row.hasDebt = true;
      addCurrencyAmount(row.totalDebt, record.currency || "RSD", record.amountDue || 0);
    }
    if (!row.lastVisit || new Date(record.lastVisit) > new Date(row.lastVisit)) {
      row.lastVisit = record.lastVisit;
      row.lastProcedure = record.procedure || "-";
    }
  });

  return Object.values(patientMap).sort((a, b) => a.patient.localeCompare(b.patient));
}

function renderSummary(patientRows) {
  const totalPatients = patientRows.length;
  const patientsWithVisits = patientRows.filter(patient => patient.visits > 0).length;
  const debtorPatients = patientRows.filter(patient => patient.hasDebt).length;
  const patientsWithoutVisits = patientRows.filter(patient => patient.visits === 0).length;

  summaryCards.innerHTML = `
    <div class="hero-stats-card"><p class="eyebrow">Ukupno pacijenata</p><span>${totalPatients}</span></div>
    <div class="hero-stats-card"><p class="eyebrow">Sa posetama</p><span>${patientsWithVisits}</span></div>
    <div class="hero-stats-card"><p class="eyebrow">Duznici</p><span>${debtorPatients}</span></div>
    <div class="hero-stats-card"><p class="eyebrow">Bez posete</p><span>${patientsWithoutVisits}</span></div>
  `;
}

function paymentStatusForPatient(patient) {
  if (patient.visits === 0) return "Nema poseta";
  return patient.hasDebt ? "Dugovanje" : "Placeno";
}

function paymentClassForPatient(patient) {
  if (patient.visits === 0) return "";
  return patient.hasDebt ? "status-dugovanje" : "status-placeno";
}

function patientQueryString(patient) {
  return patient.patientId
    ? `patientId=${encodeURIComponent(patient.patientId)}`
    : `patient=${encodeURIComponent(patient.patient)}`;
}

function renderRecords(patientRows) {
  body.innerHTML = "";
  if (cardsBody) cardsBody.innerHTML = "";

  currentExportRows = patientRows.map(patient => [
    patient.patient,
    formatDate(patient.lastVisit),
    formatDate(nextAppointmentForPatient(patient)?.startsAt || nextAppointmentForPatient(patient)?.starts_at),
    patient.visits,
    paymentStatusForPatient(patient),
    formatCurrencyAmounts(patient.totalDebt),
    "Otvori"
  ]);

  if (patientRows.length === 0) {
    body.innerHTML = `<tr><td colspan="7" class="empty-row">Nema pacijenata koji odgovaraju pretrazivanju.</td></tr>`;
    if (cardsBody) cardsBody.innerHTML = `<p class="empty-row">Nema pacijenata koji odgovaraju pretrazivanju.</p>`;
    return;
  }

  patientRows.forEach((patient) => {
    const nextAppointment = nextAppointmentForPatient(patient);
    const paymentStatus = paymentStatusForPatient(patient);
    const paymentClass = paymentClassForPatient(patient);
    const row = document.createElement("tr");
    row.append(
      window.DrRosaSecurity.cell(patient.patient),
      window.DrRosaSecurity.cell(formatDate(patient.lastVisit)),
      window.DrRosaSecurity.cell(formatDate(nextAppointment?.startsAt || nextAppointment?.starts_at)),
      window.DrRosaSecurity.cell(patient.visits),
      window.DrRosaSecurity.cell(paymentStatus, paymentClass),
      window.DrRosaSecurity.cell(formatCurrencyAmounts(patient.totalDebt))
    );
    const actionCell = document.createElement("td");
    actionCell.className = "table-actions";
    const patientQuery = patientQueryString(patient);
    const link = document.createElement("a");
    link.href = `patient-dashboard.html?${patientQuery}`;
    link.className = "secondary-btn";
    link.textContent = "Otvori";
    const entryLink = document.createElement("a");
    entryLink.href = `new-entry.html?${patientQuery}`;
    entryLink.className = "secondary-btn";
    entryLink.textContent = "Poseta";
    const scheduleLink = document.createElement("a");
    scheduleLink.href = `calendar.html?${patientQuery}`;
    scheduleLink.className = "secondary-btn";
    scheduleLink.textContent = "Zakazi";
    const actionGroup = document.createElement("div");
    actionGroup.className = "record-action-group";
    actionGroup.append(link, entryLink, scheduleLink);
    actionCell.append(actionGroup);
    row.appendChild(actionCell);
    body.appendChild(row);

    if (cardsBody) {
      const nextAppointmentDate = formatDate(nextAppointment?.startsAt || nextAppointment?.starts_at);
      const debtAmount = formatCurrencyAmounts(patient.totalDebt);
      const card = document.createElement("article");
      card.className = `record-mobile-card ${patient.hasDebt ? "has-debt" : ""}`;
      card.innerHTML = `
        <div class="record-mobile-card-header">
          <div>
            <span>Pacijent</span>
            <strong>${window.DrRosaSecurity.escapeHtml(patient.patient)}</strong>
          </div>
          <em class="${paymentClass}">${window.DrRosaSecurity.escapeHtml(paymentStatus)}</em>
        </div>
        <dl class="record-mobile-card-grid">
          <div><dt>Poslednja poseta</dt><dd>${window.DrRosaSecurity.escapeHtml(formatDate(patient.lastVisit))}</dd></div>
          <div><dt>Sledeci termin</dt><dd>${window.DrRosaSecurity.escapeHtml(nextAppointmentDate)}</dd></div>
          <div><dt>Poseta</dt><dd>${window.DrRosaSecurity.escapeHtml(patient.visits)}</dd></div>
          <div><dt>Dugovanje</dt><dd>${window.DrRosaSecurity.escapeHtml(debtAmount)}</dd></div>
        </dl>
        <div class="record-action-group">
          <a class="secondary-btn" href="patient-dashboard.html?${patientQuery}">Otvori</a>
          <a class="secondary-btn" href="new-entry.html?${patientQuery}">Nova poseta</a>
          <a class="secondary-btn" href="calendar.html?${patientQuery}">Zakazi</a>
        </div>
      `;
      cardsBody.appendChild(card);
    }
  });
}
function matchesPeriod(recordDate, period) {
  if (!period) return true;
  const date = new Date(recordDate);
  const now = new Date();
  const diffDays = (now - date) / (1000 * 60 * 60 * 24);
  if (period === "week") return diffDays <= 7;
  if (period === "day") return date.toDateString() === now.toDateString();
  if (period === "month") return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  if (period === "year") return date.getFullYear() === now.getFullYear();
  return true;
}

function patientHasRecordMatching(patient, matcher) {
  return patient.records.some(matcher);
}

function filterPatients(patientRows) {
  const appointment = appointmentFilter?.value || "";

  return patientRows.filter(row => {
    const nextAppointment = nextAppointmentForPatient(row);
    const matchesAppointment = !appointment
      || (appointment === "has_upcoming" && Boolean(nextAppointment))
      || (appointment === "no_upcoming" && !nextAppointment);
    return matchesAppointment;
  });
}

function refresh() {
  const filtered = filterPatients(allPatientRows);
  renderSummary(filtered);
  renderRecords(filtered);
}

async function refreshFromApi() {
  try {
    allPatientRows = await loadPatientSummaries(summaryFilterParams());
  } catch (error) {
    console.error("Patient summary load error:", error);
    allPatientRows = [];
  }
  refresh();
}

function exportFiltered(format) {
  const title = "Filtrirana evidencija pacijenata";
  const headers = ["Pacijent", "Poslednja poseta", "Sledeci termin", "Poseta", "Placanje", "Dugovanje", "Detalji"];
  if (format === "excel") {
    window.DrRosaExport.exportExcel(title, headers, currentExportRows);
    return;
  }
  window.DrRosaExport.exportPdf(title, headers, currentExportRows);
}

[searchInput, statusFilter, doctorFilter, dateFilter, periodFilter, procedureFilter, paymentFilter]
  .filter(Boolean)
  .forEach(input => input.addEventListener("change", refreshFromApi));

appointmentFilter?.addEventListener("change", refresh);

activityFilter?.addEventListener("change", () => {
  populateProcedureFilter();
  refreshFromApi();
});

advancedSearchToggle?.addEventListener("click", () => {
  const willOpen = advancedSearchPanel?.hidden !== false;
  if (!willOpen) {
    resetAdvancedFilters();
    refreshFromApi();
  }
  setAdvancedSearchOpen(willOpen);
});

exportExcelBtn?.addEventListener("click", () => exportFiltered("excel"));
exportPdfBtn?.addEventListener("click", () => exportFiltered("pdf"));

(async function init() {
  if (!await requireAccess()) return;
  applyUrlFilters();
  await procedureCatalog.loadFromApi?.();
  await populateCodebookFilters();
  applyUrlFilters();
  try {
    [allPatientRows, allAppointments, allDoctors] = await Promise.all([
      loadPatientSummaries(summaryFilterParams()),
      window.DrRosaApi.getAppointments ? window.DrRosaApi.getAppointments().catch(() => []) : [],
      window.DrRosaApi.getDoctors ? window.DrRosaApi.getDoctors().catch(() => []) : []
    ]);
    allPatientOptions = allPatientRows;
  } catch (error) {
    console.error("Records load error:", error);
    allPatientRows = [];
    allPatientOptions = [];
    allAppointments = [];
    allDoctors = [];
  }
  populatePatientFilter();
  populateDoctorFilter();
  populateActivityFilter();
  populateProcedureFilter();
  setAdvancedSearchOpen(hasAdvancedFilterValue());
  refresh();
})();
