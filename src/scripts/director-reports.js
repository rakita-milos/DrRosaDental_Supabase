let cachedRecords = [];
let currentReportExport = { title: "Direktor izvjestaj", headers: [], rows: [] };
let activeExcelSheet = "PAZARI";
let codebookItems = [];
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
const CODEBOOK_LABELS = {
  activity: "Delatnosti",
  procedure: "Postupci",
  visit_status: "Statusi posete",
  payment_status: "Statusi placanja",
  currency: "Valute",
  shift: "Smene"
};
const CODEBOOK_DESCRIPTIONS = {
  activity: "Grupe stomatoloskih usluga koje se koriste za postupke.",
  procedure: "Pojedinacni postupci i cene po delatnostima.",
  visit_status: "Status pregleda ili posete pacijenta.",
  payment_status: "Status naplate za posete i dugovanja.",
  currency: "Valute dostupne pri unosu placanja.",
  shift: "Smene rada ordinacije sa vremenom i danima."
};
const WEEKDAY_LABELS = {
  monday: "Ponedeljak",
  tuesday: "Utorak",
  wednesday: "Sreda",
  thursday: "Četvrtak",
  friday: "Petak",
  saturday: "Subota",
  sunday: "Nedelja"
};
let activeCodebookType = "activity";

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

function showCodebookList() {
  document.querySelectorAll(".report-content").forEach(el => el.classList.remove("active"));
  document.getElementById("reports-grid").style.display = "none";
  document.getElementById("admin-codebooks-report").classList.add("active");
  renderCodebookGrid();
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
  if (reportId === "admin-codebooks-report") await loadCodebooksAdmin();
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

  reports.push({ id: "admin-codebooks-report", tone: "teal", icon: "ADM", title: "Admin sifarnici", description: "Delatnosti, postupci, statusi, valute i smene" });

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

  document.querySelector(".back-to-codebooks")?.addEventListener("click", showCodebookList);
}

function initializeExportActions() {
  document.querySelectorAll(".report-content > .section-header").forEach(header => {
    if (header.closest("#admin-codebooks-report")) return;
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
          activity: treatment.activity || procedureCatalog.findActivityForProcedure(treatment.type || record.procedure),
          amount: Math.max(0, Number(treatment.price || 0) - Number(treatment.discount || 0))
        });
      });
    });
  }

  if (entries.length === 0) {
    entries.push({
      tooth: "",
      type: record.procedure,
      activity: procedureCatalog.findActivityForProcedure(record.procedure),
      amount: Number(record.amountDue || 0)
    });
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
  if (["Hirurgija", "Protetika", "Ortodoncija"].includes(sheet)) {
    const activity = entry.activity || procedureCatalog.findActivityForProcedure(entry.type);
    if (activity && activity !== sheet) return null;
  }
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
  const bodyItems = rows.flatMap(row => categories
    .map(category => ({ day: row.day, category, ...row.categories[category] }))
    .filter(item => item.count > 0 || item.amount > 0));
  const bodyRows = bodyItems.length
    ? bodyItems.map(item => `<tr>${cell(item.day, "excel-day")}${cell(item.category)}${cell(item.count)}${cell(formatNumber(item.amount), "excel-total")}</tr>`).join("")
    : `<tr><td colspan="4" class="empty-row">Nema podataka za izabrani mesec i godinu.</td></tr>`;
  const sums = Object.fromEntries(categories.map(category => [category, { count: 0, amount: 0 }]));
  rows.forEach(row => categories.forEach(category => {
    sums[category].count += row.categories[category].count;
    sums[category].amount += row.categories[category].amount;
  }));
  const totalCount = categories.reduce((sum, category) => sum + sums[category].count, 0);
  const grandTotal = categories.reduce((sum, category) => sum + sums[category].amount, 0);
  return `
    <caption>${escapeHtml(sheet)} - ${MONTHS[monthIndex]} ${year}</caption>
    <thead>
      <tr><th>Dan</th><th>Stavka</th><th>Kolicina</th><th>Cena</th></tr>
    </thead>
    <tbody>${bodyRows}<tr class="excel-sum-row">${cell("Ukupno:")}${cell("")}${cell(totalCount)}${cell(formatNumber(grandTotal))}</tr></tbody>
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

function codebookFormElements() {
  return {
    form: document.getElementById("codebook-form"),
    id: document.getElementById("codebook-id"),
    type: document.getElementById("codebook-type"),
    value: document.getElementById("codebook-value"),
    label: document.getElementById("codebook-label"),
    group: document.getElementById("codebook-group"),
    price: document.getElementById("codebook-price"),
    sort: document.getElementById("codebook-sort"),
    active: document.getElementById("codebook-active"),
    message: document.getElementById("codebook-message"),
    table: document.getElementById("codebook-table"),
    reset: document.getElementById("codebook-reset"),
    groups: document.getElementById("codebook-groups"),
    grid: document.getElementById("codebook-grid"),
    title: document.getElementById("codebook-editor-title"),
    shiftFields: document.getElementById("shift-fields"),
    shiftTimeFrom: document.getElementById("shift-time-from"),
    shiftTimeTo: document.getElementById("shift-time-to"),
    shiftDays: Array.from(document.querySelectorAll('input[name="shift-days"]')),
    currencyFields: document.getElementById("currency-fields"),
    currencyRate: document.getElementById("currency-rate"),
    currencyRateDate: document.getElementById("currency-rate-date"),
    fetchCurrencyRate: document.getElementById("fetch-currency-rate"),
    groupField: document.querySelector(".codebook-group-field"),
    priceField: document.querySelector(".codebook-price-field"),
    valueField: document.getElementById("codebook-value-field"),
    detailHeader: document.getElementById("codebook-detail-header"),
    priceHeader: document.getElementById("codebook-price-header")
  };
}

function codebookItemsFor(type) {
  return codebookItems.filter(item => item.type === type);
}

function renderCodebookGrid() {
  const { grid } = codebookFormElements();
  if (!grid) return;
  grid.innerHTML = Object.entries(CODEBOOK_LABELS).map(([type, label]) => {
    const count = codebookItemsFor(type).length;
    return `
      <button class="report-card report-card-teal codebook-card" type="button" data-codebook-type="${type}">
        <span class="report-icon">${count}</span>
        <span class="report-title">${escapeHtml(label)}</span>
        <span class="report-description">${escapeHtml(CODEBOOK_DESCRIPTIONS[type] || "")}</span>
      </button>
    `;
  }).join("");
}

function openCodebookEditor(type) {
  activeCodebookType = type;
  const elements = codebookFormElements();
  elements.type.value = type;
  elements.title.textContent = CODEBOOK_LABELS[type] || "Sifarnik";
  document.querySelectorAll(".report-content").forEach(el => el.classList.remove("active"));
  document.getElementById("reports-grid").style.display = "none";
  document.getElementById("admin-codebook-editor").classList.add("active");
  resetCodebookForm();
  updateShiftFieldsVisibility();
  renderCodebooksAdmin();
  if (type === "currency") refreshCurrencyRatesIfNeeded();
}

function updateShiftFieldsVisibility() {
  const elements = codebookFormElements();
  const hideGroupField = ["activity", "currency", "visit_status", "payment_status", "shift"].includes(activeCodebookType);
  const hidePriceField = ["activity", "currency", "visit_status", "payment_status", "shift"].includes(activeCodebookType);
  const hideDetailColumn = ["activity", "visit_status", "payment_status"].includes(activeCodebookType);
  const showPriceColumn = activeCodebookType === "procedure";
  elements.shiftFields?.classList.toggle("active", activeCodebookType === "shift");
  elements.currencyFields?.classList.toggle("active", activeCodebookType === "currency");
  elements.groupField?.classList.toggle("hidden", hideGroupField);
  elements.priceField?.classList.toggle("hidden", hidePriceField);
  elements.valueField?.classList.toggle("hidden", activeCodebookType !== "currency");
  if (elements.priceHeader) {
    elements.priceHeader.hidden = !showPriceColumn;
  }
  if (elements.detailHeader) {
    elements.detailHeader.hidden = hideDetailColumn;
    elements.detailHeader.textContent = activeCodebookType === "procedure"
      ? "Delatnost"
      : activeCodebookType === "shift"
        ? "Radno vreme / dani"
        : activeCodebookType === "currency"
          ? "Kurs"
          : "Detalji";
  }
}

function slugifyCodebookValue(label) {
  return String(label || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "dj")
    .replace(/Đ/g, "Dj")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function clearShiftFields() {
  const elements = codebookFormElements();
  elements.shiftTimeFrom.value = "";
  elements.shiftTimeTo.value = "";
  elements.shiftDays.forEach(day => {
    day.checked = false;
  });
  elements.currencyRate.value = "";
  elements.currencyRateDate.value = "";
}

function setShiftFields(metadata = {}) {
  const elements = codebookFormElements();
  const selectedDays = new Set(Array.isArray(metadata.days) ? metadata.days : []);
  elements.shiftTimeFrom.value = metadata.timeFrom || "";
  elements.shiftTimeTo.value = metadata.timeTo || "";
  elements.shiftDays.forEach(day => {
    day.checked = selectedDays.has(day.value);
  });
  elements.currencyRate.value = metadata.exchangeRate || "";
  elements.currencyRateDate.value = metadata.rateDate || "";
}

function readShiftMetadata() {
  const elements = codebookFormElements();
  return {
    timeFrom: elements.shiftTimeFrom.value || null,
    timeTo: elements.shiftTimeTo.value || null,
    days: elements.shiftDays.filter(day => day.checked).map(day => day.value)
  };
}

function readCurrencyMetadata() {
  const elements = codebookFormElements();
  const pair = currencyRatePair(elements.value.value);
  return {
    exchangeRate: elements.currencyRate.value ? Number(elements.currencyRate.value) : null,
    rateDate: elements.currencyRateDate.value || null,
    rateBase: pair.base,
    rateCurrency: pair.currency,
    rateSource: elements.currencyRate.value ? "manual" : null,
    autoUpdatedAt: null
  };
}

function formatShiftMetadata(item) {
  const metadata = item.metadata || {};
  const time = metadata.timeFrom && metadata.timeTo ? `${metadata.timeFrom}-${metadata.timeTo}` : "-";
  const days = Array.isArray(metadata.days) && metadata.days.length
    ? metadata.days.map(day => WEEKDAY_LABELS[day] || day).join(", ")
    : "-";
  return `${time}; ${days}`;
}

function formatCurrencyMetadata(item) {
  const metadata = item.metadata || {};
  if (!metadata.exchangeRate) return "-";
  const date = metadata.rateDate ? ` (${metadata.rateDate})` : "";
  const source = metadata.rateSource ? `, ${metadata.rateSource}` : "";
  const pair = currencyRatePair(item.value);
  const base = metadata.rateBase || pair.base;
  const currency = metadata.rateCurrency || pair.currency;
  return `1 ${base} = ${metadata.exchangeRate} ${currency}${date}${source}`;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function currencyRatePair(value) {
  const code = String(value || "").trim().toUpperCase();
  if (code === "RSD") {
    return { base: "RSD", currency: "EUR" };
  }
  return { base: code || "EUR", currency: "RSD" };
}

function isCurrencyRateFresh(item) {
  return (item.metadata || {}).autoUpdatedAt === todayIsoDate();
}

async function fetchCurrencyMetadata(currency) {
  const pair = currencyRatePair(currency);
  const rate = await window.DrRosaApi.getExchangeRate(pair.currency, pair.base);
  return {
    exchangeRate: Number(rate.rate),
    rateDate: rate.date || todayIsoDate(),
    rateBase: rate.base || pair.base,
    rateCurrency: rate.currency || pair.currency,
    rateSource: rate.source || "Frankfurter",
    autoUpdatedAt: todayIsoDate()
  };
}

async function refreshCurrencyRatesIfNeeded() {
  const currencyItems = codebookItems.filter(item => item.type === "currency" && item.isActive !== false);
  const staleItems = currencyItems.filter(item => !isCurrencyRateFresh(item));
  if (!staleItems.length) return;

  showCodebookMessage("Osvezavam dnevne kurseve valuta...");
  let refreshed = 0;
  for (const item of staleItems) {
    try {
      const metadata = await fetchCurrencyMetadata(item.value);
      await window.DrRosaApi.updateCodebookItem(item.id, { ...item, metadata });
      item.metadata = metadata;
      refreshed += 1;
    } catch (error) {
      console.error("Currency auto refresh error:", error);
    }
  }
  if (refreshed) {
    codebookItems = await window.DrRosaApi.getAdminCodebooks();
    renderCodebooksAdmin();
    renderCodebookGrid();
    showCodebookMessage(`Dnevni kurs je osvezen za ${refreshed} valuta.`);
  } else {
    showCodebookMessage("Kursevi trenutno nisu mogli da se osveze automatski.", true);
  }
}

async function applyAutomaticCurrencyRate(payload) {
  if (payload.type !== "currency") return payload;
  try {
    return {
      ...payload,
      metadata: await fetchCurrencyMetadata(payload.value)
    };
  } catch (error) {
    showCodebookMessage(error.message || "Kurs nije povucen automatski. Pokusajte ponovo kasnije.", true);
    throw error;
  }
}

function showCodebookMessage(message, isError = false) {
  const elements = codebookFormElements();
  if (!elements.message) return;
  elements.message.textContent = message || "";
  elements.message.classList.toggle("error", Boolean(isError));
}

function resetCodebookForm() {
  const elements = codebookFormElements();
  elements.id.value = "";
  elements.type.value = activeCodebookType;
  elements.value.value = "";
  elements.value.disabled = false;
  elements.label.value = "";
  elements.group.value = "";
  elements.price.value = "0";
  elements.sort.value = "0";
  elements.active.checked = true;
  clearShiftFields();
  updateShiftFieldsVisibility();
  showCodebookMessage("");
}

function fillCodebookForm(item) {
  const elements = codebookFormElements();
  activeCodebookType = item.type;
  elements.id.value = item.id;
  elements.type.value = item.type;
  elements.value.value = item.value;
  elements.value.disabled = true;
  elements.label.value = item.label;
  elements.group.value = item.groupName || "";
  elements.price.value = item.price || 0;
  elements.sort.value = item.sortOrder || 0;
  elements.active.checked = item.isActive !== false;
  setShiftFields(item.metadata);
  updateShiftFieldsVisibility();
  showCodebookMessage("Izmena postojece sifre.");
}

function readCodebookForm() {
  const elements = codebookFormElements();
  const label = elements.label.value.trim();
  const existingValue = elements.value.value.trim();
  return {
    type: elements.type.value,
    value: elements.id.value
      ? existingValue
      : activeCodebookType === "currency"
        ? existingValue.toUpperCase()
        : slugifyCodebookValue(label),
    label,
    groupName: elements.group.value.trim() || null,
    price: Number(elements.price.value || 0),
    sortOrder: Number(elements.sort.value || 0),
    isActive: elements.active.checked,
    metadata: activeCodebookType === "shift"
      ? readShiftMetadata()
      : activeCodebookType === "currency"
        ? readCurrencyMetadata()
        : {}
  };
}

function renderCodebookGroups() {
  const elements = codebookFormElements();
  if (!elements.groups) return;
  const values = codebookItems
    .filter(item => item.type === "activity" && item.isActive !== false)
    .map(item => item.value);
  elements.groups.innerHTML = values.map(value => `<option value="${escapeHtml(value)}"></option>`).join("");
}

function renderCodebooksAdmin() {
  const elements = codebookFormElements();
  if (!elements.table) return;
  const selectedType = activeCodebookType;
  const rows = codebookItems
    .filter(item => item.type === selectedType)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.label.localeCompare(b.label));

  const hideDetailColumn = ["activity", "visit_status", "payment_status"].includes(selectedType);
  const showPriceColumn = selectedType === "procedure";
  const emptyColspan = 4 + (hideDetailColumn ? 0 : 1) + (showPriceColumn ? 1 : 0);
  elements.table.innerHTML = rows.length ? rows.map(item => `
    <tr>
      <td>${escapeHtml(item.value)}</td>
      <td>${escapeHtml(item.label)}</td>
      ${hideDetailColumn ? "" : `<td>${escapeHtml(item.type === "shift" ? formatShiftMetadata(item) : item.type === "currency" ? formatCurrencyMetadata(item) : (item.groupName || "-"))}</td>`}
      ${showPriceColumn ? `<td>${Number(item.price || 0).toFixed(2)}</td>` : ""}
      <td>${item.isActive === false ? "Neaktivno" : "Aktivno"}</td>
      <td>
        <button class="secondary-btn edit-codebook-btn" type="button" data-codebook-id="${item.id}">Uredi</button>
        <button class="danger-btn delete-codebook-btn" type="button" data-codebook-id="${item.id}">Obrisi</button>
      </td>
    </tr>
  `).join("") : `<tr><td colspan="${emptyColspan}" class="empty-row">Nema sifri za odabrani sifarnik.</td></tr>`;

  renderCodebookGroups();
}

async function loadCodebooksAdmin() {
  try {
    codebookItems = await window.DrRosaApi.getAdminCodebooks();
    renderCodebookGrid();
  } catch (error) {
    showCodebookMessage(error.message || "Sifarnici nisu ucitani.", true);
  }
}

function initializeCodebookAdmin() {
  const elements = codebookFormElements();
  if (!elements.form || elements.form.dataset.ready) return;
  elements.form.dataset.ready = "true";

  elements.grid?.addEventListener("click", event => {
    const card = event.target.closest("[data-codebook-type]");
    if (!card) return;
    openCodebookEditor(card.dataset.codebookType);
  });

  elements.reset.addEventListener("click", resetCodebookForm);
  elements.fetchCurrencyRate?.addEventListener("click", async () => {
    const currency = elements.value.value.trim().toUpperCase();
    if (!currency) {
      showCodebookMessage("Unesite sifru valute pre povlacenja kursa.", true);
      return;
    }
    try {
      const metadata = await fetchCurrencyMetadata(currency);
      elements.currencyRate.value = metadata.exchangeRate;
      elements.currencyRateDate.value = metadata.rateDate;
      showCodebookMessage(`Kurs je povucen iz ${metadata.rateSource}.`);
    } catch (error) {
      showCodebookMessage(error.message || "Kurs nije povucen. Unesite ga rucno.", true);
    }
  });

  elements.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    let payload = readCodebookForm();
    if (!payload.value || !payload.label) {
      showCodebookMessage("Unesite sifru i naziv.", true);
      return;
    }

    try {
      payload = await applyAutomaticCurrencyRate(payload);
      if (elements.id.value) {
        await window.DrRosaApi.updateCodebookItem(elements.id.value, payload);
        showCodebookMessage("Sifra je azurirana.");
      } else {
        await window.DrRosaApi.createCodebookItem(payload);
        showCodebookMessage("Sifra je dodata.");
      }
      codebookItems = await window.DrRosaApi.getAdminCodebooks();
      resetCodebookForm();
      renderCodebooksAdmin();
      renderCodebookGrid();
      await procedureCatalog.loadFromApi?.();
    } catch (error) {
      showCodebookMessage(error.message || "Sifra nije sacuvana.", true);
    }
  });

  elements.table.addEventListener("click", async (event) => {
    const editButton = event.target.closest(".edit-codebook-btn");
    const deleteButton = event.target.closest(".delete-codebook-btn");
    if (editButton) {
      const item = codebookItems.find(entry => String(entry.id) === String(editButton.dataset.codebookId));
      if (item) fillCodebookForm(item);
      return;
    }
    if (!deleteButton) return;
    if (!confirm("Da li ste sigurni da zelite da obrisete ovu sifru?")) return;
    try {
      await window.DrRosaApi.deleteCodebookItem(deleteButton.dataset.codebookId);
      codebookItems = await window.DrRosaApi.getAdminCodebooks();
      resetCodebookForm();
      renderCodebooksAdmin();
      renderCodebookGrid();
      showCodebookMessage("Sifra je obrisana.");
    } catch (error) {
      showCodebookMessage(error.message || "Sifra nije obrisana.", true);
    }
  });
}

(async function init() {
  if (!await checkDirectorAccess()) return;
  await procedureCatalog.loadFromApi?.();
  initializeReports();
  initializeReportNavigation();
  initializeExportActions();
  initializeCodebookAdmin();
  try {
    cachedRecords = await window.DrRosaApi.getRecords();
  } catch (error) {
    console.error("Director records load error:", error);
    cachedRecords = [];
  }
})();
