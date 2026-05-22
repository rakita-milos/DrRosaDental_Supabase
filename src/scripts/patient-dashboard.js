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

function recordDetailsUrl(record) {
  const params = new URLSearchParams({ patient: record.patient });
  if (record.id) params.set("record", record.id);
  return `new-entry.html?${params.toString()}`;
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

function groupTreatmentEntries(entries) {
  const groups = new Map();
  entries.forEach(item => {
    const key = `${item.visitId}|${item.type || ""}`;
    if (!groups.has(key)) {
      groups.set(key, {
        date: item.date,
        visitId: item.visitId,
        procedure: item.procedure,
        type: item.type,
        currency: item.currency || "EUR",
        teeth: [],
        notes: [],
        gross: 0,
        discount: 0
      });
    }
    const group = groups.get(key);
    group.teeth.push(item.tooth);
    if (item.note && item.note !== "-") group.notes.push(item.note);
    group.gross += Number(item.price || 0);
    group.discount += Number(item.discount || 0);
  });

  return Array.from(groups.values()).map(group => ({
    ...group,
    teeth: Array.from(new Set(group.teeth)).sort((a, b) => Number(a) - Number(b)),
    notes: Array.from(new Set(group.notes)),
    total: Math.max(0, group.gross - group.discount)
  }));
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
const editPatientLink = document.getElementById("edit-patient-link");
const deletePatientBtn = document.getElementById("delete-patient-btn");
const escapeHtml = window.DrRosaSecurity.escapeHtml;
const clinicalSection = document.getElementById("patient-clinical-section");
const patientAlerts = document.getElementById("patient-alerts");
const medicalForm = document.getElementById("medical-profile-form");
const documentForm = document.getElementById("document-form");
const documentsBody = document.getElementById("patient-documents-body");
let planItemsDraft = [];
let perioMeasurementsDraft = [];
let invoiceItemsDraft = [];

function renderEmpty(message) {
  recordsBody.innerHTML = `<tr><td colspan="10" class="empty-row">${message}</td></tr>`;
  treatmentList.innerHTML = `<p>Nema unesene historije tretmana.</p>`;
}

function setMessage(id, message, isError = false) {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = message || "";
  element.className = `form-alert ${isError ? "alert-error" : "alert-success"}`;
}

function fillMedicalProfile(profile) {
  document.getElementById("medical-blood-type").value = profile.bloodType || "";
  document.getElementById("medical-pregnancy-status").value = profile.pregnancyStatus || "";
  document.getElementById("medical-allergies").value = profile.allergies || "";
  document.getElementById("medical-medications").value = profile.medications || "";
  document.getElementById("medical-chronic-conditions").value = profile.chronicConditions || "";
  document.getElementById("medical-contraindications").value = profile.contraindications || "";
  document.getElementById("medical-previous-surgeries").value = profile.previousSurgeries || "";
  document.getElementById("medical-smoker").checked = Boolean(profile.smoker);
  document.getElementById("medical-diabetes").checked = Boolean(profile.diabetes);
  document.getElementById("medical-high-blood-pressure").checked = Boolean(profile.highBloodPressure);
  document.getElementById("medical-heart-condition").checked = Boolean(profile.heartCondition);
  document.getElementById("medical-anesthesia-warning").value = profile.anesthesiaWarning || "";
  document.getElementById("medical-dental-notes").value = profile.dentalNotes || "";
  document.getElementById("medical-internal-notes").value = profile.internalNotes || "";
  renderMedicalAlerts(profile);
}

function readMedicalProfileForm() {
  return {
    bloodType: document.getElementById("medical-blood-type").value,
    pregnancyStatus: document.getElementById("medical-pregnancy-status").value,
    allergies: document.getElementById("medical-allergies").value,
    medications: document.getElementById("medical-medications").value,
    chronicConditions: document.getElementById("medical-chronic-conditions").value,
    contraindications: document.getElementById("medical-contraindications").value,
    previousSurgeries: document.getElementById("medical-previous-surgeries").value,
    smoker: document.getElementById("medical-smoker").checked,
    diabetes: document.getElementById("medical-diabetes").checked,
    highBloodPressure: document.getElementById("medical-high-blood-pressure").checked,
    heartCondition: document.getElementById("medical-heart-condition").checked,
    anesthesiaWarning: document.getElementById("medical-anesthesia-warning").value,
    dentalNotes: document.getElementById("medical-dental-notes").value,
    internalNotes: document.getElementById("medical-internal-notes").value
  };
}

function renderMedicalAlerts(profile) {
  const alerts = [
    profile.allergies ? `Alergije: ${profile.allergies}` : "",
    profile.contraindications ? `Kontraindikacije: ${profile.contraindications}` : "",
    profile.anesthesiaWarning ? `Anestezija: ${profile.anesthesiaWarning}` : "",
    profile.diabetes ? "Dijabetes" : "",
    profile.heartCondition ? "Srcani problemi" : ""
  ].filter(Boolean);
  patientAlerts.innerHTML = alerts.length
    ? alerts.map(alert => `<div class="patient-alert">${escapeHtml(alert)}</div>`).join("")
    : "";
}

function fillVisitOptions(records) {
  const select = document.getElementById("document-visit");
  select.innerHTML = `<option value="">Bez vezane posete</option>${records.map(record => `
    <option value="${escapeHtml(record.id)}">${formatDate(record.lastVisit)} - ${escapeHtml(record.procedure)}</option>
  `).join("")}`;
}

function formatFileSize(size) {
  const bytes = Number(size || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function documentTypeLabel(type) {
  return {
    rtg: "RTG",
    ortopan: "Ortopan",
    photo: "Fotografija",
    finding: "Nalaz",
    lab: "Laboratorija",
    consent: "Saglasnost",
    invoice: "Racun",
    other: "Ostalo"
  }[type] || type || "-";
}

function renderDocuments(documents) {
  documentsBody.innerHTML = documents.length ? documents.map(document => `
    <tr>
      <td>${escapeHtml(document.title)}</td>
      <td>${escapeHtml(documentTypeLabel(document.documentType))}</td>
      <td>${formatDate(document.documentDate || document.createdAt)}</td>
      <td>${document.source === "scanner" ? "Skener" : "Upload"}</td>
      <td>${escapeHtml([document.imagingModality, document.toothNumber].filter(Boolean).join(" / ") || "-")}</td>
      <td>${formatFileSize(document.fileSize)}</td>
      <td>
        <button class="secondary-btn view-document-btn" type="button" data-document-id="${document.id}">Pogledaj</button>
        <button class="secondary-btn analyze-imaging-btn" type="button" data-document-id="${document.id}">AI pregled</button>
        <button class="secondary-btn download-document-btn" type="button" data-document-id="${document.id}">Preuzmi</button>
        <button class="danger-btn delete-document-btn" type="button" data-document-id="${document.id}">Obrisi</button>
      </td>
    </tr>
  `).join("") : `<tr><td colspan="7" class="empty-row">Nema dokumenata za ovog pacijenta.</td></tr>`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function openDocument(documentId, download = false) {
  const token = localStorage.getItem("drrosa-token");
  const response = await fetch(`/api/documents/${documentId}/${download ? "download" : "view"}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error("Dokument nije dostupan.");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  if (download) link.download = "drrosa-dokument";
  link.target = "_blank";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function loadDocuments(patientId) {
  const documents = await window.DrRosaApi.getPatientDocuments(patientId);
  renderDocuments(documents);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function renderPlanItemsDraft() {
  const preview = document.getElementById("plan-items-preview");
  preview.innerHTML = planItemsDraft.length
    ? planItemsDraft.map((item, index) => `<p><strong>Faza ${item.phase}</strong> ${escapeHtml(item.toothNumber || "-")} - ${escapeHtml(item.procedureName)} (${formatMoney(item.unitPrice)}) <button class="danger-btn remove-plan-item" type="button" data-index="${index}">x</button></p>`).join("")
    : "<p>Nema stavki u planu.</p>";
}

function renderPlans(plans) {
  document.getElementById("treatment-plans-body").innerHTML = plans.length ? plans.map(plan => `
    <tr>
      <td>${escapeHtml(plan.title)}<br><small>${plan.items.length} stavki</small></td>
      <td>${escapeHtml(plan.status)}</td>
      <td>${formatMoney(plan.total, plan.currency)}</td>
      <td>
        <button class="secondary-btn edit-plan-btn" type="button" data-plan-id="${plan.id}">Uredi</button>
        <button class="primary-btn accept-plan-btn" type="button" data-plan-id="${plan.id}">Potpis</button>
      </td>
    </tr>
  `).join("") : `<tr><td colspan="4" class="empty-row">Nema planova terapije.</td></tr>`;
}

function renderPerioDraft() {
  const preview = document.getElementById("perio-measurements-preview");
  preview.innerHTML = perioMeasurementsDraft.length
    ? perioMeasurementsDraft.map((item, index) => `<p>Zub ${escapeHtml(item.toothNumber)} ${escapeHtml(item.site)}: dzep ${item.pocketDepth}mm, recesija ${item.recession}mm, mob ${item.mobility}, fur ${item.furcation}${item.bleeding ? ", krvarenje" : ""} <button class="danger-btn remove-perio-item" type="button" data-index="${index}">x</button></p>`).join("")
    : "<p>Nema dodatih merenja.</p>";
}

function renderPerioCharts(charts) {
  document.getElementById("perio-charts-body").innerHTML = charts.length ? charts.map(chart => {
    const deep = chart.measurements.filter(item => item.pocketDepth >= 5).length;
    const bleeding = chart.measurements.filter(item => item.bleeding).length;
    return `<tr><td>${formatDate(chart.chartDate)}</td><td>${chart.measurements.length}</td><td>${deep} dubokih dzepova / ${bleeding} krvarenja</td></tr>`;
  }).join("") : `<tr><td colspan="3" class="empty-row">Nema perio chartova.</td></tr>`;
}

function renderInvoiceDraft() {
  const preview = document.getElementById("invoice-items-preview");
  preview.innerHTML = invoiceItemsDraft.length
    ? invoiceItemsDraft.map((item, index) => `<p>${escapeHtml(item.description)} - ${formatMoney(item.unitPrice)} <button class="danger-btn remove-invoice-item" type="button" data-index="${index}">x</button></p>`).join("")
    : "<p>Nema stavki racuna.</p>";
}

function renderInvoices(invoices) {
  document.getElementById("invoices-body").innerHTML = invoices.length ? invoices.map(invoice => `
    <tr>
      <td>${escapeHtml(invoice.invoiceNumber)}</td>
      <td>${escapeHtml(invoice.status)}</td>
      <td>${formatMoney(invoice.total, invoice.currency)}</td>
      <td>${formatMoney(invoice.amountPaid, invoice.currency)}</td>
      <td>
        <button class="secondary-btn invoice-payment-btn" type="button" data-invoice-id="${invoice.id}">Uplata</button>
        <button class="secondary-btn invoice-pdf-btn" type="button" data-invoice-id="${invoice.id}">PDF</button>
      </td>
    </tr>
  `).join("") : `<tr><td colspan="5" class="empty-row">Nema racuna.</td></tr>`;
}

function renderLedger(ledger) {
  const summary = document.getElementById("patient-ledger-summary");
  if (!summary) return;
  const entries = ledger.entries || [];
  summary.innerHTML = `<strong>Ledger saldo:</strong> ${formatMoney(ledger.balance || 0)} <span class="muted">(${entries.length} knjiženja)</span>`;
}

function renderInsuranceClaims(claims) {
  document.getElementById("insurance-claims-body").innerHTML = claims.length ? claims.map(claim => `
    <tr>
      <td>${escapeHtml(claim.provider)}<br><small>${escapeHtml(claim.policyNumber || "-")}</small></td>
      <td>${escapeHtml(claim.status)}${claim.eligibilityStatus ? `<br><small>${escapeHtml(claim.eligibilityStatus)}</small>` : ""}</td>
      <td>${formatMoney(claim.requestedAmount)}</td>
      <td>${claim.eob ? `${formatMoney(claim.paidAmount)}<br><small>${escapeHtml(claim.eraStatus || "ERA")}</small>` : escapeHtml(claim.denialReason || claim.eligibilityNotes || "-")}</td>
      <td>
        <button class="secondary-btn claim-eligibility-btn" type="button" data-claim-id="${claim.id}">Eligibility</button>
        <button class="secondary-btn claim-submit-btn" type="button" data-claim-id="${claim.id}">eClaim</button>
        <button class="secondary-btn claim-era-btn" type="button" data-claim-id="${claim.id}" data-amount="${claim.approvedAmount || claim.requestedAmount || 0}">ERA</button>
      </td>
    </tr>
  `).join("") : `<tr><td colspan="5" class="empty-row">Nema insurance claimova.</td></tr>`;
}

function renderClinicalChart(entries) {
  document.getElementById("clinical-chart-body").innerHTML = entries.length ? entries.map(entry => `
    <tr>
      <td>${escapeHtml(entry.toothNumber)}<br><small>${escapeHtml((entry.surfaces || []).join(", ") || "-")}</small></td>
      <td>${escapeHtml([entry.cdtCode, entry.adaCode].filter(Boolean).join(" / ") || "-")}</td>
      <td>${escapeHtml(entry.status)}<br><small>Faza ${escapeHtml(entry.phase)}</small></td>
      <td>${escapeHtml(entry.diagnosis || entry.notes || "-")}</td>
      <td><button class="danger-btn delete-clinical-chart-btn" type="button" data-entry-id="${entry.id}">Obrisi</button></td>
    </tr>
  `).join("") : `<tr><td colspan="5" class="empty-row">Nema dental charting unosa.</td></tr>`;
}

function renderClinicalNoteTemplates(templates) {
  const select = document.getElementById("clinical-note-template");
  select.innerHTML = `<option value="">Prazan note</option>${templates.map(template => `
    <option value="${template.id}" data-title="${escapeHtml(template.title)}" data-body="${escapeHtml(template.body)}">${escapeHtml(template.category)} - ${escapeHtml(template.title)}</option>
  `).join("")}`;
}

function renderClinicalNotes(notes) {
  document.getElementById("clinical-notes-body").innerHTML = notes.length ? notes.map(note => `
    <tr>
      <td>${escapeHtml(note.title)}<br><small>${escapeHtml(String(note.body || "").slice(0, 120))}</small></td>
      <td>${note.signedAt ? `${escapeHtml(note.signedBy || "-")}<br><small>${formatDate(note.signedAt)}</small>` : "Nije potpisano"}</td>
      <td>${formatDate(note.createdAt)}</td>
      <td>${note.signedAt ? "-" : `<button class="primary-btn sign-clinical-note-btn" type="button" data-note-id="${note.id}">Potpis</button>`}</td>
    </tr>
  `).join("") : `<tr><td colspan="4" class="empty-row">Nema clinical notes.</td></tr>`;
}

function renderPatientConsents(consents) {
  document.getElementById("patient-consents-body").innerHTML = consents.length ? consents.map(consent => `
    <tr>
      <td>${escapeHtml(consent.title)}<br><small>${escapeHtml(consent.consentType)}</small></td>
      <td>${escapeHtml(consent.signerName)}<br><small>${escapeHtml(consent.signatureData)}</small></td>
      <td>${formatDate(consent.signedAt)}</td>
    </tr>
  `).join("") : `<tr><td colspan="3" class="empty-row">Nema sacuvanih saglasnosti.</td></tr>`;
}

async function initializeClinicalWorkflows(patientId) {
  async function refreshClinicalChart() {
    renderClinicalChart(await window.DrRosaApi.getClinicalChart(patientId));
  }
  async function refreshClinicalNotes() {
    renderClinicalNotes(await window.DrRosaApi.getClinicalNotes(patientId));
  }
  async function refreshConsents() {
    renderPatientConsents(await window.DrRosaApi.getPatientConsents(patientId));
  }

  const templates = await window.DrRosaApi.getClinicalNoteTemplates();
  renderClinicalNoteTemplates(templates);

  document.getElementById("clinical-note-template").addEventListener("change", event => {
    const selected = event.target.selectedOptions[0];
    if (!selected?.value) return;
    document.getElementById("clinical-note-title").value = selected.dataset.title || "";
    document.getElementById("clinical-note-body").value = selected.dataset.body || "";
  });

  document.getElementById("clinical-chart-form").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      await window.DrRosaApi.createClinicalChartEntry(patientId, {
        toothNumber: document.getElementById("clinical-tooth").value,
        surfaces: document.getElementById("clinical-surfaces").value.split(",").map(item => item.trim()).filter(Boolean),
        cdtCode: document.getElementById("clinical-cdt").value,
        adaCode: document.getElementById("clinical-ada").value,
        status: document.getElementById("clinical-status").value,
        phase: Number(document.getElementById("clinical-phase").value || 1),
        diagnosis: document.getElementById("clinical-diagnosis").value,
        procedureCode: document.getElementById("clinical-procedure-code").value,
        notes: document.getElementById("clinical-notes").value
      });
      event.target.reset();
      document.getElementById("clinical-phase").value = "1";
      setMessage("clinical-chart-message", "Dental charting je sacuvan.");
      await refreshClinicalChart();
    } catch (error) {
      setMessage("clinical-chart-message", error.message || "Charting nije sacuvan.", true);
    }
  });

  document.getElementById("clinical-chart-body").addEventListener("click", async event => {
    const button = event.target.closest(".delete-clinical-chart-btn");
    if (!button) return;
    await window.DrRosaApi.deleteClinicalChartEntry(button.dataset.entryId);
    setMessage("clinical-chart-message", "Charting unos je obrisan.");
    await refreshClinicalChart();
  });

  document.getElementById("clinical-note-form").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      await window.DrRosaApi.createClinicalNote(patientId, {
        templateId: document.getElementById("clinical-note-template").value,
        title: document.getElementById("clinical-note-title").value,
        body: document.getElementById("clinical-note-body").value,
        signedBy: document.getElementById("clinical-note-signed-by").value
      });
      event.target.reset();
      setMessage("clinical-note-message", "Clinical note je sacuvan.");
      await refreshClinicalNotes();
    } catch (error) {
      setMessage("clinical-note-message", error.message || "Clinical note nije sacuvan.", true);
    }
  });

  document.getElementById("clinical-notes-body").addEventListener("click", async event => {
    const button = event.target.closest(".sign-clinical-note-btn");
    if (!button) return;
    const signedBy = window.prompt("Potpisuje:", "Dr Rosa");
    if (!signedBy) return;
    await window.DrRosaApi.signClinicalNote(button.dataset.noteId, { signedBy });
    setMessage("clinical-note-message", "Clinical note je potpisan.");
    await refreshClinicalNotes();
  });

  document.getElementById("patient-consent-form").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      await window.DrRosaApi.createPatientConsent(patientId, {
        consentType: document.getElementById("consent-type").value,
        title: document.getElementById("consent-title").value,
        body: document.getElementById("consent-body").value,
        signerName: document.getElementById("consent-signer").value,
        signatureData: document.getElementById("consent-signature").value
      });
      event.target.reset();
      setMessage("consent-message", "Consent je sacuvan i potpisan.");
      await refreshConsents();
    } catch (error) {
      setMessage("consent-message", error.message || "Consent nije sacuvan.", true);
    }
  });

  await Promise.all([refreshClinicalChart(), refreshClinicalNotes(), refreshConsents()]);
}

async function initializeAdvancedWorkflows(patientId) {
  document.getElementById("perio-date").value = today();
  document.getElementById("invoice-date").value = today();

  async function refreshPlans() {
    renderPlans(await window.DrRosaApi.getTreatmentPlans(patientId));
  }
  async function refreshPerio() {
    renderPerioCharts(await window.DrRosaApi.getPerioCharts(patientId));
  }
  async function refreshInvoices() {
    renderInvoices(await window.DrRosaApi.getInvoices(patientId));
    renderLedger(await window.DrRosaApi.getPatientLedger(patientId));
  }
  async function refreshClaims() {
    renderInsuranceClaims(await window.DrRosaApi.getInsuranceClaims(patientId));
  }

  renderPlanItemsDraft();
  renderPerioDraft();
  renderInvoiceDraft();
  await Promise.all([refreshPlans(), refreshPerio(), refreshInvoices(), refreshClaims()]);

  document.getElementById("add-plan-item-btn").addEventListener("click", () => {
    const procedureName = document.getElementById("plan-item-procedure").value.trim();
    if (!procedureName) return setMessage("treatment-plan-message", "Unesite proceduru.", true);
    planItemsDraft.push({
      phase: Number(document.getElementById("plan-item-phase").value || 1),
      toothNumber: document.getElementById("plan-item-tooth").value,
      procedureName,
      description: document.getElementById("plan-item-description").value,
      quantity: 1,
      unitPrice: Number(document.getElementById("plan-item-price").value || 0),
      discount: 0
    });
    renderPlanItemsDraft();
  });
  document.getElementById("plan-items-preview").addEventListener("click", event => {
    const button = event.target.closest(".remove-plan-item");
    if (!button) return;
    planItemsDraft.splice(Number(button.dataset.index), 1);
    renderPlanItemsDraft();
  });
  document.getElementById("treatment-plan-form").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      await window.DrRosaApi.createTreatmentPlan(patientId, {
        title: document.getElementById("plan-title").value || "Plan terapije",
        status: document.getElementById("plan-status").value,
        currency: "EUR",
        items: planItemsDraft
      });
      planItemsDraft = [];
      event.target.reset();
      renderPlanItemsDraft();
      await refreshPlans();
      setMessage("treatment-plan-message", "Plan terapije je sacuvan.");
    } catch (error) {
      setMessage("treatment-plan-message", error.message || "Plan nije sacuvan.", true);
    }
  });
  document.getElementById("treatment-plans-body").addEventListener("click", async event => {
    const accept = event.target.closest(".accept-plan-btn");
    if (!accept) return;
    const signatureName = prompt("Ime i prezime za potpis plana:");
    if (!signatureName) return;
    await window.DrRosaApi.acceptTreatmentPlan(accept.dataset.planId, { signatureName, signatureData: signatureName });
    await refreshPlans();
  });

  document.getElementById("add-perio-measurement-btn").addEventListener("click", () => {
    const toothNumber = document.getElementById("perio-tooth").value.trim();
    if (!toothNumber) return setMessage("perio-message", "Unesite zub.", true);
    perioMeasurementsDraft.push({
      toothNumber,
      site: document.getElementById("perio-site").value,
      pocketDepth: Number(document.getElementById("perio-pocket").value || 0),
      recession: Number(document.getElementById("perio-recession").value || 0),
      mobility: Number(document.getElementById("perio-mobility").value || 0),
      furcation: Number(document.getElementById("perio-furcation").value || 0),
      bleeding: document.getElementById("perio-bleeding").checked
    });
    renderPerioDraft();
  });
  document.getElementById("perio-measurements-preview").addEventListener("click", event => {
    const button = event.target.closest(".remove-perio-item");
    if (!button) return;
    perioMeasurementsDraft.splice(Number(button.dataset.index), 1);
    renderPerioDraft();
  });
  document.getElementById("perio-form").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      await window.DrRosaApi.createPerioChart(patientId, {
        chartDate: document.getElementById("perio-date").value || today(),
        measurements: perioMeasurementsDraft
      });
      perioMeasurementsDraft = [];
      renderPerioDraft();
      await refreshPerio();
      setMessage("perio-message", "Perio chart je sacuvan.");
    } catch (error) {
      setMessage("perio-message", error.message || "Perio chart nije sacuvan.", true);
    }
  });

  document.getElementById("add-invoice-item-btn").addEventListener("click", () => {
    const description = document.getElementById("invoice-item-description").value.trim();
    if (!description) return setMessage("invoice-message", "Unesite stavku.", true);
    invoiceItemsDraft.push({ description, quantity: 1, unitPrice: Number(document.getElementById("invoice-item-price").value || 0), discount: 0 });
    renderInvoiceDraft();
  });
  document.getElementById("invoice-items-preview").addEventListener("click", event => {
    const button = event.target.closest(".remove-invoice-item");
    if (!button) return;
    invoiceItemsDraft.splice(Number(button.dataset.index), 1);
    renderInvoiceDraft();
  });
  document.getElementById("invoice-form").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      await window.DrRosaApi.createInvoice(patientId, {
        issueDate: document.getElementById("invoice-date").value || today(),
        dueDate: document.getElementById("invoice-due-date").value,
        currency: "EUR",
        items: invoiceItemsDraft
      });
      invoiceItemsDraft = [];
      event.target.reset();
      document.getElementById("invoice-date").value = today();
      renderInvoiceDraft();
      await refreshInvoices();
      setMessage("invoice-message", "Racun je kreiran.");
    } catch (error) {
      setMessage("invoice-message", error.message || "Racun nije kreiran.", true);
    }
  });
  document.getElementById("invoices-body").addEventListener("click", async event => {
    const button = event.target.closest(".invoice-payment-btn");
    const pdf = event.target.closest(".invoice-pdf-btn");
    if (button) {
      const amount = Number(prompt("Iznos uplate:") || 0);
      if (amount <= 0) return;
      await window.DrRosaApi.addInvoicePayment(button.dataset.invoiceId, { amount, paymentType: "payment", paymentDate: today(), paymentMethod: "cash" });
      await refreshInvoices();
    }
    if (pdf) {
      const response = await fetch(`/api/invoices/${pdf.dataset.invoiceId}/pdf`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("drrosa-token")}` }
      });
      const html = await response.text();
      const win = window.open("", "_blank");
      win.document.write(html);
      win.document.close();
    }
  });

  document.getElementById("insurance-form").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      await window.DrRosaApi.createInsuranceClaim(patientId, {
        provider: document.getElementById("insurance-provider").value,
        policyNumber: document.getElementById("insurance-policy").value,
        status: document.getElementById("insurance-status").value,
        requestedAmount: Number(document.getElementById("insurance-requested").value || 0),
        eligibilityNotes: document.getElementById("insurance-notes").value,
        preauthorizationNotes: document.getElementById("insurance-notes").value
      });
      event.target.reset();
      await refreshClaims();
      setMessage("insurance-message", "Insurance claim je sacuvan.");
    } catch (error) {
      setMessage("insurance-message", error.message || "Claim nije sacuvan.", true);
    }
  });

  document.getElementById("insurance-claims-body").addEventListener("click", async event => {
    const eligibilityButton = event.target.closest(".claim-eligibility-btn");
    const submitButton = event.target.closest(".claim-submit-btn");
    const eraButton = event.target.closest(".claim-era-btn");
    try {
      if (eligibilityButton) {
        await window.DrRosaApi.checkInsuranceEligibility(eligibilityButton.dataset.claimId);
        setMessage("insurance-message", "Eligibility je proveren.");
      }
      if (submitButton) {
        await window.DrRosaApi.submitInsuranceClaim(submitButton.dataset.claimId);
        setMessage("insurance-message", "eClaim je poslat u clearinghouse red.");
      }
      if (eraButton) {
        const amount = Number(eraButton.dataset.amount || 0);
        await window.DrRosaApi.postInsuranceEra(eraButton.dataset.claimId, { paidAmount: amount, approvedAmount: amount });
        await refreshInvoices();
        setMessage("insurance-message", "ERA/EOB je proknjizen u ledger.");
      }
      await refreshClaims();
    } catch (error) {
      setMessage("insurance-message", error.message || "Claim akcija nije uspela.", true);
    }
  });
}

async function initializeClinicalSection(patientDetails, patientRecords) {
  if (!patientDetails?.id) return;
  clinicalSection.style.display = "block";
  fillVisitOptions(patientRecords);
  const patientId = patientDetails.id;
  const profile = await window.DrRosaApi.getMedicalProfile(patientId);
  fillMedicalProfile(profile);
  await loadDocuments(patientId);
  await initializeAdvancedWorkflows(patientId);
  await initializeClinicalWorkflows(patientId);

  document.querySelectorAll(".patient-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".patient-tab").forEach(item => item.classList.toggle("active", item === tab));
      document.querySelectorAll(".patient-tab-panel").forEach(panel => panel.classList.toggle("active", panel.id === tab.dataset.patientTab));
    });
  });

  medicalForm.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const updated = await window.DrRosaApi.updateMedicalProfile(patientId, readMedicalProfileForm());
      fillMedicalProfile(updated);
      setMessage("medical-profile-message", "Karton je sacuvan.");
    } catch (error) {
      setMessage("medical-profile-message", error.message || "Karton nije sacuvan.", true);
    }
  });

  documentForm.addEventListener("submit", async event => {
    event.preventDefault();
    const file = document.getElementById("document-file").files[0];
    if (!file) {
      setMessage("document-message", "Izaberite fajl za upload.", true);
      return;
    }
    try {
      await window.DrRosaApi.createPatientDocument(patientId, {
        documentType: document.getElementById("document-type").value,
        title: document.getElementById("document-title").value || file.name,
        documentDate: document.getElementById("document-date").value,
        visitRecordId: document.getElementById("document-visit").value,
        description: document.getElementById("document-description").value,
        imagingModality: document.getElementById("document-imaging-modality").value,
        toothNumber: document.getElementById("document-tooth-number").value,
        acquisitionDate: document.getElementById("document-date").value,
        dicomStudyUid: document.getElementById("document-dicom-study-uid").value,
        claimAttachmentReady: Boolean(document.getElementById("document-imaging-modality").value),
        originalFilename: file.name,
        mimeType: file.type,
        fileBase64: await fileToBase64(file)
      });
      documentForm.reset();
      fillVisitOptions(patientRecords);
      await loadDocuments(patientId);
      setMessage("document-message", "Dokument je dodat.");
    } catch (error) {
      setMessage("document-message", error.message || "Dokument nije dodat.", true);
    }
  });

  document.getElementById("import-scan-btn").addEventListener("click", async () => {
    try {
      await window.DrRosaApi.importPatientScan(patientId, {
        documentType: document.getElementById("document-type").value,
        title: document.getElementById("document-title").value || "Skenirani dokument",
        documentDate: document.getElementById("document-date").value,
        visitRecordId: document.getElementById("document-visit").value,
        description: document.getElementById("document-description").value,
        imagingModality: document.getElementById("document-imaging-modality").value,
        toothNumber: document.getElementById("document-tooth-number").value,
        acquisitionDate: document.getElementById("document-date").value,
        dicomStudyUid: document.getElementById("document-dicom-study-uid").value,
        claimAttachmentReady: Boolean(document.getElementById("document-imaging-modality").value)
      });
      documentForm.reset();
      fillVisitOptions(patientRecords);
      await loadDocuments(patientId);
      setMessage("document-message", "Poslednji sken je uvezen.");
    } catch (error) {
      setMessage("document-message", error.message || "Sken nije uvezen.", true);
    }
  });

  documentsBody.addEventListener("click", async event => {
    const viewButton = event.target.closest(".view-document-btn");
    const analyzeButton = event.target.closest(".analyze-imaging-btn");
    const downloadButton = event.target.closest(".download-document-btn");
    const deleteButton = event.target.closest(".delete-document-btn");
    try {
      if (viewButton) await openDocument(viewButton.dataset.documentId, false);
      if (analyzeButton) {
        await window.DrRosaApi.analyzeDocumentImaging(analyzeButton.dataset.documentId);
        await loadDocuments(patientId);
        setMessage("document-message", "AI preliminarni pregled je sacuvan.");
      }
      if (downloadButton) await openDocument(downloadButton.dataset.documentId, true);
      if (deleteButton) {
        if (!confirm("Da li zelite da obrisete ovaj dokument?")) return;
        await window.DrRosaApi.deleteDocument(deleteButton.dataset.documentId);
        await loadDocuments(patientId);
      }
    } catch (error) {
      setMessage("document-message", error.message || "Akcija nije uspela.", true);
    }
  });
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
    editPatientLink.href = `new-patient.html?patient=${encodeURIComponent(patientDetails.id)}`;
    deletePatientBtn.addEventListener("click", async () => {
      const confirmMessage = patientRecords.length > 0
        ? `Pacijent ima ${patientRecords.length} povezanih zapisa. Brisanje pacijenta ce biti odbijeno dok postoji istorija. Zelite li ipak pokusati?`
        : "Da li ste sigurni da zelite da obrisete ovog pacijenta?";
      if (!confirm(confirmMessage)) return;
      try {
        await window.DrRosaApi.deletePatient(patientDetails.id);
        window.location.href = "all-records.html";
      } catch (error) {
        alert(error.message || "Pacijent nije obrisan.");
      }
    });
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
    try {
      await initializeClinicalSection(patientDetails, patientRecords);
    } catch (error) {
      console.error("Clinical section load error:", error);
      setMessage("medical-profile-message", "Karton trenutno nije ucitan.", true);
    }
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
      <td>
        <a class="secondary-btn" href="${recordDetailsUrl(record)}">Uredi</a>
        <button class="danger-btn delete-record-btn" type="button" data-record-id="${escapeHtml(record.id)}">Obrisi</button>
      </td>
    </tr>
  `).join("");

  document.querySelectorAll(".delete-record-btn").forEach(button => {
    button.addEventListener("click", async () => {
      if (!confirm("Da li ste sigurni da zelite da obrisete ovaj zapis iz istorije pacijenta?")) return;
      try {
        await window.DrRosaApi.deleteRecord(button.dataset.recordId);
        window.location.reload();
      } catch (error) {
        alert(error.message || "Zapis nije obrisan.");
      }
    });
  });

  const treatmentEntries = [];
  patientRecords.forEach((record) => {
    if (record.treatments) {
      Object.entries(record.treatments).forEach(([tooth, treatments]) => {
        treatmentListForValue(treatments).forEach(treatment => {
          treatmentEntries.push({
            tooth,
            ...treatment,
            date: record.lastVisit,
            visitId: record.id || `${record.lastVisit}-${record.procedure}`,
            procedure: record.procedure,
            currency: record.currency
          });
        });
      });
    }
  });

  const treatmentGroups = groupTreatmentEntries(treatmentEntries);
  treatmentList.innerHTML = treatmentEntries.length === 0
    ? `<p>Nema unesenih tretmana po zubima.</p>`
    : treatmentGroups.map(item => `
      <div class="treatment-item">
        <div>
          <strong>Zubi ${escapeHtml(item.teeth.join(", "))}</strong> - ${escapeHtml(item.type)}
          <div style="margin-top: 6px; font-weight: 700;">Ukupno: ${formatMoney(item.total, item.currency)}</div>
          ${Number(item.discount || 0) > 0 ? `<div style="margin-top: 6px; color: #b45309;">Popust: ${formatMoney(item.discount, item.currency)}</div>` : ""}
          <div style="margin-top: 6px;">${escapeHtml(item.notes.join("; ") || "-")}</div>
          <div style="margin-top: 6px; font-size: 0.9rem; color: #5b6c7d;">${formatDate(item.date)} | ${escapeHtml(item.procedure)}</div>
        </div>
      </div>
    `).join("");
})();
