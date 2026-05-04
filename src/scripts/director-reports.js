let cachedRecords = [];

async function checkDirectorAccess() {
  const session = await window.DrRosaApi.verifySession("director");
  if (!session) {
    window.location.href = "login.html";
    return null;
  }

  document.getElementById("user-name").textContent = session.name || session.email;
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
    { id: "financial-report", icon: "$", title: "Finansijski Izvjestaj", description: "Analiza prihoda, naplate i dugovanja" },
    { id: "patients-report", icon: "P", title: "Pacijenti", description: "Statistika o pacijentima i posjete" },
    { id: "doctors-report", icon: "D", title: "Doktori", description: "Produktivnost i opterecenje doktora" },
    { id: "procedures-report", icon: "Z", title: "Postupci", description: "Raspodjela i ucestalost postupaka" }
  ];

  document.getElementById("reports-grid").innerHTML = reports.map(report => `
    <div class="report-card" onclick="showReport('${report.id}')">
      <div class="report-icon">${report.icon}</div>
      <h3>${report.title}</h3>
      <p>${report.description}</p>
    </div>
  `).join("");
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
  if (apiReport) {
    document.getElementById("total-revenue").textContent = `${Number(apiReport.totalRevenue || 0).toFixed(2)} EUR`;
    document.getElementById("total-debt").textContent = `${Number(apiReport.totalDebt || 0).toFixed(2)} EUR`;
    document.getElementById("paid-percentage").textContent = `${apiReport.paymentPercentage || 0}%`;
  }

  const patientPayments = {};
  cachedRecords.forEach(record => {
    if (!patientPayments[record.patient]) {
      patientPayments[record.patient] = { visits: 0, amount: 0, paid: 0, debt: 0 };
    }
    const amount = Number(record.amountDue || 0);
    const price = amount > 0 ? amount : 50;
    patientPayments[record.patient].visits += 1;
    patientPayments[record.patient].amount += price;
    if (isDebt(record)) {
      patientPayments[record.patient].debt += amount;
    } else {
      patientPayments[record.patient].paid += price;
    }
  });

  if (!apiReport) {
    const totalRevenue = Object.values(patientPayments).reduce((sum, data) => sum + data.amount, 0);
    const totalDebt = Object.values(patientPayments).reduce((sum, data) => sum + data.debt, 0);
    const totalPaid = Object.values(patientPayments).reduce((sum, data) => sum + data.paid, 0);
    document.getElementById("total-revenue").textContent = `${totalRevenue.toFixed(2)} EUR`;
    document.getElementById("total-debt").textContent = `${totalDebt.toFixed(2)} EUR`;
    document.getElementById("paid-percentage").textContent = `${totalRevenue ? ((totalPaid / totalRevenue) * 100).toFixed(1) : 0}%`;
  }

  document.getElementById("payment-table").innerHTML = Object.entries(patientPayments).map(([patient, data]) => {
    const percentage = data.amount > 0 ? ((data.paid / data.amount) * 100).toFixed(0) : 0;
    return `<tr><td>${patient}</td><td>${data.visits}</td><td>${data.amount.toFixed(2)} EUR</td><td>${data.paid.toFixed(2)} EUR</td><td>${data.debt.toFixed(2)} EUR</td><td>${percentage}%</td></tr>`;
  }).join("");
}

async function loadPatientsReport() {
  const apiReport = await getReport("patients");
  const patientMap = {};
  cachedRecords.forEach(record => {
    if (!patientMap[record.patient]) patientMap[record.patient] = { visits: 0, lastVisit: record.lastVisit, debt: 0 };
    patientMap[record.patient].visits += 1;
    if (isDebt(record)) patientMap[record.patient].debt += Number(record.amountDue || 0);
    if (new Date(record.lastVisit) > new Date(patientMap[record.patient].lastVisit)) patientMap[record.patient].lastVisit = record.lastVisit;
  });

  const patients = Object.entries(patientMap);
  const regularPatients = patients.filter(([_, data]) => data.visits > 1).length;
  const newPatients = patients.filter(([_, data]) => data.visits <= 1).length;

  document.getElementById("total-patients").textContent = apiReport?.total ?? patients.length;
  document.getElementById("regular-patients").textContent = apiReport?.regular ?? regularPatients;
  document.getElementById("new-patients").textContent = apiReport?.new ?? newPatients;

  document.getElementById("patients-table").innerHTML = patients.map(([patient, data]) => `
    <tr><td>${patient}</td><td>${data.visits}</td><td>${formatDate(data.lastVisit)}</td><td>${data.debt > 0 ? "Dugovanje" : "Placeno"}</td><td>${data.debt.toFixed(2)} EUR</td></tr>
  `).join("");
}

async function loadDoctorsReport() {
  const apiReport = await getReport("doctors");
  const rows = apiReport || Object.entries(cachedRecords.reduce((acc, record) => {
    acc[record.doctor] = (acc[record.doctor] || 0) + 1;
    return acc;
  }, {})).map(([doctor, visits]) => ({ doctor, visits, percentage: cachedRecords.length ? (visits / cachedRecords.length) * 100 : 0 }));

  document.getElementById("doctors-table").innerHTML = rows.map(row => `
    <tr><td>${row.doctor}</td><td>${row.visits}</td><td>-</td><td>${Number(row.percentage || 0).toFixed(1)}%</td></tr>
  `).join("");
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
    <tr><td>${row.procedure}</td><td>${row.count}</td><td>${Number(row.percentage || 0).toFixed(1)}%</td><td>${Number(row.avgCost || 0).toFixed(2)} EUR</td></tr>
  `).join("");
}

(async function init() {
  if (!await checkDirectorAccess()) return;
  initializeReports();
  try {
    cachedRecords = await window.DrRosaApi.getRecords();
  } catch (error) {
    console.error("Director records load error:", error);
    cachedRecords = [];
  }
})();
