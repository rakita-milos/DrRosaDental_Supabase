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

const patientName = getQueryParam("patient");
const title = document.getElementById("patient-name-title");
const summaryCards = document.getElementById("patient-summary-cards");
const patientInfoSection = document.getElementById("patient-info-section");
const patientInfo = document.getElementById("patient-info");
const recordsBody = document.getElementById("patient-records-body");
const treatmentList = document.getElementById("treatment-list");

function renderEmpty(message) {
  recordsBody.innerHTML = `<tr><td colspan="7" class="empty-row">${message}</td></tr>`;
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
  const totalDue = patientRecords.reduce((sum, record) => sum + Number(record.amountDue || 0), 0);
  const dueRecords = patientRecords.filter(isDebt);
  const lastVisit = patientRecords.map(record => record.lastVisit).filter(Boolean).sort().pop();

  summaryCards.innerHTML = `
    <div class="hero-stats-card"><p class="eyebrow">Ukupno poseta</p><span>${totalVisits}</span></div>
    <div class="hero-stats-card"><p class="eyebrow">Zadnja poseta</p><span>${formatDate(lastVisit)}</span></div>
    <div class="hero-stats-card"><p class="eyebrow">Dugovanja</p><span>${dueRecords.length}</span></div>
    <div class="hero-stats-card"><p class="eyebrow">Iznos duga</p><span>${totalDue.toFixed(2)} EUR</span></div>
  `;

  if (patientDetails) {
    patientInfoSection.style.display = "block";
    patientInfo.innerHTML = `
      <p><strong>Ime:</strong> ${patientFullName(patientDetails)}</p>
      <p><strong>Datum rodjenja:</strong> ${formatDate(patientDetails.birthDate || patientDetails.date_of_birth)}</p>
      <p><strong>Pol:</strong> ${patientDetails.gender || "-"}</p>
      <p><strong>Telefon:</strong> ${patientDetails.phone || "-"}</p>
      <p><strong>Email:</strong> ${patientDetails.email || "-"}</p>
      <p><strong>Kontakt u hitnim slucajevima:</strong> ${patientDetails.emergencyContact || patientDetails.emergency_contact || "-"}</p>
      <p><strong>Alergije:</strong> ${patientDetails.allergies || "-"}</p>
      <p><strong>Medicinska istorija:</strong> ${patientDetails.medicalHistory || patientDetails.medical_history || "-"}</p>
    `;
  }

  if (patientRecords.length === 0) {
    renderEmpty("Nema zapisa za ovog pacijenta.");
    return;
  }

  recordsBody.innerHTML = patientRecords.map(record => `
    <tr>
      <td>${formatDate(record.lastVisit)}</td>
      <td>${record.procedure}</td>
      <td>${record.doctor}</td>
      <td>${record.status}</td>
      <td>${record.paymentStatus || "-"}</td>
      <td>${Number(record.amountDue || 0).toFixed(2)} EUR</td>
      <td>${record.note || "-"}</td>
    </tr>
  `).join("");

  const treatmentEntries = [];
  patientRecords.forEach((record) => {
    if (record.treatments) {
      Object.entries(record.treatments).forEach(([tooth, treatment]) => {
        treatmentEntries.push({ tooth, ...treatment, date: record.lastVisit, procedure: record.procedure });
      });
    }
  });

  treatmentList.innerHTML = treatmentEntries.length === 0
    ? `<p>Nema unesenih tretmana po zubima.</p>`
    : treatmentEntries.map(item => `
      <div class="treatment-item">
        <div>
          <strong>Zub ${item.tooth}</strong> - ${item.type}
          <span style="color: #5b6c7d;">(${item.status})</span>
          <div style="margin-top: 6px;">${item.note || "-"}</div>
          <div style="margin-top: 6px; font-size: 0.9rem; color: #5b6c7d;">${formatDate(item.date)} | ${item.procedure}</div>
        </div>
      </div>
    `).join("");
})();
