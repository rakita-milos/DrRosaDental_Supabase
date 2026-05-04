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

const form = document.getElementById("patient-form");
const cancelBtn = document.getElementById("cancel-btn");

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

requireAccess();
