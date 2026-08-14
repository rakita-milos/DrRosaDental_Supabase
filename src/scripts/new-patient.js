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

const form = document.getElementById("patient-form");
const cancelBtn = document.getElementById("cancel-btn");
const formMessage = document.getElementById("patient-form-message");
const extraFieldsToggle = document.getElementById("toggle-patient-extra-fields");
const extraFieldsPanel = document.getElementById("patient-extra-fields");
const patientId = new URLSearchParams(window.location.search).get("patient");
let initialConditionEditor;

function setFormMessage(message = "", type = "info") {
  if (!formMessage) return;
  formMessage.textContent = message;
  formMessage.className = message ? `form-alert ${type}` : "form-alert";
}

function patientFullName(patient) {
  return `${patient.firstName || patient.first_name || ""} ${patient.lastName || patient.last_name || ""}`.trim();
}

function setValue(id, value) {
  const element = document.getElementById(id);
  if (element) element.value = value || "";
}

function setExtraFieldsOpen(open) {
  if (!extraFieldsToggle || !extraFieldsPanel) return;
  extraFieldsPanel.hidden = !open;
  extraFieldsToggle.setAttribute("aria-expanded", String(open));
  extraFieldsToggle.textContent = open ? "Sakrij ostala polja" : "Prikaži ostala polja";
}

function hasAdditionalPatientDetails(patient, chartEntries = []) {
  return Boolean(
    patient.email ||
    patient.emergencyContact ||
    patient.emergency_contact ||
    patient.allergies ||
    patient.medicalHistory ||
    patient.medical_history ||
    patient.currentMedications ||
    patient.current_medications ||
    patient.previousTreatments ||
    patient.previous_treatments ||
    chartEntries.length
  );
}

async function loadPatientForEdit() {
  if (!patientId) return;
  try {
    const patients = await window.DrRosaApi.getPatients();
    const patient = patients.find(item => String(item.id) === String(patientId));
    if (!patient) return;
    document.querySelector(".section-header h2").textContent = "Uredi pacijenta";
    form.querySelector("button[type='submit']").textContent = "Sačuvaj izmene";
    setValue("first-name", patient.firstName || patient.first_name);
    setValue("last-name", patient.lastName || patient.last_name);
    setValue("birth-date", patient.birthDate || patient.date_of_birth);
    setValue("gender", patient.gender);
    setValue("address", patient.address);
    setValue("phone", patient.phone);
    setValue("email", patient.email);
    setValue("emergency-contact", patient.emergencyContact || patient.emergency_contact);
    setValue("medical-history", patient.medicalHistory || patient.medical_history);
    const chartEntries = await window.DrRosaApi.getClinicalChart(patientId);
    initialConditionEditor?.setEntries(window.DrRosaToothCondition.initialConditionsFromEntries(chartEntries));
    setExtraFieldsOpen(hasAdditionalPatientDetails(patient, chartEntries));
  } catch (error) {
    alert(error.message || "Pacijent nije učitan.");
  }
}

async function saveInitialConditionsForPatient(savedPatientId) {
  if (!initialConditionEditor) return;
  const entries = initialConditionEditor.getEntries();
  for (const entry of entries) {
    if (entry.id) continue;
    await window.DrRosaApi.createClinicalChartEntry(
      savedPatientId,
      window.DrRosaToothCondition.payloadFromEntry(entry)
    );
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (form.dataset.drrosaBusy === "1") return;
  const submitButton = form.querySelector("button[type='submit']");
  const submitText = submitButton?.textContent;
  form.dataset.drrosaBusy = "1";
  form.setAttribute("aria-busy", "true");
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Čuvanje...";
  }
  setFormMessage("Čuvanje pacijenta je u toku. Molimo sačekajte.", "info");

  const patient = {
    firstName: document.getElementById("first-name").value.trim(),
    lastName: document.getElementById("last-name").value.trim(),
    birthDate: document.getElementById("birth-date").value,
    gender: document.getElementById("gender").value,
    address: document.getElementById("address").value.trim(),
    phone: document.getElementById("phone").value.trim(),
    email: document.getElementById("email").value.trim(),
    emergencyContact: document.getElementById("emergency-contact").value.trim(),
    allergies: document.getElementById("allergies").value.trim(),
    medicalHistory: document.getElementById("medical-history").value.trim(),
    currentMedications: document.getElementById("current-medications").value.trim(),
    previousTreatments: document.getElementById("previous-treatments").value.trim()
  };

  try {
    if (patientId) {
      const savedPatient = await window.DrRosaApi.updatePatient(patientId, patient);
      alert("Pacijent azuriran!");
      window.location.href = `patient-dashboard.html?patientId=${encodeURIComponent(savedPatient.id || patientId)}`;
      return;
    }
    const savedPatient = await window.DrRosaApi.createPatient(patient);
    await saveInitialConditionsForPatient(savedPatient.id);
    alert("Pacijent sačuvan!");
    setFormMessage("Pacijent je sačuvan.", "success");
    form.reset();
    initialConditionEditor?.clear();
    setExtraFieldsOpen(false);
  } catch (error) {
    alert(error.message || "Pacijent nije sačuvan. Proverite vezu sa serverom.");
  } finally {
    delete form.dataset.drrosaBusy;
    form.removeAttribute("aria-busy");
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = submitText;
    }
  }
});

extraFieldsToggle?.addEventListener("click", () => {
  setExtraFieldsOpen(extraFieldsPanel?.hidden);
});

cancelBtn.addEventListener("click", () => {
  if (confirm("Da li ste sigurni da želite da otkazete?")) {
    window.location.href = "index.html";
  }
});

(async function init() {
  if (!await requireAccess()) return;
  const editorRoot = document.getElementById("initial-condition-editor");
  if (editorRoot && window.DrRosaToothCondition) {
    initialConditionEditor = window.DrRosaToothCondition.createEditor(editorRoot, {
      title: "Zateceno stanje zuba",
      emptyMessage: "Zateceno stanje mozete uneti odmah ili kasnije iz kartona pacijenta.",
      onAdd: patientId
        ? payload => window.DrRosaApi.createClinicalChartEntry(patientId, payload)
        : null,
      onUpdate: patientId
        ? (entryId, payload) => window.DrRosaApi.updateClinicalChartEntry(entryId, payload)
        : null,
      onRemove: patientId
        ? entry => window.DrRosaApi.deleteClinicalChartEntry(entry.id)
        : null
    });
  }
  setExtraFieldsOpen(false);
  await loadPatientForEdit();
})();
