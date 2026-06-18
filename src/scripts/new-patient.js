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
const patientId = new URLSearchParams(window.location.search).get("patient");

function patientFullName(patient) {
  return `${patient.firstName || patient.first_name || ""} ${patient.lastName || patient.last_name || ""}`.trim();
}

function setValue(id, value) {
  const element = document.getElementById(id);
  if (element) element.value = value || "";
}

async function loadPatientForEdit() {
  if (!patientId) return;
  try {
    const patients = await window.DrRosaApi.getPatients();
    const patient = patients.find(item => String(item.id) === String(patientId));
    if (!patient) return;
    document.querySelector(".section-header h2").textContent = "Uredi pacijenta";
    form.querySelector("button[type='submit']").textContent = "Sacuvaj izmene";
    setValue("first-name", patient.firstName || patient.first_name);
    setValue("last-name", patient.lastName || patient.last_name);
    setValue("birth-date", patient.birthDate || patient.date_of_birth);
    setValue("gender", patient.gender);
    setValue("address", patient.address);
    setValue("phone", patient.phone);
    setValue("email", patient.email);
    setValue("emergency-contact", patient.emergencyContact || patient.emergency_contact);
    setValue("medical-history", patient.medicalHistory || patient.medical_history);
  } catch (error) {
    alert(error.message || "Pacijent nije ucitan.");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

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
      await window.DrRosaApi.updatePatient(patientId, patient);
      alert("Pacijent azuriran!");
      window.location.href = `patient-dashboard.html?patient=${encodeURIComponent(patientFullName(patient))}`;
      return;
    }
    await window.DrRosaApi.createPatient(patient);
    alert("Pacijent sacuvan!");
    form.reset();
  } catch (error) {
    alert(error.message || "Pacijent nije sacuvan. Proverite backend konekciju.");
  }
});

cancelBtn.addEventListener("click", () => {
  if (confirm("Da li ste sigurni da zelite da otkazete?")) {
    window.location.href = "index.html";
  }
});

(async function init() {
  if (!await requireAccess()) return;
  await loadPatientForEdit();
})();
