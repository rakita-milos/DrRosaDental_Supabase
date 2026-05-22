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

const form = document.getElementById("new-entry-form");
const alertBox = document.querySelector(".form-alert");
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
  currency: document.getElementById("currency"),
  shift: document.getElementById("shift"),
  note: document.getElementById("note")
};

let patients = [];
let doctors = [];
let allRecords = [];
let teethTreatments = {};
let selectedTeeth = new Set();
const procedureCatalog = window.DrRosaProcedureCatalog;

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

function showAlert(message, type = "success") {
  alertBox.textContent = message;
  alertBox.className = `form-alert ${type}`;
  setTimeout(() => {
    alertBox.textContent = "";
    alertBox.className = "form-alert";
  }, 4500);
}

function updatePreview() {
  const procedureText = inputs.procedure.value.trim();
  const activityText = inputs.procedureActivity.value.trim();
  previewElements.name.textContent = inputs.patient.value.trim() || "-";
  previewElements.visit.textContent = formatDate(inputs.lastVisit.value);
  previewElements.procedure.textContent = procedureText ? `${activityText ? `${activityText} / ` : ""}${procedureText}` : (hasToothTreatments() ? "Rad po zubima" : "-");
  previewElements.status.textContent = inputs.status.value;
  previewElements.paymentStatus.textContent = inputs.paymentStatus.value;
  previewElements.amountPaid.textContent = Number(inputs.amountPaid.value || 0).toFixed(2);
  previewElements.amountDue.textContent = Number(inputs.amountDue.value || 0).toFixed(2);
  previewElements.currency.textContent = inputs.currency.value;
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
      const current = select.value;
      select.innerHTML = items.map(item => {
        const metadata = item.metadata || {};
        const shiftTime = type === "shift" && metadata.timeFrom && metadata.timeTo ? ` (${metadata.timeFrom}-${metadata.timeTo})` : "";
        return option(item.value, `${item.label}${shiftTime}`);
      }).join("");
      setSelectValue(select, current || items[0].value);
    } catch (error) {
      console.error(`${type} codebook load error:`, error);
    }
  }));
}

function cloneTreatments(treatments) {
  return JSON.parse(JSON.stringify(treatments || {}));
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
  totalDiscount.value = Number(record.totalDiscount || 0) > 0 ? Number(record.totalDiscount || 0).toFixed(2) : "";
  teethTreatments = cloneTreatments(record.treatments);
  updateTeethSummary();
  updateToothHighlights();
  updateAmountDueLimit();
  inputs.amountPaid.value = Math.max(0, currentVisitTotal() - Number(record.amountDue || 0)).toFixed(2);
  updatePaymentCalculation();
  updatePreview();
  showAlert("Pregled je otvoren sa postojecim podacima.");
}

const teethPanel = document.getElementById("tooth-treatment-panel");
const selectedToothSpan = document.getElementById("selected-tooth");
const closePanel = document.getElementById("close-panel");
const saveTreatmentBtn = document.getElementById("save-treatment");
const treatmentActivity = document.getElementById("treatment-activity");
const treatmentType = document.getElementById("treatment-type");
const treatmentNote = document.getElementById("treatment-note");
const treatmentDiscount = document.getElementById("treatment-discount");
const treatmentPrice = document.getElementById("treatment-price");
const treatmentTotalPrice = document.getElementById("treatment-total-price");
const teethSummary = document.getElementById("teeth-summary");
const totalDiscount = document.getElementById("total-discount");
const totalDiscountPanel = document.getElementById("total-discount-panel");
const toothNodes = document.querySelectorAll(".tooth-node");

function formatMoney(amount) {
  return `${Number(amount || 0).toFixed(2)} EUR`;
}

function selectedTeethList() {
  return Array.from(selectedTeeth).sort((a, b) => Number(a) - Number(b));
}

function selectedTreatmentPrice() {
  return procedureCatalog.getPrice(treatmentType.value);
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
  return currentTreatmentEntries().reduce((total, item) => total + Number(item.treatment.discount || 0), 0);
}

function currentGrossTotal() {
  return currentTreatmentTotal();
}

function currentManualTotalDiscount() {
  return Math.max(0, Number(totalDiscount.value || 0));
}

function currentFinalTotal() {
  return Math.max(0, currentGrossTotal() - currentTreatmentDiscountTotal() - currentManualTotalDiscount());
}

function currentSelectedProcedureTotal() {
  return Math.max(0, Number(
    inputs.procedure.selectedOptions[0]?.dataset.price
    || procedureCatalog.getPrice(inputs.procedure.value)
    || 0
  ));
}

function currentVisitTotal() {
  return hasToothTreatments() ? currentFinalTotal() : currentSelectedProcedureTotal();
}

function setPaymentStatusByBalance(status) {
  const target = foldText(status);
  const match = Array.from(inputs.paymentStatus.options).find(option => foldText(option.value) === target || foldText(option.textContent) === target);
  inputs.paymentStatus.value = match?.value || status;
  inputs.paymentStatus.dispatchEvent(new Event("drrosa-select-value"));
}

function updatePaymentCalculation() {
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
        ? "Plaćeno"
        : "Delimično");
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
  const discount = Math.min(price, Math.max(0, Number(treatmentDiscount.value || 0)));
  const selectedCount = Math.max(1, selectedTeeth.size);
  treatmentPrice.textContent = formatMoney(price);
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
    treatmentDiscount.value = current?.discount || "";
    treatmentNote.value = current?.note || "";
  } else if (teeth.length > 1) {
    treatmentDiscount.value = "";
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
  if (selectedTeeth.size === 0 || !treatmentType.value) {
    alert("Odaberite zub i vrstu tretmana!");
    return;
  }

  selectedTeethList().forEach(tooth => {
    const price = selectedTreatmentPrice();
    const discount = Math.min(price, Math.max(0, Number(treatmentDiscount.value || 0)));
    if (!Array.isArray(teethTreatments[tooth])) teethTreatments[tooth] = treatmentListForTooth(tooth);
    teethTreatments[tooth].push({
      activity: treatmentActivity.value,
      type: treatmentType.value,
      note: treatmentNote.value,
      price,
      discount
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
totalDiscount.addEventListener("input", () => {
  updateTeethSummary();
  updateAmountDueLimit();
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

inputs.procedureActivity.addEventListener("change", () => {
  populateProcedureSelect(inputs.procedureActivity, inputs.procedure);
  updatePaymentCalculation();
  updatePreview();
});

inputs.procedure.addEventListener("change", () => {
  if (!inputs.procedureActivity.value) {
    inputs.procedureActivity.value = procedureCatalog.findActivityForProcedure(inputs.procedure.value);
  }
  updatePaymentCalculation();
  updatePreview();
});

function updateTeethSummary() {
  const treatments = currentTreatmentEntries();
  const history = getPatientToothHistory(inputs.patient.value.trim());
  const hasCurrentTreatments = treatments.length > 0;
  totalDiscountPanel.style.display = hasCurrentTreatments ? "" : "none";
  if (!hasCurrentTreatments && totalDiscount.value) {
    totalDiscount.value = "";
  }

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
      <span>Popust po zubima</span>
      <strong>${formatMoney(currentTreatmentDiscountTotal())}</strong>
      <span>Popust na ukupno</span>
      <strong>${formatMoney(currentManualTotalDiscount())}</strong>
      <span>Za naplatu</span>
      <strong>${formatMoney(currentFinalTotal())}</strong>
    </div>
    ${treatments.map(({ tooth, treatment, index }) => `
    <div class="treatment-item">
      <div>
        <strong>Zub ${escapeHtml(tooth)}:</strong> ${escapeHtml(treatment.type)}
        <div style="margin-top: 6px; font-weight: 700;">${formatMoney(treatment.price)}</div>
        ${Number(treatment.discount || 0) > 0 ? `<div style="margin-top: 6px; color: #b45309;">Popust: ${formatMoney(treatment.discount)}</div>` : ""}
        ${treatment.note ? `<div style="margin-top: 6px;">${escapeHtml(treatment.note)}</div>` : ""}
      </div>
      <button type="button" class="danger-btn remove-treatment" data-tooth="${escapeHtml(tooth)}" data-index="${index}">x</button>
    </div>
  `).join("")}`;

  const historyHtml = history.length === 0 ? "" : `
    <h4>${treatments.length ? "Prethodna istorija:" : "Istorija rada po zubima:"}</h4>
    ${history.map(item => `
      <div class="treatment-item">
        <div>
          <strong>Zub ${escapeHtml(item.tooth)}:</strong> ${escapeHtml(item.type)}
          <div style="margin-top: 6px; font-weight: 700;">${formatMoney(item.price)}</div>
          ${Number(item.discount || 0) > 0 ? `<div style="margin-top: 6px; color: #b45309;">Popust: ${formatMoney(item.discount)}</div>` : ""}
          ${item.note ? `<div style="margin-top: 6px;">${escapeHtml(item.note)}</div>` : ""}
          <div style="margin-top: 6px; font-size: 0.9rem; color: #5b6c7d;">${formatDate(item.date)} | ${escapeHtml(item.procedure || "-")}</div>
        </div>
      </div>
    `).join("")}`;

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

  updateToothHighlights();
}

function getPatientToothHistory(name) {
  if (!name) return [];
  return allRecords
    .filter(record => record.patient === name && record.treatments)
    .flatMap(record => Object.entries(record.treatments).flatMap(([tooth, treatments]) =>
      treatmentListForValue(treatments).map(treatment => ({
        tooth,
        type: treatment.type,
        activity: treatment.activity || procedureCatalog.findActivityForProcedure(treatment.type),
        note: treatment.note,
        price: treatment.price,
        discount: treatment.discount,
        date: record.lastVisit,
        procedure: record.procedure
      }))
    ))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
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
form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const patientNameValue = inputs.patient.value.trim();
  const procedureValue = inputs.procedure.value.trim();
  const procedureActivityValue = inputs.procedureActivity.value.trim() || procedureCatalog.findActivityForProcedure(procedureValue);
  const hasTreatments = hasToothTreatments();
  const finalTotal = currentFinalTotal();
  const amountDueValue = Number(inputs.amountDue.value || 0);
  const amountPaidValue = Number(inputs.amountPaid.value || 0);
  if (!patientNameValue || !inputs.lastVisit.value || (!procedureValue && !hasTreatments)) {
    showAlert("Ispunite pacijenta, datum i odaberite postupak ili rad na mapi zuba.", "error");
    return;
  }

  if (hasTreatments && amountDueValue > finalTotal) {
    inputs.amountDue.value = finalTotal.toFixed(2);
    updatePreview();
    showAlert("Iznos duga ne može biti veći od ukupne cene svih radova.", "error");
    return;
  }
  if (amountPaidValue > currentVisitTotal()) {
    updatePaymentCalculation();
    showAlert("Plaćeni iznos ne može biti veći od ukupne cene.", "error");
    return;
  }

  const hasBackendSession = Boolean(localStorage.getItem("drrosa-token"));
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
    showAlert("Pacijent mora postojati u bazi prije unosa zapisa.", "error");
    return;
  }

  if (hasBackendSession && !doctor) {
    showAlert("Doktor nije pronadjen u bazi.", "error");
    return;
  }

  const newRecord = {
    patientId: patient?.id,
    doctorId: doctor?.id,
    patient: patientNameValue,
    lastVisit: inputs.lastVisit.value,
    procedureActivity: procedureActivityValue,
    procedure: procedureValue || currentTreatmentDescription() || "Rad po zubima",
    doctor: inputs.doctor.value,
    status: inputs.status.value,
    paymentStatus: inputs.paymentStatus.value,
    amountDue: amountDueValue,
    amountPaid: amountPaidValue,
    currency: inputs.currency.value,
    shift: inputs.shift.value,
    totalDiscount: currentManualTotalDiscount(),
    note: inputs.note.value.trim() || "-",
    treatments: teethTreatments
  };

  try {
    if (recordParam) {
      await window.DrRosaApi.updateRecord(recordParam, newRecord);
      showAlert("Unos je azuriran! Vratite se na dashboard da ga pregledate.");
      allRecords = await window.DrRosaApi.getRecords();
      return;
    }

    await window.DrRosaApi.createRecord(newRecord);
    showAlert("Unos je spremljen! Vratite se na dashboard da ga pregledate.");
    form.reset();
    teethTreatments = {};
    totalDiscount.value = "";
    populateProcedureSelect(inputs.procedureActivity, inputs.procedure);
    populateProcedureSelect(treatmentActivity, treatmentType, "Odaberi tretman");
    allRecords = await window.DrRosaApi.getRecords();
    updateTeethSummary();
    updateToothHighlights();
    updatePaymentCalculation();
    updatePreview();
  } catch (error) {
    showAlert(error.message || "Unos nije sacuvan.", "error");
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
