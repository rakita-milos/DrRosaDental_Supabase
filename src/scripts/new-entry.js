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
  amountDue: document.getElementById("preview-amount-due"),
  currency: document.getElementById("preview-currency"),
  shift: document.getElementById("preview-shift"),
  note: document.getElementById("preview-note")
};

const inputs = {
  patient: document.getElementById("patient-name"),
  lastVisit: document.getElementById("last-visit"),
  procedure: document.getElementById("procedure"),
  doctor: document.getElementById("doctor"),
  status: document.getElementById("status"),
  paymentStatus: document.getElementById("payment-status"),
  amountDue: document.getElementById("amount-due"),
  currency: document.getElementById("currency"),
  shift: document.getElementById("shift"),
  note: document.getElementById("note")
};

let patients = [];
let doctors = [];
let teethTreatments = {};
let selectedTooth = null;

const urlParams = new URLSearchParams(window.location.search);
const patientParam = urlParams.get("patient");
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
  previewElements.name.textContent = inputs.patient.value.trim() || "-";
  previewElements.visit.textContent = formatDate(inputs.lastVisit.value);
  previewElements.procedure.textContent = inputs.procedure.value.trim() || "-";
  previewElements.status.textContent = inputs.status.value;
  previewElements.paymentStatus.textContent = inputs.paymentStatus.value;
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

function populatePatientList() {
  const datalist = document.getElementById("existing-patients");
  datalist.innerHTML = "";
  patients.map(patientName).filter(Boolean).forEach(name => {
    const option = document.createElement("option");
    option.value = name;
    datalist.appendChild(option);
  });
}

function populateDoctors() {
  if (!doctors.length) return;
  inputs.doctor.innerHTML = doctors.map(doctor => `<option value="${escapeHtml(doctor.name)}">${escapeHtml(doctor.name)}</option>`).join("");
}

const teethPanel = document.getElementById("tooth-treatment-panel");
const selectedToothSpan = document.getElementById("selected-tooth");
const closePanel = document.getElementById("close-panel");
const saveTreatmentBtn = document.getElementById("save-treatment");
const treatmentType = document.getElementById("treatment-type");
const treatmentStatus = document.getElementById("treatment-status");
const treatmentNote = document.getElementById("treatment-note");
const teethSummary = document.getElementById("teeth-summary");

function openToothPanel(toothNode) {
  selectedTooth = toothNode.dataset.tooth;
  selectedToothSpan.textContent = selectedTooth;
  const current = teethTreatments[selectedTooth];
  treatmentType.value = current?.type || "";
  treatmentStatus.value = current?.status || "Planirano";
  treatmentNote.value = current?.note || "";
  teethPanel.style.display = "block";
}

document.querySelectorAll(".tooth-node").forEach(toothNode => {
  toothNode.addEventListener("click", () => {
    openToothPanel(toothNode);
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
  selectedTooth = null;
});

saveTreatmentBtn.addEventListener("click", () => {
  if (!selectedTooth || !treatmentType.value) {
    alert("Odaberite vrstu tretmana!");
    return;
  }

  teethTreatments[selectedTooth] = {
    type: treatmentType.value,
    status: treatmentStatus.value,
    note: treatmentNote.value
  };

  document.querySelector(`.tooth-node[data-tooth="${selectedTooth}"]`).classList.add("treated");
  teethPanel.style.display = "none";
  updateTeethSummary();
  selectedTooth = null;
});

function updateTeethSummary() {
  const treatments = Object.entries(teethTreatments);
  if (treatments.length === 0) {
    teethSummary.innerHTML = "";
    return;
  }

  teethSummary.innerHTML = `<h4>Tretmani zuba:</h4>${treatments.map(([tooth, treatment]) => `
    <div class="treatment-item">
      <div>
        <strong>Zub ${escapeHtml(tooth)}:</strong> ${escapeHtml(treatment.type)}
        <span style="color: #5b6c7d;">(${escapeHtml(treatment.status)})</span>
      </div>
      <button type="button" class="remove-treatment" data-tooth="${escapeHtml(tooth)}" style="background: none; border: none; color: #dc3545; cursor: pointer; font-size: 18px;">x</button>
    </div>
  `).join("")}`;

  document.querySelectorAll(".remove-treatment").forEach(btn => {
    btn.addEventListener("click", () => {
      const tooth = btn.dataset.tooth;
      delete teethTreatments[tooth];
      document.querySelector(`.tooth-node[data-tooth="${tooth}"]`).classList.remove("treated");
      updateTeethSummary();
    });
  });
}

form.addEventListener("input", updatePreview);
form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const patientNameValue = inputs.patient.value.trim();
  if (!patientNameValue || !inputs.lastVisit.value || !inputs.procedure.value.trim()) {
    showAlert("Ispunite sve obavezne podatke prije spremanja.", "error");
    return;
  }

  const patient = findPatientByName(patientNameValue);
  const doctor = findDoctorByName(inputs.doctor.value);
  const hasBackendSession = Boolean(localStorage.getItem("drrosa-token"));

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
    procedure: inputs.procedure.value.trim(),
    doctor: inputs.doctor.value,
    status: inputs.status.value,
    paymentStatus: inputs.paymentStatus.value,
    amountDue: Number(inputs.amountDue.value || 0),
    currency: inputs.currency.value,
    shift: inputs.shift.value,
    note: inputs.note.value.trim() || "-",
    treatments: teethTreatments
  };

  try {
    await window.DrRosaApi.createRecord(newRecord);
    showAlert("Unos je spremljen! Vratite se na dashboard da ga pregledate.");
    form.reset();
    teethTreatments = {};
    document.querySelectorAll(".tooth-node").forEach(tooth => tooth.classList.remove("treated"));
    updateTeethSummary();
    updatePreview();
  } catch (error) {
    showAlert(error.message || "Unos nije sacuvan.", "error");
  }
});

(async function init() {
  if (!await requireAccess()) return;
  try {
    const [loadedPatients, loadedDoctors] = await Promise.all([
      window.DrRosaApi.getPatients(),
      window.DrRosaApi.getDoctors()
    ]);
    patients = loadedPatients;
    doctors = loadedDoctors;
    populatePatientList();
    populateDoctors();
  } catch (error) {
    console.error("Form setup error:", error);
  }
  updatePreview();
})();
