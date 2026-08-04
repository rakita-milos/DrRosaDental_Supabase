(function () {
  const state = {
    patient: null,
    doctors: [],
    chairs: [],
    procedures: [],
    onCreated: null,
    loaded: false
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return window.DrRosaSecurity?.escapeHtml
      ? window.DrRosaSecurity.escapeHtml(value)
      : String(value ?? "");
  }

  function escapeAttribute(value) {
    return window.DrRosaSecurity?.escapeAttribute
      ? window.DrRosaSecurity.escapeAttribute(value)
      : String(value ?? "");
  }

  function patientFullName(patient) {
    return patient?.fullName || `${patient?.firstName || patient?.first_name || ""} ${patient?.lastName || patient?.last_name || ""}`.trim();
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function isoDateKey(date) {
    if (window.DrRosaDateUtils?.isoDateKey) return window.DrRosaDateUtils.isoDateKey(date);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function localDateTimeString(date) {
    if (window.DrRosaDateUtils?.localDateTimeString) return window.DrRosaDateUtils.localDateTimeString(date);
    return `${isoDateKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function optionList(items, { value = "id", label = "name" } = {}) {
    return items.map(item => `<option value="${escapeAttribute(item[value])}">${escapeHtml(item[label])}</option>`).join("");
  }

  function setAlert(message = "", type = "") {
    const alert = byId("patient-appointment-alert");
    if (!alert) return;
    alert.textContent = message;
    alert.className = `form-alert ${type ? `alert-${type}` : ""}`.trim();
  }

  function panel() {
    return byId("patient-appointment-panel");
  }

  function openPanel() {
    const modal = panel();
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add("modal-open");
  }

  function closePanel() {
    const modal = panel();
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    setAlert("");
  }

  async function loadOptions() {
    if (state.loaded) return;
    const [doctors, chairs, procedures] = await Promise.all([
      window.DrRosaApi.getDoctors(),
      window.DrRosaApi.getChairs(),
      window.DrRosaApi.getCodebooks("procedure")
    ]);
    state.doctors = doctors;
    state.chairs = chairs;
    state.procedures = procedures;
    byId("patient-appointment-doctor").innerHTML = optionList(doctors);
    byId("patient-appointment-chair").innerHTML = optionList(chairs);
    byId("patient-appointment-procedure").innerHTML = procedures
      .map(item => `<option value="${escapeAttribute(item.id)}" data-name="${escapeAttribute(item.value)}">${escapeHtml(item.label)}</option>`)
      .join("");
    state.loaded = true;
  }

  function fillTitleFromProcedureIfEmpty() {
    const title = byId("patient-appointment-title");
    const procedure = byId("patient-appointment-procedure")?.selectedOptions[0];
    if (title && !title.value.trim() && procedure) {
      title.value = procedure.dataset.name || procedure.textContent || "";
    }
  }

  function resetForm(patient) {
    const form = byId("patient-appointment-form");
    form?.reset();
    const now = new Date();
    const name = patientFullName(patient);
    byId("patient-appointment-panel-title").textContent = `Zakazi termin - ${name}`;
    byId("patient-appointment-patient-name").value = name;
    byId("patient-appointment-date").value = isoDateKey(now);
    byId("patient-appointment-time").value = "09:00";
    byId("patient-appointment-duration").value = "30";
    byId("patient-appointment-status").value = "scheduled";
    byId("patient-appointment-context").innerHTML = `
      <div>
        <span>Zakazivanje za pacijenta</span>
        <strong>${escapeHtml(name)}</strong>
        <small>${escapeHtml([patient?.phone, patient?.email].filter(Boolean).join(" / ") || "Kontakt nije unet")}</small>
      </div>
    `;
    fillTitleFromProcedureIfEmpty();
    setAlert("");
  }

  function validate() {
    const requiredFields = [
      ["patient-appointment-title", "Naziv termina"],
      ["patient-appointment-date", "Datum"],
      ["patient-appointment-time", "Vreme"],
      ["patient-appointment-doctor", "Doktor"],
      ["patient-appointment-chair", "Stolica"],
      ["patient-appointment-procedure", "Postupak"]
    ];
    const missing = requiredFields.find(([id]) => !byId(id)?.value);
    if (missing) return `${missing[1]} je obavezno polje.`;
    if (!state.patient?.id) return "Pacijent nije ucitan.";
    return "";
  }

  function formPayload() {
    const date = byId("patient-appointment-date").value;
    const time = byId("patient-appointment-time").value;
    const duration = Number(byId("patient-appointment-duration").value || 30);
    const start = new Date(`${date}T${time}:00`);
    const end = new Date(start.getTime() + duration * 60000);
    const procedureSelect = byId("patient-appointment-procedure");
    const selectedProcedure = procedureSelect.selectedOptions[0];
    const title = byId("patient-appointment-title").value.trim()
      || selectedProcedure?.dataset.name
      || selectedProcedure?.textContent
      || "Kontrola";
    return {
      patient_id: Number(state.patient.id),
      doctor_id: Number(byId("patient-appointment-doctor").value),
      chair_id: Number(byId("patient-appointment-chair").value),
      procedure_id: Number(procedureSelect.value) || null,
      procedure_name: title,
      starts_at: localDateTimeString(start),
      ends_at: localDateTimeString(end),
      duration_minutes: duration,
      status: byId("patient-appointment-status").value,
      notes: byId("patient-appointment-notes").value
    };
  }

  async function openForPatient(patient, options = {}) {
    state.patient = patient;
    state.onCreated = typeof options.onCreated === "function" ? options.onCreated : null;
    openPanel();
    setAlert("Ucitavanje opcija za termin...", "info");
    try {
      await loadOptions();
      resetForm(patient);
      byId("patient-appointment-title")?.focus();
    } catch (error) {
      setAlert(error.message || "Opcije za termin nisu ucitane.", "error");
    }
  }

  function bind() {
    const form = byId("patient-appointment-form");
    if (!form || form.dataset.appointmentModalReady === "1") return;
    form.dataset.appointmentModalReady = "1";
    byId("close-patient-appointment-modal")?.addEventListener("click", closePanel);
    byId("dismiss-patient-appointment-btn")?.addEventListener("click", closePanel);
    panel()?.addEventListener("click", event => {
      if (event.target.matches("[data-close-patient-appointment-modal]")) closePanel();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !panel()?.hidden) closePanel();
    });
    byId("patient-appointment-procedure")?.addEventListener("change", fillTitleFromProcedureIfEmpty);
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (form.dataset.drrosaBusy === "1") return;
      const validationError = validate();
      if (validationError) {
        setAlert(validationError, "error");
        return;
      }
      const submitButton = form.querySelector("button[type='submit']");
      const submitText = submitButton?.textContent;
      form.dataset.drrosaBusy = "1";
      form.setAttribute("aria-busy", "true");
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Cuvanje...";
      }
      try {
        const saved = await window.DrRosaApi.createAppointment(formPayload());
        setAlert("Termin je zakazan.", "success");
        if (state.onCreated) await state.onCreated(saved);
        closePanel();
      } catch (error) {
        setAlert(error.message || "Termin nije sacuvan.", "error");
      } finally {
        delete form.dataset.drrosaBusy;
        form.removeAttribute("aria-busy");
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = submitText;
        }
      }
    });
  }

  window.DrRosaAppointmentModal = {
    bind,
    openForPatient,
    formPayload
  };
})();
