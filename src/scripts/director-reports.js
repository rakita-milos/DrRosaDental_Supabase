let cachedRecords = [];
let currentReportExport = { title: "Direktor izvjestaj", headers: [], rows: [] };
const escapeHtml = window.DrRosaSecurity.escapeHtml;

async function checkDirectorAccess() {
  const session = await window.DrRosaApi.verifySession("director");
  if (!session) {
    window.location.href = "login.html";
    return null;
  }

  document.getElementById("logout-btn").addEventListener("click", () => {
    window.DrRosaApi.clearSession();
    window.location.href = "login.html";
  });

  return session;
}

function formatDate(dateString) {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleDateString("hr-HR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function isDebt(record) {
  const payment = String(record.paymentStatus || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return ["dugovanje", "delimicno"].includes(payment) || Number(record.amountDue || 0) > 0;
}

function addCurrencyAmount(target, currency, amount) {
  const key = currency || "EUR";
  target[key] = (target[key] || 0) + Number(amount || 0);
}

function formatCurrencyAmounts(amounts) {
  const entries = Object.entries(amounts).filter(([, amount]) => amount > 0);
  return entries.length ? entries.map(([currency, amount]) => `${amount.toFixed(2)} ${currency}`).join(" / ") : "0.00";
}

function showReports() {
  document.getElementById("reports-grid").style.display = "grid";
  document.querySelectorAll(".report-content").forEach(el => el.classList.remove("active"));
}

async function showReport(reportId) {
  document.getElementById("reports-grid").style.display = "none";
  document.querySelectorAll(".report-content").forEach(el => el.classList.remove("active"));
  document.getElementById(reportId).classList.add("active");

  if (reportId === "financial-report") await loadFinancialReport();
  if (reportId === "patients-report") await loadPatientsReport();
  if (reportId === "doctors-report") await loadDoctorsReport();
  if (reportId === "procedures-report") await loadProceduresReport();
}

window.showReports = showReports;
window.showReport = showReport;

function initializeReports() {
  const reports = [
    { id: "financial-report", tone: "blue", icon: "EUR", title: "Finansijski Izvjestaj", description: "Prihodi, naplata i dugovanja" },
    { id: "patients-report", tone: "green", icon: "PAC", title: "Pacijenti", description: "Rast, retencija i statusi pacijenata" },
    { id: "doctors-report", tone: "teal", icon: "DR", title: "Doktori", description: "Produktivnost i opterecenje tima" },
    { id: "procedures-report", tone: "orange", icon: "ORD", title: "Postupci", description: "Usluge, ucestalost i prosjecna naplata" }
  ];

  document.getElementById("reports-grid").innerHTML = reports.map(report => `
    <button class="report-card report-card-${report.tone}" type="button" data-report-id="${report.id}">
      <span class="report-icon">${report.icon}</span>
      <span class="report-title">${report.title}</span>
      <span class="report-description">${report.description}</span>
    </button>
  `).join("");
}

function initializeReportNavigation() {
  document.getElementById("reports-grid").addEventListener("click", event => {
    const card = event.target.closest("[data-report-id]");
    if (!card) return;
    showReport(card.dataset.reportId);
  });

  document.querySelectorAll(".back-to-reports").forEach(button => {
    button.addEventListener("click", showReports);
  });
}

function initializeExportActions() {
  document.querySelectorAll(".report-content > .section-header").forEach(header => {
    if (header.querySelector(".export-actions")) return;
    const actions = document.createElement("div");
    actions.className = "export-actions";
    actions.innerHTML = `
      <button class="secondary-btn export-report-excel" type="button">Excel</button>
      <button class="secondary-btn export-report-pdf" type="button">PDF</button>
    `;
    header.appendChild(actions);
  });

  document.querySelectorAll(".export-report-excel").forEach(button => {
    button.addEventListener("click", () => {
      window.DrRosaExport.exportExcel(currentReportExport.title, currentReportExport.headers, currentReportExport.rows);
    });
  });

  document.querySelectorAll(".export-report-pdf").forEach(button => {
    button.addEventListener("click", () => {
      window.DrRosaExport.exportPdf(currentReportExport.title, currentReportExport.headers, currentReportExport.rows);
    });
  });
}

async function getReport(type) {
  if (!localStorage.getItem("drrosa-token")) return null;
  try {
    return await window.DrRosaApi.getDirectorReport(type);
  } catch (error) {
    console.error(`${type} report API error:`, error);
    return null;
  }
}

async function loadFinancialReport() {
  const apiReport = await getReport("financial");
  if (apiReport && cachedRecords.length === 0) {
    document.getElementById("total-revenue").textContent = `${Number(apiReport.totalRevenue || 0).toFixed(2)} EUR`;
    document.getElementById("total-debt").textContent = `${Number(apiReport.totalDebt || 0).toFixed(2)} EUR`;
    document.getElementById("paid-percentage").textContent = `${apiReport.paymentPercentage || 0}%`;
  }

  const patientPayments = {};
  cachedRecords.forEach(record => {
    if (!patientPayments[record.patient]) {
      patientPayments[record.patient] = { visits: 0, amount: {}, paid: {}, debt: {}, amountTotal: 0, paidTotal: 0 };
    }
    const amount = Number(record.amountDue || 0);
    const price = amount > 0 ? amount : 50;
    const currency = record.currency || "EUR";
    patientPayments[record.patient].visits += 1;
    patientPayments[record.patient].amountTotal += price;
    addCurrencyAmount(patientPayments[record.patient].amount, currency, price);
    if (isDebt(record)) {
      addCurrencyAmount(patientPayments[record.patient].debt, currency, amount);
    } else {
      patientPayments[record.patient].paidTotal += price;
      addCurrencyAmount(patientPayments[record.patient].paid, currency, price);
    }
  });

  const totalRevenueByCurrency = {};
  const totalDebtByCurrency = {};
  let totalRevenueComparable = 0;
  let totalPaidComparable = 0;
  Object.values(patientPayments).forEach(data => {
    Object.entries(data.amount).forEach(([currency, amount]) => addCurrencyAmount(totalRevenueByCurrency, currency, amount));
    Object.entries(data.debt).forEach(([currency, amount]) => addCurrencyAmount(totalDebtByCurrency, currency, amount));
    totalRevenueComparable += data.amountTotal;
    totalPaidComparable += data.paidTotal;
  });
  document.getElementById("total-revenue").textContent = formatCurrencyAmounts(totalRevenueByCurrency);
  document.getElementById("total-debt").textContent = formatCurrencyAmounts(totalDebtByCurrency);
  document.getElementById("paid-percentage").textContent = `${totalRevenueComparable ? ((totalPaidComparable / totalRevenueComparable) * 100).toFixed(1) : 0}%`;

  document.getElementById("payment-table").innerHTML = Object.entries(patientPayments).map(([patient, data]) => {
    const percentage = data.amountTotal > 0 ? ((data.paidTotal / data.amountTotal) * 100).toFixed(0) : 0;
    return `<tr><td>${escapeHtml(patient)}</td><td>${data.visits}</td><td>${formatCurrencyAmounts(data.amount)}</td><td>${formatCurrencyAmounts(data.paid)}</td><td>${formatCurrencyAmounts(data.debt)}</td><td>${percentage}%</td></tr>`;
  }).join("");

  currentReportExport = {
    title: "Finansijski izvjestaj",
    headers: ["Pacijent", "Broj pregleda", "Ukupan iznos", "Placeno", "Dugovanje", "Procenat"],
    rows: Object.entries(patientPayments).map(([patient, data]) => {
      const percentage = data.amountTotal > 0 ? ((data.paidTotal / data.amountTotal) * 100).toFixed(0) : 0;
      return [patient, data.visits, formatCurrencyAmounts(data.amount), formatCurrencyAmounts(data.paid), formatCurrencyAmounts(data.debt), `${percentage}%`];
    })
  };
}

async function loadPatientsReport() {
  const apiReport = await getReport("patients");
  const patientMap = {};
  cachedRecords.forEach(record => {
    if (!patientMap[record.patient]) patientMap[record.patient] = { visits: 0, lastVisit: record.lastVisit, debt: {}, debtTotal: 0 };
    patientMap[record.patient].visits += 1;
    if (isDebt(record)) {
      patientMap[record.patient].debtTotal += Number(record.amountDue || 0);
      addCurrencyAmount(patientMap[record.patient].debt, record.currency || "EUR", record.amountDue || 0);
    }
    if (new Date(record.lastVisit) > new Date(patientMap[record.patient].lastVisit)) patientMap[record.patient].lastVisit = record.lastVisit;
  });

  const patients = Object.entries(patientMap);
  const regularPatients = patients.filter(([_, data]) => data.visits > 1).length;
  const newPatients = patients.filter(([_, data]) => data.visits <= 1).length;

  document.getElementById("total-patients").textContent = apiReport?.total ?? patients.length;
  document.getElementById("regular-patients").textContent = apiReport?.regular ?? regularPatients;
  document.getElementById("new-patients").textContent = apiReport?.new ?? newPatients;

  document.getElementById("patients-table").innerHTML = patients.map(([patient, data]) => `
    <tr><td>${escapeHtml(patient)}</td><td>${data.visits}</td><td>${formatDate(data.lastVisit)}</td><td>${data.debtTotal > 0 ? "Dugovanje" : "Placeno"}</td><td>${formatCurrencyAmounts(data.debt)}</td></tr>
  `).join("");

  currentReportExport = {
    title: "Izvjestaj o pacijentima",
    headers: ["Pacijent", "Broj posjeta", "Zadnja posjeta", "Status", "Dugovanje"],
    rows: patients.map(([patient, data]) => [
      patient,
      data.visits,
      formatDate(data.lastVisit),
      data.debtTotal > 0 ? "Dugovanje" : "Placeno",
      formatCurrencyAmounts(data.debt)
    ])
  };
}

async function loadDoctorsReport() {
  const apiReport = await getReport("doctors");
  const rows = apiReport || Object.entries(cachedRecords.reduce((acc, record) => {
    acc[record.doctor] = (acc[record.doctor] || 0) + 1;
    return acc;
  }, {})).map(([doctor, visits]) => ({ doctor, visits, percentage: cachedRecords.length ? (visits / cachedRecords.length) * 100 : 0 }));

  document.getElementById("doctors-table").innerHTML = rows.map(row => `
    <tr><td>${escapeHtml(row.doctor)}</td><td>${row.visits}</td><td>-</td><td>${Number(row.percentage || 0).toFixed(1)}%</td></tr>
  `).join("");

  currentReportExport = {
    title: "Izvjestaj o doktorima",
    headers: ["Doktor", "Broj pregleda", "Broj pacijenata", "Procenat ukupnog rada"],
    rows: rows.map(row => [
      row.doctor,
      row.visits,
      "-",
      `${Number(row.percentage || 0).toFixed(1)}%`
    ])
  };
}

async function loadProceduresReport() {
  const apiReport = await getReport("procedures");
  const rows = apiReport || Object.entries(cachedRecords.reduce((acc, record) => {
    if (!acc[record.procedure]) acc[record.procedure] = { count: 0, totalAmount: 0 };
    acc[record.procedure].count += 1;
    acc[record.procedure].totalAmount += Number(record.amountDue || 50);
    return acc;
  }, {})).map(([procedure, data]) => ({
    procedure,
    count: data.count,
    percentage: cachedRecords.length ? (data.count / cachedRecords.length) * 100 : 0,
    avgCost: data.count ? data.totalAmount / data.count : 0
  }));

  document.getElementById("procedures-table").innerHTML = rows.map(row => `
    <tr><td>${escapeHtml(row.procedure)}</td><td>${row.count}</td><td>${Number(row.percentage || 0).toFixed(1)}%</td><td>${Number(row.avgCost || 0).toFixed(2)} EUR</td></tr>
  `).join("");

  currentReportExport = {
    title: "Izvjestaj o postupcima",
    headers: ["Postupak", "Broj izvrsenih", "Procenat", "Prosjecna naplata"],
    rows: rows.map(row => [
      row.procedure,
      row.count,
      `${Number(row.percentage || 0).toFixed(1)}%`,
      `${Number(row.avgCost || 0).toFixed(2)} EUR`
    ])
  };
}

(async function init() {
  if (!await checkDirectorAccess()) return;
  initializeReports();
  initializeReportNavigation();
  initializeExportActions();
  try {
    cachedRecords = await window.DrRosaApi.getRecords();
  } catch (error) {
    console.error("Director records load error:", error);
    cachedRecords = [];
  }
})();
