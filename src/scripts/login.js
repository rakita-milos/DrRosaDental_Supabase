const form = document.getElementById("login-form");
const errorMsg = document.getElementById("error-msg");
let pendingTwoFactor = false;

function ensureTwoFactorField() {
  let field = document.getElementById("two-factor-code");
  if (field) return field;
  const label = document.createElement("label");
  label.id = "two-factor-label";
  label.textContent = "2FA kod";
  label.innerHTML = `2FA kod<input type="text" id="two-factor-code" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" />`;
  form.insertBefore(label, form.querySelector("button[type='submit']"));
  return document.getElementById("two-factor-code");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const selectedRole = document.getElementById("role").value;
  const twoFactorCode = document.getElementById("two-factor-code")?.value.trim();
  const submitButton = form.querySelector("button[type='submit']");

  submitButton.disabled = true;
  submitButton.textContent = "Prijava...";

  try {
    const user = await window.DrRosaApi.login(email, password, selectedRole, twoFactorCode);
    if (user?.requires2fa) {
      pendingTwoFactor = true;
      ensureTwoFactorField().focus();
      showError("Unesite 2FA kod iz autentifikator aplikacije.");
      return;
    }
    window.location.href = user.role === "director" ? "director-panel.html" : "index.html";
  } catch (error) {
    if (error.message && error.message.toLowerCase().includes("two-factor")) {
      pendingTwoFactor = true;
      ensureTwoFactorField().focus();
    }
    showError(error.message || "Pogresan email, uloga ili lozinka");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = pendingTwoFactor ? "Potvrdi 2FA" : "Prijavi se";
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
