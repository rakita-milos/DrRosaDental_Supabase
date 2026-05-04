const form = document.getElementById("login-form");
const errorMsg = document.getElementById("error-msg");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const selectedRole = document.getElementById("role").value;
  const submitButton = form.querySelector("button[type='submit']");

  submitButton.disabled = true;
  submitButton.textContent = "Prijava...";

  try {
    const user = await window.DrRosaApi.login(email, password, selectedRole);
    window.location.href = user.role === "director" ? "director-panel.html" : "index.html";
  } catch (error) {
    showError(error.message || "Pogresan email ili lozinka");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Prijavi se";
  }
});

function showError(message) {
  errorMsg.textContent = message;
  errorMsg.style.display = "block";
  setTimeout(() => {
    errorMsg.style.display = "none";
  }, 5000);
}

(async function checkSession() {
  const session = await window.DrRosaApi.verifySession();
  if (!session) return;
  window.location.href = session.role === "director" ? "director-panel.html" : "index.html";
})();
