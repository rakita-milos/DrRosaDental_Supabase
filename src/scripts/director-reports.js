let cachedRecords = [];
let currentReportExport = { title: "Direktor izvjestaj", headers: [], rows: [] };
let activeExcelSheet = "PAZARI";
const escapeHtml = window.DrRosaSecurity.escapeHtml;
const procedureCatalog = window.DrRosaProcedureCatalog;
const MONTHS = ["Januar", "Februar", "Mart", "April", "Maj", "Jun", "Jul", "Avgust", "Septembar", "Oktobar", "Novembar", "Decembar"];
const EXCEL_SHEETS = ["PAZARI", "Hirurgija", "Protetika", "Ortodoncija", "Troškovi", "Ukupno"];
const EXCEL_CATEGORIES = {
  Hirurgija: ["Vađenja zuba", "Impakcija umnjaka", "Impakcija očnjaka", "Apikotomija", "Hirurško vađenje", "Kiretaža", "Zatvaranje sinusa", "Frenulum", "Meka tkiva", "Nivelacija grebena", "Zaostali korenovi", "Implant", "Mini implanti", "Operacija"],
  Protetika: ["Keramička kruna", "Cirkonijum kruna", "Totalna proteza", "Skeletirana proteza", "Parcijalna proteza", "Reparatura proteze", "Privremene krune", "Splintevi", "Nadogradnja", "Atečmeni", "Krunica na implantu", "Podlaganje proteze", "Fasete", "Ostalo"],
  Ortodoncija: ["Mobilna", "Fiksna", "Pozicioner", "Monoblok", "Ostalo"],
  Troškovi: ["Doprinosi", "Anastasija plata", "dr Ljilja zarada", "dr Mara zarada", "dr Dunja zarada", "dr Nikola zarada", "dr Jovana", "Nina plata", "Medical", "Dental", "Hirurgija", "Parodontologija", "Ortodoncija", "Služba"]
};

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
  if (reportId === "excel-report") loadExcelReport();
}

window.showReports = showReports;
window.showReport = showReport;

function initializeReports() {
  const reports = [
    { id: "financial-report", tone: "blue", icon: "EUR", title: "Finansijski Izvjestaj", description: "Prihodi, naplata i dugovanja" },
    { id: "patients-report", tone: "green", icon: "PAC", title: "Pacijenti", description: "Rast, retencija i statusi pacijenata" },
    { id: "doctors-report", tone: "teal", icon: "DR", title: "Doktori", description: "Produktivnost i opterecenje tima" },
    { id: "procedures-report", tone: "orange", icon: "ORD", title: "Postupci", description: "Usluge, ucestalost i prosjecna naplata" },
    { id: "excel-report", tone: "blue", icon: "TAB", title: "Izvještaji po tabovima", description: "PAZARI, hirurgija, protetika, ortodoncija, troškovi i ukupno" }
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
  const localRows = Object.values(cachedRecords.reduce((acc, record) => {
    const doctor = record.doctor || "-";
    if (!acc[doctor]) acc[doctor] = { doctor, visits: 0, patients: new Set() };
    acc[doctor].visits += 1;
    if (record.patient) acc[doctor].patients.add(record.patient);
    return acc;
  }, {})).map(row => ({
    doctor: row.doctor,
    visits: row.visits,
    patients: row.patients.size,
    percentage: cachedRecords.length ? (row.visits / cachedRecords.length) * 100 : 0
  }));

  const rows = (apiReport || localRows).map(row => {
    const local = localRows.find(item => item.doctor === row.doctor);
    return {
      doctor: row.doctor,
      visits: Number(row.visits || local?.visits || 0),
      patients: Number(row.patients ?? row.patientCount ?? row.patient_count ?? local?.patients ?? 0),
      percentage: Number(row.percentage ?? local?.percentage ?? 0)
    };
  });

  document.getElementById("doctors-table").innerHTML = rows.map(row => `
    <tr><td>${escapeHtml(row.doctor)}</td><td>${row.visits}</td><td>${row.patients}</td><td>${Number(row.percentage || 0).toFixed(1)}%</td></tr>
  `).join("");

  currentReportExport = {
    title: "Izvjestaj o doktorima",
    headers: ["Doktor", "Broj pregleda", "Broj pacijenata", "Procenat ukupnog rada"],
    rows: rows.map(row => [
      row.doctor,
      row.visits,
      row.patients,
      `${Number(row.percentage || 0).toFixed(1)}%`
    ])
  };
}

async function loadProceduresReport() {
  const apiReport = await getReport("procedures");
  const rows = apiReport || Object.entries(cachedRecords.reduce((acc, record) => {
    recordTreatmentEntries(record).forEach(entry => {
      const procedure = entry.type || record.procedure || "Ostalo";
      const activity = procedureCatalog.findActivityForProcedure(procedure) || "Ostalo";
      const key = `${activity}|||${procedure}`;
      if (!acc[key]) acc[key] = { activity, procedure, count: 0, totalAmount: 0 };
      acc[key].count += 1;
      acc[key].totalAmount += Number(entry.amount || record.amountDue || 0);
    });
    return acc;
  }, {})).map(([, data]) => ({
    activity: data.activity,
    procedure: data.procedure,
    count: data.count,
    percentage: cachedRecords.length ? (data.count / cachedRecords.length) * 100 : 0,
    avgCost: data.count ? data.totalAmount / data.count : 0
  })).sort((a, b) => a.activity.localeCompare(b.activity) || a.procedure.localeCompare(b.procedure));

  document.getElementById("procedures-table").innerHTML = rows.map(row => `
    <tr><td>${escapeHtml(row.procedure)}</td><td>${escapeHtml(row.activity || procedureCatalog.findActivityForProcedure(row.procedure) || "-")}</td><td>${row.count}</td><td>${Number(row.percentage || 0).toFixed(1)}%</td><td>${Number(row.avgCost || 0).toFixed(2)} EUR</td></tr>
  `).join("");

  currentReportExport = {
    title: "Izvjestaj o postupcima",
    headers: ["Postupak", "Delatnost", "Broj izvrsenih", "Procenat", "Prosjecna naplata"],
    rows: rows.map(row => [
      row.procedure,
      row.activity || procedureCatalog.findActivityForProcedure(row.procedure) || "-",
      row.count,
      `${Number(row.percentage || 0).toFixed(1)}%`,
      `${Number(row.avgCost || 0).toFixed(2)} EUR`
    ])
  };
}

function fold(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function recordDateParts(record) {
  const date = new Date(record.lastVisit);
  if (Number.isNaN(date.getTime())) return null;
  return { year: date.getFullYear(), month: date.getMonth(), day: date.getDate() };
}

function treatmentListForValue(treatments) {
  if (!treatments) return [];
  return Array.isArray(treatments) ? treatments : [treatments];
}

function recordTreatmentEntries(record) {
  const entries = [];
  if (record.treatments) {
    Object.entries(record.treatments).forEach(([tooth, treatments]) => {
      treatmentListForValue(treatments).forEach(treatment => {
        entries.push({
          tooth,
          type: treatment.type || record.procedure,
          amount: Math.max(0, Number(treatment.price || 0) - Number(treatment.discount || 0))
        });
      });
    });
  }

  if (entries.length === 0) {
    entries.push({ tooth: "", type: record.procedure, amount: Number(record.amountDue || 0) });
  }

  return entries;
}

function recordTotal(record) {
  const treatmentsTotal = recordTreatmentEntries(record).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return Math.max(0, treatmentsTotal - Number(record.totalDiscount || 0));
}

function matchesCategory(text, category) {
  const source = fold(text);
  const target = fold(category);
  if (source.includes(target) || target.includes(source)) return true;
  if (target.includes("vad") && source.includes("vad")) return true;
  if (target.includes("implant") && source.includes("implant")) return true;
  if (target.includes("krun") && source.includes("krun")) return true;
  if (target.includes("prote") && source.includes("prote")) return true;
  if (target.includes("fiks") && source.includes("fiks")) return true;
  if (target.includes("mobil") && source.includes("mobil")) return true;
  if (target.includes("parodont") && source.includes("parodont")) return true;
  if (target.includes("ortod") && source.includes("ortod")) return true;
  return false;
}

function categoryForEntry(sheet, entry) {
  const categories = EXCEL_CATEGORIES[sheet] || [];
  return categories.find(category => matchesCategory(entry.type, category)) || (categories.includes("Ostalo") ? "Ostalo" : null);
}

function recordsForMonth(monthIndex, year) {
  return cachedRecords.filter(record => {
    const parts = recordDateParts(record);
    return parts?.month === monthIndex && parts?.year === year;
  });
}

function daysInMonth(monthIndex, year) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("sr-RS", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function cell(value, className = "") {
  return `<td class="${className}">${escapeHtml(value ?? "")}</td>`;
}

function headerCell(value, className = "") {
  return `<th class="${className}">${escapeHtml(value ?? "")}</th>`;
}

function buildPazariRows(monthIndex, year) {
  const dayCount = daysInMonth(monthIndex, year);
  const days = Array.from({ length: dayCount }, (_, index) => ({ day: index + 1, firstEur: 0, firstRsd: 0, secondEur: 0, secondRsd: 0, debtEur: 0, debtRsd: 0 }));
  recordsForMonth(monthIndex, year).forEach(record => {
    const parts = recordDateParts(record);
    if (!parts || parts.day < 1 || parts.day > dayCount) return;
    const row = days[parts.day - 1];
    const amount = recordTotal(record) || Number(record.amountDue || 0);
    const currency = record.currency === "RSD" ? "RSD" : "EUR";
    const isSecondShift = fold(record.shift).includes("drug");
    const debt = isDebt(record) ? Number(record.amountDue || 0) : 0;
    if (debt > 0) {
      if (currency === "RSD") row.debtRsd += debt; else row.debtEur += debt;
      return;
    }
    if (isSecondShift) {
      if (currency === "RSD") row.secondRsd += amount; else row.secondEur += amount;
    } else {
      if (currency === "RSD") row.firstRsd += amount; else row.firstEur += amount;
    }
  });
  return days;
}

function renderPazariSheet(monthIndex, year) {
  const rows = buildPazariRows(monthIndex, year);
  const bodyRows = rows.map(row => {
    const totalEur = row.firstEur + row.secondEur + row.debtEur;
    const totalRsd = row.firstRsd + row.secondRsd + row.debtRsd;
    const total = totalEur + (totalRsd / 117.6);
    return `<tr>${cell(row.day, "excel-day")}${cell(formatNumber(row.firstEur))}${cell(formatNumber(row.firstRsd))}${cell(formatNumber(row.secondEur))}${cell(formatNumber(row.secondRsd))}${cell(formatNumber(row.debtEur))}${cell(formatNumber(row.debtRsd))}${cell(formatNumber(totalEur), "excel-total")}${cell(formatNumber(totalRsd), "excel-total")}${cell(formatNumber(total), "excel-total")}</tr>`;
  }).join("");
  const totals = rows.reduce((acc, row) => {
    ["firstEur", "firstRsd", "secondEur", "secondRsd", "debtEur", "debtRsd"].forEach(key => acc[key] += row[key]);
    return acc;
  }, { firstEur: 0, firstRsd: 0, secondEur: 0, secondRsd: 0, debtEur: 0, debtRsd: 0 });
  const totalEur = totals.firstEur + totals.secondEur + totals.debtEur;
  const totalRsd = totals.firstRsd + totals.secondRsd + totals.debtRsd;
  const total = totalEur + (totalRsd / 117.6);
  return `
    <caption>PAZARI - ${MONTHS[monthIndex]} ${year}</caption>
    <thead>
      <tr><th>Dan</th><th>I smena EUR</th><th>I smena RSD</th><th>II smena EUR</th><th>II smena RSD</th><th>Dug EUR</th><th>Dug RSD</th><th>Ukupno EUR</th><th>Ukupno RSD</th><th>Ukupno</th></tr>
    </thead>
    <tbody>${bodyRows}<tr class="excel-sum-row">${cell("Ukupno:")}${cell(formatNumber(totals.firstEur))}${cell(formatNumber(totals.firstRsd))}${cell(formatNumber(totals.secondEur))}${cell(formatNumber(totals.secondRsd))}${cell(formatNumber(totals.debtEur))}${cell(formatNumber(totals.debtRsd))}${cell(formatNumber(totalEur))}${cell(formatNumber(totalRsd))}${cell(formatNumber(total))}</tr></tbody>
  `;
}

function aggregateCategorySheet(sheet, monthIndex, year) {
  const categories = EXCEL_CATEGORIES[sheet] || [];
  const dayCount = daysInMonth(monthIndex, year);
  const rows = Array.from({ length: dayCount }, (_, index) => ({
    day: index + 1,
    categories: Object.fromEntries(categories.map(category => [category, { count: 0, amount: 0 }]))
  }));
  recordsForMonth(monthIndex, year).forEach(record => {
    const parts = recordDateParts(record);
    if (!parts || parts.day < 1 || parts.day > dayCount) return;
    recordTreatmentEntries(record).forEach(entry => {
      const category = categoryForEntry(sheet, entry);
      if (!category) return;
      rows[parts.day - 1].categories[category].count += 1;
      rows[parts.day - 1].categories[category].amount += Number(entry.amount || 0);
    });
  });
  return rows;
}

function renderCategorySheet(sheet, monthIndex, year) {
  const categories = EXCEL_CATEGORIES[sheet] || [];
  const rows = aggregateCategorySheet(sheet, monthIndex, year);
  const headers = categories.map(category => `<th>${escapeHtml(category)} Kol.</th><th>${escapeHtml(category)} Cena</th>`).join("");
  const bodyRows = rows.map(row => {
    let rowTotal = 0;
    const categoryCells = categories.map(category => {
      const data = row.categories[category];
      rowTotal += data.amount;
      return `${cell(data.count || "")}${cell(data.amount ? formatNumber(data.amount) : "")}`;
    }).join("");
    return `<tr>${cell(row.day, "excel-day")}${categoryCells}${cell(formatNumber(rowTotal), "excel-total")}</tr>`;
  }).join("");
  const sums = Object.fromEntries(categories.map(category => [category, { count: 0, amount: 0 }]));
  rows.forEach(row => categories.forEach(category => {
    sums[category].count += row.categories[category].count;
    sums[category].amount += row.categories[category].amount;
  }));
  const grandTotal = categories.reduce((sum, category) => sum + sums[category].amount, 0);
  const sumRow = categories.map(category => `${cell(sums[category].count || "")}${cell(sums[category].amount ? formatNumber(sums[category].amount) : "")}`).join("");
  return `
    <caption>${escapeHtml(sheet)} - ${MONTHS[monthIndex]} ${year}</caption>
    <thead>
      <tr><th>Dan</th>${headers}<th>Ukupno</th></tr>
    </thead>
    <tbody>${bodyRows}<tr class="excel-sum-row">${cell("Ukupno:")}${sumRow}${cell(formatNumber(grandTotal))}</tr></tbody>
  `;
}

function monthlyTotals(year) {
  return MONTHS.map((month, monthIndex) => {
    const pazarRows = buildPazariRows(monthIndex, year);
    const pazari = pazarRows.reduce((sum, row) => sum + row.firstEur + row.secondEur + row.debtEur + ((row.firstRsd + row.secondRsd + row.debtRsd) / 117.6), 0);
    const categories = ["Hirurgija", "Protetika", "Ortodoncija"].reduce((acc, sheet) => {
      acc[sheet] = aggregateCategorySheet(sheet, monthIndex, year).reduce((sum, row) => sum + Object.values(row.categories).reduce((inner, item) => inner + item.amount, 0), 0);
      return acc;
    }, {});
    const troskovi = aggregateCategorySheet("Troškovi", monthIndex, year).reduce((sum, row) => sum + Object.values(row.categories).reduce((inner, item) => inner + item.amount, 0), 0);
    return { month, pazari, ...categories, troskovi, total: pazari + categories.Hirurgija + categories.Protetika + categories.Ortodoncija - troskovi };
  });
}

function renderUkupnoSheet(year) {
  const rows = monthlyTotals(year);
  const bodyRows = rows.map(row => `<tr>${cell(row.month)}${cell(formatNumber(row.pazari))}${cell(formatNumber(row.Hirurgija))}${cell(formatNumber(row.Protetika))}${cell(formatNumber(row.Ortodoncija))}${cell(formatNumber(row.troskovi))}${cell(formatNumber(row.total), "excel-total")}</tr>`).join("");
  const totals = rows.reduce((acc, row) => {
    ["pazari", "Hirurgija", "Protetika", "Ortodoncija", "troskovi", "total"].forEach(key => acc[key] += row[key]);
    return acc;
  }, { pazari: 0, Hirurgija: 0, Protetika: 0, Ortodoncija: 0, troskovi: 0, total: 0 });
  return `
    <caption>Ukupno po mesecima - ${year}</caption>
    <thead><tr>${["Mesec", "PAZARI", "Hirurgija", "Protetika", "Ortodoncija", "Troškovi", "Ukupno"].map(header => headerCell(header)).join("")}</tr></thead>
    <tbody>${bodyRows}<tr class="excel-sum-row">${cell("Ukupno:")}${cell(formatNumber(totals.pazari))}${cell(formatNumber(totals.Hirurgija))}${cell(formatNumber(totals.Protetika))}${cell(formatNumber(totals.Ortodoncija))}${cell(formatNumber(totals.troskovi))}${cell(formatNumber(totals.total))}</tr></tbody>
  `;
}

function updateExcelSummary(monthIndex, year) {
  const rows = monthlyTotals(year);
  const month = rows[monthIndex] || rows[0];
  document.getElementById("excel-report-summary").innerHTML = `
    <article><span>PAZARI</span><strong>${formatNumber(month.pazari)}</strong></article>
    <article><span>Hirurgija</span><strong>${formatNumber(month.Hirurgija)}</strong></article>
    <article><span>Protetika</span><strong>${formatNumber(month.Protetika)}</strong></article>
    <article><span>Ortodoncija</span><strong>${formatNumber(month.Ortodoncija)}</strong></article>
    <article><span>Troškovi</span><strong>${formatNumber(month.troskovi)}</strong></article>
    <article><span>Ukupno</span><strong>${formatNumber(month.total)}</strong></article>
  `;
}

function availableReportYears() {
  const currentYear = new Date().getFullYear();
  const endYear = currentYear + 1;
  return Array.from({ length: endYear - 2020 + 1 }, (_, index) => endYear - index);
}

function renderExcelSheet() {
  const monthIndex = Number(document.getElementById("excel-month-select").value || 0);
  const year = Number(document.getElementById("excel-year-select").value || new Date().getFullYear());
  const table = document.getElementById("excel-sheet-table");
  document.querySelectorAll("[data-excel-sheet]").forEach(button => {
    button.classList.toggle("active", button.dataset.excelSheet === activeExcelSheet);
  });
  if (activeExcelSheet === "PAZARI") table.innerHTML = renderPazariSheet(monthIndex, year);
  else if (activeExcelSheet === "Ukupno") table.innerHTML = renderUkupnoSheet(year);
  else table.innerHTML = renderCategorySheet(activeExcelSheet, monthIndex, year);
  updateExcelSummary(monthIndex, year);

  currentReportExport = {
    title: `${activeExcelSheet} ${activeExcelSheet === "Ukupno" ? year : `${MONTHS[monthIndex]} ${year}`}`,
    headers: Array.from(table.querySelectorAll("thead tr:last-child th")).map(th => th.textContent.trim()),
    rows: Array.from(table.querySelectorAll("tbody tr")).map(tr => Array.from(tr.children).map(td => td.textContent.trim()))
  };
}

function initializeExcelReportControls() {
  const tabs = document.getElementById("excel-report-tabs");
  const monthSelect = document.getElementById("excel-month-select");
  const yearSelect = document.getElementById("excel-year-select");
  if (!tabs || tabs.dataset.ready) return;
  tabs.dataset.ready = "true";
  tabs.innerHTML = EXCEL_SHEETS.map(sheet => `<button type="button" data-excel-sheet="${escapeHtml(sheet)}">${escapeHtml(sheet)}</button>`).join("");
  monthSelect.innerHTML = MONTHS.map((month, index) => `<option value="${index}">${month}</option>`).join("");
  yearSelect.innerHTML = availableReportYears().map(year => `<option value="${year}">${year}</option>`).join("");
  tabs.addEventListener("click", event => {
    const button = event.target.closest("[data-excel-sheet]");
    if (!button) return;
    activeExcelSheet = button.dataset.excelSheet;
    renderExcelSheet();
  });
  monthSelect.addEventListener("change", renderExcelSheet);
  yearSelect.addEventListener("change", renderExcelSheet);
}

function loadExcelReport() {
  initializeExcelReportControls();
  document.querySelectorAll("[data-excel-sheet]").forEach(button => {
    button.classList.toggle("active", button.dataset.excelSheet === activeExcelSheet);
  });
  renderExcelSheet();
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
