(function () {
  const state = { doctors: [], procedures: [], slots: [] };

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function escapeHtml(value) {
    return window.DrRosaSecurity?.escapeHtml ? window.DrRosaSecurity.escapeHtml(value) : String(value ?? "");
  }

  function message(text, isError = false) {
    const element = document.getElementById("booking-message");
    element.textContent = text || "";
    element.className = `form-alert ${isError ? "alert-error" : "alert-success"}`;
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function hasCodeLikeContent(value) {
    const text = String(value || "");
    return /[<>`{}]/.test(text)
      || /\bjavascript\s*:/i.test(text)
      || /\bon[a-z]+\s*=/i.test(text)
      || /\b(select|insert|update|delete|drop|alter|union|exec)\b[\s\S]*\b(from|into|table|set|where)\b/i.test(text);
  }

  function normalizeInputs() {
    ["booking-first-name", "booking-last-name", "booking-email", "booking-phone", "booking-notes"].forEach(id => {
      const input = document.getElementById(id);
      if (input) input.value = normalizeText(input.value);
    });
  }

  function validateBookingForm() {
    normalizeInputs();
    const firstName = document.getElementById("booking-first-name").value;
    const lastName = document.getElementById("booking-last-name").value;
    const email = document.getElementById("booking-email").value;
    const phone = document.getElementById("booking-phone").value;
    const date = document.getElementById("booking-date").value;
    const doctorId = document.getElementById("booking-doctor").value;
    const procedureId = document.getElementById("booking-procedure").value;
    const slot = document.getElementById("booking-slot").value;
    const notes = document.getElementById("booking-notes").value;
    const namePattern = /^[\p{L}][\p{L}\s.'-]{0,79}$/u;
    const phonePattern = /^\+?[\d\s()./-]{6,30}$/;

    if (!firstName || !lastName || !phone || !date || !doctorId || !procedureId || !slot) {
      return "Ime, prezime, broj telefona, datum, doktor i postupak su obavezni.";
    }
    if (!namePattern.test(firstName)) return "Ime nije u ispravnom formatu.";
    if (!namePattern.test(lastName)) return "Prezime nije u ispravnom formatu.";
    if (!phonePattern.test(phone) || phone.replace(/\D/g, "").length < 6) return "Broj telefona nije u ispravnom formatu.";
    if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return "Email nije u ispravnom formatu.";
    if ([firstName, lastName, email, phone, notes].some(hasCodeLikeContent)) return "Polja ne smeju sadrzati kod ili specijalne znakove.";
    return "";
  }

  function renderOptions() {
    document.getElementById("booking-doctor").innerHTML = state.doctors
      .map(doctor => `<option value="${doctor.id}">${escapeHtml(doctor.name)}</option>`)
      .join("");
    document.getElementById("booking-procedure").innerHTML = state.procedures
      .map(item => `<option value="${item.id}" data-name="${escapeHtml(item.label || item.value)}">${escapeHtml(item.label || item.value)}${Number(item.price || 0) > 0 ? ` - ${Number(item.price).toFixed(2)} EUR` : ""}</option>`)
      .join("");
  }

  function renderSlots() {
    const select = document.getElementById("booking-slot");
    select.innerHTML = state.slots.length
      ? state.slots.map(slot => {
        const starts = new Date(slot.startsAt);
        const label = `${starts.toLocaleTimeString("hr-HR", { hour: "2-digit", minute: "2-digit" })} - ${slot.doctorName}`;
        return `<option value="${escapeHtml(slot.startsAt)}" data-chair="${slot.chairId}" data-doctor="${slot.doctorId}" data-duration="${slot.durationMinutes}">${escapeHtml(label)}</option>`;
      }).join("")
      : `<option value="">Nema slobodnih termina</option>`;
  }

  async function loadSlots() {
    const date = document.getElementById("booking-date").value;
    const doctorId = document.getElementById("booking-doctor").value;
    if (!date || !doctorId) return;
    message("Ucitavam slobodne termine...");
    try {
      const data = await window.DrRosaApi.getPublicAvailability({
        date,
        doctor_id: doctorId,
        duration: 30
      });
      state.slots = data.slots || [];
      renderSlots();
      message(state.slots.length ? "Izaberite termin." : "Nema slobodnih termina za izabrani dan.", !state.slots.length);
    } catch (error) {
      message(error.message || "Termini nisu ucitani.", true);
    }
  }

  async function init() {
    document.getElementById("booking-date").value = today();
    const options = await window.DrRosaApi.getPublicBookingOptions();
    state.doctors = options.doctors || [];
    state.procedures = options.procedures || [];
    renderOptions();
    await loadSlots();

    document.getElementById("public-booking-back")?.addEventListener("click", () => {
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
      window.location.href = "index.html";
    });
    document.getElementById("booking-date").addEventListener("change", loadSlots);
    document.getElementById("booking-doctor").addEventListener("change", loadSlots);
    document.getElementById("refresh-slots").addEventListener("click", loadSlots);
    ["booking-first-name", "booking-last-name", "booking-email", "booking-phone", "booking-notes"].forEach(id => {
      document.getElementById(id)?.addEventListener("blur", normalizeInputs);
    });
    document.getElementById("public-booking-form").addEventListener("submit", async event => {
      event.preventDefault();
      const slot = document.getElementById("booking-slot").selectedOptions[0];
      const procedure = document.getElementById("booking-procedure").selectedOptions[0];
      const validationError = validateBookingForm();
      if (validationError) {
        message(validationError, true);
        return;
      }
      if (!slot?.value) {
        message("Izaberite slobodan termin.", true);
        return;
      }
      try {
        await window.DrRosaApi.createPublicBooking({
          firstName: document.getElementById("booking-first-name").value,
          lastName: document.getElementById("booking-last-name").value,
          email: document.getElementById("booking-email").value,
          phone: document.getElementById("booking-phone").value,
          doctorId: Number(slot.dataset.doctor),
          chairId: Number(slot.dataset.chair),
          procedureId: Number(document.getElementById("booking-procedure").value),
          procedureName: procedure?.dataset.name || procedure?.textContent || "Kontrola",
          startsAt: slot.value,
          durationMinutes: Number(slot.dataset.duration || 30),
          notes: document.getElementById("booking-notes").value
        });
        event.target.reset();
        document.getElementById("booking-date").value = today();
        await loadSlots();
        message("Termin je zakazan. Ordinacija ce vas kontaktirati za potvrdu.");
      } catch (error) {
        message(error.message || "Termin nije zakazan.", true);
      }
    });
  }

  init().catch(error => message(error.message || "Online zakazivanje trenutno nije dostupno.", true));
})();
