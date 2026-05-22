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
      window.DrRosaApi.clearSession();
      window.location.href = "login.html";
    });
  }

  return true;
}

const body = document.getElementById("all-records-body");
const summaryCards = document.getElementById("summary-cards");
const searchInput = document.getElementById("search-input");
const statusFilter = document.getElementById("status-filter");
const doctorFilter = document.getElementById("doctor-filter");
const dateFilter = document.getElementById("date-filter");
const periodFilter = document.getElementById("period-filter");
const activityFilter = document.getElementById("activity-filter");
const procedureFilter = document.getElementById("procedure-filter");
const paymentFilter = document.getElementById("payment-filter");
const exportExcelBtn = document.getElementById("export-excel-btn");
const exportPdfBtn = document.getElementById("export-pdf-btn");
const procedureCatalog = window.DrRosaProcedureCatalog;

let allRecords = [];
let currentExportRows = [];

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("filter") === "debtors" && paymentFilter) {
  paymentFilter.value = "debtors";
}

function formatDate(dateString) {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleDateString("hr-HR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function isDebt(record) {
  return ["dugovanje", "delimicno"].includes(fold(record.paymentStatus)) || Number(record.amountDue || 0) > 0;
}

function fold(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function addCurrencyAmount(target, currency, amount) {
  const key = currency || "EUR";
  target[key] = (target[key] || 0) + Number(amount || 0);
}

function formatCurrencyAmounts(amounts) {
  const entries = Object.entries(amounts).filter(([, amount]) => amount > 0);
  return entries.length ? entries.map(([currency, amount]) => `${amount.toFixed(2)} ${currency}`).join(" / ") : "0.00";
}

function option(value, label = value) {
  return `<option value="${window.DrRosaSecurity.escapeHtml(value)}">${window.DrRosaSecurity.escapeHtml(label)}</option>`;
}

function populateActivityFilter() {
  if (!activityFilter || !procedureCatalog) return;
  activityFilter.innerHTML = option("", "Sve delatnosti") + procedureCatalog.getActivities().map(activity => option(activity)).join("");
}

function populatePatientFilter() {
  if (!searchInput) return;
  const patients = Array.from(new Set(allRecords.map(record => record.patient).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
  searchInput.innerHTML = option("", "Svi pacijenti") + patients.map(patient => option(patient)).join("");
}

function populateProcedureFilter() {
  if (!procedureFilter || !procedureCatalog) return;
  const activity = activityFilter?.value || "";
  const procedures = activity ? procedureCatalog.getProcedures(activity) : [];
  procedureFilter.innerHTML = option("", activity ? "Svi postupci" : "Prvo odaberi delatnost") + procedures.map(procedure => option(procedure)).join("");
  procedureFilter.disabled = !activity;
}

async function populateCodebookFilters() {
  const mappings = [
    { type: "visit_status", select: statusFilter, placeholder: "Svi statusi" },
    { type: "payment_status", select: paymentFilter, placeholder: "Sva placanja", extras: [{ value: "debtors", label: "Duznici" }] }
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

function renderSummary(records) {
  const patientMap = {};
  records.forEach((record) => {
    if (!patientMap[record.patient]) {
      patientMap[record.patient] = { visits: 0, hasDebt: false };
    }
    patientMap[record.patient].visits += 1;
    if (isDebt(record)) patientMap[record.patient].hasDebt = true;
  });

  const uniquePatients = Object.values(patientMap);
  const totalPatients = uniquePatients.length;
  const returnedPatients = uniquePatients.filter(patient => patient.visits > 1).length;
  const debtorPatients = uniquePatients.filter(patient => patient.hasDebt).length;

  summaryCards.innerHTML = `
    <div class="hero-stats-card"><p class="eyebrow">Ukupno pacijenata</p><span>${totalPatients}</span></div>
    <div class="hero-stats-card"><p class="eyebrow">Redovni pacijenti</p><span>${returnedPatients}</span></div>
    <div class="hero-stats-card"><p class="eyebrow">Duznici</p><span>${debtorPatients}</span></div>
    <div class="hero-stats-card"><p class="eyebrow">Novi pacijenti</p><span>${totalPatients - returnedPatients}</span></div>
  `;
}

function renderRecords(records) {
  body.innerHTML = "";
  const patientMap = {};

  records.forEach((record) => {
    if (!patientMap[record.patient]) {
      patientMap[record.patient] = {
        patient: record.patient,
        lastVisit: record.lastVisit,
        visits: 0,
        hasDebt: false,
        totalDebt: {},
        currencies: new Set(),
        shifts: new Map()
      };
    }
    patientMap[record.patient].visits += 1;
    patientMap[record.patient].currencies.add(record.currency || "EUR");
    const shift = record.shift || "Prva smena";
    patientMap[record.patient].shifts.set(shift, (patientMap[record.patient].shifts.get(shift) || 0) + 1);
    if (isDebt(record)) {
      patientMap[record.patient].hasDebt = true;
      addCurrencyAmount(patientMap[record.patient].totalDebt, record.currency || "EUR", record.amountDue || 0);
    }
    if (new Date(record.lastVisit) > new Date(patientMap[record.patient].lastVisit)) {
      patientMap[record.patient].lastVisit = record.lastVisit;
    }
  });

  const uniquePatients = Object.values(patientMap);
  currentExportRows = uniquePatients.map(patient => [
    patient.patient,
    formatDate(patient.lastVisit),
    patient.visits,
    "-",
    patient.hasDebt ? "Dugovanje" : "Placeno",
    Array.from(patient.currencies).join(" / "),
    Array.from(patient.shifts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "-",
    formatCurrencyAmounts(patient.totalDebt),
    "Otvori"
  ]);

  if (uniquePatients.length === 0) {
    body.innerHTML = `<tr><td colspan="9" class="empty-row">Nema pacijenata koji odgovaraju pretrazivanju.</td></tr>`;
    return;
  }

  uniquePatients.forEach((patient) => {
    const paymentStatus = patient.hasDebt ? "Dugovanje" : "Placeno";
    const paymentClass = patient.hasDebt ? "status-dugovanje" : "status-placeno";
    const row = document.createElement("tr");
    row.append(
      window.DrRosaSecurity.cell(patient.patient),
      window.DrRosaSecurity.cell(formatDate(patient.lastVisit)),
      window.DrRosaSecurity.cell(patient.visits),
      window.DrRosaSecurity.cell("-"),
      window.DrRosaSecurity.cell(paymentStatus, paymentClass),
      window.DrRosaSecurity.cell(Array.from(patient.currencies).join(" / ")),
      window.DrRosaSecurity.cell(Array.from(patient.shifts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "-"),
      window.DrRosaSecurity.cell(formatCurrencyAmounts(patient.totalDebt))
    );
    const actionCell = document.createElement("td");
    const link = document.createElement("a");
    link.href = `patient-dashboard.html?patient=${encodeURIComponent(patient.patient)}`;
    link.className = "secondary-btn";
    link.textContent = "Otvori";
    actionCell.appendChild(link);
    row.appendChild(actionCell);
    body.appendChild(row);
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

function filterRecords(records) {
  const patient = searchInput.value.trim();
  const status = statusFilter?.value || "";
  const doctor = doctorFilter?.value || "";
  const date = dateFilter?.value || "";
  const period = periodFilter?.value || "";
  const activity = activityFilter?.value || "";
  const procedure = procedureFilter?.value || "";
  const payment = paymentFilter?.value || "";

  return records.filter((record) => {
    const matchesPatient = !patient || record.patient === patient;
    const matchesStatus = !status || fold(record.status) === fold(status);
    const matchesDoctor = !doctor || fold(record.doctor) === fold(doctor) || fold(record.doctor).includes(fold(doctor));
    const matchesDate = !date || record.lastVisit === date;
    const matchesActivity = !activity || procedureCatalog.matchesActivity(record, activity);
    const matchesProcedureValue = matchesProcedure(record, procedure);
    const matchesPayment = !payment || (payment === "debtors" ? isDebt(record) : fold(record.paymentStatus) === fold(payment));
    return matchesPatient && matchesStatus && matchesDoctor && matchesDate && matchesActivity && matchesProcedureValue && matchesPayment && matchesPeriod(record.lastVisit, period);
  });
}

function refresh() {
  const filtered = filterRecords(allRecords);
  renderSummary(filtered);
  renderRecords(filtered);
}

function exportFiltered(format) {
  const title = "Filtrirana evidencija pacijenata";
  const headers = ["Pacijent", "Zadnji posjet", "Ukupno poseta", "Status", "Placanje", "Valuta", "Smena", "Dugovanje", "Detalji"];
  if (format === "excel") {
    window.DrRosaExport.exportExcel(title, headers, currentExportRows);
    return;
  }
  window.DrRosaExport.exportPdf(title, headers, currentExportRows);
}

[searchInput, statusFilter, doctorFilter, dateFilter, periodFilter, procedureFilter, paymentFilter]
  .filter(Boolean)
  .forEach(input => input.addEventListener("change", refresh));

activityFilter?.addEventListener("change", () => {
  populateProcedureFilter();
  refresh();
});

exportExcelBtn?.addEventListener("click", () => exportFiltered("excel"));
exportPdfBtn?.addEventListener("click", () => exportFiltered("pdf"));

(async function init() {
  if (!await requireAccess()) return;
  await procedureCatalog.loadFromApi?.();
  await populateCodebookFilters();
  try {
    allRecords = await window.DrRosaApi.getRecords();
  } catch (error) {
    console.error("Records load error:", error);
    allRecords = [];
  }
  populatePatientFilter();
  populateActivityFilter();
  populateProcedureFilter();
  refresh();
})();
