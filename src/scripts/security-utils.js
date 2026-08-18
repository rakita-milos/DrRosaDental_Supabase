(function () {
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }

  function cell(value, className) {
    const td = document.createElement("td");
    if (className) td.className = className;
    td.textContent = value ?? "-";
    return td;
  }

  function fieldLabel(control) {
    const explicit = control.id
      ? Array.from(document.querySelectorAll("label[for]")).find(label => label.getAttribute("for") === control.id)
      : null;
    const closest = control.closest("label");
    const text = explicit?.textContent || closest?.textContent || control.name || control.id || "polje";
    return text.replace(/\s+/g, " ").replace("*", "").trim();
  }

  function isTextRequiredControl(control) {
    if (!control?.required || control.disabled || control.readOnly) return false;
    if (control.tagName === "TEXTAREA") return true;
    if (control.tagName !== "INPUT") return false;
    const type = String(control.type || "text").toLowerCase();
    return ["text", "search", "email", "tel", "url", "password"].includes(type);
  }

  function validateRequiredTextFields(form, { messageTarget = null } = {}) {
    const controls = Array.from(form?.querySelectorAll("input[required], textarea[required]") || [])
      .filter(isTextRequiredControl);
    for (const control of controls) {
      const trimmed = control.value.trim();
      control.value = trimmed;
      control.setCustomValidity("");
      if (trimmed) continue;
      const message = `Polje "${fieldLabel(control)}" je obavezno.`;
      control.setCustomValidity(message);
      if (messageTarget) messageTarget.textContent = message;
      control.reportValidity?.();
      control.focus?.();
      window.setTimeout(() => control.setCustomValidity(""), 0);
      return false;
    }
    return true;
  }

  window.DrRosaSecurity = {
    escapeHtml,
    escapeAttribute,
    cell
  };

  window.DrRosaForms = {
    validateRequiredTextFields
  };
})();
