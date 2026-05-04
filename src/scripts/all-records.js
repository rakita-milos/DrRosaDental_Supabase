async function requireAccess() {
  const session = await window.DrRosaApi.verifySession();
  if (!session) {
    window.location.href = "login.html";
    return false;
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
const procedureFilter = document.getElementById("procedure-filter");
const paymentFilter = document.getElementById("payment-filter");

let allRecords = [];

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
        totalDebt: 0
      };
    }
    patientMap[record.patient].visits += 1;
    if (isDebt(record)) {
      patientMap[record.patient].hasDebt = true;
      patientMap[record.patient].totalDebt += Number(record.amountDue || 0);
    }
    if (new Date(record.lastVisit) > new Date(patientMap[record.patient].lastVisit)) {
      patientMap[record.patient].lastVisit = record.lastVisit;
    }
  });

  const uniquePatients = Object.values(patientMap);
  if (uniquePatients.length === 0) {
    body.innerHTML = `<tr><td colspan="7" class="empty-row">Nema pacijenata koji odgovaraju pretrazivanju.</td></tr>`;
    return;
  }

  uniquePatients.forEach((patient) => {
    const paymentStatus = patient.hasDebt ? "Dugovanje" : "Placeno";
    const paymentClass = patient.hasDebt ? "status-dugovanje" : "status-placeno";
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${patient.patient}</td>
      <td>${formatDate(patient.lastVisit)}</td>
      <td>${patient.visits}</td>
      <td>-</td>
      <td class="${paymentClass}">${paymentStatus}</td>
      <td>${patient.totalDebt.toFixed(2)} EUR</td>
      <td><a href="patient-dashboard.html?patient=${encodeURIComponent(patient.patient)}" class="secondary-btn">Otvori</a></td>
    `;
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
  const query = searchInput.value.trim().toLowerCase();
  const status = statusFilter?.value || "";
  const doctor = doctorFilter?.value || "";
  const date = dateFilter?.value || "";
  const period = periodFilter?.value || "";
  const procedure = procedureFilter?.value || "";
  const payment = paymentFilter?.value || "";

  return records.filter((record) => {
    const text = `${record.patient} ${record.procedure} ${record.doctor} ${record.note}`.toLowerCase();
    const matchesQuery = !query || text.includes(query);
    const matchesStatus = !status || fold(record.status) === fold(status);
    const matchesDoctor = !doctor || fold(record.doctor) === fold(doctor) || fold(record.doctor).includes(fold(doctor));
    const matchesDate = !date || record.lastVisit === date;
    const matchesProcedure = !procedure || fold(record.procedure) === fold(procedure);
    const matchesPayment = !payment || (payment === "debtors" ? isDebt(record) : fold(record.paymentStatus) === fold(payment));
    return matchesQuery && matchesStatus && matchesDoctor && matchesDate && matchesProcedure && matchesPayment && matchesPeriod(record.lastVisit, period);
  });
}

function refresh() {
  const filtered = filterRecords(allRecords);
  renderSummary(filtered);
  renderRecords(filtered);
}

[searchInput, statusFilter, doctorFilter, dateFilter, periodFilter, procedureFilter, paymentFilter]
  .filter(Boolean)
  .forEach(input => input.addEventListener(input.type === "search" ? "input" : "change", refresh));

(async function init() {
  if (!await requireAccess()) return;
  try {
    allRecords = await window.DrRosaApi.getRecords();
  } catch (error) {
    console.error("Records load error:", error);
    allRecords = [];
  }
  refresh();
})();
