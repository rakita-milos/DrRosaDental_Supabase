let cachedRecords = [];
let currentReportExport = { title: "Direktor izveštaj", headers: [], rows: [] };
let activeExcelSheet = "PAZARI";
let codebookItems = [];
let doctorAdminItems = [];
let currentDailyCashReport = null;
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
  shift: "Smene",
  payment_method: "Načini plaćanja",
  cash_report_item: "Stavke kase"
};
const CODEBOOK_DESCRIPTIONS = {
  activity: "Grupe stomatoloskih usluga koje se koriste za postupke.",
  procedure: "Pojedinacni postupci i cene po delatnostima.",
  visit_status: "Status pregleda ili posete pacijenta.",
  payment_status: "Status naplate za posete i dugovanja.",
  currency: "Valute dostupne pri unosu placanja.",
  shift: "Smene rada ordinacije sa vremenom i danima.",
  payment_method: "Nacini placanja",
  cash_report_item: "Rucne stavke dnevne kase kao kurir, materijal i tehnicar."
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
    window.DrRosaApi.logout().finally(() => {
      window.location.href = "login.html";
    });
  });

  return session;
}

function formatDate(dateString) {
  if (!dateString) return "-";
  return window.DrRosaDateUtils.formatDate(dateString);
}

function isDebt(record) {
  const payment = String(record.paymentStatus || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return ["dugovanje", "delimično"].includes(payment) || Number(record.amountDue || 0) > 0;
}

function addCurrencyAmount(target, currency, amount) {
  const key = currency || "EUR";
  target[key] = (target[key] || 0) + Number(amount || 0);
}

function formatCurrencyAmounts(amounts) {
  const entries = Object.entries(amounts).filter(([, amount]) => amount > 0);
  return entries.length
    ? entries.map(([currency, amount]) => window.DrRosaCurrencyUtils ? window.DrRosaCurrencyUtils.formatMoney(amount, currency) : `${amount.toFixed(2)} ${currency}`).join(" / ")
    : "0.00";
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
  if (reportId === "daily-cash-report") await loadDailyCashReport();
  if (reportId === "public-booking-report") await loadPublicBookingSettings();
  if (reportId === "admin-codebooks-report") await loadCodebooksAdmin();
  if (reportId === "google-calendar-report") await loadGoogleCalendarSettings();
  if (reportId === "backup-security-report") await loadBackupSecurity();
}

window.showReports = showReports;
window.showReport = showReport;

function initializeReports() {
  const reports = [
    { id: "financial-report", tone: "blue", icon: "EUR", title: "Finansijski Izveštaj", description: "Prihodi, naplata i dugovanja" },
    { id: "patients-report", tone: "green", icon: "PAC", title: "Pacijenti", description: "Rast, retencija i statusi pacijenata" },
    { id: "doctors-report", tone: "teal", icon: "DR", title: "Doktori", description: "Produktivnost i opterecenje tima" },
    { id: "procedures-report", tone: "orange", icon: "ORD", title: "Postupci", description: "Usluge, ucestalost i prosečna naplata" },
    { id: "excel-report", tone: "blue", icon: "TAB", title: "Izveštaji po tabovima", description: "PAZARI, hirurgija, protetika, ortodoncija, troškovi i ukupno" },
    { id: "daily-cash-report", tone: "green", icon: "KAS", title: "Dnevna kasa", description: "Fizicki novac, izlazi i ostatak po danu" },
    { id: "public-booking-report", tone: "green", icon: "ONL", title: "Onlajn zakazivanje", description: "Uključi ili isključi javnu formu za termine" },
    { id: "google-calendar-report", tone: "green", icon: "GCal", title: "Google Calendar", description: "Nalog ordinacije, kalendar i status sinhronizacije" },
    { id: "backup-security-report", tone: "orange", icon: "SEC", title: "Rezervne kopije i bezbednost", description: "Rezervna kopija baze, restore, sesije, 2FA i audit log" }
  ];

  reports.push({ id: "admin-codebooks-report", tone: "teal", icon: "ADM", title: "Admin šifarnici", description: "Delatnosti, postupci, statusi, valute i smene" });

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
  const exportableReports = new Set([
    "financial-report",
    "patients-report",
    "doctors-report",
    "procedures-report",
    "excel-report",
    "daily-cash-report"
  ]);

  document.querySelectorAll(".report-content > .section-header").forEach(header => {
    const report = header.closest(".report-content");
    if (!report || !exportableReports.has(report.id)) return;
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
  if (!window.DrRosaApi.getSession?.()) return null;
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
    const price = recordTotal(record);
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

  const paymentRows = Object.entries(patientPayments);
  document.getElementById("payment-table").innerHTML = paymentRows.length ? paymentRows.map(([patient, data]) => {
    const percentage = data.amountTotal > 0 ? ((data.paidTotal / data.amountTotal) * 100).toFixed(0) : 0;
    return `<tr><td>${escapeHtml(patient)}</td><td>${data.visits}</td><td>${formatCurrencyAmounts(data.amount)}</td><td>${formatCurrencyAmounts(data.paid)}</td><td>${formatCurrencyAmounts(data.debt)}</td><td>${percentage}%</td></tr>`;
  }).join("") : `<tr><td colspan="6" class="empty-row">Nema podataka za prikaz.</td></tr>`;

  currentReportExport = {
    title: "Finansijski izveštaj",
    headers: ["Pacijent", "Broj pregleda", "Ukupan iznos", "Plaćeno", "Dugovanje", "Procenat"],
    rows: paymentRows.length ? paymentRows.map(([patient, data]) => {
      const percentage = data.amountTotal > 0 ? ((data.paidTotal / data.amountTotal) * 100).toFixed(0) : 0;
      return [patient, data.visits, formatCurrencyAmounts(data.amount), formatCurrencyAmounts(data.paid), formatCurrencyAmounts(data.debt), `${percentage}%`];
    }) : [["Nema podataka", "-", "-", "-", "-", "-"]]
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

  document.getElementById("patients-table").innerHTML = patients.length ? patients.map(([patient, data]) => `
    <tr><td>${escapeHtml(patient)}</td><td>${data.visits}</td><td>${formatDate(data.lastVisit)}</td><td>${data.debtTotal > 0 ? "Dugovanje" : "Plaćeno"}</td><td>${formatCurrencyAmounts(data.debt)}</td></tr>
  `).join("") : `<tr><td colspan="5" class="empty-row">Nema podataka za prikaz.</td></tr>`;

  currentReportExport = {
    title: "Izveštaj o pacijentima",
    headers: ["Pacijent", "Broj posetaa", "Poslednja poseta", "Status", "Dugovanje"],
    rows: patients.length ? patients.map(([patient, data]) => [
      patient,
      data.visits,
      formatDate(data.lastVisit),
      data.debtTotal > 0 ? "Dugovanje" : "Plaćeno",
      formatCurrencyAmounts(data.debt)
    ]) : [["Nema podataka", "-", "-", "-", "-"]]
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

  document.getElementById("doctors-table").innerHTML = rows.length ? rows.map(row => `
    <tr><td>${escapeHtml(row.doctor)}</td><td>${row.visits}</td><td>${row.patients}</td><td>${Number(row.percentage || 0).toFixed(1)}%</td></tr>
  `).join("") : `<tr><td colspan="4" class="empty-row">Nema podataka za prikaz.</td></tr>`;

  currentReportExport = {
    title: "Izveštaj o doktorima",
    headers: ["Doktor", "Broj pregleda", "Broj pacijenata", "Procenat ukupnog rada"],
    rows: rows.length ? rows.map(row => [
      row.doctor,
      row.visits,
      row.patients,
      `${Number(row.percentage || 0).toFixed(1)}%`
    ]) : [["Nema podataka", "-", "-", "-"]]
  };
  await loadDoctorAdmin();
}

function doctorAdminElements() {
  return {
    form: document.getElementById("doctor-admin-form"),
    id: document.getElementById("doctor-id"),
    name: document.getElementById("doctor-name"),
    specialization: document.getElementById("doctor-specialization"),
    license: document.getElementById("doctor-license"),
    email: document.getElementById("doctor-email"),
    phone: document.getElementById("doctor-phone"),
    active: document.getElementById("doctor-active"),
    reset: document.getElementById("doctor-reset"),
    message: document.getElementById("doctor-admin-message"),
    table: document.getElementById("doctor-admin-table")
  };
}

function showDoctorAdminMessage(message, isError = false) {
  const elements = doctorAdminElements();
  if (!elements.message) return;
  elements.message.textContent = message || "";
  elements.message.classList.toggle("error", Boolean(isError));
}

function resetDoctorForm() {
  const elements = doctorAdminElements();
  if (!elements.form) return;
  elements.id.value = "";
  elements.name.value = "";
  elements.specialization.value = "";
  elements.license.value = "";
  elements.email.value = "";
  elements.phone.value = "";
  elements.active.checked = true;
  showDoctorAdminMessage("");
}

function fillDoctorForm(doctor) {
  const elements = doctorAdminElements();
  elements.id.value = doctor.id;
  elements.name.value = doctor.name || "";
  elements.specialization.value = doctor.specialization || "";
  elements.license.value = doctor.licenseNumber || doctor.license_number || "";
  elements.email.value = doctor.email || "";
  elements.phone.value = doctor.phone || "";
  elements.active.checked = doctor.isActive !== false;
  showDoctorAdminMessage("Izmena postojeceg doktora.");
}

function readDoctorForm() {
  const elements = doctorAdminElements();
  return {
    name: elements.name.value.trim(),
    specialization: elements.specialization.value.trim() || null,
    licenseNumber: elements.license.value.trim() || null,
    email: elements.email.value.trim() || null,
    phone: elements.phone.value.trim() || null,
    isActive: elements.active.checked
  };
}

function renderDoctorAdminTable() {
  const elements = doctorAdminElements();
  if (!elements.table) return;
  const rows = [...doctorAdminItems].sort((a, b) => Number(a.isActive === false) - Number(b.isActive === false) || a.name.localeCompare(b.name));
  elements.table.innerHTML = rows.length ? rows.map(doctor => `
    <tr>
      <td>${escapeHtml(doctor.name)}</td>
      <td>${escapeHtml(doctor.specialization || "-")}</td>
      <td>${escapeHtml(doctor.licenseNumber || "-")}</td>
      <td>${escapeHtml([doctor.email, doctor.phone].filter(Boolean).join(" / ") || "-")}</td>
      <td>${doctor.isActive === false ? "Neaktivno" : "Aktivno"}</td>
      <td>
        <button class="secondary-btn edit-doctor-btn" type="button" data-doctor-id="${doctor.id}">Uredi</button>
        <button class="danger-btn deactivate-doctor-btn" type="button" data-doctor-id="${doctor.id}" ${doctor.isActive === false ? "disabled" : ""}>Deaktiviraj</button>
      </td>
    </tr>
  `).join("") : `<tr><td colspan="6" class="empty-row">Nema doktora za prikaz.</td></tr>`;
}

async function loadDoctorAdmin() {
  if (!window.DrRosaApi?.getDirectorDoctors) return;
  try {
    doctorAdminItems = await window.DrRosaApi.getDirectorDoctors();
    renderDoctorAdminTable();
  } catch (error) {
    showDoctorAdminMessage(error.message || "Doktori nisu ucitani.", true);
  }
}

async function refreshDoctorsAfterAdminChange(message) {
  if (message) showDoctorAdminMessage(message);
  await loadDoctorAdmin();
  await loadDoctorsReport();
}

async function saveDoctorAdmin(event) {
  event.preventDefault();
  const elements = doctorAdminElements();
  const payload = readDoctorForm();
  if (!payload.name) {
    showDoctorAdminMessage("Ime doktora je obavezno.", true);
    elements.name.focus();
    return;
  }
  try {
    if (elements.id.value) {
      await window.DrRosaApi.updateDoctor(elements.id.value, payload);
      resetDoctorForm();
      await refreshDoctorsAfterAdminChange("Doktor je sacuvan.");
    } else {
      await window.DrRosaApi.createDoctor(payload);
      resetDoctorForm();
      await refreshDoctorsAfterAdminChange("Doktor je dodat.");
    }
  } catch (error) {
    showDoctorAdminMessage(error.message || "Doktor nije sacuvan.", true);
  }
}

function initializeDoctorAdmin() {
  const elements = doctorAdminElements();
  if (!elements.form || elements.form.dataset.ready) return;
  elements.form.dataset.ready = "true";
  elements.form.addEventListener("submit", saveDoctorAdmin);
  elements.reset?.addEventListener("click", resetDoctorForm);
  elements.table?.addEventListener("click", async event => {
    const editButton = event.target.closest(".edit-doctor-btn");
    const deactivateButton = event.target.closest(".deactivate-doctor-btn");
    if (editButton) {
      const doctor = doctorAdminItems.find(item => String(item.id) === String(editButton.dataset.doctorId));
      if (doctor) fillDoctorForm(doctor);
      return;
    }
    if (!deactivateButton) return;
    const doctor = doctorAdminItems.find(item => String(item.id) === String(deactivateButton.dataset.doctorId));
    if (!doctor || !confirm(`Deaktivirati doktora ${doctor.name}?`)) return;
    try {
      const result = await window.DrRosaApi.deactivateDoctor(doctor.id);
      resetDoctorForm();
      await refreshDoctorsAfterAdminChange(result.message || "Doktor je deaktiviran.");
    } catch (error) {
      showDoctorAdminMessage(error.message || "Doktor nije deaktiviran.", true);
    }
  });
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

  document.getElementById("procedures-table").innerHTML = rows.length ? rows.map(row => `
    <tr><td>${escapeHtml(row.procedure)}</td><td>${escapeHtml(row.activity || procedureCatalog.findActivityForProcedure(row.procedure) || "-")}</td><td>${row.count}</td><td>${Number(row.percentage || 0).toFixed(1)}%</td><td>${Number(row.avgCost || 0).toFixed(2)} EUR</td></tr>
  `).join("") : `<tr><td colspan="5" class="empty-row">Nema podataka za prikaz.</td></tr>`;

  currentReportExport = {
    title: "Izveštaj o postupcima",
    headers: ["Postupak", "Delatnost", "Broj izvrsenih", "Procenat", "Prosečna naplata"],
    rows: rows.length ? rows.map(row => [
      row.procedure,
      row.activity || procedureCatalog.findActivityForProcedure(row.procedure) || "-",
      row.count,
      `${Number(row.percentage || 0).toFixed(1)}%`,
      `${Number(row.avgCost || 0).toFixed(2)} EUR`
    ]) : [["Nema podataka", "-", "-", "-", "-"]]
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

function normalizeDiscountType(type) {
  return type === "percent" ? "percent" : "amount";
}

function normalizeDiscountValue(value, type) {
  const amount = Math.max(0, Number(value || 0));
  return normalizeDiscountType(type) === "percent" ? Math.min(100, amount) : amount;
}

function treatmentDiscountAmount(treatment) {
  const price = Number(treatment?.price || 0);
  const type = normalizeDiscountType(treatment?.discountType || treatment?.discount_type);
  const value = normalizeDiscountValue(treatment?.discountValue ?? treatment?.discount_value ?? treatment?.discount ?? 0, type);
  const discount = type === "percent" ? price * value / 100 : value;
  return Math.min(price, Math.max(0, discount));
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
          amount: Math.max(0, Number(treatment.price || 0) - treatmentDiscountAmount(treatment))
        });
      });
    });
  }

  if (entries.length === 0) {
    entries.push({
      tooth: "",
      type: record.procedure,
      activity: procedureCatalog.findActivityForProcedure(record.procedure),
      amount: recordPaymentTotal(record)
    });
  }

  return entries;
}

function recordPaymentTotal(record) {
  return Math.max(0, Number(record.amountPaid || 0) + Number(record.amountDue || 0));
}

function recordTotal(record) {
  const treatmentsTotal = recordTreatmentEntries(record).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return Math.max(0, treatmentsTotal);
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
      <tr><th>Dan</th><th>Stavka</th><th>Količina</th><th>Cena</th></tr>
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
    priceCurrency: document.getElementById("codebook-price-currency"),
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
    paymentMethodFields: document.getElementById("payment-method-fields"),
    paymentMethodRevenue: document.getElementById("payment-method-revenue"),
    paymentMethodCashRegister: document.getElementById("payment-method-cash-register"),
    cashReportItemFields: document.getElementById("cash-report-item-fields"),
    cashReportLineType: document.getElementById("cash-report-line-type"),
    groupField: document.querySelector(".codebook-group-field"),
    priceField: document.querySelector(".codebook-price-field"),
    priceCurrencyField: document.querySelector(".codebook-price-currency-field"),
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
  elements.title.textContent = CODEBOOK_LABELS[type] || "Šifarnik";
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
  const simpleTypes = ["activity", "currency", "visit_status", "payment_status", "shift", "payment_method", "cash_report_item"];
  const hideGroupField = simpleTypes.includes(activeCodebookType);
  const hidePriceField = simpleTypes.includes(activeCodebookType);
  const hideDetailColumn = ["activity", "visit_status", "payment_status"].includes(activeCodebookType);
  const showPriceColumn = activeCodebookType === "procedure";
  elements.shiftFields?.classList.toggle("active", activeCodebookType === "shift");
  elements.currencyFields?.classList.toggle("active", activeCodebookType === "currency");
  elements.paymentMethodFields?.classList.toggle("active", activeCodebookType === "payment_method");
  elements.cashReportItemFields?.classList.toggle("active", activeCodebookType === "cash_report_item");
  elements.groupField?.classList.toggle("hidden", hideGroupField);
  elements.priceField?.classList.toggle("hidden", hidePriceField);
  elements.priceCurrencyField?.classList.toggle("hidden", hidePriceField);
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
          : activeCodebookType === "payment_method"
            ? "Uloga"
            : activeCodebookType === "cash_report_item"
              ? "Tip"
              : "Detalji";
  }
}

function activeCurrencyOptions(selected = "EUR") {
  const currencies = codebookItems
    .filter(item => item.type === "currency" && item.isActive !== false)
    .map(item => item.value)
    .filter(Boolean);
  const values = Array.from(new Set([...currencies, selected || "EUR", "EUR"]));
  return values.map(value => `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(value)}</option>`).join("");
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
  if (elements.paymentMethodRevenue) elements.paymentMethodRevenue.checked = true;
  if (elements.paymentMethodCashRegister) elements.paymentMethodCashRegister.checked = false;
  if (elements.cashReportLineType) elements.cashReportLineType.value = "outflow";
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
  if (elements.paymentMethodRevenue) elements.paymentMethodRevenue.checked = metadata.countsAsRevenue !== false;
  if (elements.paymentMethodCashRegister) elements.paymentMethodCashRegister.checked = metadata.countsInCashRegister === true;
  if (elements.cashReportLineType) elements.cashReportLineType.value = metadata.lineType || "outflow";
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

function formatPaymentMethodMetadata(item) {
  const metadata = item.metadata || {};
  const revenue = metadata.countsAsRevenue === false ? "ne ulazi u pazar" : "ulazi u pazar";
  const cash = metadata.countsInCashRegister === true ? "ulazi u kasu" : "ne ulazi u kasu";
  return `${revenue}; ${cash}`;
}

function formatCashReportItemMetadata(item) {
  const type = (item.metadata || {}).lineType || "outflow";
  if (type === "inflow") return "Ulaz u kasu";
  if (type === "info") return "Informativno";
  return "Izlaz iz kase";
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
    showCodebookMessage(error.message || "Kurs nije povučen automatski. Pokušajte ponovo kasnije.", true);
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
  if (elements.priceCurrency) elements.priceCurrency.innerHTML = activeCurrencyOptions("EUR");
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
  if (elements.priceCurrency) elements.priceCurrency.innerHTML = activeCurrencyOptions(item.priceCurrency || "EUR");
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
    priceCurrency: elements.priceCurrency?.value || "EUR",
    sortOrder: Number(elements.sort.value || 0),
    isActive: elements.active.checked,
    metadata: activeCodebookType === "shift"
      ? readShiftMetadata()
      : activeCodebookType === "currency"
        ? readCurrencyMetadata()
        : activeCodebookType === "payment_method"
          ? readPaymentMethodMetadata()
          : activeCodebookType === "cash_report_item"
            ? readCashReportItemMetadata()
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
      ${hideDetailColumn ? "" : `<td>${escapeHtml(item.type === "shift" ? formatShiftMetadata(item) : item.type === "currency" ? formatCurrencyMetadata(item) : item.type === "payment_method" ? formatPaymentMethodMetadata(item) : item.type === "cash_report_item" ? formatCashReportItemMetadata(item) : (item.groupName || "-"))}</td>`}
      ${showPriceColumn ? `<td>${Number(item.price || 0).toFixed(2)} ${escapeHtml(item.priceCurrency || "EUR")}</td>` : ""}
      <td>${item.isActive === false ? "Neaktivno" : "Aktivno"}</td>
      <td>
        <button class="secondary-btn edit-codebook-btn" type="button" data-codebook-id="${item.id}">Uredi</button>
        <button class="danger-btn delete-codebook-btn" type="button" data-codebook-id="${item.id}">Obriši</button>
      </td>
    </tr>
  `).join("") : `<tr><td colspan="${emptyColspan}" class="empty-row">Nema šifri za odabrani šifarnik.</td></tr>`;

  renderCodebookGroups();
}

async function loadCodebooksAdmin() {
  try {
    codebookItems = await window.DrRosaApi.getAdminCodebooks();
    window.DrRosaCurrencyUtils?.setCurrencies(codebookItems.filter(item => item.type === "currency"));
    renderCodebookGrid();
  } catch (error) {
    showCodebookMessage(error.message || "Šifarnici nisu učitani.", true);
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
      showCodebookMessage("Unesite šifru valute pre povlacenja kursa.", true);
      return;
    }
    try {
      const metadata = await fetchCurrencyMetadata(currency);
      elements.currencyRate.value = metadata.exchangeRate;
      elements.currencyRateDate.value = metadata.rateDate;
      showCodebookMessage(`Kurs je povučen iz ${metadata.rateSource}.`);
    } catch (error) {
      showCodebookMessage(error.message || "Kurs nije povučen. Unesite ga ručno.", true);
    }
  });

  elements.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    let payload = readCodebookForm();
    if (!payload.value || !payload.label) {
      showCodebookMessage("Unesite šifru i naziv.", true);
      return;
    }

    try {
      payload = await applyAutomaticCurrencyRate(payload);
      if (elements.id.value) {
        await window.DrRosaApi.updateCodebookItem(elements.id.value, payload);
        showCodebookMessage("Šifra je azurirana.");
      } else {
        await window.DrRosaApi.createCodebookItem(payload);
        showCodebookMessage("Šifra je dodata.");
      }
      codebookItems = await window.DrRosaApi.getAdminCodebooks();
      resetCodebookForm();
      renderCodebooksAdmin();
      renderCodebookGrid();
      await procedureCatalog.loadFromApi?.();
    } catch (error) {
      showCodebookMessage(error.message || "Šifra nije sačuvana.", true);
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
    if (!confirm("Da li ste sigurni da želite da obrišete ovu šifru?")) return;
    try {
      await window.DrRosaApi.deleteCodebookItem(deleteButton.dataset.codebookId);
      codebookItems = await window.DrRosaApi.getAdminCodebooks();
      resetCodebookForm();
      renderCodebooksAdmin();
      renderCodebookGrid();
      showCodebookMessage("Šifra je obrisana.");
    } catch (error) {
      showCodebookMessage(error.message || "Šifra nije obrisana.", true);
    }
  });
}

function showGoogleMessage(message, isError = false) {
  const element = document.getElementById("google-calendar-message");
  if (!element) return;
  element.textContent = message || "";
  element.className = `form-alert ${isError ? "alert-error" : "alert-success"}`;
}

function showPublicBookingMessage(text, isError = false) {
  const element = document.getElementById("public-booking-settings-message");
  if (!element) return;
  element.textContent = text || "";
  element.className = `form-alert ${isError ? "alert-error" : "alert-success"}`;
}

function readPaymentMethodMetadata() {
  const elements = codebookFormElements();
  return {
    countsAsRevenue: elements.paymentMethodRevenue?.checked !== false,
    countsInCashRegister: elements.paymentMethodCashRegister?.checked === true,
    cashFlow: "inflow"
  };
}

function readCashReportItemMetadata() {
  const elements = codebookFormElements();
  return {
    lineType: elements.cashReportLineType?.value || "outflow"
  };
}

async function loadPublicBookingSettings() {
  const checkbox = document.getElementById("public-booking-enabled");
  if (!checkbox) return;
  try {
    const settings = await window.DrRosaApi.getPublicBookingSettings();
    checkbox.checked = Boolean(settings.enabled);
    showPublicBookingMessage(settings.enabled ? "Onlajn zakazivanje je uključeno." : "Onlajn zakazivanje je isključeno.");
  } catch (error) {
    showPublicBookingMessage(error.message || "Podešavanja nisu učitana.", true);
  }
}

function initializePublicBookingSettings() {
  const checkbox = document.getElementById("public-booking-enabled");
  if (!checkbox) return;
  checkbox.addEventListener("change", async () => {
    checkbox.disabled = true;
    try {
      const settings = await window.DrRosaApi.updatePublicBookingSettings({ enabled: checkbox.checked });
      checkbox.checked = Boolean(settings.enabled);
      window.DrRosaApi.updatePublicBookingNavigation?.(settings.enabled);
      showPublicBookingMessage(settings.enabled ? "Onlajn zakazivanje je uključeno." : "Onlajn zakazivanje je isključeno.");
    } catch (error) {
      checkbox.checked = !checkbox.checked;
      showPublicBookingMessage(error.message || "Podesavanje nije sačuvano.", true);
    } finally {
      checkbox.disabled = false;
    }
  });
}

function normalizeGoogleAuthCode(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const match = raw.match(/(?:^|[?&])code=([^&#\s]+)/i);
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }

  return raw;
}

function googleOAuthAuthorizeUrl() {
  const clientId = document.getElementById("google-client-id")?.value.trim();
  const redirectUri = document.getElementById("google-redirect-uri")?.value.trim();
  if (!clientId || !redirectUri) return "";

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/calendar.events",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true"
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function renderGoogleSummary(settings) {
  const summary = document.getElementById("google-sync-summary");
  if (!summary) return;
  summary.innerHTML = `
    <div class="sync-pill"><strong>Status</strong><span>${settings.syncEnabled ? "Uključeno" : "Isključeno"}</span></div>
    <div class="sync-pill"><strong>Nalog</strong><span>${escapeHtml(settings.connectedEmail || "Nije povezan")}</span></div>
    <div class="sync-pill"><strong>Kalendar</strong><span>${escapeHtml(settings.calendarName || settings.calendarId || "-")}</span></div>
    <div class="sync-pill"><strong>OAuth</strong><span>${settings.oauthConnected ? "Povezan" : "Nije povezan"}</span></div>
    <div class="sync-pill"><strong>Red</strong><span>${Number(settings.pendingSyncItems || 0)} otvoreno</span></div>
    <div class="sync-pill"><strong>Poslednja sinhronizacija</strong><span>${settings.lastSyncAt ? formatDate(settings.lastSyncAt) : "-"}</span></div>
    <div class="sync-pill"><strong>Google pull</strong><span>${settings.lastGooglePullAt ? formatDate(settings.lastGooglePullAt) : "Nije pokrenut"}</span></div>
  `;
}

async function loadGoogleCalendarSettings() {
  try {
    const settings = await window.DrRosaApi.getGoogleCalendarSettings();
    document.getElementById("google-connected-email").value = settings.connectedEmail || "";
    document.getElementById("google-calendar-id").value = settings.calendarId || "";
    document.getElementById("google-calendar-name").value = settings.calendarName || "";
    document.getElementById("google-client-id").value = settings.clientId || "";
    const secretInput = document.getElementById("google-client-secret");
    secretInput.value = "";
    secretInput.placeholder = settings.clientSecretConfigured ? "Secret je sacuvan. Unesite samo ako ga menjate." : "Google OAuth client secret";
    document.getElementById("google-redirect-uri").value = settings.redirectUri || `${window.location.origin}${window.location.pathname}`;
    document.getElementById("google-sync-enabled").checked = Boolean(settings.syncEnabled);
    document.getElementById("google-sync-direction").value = settings.syncDirection || "app_to_google";
    document.getElementById("google-reminder-minutes").value = String(settings.defaultReminderMinutes || 1440);
    renderGoogleSummary(settings);
  } catch (error) {
    showGoogleMessage(error.message || "Google Calendar podešavanja nisu učitana.", true);
  }
}

function initializeGoogleCalendarSettings() {
  const form = document.getElementById("google-calendar-form");
  if (!form) return;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const directorPassword = requestDirectorPassword();
      if (!directorPassword) return;
      await window.DrRosaApi.updateGoogleCalendarSettings({
        connectedEmail: document.getElementById("google-connected-email").value,
        calendarId: document.getElementById("google-calendar-id").value,
        calendarName: document.getElementById("google-calendar-name").value,
        clientId: document.getElementById("google-client-id").value,
        clientSecret: document.getElementById("google-client-secret").value,
        redirectUri: document.getElementById("google-redirect-uri").value,
        syncEnabled: document.getElementById("google-sync-enabled").checked,
        syncDirection: document.getElementById("google-sync-direction").value,
        defaultReminderMinutes: Number(document.getElementById("google-reminder-minutes").value)
      }, directorPassword);
      showGoogleMessage("Google Calendar podešavanja su sačuvana.");
      await loadGoogleCalendarSettings();
    } catch (error) {
      showGoogleMessage(error.message || "Podešavanja nisu sačuvana.", true);
    }
  });

  document.getElementById("google-test-sync")?.addEventListener("click", async () => {
    try {
      const result = await window.DrRosaApi.testGoogleCalendarSync();
      showGoogleMessage(`Test sinhronizacije je završen. Obrađeno: ${result.processed || 0}.`);
      await loadGoogleCalendarSettings();
    } catch (error) {
      showGoogleMessage(error.message || "Test sinhronizacije nije uspeo.", true);
    }
  });

  document.getElementById("google-pull-changes")?.addEventListener("click", async () => {
    try {
      const result = await window.DrRosaApi.pullGoogleCalendarChanges();
      showGoogleMessage(
        `Preuzimanje iz Google-a je završeno. Pročitano: ${result.fetched || 0}, ažurirano: ${result.updated || 0}, otkazano: ${result.cancelled || 0}, preskočeno: ${Number(result.skippedExternal || 0) + Number(result.skippedMissingLocal || 0) + Number(result.skippedUnsupportedTime || 0) + Number(result.skippedConflicts || 0)}.`
      );
      await loadGoogleCalendarSettings();
    } catch (error) {
      showGoogleMessage(error.message || "Google izmene nisu povučene.", true);
    }
  });

  document.getElementById("google-open-oauth")?.addEventListener("click", () => {
    const authUrl = googleOAuthAuthorizeUrl();
    if (!authUrl) {
      showGoogleMessage("Prvo unesite OAuth Client ID i Redirect URI, pa sacuvajte podesavanja.", true);
      return;
    }
    window.open(authUrl, "_blank", "noopener,noreferrer");
    showGoogleMessage("Google autorizacija je otvorena. Posle odobrenja kopirajte vrednost parametra code iz callback URL-a.");
  });

  document.getElementById("google-connect-oauth")?.addEventListener("click", async () => {
    try {
      const rawCode = document.getElementById("google-oauth-code").value;
      const code = normalizeGoogleAuthCode(rawCode);
      if (!code) {
        showGoogleMessage("Unesite OAuth kod.", true);
        return;
      }
      await window.DrRosaApi.exchangeGoogleCalendarCode(code);
      showGoogleMessage("Google OAuth je povezan. Token je sačuvan.");
      await loadGoogleCalendarSettings();
    } catch (error) {
      showGoogleMessage(error.message || "OAuth povezivanje nije uspelo.", true);
    }
  });
}

function formatDateTime(dateString) {
  if (!dateString) return "-";
  return window.DrRosaDateUtils.formatDateTime(dateString);
}

function formatFileSize(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function showSystemMessage(id, message, isError = false) {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = message || "";
  element.className = `form-alert ${isError ? "alert-error" : "alert-success"}`;
}

function requestDirectorPassword() {
  return window.prompt("Unesite direktor lozinku za potvrdu ove akcije.");
}

async function loadBackupSecurity() {
  await Promise.all([loadBackupsPanel(), loadSecurityPanel()]);
}

async function loadBackupsPanel() {
  try {
    const [status, backups] = await Promise.all([
      window.DrRosaApi.getBackupStatus(),
      window.DrRosaApi.getBackups()
    ]);
    document.getElementById("backup-last-status").textContent = status.lastBackup ? formatDateTime(status.lastBackup.createdAt) : "-";
    document.getElementById("backup-count-status").textContent = String(status.backupCount || backups.length || 0);
    const warning = document.getElementById("backup-warning");
    warning.textContent = status.warningMessage || "";
    warning.style.display = status.warning ? "block" : "none";
    const createButton = document.getElementById("create-backup-btn");
    if (createButton && status.mode === "supabase_postgres") {
      createButton.textContent = "Backup se radi u Supabase";
      createButton.disabled = true;
      createButton.title = status.message || "PostgreSQL backup se upravlja van aplikacije.";
    } else if (createButton) {
      createButton.textContent = "Napravi rezervnu kopiju sada";
      createButton.disabled = false;
      createButton.removeAttribute("title");
    }
    if (status.mode === "supabase_postgres") {
      document.getElementById("backup-table").innerHTML = `<tr><td colspan="5" class="empty-row">${escapeHtml(status.message || "PostgreSQL backup se upravlja van aplikacije.")}</td></tr>`;
      return;
    }
    document.getElementById("backup-table").innerHTML = backups.length ? backups.map(backup => `
      <tr>
        <td>${formatDateTime(backup.createdAt)}</td>
        <td>${escapeHtml(backup.backupType)}</td>
        <td>${formatFileSize(backup.fileSize)}</td>
        <td>${escapeHtml(backup.status)}</td>
        <td class="table-actions">
          <button class="secondary-btn" type="button" data-download-backup="${backup.id}" data-backup-filename="${escapeHtml(backup.filename)}">Preuzmi</button>
          <button class="secondary-btn" type="button" data-test-backup="${backup.id}">Test vraćanja</button>
          <button class="secondary-btn danger-btn" type="button" data-restore-backup="${backup.id}">Vrati</button>
        </td>
      </tr>
    `).join("") : `<tr><td colspan="5" class="empty-row">Nema rezervnih kopija.</td></tr>`;
  } catch (error) {
    showSystemMessage("backup-message", error.message || "Status rezervnih kopija nije učitan.", true);
  }
}

async function loadSecurityPanel() {
  try {
    const status = await window.DrRosaApi.getSecurityStatus();
    document.getElementById("security-session-status").textContent = `${status.accessTokenTtl} / ${status.refreshTokenDays}d`;
    document.getElementById("security-users-table").innerHTML = status.users.map(user => `
      <tr>
        <td>${escapeHtml(user.name)}<br><small>${escapeHtml(user.email)}</small></td>
        <td>${escapeHtml(user.role)}</td>
        <td>${escapeHtml((user.permissions || []).slice(0, 4).join(", ") || "-")}${(user.permissions || []).length > 4 ? `<br><small>+${(user.permissions || []).length - 4}</small>` : ""}</td>
        <td>${user.failedLoginAttempts}${user.lockedUntil ? `<br><small>Zaključan do ${formatDateTime(user.lockedUntil)}</small>` : ""}</td>
        <td>${user.twoFactorEnabled ? "Uključen" : "Isključen"}</td>
        <td class="table-actions">
          <button class="secondary-btn" type="button" data-unlock-user="${user.id}">Otključaj</button>
          <button class="secondary-btn" type="button" data-reset-user-password="${user.id}">Reset lozinke</button>
          <button class="secondary-btn" type="button" data-edit-user-permissions="${user.id}" data-permissions="${escapeHtml((user.permissions || []).join(","))}">Dozvole</button>
        </td>
      </tr>
    `).join("");
    document.getElementById("security-sessions-table").innerHTML = status.sessions?.length ? status.sessions.map(session => `
      <tr>
        <td>${escapeHtml(session.name || session.email || "-")}<br><small>${escapeHtml(session.userAgent || "-")}</small></td>
        <td>${escapeHtml(session.ipAddress || "-")}</td>
        <td>${formatDateTime(session.expiresAt)}</td>
        <td><button class="danger-btn" type="button" data-revoke-session="${session.id}">Opozovi</button></td>
      </tr>
    `).join("") : `<tr><td colspan="4" class="empty-row">Nema aktivnih sesija.</td></tr>`;
    document.getElementById("restore-test-table").innerHTML = status.restoreTests?.length ? status.restoreTests.map(test => `
      <tr>
        <td>${formatDateTime(test.checkedAt)}</td>
        <td>${escapeHtml(test.backupId || "-")}</td>
        <td>${escapeHtml(test.status)}</td>
        <td>${escapeHtml(test.message || "-")}</td>
      </tr>
    `).join("") : `<tr><td colspan="4" class="empty-row">Nema provera vraćanja rezervne kopije.</td></tr>`;
    document.getElementById("audit-log-table").innerHTML = status.auditLog.length ? status.auditLog.map(item => `
      <tr>
        <td>${formatDateTime(item.createdAt)}</td>
        <td>${escapeHtml(item.email || "-")}</td>
        <td>${escapeHtml(item.action)}</td>
        <td>${escapeHtml([item.entityType, item.entityId].filter(Boolean).join(" #") || "-")}</td>
        <td>${escapeHtml(item.ipAddress || "-")}</td>
      </tr>
    `).join("") : `<tr><td colspan="5" class="empty-row">Nema audit aktivnosti.</td></tr>`;
  } catch (error) {
    showSystemMessage("security-message", error.message || "Sigurnosni status nije učitan.", true);
  }
}

function initializeBackupSecurity() {
  document.getElementById("create-backup-btn")?.addEventListener("click", async event => {
    event.currentTarget.disabled = true;
    try {
      await window.DrRosaApi.createBackup();
      showSystemMessage("backup-message", "Rezervna kopija je napravljena.");
      await loadBackupsPanel();
    } catch (error) {
      showSystemMessage("backup-message", error.message || "Rezervna kopija nije napravljena.", true);
    } finally {
      event.currentTarget.disabled = false;
    }
  });

  document.getElementById("backup-table")?.addEventListener("click", async event => {
    const button = event.target.closest("[data-restore-backup]");
    const download = event.target.closest("[data-download-backup]");
    const test = event.target.closest("[data-test-backup]");
    if (download) {
      try {
        await downloadBackup(download.dataset.downloadBackup, download.dataset.backupFilename);
      } catch (error) {
        showSystemMessage("backup-message", error.message || "Rezervna kopija nije preuzeta.", true);
      }
      return;
    }
    if (test) {
      try {
        await window.DrRosaApi.testRestoreBackup(test.dataset.testBackup);
        showSystemMessage("backup-message", "Test vraćanja je završen.");
        await loadSecurityPanel();
      } catch (error) {
        showSystemMessage("backup-message", error.message || "Test vraćanja nije uspeo.", true);
      }
      return;
    }
    if (!button) return;
    const confirmation = window.prompt("Za vraćanje unesite tačno: VRATI BACKUP");
    if (confirmation !== "VRATI BACKUP") return;
    try {
      await window.DrRosaApi.restoreBackup(button.dataset.restoreBackup, confirmation);
      showSystemMessage("backup-message", "Rezervna kopija je vraćena. Osvežite aplikaciju pre nastavka rada.");
      await loadBackupsPanel();
    } catch (error) {
      showSystemMessage("backup-message", error.message || "Vraćanje nije uspelo.", true);
    }
  });

  document.getElementById("security-users-table")?.addEventListener("click", async event => {
    const unlock = event.target.closest("[data-unlock-user]");
    const reset = event.target.closest("[data-reset-user-password]");
    const permissions = event.target.closest("[data-edit-user-permissions]");
    try {
      if (unlock) {
        await window.DrRosaApi.unlockUser(unlock.dataset.unlockUser);
        showSystemMessage("security-message", "Nalog je otključan.");
      }
      if (reset) {
        const newPassword = window.prompt("Unesite novu lozinku, najmanje 12 karaktera.");
        if (!newPassword) return;
        const directorPassword = requestDirectorPassword();
        if (!directorPassword) return;
        await window.DrRosaApi.resetUserPassword(reset.dataset.resetUserPassword, newPassword, directorPassword);
        showSystemMessage("security-message", "Lozinka je resetovana.");
      }
      if (permissions) {
        const current = permissions.dataset.permissions || "";
        const raw = window.prompt("Dozvole odvojene zarezom (* za sve):", current);
        if (raw === null) return;
        const directorPassword = requestDirectorPassword();
        if (!directorPassword) return;
        await window.DrRosaApi.updateUserPermissions(
          permissions.dataset.editUserPermissions,
          raw.split(",").map(item => item.trim()).filter(Boolean),
          directorPassword
        );
        showSystemMessage("security-message", "Dozvole su sačuvane.");
      }
      await loadSecurityPanel();
    } catch (error) {
      showSystemMessage("security-message", error.message || "Akcija nije uspela.", true);
    }
  });

  document.getElementById("security-sessions-table")?.addEventListener("click", async event => {
    const revoke = event.target.closest("[data-revoke-session]");
    if (!revoke) return;
    try {
      await window.DrRosaApi.revokeSecuritySession(revoke.dataset.revokeSession);
      showSystemMessage("security-message", "Sesija je opozvana.");
      await loadSecurityPanel();
    } catch (error) {
      showSystemMessage("security-message", error.message || "Sesija nije opozvana.", true);
    }
  });

  document.getElementById("legal-export-btn")?.addEventListener("click", async () => {
    try {
      const directorPassword = requestDirectorPassword();
      if (!directorPassword) return;
      const payload = await window.DrRosaApi.getLegalExport(directorPassword);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `drrosa-legal-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showSystemMessage("security-message", "Pravno export je napravljen.");
    } catch (error) {
      showSystemMessage("security-message", error.message || "Pravno export nije napravljen.", true);
    }
  });

  document.getElementById("change-password-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      await window.DrRosaApi.changePassword(
        document.getElementById("current-password").value,
        document.getElementById("new-password").value
      );
      event.currentTarget.reset();
      showSystemMessage("security-message", "Lozinka je promenjena. Prijavite se ponovo na drugim uređajima.");
    } catch (error) {
      showSystemMessage("security-message", error.message || "Lozinka nije promenjena.", true);
    }
  });

  document.getElementById("setup-2fa-btn")?.addEventListener("click", async () => {
    try {
      const setup = await window.DrRosaApi.setupTwoFactor();
      document.getElementById("two-factor-setup").hidden = false;
      document.getElementById("two-factor-secret").textContent = `Secret: ${setup.secret}`;
      showSystemMessage("security-message", "Unesite secret u autentifikator aplikaciju, pa potvrdite kod.");
    } catch (error) {
      showSystemMessage("security-message", error.message || "2FA setup nije uspeo.", true);
    }
  });

  document.getElementById("verify-2fa-btn")?.addEventListener("click", async () => {
    try {
      await window.DrRosaApi.verifyTwoFactor(document.getElementById("two-factor-verify-code").value);
      showSystemMessage("security-message", "2FA je uključen za direktora.");
      await loadSecurityPanel();
    } catch (error) {
      showSystemMessage("security-message", error.message || "2FA kod nije ispravan.", true);
    }
  });

  document.getElementById("disable-2fa-btn")?.addEventListener("click", async () => {
    const password = window.prompt("Unesite direktor lozinku za isključivanje 2FA.");
    if (!password) return;
    try {
      await window.DrRosaApi.disableTwoFactor(password);
      showSystemMessage("security-message", "2FA je isključen.");
      await loadSecurityPanel();
    } catch (error) {
      showSystemMessage("security-message", error.message || "2FA nije isključen.", true);
    }
  });
}

async function downloadBackup(backupId, filename) {
  const response = await fetch(`/api/director/backups/${backupId}/download`, {
    credentials: "include"
  });
  if (!response.ok) throw new Error("Rezervna kopija nije preuzeta.");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "drrosa-backup.pg-managed";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function dailyCashElements() {
  return {
    date: document.getElementById("daily-cash-date"),
    shift: document.getElementById("daily-cash-shift"),
    load: document.getElementById("daily-cash-load"),
    save: document.getElementById("daily-cash-save"),
    toggleManual: document.getElementById("daily-cash-toggle-manual"),
    manualPanel: document.getElementById("daily-cash-manual-panel"),
    message: document.getElementById("daily-cash-message"),
    cashIn: document.getElementById("daily-cash-in"),
    cashOut: document.getElementById("daily-cash-out"),
    remaining: document.getElementById("daily-cash-remaining"),
    autoTable: document.getElementById("daily-cash-auto-table"),
    linesTable: document.getElementById("daily-cash-lines-table"),
    debtsTable: document.getElementById("daily-cash-debts-table")
  };
}

function setDailyCashManualVisible(visible) {
  const { toggleManual, manualPanel } = dailyCashElements();
  if (!toggleManual || !manualPanel) return;
  manualPanel.hidden = !visible;
  toggleManual.setAttribute("aria-expanded", visible ? "true" : "false");
  toggleManual.textContent = visible ? "Sakrij ručne stavke" : "Prikaži ručne stavke";
  localStorage.setItem("drrosa-daily-cash-manual-visible", visible ? "1" : "0");
}

function showDailyCashMessage(message, isError = false) {
  const { message: element } = dailyCashElements();
  if (!element) return;
  element.textContent = message || "";
  element.classList.toggle("error", Boolean(isError));
}

function amountFor(amounts, currency) {
  return Number((amounts || {})[currency] || 0);
}

function remainingDailyAmount(total, subtract, currency) {
  return Math.max(0, amountFor(total, currency) - amountFor(subtract, currency));
}

function formatDailyAmount(amount, currency) {
  return window.DrRosaCurrencyUtils
    ? window.DrRosaCurrencyUtils.formatMoney(amount, currency)
    : `${Number(amount || 0).toFixed(2)} ${currency}`;
}

function formatDailyPair(amounts) {
  return `${formatDailyAmount(amountFor(amounts, "EUR"), "EUR")} / ${formatDailyAmount(amountFor(amounts, "RSD"), "RSD")}`;
}

async function populateDailyCashShiftOptions() {
  const { shift } = dailyCashElements();
  if (!shift || shift.dataset.ready) return;
  shift.dataset.ready = "true";
  try {
    const shifts = await window.DrRosaApi.getCodebooks("shift");
    shift.innerHTML = `<option value="">Sve smene</option>${shifts.map(item => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join("")}`;
  } catch (error) {
    console.error("Daily cash shift load error:", error);
  }
}

function renderDailyCashReport(report) {
  currentDailyCashReport = report;
  const elements = dailyCashElements();
  if (!report || !elements.autoTable) return;

  if (elements.cashIn) elements.cashIn.textContent = formatDailyPair(report.totals.cashIn);
  if (elements.cashOut) elements.cashOut.textContent = formatDailyPair(report.totals.manualOutflow);
  if (elements.remaining) elements.remaining.textContent = formatDailyPair(report.totals.remaining);

  const manualOutflowRows = report.manualLines
    .filter(line => line.lineType === "outflow")
    .map(line => `
      <tr class="daily-cash-outflow-row">
        <td>${escapeHtml(line.itemLabel)}</td>
        <td>${formatDailyAmount(amountFor(line.amounts, "EUR"), "EUR")}</td>
        <td>${formatDailyAmount(amountFor(line.amounts, "RSD"), "RSD")}</td>
        <td>Oduzima se od kase</td>
      </tr>
    `).join("");

  elements.autoTable.innerHTML = `
    <tr class="daily-cash-primary-row">
      <td>Pazar</td>
      <td>${formatDailyAmount(amountFor(report.totals.totalRevenue, "EUR"), "EUR")}</td>
      <td>${formatDailyAmount(amountFor(report.totals.totalRevenue, "RSD"), "RSD")}</td>
      <td>Ukupno kucano i kes iz novog unosa</td>
    </tr>
    <tr>
      <td>Kucano</td>
      <td>${formatDailyAmount(remainingDailyAmount(report.totals.totalRevenue, report.totals.cashIn, "EUR"), "EUR")}</td>
      <td>${formatDailyAmount(remainingDailyAmount(report.totals.totalRevenue, report.totals.cashIn, "RSD"), "RSD")}</td>
      <td>Kartice i ostale bezgotovinske uplate</td>
    </tr>
    <tr>
      <td>Kes</td>
      <td>${formatDailyAmount(amountFor(report.totals.cashIn, "EUR"), "EUR")}</td>
      <td>${formatDailyAmount(amountFor(report.totals.cashIn, "RSD"), "RSD")}</td>
      <td>Fizicka gotovina u kasi</td>
    </tr>
    ${manualOutflowRows}
    <tr>
      <td>Ukupno izlazi</td>
      <td>${formatDailyAmount(amountFor(report.totals.manualOutflow, "EUR"), "EUR")}</td>
      <td>${formatDailyAmount(amountFor(report.totals.manualOutflow, "RSD"), "RSD")}</td>
      <td>Zbir ručnih stavki iznad</td>
    </tr>
    <tr class="daily-cash-total-row">
      <td>Ostatak</td>
      <td>${formatDailyAmount(amountFor(report.totals.remaining, "EUR"), "EUR")}</td>
      <td>${formatDailyAmount(amountFor(report.totals.remaining, "RSD"), "RSD")}</td>
      <td>Kes minus izlazi</td>
    </tr>
  `;

  elements.linesTable.innerHTML = report.manualLines.length ? report.manualLines.map(line => `
    <tr data-item-value="${escapeHtml(line.itemValue)}">
      <td>${escapeHtml(line.itemLabel)}</td>
      <td><input class="daily-cash-line-amount" data-currency="EUR" type="number" min="0" step="0.01" value="${amountFor(line.amounts, "EUR") || ""}" /></td>
      <td><input class="daily-cash-line-amount" data-currency="RSD" type="number" min="0" step="0.01" value="${amountFor(line.amounts, "RSD") || ""}" /></td>
    </tr>
  `).join("") : `<tr><td colspan="3" class="empty-row">Nema stavki kase. Dodajte Kurir, Materijal ili Tehnicar u šifarniku Stavke kase.</td></tr>`;

  elements.debtsTable.innerHTML = report.debts.length ? report.debts.map(debt => `
    <tr>
      <td>${escapeHtml(debt.patient)}</td>
      <td>${escapeHtml(debt.procedure || "-")}</td>
      <td>${debt.currency === "EUR" ? formatDailyAmount(debt.amount, "EUR") : "-"}</td>
      <td>${debt.currency === "RSD" ? formatDailyAmount(debt.amount, "RSD") : "-"}</td>
    </tr>
  `).join("") : `<tr><td colspan="4" class="empty-row">Nema dugovanja za izabrani dan.</td></tr>`;

  const exportRows = [
    ["Pazar", amountFor(report.totals.totalRevenue, "EUR").toFixed(2), amountFor(report.totals.totalRevenue, "RSD").toFixed(2), "Ukupno kucano i kes iz novog unosa"],
    ["Kucano", remainingDailyAmount(report.totals.totalRevenue, report.totals.cashIn, "EUR").toFixed(2), remainingDailyAmount(report.totals.totalRevenue, report.totals.cashIn, "RSD").toFixed(2), "Kartice i ostale bezgotovinske uplate"],
    ["Kes", amountFor(report.totals.cashIn, "EUR").toFixed(2), amountFor(report.totals.cashIn, "RSD").toFixed(2), "Fizicka gotovina u kasi"],
    ...report.manualLines
      .filter(line => line.lineType === "outflow")
      .map(line => [line.itemLabel, amountFor(line.amounts, "EUR").toFixed(2), amountFor(line.amounts, "RSD").toFixed(2), "Oduzima se od kase"]),
    ["Ukupno izlazi", amountFor(report.totals.manualOutflow, "EUR").toFixed(2), amountFor(report.totals.manualOutflow, "RSD").toFixed(2), "Zbir ručnih stavki"],
    ["Ostatak", amountFor(report.totals.remaining, "EUR").toFixed(2), amountFor(report.totals.remaining, "RSD").toFixed(2), "Kes minus izlazi"],
    ["", "", "", ""],
    ["DUŽNICI", "", "", ""],
    ["Pacijent", "Procedura", "EUR", "RSD"],
    ...(report.debts.length
      ? report.debts.map(debt => [
        debt.patient,
        debt.procedure || "-",
        debt.currency === "EUR" ? Number(debt.amount || 0).toFixed(2) : "-",
        debt.currency === "RSD" ? Number(debt.amount || 0).toFixed(2) : "-"
      ])
      : [["Nema dugovanja za izabrani dan.", "", "", ""]])
  ];

  currentReportExport = {
    title: `Dnevna kasa ${report.reportDate}${report.shift ? ` - ${report.shift}` : ""}`,
    headers: ["Stavka", "EUR", "RSD", "Napomena"],
    rows: exportRows
  };
}

async function loadDailyCashReport() {
  const elements = dailyCashElements();
  if (!elements.date) return;
  await populateDailyCashShiftOptions();
  if (!elements.date.value) elements.date.value = todayIsoDate();
  showDailyCashMessage("Učitavam dnevnu kasu...");
  try {
    const report = await window.DrRosaApi.getDailyCashReport({
      date: elements.date.value,
      shift: elements.shift.value
    });
    renderDailyCashReport(report);
    showDailyCashMessage("");
  } catch (error) {
    showDailyCashMessage(error.message || "Dnevna kasa nije učitana.", true);
  }
}

async function saveDailyCashReport() {
  const elements = dailyCashElements();
  if (!currentDailyCashReport) return loadDailyCashReport();
  const lines = Array.from(elements.linesTable.querySelectorAll("tr[data-item-value]")).map(row => {
    const amounts = {};
    row.querySelectorAll(".daily-cash-line-amount").forEach(input => {
      amounts[input.dataset.currency] = Number(input.value || 0);
    });
    return {
      itemValue: row.dataset.itemValue,
      amounts
    };
  });

  showDailyCashMessage("Cuvam rucne stavke...");
  try {
    const report = await window.DrRosaApi.saveDailyCashReport({
      date: elements.date.value,
      shift: elements.shift.value,
      lines
    });
    renderDailyCashReport(report);
    showDailyCashMessage("Dnevna kasa je sačuvana.");
  } catch (error) {
    showDailyCashMessage(error.message || "Dnevna kasa nije sačuvana.", true);
  }
}

function initializeDailyCashReport() {
  const elements = dailyCashElements();
  if (!elements.load || elements.load.dataset.ready) return;
  elements.load.dataset.ready = "true";
  if (elements.date && !elements.date.value) elements.date.value = todayIsoDate();
  setDailyCashManualVisible(localStorage.getItem("drrosa-daily-cash-manual-visible") === "1");
  elements.load.addEventListener("click", loadDailyCashReport);
  elements.save?.addEventListener("click", saveDailyCashReport);
  elements.toggleManual?.addEventListener("click", () => {
    setDailyCashManualVisible(elements.manualPanel?.hidden !== false);
  });
}

(async function init() {
  if (!await checkDirectorAccess()) return;
  await procedureCatalog.loadFromApi?.();
  initializeReports();
  initializeReportNavigation();
  initializeExportActions();
  initializeDoctorAdmin();
  initializeCodebookAdmin();
  initializeDailyCashReport();
  initializePublicBookingSettings();
  initializeGoogleCalendarSettings();
  initializeBackupSecurity();
  try {
    cachedRecords = await window.DrRosaApi.getRecords();
  } catch (error) {
    console.error("Director records load error:", error);
    cachedRecords = [];
  }
})();
