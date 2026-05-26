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

function setSelectValue(select, value) {
  if (!select || !value) return;
  if (!Array.from(select.options).some(item => item.value === value)) {
    select.appendChild(new Option(value, value));
  }
  select.value = value;
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
let loadedDocuments = [];
let loadedClinicalChartEntries = [];
let loadedClinicalNotes = [];
let loadedPatientConsents = [];
let currencyItems = [];
let imagingObjectUrl = "";
const imagingState = {
  documentId: null,
  url: "",
  mimeType: "",
  zoom: 1,
  rotation: 0,
  x: 0,
  y: 0,
  brightness: 100,
  contrast: 100,
  invert: false,
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  originX: 0,
  originY: 0
};

const statusLabels = {
  planned: "Planirano",
  in_progress: "U toku",
  completed: "Zavrseno",
  watch: "Pracenje",
  referred: "Upucen",
  draft: "Nacrt",
  presented: "Prezentovan",
  accepted: "Prihvacen",
  declined: "Odbijen",
  issued: "Izdat",
  partially_paid: "Delimicno placen",
  paid: "Placeno",
  void: "Storniran",
  refunded: "Refundiran",
  eligibility_checked: "Proverena podobnost",
  preauth_sent: "Predautorizacija poslata",
  submitted: "Poslato",
  approved: "Odobreno",
  partially_approved: "Delimicno odobreno",
  denied: "Odbijeno",
  eligibility_ok: "Podobnost potvrdjena",
  eligibility_failed: "Podobnost odbijena",
  submitted_to_clearinghouse: "Poslato posredniku",
  era_posted: "Obracun proknjizen",
  unreconciled: "Nije uskladjeno",
  reconciled: "Uskladjeno"
};

const consentTypeLabels = {
  treatment: "Terapija",
  surgery: "Hirurgija",
  privacy: "Privatnost",
  financial: "Finansije"
};

const noteCategoryLabels = {
  general: "Opste",
  endodontics: "Endodoncija",
  consent: "Saglasnost"
};

const imagingModalityLabels = {
  intraoral_xray: "Intraoralni RTG",
  panoramic_xray: "Ortopan",
  cbct: "CBCT",
  photo: "Fotografija"
};

const fallbackRsdRates = {
  EUR: 117,
  USD: 108,
  RSD: 1
};

const fieldLabels = {
  fileBase64: "Fajl",
  visitRecordId: "Poseta",
  documentType: "Tip dokumenta",
  title: "Naziv",
  description: "Opis",
  documentDate: "Datum dokumenta",
  originalFilename: "Naziv fajla",
  mimeType: "Tip fajla",
  imagingModality: "Modalitet snimka",
  toothNumber: "Zub / regija",
  acquisitionDate: "Datum snimanja",
  dicomStudyUid: "DICOM Study UID",
  claimAttachmentReady: "Spremno za osiguranje",
  templateId: "Sablon",
  body: "Tekst",
  signedBy: "Potpisuje",
  consentType: "Tip saglasnosti",
  signerName: "Potpisnik",
  signatureData: "Potpis"
};

function labelFromMap(map, value) {
  return map[value] || value || "-";
}

function userFacingError(error, fallback) {
  const raw = error?.message || fallback || "Akcija nije uspela.";
  return Object.entries(fieldLabels).reduce((message, [field, label]) => {
    return message.replaceAll(`"${field}"`, `"${label}"`).replaceAll(field, label);
  }, raw);
}

function rateToRsd(currency) {
  const code = String(currency || "EUR").toUpperCase();
  if (code === "RSD") return 1;
  const item = currencyItems.find(entry => String(entry.value || "").toUpperCase() === code);
  const metadata = item?.metadata || {};
  const rate = Number(metadata.exchangeRate || 0);
  const base = String(metadata.rateBase || code).toUpperCase();
  const target = String(metadata.rateCurrency || "RSD").toUpperCase();
  if (rate > 0 && base === code && target === "RSD") return rate;
  if (rate > 0 && base === "RSD" && target === code) return 1 / rate;
  return fallbackRsdRates[code] || 0;
}

function clinicalPriceState() {
  const price = Number(document.getElementById("clinical-price")?.value || 0);
  const currency = document.getElementById("clinical-currency")?.value || "EUR";
  const exchangeRateToRsd = rateToRsd(currency);
  const priceRsd = currency === "RSD" ? price : price * exchangeRateToRsd;
  return { price, currency, exchangeRateToRsd, priceRsd };
}

function updateClinicalPricePreview() {
  const preview = document.getElementById("clinical-price-preview");
  if (!preview) return;
  const { currency, exchangeRateToRsd, priceRsd } = clinicalPriceState();
  const rateText = currency === "RSD"
    ? "Valuta je RSD, preracun nije potreban."
    : exchangeRateToRsd > 0
      ? `Kurs: 1 ${currency} = ${exchangeRateToRsd.toFixed(4)} RSD`
      : `Nema kursa za ${currency}. Unesite kurs u sifarniku valuta.`;
  preview.innerHTML = `<strong>RSD iznos:</strong> ${formatMoney(priceRsd, "RSD")} <span class="muted">(${rateText})</span>`;
}

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

function imagingModalityLabel(value) {
  return labelFromMap(imagingModalityLabels, value);
}

function renderDocuments(documents) {
  loadedDocuments = documents;
  documentsBody.innerHTML = documents.length ? documents.map(document => `
    <tr>
      <td>${escapeHtml(document.title)}</td>
      <td>${escapeHtml(documentTypeLabel(document.documentType))}</td>
      <td>${formatDate(document.documentDate || document.createdAt)}</td>
      <td>${document.source === "scanner" ? "Skener" : "Otpremanje"}</td>
      <td>${escapeHtml([imagingModalityLabel(document.imagingModality), document.toothNumber].filter(item => item && item !== "-").join(" / ") || "-")}</td>
      <td>${formatFileSize(document.fileSize)}</td>
      <td>
        <button class="secondary-btn view-document-btn" type="button" data-document-id="${document.id}">Pregled</button>
        <button class="secondary-btn edit-document-btn" type="button" data-document-id="${document.id}">Uredi</button>
        <button class="secondary-btn analyze-imaging-btn" type="button" data-document-id="${document.id}">AI pregled</button>
        <button class="secondary-btn download-document-btn" type="button" data-document-id="${document.id}">Preuzmi</button>
        <button class="danger-btn delete-document-btn" type="button" data-document-id="${document.id}">Obrisi</button>
      </td>
    </tr>
  `).join("") : `<tr><td colspan="7" class="empty-row">Nema dokumenata za ovog pacijenta.</td></tr>`;
}

function documentPayloadFromForm() {
  return {
    documentType: document.getElementById("document-type").value,
    title: document.getElementById("document-title").value,
    documentDate: document.getElementById("document-date").value,
    visitRecordId: document.getElementById("document-visit").value,
    description: document.getElementById("document-description").value,
    imagingModality: document.getElementById("document-imaging-modality").value,
    toothNumber: document.getElementById("document-tooth-number").value,
    acquisitionDate: document.getElementById("document-date").value,
    dicomStudyUid: document.getElementById("document-dicom-study-uid").value,
    claimAttachmentReady: Boolean(document.getElementById("document-imaging-modality").value || document.getElementById("document-dicom-study-uid").value)
  };
}

function resetDocumentForm(patientRecords) {
  documentForm.reset();
  document.getElementById("document-id").value = "";
  document.getElementById("document-file").required = false;
  document.getElementById("cancel-document-edit-btn").hidden = true;
  document.getElementById("upload-document-btn").textContent = "Otpremi fajl";
  document.getElementById("import-scan-btn").hidden = false;
  fillVisitOptions(patientRecords);
}

function fillDocumentForm(documentRow) {
  document.getElementById("document-id").value = documentRow.id;
  document.getElementById("document-type").value = documentRow.documentType || "other";
  document.getElementById("document-title").value = documentRow.title || "";
  document.getElementById("document-date").value = documentRow.documentDate || documentRow.acquisitionDate || "";
  document.getElementById("document-imaging-modality").value = documentRow.imagingModality || "";
  document.getElementById("document-tooth-number").value = documentRow.toothNumber || "";
  document.getElementById("document-dicom-study-uid").value = documentRow.dicomStudyUid || "";
  document.getElementById("document-visit").value = documentRow.visitRecordId || "";
  document.getElementById("document-description").value = documentRow.description || "";
  document.getElementById("document-file").value = "";
  document.getElementById("cancel-document-edit-btn").hidden = false;
  document.getElementById("upload-document-btn").textContent = "Sacuvaj dokument";
  document.getElementById("import-scan-btn").hidden = true;
  documentForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function resetImagingState() {
  imagingState.zoom = 1;
  imagingState.rotation = 0;
  imagingState.x = 0;
  imagingState.y = 0;
  imagingState.brightness = 100;
  imagingState.contrast = 100;
  imagingState.invert = false;
  document.getElementById("imaging-brightness").value = "100";
  document.getElementById("imaging-contrast").value = "100";
}

function applyImagingTransform() {
  const image = document.getElementById("imaging-image");
  image.style.transform = `translate(${imagingState.x}px, ${imagingState.y}px) scale(${imagingState.zoom}) rotate(${imagingState.rotation}deg)`;
  image.style.filter = `brightness(${imagingState.brightness}%) contrast(${imagingState.contrast}%)${imagingState.invert ? " invert(1)" : ""}`;
}

function closeImagingViewer() {
  document.getElementById("imaging-viewer").hidden = true;
  document.getElementById("imaging-image").hidden = true;
  document.getElementById("imaging-dicom-canvas").hidden = true;
  document.getElementById("imaging-frame").hidden = true;
  document.getElementById("imaging-viewer-empty").hidden = true;
  if (imagingObjectUrl) URL.revokeObjectURL(imagingObjectUrl);
  imagingObjectUrl = "";
  imagingState.documentId = null;
  imagingState.url = "";
}

function fitImagingToStage() {
  const image = document.getElementById("imaging-image");
  const stage = document.getElementById("imaging-stage");
  if (image.hidden || !image.naturalWidth || !image.naturalHeight) return;
  const scaleX = (stage.clientWidth * 0.92) / image.naturalWidth;
  const scaleY = (stage.clientHeight * 0.92) / image.naturalHeight;
  imagingState.zoom = Math.max(0.1, Math.min(scaleX, scaleY, 1.6));
  imagingState.x = 0;
  imagingState.y = 0;
  applyImagingTransform();
}

function initializeImagingViewerControls() {
  const viewer = document.getElementById("imaging-viewer");
  const image = document.getElementById("imaging-image");
  const stage = document.getElementById("imaging-stage");
  const brightness = document.getElementById("imaging-brightness");
  const contrast = document.getElementById("imaging-contrast");

  document.getElementById("imaging-close-btn").addEventListener("click", closeImagingViewer);
  document.getElementById("imaging-download-btn").addEventListener("click", async () => {
    if (!imagingState.documentId) return;
    await openDocument(imagingState.documentId, true);
  });

  viewer.addEventListener("click", event => {
    const tool = event.target.closest("[data-imaging-tool]")?.dataset.imagingTool;
    if (!tool || image.hidden) return;
    if (tool === "zoom-in") imagingState.zoom = Math.min(8, imagingState.zoom + 0.2);
    if (tool === "zoom-out") imagingState.zoom = Math.max(0.1, imagingState.zoom - 0.2);
    if (tool === "rotate-left") imagingState.rotation -= 90;
    if (tool === "rotate-right") imagingState.rotation += 90;
    if (tool === "invert") imagingState.invert = !imagingState.invert;
    if (tool === "fit") return fitImagingToStage();
    if (tool === "reset") resetImagingState();
    applyImagingTransform();
  });

  brightness.addEventListener("input", event => {
    imagingState.brightness = Number(event.target.value || 100);
    applyImagingTransform();
  });

  contrast.addEventListener("input", event => {
    imagingState.contrast = Number(event.target.value || 100);
    applyImagingTransform();
  });

  image.addEventListener("load", fitImagingToStage);

  stage.addEventListener("pointerdown", event => {
    if (image.hidden) return;
    imagingState.dragging = true;
    imagingState.dragStartX = event.clientX;
    imagingState.dragStartY = event.clientY;
    imagingState.originX = imagingState.x;
    imagingState.originY = imagingState.y;
    stage.classList.add("is-dragging");
    stage.setPointerCapture(event.pointerId);
  });

  stage.addEventListener("pointermove", event => {
    if (!imagingState.dragging) return;
    imagingState.x = imagingState.originX + event.clientX - imagingState.dragStartX;
    imagingState.y = imagingState.originY + event.clientY - imagingState.dragStartY;
    applyImagingTransform();
  });

  stage.addEventListener("pointerup", event => {
    imagingState.dragging = false;
    stage.classList.remove("is-dragging");
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  });

  stage.addEventListener("wheel", event => {
    if (image.hidden) return;
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.12 : -0.12;
    imagingState.zoom = Math.max(0.1, Math.min(8, imagingState.zoom + delta));
    applyImagingTransform();
  }, { passive: false });
}

async function fetchDocumentBlob(documentId, download = false) {
  const token = localStorage.getItem("drrosa-token");
  const response = await fetch(`/api/documents/${documentId}/${download ? "download" : "view"}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error("Dokument nije dostupan.");
  return response.blob();
}

async function openDocument(documentId, download = false) {
  const blob = await fetchDocumentBlob(documentId, download);
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

function isDicomDocument(documentRow, mimeType) {
  const filename = String(documentRow?.originalFilename || "").toLowerCase();
  return mimeType === "application/dicom"
    || filename.endsWith(".dcm")
    || filename.endsWith(".dicom")
    || Boolean(documentRow?.dicomStudyUid);
}

function dicomString(bytes, offset, length) {
  return Array.from(bytes.slice(offset, offset + length))
    .map(code => code ? String.fromCharCode(code) : "")
    .join("")
    .trim();
}

function parseDicomImage(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = bytes.length > 132 && dicomString(bytes, 128, 4) === "DICM" ? 132 : 0;
  const meta = {};
  const longVr = new Set(["OB", "OW", "OF", "SQ", "UT", "UN"]);
  let pixelOffset = 0;
  let pixelLength = 0;

  while (offset + 8 <= bytes.length) {
    const group = view.getUint16(offset, true);
    const element = view.getUint16(offset + 2, true);
    const vr = dicomString(bytes, offset + 4, 2);
    let valueOffset;
    let length;

    if (/^[A-Z]{2}$/.test(vr)) {
      if (longVr.has(vr)) {
        length = view.getUint32(offset + 8, true);
        valueOffset = offset + 12;
      } else {
        length = view.getUint16(offset + 6, true);
        valueOffset = offset + 8;
      }
    } else {
      length = view.getUint32(offset + 4, true);
      valueOffset = offset + 8;
    }

    if (length === 0xffffffff || valueOffset + length > bytes.length) break;
    const tag = `${group.toString(16).padStart(4, "0")}${element.toString(16).padStart(4, "0")}`;
    if (tag === "00280010") meta.rows = view.getUint16(valueOffset, true);
    if (tag === "00280011") meta.columns = view.getUint16(valueOffset, true);
    if (tag === "00280100") meta.bitsAllocated = view.getUint16(valueOffset, true);
    if (tag === "00280103") meta.pixelRepresentation = view.getUint16(valueOffset, true);
    if (tag === "00280004") meta.photometric = dicomString(bytes, valueOffset, length);
    if (tag === "00281050") meta.windowCenter = Number(dicomString(bytes, valueOffset, length).split("\\")[0]);
    if (tag === "00281051") meta.windowWidth = Number(dicomString(bytes, valueOffset, length).split("\\")[0]);
    if (tag === "00281052") meta.rescaleIntercept = Number(dicomString(bytes, valueOffset, length).split("\\")[0]);
    if (tag === "00281053") meta.rescaleSlope = Number(dicomString(bytes, valueOffset, length).split("\\")[0]);
    if (tag === "7fe00010") {
      pixelOffset = valueOffset;
      pixelLength = length;
      break;
    }
    offset = valueOffset + length + (length % 2);
  }

  if (!meta.rows || !meta.columns || !pixelOffset || !pixelLength) {
    throw new Error("DICOM snimak ne moze da se procita u pregledacu. Preuzmite fajl ili ga otvorite u DICOM programu.");
  }
  return { ...meta, pixelOffset, pixelLength };
}

function renderDicomToCanvas(buffer) {
  const meta = parseDicomImage(buffer);
  const canvas = document.getElementById("imaging-dicom-canvas");
  const ctx = canvas.getContext("2d");
  const width = meta.columns;
  const height = meta.rows;
  const count = width * height;
  const view = new DataView(buffer, meta.pixelOffset, meta.pixelLength);
  const pixels = new Float32Array(count);
  const bits = Number(meta.bitsAllocated || 16);
  const slope = Number.isFinite(meta.rescaleSlope) ? meta.rescaleSlope : 1;
  const intercept = Number.isFinite(meta.rescaleIntercept) ? meta.rescaleIntercept : 0;
  let min = Infinity;
  let max = -Infinity;

  for (let index = 0; index < count; index += 1) {
    let value = bits <= 8
      ? view.getUint8(index)
      : (meta.pixelRepresentation ? view.getInt16(index * 2, true) : view.getUint16(index * 2, true));
    value = value * slope + intercept;
    pixels[index] = value;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  if (Number.isFinite(meta.windowCenter) && Number.isFinite(meta.windowWidth) && meta.windowWidth > 0) {
    min = meta.windowCenter - meta.windowWidth / 2;
    max = meta.windowCenter + meta.windowWidth / 2;
  }

  const imageData = ctx.createImageData(width, height);
  const inverted = String(meta.photometric || "").toUpperCase().includes("MONOCHROME1");
  const range = Math.max(1, max - min);
  for (let index = 0; index < count; index += 1) {
    let value = Math.round(((pixels[index] - min) / range) * 255);
    value = Math.max(0, Math.min(255, inverted ? 255 - value : value));
    const out = index * 4;
    imageData.data[out] = value;
    imageData.data[out + 1] = value;
    imageData.data[out + 2] = value;
    imageData.data[out + 3] = 255;
  }

  canvas.width = width;
  canvas.height = height;
  ctx.putImageData(imageData, 0, 0);
  canvas.style.transform = "none";
  canvas.hidden = false;
}

async function openImagingViewer(documentId) {
  const documentRow = loadedDocuments.find(item => String(item.id) === String(documentId));
  const blob = await fetchDocumentBlob(documentId, false);
  const mimeType = blob.type || documentRow?.mimeType || "";
  if (imagingObjectUrl) URL.revokeObjectURL(imagingObjectUrl);
  imagingObjectUrl = URL.createObjectURL(blob);

  resetImagingState();
  imagingState.documentId = documentId;
  imagingState.url = imagingObjectUrl;
  imagingState.mimeType = mimeType;

  const viewer = document.getElementById("imaging-viewer");
  const image = document.getElementById("imaging-image");
  const dicomCanvas = document.getElementById("imaging-dicom-canvas");
  const frame = document.getElementById("imaging-frame");
  const empty = document.getElementById("imaging-viewer-empty");
  const title = document.getElementById("imaging-viewer-title");
  const meta = document.getElementById("imaging-viewer-meta");
  const stage = document.getElementById("imaging-stage");

  title.textContent = documentRow?.title || "Snimak";
  meta.textContent = [
    documentTypeLabel(documentRow?.documentType),
    imagingModalityLabel(documentRow?.imagingModality),
    documentRow?.toothNumber ? `Zub/regija: ${documentRow.toothNumber}` : "",
    documentRow?.source === "scanner" ? "Skener" : "Otpremanje",
    formatFileSize(documentRow?.fileSize)
  ].filter(Boolean).join(" | ");

  viewer.hidden = false;
  image.hidden = true;
  dicomCanvas.hidden = true;
  frame.hidden = true;
  empty.hidden = true;
  stage.classList.remove("is-draggable", "is-dragging");

  if (isDicomDocument(documentRow, mimeType)) {
    try {
      renderDicomToCanvas(await blob.arrayBuffer());
    } catch (error) {
      empty.textContent = userFacingError(error, "DICOM pregled nije dostupan. Koristite Preuzmi.");
      empty.hidden = false;
    }
  } else if (mimeType.startsWith("image/")) {
    image.src = imagingObjectUrl;
    image.hidden = false;
    stage.classList.add("is-draggable");
    applyImagingTransform();
  } else if (mimeType === "application/pdf") {
    frame.src = imagingObjectUrl;
    frame.hidden = false;
  } else {
    empty.hidden = false;
  }

  viewer.scrollIntoView({ behavior: "smooth", block: "start" });
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
      <td>${escapeHtml(labelFromMap(statusLabels, plan.status))}</td>
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
  }).join("") : `<tr><td colspan="3" class="empty-row">Nema parodontalnih chartova.</td></tr>`;
}

function readPerioMeasurementForm() {
  const toothNumber = document.getElementById("perio-tooth").value.trim();
  if (!toothNumber) return null;
  return {
    toothNumber,
    site: document.getElementById("perio-site").value,
    pocketDepth: Number(document.getElementById("perio-pocket").value || 0),
    recession: Number(document.getElementById("perio-recession").value || 0),
    mobility: Number(document.getElementById("perio-mobility").value || 0),
    furcation: Number(document.getElementById("perio-furcation").value || 0),
    bleeding: document.getElementById("perio-bleeding").checked
  };
}

function clearPerioMeasurementForm() {
  document.getElementById("perio-tooth").value = "";
  document.getElementById("perio-pocket").value = "";
  document.getElementById("perio-recession").value = "";
  document.getElementById("perio-mobility").value = "";
  document.getElementById("perio-furcation").value = "";
  document.getElementById("perio-bleeding").checked = false;
}

function renderInvoiceDraft() {
  const preview = document.getElementById("invoice-items-preview");
  preview.innerHTML = invoiceItemsDraft.length
    ? invoiceItemsDraft.map((item, index) => `<p>${escapeHtml(item.description)} - ${formatMoney(item.unitPrice)} <button class="danger-btn remove-invoice-item" type="button" data-index="${index}">x</button></p>`).join("")
    : "<p>Nema stavki racuna.</p>";
}

function readInvoiceItemForm() {
  const description = document.getElementById("invoice-item-description").value.trim();
  if (!description) return null;
  return {
    description,
    quantity: 1,
    unitPrice: Number(document.getElementById("invoice-item-price").value || 0),
    discount: 0
  };
}

function clearInvoiceItemForm() {
  document.getElementById("invoice-item-description").value = "";
  document.getElementById("invoice-item-price").value = "";
}

function renderInvoices(invoices) {
  document.getElementById("invoices-body").innerHTML = invoices.length ? invoices.map(invoice => `
    <tr>
      <td>${escapeHtml(invoice.invoiceNumber)}</td>
      <td>${escapeHtml(labelFromMap(statusLabels, invoice.status))}</td>
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
  summary.innerHTML = `<strong>Saldo kartice:</strong> ${formatMoney(ledger.balance || 0)} <span class="muted">(${entries.length} knjizenja)</span>`;
}

function renderInsuranceClaims(claims) {
  document.getElementById("insurance-claims-body").innerHTML = claims.length ? claims.map(claim => `
    <tr>
      <td>${escapeHtml(claim.provider)}<br><small>${escapeHtml(claim.policyNumber || "-")}</small></td>
      <td>${escapeHtml(labelFromMap(statusLabels, claim.status))}${claim.eligibilityStatus ? `<br><small>${escapeHtml(labelFromMap(statusLabels, claim.eligibilityStatus))}</small>` : ""}</td>
      <td>${formatMoney(claim.requestedAmount)}</td>
      <td>${claim.eob ? `${formatMoney(claim.paidAmount)}<br><small>${escapeHtml(labelFromMap(statusLabels, claim.eraStatus) || "Obracun")}</small>` : escapeHtml(claim.denialReason || claim.eligibilityNotes || "-")}</td>
      <td>
        <button class="secondary-btn claim-eligibility-btn" type="button" data-claim-id="${claim.id}">Proveri podobnost</button>
        <button class="secondary-btn claim-submit-btn" type="button" data-claim-id="${claim.id}">Posalji zahtev</button>
        <button class="secondary-btn claim-era-btn" type="button" data-claim-id="${claim.id}" data-amount="${claim.approvedAmount || claim.requestedAmount || 0}">Proknjizi obracun</button>
      </td>
    </tr>
  `).join("") : `<tr><td colspan="5" class="empty-row">Nema zahteva za osiguranje.</td></tr>`;
}

function renderClinicalChart(entries) {
  loadedClinicalChartEntries = entries;
  document.getElementById("clinical-chart-body").innerHTML = entries.length ? entries.map(entry => `
    <tr>
      <td>${escapeHtml(entry.toothNumber)}<br><small>${escapeHtml((entry.surfaces || []).join(", ") || "-")}</small></td>
      <td>${escapeHtml([entry.cdtCode, entry.adaCode].filter(Boolean).join(" / ") || "-")}</td>
      <td>${escapeHtml(labelFromMap(statusLabels, entry.status))}<br><small>Faza ${escapeHtml(entry.phase)}</small>${Number(entry.price || 0) > 0 ? `<br><small>${formatMoney(entry.price, entry.currency)} / ${formatMoney(entry.priceRsd, "RSD")}</small>` : ""}</td>
      <td>${escapeHtml(entry.diagnosis || entry.notes || "-")}</td>
      <td>
        <button class="secondary-btn edit-clinical-chart-btn" type="button" data-entry-id="${entry.id}">Uredi</button>
        <button class="danger-btn delete-clinical-chart-btn" type="button" data-entry-id="${entry.id}">Obrisi</button>
      </td>
    </tr>
  `).join("") : `<tr><td colspan="5" class="empty-row">Nema unosa zubnog statusa.</td></tr>`;
}

function clinicalChartPayloadFromForm() {
  const { price, currency, exchangeRateToRsd, priceRsd } = clinicalPriceState();
  return {
    toothNumber: document.getElementById("clinical-tooth").value,
    surfaces: document.getElementById("clinical-surfaces").value.split(",").map(item => item.trim()).filter(Boolean),
    cdtCode: document.getElementById("clinical-cdt").value,
    adaCode: document.getElementById("clinical-ada").value,
    status: document.getElementById("clinical-status").value,
    phase: Number(document.getElementById("clinical-phase").value || 1),
    price,
    currency,
    priceRsd,
    exchangeRateToRsd,
    diagnosis: document.getElementById("clinical-diagnosis").value,
    procedureCode: document.getElementById("clinical-procedure-code").value,
    notes: document.getElementById("clinical-notes").value
  };
}

function resetClinicalChartForm() {
  const form = document.getElementById("clinical-chart-form");
  form.reset();
  document.getElementById("clinical-chart-entry-id").value = "";
  document.getElementById("clinical-phase").value = "1";
  document.getElementById("clinical-currency").value = "EUR";
  document.getElementById("cancel-clinical-chart-edit-btn").hidden = true;
  form.querySelector('button[type="submit"]').textContent = "Sacuvaj zubni status";
  updateClinicalPricePreview();
}

function fillClinicalChartForm(entry) {
  document.getElementById("clinical-chart-entry-id").value = entry.id;
  document.getElementById("clinical-tooth").value = entry.toothNumber || "";
  document.getElementById("clinical-surfaces").value = (entry.surfaces || []).join(", ");
  document.getElementById("clinical-cdt").value = entry.cdtCode || "";
  document.getElementById("clinical-ada").value = entry.adaCode || "";
  document.getElementById("clinical-status").value = entry.status || "planned";
  document.getElementById("clinical-phase").value = entry.phase || 1;
  document.getElementById("clinical-price").value = Number(entry.price || 0) || "";
  setSelectValue(document.getElementById("clinical-currency"), entry.currency || "EUR");
  document.getElementById("clinical-diagnosis").value = entry.diagnosis || "";
  document.getElementById("clinical-procedure-code").value = entry.procedureCode || "";
  document.getElementById("clinical-notes").value = entry.notes || "";
  document.getElementById("cancel-clinical-chart-edit-btn").hidden = false;
  document.getElementById("clinical-chart-form").querySelector('button[type="submit"]').textContent = "Sacuvaj izmenu";
  updateClinicalPricePreview();
  document.getElementById("clinical-chart-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderClinicalNoteTemplates(templates) {
  const select = document.getElementById("clinical-note-template");
  select.innerHTML = `<option value="">Prazna beleska</option>${templates.map(template => `
    <option value="${template.id}" data-title="${escapeHtml(template.title)}" data-body="${escapeHtml(template.body)}">${escapeHtml(labelFromMap(noteCategoryLabels, template.category))} - ${escapeHtml(template.title)}</option>
  `).join("")}`;
}

function renderClinicalNotes(notes) {
  loadedClinicalNotes = notes;
  document.getElementById("clinical-notes-body").innerHTML = notes.length ? notes.map(note => `
    <tr>
      <td>${escapeHtml(note.title)}<br><small>${escapeHtml(String(note.body || "").slice(0, 120))}</small></td>
      <td>${note.signedAt ? `${escapeHtml(note.signedBy || "-")}<br><small>${formatDate(note.signedAt)}</small>` : "Nije potpisano"}</td>
      <td>${formatDate(note.createdAt)}</td>
      <td>
        <button class="secondary-btn edit-clinical-note-btn" type="button" data-note-id="${note.id}">Uredi</button>
        ${note.signedAt ? "" : `<button class="primary-btn sign-clinical-note-btn" type="button" data-note-id="${note.id}">Potpis</button>`}
        <button class="danger-btn delete-clinical-note-btn" type="button" data-note-id="${note.id}">Obrisi</button>
      </td>
    </tr>
  `).join("") : `<tr><td colspan="4" class="empty-row">Nema klinickih beleski.</td></tr>`;
}

function renderPatientConsents(consents) {
  loadedPatientConsents = consents;
  document.getElementById("patient-consents-body").innerHTML = consents.length ? consents.map(consent => `
    <tr>
      <td>${escapeHtml(consent.title)}<br><small>${escapeHtml(labelFromMap(consentTypeLabels, consent.consentType))}</small></td>
      <td>${escapeHtml(consent.signerName)}<br><small>${escapeHtml(consent.signatureData)}</small></td>
      <td>${formatDate(consent.signedAt)}</td>
      <td>
        <button class="secondary-btn edit-consent-btn" type="button" data-consent-id="${consent.id}">Uredi</button>
        <button class="danger-btn delete-consent-btn" type="button" data-consent-id="${consent.id}">Obrisi</button>
      </td>
    </tr>
  `).join("") : `<tr><td colspan="4" class="empty-row">Nema sacuvanih saglasnosti.</td></tr>`;
}

function clinicalNotePayloadFromForm() {
  return {
    templateId: document.getElementById("clinical-note-template").value,
    title: document.getElementById("clinical-note-title").value,
    body: document.getElementById("clinical-note-body").value,
    signedBy: document.getElementById("clinical-note-signed-by").value
  };
}

function resetClinicalNoteForm() {
  const form = document.getElementById("clinical-note-form");
  form.reset();
  document.getElementById("clinical-note-id").value = "";
  document.getElementById("cancel-clinical-note-edit-btn").hidden = true;
  form.querySelector('button[type="submit"]').textContent = "Sacuvaj belesku";
}

function fillClinicalNoteForm(note) {
  document.getElementById("clinical-note-id").value = note.id;
  document.getElementById("clinical-note-template").value = note.templateId || "";
  document.getElementById("clinical-note-title").value = note.title || "";
  document.getElementById("clinical-note-body").value = note.body || "";
  document.getElementById("clinical-note-signed-by").value = note.signedBy || "";
  document.getElementById("cancel-clinical-note-edit-btn").hidden = false;
  document.getElementById("clinical-note-form").querySelector('button[type="submit"]').textContent = "Sacuvaj izmenu";
  document.getElementById("clinical-note-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

function consentPayloadFromForm() {
  return {
    consentType: document.getElementById("consent-type").value,
    title: document.getElementById("consent-title").value,
    body: document.getElementById("consent-body").value,
    signerName: document.getElementById("consent-signer").value,
    signatureData: document.getElementById("consent-signature").value
  };
}

function resetConsentForm() {
  const form = document.getElementById("patient-consent-form");
  form.reset();
  document.getElementById("consent-id").value = "";
  document.getElementById("cancel-consent-edit-btn").hidden = true;
  form.querySelector('button[type="submit"]').textContent = "Sacuvaj saglasnost";
}

function fillConsentForm(consent) {
  document.getElementById("consent-id").value = consent.id;
  document.getElementById("consent-type").value = consent.consentType || "treatment";
  document.getElementById("consent-title").value = consent.title || "";
  document.getElementById("consent-body").value = consent.body || "";
  document.getElementById("consent-signer").value = consent.signerName || "";
  document.getElementById("consent-signature").value = consent.signatureData || "";
  document.getElementById("cancel-consent-edit-btn").hidden = false;
  document.getElementById("patient-consent-form").querySelector('button[type="submit"]').textContent = "Sacuvaj izmenu";
  document.getElementById("patient-consent-form").scrollIntoView({ behavior: "smooth", block: "start" });
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

  const [templates, currencies] = await Promise.all([
    window.DrRosaApi.getClinicalNoteTemplates(),
    window.DrRosaApi.getCodebooks ? window.DrRosaApi.getCodebooks("currency").catch(() => []) : []
  ]);
  currencyItems = currencies.length ? currencies : [
    { value: "EUR", label: "EUR", metadata: { exchangeRate: 117, rateBase: "EUR", rateCurrency: "RSD" } },
    { value: "RSD", label: "RSD", metadata: { exchangeRate: 1, rateBase: "RSD", rateCurrency: "RSD" } },
    { value: "USD", label: "USD", metadata: { exchangeRate: 108, rateBase: "USD", rateCurrency: "RSD" } }
  ];
  const currencySelect = document.getElementById("clinical-currency");
  const currentCurrency = currencySelect.value;
  currencySelect.innerHTML = currencyItems.map(item => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label || item.value)}</option>`).join("");
  setSelectValue(currencySelect, currentCurrency || "EUR");
  ["clinical-price", "clinical-currency"].forEach(id => {
    document.getElementById(id).addEventListener("input", updateClinicalPricePreview);
    document.getElementById(id).addEventListener("change", updateClinicalPricePreview);
  });
  updateClinicalPricePreview();
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
      const entryId = document.getElementById("clinical-chart-entry-id").value;
      const payload = clinicalChartPayloadFromForm();
      if (entryId) {
        await window.DrRosaApi.updateClinicalChartEntry(entryId, payload);
      } else {
        await window.DrRosaApi.createClinicalChartEntry(patientId, payload);
      }
      resetClinicalChartForm();
      setMessage("clinical-chart-message", entryId ? "Zubni status je izmenjen." : "Zubni status je sacuvan.");
      await refreshClinicalChart();
    } catch (error) {
      setMessage("clinical-chart-message", error.message || "Zubni status nije sacuvan.", true);
    }
  });

  document.getElementById("cancel-clinical-chart-edit-btn").addEventListener("click", () => {
    resetClinicalChartForm();
    setMessage("clinical-chart-message", "");
  });

  document.getElementById("clinical-chart-body").addEventListener("click", async event => {
    const editButton = event.target.closest(".edit-clinical-chart-btn");
    const deleteButton = event.target.closest(".delete-clinical-chart-btn");
    if (editButton) {
      const entry = loadedClinicalChartEntries.find(item => String(item.id) === String(editButton.dataset.entryId));
      if (entry) fillClinicalChartForm(entry);
      return;
    }
    if (!deleteButton) return;
    await window.DrRosaApi.deleteClinicalChartEntry(deleteButton.dataset.entryId);
    setMessage("clinical-chart-message", "Unos zubnog statusa je obrisan.");
    resetClinicalChartForm();
    await refreshClinicalChart();
  });

  document.getElementById("clinical-note-form").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const noteId = document.getElementById("clinical-note-id").value;
      const payload = clinicalNotePayloadFromForm();
      if (noteId) {
        await window.DrRosaApi.updateClinicalNote(noteId, payload);
      } else {
        await window.DrRosaApi.createClinicalNote(patientId, payload);
      }
      resetClinicalNoteForm();
      setMessage("clinical-note-message", noteId ? "Klinicka beleska je izmenjena." : "Klinicka beleska je sacuvana.");
      await refreshClinicalNotes();
    } catch (error) {
      setMessage("clinical-note-message", userFacingError(error, "Klinicka beleska nije sacuvana."), true);
    }
  });

  document.getElementById("cancel-clinical-note-edit-btn").addEventListener("click", () => {
    resetClinicalNoteForm();
    setMessage("clinical-note-message", "");
  });

  document.getElementById("clinical-notes-body").addEventListener("click", async event => {
    const editButton = event.target.closest(".edit-clinical-note-btn");
    const signButton = event.target.closest(".sign-clinical-note-btn");
    const deleteButton = event.target.closest(".delete-clinical-note-btn");
    if (editButton) {
      const note = loadedClinicalNotes.find(item => String(item.id) === String(editButton.dataset.noteId));
      if (note) fillClinicalNoteForm(note);
      return;
    }
    if (signButton) {
      const signedBy = window.prompt("Potpisuje:", "Dr Rosa");
      if (!signedBy) return;
      await window.DrRosaApi.signClinicalNote(signButton.dataset.noteId, { signedBy });
      setMessage("clinical-note-message", "Klinicka beleska je potpisana.");
      await refreshClinicalNotes();
      return;
    }
    if (!deleteButton) return;
    if (!confirm("Da li zelite da obrisete ovu klinicku belesku?")) return;
    await window.DrRosaApi.deleteClinicalNote(deleteButton.dataset.noteId);
    resetClinicalNoteForm();
    setMessage("clinical-note-message", "Klinicka beleska je obrisana.");
    await refreshClinicalNotes();
  });

  document.getElementById("patient-consent-form").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const consentId = document.getElementById("consent-id").value;
      const payload = consentPayloadFromForm();
      if (consentId) {
        await window.DrRosaApi.updatePatientConsent(consentId, payload);
      } else {
        await window.DrRosaApi.createPatientConsent(patientId, payload);
      }
      resetConsentForm();
      setMessage("consent-message", consentId ? "Saglasnost je izmenjena." : "Saglasnost je sacuvana i potpisana.");
      await refreshConsents();
    } catch (error) {
      setMessage("consent-message", userFacingError(error, "Saglasnost nije sacuvana."), true);
    }
  });

  document.getElementById("cancel-consent-edit-btn").addEventListener("click", () => {
    resetConsentForm();
    setMessage("consent-message", "");
  });

  document.getElementById("patient-consents-body").addEventListener("click", async event => {
    const editButton = event.target.closest(".edit-consent-btn");
    const deleteButton = event.target.closest(".delete-consent-btn");
    if (editButton) {
      const consent = loadedPatientConsents.find(item => String(item.id) === String(editButton.dataset.consentId));
      if (consent) fillConsentForm(consent);
      return;
    }
    if (!deleteButton) return;
    if (!confirm("Da li zelite da obrisete ovu saglasnost?")) return;
    await window.DrRosaApi.deletePatientConsent(deleteButton.dataset.consentId);
    resetConsentForm();
    setMessage("consent-message", "Saglasnost je obrisana.");
    await refreshConsents();
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
    if (planItemsDraft.length === 0) {
      setMessage("treatment-plan-message", "Dodajte bar jednu stavku plana.", true);
      return;
    }
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
    const measurement = readPerioMeasurementForm();
    if (!measurement) return setMessage("perio-message", "Unesite zub.", true);
    perioMeasurementsDraft.push(measurement);
    clearPerioMeasurementForm();
    renderPerioDraft();
    setMessage("perio-message", "Merenje je dodato na listu.");
  });
  document.getElementById("perio-measurements-preview").addEventListener("click", event => {
    const button = event.target.closest(".remove-perio-item");
    if (!button) return;
    perioMeasurementsDraft.splice(Number(button.dataset.index), 1);
    renderPerioDraft();
  });
  document.getElementById("perio-form").addEventListener("submit", async event => {
    event.preventDefault();
    const currentMeasurement = readPerioMeasurementForm();
    if (currentMeasurement) {
      perioMeasurementsDraft.push(currentMeasurement);
    }
    if (perioMeasurementsDraft.length === 0) {
      setMessage("perio-message", "Dodajte bar jedno merenje.", true);
      return;
    }
    try {
      await window.DrRosaApi.createPerioChart(patientId, {
        chartDate: document.getElementById("perio-date").value || today(),
        measurements: perioMeasurementsDraft
      });
      perioMeasurementsDraft = [];
      event.target.reset();
      document.getElementById("perio-date").value = today();
      renderPerioDraft();
      await refreshPerio();
      setMessage("perio-message", "Parodontalni chart je sacuvan.");
    } catch (error) {
      setMessage("perio-message", error.message || "Parodontalni chart nije sacuvan.", true);
    }
  });

  document.getElementById("add-invoice-item-btn").addEventListener("click", () => {
    const item = readInvoiceItemForm();
    if (!item) return setMessage("invoice-message", "Unesite stavku.", true);
    invoiceItemsDraft.push(item);
    clearInvoiceItemForm();
    renderInvoiceDraft();
    setMessage("invoice-message", "Stavka je dodata na racun.");
  });
  document.getElementById("invoice-items-preview").addEventListener("click", event => {
    const button = event.target.closest(".remove-invoice-item");
    if (!button) return;
    invoiceItemsDraft.splice(Number(button.dataset.index), 1);
    renderInvoiceDraft();
  });
  document.getElementById("invoice-form").addEventListener("submit", async event => {
    event.preventDefault();
    const currentItem = readInvoiceItemForm();
    if (currentItem) {
      invoiceItemsDraft.push(currentItem);
    }
    if (invoiceItemsDraft.length === 0) {
      setMessage("invoice-message", "Dodajte bar jednu stavku racuna.", true);
      return;
    }
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
    const provider = document.getElementById("insurance-provider").value.trim();
    const requestedAmount = Number(document.getElementById("insurance-requested").value || 0);
    if (!provider) {
      setMessage("insurance-message", "Unesite naziv osiguranja.", true);
      return;
    }
    if (requestedAmount <= 0) {
      setMessage("insurance-message", "Unesite trazeni iznos veci od 0.", true);
      return;
    }
    try {
      await window.DrRosaApi.createInsuranceClaim(patientId, {
        provider,
        policyNumber: document.getElementById("insurance-policy").value,
        status: document.getElementById("insurance-status").value,
        requestedAmount,
        eligibilityNotes: document.getElementById("insurance-notes").value,
        preauthorizationNotes: document.getElementById("insurance-notes").value
      });
      event.target.reset();
      await refreshClaims();
      setMessage("insurance-message", "Zahtev za osiguranje je sacuvan.");
    } catch (error) {
      setMessage("insurance-message", userFacingError(error, "Zahtev nije sacuvan."), true);
    }
  });

  document.getElementById("insurance-claims-body").addEventListener("click", async event => {
    const eligibilityButton = event.target.closest(".claim-eligibility-btn");
    const submitButton = event.target.closest(".claim-submit-btn");
    const eraButton = event.target.closest(".claim-era-btn");
    try {
      if (eligibilityButton) {
        await window.DrRosaApi.checkInsuranceEligibility(eligibilityButton.dataset.claimId);
        setMessage("insurance-message", "Podobnost je proverena.");
      }
      if (submitButton) {
        await window.DrRosaApi.submitInsuranceClaim(submitButton.dataset.claimId);
        setMessage("insurance-message", "Zahtev je poslat u red za obradu.");
      }
      if (eraButton) {
        const amount = Number(eraButton.dataset.amount || 0);
        await window.DrRosaApi.postInsuranceEra(eraButton.dataset.claimId, { paidAmount: amount, approvedAmount: amount });
        await refreshInvoices();
        setMessage("insurance-message", "Obracun je proknjizen u karticu.");
      }
      await refreshClaims();
    } catch (error) {
      setMessage("insurance-message", error.message || "Akcija nad zahtevom nije uspela.", true);
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
    const documentId = document.getElementById("document-id").value;
    const file = document.getElementById("document-file").files[0];
    if (!documentId && !file) {
      setMessage("document-message", "Izaberite fajl za upload.", true);
      return;
    }
    try {
      const payload = documentPayloadFromForm();
      if (documentId) {
        await window.DrRosaApi.updatePatientDocument(documentId, payload);
      } else {
        await window.DrRosaApi.createPatientDocument(patientId, {
          ...payload,
          title: payload.title || file.name,
          originalFilename: file.name,
          mimeType: file.type || (file.name.toLowerCase().endsWith(".dcm") || file.name.toLowerCase().endsWith(".dicom") ? "application/dicom" : "application/octet-stream"),
          fileBase64: await fileToBase64(file)
        });
      }
      resetDocumentForm(patientRecords);
      await loadDocuments(patientId);
      setMessage("document-message", documentId ? "Dokument je izmenjen." : "Dokument je dodat.");
    } catch (error) {
      setMessage("document-message", userFacingError(error, "Dokument nije sacuvan."), true);
    }
  });

  document.getElementById("cancel-document-edit-btn").addEventListener("click", () => {
    resetDocumentForm(patientRecords);
    setMessage("document-message", "");
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
    const editButton = event.target.closest(".edit-document-btn");
    const analyzeButton = event.target.closest(".analyze-imaging-btn");
    const downloadButton = event.target.closest(".download-document-btn");
    const deleteButton = event.target.closest(".delete-document-btn");
    try {
      if (viewButton) await openImagingViewer(viewButton.dataset.documentId);
      if (editButton) {
        const documentRow = loadedDocuments.find(item => String(item.id) === String(editButton.dataset.documentId));
        if (documentRow) fillDocumentForm(documentRow);
      }
      if (analyzeButton) {
        await window.DrRosaApi.analyzeDocumentImaging(analyzeButton.dataset.documentId);
        await loadDocuments(patientId);
        setMessage("document-message", "AI preliminarni pregled je sacuvan.");
      }
      if (downloadButton) await openDocument(downloadButton.dataset.documentId, true);
      if (deleteButton) {
        if (!confirm("Da li zelite da obrisete ovaj dokument?")) return;
        await window.DrRosaApi.deleteDocument(deleteButton.dataset.documentId);
        resetDocumentForm(patientRecords);
        await loadDocuments(patientId);
      }
    } catch (error) {
      setMessage("document-message", userFacingError(error, "Akcija nije uspela."), true);
    }
  });

  initializeImagingViewerControls();
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
