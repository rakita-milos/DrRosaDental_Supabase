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
const escapeHtml = window.DrRosaSecurity.escapeHtml;
const previewElements = {
  name: document.getElementById("preview-name"),
  visit: document.getElementById("preview-visit"),
  procedure: document.getElementById("preview-procedure"),
  status: document.getElementById("preview-status"),
  paymentStatus: document.getElementById("preview-payment-status"),
  amountPaid: document.getElementById("preview-amount-paid"),
  amountDue: document.getElementById("preview-amount-due"),
  currency: document.getElementById("preview-currency"),
  paymentParts: document.getElementById("preview-payment-parts"),
  shift: document.getElementById("preview-shift"),
  note: document.getElementById("preview-note")
};

const inputs = {
  patient: document.getElementById("patient-name"),
  lastVisit: document.getElementById("last-visit"),
  procedureActivity: document.getElementById("procedure-activity"),
  procedure: document.getElementById("procedure"),
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
  shift: document.getElementById("shift"),
  note: document.getElementById("note")
};

let patients = [];
let doctors = [];
let allRecords = [];
let teethTreatments = {};
let selectedTeeth = new Set();
let paymentParts = [];
let totalAmountTouched = false;
let alertTimeout;
const procedureCatalog = window.DrRosaProcedureCatalog;
const currencyUtils = window.DrRosaCurrencyUtils;

const urlParams = new URLSearchParams(window.location.search);
const patientParam = urlParams.get("patient");
const recordParam = urlParams.get("record");
if (patientParam) {
  inputs.patient.value = patientParam;
  const newPatientLink = document.getElementById("new-patient-link");
  if (newPatientLink) newPatientLink.style.display = "none";
}

function formatDate(rawDate) {
  if (!rawDate) return "-";
  return new Date(rawDate).toLocaleDateString("hr-HR", { year: "numeric", month: "2-digit", day: "2-digit" });
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

function updatePreview() {
  const procedureText = inputs.procedure.value.trim();
  const activityText = inputs.procedureActivity.value.trim();
  const summary = paymentSummary();
  previewElements.name.textContent = inputs.patient.value.trim() || "-";
  previewElements.visit.textContent = formatDate(inputs.lastVisit.value);
  previewElements.procedure.textContent = procedureText ? `${activityText ? `${activityText} / ` : ""}${procedureText}` : (hasToothTreatments() ? "Rad po zubima" : "-");
  previewElements.status.textContent = inputs.status.value;
  previewElements.paymentStatus.textContent = inputs.paymentStatus.value;
  previewElements.amountPaid.textContent = formatMoney(summary.paid, summary.currency);
  previewElements.amountDue.textContent = formatMoney(summary.debt, summary.currency);
  previewElements.currency.textContent = inputs.currency.value;
  if (previewElements.paymentParts) {
    previewElements.paymentParts.textContent = paymentParts.length ? paymentParts.map(paymentPartLabel).join(" / ") : "-";
  }
  previewElements.shift.textContent = inputs.shift.value;
  previewElements.note.textContent = inputs.note.value.trim() || "-";
}

function patientName(patient) {
  return patient.fullName || `${patient.firstName || patient.first_name || ""} ${patient.lastName || patient.last_name || ""}`.trim();
}

function findPatientByName(name) {
  return patients.find(patient => patientName(patient).toLowerCase() === name.toLowerCase());
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
      <button class="patient-autocomplete-option" type="button" role="option" data-patient-name="${escapeHtml(name)}">
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
  inputs.doctor.innerHTML = doctors.map(doctor => `<option value="${escapeHtml(doctor.name)}">${escapeHtml(doctor.name)}</option>`).join("");
}

function option(value, label = value) {
  return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
}

function procedureOption(procedure) {
  return `<option value="${escapeHtml(procedure)}" data-price="${Number(procedureCatalog.getPrice(procedure) || 0)}">${escapeHtml(procedure)}</option>`;
}

function paymentCurrency() {
  return inputs.currency?.value || "EUR";
}

function convertFromEur(amount) {
  return currencyUtils ? currencyUtils.convert(amount, "EUR", paymentCurrency()) : Number(amount || 0);
}

function pricePreviewLabel(amountEur) {
  return currencyUtils ? currencyUtils.conversionLabel(amountEur, "EUR", paymentCurrency()) : formatMoney(amountEur);
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
    { type: "shift", select: inputs.shift }
  ];

  await Promise.all(mappings.map(async ({ type, select }) => {
    if (!select) return;
    try {
      const items = await window.DrRosaApi.getCodebooks(type);
      if (!items.length) return;
      if (type === "currency") {
        currencyUtils?.setCurrencies(items);
      }
      const current = select.value;
      select.innerHTML = items.map(item => {
        const metadata = item.metadata || {};
        const shiftTime = type === "shift" && metadata.timeFrom && metadata.timeTo ? ` (${metadata.timeFrom}-${metadata.timeTo})` : "";
        return option(item.value, `${item.label}${shiftTime}`);
      }).join("");
      setSelectValue(select, current || items[0].value);
      if (type === "currency") {
        select.dataset.previousCurrency = select.value || "EUR";
      }
    } catch (error) {
      console.error(`${type} codebook load error:`, error);
    }
  }));
}

function normalizeStoredTreatment(treatment, recordCurrency = "EUR") {
  const item = { ...treatment };
  const treatmentCurrency = item.currency || recordCurrency || "EUR";
  const catalogBasePrice = Number(procedureCatalog.getPrice(item.type) || 0);
  const storedBasePrice = item.basePriceEur ?? item.base_price_eur ?? catalogBasePrice;
  item.currency = treatmentCurrency;
  item.basePriceEur = Number(storedBasePrice || 0);
  if (!item.basePriceEur && Number(item.price || 0) > 0) {
    item.basePriceEur = currencyUtils
      ? currencyUtils.convert(item.price, treatmentCurrency, "EUR")
      : Number(item.price || 0);
  }
  return item;
}

function cloneTreatments(treatments, recordCurrency = "EUR") {
  const copy = JSON.parse(JSON.stringify(treatments || {}));
  Object.entries(copy).forEach(([tooth, toothTreatments]) => {
    const list = treatmentListForValue(toothTreatments).map(item => normalizeStoredTreatment(item, recordCurrency));
    copy[tooth] = Array.isArray(toothTreatments) ? list : list[0];
  });
  return copy;
}

function openRecordInForm(record) {
  if (!record) return;
  inputs.patient.value = record.patient || "";
  inputs.lastVisit.value = record.lastVisit || "";
  inputs.procedureActivity.value = record.procedureActivity || procedureCatalog.findActivityForProcedure(record.procedure);
  populateProcedureSelect(inputs.procedureActivity, inputs.procedure);
  setSelectValue(inputs.procedure, record.procedure || "");
  setSelectValue(inputs.doctor, record.doctor || "");
  setSelectValue(inputs.status, record.status || "");
  setSelectValue(inputs.paymentStatus, record.paymentStatus || "");
  inputs.amountDue.value = Number(record.amountDue || 0).toFixed(2);
  inputs.amountPaid.value = "";
  setSelectValue(inputs.currency, record.currency || "EUR");
  setSelectValue(inputs.shift, record.shift || "");
  inputs.note.value = record.note === "-" ? "" : (record.note || "");
  teethTreatments = cloneTreatments(record.treatments, record.currency || paymentCurrency());
  const inferredTotal = Number(record.amountDue || 0) + Number(record.amountPaid || 0);
  inputs.totalAmount.value = inferredTotal > 0 ? inferredTotal.toFixed(2) : "";
  totalAmountTouched = inferredTotal > 0;
  updateTeethSummary();
  updateToothHighlights();
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
const treatmentActivity = document.getElementById("treatment-activity");
const treatmentType = document.getElementById("treatment-type");
const treatmentNote = document.getElementById("treatment-note");
const treatmentDiscount = document.getElementById("treatment-discount");
const treatmentDiscountType = document.getElementById("treatment-discount-type");
const treatmentPrice = document.getElementById("treatment-price");
const treatmentTotalPrice = document.getElementById("treatment-total-price");
const teethSummary = document.getElementById("teeth-summary");
const toothNodes = document.querySelectorAll(".tooth-node");
let toothHistoryCollapsed = false;

function formatMoney(amount, currency = paymentCurrency()) {
  return currencyUtils ? currencyUtils.formatMoney(amount, currency) : `${Number(amount || 0).toFixed(2)} ${currency}`;
}

function todayInputDate() {
  return new Date().toISOString().slice(0, 10);
}

function availableCurrencyCodes() {
  const selectCodes = Array.from(inputs.currency?.options || []).map(option => option.value).filter(Boolean);
  const utilityCodes = currencyUtils?.currencyItems ? currencyUtils.currencyItems().map(item => item.value).filter(Boolean) : [];
  return Array.from(new Set([...selectCodes, ...utilityCodes, "EUR", "RSD", "USD"]));
}

function normalizedPaymentPart(part = {}) {
  return {
    amount: Math.max(0, Number(part.amount || 0)),
    currency: String(part.currency || paymentCurrency() || "EUR").toUpperCase(),
    paymentMethod: part.paymentMethod || part.payment_method || "Gotovina",
    paymentDate: part.paymentDate || part.payment_date || todayInputDate(),
    notes: part.notes || ""
  };
}

function paymentPartLabel(part) {
  const normalized = normalizedPaymentPart(part);
  return `${formatMoney(normalized.amount, normalized.currency)}${normalized.paymentMethod ? ` (${normalized.paymentMethod})` : ""}`;
}

function paymentSummary() {
  const total = currentVisitTotal();
  const currency = paymentCurrency();
  const paid = paymentParts.reduce((sum, part) => {
    const normalized = normalizedPaymentPart(part);
    const converted = currencyUtils
      ? currencyUtils.convert(normalized.amount, normalized.currency, currency)
      : normalized.amount;
    return sum + Number(converted || 0);
  }, 0);
  const clampedPaid = total > 0 ? Math.min(paid, total) : paid;
  const debt = Math.max(0, total - clampedPaid);
  const status = total > 0
    ? clampedPaid <= 0
      ? "Dugovanje"
      : clampedPaid + 0.01 >= total
        ? "Placeno"
        : "Delimicno"
    : inputs.paymentStatus.value;
  return { total, paid: clampedPaid, rawPaid: paid, debt, status, currency };
}

function renderPaymentParts() {
  if (!inputs.paymentPartsList) return;
  const currencies = availableCurrencyCodes();
  inputs.paymentPartsList.innerHTML = paymentParts.length ? paymentParts.map((part, index) => {
    const normalized = normalizedPaymentPart(part);
    const currencyOptions = currencies.map(currency => `<option value="${escapeHtml(currency)}"${currency === normalized.currency ? " selected" : ""}>${escapeHtml(currency)}</option>`).join("");
    return `
      <div class="payment-part-row" data-payment-index="${index}">
        <label>
          Iznos
          <input class="payment-part-amount" type="number" min="0" step="0.01" value="${Number(normalized.amount || 0) || ""}" />
        </label>
        <label>
          Valuta
          <select class="payment-part-currency">${currencyOptions}</select>
        </label>
        <label>
          Nacin
          <select class="payment-part-method">
            ${["Gotovina", "Kartica", "Transfer", "Avans"].map(method => `<option value="${escapeHtml(method)}"${method === normalized.paymentMethod ? " selected" : ""}>${escapeHtml(method)}</option>`).join("")}
          </select>
        </label>
        <label>
          Datum
          <input class="payment-part-date" type="date" value="${escapeHtml(normalized.paymentDate)}" />
        </label>
        <label class="payment-part-notes">
          Napomena
          <input class="payment-part-note" type="text" maxlength="1000" value="${escapeHtml(normalized.notes)}" />
        </label>
        <button class="danger-btn payment-part-remove" type="button" aria-label="Obrisi uplatu">x</button>
      </div>
    `;
  }).join("") : `<div class="payment-empty-state">Nema dodatih uplata. Dug ce biti jednak ukupnoj ceni.</div>`;

  inputs.paymentPartsList.querySelectorAll(".payment-part-row").forEach(row => {
    const index = Number(row.dataset.paymentIndex);
    const updatePart = () => {
      paymentParts[index] = normalizedPaymentPart({
        amount: row.querySelector(".payment-part-amount")?.value,
        currency: row.querySelector(".payment-part-currency")?.value,
        paymentMethod: row.querySelector(".payment-part-method")?.value,
        paymentDate: row.querySelector(".payment-part-date")?.value,
        notes: row.querySelector(".payment-part-note")?.value
      });
      updatePaymentCalculation({ render: false });
      updatePreview();
    };
    row.querySelectorAll("input, select").forEach(input => input.addEventListener("input", updatePart));
    row.querySelectorAll("select, input[type='date']").forEach(input => input.addEventListener("change", updatePart));
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
  return convertFromEur(selectedTreatmentBasePrice());
}

function selectedTreatmentBasePrice() {
  return Number(procedureCatalog.getPrice(treatmentType.value) || 0);
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

function treatmentListForValue(treatments) {
  if (!treatments) return [];
  return Array.isArray(treatments) ? treatments : [treatments];
}

function currentTreatmentEntries() {
  return Object.entries(teethTreatments)
    .flatMap(([tooth, toothTreatments]) => treatmentListForValue(toothTreatments).map((treatment, index) => ({ tooth, treatment, index })));
}

function currentTreatmentTotal() {
  return currentTreatmentEntries().reduce((total, item) => total + Number(item.treatment.price || 0), 0);
}

function currentTreatmentDiscountTotal() {
  return currentTreatmentEntries().reduce((total, item) => total + treatmentDiscountAmount(item.treatment), 0);
}

function currentGrossTotal() {
  return currentTreatmentTotal();
}

function currentFinalTotal() {
  return Math.max(0, currentGrossTotal() - currentTreatmentDiscountTotal());
}

function currentSelectedProcedureTotal() {
  const basePrice = Math.max(0, Number(
    inputs.procedure.selectedOptions[0]?.dataset.price
    || procedureCatalog.getPrice(inputs.procedure.value)
    || 0
  ));
  return convertFromEur(basePrice);
}

function currentAutoVisitTotal() {
  return hasToothTreatments() ? currentFinalTotal() : currentSelectedProcedureTotal();
}

function currentVisitTotal() {
  const manualTotal = Number(inputs.totalAmount?.value || 0);
  return manualTotal > 0 ? manualTotal : currentAutoVisitTotal();
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
  const discount = calculateTreatmentDiscount(price, treatmentDiscount.value, treatmentDiscountType.value);
  const selectedCount = Math.max(1, selectedTeeth.size);
  treatmentPrice.textContent = pricePreviewLabel(basePrice);
  treatmentTotalPrice.textContent = formatMoney((price - discount) * selectedCount);
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
  updateToothHighlights();
});

saveTreatmentBtn.addEventListener("click", () => {
  if (selectedTeeth.size === 0 || !treatmentActivity.value || !treatmentType.value) {
    alert("Odaberite zub, osnovnu delatnost i vrstu tretmana!");
    return;
  }

  selectedTeethList().forEach(tooth => {
    const basePriceEur = selectedTreatmentBasePrice();
    const price = convertFromEur(basePriceEur);
    const discountType = normalizeDiscountType(treatmentDiscountType.value);
    const discountValue = normalizeDiscountValue(treatmentDiscount.value, discountType);
    const discount = calculateTreatmentDiscount(price, discountValue, discountType);
    if (!Array.isArray(teethTreatments[tooth])) teethTreatments[tooth] = treatmentListForTooth(tooth);
    teethTreatments[tooth].push({
      activity: treatmentActivity.value,
      type: treatmentType.value,
      note: treatmentNote.value,
      price,
      basePriceEur,
      currency: paymentCurrency(),
      discount,
      discountType,
      discountValue
    });
  });

  teethPanel.style.display = "none";
  selectedTeeth.clear();
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
  const previousCurrency = inputs.currency.dataset.previousCurrency || "EUR";
  const nextCurrency = paymentCurrency();
  if (previousCurrency !== nextCurrency && Number(inputs.amountPaid.value || 0) > 0) {
    const convertedPaid = currencyUtils
      ? currencyUtils.convert(inputs.amountPaid.value, previousCurrency, nextCurrency)
      : Number(inputs.amountPaid.value || 0);
    inputs.amountPaid.value = convertedPaid.toFixed(2);
  }
  inputs.currency.dataset.previousCurrency = nextCurrency;

  Object.values(teethTreatments).forEach(treatments => {
    treatmentListForValue(treatments).forEach(treatment => {
      if (!Number(treatment.basePriceEur || 0)) return;
      treatment.price = convertFromEur(treatment.basePriceEur);
      treatment.currency = paymentCurrency();
      treatment.discount = calculateTreatmentDiscount(
        treatment.price,
        treatment.discountValue ?? treatment.discount_value ?? treatment.discount ?? 0,
        treatment.discountType || treatment.discount_type || "amount"
      );
    });
  });
  updateTreatmentPricePreview();
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

inputs.totalAmount?.addEventListener("input", () => {
  totalAmountTouched = true;
  updatePaymentCalculation();
  updatePreview();
});

inputs.addPaymentPart?.addEventListener("click", () => {
  paymentParts.push(normalizedPaymentPart({ currency: paymentCurrency() }));
  updatePaymentCalculation();
  updatePreview();
});

inputs.procedureActivity.addEventListener("change", () => {
  populateProcedureSelect(inputs.procedureActivity, inputs.procedure);
  syncTotalAmountFromSelection({ force: !totalAmountTouched });
  updatePaymentCalculation();
  updatePreview();
});

inputs.procedure.addEventListener("change", () => {
  if (!inputs.procedureActivity.value) {
    inputs.procedureActivity.value = procedureCatalog.findActivityForProcedure(inputs.procedure.value);
  }
  syncTotalAmountFromSelection({ force: !totalAmountTouched });
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
      <strong>${formatMoney(currentGrossTotal())}</strong>
      <span>Popust po usluzi</span>
      <strong>${escapeHtml(currentTreatmentDiscountSummary())}</strong>
      <span>Za naplatu</span>
      <strong>${formatMoney(currentFinalTotal())}</strong>
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
  const patient = findPatientByName(name);
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
  const isExtraction = treatment => String(treatment?.type || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes("vad");
  const isImplant = treatment => String(treatment?.type || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes("implant");
  const extractedTeeth = new Set(history.filter(isExtraction).map(item => item.tooth));
  const implantTeeth = new Set(history.filter(isImplant).map(item => item.tooth));

  toothNodes.forEach(tooth => {
    const toothNumber = tooth.dataset.tooth;
    const currentTreatments = treatmentListForTooth(toothNumber);
    tooth.classList.toggle("treated", highlightedTeeth.has(toothNumber));
    tooth.classList.toggle("selected", selectedTeeth.has(toothNumber));
    tooth.classList.toggle("extracted", extractedTeeth.has(toothNumber) || currentTreatments.some(isExtraction));
    tooth.classList.toggle("implant", implantTeeth.has(toothNumber) || currentTreatments.some(isImplant));
  });
}

inputs.patient.addEventListener("change", () => {
  updateTeethSummary();
  updateToothHighlights();
});

inputs.patient.addEventListener("input", () => {
  inputs.patient.value = inputs.patient.value.replace(/\s+/g, " ");
  renderPatientSuggestions();
  updateTeethSummary();
  updateToothHighlights();
});

inputs.patient.addEventListener("focus", () => {
  renderPatientSuggestions();
});

inputs.patient.addEventListener("blur", () => {
  inputs.patient.value = inputs.patient.value.replace(/\s+/g, " ").trim();
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

form.addEventListener("input", updatePreview);
form.addEventListener("invalid", (event) => {
  const control = event.target;
  showAlert(`Proverite polje "${controlLabel(control)}": ${control.validationMessage}`, "error", { persist: true });
}, true);

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const patientNameValue = inputs.patient.value.trim();
  const procedureValue = inputs.procedure.value.trim();
  const procedureActivityValue = inputs.procedureActivity.value.trim() || procedureCatalog.findActivityForProcedure(procedureValue);
  const hasProcedureSelection = Boolean(procedureValue);
  const procedureForSave = procedureValue || currentTreatmentDescription() || "Rad po zubima";
  const hasTreatments = hasToothTreatments();
  const finalTotal = currentFinalTotal();
  updatePaymentCalculation({ render: false });
  const summary = paymentSummary();
  const amountDueValue = summary.debt;
  const amountPaidValue = summary.paid;
  if (!patientNameValue || !inputs.lastVisit.value || (!hasProcedureSelection && !hasTreatments)) {
    showAlert("Ispunite pacijenta, datum i odaberite osnovnu delatnost/postupak ili rad na mapi zuba.", "error", { persist: true, scroll: true });
    return;
  }

  if (hasTreatments && amountDueValue > finalTotal) {
    inputs.amountDue.value = finalTotal.toFixed(2);
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
  let patient = findPatientByName(patientNameValue);
  const doctor = findDoctorByName(inputs.doctor.value);

  // If we're authenticated but patient isn't found locally, refresh patient list
  // from the backend once to avoid transient race conditions between test setup
  // and frontend fetch. If still not found, show an error.
  if (hasBackendSession && !patient) {
    try {
      patients = await window.DrRosaApi.getPatients();
      populatePatientList();
      patient = findPatientByName(patientNameValue);
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
    procedureActivity: procedureActivityValue,
    procedure: procedureForSave || currentTreatmentDescription() || "Rad po zubima",
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
    treatments: teethTreatments
  };

  try {
    if (recordParam) {
      await window.DrRosaApi.updateRecord(recordParam, newRecord);
      showAlert("Unos je azuriran! Vratite se na dashboard da ga pregledate.");
      allRecords = await window.DrRosaApi.getRecords();
      setSubmitting(false);
      return;
    }

    await window.DrRosaApi.createRecord(newRecord);
    showAlert("Unos je spremljen! Vratite se na dashboard da ga pregledate.");
    form.reset();
    teethTreatments = {};
    paymentParts = [];
    totalAmountTouched = false;
    populateProcedureSelect(inputs.procedureActivity, inputs.procedure);
    populateProcedureSelect(treatmentActivity, treatmentType, "Odaberi tretman");
    allRecords = await window.DrRosaApi.getRecords();
    updateTeethSummary();
    updateToothHighlights();
    updatePaymentCalculation();
    updatePreview();
    setSubmitting(false);
  } catch (error) {
    setSubmitting(false);
    showAlert(error.message || "Unos nije sačuvan.", "error", { persist: true, scroll: true });
  }
});

(async function init() {
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
    populatePatientList();
    populateDoctors();
    populateActivitySelect(inputs.procedureActivity);
    populateProcedureSelect(inputs.procedureActivity, inputs.procedure);
    populateActivitySelect(treatmentActivity);
    populateProcedureSelect(treatmentActivity, treatmentType, "Odaberi tretman");
    if (recordParam) {
      openRecordInForm(allRecords.find(record => String(record.id) === String(recordParam)));
    }
  } catch (error) {
    console.error("Form setup error:", error);
  }
  updatePreview();
  updateTeethSummary();
  updateToothHighlights();
  updatePaymentCalculation();
  spreadToothMap();
})();
