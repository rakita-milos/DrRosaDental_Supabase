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

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function formatDate(rawDate) {
  if (!rawDate) return "-";
  return new Date(rawDate).toLocaleDateString("hr-HR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function patientFullName(patient) {
  return patient.fullName || `${patient.firstName || patient.first_name || ""} ${patient.lastName || patient.last_name || ""}`.trim();
}

function isDebt(record) {
  const payment = String(record.paymentStatus || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return Number(record.amountDue || 0) > 0 && ["dugovanje", "delimicno"].includes(payment);
}

function formatMoney(amount, currency = "EUR") {
  return `${Number(amount || 0).toFixed(2)} ${currency}`;
}

function treatmentListForValue(treatments) {
  if (!treatments) return [];
  return Array.isArray(treatments) ? treatments : [treatments];
}

function recordTreatmentEntries(record) {
  if (!record.treatments) return [];
  return Object.values(record.treatments)
    .flatMap(treatmentListForValue)
    .filter(Boolean);
}

function recordVisitCost(record) {
  const treatments = recordTreatmentEntries(record);
  const treatmentsTotal = treatments.reduce((sum, treatment) => {
    return sum + Math.max(0, Number(treatment.price || 0) - Number(treatment.discount || 0));
  }, 0);
  if (treatmentsTotal > 0) {
    return Math.max(0, treatmentsTotal - Number(record.totalDiscount || 0));
  }
  return Number(record.amountDue || 0);
}

function formatDebtTotals(records) {
  const totals = records.reduce((acc, record) => {
    const currency = record.currency || "EUR";
    acc[currency] = (acc[currency] || 0) + Number(record.amountDue || 0);
    return acc;
  }, {});
  const entries = Object.entries(totals).filter(([, amount]) => amount > 0);
  return entries.length ? entries.map(([currency, amount]) => formatMoney(amount, currency)).join(" / ") : "0.00";
}

const patientName = getQueryParam("patient");
const title = document.getElementById("patient-name-title");
const summaryCards = document.getElementById("patient-summary-cards");
const patientInfoSection = document.getElementById("patient-info-section");
const patientInfo = document.getElementById("patient-info");
const recordsBody = document.getElementById("patient-records-body");
const treatmentList = document.getElementById("treatment-list");
const escapeHtml = window.DrRosaSecurity.escapeHtml;

function renderEmpty(message) {
  recordsBody.innerHTML = `<tr><td colspan="9" class="empty-row">${message}</td></tr>`;
  treatmentList.innerHTML = `<p>Nema unesene historije tretmana.</p>`;
}

(async function init() {
  if (!await requireAccess()) return;

  if (!patientName) {
    title.textContent = "Pacijent nije odabran";
    summaryCards.innerHTML = `<div class="hero-stats-card"><p class="eyebrow">Greska</p><span>Odaberite pacijenta iz evidencije.</span></div>`;
    return;
  }

  title.textContent = patientName;
  document.getElementById("new-entry-for-patient").href = `new-entry.html?patient=${encodeURIComponent(patientName)}`;

  let records = [];
  let patients = [];
  try {
    [records, patients] = await Promise.all([
      window.DrRosaApi.getRecords(),
      window.DrRosaApi.getPatients()
    ]);
  } catch (error) {
    console.error("Patient load error:", error);
  }

  const patientRecords = records.filter(record => record.patient === patientName);
  const patientDetails = patients.find(patient => patientFullName(patient) === patientName);

  const totalVisits = patientRecords.length;
  const dueRecords = patientRecords.filter(isDebt);
  const lastVisit = patientRecords.map(record => record.lastVisit).filter(Boolean).sort().pop();

  summaryCards.innerHTML = `
    <div class="hero-stats-card"><p class="eyebrow">Ukupno poseta</p><span>${totalVisits}</span></div>
    <div class="hero-stats-card"><p class="eyebrow">Zadnja poseta</p><span>${formatDate(lastVisit)}</span></div>
    <div class="hero-stats-card"><p class="eyebrow">Dugovanja</p><span>${dueRecords.length}</span></div>
    <div class="hero-stats-card"><p class="eyebrow">Iznos duga</p><span>${formatDebtTotals(dueRecords)}</span></div>
  `;

  if (patientDetails) {
    patientInfoSection.style.display = "block";
    patientInfo.innerHTML = `
      <p><strong>Ime:</strong> ${escapeHtml(patientFullName(patientDetails))}</p>
      <p><strong>Datum rodjenja:</strong> ${formatDate(patientDetails.birthDate || patientDetails.date_of_birth)}</p>
      <p><strong>Pol:</strong> ${escapeHtml(patientDetails.gender || "-")}</p>
      <p><strong>Telefon:</strong> ${escapeHtml(patientDetails.phone || "-")}</p>
      <p><strong>Email:</strong> ${escapeHtml(patientDetails.email || "-")}</p>
      <p><strong>Kontakt u hitnim slucajevima:</strong> ${escapeHtml(patientDetails.emergencyContact || patientDetails.emergency_contact || "-")}</p>
      <p><strong>Alergije:</strong> ${escapeHtml(patientDetails.allergies || "-")}</p>
      <p><strong>Medicinska istorija:</strong> ${escapeHtml(patientDetails.medicalHistory || patientDetails.medical_history || "-")}</p>
    `;
  }

  if (patientRecords.length === 0) {
    renderEmpty("Nema zapisa za ovog pacijenta.");
    return;
  }

  recordsBody.innerHTML = patientRecords.map(record => `
    <tr>
      <td>${formatDate(record.lastVisit)}</td>
      <td>${escapeHtml(record.procedure)}</td>
      <td>${escapeHtml(record.doctor)}</td>
      <td>${escapeHtml(record.status)}</td>
      <td>${escapeHtml(record.paymentStatus || "-")}</td>
      <td>${escapeHtml(record.shift || "-")}</td>
      <td>${formatMoney(recordVisitCost(record), record.currency)}</td>
      <td>${formatMoney(record.amountDue, record.currency)}</td>
      <td>${escapeHtml(record.note || "-")}${Number(record.totalDiscount || 0) > 0 ? `<div style="margin-top: 6px; color: #b45309;">Popust na ukupno: ${formatMoney(record.totalDiscount, record.currency)}</div>` : ""}</td>
    </tr>
  `).join("");

  const treatmentEntries = [];
  patientRecords.forEach((record) => {
    if (record.treatments) {
      Object.entries(record.treatments).forEach(([tooth, treatments]) => {
        treatmentListForValue(treatments).forEach(treatment => {
          treatmentEntries.push({ tooth, ...treatment, date: record.lastVisit, procedure: record.procedure });
        });
      });
    }
  });

  treatmentList.innerHTML = treatmentEntries.length === 0
    ? `<p>Nema unesenih tretmana po zubima.</p>`
    : treatmentEntries.map(item => `
      <div class="treatment-item">
        <div>
          <strong>Zub ${escapeHtml(item.tooth)}</strong> - ${escapeHtml(item.type)}
          ${Number(item.price || 0) > 0 ? `<div style="margin-top: 6px; font-weight: 700;">${formatMoney(item.price)}</div>` : ""}
          ${Number(item.discount || 0) > 0 ? `<div style="margin-top: 6px; color: #b45309;">Popust: ${formatMoney(item.discount)}</div>` : ""}
          <div style="margin-top: 6px;">${escapeHtml(item.note || "-")}</div>
          <div style="margin-top: 6px; font-size: 0.9rem; color: #5b6c7d;">${formatDate(item.date)} | ${escapeHtml(item.procedure)}</div>
        </div>
      </div>
    `).join("");
})();
