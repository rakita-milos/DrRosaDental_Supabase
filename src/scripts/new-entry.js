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
      window.DrRosaApi.logout().finally(() => {
        window.location.href = "login.html";
      });
    });
  }

  return true;
}

const form = document.getElementById("new-entry-form");
const alertBox = document.querySelector(".form-alert");
const saveStatusBox = document.getElementById("save-status");
const submitButton = form?.querySelector("button[type='submit']");
const entryPatientContext = document.getElementById("entry-patient-context");
const escapeHtml = window.DrRosaSecurity.escapeHtml;
const escapeAttribute = window.DrRosaSecurity.escapeAttribute;
const previewElements = {
  name: document.getElementById("preview-name"),
  procedure: document.getElementById("preview-procedure"),
  teethCount: document.getElementById("preview-teeth-count"),
  paymentStatus: document.getElementById("preview-payment-status"),
  totalAmount: document.getElementById("preview-total-amount"),
  amountPaid: document.getElementById("preview-amount-paid"),
  amountDue: document.getElementById("preview-amount-due"),
  debtRow: document.getElementById("preview-debt-row"),
  noteBadge: document.getElementById("preview-note-badge")
};

const inputs = {
  patient: document.getElementById("patient-name"),
  lastVisit: document.getElementById("last-visit"),
  procedureActivity: document.getElementById("procedure-activity"),
  procedure: document.getElementById("procedure"),
  clearGeneralTreatmentDraft: document.getElementById("clear-general-treatment-draft"),
  addGeneralTreatment: document.getElementById("add-general-treatment"),
  generalTreatmentList: document.getElementById("general-treatment-list"),
  doctor: document.getElementById("doctor"),
  status: document.getElementById("status"),
  paymentStatus: document.getElementById("payment-status"),
  amountPaid: document.getElementById("amount-paid"),
  amountDue: document.getElementById("amount-due"),
  totalAmount: document.getElementById("total-amount"),
  currency: document.getElementById("currency"),
  paymentPartsList: document.getElementById("payment-parts-list"),
  addPaymentPart: document.getElementById("add-payment-part"),
  paymentTotalDisplay: document.getElementById("payment-total-display"),
  paymentPaidDisplay: document.getElementById("payment-paid-display"),
  paymentDebtDisplay: document.getElementById("payment-debt-display"),
  paymentStatusDisplay: document.getElementById("payment-status-display"),
  previousPaymentsPanel: document.getElementById("previous-payments-panel"),
  previousPaymentsContent: document.getElementById("previous-payments-content"),
  previousPaymentsBody: document.getElementById("previous-payments-body"),
  togglePreviousPayments: document.getElementById("toggle-previous-payments"),
  previousPaymentsPrev: document.getElementById("previous-payments-prev"),
  previousPaymentsNext: document.getElementById("previous-payments-next"),
  previousPaymentsPage: document.getElementById("previous-payments-page"),
  previousDebtPaymentForm: document.getElementById("previous-debt-payment-form"),
  previousDebtPaymentPanel: document.getElementById("previous-debt-payment-panel"),
  previousDebtRecordId: document.getElementById("previous-debt-record-id"),
  previousDebtPaymentContext: document.getElementById("previous-debt-payment-context"),
  previousDebtPaymentAmount: document.getElementById("previous-debt-payment-amount"),
  previousDebtPaymentCurrency: document.getElementById("previous-debt-payment-currency"),
  previousDebtPaymentMethod: document.getElementById("previous-debt-payment-method"),
  previousDebtPaymentDate: document.getElementById("previous-debt-payment-date"),
  cancelPreviousDebtPayment: document.getElementById("cancel-previous-debt-payment"),
  shift: document.getElementById("shift"),
  note: document.getElementById("note")
};

let patients = [];
let doctors = [];
let allRecords = [];
let teethTreatments = {};
let generalTreatments = [];
let selectedTeeth = new Set();
let initialConditionEntries = [];
let paymentParts = [];
let patientPaymentHistory = {
  patientId: null,
  page: 1,
  limit: 5,
  cache: new Map(),
  hasMoreByPage: new Map(),
  loading: false,
  expanded: false
};
let selectedDebtPaymentRecord = null;
let paymentMethodItems = [
  { value: "Gotovina", label: "Gotovina" },
  { value: "Kartica", label: "Kartica" },
  { value: "Virman", label: "Virman" },
  { value: "Avans", label: "Avans" }
];
let totalAmountTouched = false;
let alertTimeout;
const procedureCatalog = window.DrRosaProcedureCatalog;
const currencyUtils = window.DrRosaCurrencyUtils;
const PAYMENT_ROUNDING_TOLERANCE_RSD = 1;
const NEW_ENTRY_PATIENT_STORAGE_KEY = "drrosa-new-entry-patient";

const urlParams = new URLSearchParams(window.location.search);
const patientParam = urlParams.get("patient");
const recordParam = urlParams.get("record");
function takePendingNewEntryPatientId() {
  try {
    const raw = window.sessionStorage.getItem(NEW_ENTRY_PATIENT_STORAGE_KEY);
    if (!raw) return "";
    window.sessionStorage.removeItem(NEW_ENTRY_PATIENT_STORAGE_KEY);
    const payload = JSON.parse(raw);
    const createdAt = Number(payload?.createdAt || 0);
    const maxAgeMs = 15 * 60 * 1000;
    if (!payload?.patientId || !createdAt || Date.now() - createdAt > maxAgeMs) return "";
    return String(payload.patientId);
  } catch (_error) {
    try {
      window.sessionStorage.removeItem(NEW_ENTRY_PATIENT_STORAGE_KEY);
    } catch {
      // Ignore storage cleanup errors.
    }
    return "";
  }
}

const patientIdParam = urlParams.get("patientId") || urlParams.get("id") || (recordParam ? "" : takePendingNewEntryPatientId());
if (patientParam || patientIdParam) {
  inputs.patient.value = patientParam || "";
}

function formatDate(rawDate) {
  if (!rawDate) return "-";
  return window.DrRosaDateUtils.formatDate(rawDate);
}

function setAlertElement(element, message, type) {
  if (!element) return;
  element.textContent = message;
  element.className = element.id === "save-status" ? `save-status ${type}` : `form-alert ${type}`;
}

function clearAlertElement(element) {
  if (!element) return;
  element.textContent = "";
  element.className = element.id === "save-status" ? "save-status" : "form-alert";
}

function showAlert(message, type = "success", options = {}) {
  const { persist = type === "error" || type === "info", scroll = false } = options;
  window.clearTimeout(alertTimeout);
  setAlertElement(alertBox, message, type);
  setAlertElement(saveStatusBox, message, type);
  if (scroll) {
    (saveStatusBox || alertBox)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  if (!persist) {
    alertTimeout = window.setTimeout(() => {
      clearAlertElement(alertBox);
      clearAlertElement(saveStatusBox);
    }, 6500);
  }
}

function setupEntryStepNavigation() {
  const stepLinks = [...document.querySelectorAll(".entry-step-strip a[href^='#']")];
  if (!stepLinks.length) return;
  let manualStepTarget = "";
  let manualStepLockTimer = 0;

  const sectionEntries = stepLinks
    .map(link => ({ link, section: document.querySelector(link.getAttribute("href")) }))
    .filter(entry => entry.section);

  function setActiveStep(sectionId) {
    sectionEntries.forEach(({ link, section }) => {
      const active = section.id === sectionId;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "step");
      else link.removeAttribute("aria-current");
    });
  }

  function clearManualStepLock() {
    manualStepTarget = "";
    window.clearTimeout(manualStepLockTimer);
    manualStepLockTimer = 0;
  }

  function lockManualStep(sectionId) {
    manualStepTarget = sectionId;
    window.clearTimeout(manualStepLockTimer);
    manualStepLockTimer = window.setTimeout(clearManualStepLock, 900);
  }

  function scrollToEntrySection(section) {
    lockManualStep(section.id);
    setActiveStep(section.id);
    if (window.location.hash !== `#${section.id}`) {
      window.history.replaceState(null, "", `#${section.id}`);
    }
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  sectionEntries.forEach(({ link, section }) => {
    link.addEventListener("click", event => {
      event.preventDefault();
      scrollToEntrySection(section);
    });
  });

  setActiveStep(sectionEntries[0].section.id);

  if (!("IntersectionObserver" in window)) return;

  const observer = new IntersectionObserver(entries => {
    if (manualStepTarget) {
      const targetEntry = entries.find(entry => entry.target.id === manualStepTarget && entry.isIntersecting);
      if (targetEntry && targetEntry.intersectionRatio >= 0.28) {
        setActiveStep(manualStepTarget);
        clearManualStepLock();
      }
      return;
    }
    const visibleEntry = entries
      .filter(entry => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visibleEntry) setActiveStep(visibleEntry.target.id);
  }, {
    rootMargin: "-120px 0px -58% 0px",
    threshold: [0.12, 0.28, 0.5]
  });

  sectionEntries.forEach(({ section }) => observer.observe(section));
}

function setSubmitting(isSubmitting) {
  if (!submitButton) return;
  submitButton.disabled = isSubmitting;
  submitButton.textContent = isSubmitting ? "Čuvanje..." : "Sačuvaj unos";
}

function controlLabel(control) {
  const label = control.closest("label")?.childNodes?.[0]?.textContent?.trim()
    || document.querySelector(`label[for="${control.id}"]`)?.textContent?.trim()
    || control.name
    || control.id
    || "polje";
  return label.replace(/\s+/g, " ");
}

function selectedTreatmentTeethCount() {
  return Object.keys(teethTreatments).filter(tooth => treatmentListForTooth(tooth).length > 0).length;
}

function updatePreview() {
  const procedureText = currentCombinedTreatmentDescription();
  const summary = paymentSummary();
  const hasDebt = summary.debt > 0.009;
  previewElements.name.textContent = inputs.patient.value.trim() || "Pacijent nije izabran";
  previewElements.procedure.textContent = procedureText
    || "Rad nije dodat";
  previewElements.teethCount.textContent = String(selectedTreatmentTeethCount());
  previewElements.paymentStatus.textContent = summary.status || inputs.paymentStatus.value;
  previewElements.totalAmount.textContent = formatMoney(summary.total, summary.currency);
  previewElements.amountPaid.textContent = formatMoney(summary.paid, summary.currency);
  previewElements.amountDue.textContent = hasDebt ? formatMoney(summary.debt, summary.currency) : "Bez duga";
  if (previewElements.debtRow) {
    previewElements.debtRow.classList.toggle("has-debt", hasDebt);
    previewElements.debtRow.classList.toggle("is-clear", !hasDebt);
  }
  if (previewElements.noteBadge) {
    previewElements.noteBadge.hidden = !inputs.note.value.trim();
  }
}

function patientName(patient) {
  return patient.fullName || `${patient.firstName || patient.first_name || ""} ${patient.lastName || patient.last_name || ""}`.trim();
}

function findPatientByName(name) {
  return patients.find(patient => patientName(patient).toLowerCase() === name.toLowerCase());
}

function selectedPatient() {
  if (patientIdParam) {
    return patients.find(patient => String(patient.id) === String(patientIdParam));
  }
  return findPatientByName(inputs.patient.value.trim());
}

function hasProcedureFallbackValue() {
  return Boolean(inputs.procedureActivity?.value || inputs.procedure?.value);
}

function updateGeneralTreatmentDraftActions() {
  if (!inputs.clearGeneralTreatmentDraft) return;
  inputs.clearGeneralTreatmentDraft.hidden = !hasProcedureFallbackValue();
}

function setProcedureFallbackVisible(isVisible) {
  const block = document.getElementById("procedure-fallback-block");
  const button = document.getElementById("toggle-procedure-fallback");
  if (!block || !button) return;
  block.hidden = !isVisible;
  button.setAttribute("aria-expanded", isVisible ? "true" : "false");
  button.textContent = isVisible ? "Sakrij opste postupke" : "Prikazi opste postupke";
}

function setupProcedureFallbackToggle() {
  const button = document.getElementById("toggle-procedure-fallback");
  if (!button) return;
  setProcedureFallbackVisible(hasProcedureFallbackValue());
  button.addEventListener("click", () => {
    const block = document.getElementById("procedure-fallback-block");
    setProcedureFallbackVisible(Boolean(block?.hidden));
  });
}

function patientDashboardUrl(patient, record) {
  const params = new URLSearchParams();
  if (patient?.id) {
    params.set("patientId", patient.id);
  } else {
    params.set("patient", inputs.patient.value.trim());
  }
  if (record?.id) {
    params.set("highlightRecord", record.id);
  } else if (inputs.lastVisit.value) {
    params.set("highlightVisit", inputs.lastVisit.value);
  }
  return `patient-dashboard.html?${params.toString()}`;
}

function lockPatientFromQuery() {
  if (!patientIdParam) return;
  const patient = selectedPatient();
  if (!patient) return;
  const name = patientName(patient);
  inputs.patient.value = patientName(patient);
  inputs.patient.readOnly = true;
  inputs.patient.classList.add("locked-patient-input");
  if (entryPatientContext) {
    entryPatientContext.hidden = false;
    entryPatientContext.innerHTML = `
      <div>
        <span>Pacijent</span>
        <strong>${escapeHtml(name)}</strong>
        <small>${escapeHtml([patient.phone, patient.email].filter(Boolean).join(" / ") || "Kontakt nije unet")}</small>
      </div>
      <a class="secondary-btn" href="patient-dashboard.html?patientId=${encodeURIComponent(patient.id)}">Karton</a>
    `;
  }
  closePatientSuggestions();
  updatePreview();
}

function findDoctorByName(name) {
  return doctors.find(doctor => doctor.name === name || doctor.name.toLowerCase().includes(name.toLowerCase()));
}

function normalizedPatientQuery(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function foldText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function closePatientSuggestions() {
  const list = document.getElementById("existing-patients");
  list?.classList.remove("open");
}

function renderPatientSuggestions(query = inputs.patient.value) {
  const list = document.getElementById("existing-patients");
  if (!list) return;

  const normalizedQuery = normalizedPatientQuery(query);
  const names = patients
    .map(patientName)
    .filter(Boolean)
    .filter(name => !normalizedQuery || normalizedPatientQuery(name).includes(normalizedQuery));

  list.innerHTML = names.length
    ? names.map(name => `
      <button class="patient-autocomplete-option" type="button" role="option" data-patient-name="${escapeAttribute(name)}">
        ${escapeHtml(name)}
      </button>
    `).join("")
    : `<div class="patient-autocomplete-empty">Nema pacijenata za prikaz.</div>`;
  list.classList.toggle("open", document.activeElement === inputs.patient);
}

function populatePatientList() {
  renderPatientSuggestions("");
}

function populateDoctors() {
  if (!doctors.length) return;
  inputs.doctor.innerHTML = doctors.map(doctor => `<option value="${escapeAttribute(doctor.name)}">${escapeHtml(doctor.name)}</option>`).join("");
}

function option(value, label = value) {
  return `<option value="${escapeAttribute(value)}">${escapeHtml(label)}</option>`;
}

function procedureOption(procedure) {
  const priceInfo = procedureCatalog.getPriceInfo?.(procedure) || {
    amount: procedureCatalog.getPrice(procedure),
    currency: procedureCatalog.getPriceCurrency?.(procedure) || "RSD"
  };
  return `<option value="${escapeAttribute(procedure)}" data-price="${Number(priceInfo.amount || 0)}" data-price-currency="${escapeAttribute(priceInfo.currency || "RSD")}">${escapeHtml(procedure)}</option>`;
}

function paymentCurrency() {
  return inputs.currency?.value || "RSD";
}

function convertToPaymentCurrency(amount, fromCurrency = "RSD") {
  return currencyUtils ? currencyUtils.convert(amount, fromCurrency, paymentCurrency()) : Number(amount || 0);
}

function pricePreviewLabel(amount, fromCurrency = "RSD") {
  return currencyUtils ? currencyUtils.conversionLabel(amount, fromCurrency, paymentCurrency()) : formatMoney(amount, fromCurrency);
}

function populateActivitySelect(select, placeholder = "Odaberi delatnost") {
  if (!select || !procedureCatalog) return;
  select.innerHTML = option("", placeholder) + procedureCatalog.getActivities().map(activity => option(activity)).join("");
}

function populateProcedureSelect(activitySelect, procedureSelect, placeholder = "Odaberi postupak") {
  if (!activitySelect || !procedureSelect || !procedureCatalog) return;
  const activity = activitySelect.value;
  const procedures = activity ? procedureCatalog.getProcedures(activity) : [];
  procedureSelect.innerHTML = option("", activity ? placeholder : "Prvo odaberi delatnost") + procedures.map(procedureOption).join("");
  procedureSelect.disabled = !activity;
}

function setSelectValue(select, value) {
  if (!select || !value) return;
  if (!select.options) {
    select.value = value;
    return;
  }
  if (!Array.from(select.options).some(item => item.value === value)) {
    select.appendChild(new Option(value, value));
  }
  select.value = value;
}

async function populateCodebookSelects() {
  if (!window.DrRosaApi?.getCodebooks) return;
  const mappings = [
    { type: "visit_status", select: inputs.status },
    { type: "payment_status", select: inputs.paymentStatus },
    { type: "currency", select: inputs.currency },
    { type: "shift", select: inputs.shift },
    { type: "payment_method" }
  ];

  await Promise.all(mappings.map(async ({ type, select }) => {
    try {
      const items = await window.DrRosaApi.getCodebooks(type);
      if (!items.length) return;
      if (type === "payment_method") {
        paymentMethodItems = items.map(item => ({ value: item.value, label: item.label || item.value }));
        return;
      }
      if (!select) return;
      if (type === "currency") {
        currencyUtils?.setCurrencies(items);
      }
      if (!select.options) {
        setSelectValue(select, select.value || items[0].value);
        if (type === "currency") {
          select.dataset.previousCurrency = select.value || "RSD";
        }
        return;
      }
      const current = select.value;
      select.innerHTML = items.map(item => {
        const metadata = item.metadata || {};
        const shiftTime = type === "shift" && metadata.timeFrom && metadata.timeTo ? ` (${metadata.timeFrom}-${metadata.timeTo})` : "";
        return option(item.value, `${item.label}${shiftTime}`);
      }).join("");
      setSelectValue(select, current || items[0].value);
      if (type === "currency") {
        select.dataset.previousCurrency = select.value || "RSD";
      }
    } catch (error) {
      console.error(`${type} codebook load error:`, error);
    }
  }));
}

function normalizeStoredTreatment(treatment, recordCurrency = "RSD") {
  const item = { ...treatment };
  const treatmentCurrency = item.currency || recordCurrency || "RSD";
  const catalogBasePrice = Number(procedureCatalog.getPrice(item.type) || 0);
  const catalogBaseCurrency = procedureCatalog.getPriceCurrency?.(item.type) || "RSD";
  const storedBasePrice = item.basePrice ?? item.base_price ?? item.basePriceEur ?? item.base_price_eur ?? catalogBasePrice;
  const storedBaseCurrency = item.basePriceCurrency ?? item.base_price_currency ?? (item.basePriceEur || item.base_price_eur ? "EUR" : catalogBaseCurrency);
  item.currency = treatmentCurrency;
  item.basePrice = Number(storedBasePrice || 0);
  item.basePriceCurrency = storedBaseCurrency || treatmentCurrency;
  if (!item.basePrice && Number(item.price || 0) > 0) {
    item.basePrice = Number(item.price || 0);
    item.basePriceCurrency = treatmentCurrency;
  }
  item.basePriceEur = currencyUtils
    ? currencyUtils.convert(item.basePrice, item.basePriceCurrency, "EUR")
    : item.basePriceCurrency === "EUR" ? item.basePrice : 0;
  return item;
}

function cloneTreatments(treatments, recordCurrency = "RSD") {
  const copy = JSON.parse(JSON.stringify(treatments || {}));
  Object.entries(copy).forEach(([tooth, toothTreatments]) => {
    const list = treatmentListForValue(toothTreatments).map(item => normalizeStoredTreatment(item, recordCurrency));
    copy[tooth] = Array.isArray(toothTreatments) ? list : list[0];
  });
  return copy;
}

function cloneGeneralTreatments(treatments, recordCurrency = "RSD") {
  return (Array.isArray(treatments) ? treatments : [])
    .map(item => normalizeStoredTreatment(item, recordCurrency))
    .filter(item => item.type);
}

function openRecordInForm(record) {
  if (!record) {
    showAlert("Poseta nije pronadjena. Vratite se na evidenciju i otvorite je ponovo.", "error", { persist: true, scroll: true });
    return;
  }
  inputs.patient.value = record.patient || "";
  setVisitDateValue(record.lastVisit || "");
  inputs.procedureActivity.value = record.procedureActivity || procedureCatalog.findActivityForProcedure(record.procedure);
  populateProcedureSelect(inputs.procedureActivity, inputs.procedure);
  setSelectValue(inputs.procedure, record.procedure || "");
  setSelectValue(inputs.doctor, record.doctor || "");
  setSelectValue(inputs.status, record.status || "");
  setSelectValue(inputs.paymentStatus, record.paymentStatus || "");
  inputs.amountDue.value = Number(record.amountDue || 0).toFixed(2);
  inputs.amountPaid.value = "";
  setSelectValue(inputs.currency, record.currency || "RSD");
  setSelectValue(inputs.shift, record.shift || "");
  inputs.note.value = record.note === "-" ? "" : (record.note || "");
  teethTreatments = cloneTreatments(record.treatments, record.currency || paymentCurrency());
  generalTreatments = cloneGeneralTreatments(record.generalTreatments, record.currency || paymentCurrency());
  const inferredTotal = Number(record.totalAmount || record.total_amount || 0) || Number(record.amountDue || 0) + Number(record.amountPaid || 0);
  inputs.totalAmount.value = inferredTotal > 0 ? inferredTotal.toFixed(2) : "";
  totalAmountTouched = inferredTotal > 0;
  updateTeethSummary();
  updateToothHighlights();
  renderGeneralTreatments();
  updateAmountDueLimit();
  paymentParts = (record.paymentParts || []).map(normalizedPaymentPart);
  if (!paymentParts.length && Number(record.amountPaid || 0) > 0) {
    paymentParts = [normalizedPaymentPart({ amount: record.amountPaid, currency: record.currency || paymentCurrency() })];
  }
  updatePaymentCalculation();
  updatePreview();
  showAlert("Pregled je otvoren sa postojećim podacima.");
}

const teethPanel = document.getElementById("tooth-treatment-panel");
const selectedToothSpan = document.getElementById("selected-tooth");
const closePanel = document.getElementById("close-panel");
const saveTreatmentBtn = document.getElementById("save-treatment");
const addTreatmentItemBtn = document.getElementById("add-treatment-item");
const treatmentActivity = document.getElementById("treatment-activity");
const treatmentType = document.getElementById("treatment-type");
const treatmentNote = document.getElementById("treatment-note");
const treatmentDiscount = document.getElementById("treatment-discount");
const treatmentDiscountType = document.getElementById("treatment-discount-type");
const treatmentPrice = document.getElementById("treatment-price");
const treatmentTotalPrice = document.getElementById("treatment-total-price");
const pendingTreatmentList = document.getElementById("pending-treatment-list");
const teethSummary = document.getElementById("teeth-summary");
const initialConditionSummary = document.getElementById("initial-condition-summary");
const showInitialConditionBtn = document.getElementById("show-initial-condition");
const toothNodes = document.querySelectorAll(".tooth-node");
let toothHistoryCollapsed = false;
let pendingTreatmentItems = [];

function formatMoney(amount, currency = paymentCurrency()) {
  return currencyUtils ? currencyUtils.formatMoney(amount, currency) : `${Number(amount || 0).toFixed(2)} ${currency}`;
}

function historyExchangeRate(part) {
  const currency = String(part.currency || "RSD").toUpperCase();
  const rate = Number(part.exchangeRateToRsd || part.exchange_rate_to_rsd || 0);
  if (currency === "RSD") return 1;
  return rate > 0 ? rate : 0;
}

function historyAmountRsd(part) {
  const amountRsd = Number(part.amountRsd || part.amount_rsd || 0);
  if (amountRsd > 0) return amountRsd;
  const amount = Number(part.amount || 0);
  const rate = historyExchangeRate(part);
  return rate > 0 ? amount * rate : 0;
}

function resetPatientPaymentHistory(patientId = selectedPatient()?.id || null) {
  patientPaymentHistory = {
    patientId: patientId ? String(patientId) : null,
    page: 1,
    limit: 5,
    cache: new Map(),
    hasMoreByPage: new Map(),
    loading: false,
    expanded: patientPaymentHistory.expanded
  };
}

function setPreviousPaymentsEmpty(message) {
  if (!inputs.previousPaymentsBody) return;
  inputs.previousPaymentsBody.innerHTML = `<tr><td colspan="9">${escapeHtml(message)}</td></tr>`;
}

function renderPreviousPaymentsControls() {
  if (inputs.previousPaymentsPage) inputs.previousPaymentsPage.textContent = `Strana ${patientPaymentHistory.page}`;
  if (inputs.previousPaymentsPrev) inputs.previousPaymentsPrev.disabled = patientPaymentHistory.page <= 1 || patientPaymentHistory.loading;
  if (inputs.previousPaymentsNext) {
    inputs.previousPaymentsNext.disabled = patientPaymentHistory.loading || !patientPaymentHistory.hasMoreByPage.get(patientPaymentHistory.page);
  }
}

function renderPreviousPaymentsPage(data) {
  if (!inputs.previousPaymentsBody) return;
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.length) {
    setPreviousPaymentsEmpty("Pacijent nema evidentirane prethodne uplate.");
    renderPreviousPaymentsControls();
    return;
  }
  const rows = [];
  items.forEach(item => {
    const payments = Array.isArray(item.payments) && item.payments.length
      ? item.payments
      : [{ amount: 0, currency: item.currency || "RSD", paymentMethod: "" }];
    payments.forEach((part, index) => {
      const currency = String(part.currency || item.currency || "RSD").toUpperCase();
      const amount = Number(part.amount || 0);
      const rate = historyExchangeRate(part);
      const hasDebt = Number(item.debt || 0) > 0.009;
      rows.push(`
        <tr class="${index === 0 ? "payment-history-visit-row" : "payment-history-part-row"}">
          <td>${index === 0 ? escapeHtml(formatDate(item.visitDate)) : ""}</td>
          <td>${escapeHtml(formatMoney(amount, currency))}</td>
          <td>${escapeHtml(currency)}</td>
          <td>${rate > 0 ? escapeHtml(rate.toFixed(2)) : "-"}</td>
          <td>${escapeHtml(formatMoney(historyAmountRsd(part), "RSD"))}</td>
          <td>${escapeHtml(part.paymentMethod || part.payment_method || "-")}</td>
          <td>${index === 0 ? escapeHtml(formatMoney(item.totalAmount || 0, item.currency || "RSD")) : ""}</td>
          <td>${index === 0 ? escapeHtml(formatMoney(item.debt || 0, item.currency || "RSD")) : ""}</td>
          <td>${index === 0 && hasDebt ? `<button type="button" class="secondary-btn previous-debt-payment-btn" data-record-id="${escapeAttribute(item.recordId)}">Dodaj uplatu</button>` : ""}</td>
        </tr>
      `);
    });
  });
  inputs.previousPaymentsBody.innerHTML = rows.join("");
  inputs.previousPaymentsBody.querySelectorAll(".previous-debt-payment-btn").forEach(button => {
    button.addEventListener("click", () => {
      const record = items.find(item => String(item.recordId) === String(button.dataset.recordId));
      if (record) openPreviousDebtPaymentForm(record);
    });
  });
  renderPreviousPaymentsControls();
}

function renderDebtPaymentFormOptions(record) {
  const currencySelect = inputs.previousDebtPaymentCurrency;
  const methodSelect = inputs.previousDebtPaymentMethod;
  if (currencySelect) {
    const currencies = availableCurrencyCodes();
    const selected = record?.currency || "RSD";
    currencySelect.innerHTML = currencies.map(currency => `<option value="${escapeAttribute(currency)}"${currency === selected ? " selected" : ""}>${escapeHtml(currency)}</option>`).join("");
  }
  if (methodSelect) {
    const methods = paymentMethodItems.length ? paymentMethodItems : [{ value: "Gotovina", label: "Gotovina" }];
    methodSelect.innerHTML = methods.map(method => `<option value="${escapeAttribute(method.value)}">${escapeHtml(method.label || method.value)}</option>`).join("");
  }
}

function openPreviousDebtPaymentForm(record) {
  selectedDebtPaymentRecord = record;
  renderDebtPaymentFormOptions(record);
  if (inputs.previousDebtRecordId) inputs.previousDebtRecordId.value = record.recordId || "";
  if (inputs.previousDebtPaymentAmount) inputs.previousDebtPaymentAmount.value = Number(record.debt || 0).toFixed(2);
  if (inputs.previousDebtPaymentDate) inputs.previousDebtPaymentDate.value = record.visitDate || todayInputDate();
  if (inputs.previousDebtPaymentContext) {
    inputs.previousDebtPaymentContext.textContent = `Poseta ${formatDate(record.visitDate)} - dug ${formatMoney(record.debt || 0, record.currency || "RSD")}`;
  }
  if (inputs.previousDebtPaymentPanel) {
    inputs.previousDebtPaymentPanel.hidden = false;
    inputs.previousDebtPaymentAmount?.focus();
  }
}

function closePreviousDebtPaymentForm() {
  selectedDebtPaymentRecord = null;
  if (inputs.previousDebtPaymentPanel) inputs.previousDebtPaymentPanel.hidden = true;
  inputs.previousDebtPaymentForm?.reset();
}

async function loadPreviousPaymentsPage(page = patientPaymentHistory.page, { prefetch = false } = {}) {
  const patient = selectedPatient();
  if (!patient?.id || !window.DrRosaApi.getPatientPaymentHistory) {
    if (!prefetch) {
      setPreviousPaymentsEmpty("Odaberite pacijenta za prikaz prethodnih uplata.");
      renderPreviousPaymentsControls();
    }
    return null;
  }
  const patientId = String(patient.id);
  if (patientPaymentHistory.patientId !== patientId) resetPatientPaymentHistory(patientId);
  if (patientPaymentHistory.cache.has(page)) {
    const cached = patientPaymentHistory.cache.get(page);
    if (!prefetch) {
      patientPaymentHistory.page = page;
      renderPreviousPaymentsPage(cached);
      loadPreviousPaymentsPage(page + 1, { prefetch: true });
    }
    return cached;
  }
  if (patientPaymentHistory.loading && !prefetch) return null;
  if (!prefetch) {
    patientPaymentHistory.loading = true;
    setPreviousPaymentsEmpty("Ucitavanje prethodnih uplata...");
    renderPreviousPaymentsControls();
  }
  try {
    const data = await window.DrRosaApi.getPatientPaymentHistory(patientId, { page, limit: patientPaymentHistory.limit });
    if (patientPaymentHistory.patientId !== patientId) return null;
    patientPaymentHistory.cache.set(page, data);
    patientPaymentHistory.hasMoreByPage.set(page, Boolean(data.hasMore));
    if (!prefetch) {
      patientPaymentHistory.page = page;
      renderPreviousPaymentsPage(data);
      if (data.hasMore) loadPreviousPaymentsPage(page + 1, { prefetch: true });
    }
    return data;
  } catch (error) {
    if (!prefetch) setPreviousPaymentsEmpty(error.message || "Prethodne uplate nisu ucitane.");
    return null;
  } finally {
    if (!prefetch) {
      patientPaymentHistory.loading = false;
      renderPreviousPaymentsControls();
    }
  }
}

function refreshPreviousPaymentsForPatient({ force = false } = {}) {
  const patient = selectedPatient();
  if (!patient?.id) {
    resetPatientPaymentHistory(null);
    setPreviousPaymentsEmpty("Odaberite pacijenta za prikaz prethodnih uplata.");
    renderPreviousPaymentsControls();
    return;
  }
  if (force || patientPaymentHistory.patientId !== String(patient.id)) {
    resetPatientPaymentHistory(patient.id);
  }
  loadPreviousPaymentsPage(1);
}

function todayInputDate() {
  return window.DrRosaDateUtils?.isoDateKey?.(new Date()) || new Date().toISOString().slice(0, 10);
}

function dateDisplayInputFor(input) {
  if (!input?.id) return null;
  return document.querySelector(`[data-drrosa-for="${input.id}"]`);
}

function syncDateDisplayInput(input) {
  const displayInput = dateDisplayInputFor(input);
  if (!displayInput) return;
  displayInput.value = input.value ? formatDate(input.value) : "";
  displayInput.setCustomValidity("");
  displayInput.setAttribute("aria-invalid", "false");
}

function setVisitDateValue(value) {
  if (!inputs.lastVisit) return;
  inputs.lastVisit.value = value || "";
  inputs.lastVisit.dispatchEvent(new Event("input", { bubbles: true }));
  inputs.lastVisit.dispatchEvent(new Event("change", { bubbles: true }));
  syncDateDisplayInput(inputs.lastVisit);
}

function setDefaultVisitDate() {
  if (!inputs.lastVisit || inputs.lastVisit.value) return;
  setVisitDateValue(todayInputDate());
}

function ensureVisitDateBeforeSubmit() {
  if (inputs.lastVisit?.value) {
    syncDateDisplayInput(inputs.lastVisit);
    return;
  }
  if (!recordParam) setDefaultVisitDate();
}

function hasStandaloneVisitNote() {
  return Boolean(inputs.note?.value.trim());
}

function availableCurrencyCodes() {
  const selectCodes = Array.from(inputs.currency?.options || []).map(option => option.value).filter(Boolean);
  const utilityCodes = currencyUtils?.currencyItems ? currencyUtils.currencyItems().map(item => item.value).filter(Boolean) : [];
  return Array.from(new Set([...selectCodes, ...utilityCodes, "EUR", "RSD", "USD"]));
}

function normalizedPaymentPart(part = {}) {
  return {
    amount: Math.max(0, Number(part.amount || 0)),
    currency: String(part.currency || paymentCurrency() || "RSD").toUpperCase(),
    paymentMethod: part.paymentMethod || part.payment_method || "Gotovina",
    paymentDate: part.paymentDate || part.payment_date || todayInputDate(),
    notes: part.notes || ""
  };
}

function paymentPartLabel(part) {
  const normalized = normalizedPaymentPart(part);
  return `${formatMoney(normalized.amount, normalized.currency)}${normalized.paymentMethod ? ` (${normalized.paymentMethod})` : ""}`;
}

function paymentPartAmountInVisitCurrency(part) {
  const normalized = normalizedPaymentPart(part);
  return currencyUtils
    ? currencyUtils.convert(normalized.amount, normalized.currency, paymentCurrency())
    : normalized.amount;
}

function remainingPaymentAmount({ excludeIndex = null } = {}) {
  const total = currentVisitTotal();
  const paid = paymentParts.reduce((sum, part, index) => {
    if (excludeIndex !== null && index === excludeIndex) return sum;
    return sum + Number(paymentPartAmountInVisitCurrency(part) || 0);
  }, 0);
  return Math.max(0, total - paid);
}

function paymentAmountForCurrency(amount, currency) {
  return currencyUtils
    ? currencyUtils.convert(amount, paymentCurrency(), currency)
    : Number(amount || 0);
}

function paymentRoundingTolerance() {
  return currencyUtils
    ? currencyUtils.convert(PAYMENT_ROUNDING_TOLERANCE_RSD, "RSD", paymentCurrency())
    : PAYMENT_ROUNDING_TOLERANCE_RSD;
}

function suggestedPaymentPart({ currency = paymentCurrency() } = {}) {
  const amount = paymentAmountForCurrency(remainingPaymentAmount(), currency);
  return normalizedPaymentPart({
    amount: amount > 0 ? amount.toFixed(2) : 0,
    currency,
    paymentMethod: "Gotovina",
    paymentDate: todayInputDate()
  });
}

function paymentSummary() {
  const total = currentVisitTotal();
  const currency = paymentCurrency();
  const paid = paymentParts.reduce((sum, part) => {
    return sum + Number(paymentPartAmountInVisitCurrency(part) || 0);
  }, 0);
  const clampedPaid = total > 0 ? Math.min(paid, total) : paid;
  const rawDebt = Math.max(0, total - clampedPaid);
  const debt = rawDebt <= paymentRoundingTolerance() ? 0 : rawDebt;
  const effectivePaid = debt <= 0 && total > 0 ? total : clampedPaid;
  const status = total > 0
    ? effectivePaid <= 0
      ? "Dugovanje"
      : debt <= 0
        ? "Placeno"
        : "Delimicno"
    : inputs.paymentStatus.value;
  return { total, paid: effectivePaid, rawPaid: paid, debt, status, currency };
}

function paymentPartFromRow(row) {
  const index = Number(row.dataset.paymentIndex);
  return normalizedPaymentPart({
    amount: row.querySelector(".payment-part-amount")?.value,
    currency: row.querySelector(".payment-part-currency")?.value,
    paymentMethod: row.querySelector(".payment-part-method")?.value,
    paymentDate: row.querySelector(".payment-part-date")?.value,
    notes: paymentParts[index]?.notes || ""
  });
}

function syncPaymentPartsFromDom() {
  if (!inputs.paymentPartsList) return;
  const rows = Array.from(inputs.paymentPartsList.querySelectorAll(".payment-part-row"));
  if (!rows.length) return;
  paymentParts = rows.map(paymentPartFromRow);
}

function renderPaymentParts() {
  if (!inputs.paymentPartsList) return;
  const currencies = availableCurrencyCodes();
  const methods = paymentMethodItems.length ? paymentMethodItems : [{ value: "Gotovina", label: "Gotovina" }];
  inputs.paymentPartsList.innerHTML = paymentParts.length ? paymentParts.map((part, index) => {
    const normalized = normalizedPaymentPart(part);
    const currencyOptions = currencies.map(currency => `<option value="${escapeHtml(currency)}"${currency === normalized.currency ? " selected" : ""}>${escapeHtml(currency)}</option>`).join("");
    const rowMethods = methods.some(method => method.value === normalized.paymentMethod)
      ? methods
      : [...methods, { value: normalized.paymentMethod, label: normalized.paymentMethod }];
    const methodOptions = rowMethods.map(method => `<option value="${escapeHtml(method.value)}"${method.value === normalized.paymentMethod ? " selected" : ""}>${escapeHtml(method.label)}</option>`).join("");
    return `
      <div class="payment-part-row" data-payment-index="${index}">
        <span class="payment-part-number">#${index + 1}</span>
        <label>
          Iznos
          <input class="payment-part-amount" type="number" min="0" step="0.01" value="${Number(normalized.amount || 0) || ""}" />
        </label>
        <label>
          Valuta
          <select class="payment-part-currency" data-previous-currency="${escapeHtml(normalized.currency)}">${currencyOptions}</select>
        </label>
        <label>
          Nacin
          <select class="payment-part-method">
            ${methodOptions}
          </select>
        </label>
        <label>
          Datum
          <input class="payment-part-date" type="date" value="${escapeHtml(normalized.paymentDate)}" />
        </label>
        <button class="danger-btn payment-part-remove" type="button" aria-label="Obrisi uplatu">×</button>
      </div>
    `;
  }).join("") : `<div class="payment-empty-state">Nema dodatih uplata. Dug ce biti jednak ukupnoj ceni.</div>`;

  inputs.paymentPartsList.querySelectorAll(".payment-part-row").forEach(row => {
    const index = Number(row.dataset.paymentIndex);
    const amountInput = row.querySelector(".payment-part-amount");
    const currencySelect = row.querySelector(".payment-part-currency");
    const methodSelect = row.querySelector(".payment-part-method");
    const dateInput = row.querySelector(".payment-part-date");
    const updatePart = () => {
      paymentParts[index] = paymentPartFromRow(row);
      updatePaymentCalculation({ render: false });
      updatePreview();
    };
    amountInput?.addEventListener("input", updatePart);
    currencySelect?.addEventListener("change", () => {
      const previousCurrency = currencySelect.dataset.previousCurrency || paymentParts[index]?.currency || paymentCurrency();
      const nextCurrency = currencySelect.value || paymentCurrency();
      const amount = Number(amountInput?.value || 0);
      if (previousCurrency !== nextCurrency && amountInput && amount > 0) {
        const converted = currencyUtils
          ? currencyUtils.convert(amount, previousCurrency, nextCurrency)
          : amount;
        amountInput.value = converted > 0 ? converted.toFixed(2) : "";
      }
      currencySelect.dataset.previousCurrency = nextCurrency;
      updatePart();
    });
    methodSelect?.addEventListener("change", updatePart);
    dateInput?.addEventListener("change", updatePart);
    row.querySelector(".payment-part-remove")?.addEventListener("click", () => {
      paymentParts.splice(index, 1);
      updatePaymentCalculation();
      updatePreview();
    });
  });
}

function selectedTeethList() {
  return Array.from(selectedTeeth).sort((a, b) => Number(a) - Number(b));
}

function selectedTreatmentPrice() {
  const priceInfo = selectedTreatmentPriceInfo();
  return convertToPaymentCurrency(priceInfo.amount, priceInfo.currency);
}

function selectedTreatmentPriceInfo() {
  return procedureCatalog.getPriceInfo?.(treatmentType.value) || {
    amount: Number(procedureCatalog.getPrice(treatmentType.value) || 0),
    currency: procedureCatalog.getPriceCurrency?.(treatmentType.value) || "RSD"
  };
}

function selectedTreatmentBasePrice() {
  return Number(selectedTreatmentPriceInfo().amount || 0);
}

function selectedTreatmentBaseCurrency() {
  return selectedTreatmentPriceInfo().currency || "RSD";
}

function normalizeDiscountType(type) {
  return type === "percent" ? "percent" : "amount";
}

function normalizeDiscountValue(value, type) {
  const amount = Math.max(0, Number(value || 0));
  return normalizeDiscountType(type) === "percent" ? Math.min(100, amount) : amount;
}

function calculateTreatmentDiscount(price, value, type) {
  const normalizedType = normalizeDiscountType(type);
  const normalizedValue = normalizeDiscountValue(value, normalizedType);
  const discount = normalizedType === "percent" ? Number(price || 0) * normalizedValue / 100 : normalizedValue;
  return Math.min(Number(price || 0), Math.max(0, discount));
}

function treatmentDiscountAmount(treatment) {
  return calculateTreatmentDiscount(
    Number(treatment?.price || 0),
    treatment?.discountValue ?? treatment?.discount_value ?? treatment?.discount ?? 0,
    treatment?.discountType || treatment?.discount_type || "amount"
  );
}

function treatmentDiscountLabel(treatment, currency = paymentCurrency()) {
  const discount = treatmentDiscountAmount(treatment);
  if (discount <= 0) return "";
  const type = normalizeDiscountType(treatment?.discountType || treatment?.discount_type);
  const value = normalizeDiscountValue(treatment?.discountValue ?? treatment?.discount_value ?? treatment?.discount ?? 0, type);
  return type === "percent"
    ? `${value.toFixed(2).replace(/\.00$/, "")}% (${formatMoney(discount, currency)})`
    : formatMoney(discount, currency);
}

function currentTreatmentDiscountSummary() {
  const groups = new Map();
  currentTreatmentEntries().forEach(({ treatment }) => {
    const discount = treatmentDiscountAmount(treatment);
    if (discount <= 0) return;
    const type = normalizeDiscountType(treatment?.discountType || treatment?.discount_type);
    const value = normalizeDiscountValue(treatment?.discountValue ?? treatment?.discount_value ?? treatment?.discount ?? 0, type);
    const key = `${type}:${value}`;
    const current = groups.get(key) || { type, value, discount: 0 };
    current.discount += discount;
    groups.set(key, current);
  });

  const labels = Array.from(groups.values()).map(item => item.type === "percent"
    ? `${item.value.toFixed(2).replace(/\.00$/, "")}% (${formatMoney(item.discount)})`
    : formatMoney(item.discount));
  return labels.length ? labels.join(", ") : formatMoney(0);
}

function treatmentListForTooth(tooth) {
  const treatments = teethTreatments[tooth];
  if (!treatments) return [];
  return Array.isArray(treatments) ? treatments : [treatments];
}

function hasToothTreatments() {
  return Object.values(teethTreatments).some(treatments => treatmentListForValue(treatments).length > 0);
}

function hasGeneralTreatments({ includeDraft = true } = {}) {
  return currentGeneralTreatmentEntries({ includeDraft }).length > 0;
}

function treatmentListForValue(treatments) {
  if (!treatments) return [];
  return Array.isArray(treatments) ? treatments : [treatments];
}

function currentTreatmentEntries() {
  return Object.entries(teethTreatments)
    .flatMap(([tooth, toothTreatments]) => treatmentListForValue(toothTreatments).map((treatment, index) => ({ tooth, treatment, index })));
}

function currentGeneralDraftTreatment() {
  return inputs.procedure?.value ? generalTreatmentFromCurrentInputs() : null;
}

function currentGeneralTreatmentEntries({ includeDraft = true } = {}) {
  const entries = generalTreatments.map((treatment, index) => ({ treatment, index, isDraft: false }));
  const draft = includeDraft ? currentGeneralDraftTreatment() : null;
  return draft ? [...entries, { treatment: draft, index: -1, isDraft: true }] : entries;
}

function currentTreatmentTotal() {
  return currentTreatmentEntries().reduce((total, item) => total + Number(item.treatment.price || 0), 0);
}

function currentTreatmentDiscountTotal() {
  return currentTreatmentEntries().reduce((total, item) => total + treatmentDiscountAmount(item.treatment), 0);
}

function currentGeneralTreatmentTotal({ includeDraft = true } = {}) {
  return currentGeneralTreatmentEntries({ includeDraft }).reduce((total, item) => total + Number(item.treatment.price || 0), 0);
}

function currentGeneralTreatmentDiscountTotal({ includeDraft = true } = {}) {
  return currentGeneralTreatmentEntries({ includeDraft }).reduce((total, item) => total + treatmentDiscountAmount(item.treatment), 0);
}

function currentToothFinalTotal() {
  return Math.max(0, currentTreatmentTotal() - currentTreatmentDiscountTotal());
}

function currentGeneralFinalTotal({ includeDraft = true } = {}) {
  return Math.max(0, currentGeneralTreatmentTotal({ includeDraft }) - currentGeneralTreatmentDiscountTotal({ includeDraft }));
}

function currentGrossTotal() {
  return currentTreatmentTotal() + currentGeneralTreatmentTotal();
}

function currentFinalTotal() {
  return Math.max(0, currentGrossTotal() - currentTreatmentDiscountTotal() - currentGeneralTreatmentDiscountTotal());
}

function currentSelectedProcedureTotal() {
  const basePrice = Math.max(0, Number(
    inputs.procedure.selectedOptions[0]?.dataset.price
    || procedureCatalog.getPrice(inputs.procedure.value)
    || 0
  ));
  const baseCurrency = inputs.procedure.selectedOptions[0]?.dataset.priceCurrency
    || procedureCatalog.getPriceCurrency?.(inputs.procedure.value)
    || "RSD";
  return convertToPaymentCurrency(basePrice, baseCurrency);
}

function currentAutoVisitTotal() {
  return currentToothFinalTotal() + currentGeneralFinalTotal();
}

function currentVisitTotal() {
  const manualTotal = Number(inputs.totalAmount?.value || 0);
  return totalAmountTouched && manualTotal > 0 ? manualTotal : currentAutoVisitTotal();
}

function syncTotalAmountFromSelection({ force = false } = {}) {
  if (!inputs.totalAmount) return;
  const autoTotal = currentAutoVisitTotal();
  if (force || !totalAmountTouched || Number(inputs.totalAmount.value || 0) === 0) {
    inputs.totalAmount.value = autoTotal > 0 ? autoTotal.toFixed(2) : "";
  }
}

function setPaymentStatusByBalance(status) {
  const target = foldText(status);
  const canonicalTarget = target.includes("pla")
    ? "placeno"
    : target.includes("delimi")
      ? "delimicno"
      : target.includes("dug")
        ? "dugovanje"
        : target;
  const canonical = value => {
    const folded = foldText(value);
    if (folded.includes("pla")) return "placeno";
    if (folded.includes("delimi")) return "delimicno";
    if (folded.includes("dug")) return "dugovanje";
    return folded;
  };
  const match = Array.from(inputs.paymentStatus.options).find(option =>
    canonical(option.value) === canonicalTarget || canonical(option.textContent) === canonicalTarget
  );
  if (!match && status) setSelectValue(inputs.paymentStatus, status);
  inputs.paymentStatus.value = match?.value || status;
  inputs.paymentStatus.dispatchEvent(new Event("drrosa-select-value"));
}

function legacySinglePaymentCalculation() {
  const total = currentVisitTotal();
  const paid = Math.max(0, Number(inputs.amountPaid.value || 0));
  const clampedPaid = total > 0 ? Math.min(paid, total) : paid;
  if (paid !== clampedPaid) inputs.amountPaid.value = clampedPaid.toFixed(2);
  inputs.amountPaid.max = total > 0 ? total.toFixed(2) : "";
  inputs.amountDue.value = Math.max(0, total - clampedPaid).toFixed(2);
  if (total > 0) {
    setPaymentStatusByBalance(clampedPaid <= 0
      ? "Dugovanje"
      : clampedPaid >= total
        ? "Placeno"
        : "Delimicno");
  }
}

function updateAmountDueLimit() {
  updatePaymentCalculation();
  const maxDue = currentVisitTotal();
  if (maxDue > 0) {
    inputs.amountDue.max = maxDue.toFixed(2);
    return;
  }

  inputs.amountDue.removeAttribute("max");
}

function updatePaymentCalculation({ render = true } = {}) {
  const summary = paymentSummary();
  inputs.amountPaid.value = summary.paid.toFixed(2);
  inputs.amountDue.value = summary.debt.toFixed(2);
  inputs.amountDue.max = summary.total > 0 ? summary.total.toFixed(2) : "";
  if (summary.total > 0) {
    setPaymentStatusByBalance(summary.status);
  }
  if (inputs.paymentTotalDisplay) inputs.paymentTotalDisplay.textContent = formatMoney(summary.total, summary.currency);
  if (inputs.paymentPaidDisplay) inputs.paymentPaidDisplay.textContent = formatMoney(summary.paid, summary.currency);
  if (inputs.paymentDebtDisplay) inputs.paymentDebtDisplay.textContent = formatMoney(summary.debt, summary.currency);
  if (inputs.paymentStatusDisplay) inputs.paymentStatusDisplay.textContent = inputs.paymentStatus.selectedOptions[0]?.textContent || summary.status;
  if (render) renderPaymentParts();
}

function currentTreatmentDescription() {
  const groups = currentTreatmentEntries().reduce((acc, item) => {
    if (!acc[item.treatment.type]) acc[item.treatment.type] = [];
    acc[item.treatment.type].push(item.tooth);
    return acc;
  }, {});

  return Object.entries(groups)
    .map(([type, teeth]) => `${type} zub ${teeth.sort((a, b) => Number(a) - Number(b)).join(", ")}`)
    .join("; ");
}

function updateTreatmentPricePreview() {
  const price = selectedTreatmentPrice();
  const basePrice = selectedTreatmentBasePrice();
  const baseCurrency = selectedTreatmentBaseCurrency();
  const discount = calculateTreatmentDiscount(price, treatmentDiscount.value, treatmentDiscountType.value);
  const selectedCount = Math.max(1, selectedTeeth.size);
  treatmentPrice.textContent = pricePreviewLabel(basePrice, baseCurrency);
  treatmentTotalPrice.textContent = formatMoney((price - discount) * selectedCount);
}

function currentGeneralTreatmentDescription({ includeDraft = true } = {}) {
  return currentGeneralTreatmentEntries({ includeDraft })
    .map(({ treatment }) => treatment.type)
    .filter(Boolean)
    .join(", ");
}

function currentCombinedTreatmentDescription({ includeDraft = true } = {}) {
  return [
    currentGeneralTreatmentDescription({ includeDraft }),
    currentTreatmentDescription()
  ].filter(Boolean).join("; ");
}

function generalTreatmentFromCurrentInputs() {
  const procedureValue = inputs.procedure.value.trim();
  const activityValue = inputs.procedureActivity.value.trim() || procedureCatalog.findActivityForProcedure(procedureValue);
  const basePrice = Math.max(0, Number(
    inputs.procedure.selectedOptions[0]?.dataset.price
    || procedureCatalog.getPrice(procedureValue)
    || 0
  ));
  const baseCurrency = inputs.procedure.selectedOptions[0]?.dataset.priceCurrency
    || procedureCatalog.getPriceCurrency?.(procedureValue)
    || "RSD";
  return {
    activity: activityValue,
    type: procedureValue,
    note: "",
    status: "Planirano",
    price: convertToPaymentCurrency(basePrice, baseCurrency),
    currency: paymentCurrency(),
    basePrice,
    basePriceCurrency: baseCurrency,
    basePriceEur: currencyUtils
      ? currencyUtils.convert(basePrice, baseCurrency, "EUR")
      : baseCurrency === "EUR" ? basePrice : 0,
    discount: 0,
    discountType: "amount",
    discountValue: 0
  };
}

function clearGeneralTreatmentInputs() {
  inputs.procedureActivity.value = "";
  populateProcedureSelect(inputs.procedureActivity, inputs.procedure);
  inputs.procedure.dispatchEvent(new Event("drrosa-select-value"));
  inputs.procedureActivity.dispatchEvent(new Event("drrosa-select-value"));
  updateGeneralTreatmentDraftActions();
}

function ensureDraftGeneralTreatmentAdded() {
  const draft = currentGeneralDraftTreatment();
  if (!draft) return false;
  generalTreatments.push(draft);
  clearGeneralTreatmentInputs();
  renderGeneralTreatments();
  return true;
}

function renderGeneralTreatments() {
  if (!inputs.generalTreatmentList) return;
  if (!generalTreatments.length) {
    inputs.generalTreatmentList.innerHTML = `<div class="general-treatment-empty">Nema dodatih opštih postupaka.</div>`;
    return;
  }

  inputs.generalTreatmentList.innerHTML = generalTreatments.map((treatment, index) => `
    <div class="general-treatment-item" data-general-treatment-index="${index}">
      <div>
        <strong>${escapeHtml(treatment.type)}</strong>
        ${treatment.activity ? `<span>${escapeHtml(treatment.activity)}</span>` : ""}
      </div>
      <div class="general-treatment-price">${formatMoney(treatmentNetPrice(treatment), treatment.currency || paymentCurrency())}</div>
      <button type="button" class="danger-btn general-treatment-remove" aria-label="Obriši opšti postupak">x</button>
    </div>
  `).join("");

  inputs.generalTreatmentList.querySelectorAll(".general-treatment-remove").forEach(button => {
    button.addEventListener("click", () => {
      const row = button.closest("[data-general-treatment-index]");
      const index = Number(row?.dataset.generalTreatmentIndex);
      if (Number.isInteger(index)) generalTreatments.splice(index, 1);
      syncTotalAmountFromSelection({ force: !totalAmountTouched });
      renderGeneralTreatments();
      updatePaymentCalculation();
      updatePreview();
    });
  });
}

function treatmentNetPrice(treatment) {
  return Math.max(0, Number(treatment.price || 0) - treatmentDiscountAmount(treatment));
}

function pendingTreatmentTotal() {
  const selectedCount = Math.max(1, selectedTeeth.size);
  return pendingTreatmentItems.reduce((total, treatment) => total + treatmentNetPrice(treatment) * selectedCount, 0);
}

function treatmentFromCurrentInputs() {
  const basePrice = selectedTreatmentBasePrice();
  const basePriceCurrency = selectedTreatmentBaseCurrency();
  const price = convertToPaymentCurrency(basePrice, basePriceCurrency);
  const discountType = normalizeDiscountType(treatmentDiscountType.value);
  const discountValue = normalizeDiscountValue(treatmentDiscount.value, discountType);
  const discount = calculateTreatmentDiscount(price, discountValue, discountType);
  return {
    activity: treatmentActivity.value,
    type: treatmentType.value,
    note: treatmentNote.value,
    price,
    basePrice,
    basePriceCurrency,
    basePriceEur: currencyUtils ? currencyUtils.convert(basePrice, basePriceCurrency, "EUR") : basePriceCurrency === "EUR" ? basePrice : 0,
    currency: paymentCurrency(),
    discount,
    discountType,
    discountValue
  };
}

function clearTreatmentInputsAfterAdd() {
  treatmentNote.value = "";
  treatmentDiscount.value = "";
  treatmentDiscountType.value = "amount";
  updateTreatmentPricePreview();
}

function renderPendingTreatmentItems() {
  if (!pendingTreatmentList) return;
  const selectedCount = Math.max(1, selectedTeeth.size);
  if (!pendingTreatmentItems.length) {
    pendingTreatmentList.innerHTML = `<div class="pending-treatment-empty">Nema dodatih postupaka za izabrane zube.</div>`;
    return;
  }

  pendingTreatmentList.innerHTML = `
    <div class="pending-treatment-header">
      <span>Postupci za upis</span>
      <strong>${formatMoney(pendingTreatmentTotal())}</strong>
    </div>
    ${pendingTreatmentItems.map((treatment, index) => `
      <div class="pending-treatment-item" data-pending-treatment-index="${index}">
        <div>
          <strong>${escapeHtml(treatment.type)}</strong>
          <span>${escapeHtml(treatment.activity || "Bez delatnosti")}</span>
          ${treatment.note ? `<small>${escapeHtml(treatment.note)}</small>` : ""}
        </div>
        <div class="pending-treatment-price">
          <span>${formatMoney(treatmentNetPrice(treatment), treatment.currency || paymentCurrency())} x ${selectedCount}</span>
          <strong>${formatMoney(treatmentNetPrice(treatment) * selectedCount, treatment.currency || paymentCurrency())}</strong>
        </div>
        <button class="danger-btn pending-treatment-remove" type="button" aria-label="Ukloni postupak">x</button>
      </div>
    `).join("")}
  `;
  pendingTreatmentList.querySelectorAll(".pending-treatment-remove").forEach(button => {
    button.addEventListener("click", () => {
      const row = button.closest("[data-pending-treatment-index]");
      const index = Number(row?.dataset.pendingTreatmentIndex);
      if (!Number.isInteger(index)) return;
      pendingTreatmentItems.splice(index, 1);
      renderPendingTreatmentItems();
    });
  });
}

function resetPendingTreatmentBuilder() {
  pendingTreatmentItems = [];
  renderPendingTreatmentItems();
}

function updateDiscountCurrencyLabel() {
  const amountOption = treatmentDiscountType?.querySelector('option[value="amount"]');
  if (amountOption) amountOption.textContent = paymentCurrency();
}

function spreadToothMap() {
  toothNodes.forEach(toothNode => {
    const box = toothNode.getBBox();
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    const dx = (centerX - 380) * 0.30;
    const dy = (centerY - 280) * 0.06;
    toothNode.setAttribute("transform", `translate(${dx.toFixed(1)} ${dy.toFixed(1)})`);
  });
}

function refreshSelectedTeethPanel() {
  const teeth = selectedTeethList();
  selectedToothSpan.textContent = teeth.length ? teeth.join(", ") : "-";
  teethPanel.style.display = teeth.length ? "block" : "none";

  if (teeth.length === 1) {
    const current = treatmentListForTooth(teeth[0]).at(-1);
    treatmentActivity.value = current?.activity || procedureCatalog.findActivityForProcedure(current?.type) || treatmentActivity.value || "";
    populateProcedureSelect(treatmentActivity, treatmentType, "Odaberi tretman");
    treatmentType.value = current?.type || treatmentType.value || "";
    treatmentDiscountType.value = normalizeDiscountType(current?.discountType || current?.discount_type);
    treatmentDiscount.value = normalizeDiscountValue(current?.discountValue ?? current?.discount_value ?? current?.discount ?? "", treatmentDiscountType.value) || "";
    treatmentNote.value = current?.note || "";
  } else if (teeth.length > 1) {
    treatmentDiscount.value = "";
    treatmentDiscountType.value = "amount";
    treatmentNote.value = "";
  }

  updateTreatmentPricePreview();
  renderPendingTreatmentItems();
}

function toggleToothSelection(toothNode) {
  const tooth = toothNode.dataset.tooth;
  if (selectedTeeth.has(tooth)) {
    selectedTeeth.delete(tooth);
  } else {
    selectedTeeth.add(tooth);
  }
  refreshSelectedTeethPanel();
  updateToothHighlights();
}

function openToothPanel(toothNode) {
  const tooth = toothNode.dataset.tooth;
  if (!selectedTeeth.has(tooth)) selectedTeeth.add(tooth);
  refreshSelectedTeethPanel();
  teethPanel.style.display = "block";
}

toothNodes.forEach(toothNode => {
  toothNode.addEventListener("click", () => {
    toggleToothSelection(toothNode);
  });

  toothNode.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openToothPanel(toothNode);
    }
  });
});

closePanel.addEventListener("click", () => {
  teethPanel.style.display = "none";
  selectedTeeth.clear();
  resetPendingTreatmentBuilder();
  updateToothHighlights();
});

addTreatmentItemBtn?.addEventListener("click", () => {
  if (selectedTeeth.size === 0 || !treatmentActivity.value || !treatmentType.value) {
    alert("Odaberite zub, osnovnu delatnost i vrstu tretmana!");
    return;
  }

  pendingTreatmentItems.push(treatmentFromCurrentInputs());
  renderPendingTreatmentItems();
  clearTreatmentInputsAfterAdd();
});

saveTreatmentBtn.addEventListener("click", () => {
  if (selectedTeeth.size === 0) {
    alert("Odaberite bar jedan zub!");
    return;
  }

  if (!pendingTreatmentItems.length && treatmentActivity.value && treatmentType.value) {
    pendingTreatmentItems.push(treatmentFromCurrentInputs());
  }

  if (!pendingTreatmentItems.length) {
    alert("Dodajte bar jedan postupak pre čuvanja.");
    renderPendingTreatmentItems();
    return;
  }

  selectedTeethList().forEach(tooth => {
    if (!Array.isArray(teethTreatments[tooth])) teethTreatments[tooth] = treatmentListForTooth(tooth);
    pendingTreatmentItems.forEach(treatment => {
      teethTreatments[tooth].push({ ...treatment });
    });
  });

  teethPanel.style.display = "none";
  selectedTeeth.clear();
  resetPendingTreatmentBuilder();
  syncTotalAmountFromSelection({ force: !totalAmountTouched });
  updateTeethSummary();
  updateToothHighlights();
  updatePaymentCalculation();
  updatePreview();
});

treatmentActivity.addEventListener("change", () => {
  populateProcedureSelect(treatmentActivity, treatmentType, "Odaberi tretman");
  updateTreatmentPricePreview();
});
treatmentType.addEventListener("change", updateTreatmentPricePreview);
treatmentDiscount.addEventListener("input", updateTreatmentPricePreview);
treatmentDiscountType.addEventListener("change", updateTreatmentPricePreview);
inputs.currency.addEventListener("change", () => {
  const previousCurrency = inputs.currency.dataset.previousCurrency || "RSD";
  const nextCurrency = paymentCurrency();
  if (previousCurrency !== nextCurrency && Number(inputs.amountPaid.value || 0) > 0) {
    const convertedPaid = currencyUtils
      ? currencyUtils.convert(inputs.amountPaid.value, previousCurrency, nextCurrency)
      : Number(inputs.amountPaid.value || 0);
    inputs.amountPaid.value = convertedPaid.toFixed(2);
  }
  inputs.currency.dataset.previousCurrency = nextCurrency;
  updateDiscountCurrencyLabel();

  Object.values(teethTreatments).forEach(treatments => {
    treatmentListForValue(treatments).forEach(treatment => {
      const basePrice = Number(treatment.basePrice ?? treatment.base_price ?? treatment.basePriceEur ?? treatment.base_price_eur ?? 0);
      const baseCurrency = treatment.basePriceCurrency ?? treatment.base_price_currency ?? (treatment.basePriceEur || treatment.base_price_eur ? "EUR" : treatment.currency || previousCurrency);
      if (!basePrice) return;
      treatment.basePrice = basePrice;
      treatment.basePriceCurrency = baseCurrency;
      treatment.price = convertToPaymentCurrency(basePrice, baseCurrency);
      treatment.currency = paymentCurrency();
      treatment.discount = calculateTreatmentDiscount(
        treatment.price,
        treatment.discountValue ?? treatment.discount_value ?? treatment.discount ?? 0,
        treatment.discountType || treatment.discount_type || "amount"
      );
    });
  });
  generalTreatments.forEach(treatment => {
    const basePrice = Number(treatment.basePrice ?? treatment.base_price ?? treatment.basePriceEur ?? treatment.base_price_eur ?? 0);
    const baseCurrency = treatment.basePriceCurrency ?? treatment.base_price_currency ?? (treatment.basePriceEur || treatment.base_price_eur ? "EUR" : treatment.currency || previousCurrency);
    if (!basePrice) return;
    treatment.basePrice = basePrice;
    treatment.basePriceCurrency = baseCurrency;
    treatment.price = convertToPaymentCurrency(basePrice, baseCurrency);
    treatment.currency = paymentCurrency();
    treatment.discount = calculateTreatmentDiscount(
      treatment.price,
      treatment.discountValue ?? treatment.discount_value ?? treatment.discount ?? 0,
      treatment.discountType || treatment.discount_type || "amount"
    );
  });
  pendingTreatmentItems.forEach(treatment => {
    const basePrice = Number(treatment.basePrice ?? treatment.base_price ?? treatment.basePriceEur ?? treatment.base_price_eur ?? 0);
    const baseCurrency = treatment.basePriceCurrency ?? treatment.base_price_currency ?? (treatment.basePriceEur || treatment.base_price_eur ? "EUR" : treatment.currency || previousCurrency);
    if (!basePrice) return;
    treatment.basePrice = basePrice;
    treatment.basePriceCurrency = baseCurrency;
    treatment.price = convertToPaymentCurrency(basePrice, baseCurrency);
    treatment.currency = paymentCurrency();
    treatment.discount = calculateTreatmentDiscount(
      treatment.price,
      treatment.discountValue ?? treatment.discount_value ?? treatment.discount ?? 0,
      treatment.discountType || treatment.discount_type || "amount"
    );
  });
  updateTreatmentPricePreview();
  renderGeneralTreatments();
  renderPendingTreatmentItems();
  syncTotalAmountFromSelection({ force: !totalAmountTouched });
  updateTeethSummary();
  updatePaymentCalculation();
  updatePreview();
});
inputs.amountDue.addEventListener("input", () => {
  updateAmountDueLimit();
  updatePreview();
});

inputs.amountPaid.addEventListener("input", () => {
  updatePaymentCalculation();
  updatePreview();
});

inputs.amountPaid.closest("label")?.setAttribute("hidden", "");
inputs.paymentStatus.closest("label")?.setAttribute("hidden", "");

inputs.totalAmount?.addEventListener("input", () => {
  totalAmountTouched = true;
  updatePaymentCalculation();
  updatePreview();
});

inputs.addPaymentPart?.addEventListener("click", () => {
  syncPaymentPartsFromDom();
  paymentParts.push(suggestedPaymentPart({ currency: paymentCurrency() }));
  updatePaymentCalculation();
  updatePreview();
});

showInitialConditionBtn?.addEventListener("click", loadInitialConditionForCurrentPatient);

inputs.togglePreviousPayments?.addEventListener("click", () => {
  patientPaymentHistory.expanded = !patientPaymentHistory.expanded;
  if (inputs.previousPaymentsContent) inputs.previousPaymentsContent.hidden = !patientPaymentHistory.expanded;
  inputs.togglePreviousPayments.setAttribute("aria-expanded", patientPaymentHistory.expanded ? "true" : "false");
  inputs.togglePreviousPayments.textContent = patientPaymentHistory.expanded ? "Sakrij" : "Prikazi";
  if (patientPaymentHistory.expanded) refreshPreviousPaymentsForPatient();
});

inputs.previousPaymentsPrev?.addEventListener("click", () => {
  if (patientPaymentHistory.page <= 1) return;
  loadPreviousPaymentsPage(patientPaymentHistory.page - 1);
});

inputs.previousPaymentsNext?.addEventListener("click", () => {
  if (!patientPaymentHistory.hasMoreByPage.get(patientPaymentHistory.page)) return;
  loadPreviousPaymentsPage(patientPaymentHistory.page + 1);
});

inputs.cancelPreviousDebtPayment?.addEventListener("click", closePreviousDebtPaymentForm);

inputs.previousDebtPaymentForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const recordId = inputs.previousDebtRecordId?.value || selectedDebtPaymentRecord?.recordId;
  if (!recordId || !window.DrRosaApi.addRecordPaymentPart) return;
  const amount = Number(inputs.previousDebtPaymentAmount?.value || 0);
  if (amount <= 0) {
    showAlert("Unesite iznos uplate veći od 0.", "error", { persist: true, scroll: true });
    return;
  }
  const submitButton = document.querySelector("button[type='submit'][form='previous-debt-payment-form']")
    || inputs.previousDebtPaymentForm.querySelector("button[type='submit']");
  const oldText = submitButton?.textContent;
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Čuvanje...";
  }
  try {
    await window.DrRosaApi.addRecordPaymentPart(recordId, {
      amount,
      currency: inputs.previousDebtPaymentCurrency?.value || selectedDebtPaymentRecord?.currency || "RSD",
      paymentMethod: inputs.previousDebtPaymentMethod?.value || "Gotovina",
      paymentDate: inputs.previousDebtPaymentDate?.value || selectedDebtPaymentRecord?.visitDate || todayInputDate()
    });
    closePreviousDebtPaymentForm();
    patientPaymentHistory.cache.clear();
    patientPaymentHistory.hasMoreByPage.clear();
    await loadPreviousPaymentsPage(patientPaymentHistory.page);
    showAlert("Uplata je dodata na prethodnu posetu.", "success");
  } catch (error) {
    showAlert(error.message || "Uplata nije sačuvana.", "error", { persist: true, scroll: true });
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = oldText || "Sacuvaj uplatu";
    }
  }
});

inputs.procedureActivity.addEventListener("change", () => {
  populateProcedureSelect(inputs.procedureActivity, inputs.procedure);
  updateGeneralTreatmentDraftActions();
  syncTotalAmountFromSelection({ force: !totalAmountTouched });
  updatePaymentCalculation();
  updatePreview();
});

inputs.procedure.addEventListener("change", () => {
  if (!inputs.procedureActivity.value) {
    inputs.procedureActivity.value = procedureCatalog.findActivityForProcedure(inputs.procedure.value);
  }
  updateGeneralTreatmentDraftActions();
  syncTotalAmountFromSelection({ force: !totalAmountTouched });
  updatePaymentCalculation();
  updatePreview();
});

inputs.clearGeneralTreatmentDraft?.addEventListener("click", () => {
  clearGeneralTreatmentInputs();
  syncTotalAmountFromSelection({ force: !totalAmountTouched });
  updatePaymentCalculation();
  updatePreview();
});

inputs.addGeneralTreatment?.addEventListener("click", () => {
  if (!inputs.procedureActivity.value || !inputs.procedure.value) {
    showAlert("Odaberite osnovnu delatnost i opšti postupak koji želite da dodate.", "error", { persist: true, scroll: true });
    return;
  }
  generalTreatments.push(generalTreatmentFromCurrentInputs());
  clearGeneralTreatmentInputs();
  syncTotalAmountFromSelection({ force: !totalAmountTouched });
  renderGeneralTreatments();
  updatePaymentCalculation();
  updatePreview();
});

function updateTeethSummary() {
  const treatments = currentTreatmentEntries();
  const history = getPatientToothHistory(inputs.patient.value.trim());

  if (treatments.length === 0 && history.length === 0) {
    teethSummary.innerHTML = "";
    updateToothHighlights();
    return;
  }

  const currentDescription = currentTreatmentDescription();
  const currentHtml = treatments.length === 0 ? "" : `
    <h4>Odabrano za ovaj unos:</h4>
    <div class="treatment-total-card">
      <span>Rađeno</span>
      <strong>${escapeHtml(currentDescription)}</strong>
      <span>Osnovna cena</span>
      <strong>${formatMoney(currentTreatmentTotal())}</strong>
      <span>Popust po usluzi</span>
      <strong>${escapeHtml(currentTreatmentDiscountSummary())}</strong>
      <span>Za naplatu</span>
      <strong>${formatMoney(currentToothFinalTotal())}</strong>
    </div>
    ${treatments.map(({ tooth, treatment, index }) => `
    <div class="treatment-item">
      <div>
        <strong>Zub ${escapeHtml(tooth)}:</strong> ${escapeHtml(treatment.type)}
        <div style="margin-top: 6px; font-weight: 700;">${formatMoney(treatment.price, treatment.currency || paymentCurrency())}</div>
        ${treatmentDiscountAmount(treatment) > 0 ? `<div style="margin-top: 6px; color: #b45309;">Popust: ${escapeHtml(treatmentDiscountLabel(treatment, treatment.currency || paymentCurrency()))}</div>` : ""}
        ${treatment.note ? `<div style="margin-top: 6px;">${escapeHtml(treatment.note)}</div>` : ""}
      </div>
      <button type="button" class="danger-btn remove-treatment" data-tooth="${escapeHtml(tooth)}" data-index="${index}">x</button>
    </div>
  `).join("")}`;

  const historyTitle = treatments.length ? "Prethodna istorija:" : "Istorija rada po zubima:";
  const historyHtml = history.length === 0 ? "" : `
    <div class="treatment-history-header">
      <h4>${escapeHtml(historyTitle)}</h4>
      <button
        class="secondary-btn treatment-history-toggle"
        type="button"
        data-toggle-tooth-history
        aria-expanded="${toothHistoryCollapsed ? "false" : "true"}"
      >
        ${toothHistoryCollapsed ? "Prikazi" : "Sakrij"}
      </button>
    </div>
    <div class="treatment-history-content" ${toothHistoryCollapsed ? "hidden" : ""}>
      ${window.DrRosaTreatmentHistory.renderEntries(history, {
      formatMoney,
      formatDate
    })}
    </div>`;

  teethSummary.innerHTML = currentHtml + historyHtml;
  updateAmountDueLimit();

  document.querySelectorAll(".remove-treatment").forEach(btn => {
    btn.addEventListener("click", () => {
      const tooth = btn.dataset.tooth;
      const index = Number(btn.dataset.index);
      const treatments = treatmentListForTooth(tooth);
      treatments.splice(index, 1);
      if (treatments.length) {
        teethTreatments[tooth] = treatments;
      } else {
        delete teethTreatments[tooth];
      }
      syncTotalAmountFromSelection({ force: !totalAmountTouched });
      updateTeethSummary();
      updatePaymentCalculation();
      updatePreview();
    });
  });

  document.querySelector("[data-toggle-tooth-history]")?.addEventListener("click", () => {
    toothHistoryCollapsed = !toothHistoryCollapsed;
    updateTeethSummary();
  });

  updateToothHighlights();
}

function getPatientToothHistory(name) {
  if (!name) return [];
  const patient = selectedPatient();
  return window.DrRosaTreatmentHistory.entriesFromRecords(allRecords, {
    patientId: patient?.id,
    patientName: name,
    excludeRecordId: recordParam,
    procedureCatalog
  });
}

function updateToothHighlights() {
  const history = getPatientToothHistory(inputs.patient.value.trim());
  const highlightedTeeth = new Set([...Object.keys(teethTreatments), ...history.map(item => item.tooth)]);
  const initialConditionTeeth = new Set(initialConditionEntries.map(item => item.toothNumber));
  const isExtraction = treatment => String(treatment?.type || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes("vad");
  const isImplant = treatment => String(treatment?.type || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes("implant");
  const extractedTeeth = new Set(history.filter(isExtraction).map(item => item.tooth));
  const implantTeeth = new Set(history.filter(isImplant).map(item => item.tooth));

  toothNodes.forEach(tooth => {
    const toothNumber = tooth.dataset.tooth;
    const currentTreatments = treatmentListForTooth(toothNumber);
    tooth.classList.toggle("treated", highlightedTeeth.has(toothNumber));
    tooth.classList.toggle("initial-condition", initialConditionTeeth.has(toothNumber));
    tooth.classList.toggle("selected", selectedTeeth.has(toothNumber));
    tooth.classList.toggle("extracted", extractedTeeth.has(toothNumber) || currentTreatments.some(isExtraction));
    tooth.classList.toggle("implant", implantTeeth.has(toothNumber) || currentTreatments.some(isImplant));
  });
}

function renderInitialConditionSummary() {
  if (!initialConditionSummary) return;
  if (!initialConditionEntries.length) {
    initialConditionSummary.innerHTML = "";
    updateToothHighlights();
    return;
  }
  initialConditionSummary.innerHTML = `
    <h4>Zateceno stanje</h4>
    ${initialConditionEntries.map(entry => `
      <div class="condition-entry readonly">
        <div>
          <strong>Zub ${escapeHtml(entry.toothNumber)}</strong>
          ${entry.notes ? `<p>${escapeHtml(entry.notes)}</p>` : ""}
        </div>
      </div>
    `).join("")}
  `;
  updateToothHighlights();
}

async function loadInitialConditionForCurrentPatient() {
  const patientNameValue = inputs.patient.value.trim();
  const patient = selectedPatient();
  if (!patient) {
    showAlert("Prvo odaberite postojeceg pacijenta da bi se prikazalo zateceno stanje.", "error", { persist: true, scroll: true });
    return;
  }
  try {
    const entries = await window.DrRosaApi.getClinicalChart(patient.id);
    initialConditionEntries = window.DrRosaToothCondition.initialConditionsFromEntries(entries);
    renderInitialConditionSummary();
    showAlert(initialConditionEntries.length ? "Zateceno stanje je prikazano ispod mape zuba." : "Pacijent nema uneto zateceno stanje.", "info");
  } catch (error) {
    showAlert(error.message || "Zateceno stanje nije ucitano.", "error", { persist: true, scroll: true });
  }
}

inputs.patient.addEventListener("change", () => {
  initialConditionEntries = [];
  renderInitialConditionSummary();
  refreshPreviousPaymentsForPatient({ force: true });
  updateTeethSummary();
  updateToothHighlights();
  updatePreview();
});

inputs.patient.addEventListener("input", () => {
  if (inputs.patient.readOnly) return;
  inputs.patient.value = inputs.patient.value.replace(/\s+/g, " ");
  initialConditionEntries = [];
  renderInitialConditionSummary();
  resetPatientPaymentHistory(null);
  setPreviousPaymentsEmpty("Odaberite pacijenta za prikaz prethodnih uplata.");
  renderPreviousPaymentsControls();
  renderPatientSuggestions();
  updateTeethSummary();
  updateToothHighlights();
  updatePreview();
});

inputs.patient.addEventListener("focus", () => {
  if (inputs.patient.readOnly) return;
  renderPatientSuggestions();
});

inputs.patient.addEventListener("blur", () => {
  inputs.patient.value = inputs.patient.value.replace(/\s+/g, " ").trim();
  updatePreview();
  setTimeout(() => {
    if (!document.activeElement?.closest(".patient-autocomplete-field")) closePatientSuggestions();
  }, 120);
});

inputs.patient.addEventListener("keydown", event => {
  const list = document.getElementById("existing-patients");
  const options = Array.from(list?.querySelectorAll(".patient-autocomplete-option") || []);
  if (event.key === "Escape") {
    closePatientSuggestions();
    return;
  }
  if (event.key !== "ArrowDown" || !options.length) return;
  event.preventDefault();
  list.classList.add("open");
  options[0].focus();
});

document.getElementById("existing-patients")?.addEventListener("click", event => {
  const option = event.target.closest(".patient-autocomplete-option");
  if (!option) return;
  inputs.patient.value = option.dataset.patientName || option.textContent.trim();
  closePatientSuggestions();
  inputs.patient.dispatchEvent(new Event("input", { bubbles: true }));
  inputs.patient.dispatchEvent(new Event("change", { bubbles: true }));
});

document.getElementById("existing-patients")?.addEventListener("keydown", event => {
  const options = Array.from(event.currentTarget.querySelectorAll(".patient-autocomplete-option"));
  const index = options.indexOf(document.activeElement);
  if (event.key === "Escape") {
    closePatientSuggestions();
    inputs.patient.focus();
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    document.activeElement.click();
    inputs.patient.focus();
    return;
  }
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  event.preventDefault();
  const nextIndex = event.key === "ArrowDown"
    ? Math.min(options.length - 1, index + 1)
    : Math.max(0, index - 1);
  options[nextIndex]?.focus();
});

document.addEventListener("click", event => {
  if (!event.target.closest(".patient-autocomplete-field")) closePatientSuggestions();
});

submitButton?.addEventListener("click", ensureVisitDateBeforeSubmit);

form.addEventListener("input", updatePreview);
form.addEventListener("invalid", (event) => {
  const control = event.target;
  showAlert(`Proverite polje "${controlLabel(control)}": ${control.validationMessage}`, "error", { persist: true });
}, true);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!window.DrRosaForms?.validateRequiredTextFields(form, { messageTarget: alertBox })) return;

  const patientNameValue = inputs.patient.value.trim();
  ensureDraftGeneralTreatmentAdded();
  const procedureActivityValue = generalTreatments[0]?.activity || inputs.procedureActivity.value.trim() || "";
  const procedureForSave = currentCombinedTreatmentDescription({ includeDraft: false });
  const hasTreatments = hasToothTreatments();
  const hasGeneralSelection = hasGeneralTreatments({ includeDraft: false });
  const hasVisitNote = hasStandaloneVisitNote();
  updatePaymentCalculation({ render: false });
  const summary = paymentSummary();
  const amountDueValue = summary.debt;
  const amountPaidValue = summary.paid;
  if (!patientNameValue || !inputs.lastVisit.value || (!hasGeneralSelection && !hasTreatments && !hasVisitNote)) {
    showAlert("Ispunite pacijenta, datum i dodajte rad na mapi zuba, izaberite postupak bez mape zuba ili unesite napomenu.", "error", { persist: true, scroll: true });
    return;
  }

  if ((hasTreatments || hasGeneralSelection) && amountDueValue > summary.total) {
    inputs.amountDue.value = summary.total.toFixed(2);
    updatePreview();
    showAlert("Iznos duga ne može biti veći od ukupne cene svih radova.", "error", { persist: true, scroll: true });
    return;
  }
  if (summary.total <= 0 && summary.rawPaid > 0) {
    showAlert("Unesite ukupno za naplatu pre dodavanja uplata.", "error", { persist: true, scroll: true });
    inputs.totalAmount?.focus();
    return;
  }
  if (summary.rawPaid > currentVisitTotal() + 0.01) {
    updatePaymentCalculation();
    showAlert("Plaćeni iznos ne može biti veći od ukupne cene.", "error", { persist: true, scroll: true });
    return;
  }

  setSubmitting(true);
  showAlert("Čuvanje unosa...", "info", { persist: true });

  const hasBackendSession = Boolean(window.DrRosaApi.getSession?.());
  let patient = selectedPatient();
  const doctor = findDoctorByName(inputs.doctor.value);

  // If we're authenticated but patient isn't found locally, refresh patient list
  // from the backend once to avoid transient race conditions between test setup
  // and frontend fetch. If still not found, show an error.
  if (hasBackendSession && !patient) {
    try {
      patients = await window.DrRosaApi.getPatients();
      populatePatientList();
      patient = selectedPatient();
    } catch (e) {
      console.error('Error refreshing patients list:', e);
    }
  }

  if (hasBackendSession && !patient) {
    setSubmitting(false);
    showAlert("Pacijent mora postojati u bazi prije unosa zapisa.", "error", { persist: true, scroll: true });
    return;
  }

  if (hasBackendSession && !doctor) {
    setSubmitting(false);
    showAlert("Doktor nije pronadjen u bazi.", "error", { persist: true, scroll: true });
    return;
  }

  const newRecord = {
    patientId: patient?.id,
    doctorId: doctor?.id,
    patient: patientNameValue,
    lastVisit: inputs.lastVisit.value,
    procedureActivity: procedureActivityValue || (hasVisitNote ? "Napomena" : ""),
    procedure: procedureForSave || currentTreatmentDescription() || (hasVisitNote ? "Napomena" : "Rad po zubima"),
    doctor: inputs.doctor.value,
    status: inputs.status.value,
    paymentStatus: summary.status,
    totalAmount: summary.total,
    amountDue: amountDueValue,
    amountPaid: amountPaidValue,
    currency: inputs.currency.value,
    paymentParts: paymentParts.map(normalizedPaymentPart).filter(part => part.amount > 0),
    shift: inputs.shift.value,
    note: inputs.note.value.trim() || "-",
    generalTreatments,
    treatments: teethTreatments
  };

  try {
    if (recordParam) {
      await window.DrRosaApi.updateRecord(recordParam, newRecord);
      showAlert("Unos je azuriran. Otvaram karton pacijenta...", "success", { persist: true });
      setSubmitting(false);
      window.location.href = patientDashboardUrl(patient, { id: recordParam });
      return;
    }

    const savedRecord = await window.DrRosaApi.createRecord(newRecord);
    showAlert("Unos je spremljen. Otvaram karton pacijenta...", "success", { persist: true });
    window.location.href = patientDashboardUrl(patient, savedRecord);
    return;
  } catch (error) {
    setSubmitting(false);
    showAlert(error.message || "Unos nije sačuvan.", "error", { persist: true, scroll: true });
  }
});

(async function init() {
  setupEntryStepNavigation();
  setupProcedureFallbackToggle();
  if (!recordParam) setDefaultVisitDate();
  if (!await requireAccess()) return;
  try {
    await procedureCatalog.loadFromApi?.();
    await populateCodebookSelects();
    const [loadedPatients, loadedDoctors, loadedRecords] = await Promise.all([
      window.DrRosaApi.getPatients(),
      window.DrRosaApi.getDoctors(),
      window.DrRosaApi.getRecords()
    ]);
    patients = loadedPatients;
    doctors = loadedDoctors;
    allRecords = loadedRecords;
    lockPatientFromQuery();
    populatePatientList();
    populateDoctors();
    populateActivitySelect(inputs.procedureActivity);
    populateProcedureSelect(inputs.procedureActivity, inputs.procedure);
    updateGeneralTreatmentDraftActions();
    populateActivitySelect(treatmentActivity);
    populateProcedureSelect(treatmentActivity, treatmentType, "Odaberi tretman");
    refreshPreviousPaymentsForPatient({ force: true });
    if (recordParam) {
      const selectedRecord = window.DrRosaApi.getRecord
        ? await window.DrRosaApi.getRecord(recordParam)
        : allRecords.find(record => String(record.id) === String(recordParam));
      openRecordInForm(selectedRecord);
    } else {
      setDefaultVisitDate();
    }
  } catch (error) {
    console.error("Form setup error:", error);
  }
  updatePreview();
  updateTeethSummary();
  updateToothHighlights();
  renderGeneralTreatments();
  updatePaymentCalculation();
  spreadToothMap();
})();
