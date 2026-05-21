(function () {
  const STATUS_LABELS = {
    scheduled: "Zakazano",
    confirmed: "Potvrdjeno",
    arrived: "Dosao",
    completed: "Zavrseno",
    cancelled: "Otkazano",
    no_show: "Nije dosao"
  };
  const DAY_NAMES = ["Pon", "Uto", "Sre", "Cet", "Pet", "Sub", "Ned"];
  const state = {
    currentDate: new Date(),
    viewMode: "week",
    appointments: [],
    patients: [],
    doctors: [],
    chairs: [],
    procedures: []
  };

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function dateKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function localDateTimeString(date) {
    return `${dateKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function parseLocalDateTime(value) {
    if (!value) return new Date(NaN);
    const text = String(value);
    if (/[zZ]|[+-]\d{2}:\d{2}$/.test(text)) return new Date(text);
    return new Date(text.length === 16 ? `${text}:00` : text);
  }

  function localInputDateTime(date, time) {
    return new Date(`${date}T${time}:00`);
  }

  function startOfWeek(date) {
    const copy = new Date(date);
    const day = copy.getDay() || 7;
    copy.setHours(0, 0, 0, 0);
    copy.setDate(copy.getDate() - day + 1);
    return copy;
  }

  function startOfMonth(date) {
    const copy = new Date(date);
    copy.setDate(1);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  function endOfMonth(date) {
    const copy = startOfMonth(date);
    copy.setMonth(copy.getMonth() + 1);
    return copy;
  }

  function addDays(date, days) {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
  }

  function addMonths(date, months) {
    const copy = new Date(date);
    copy.setMonth(copy.getMonth() + months);
    return copy;
  }

  function visibleRange() {
    if (state.viewMode === "day") {
      const from = new Date(state.currentDate);
      from.setHours(0, 0, 0, 0);
      return { from, to: addDays(from, 1), days: [from] };
    }
    if (state.viewMode === "month") {
      const monthStart = startOfMonth(state.currentDate);
      const gridStart = startOfWeek(monthStart);
      const monthEnd = endOfMonth(state.currentDate);
      const gridEnd = addDays(startOfWeek(monthEnd), 7);
      const days = [];
      for (let day = new Date(gridStart); day < gridEnd; day = addDays(day, 1)) days.push(new Date(day));
      return { from: gridStart, to: gridEnd, days };
    }
    const weekStart = startOfWeek(state.currentDate);
    return {
      from: weekStart,
      to: addDays(weekStart, 7),
      days: Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
    };
  }

  function setAlert(message, type = "info") {
    const alert = document.getElementById("appointment-alert");
    alert.textContent = message || "";
    alert.className = `form-alert ${type ? `alert-${type}` : ""}`;
  }

  function openPanel() {
    const panel = document.getElementById("appointment-panel");
    panel.hidden = false;
    document.body.classList.add("modal-open");
    setTimeout(() => document.getElementById("appointment-patient")?.focus(), 0);
  }

  function closePanel() {
    const panel = document.getElementById("appointment-panel");
    panel.hidden = true;
    document.body.classList.remove("modal-open");
  }

  function optionList(items, { value = "id", label = "name" } = {}) {
    return items.map(item => `<option value="${item[value]}">${window.DrRosaSecurity.escapeHtml(item[label])}</option>`).join("");
  }

  function fillSelects() {
    document.getElementById("doctor-filter").innerHTML = `<option value="">Svi doktori</option>${optionList(state.doctors)}`;
    document.getElementById("appointment-doctor").innerHTML = optionList(state.doctors);
    document.getElementById("appointment-chair").innerHTML = optionList(state.chairs);
    document.getElementById("appointment-patient").innerHTML = optionList(state.patients, { label: "fullName" });
    document.getElementById("appointment-procedure").innerHTML = state.procedures
      .map(item => `<option value="${item.id}" data-name="${window.DrRosaSecurity.escapeHtml(item.value)}">${window.DrRosaSecurity.escapeHtml(item.label)}</option>`)
      .join("");
  }

  function renderTitle() {
    if (state.viewMode === "day") {
      document.getElementById("calendar-title").textContent = state.currentDate.toLocaleDateString("hr-HR", { weekday: "long", year: "numeric", month: "2-digit", day: "2-digit" });
      return;
    }
    if (state.viewMode === "month") {
      document.getElementById("calendar-title").textContent = state.currentDate.toLocaleDateString("hr-HR", { year: "numeric", month: "long" });
      return;
    }
    const start = startOfWeek(state.currentDate);
    const end = addDays(start, 6);
    document.getElementById("calendar-title").textContent = `${start.toLocaleDateString("hr-HR")} - ${end.toLocaleDateString("hr-HR")}`;
  }

  function renderCalendar() {
    renderTitle();
    const board = document.getElementById("calendar-board");
    const { days } = visibleRange();
    board.className = `calendar-board calendar-board-${state.viewMode}`;
    if (state.viewMode === "day") {
      board.innerHTML = renderDayAgenda(days[0]);
      return;
    }
    if (state.viewMode === "week") {
      board.innerHTML = renderWeekSchedule(days);
      return;
    }
    board.innerHTML = days.map((day, index) => {
      const key = dateKey(day);
      const dayAppointments = state.appointments.filter(item => dateKey(parseLocalDateTime(item.startsAt)) === key);
      const isOtherMonth = state.viewMode === "month" && day.getMonth() !== state.currentDate.getMonth();
      return `
        <div class="calendar-day${isOtherMonth ? " calendar-day-muted" : ""}" data-date="${key}">
          <button class="calendar-day-header" type="button" data-date="${key}">
            <span>${DAY_NAMES[index % 7]}</span>
            <strong>${day.getDate()}</strong>
          </button>
          <div class="calendar-day-list">
            ${renderMonthItems(dayAppointments)}
          </div>
        </div>
      `;
    }).join("");
  }

  function appointmentsForDay(day) {
    const key = dateKey(day);
    return state.appointments
      .filter(item => dateKey(parseLocalDateTime(item.startsAt)) === key)
      .sort((a, b) => parseLocalDateTime(a.startsAt) - parseLocalDateTime(b.startsAt));
  }

  function renderMonthItems(appointments) {
    if (!appointments.length) return `<p class="empty-row">Slobodno</p>`;
    const visible = appointments.slice(0, 3);
    const hiddenCount = appointments.length - visible.length;
    return `
      ${visible.map(renderCompactAppointment).join("")}
      ${hiddenCount > 0 ? `<button class="more-appointments" type="button" data-date="${dateKey(parseLocalDateTime(appointments[0].startsAt))}">+${hiddenCount} jos</button>` : ""}
    `;
  }

  function renderCompactAppointment(appointment) {
    const starts = parseLocalDateTime(appointment.startsAt);
    return `
      <button class="appointment-compact appointment-${appointment.status}" type="button" data-appointment-id="${appointment.id}">
        <span>${pad(starts.getHours())}:${pad(starts.getMinutes())}</span>
        <strong>${window.DrRosaSecurity.escapeHtml(shortPatientName(appointment.patientName))}</strong>
      </button>
    `;
  }

  function renderWeekSchedule(days) {
    const hours = Array.from({ length: 13 }, (_, index) => 8 + index);
    return `
      <div class="week-grid">
        <div class="week-corner"></div>
        ${days.map((day, index) => `
          <button class="week-day-heading" type="button" data-date="${dateKey(day)}">
            <span>${DAY_NAMES[index]}</span>
            <strong>${day.getDate()}</strong>
          </button>
        `).join("")}
        ${hours.map(hour => `
          <div class="week-hour">${pad(hour)}:00</div>
          ${days.map(day => renderWeekSlot(day, hour)).join("")}
        `).join("")}
      </div>
    `;
  }

  function renderWeekSlot(day, hour) {
    const slotAppointments = appointmentsForDay(day).filter(appointment => parseLocalDateTime(appointment.startsAt).getHours() === hour);
    return `
      <div class="week-slot" data-date="${dateKey(day)}" data-hour="${hour}">
        ${slotAppointments.slice(0, 3).map(renderWeekAppointment).join("")}
        ${slotAppointments.length > 3 ? `<button class="more-appointments" type="button" data-date="${dateKey(day)}">+${slotAppointments.length - 3} jos</button>` : ""}
      </div>
    `;
  }

  function renderWeekAppointment(appointment) {
    const starts = parseLocalDateTime(appointment.startsAt);
    const ends = parseLocalDateTime(appointment.endsAt);
    return `
      <button class="week-appointment appointment-${appointment.status}" type="button" data-appointment-id="${appointment.id}">
        <span>${pad(starts.getHours())}:${pad(starts.getMinutes())}-${pad(ends.getHours())}:${pad(ends.getMinutes())}</span>
        <strong>${window.DrRosaSecurity.escapeHtml(shortPatientName(appointment.patientName))}</strong>
      </button>
    `;
  }

  function renderDayAgenda(day) {
    const appointments = appointmentsForDay(day);
    return `
      <div class="day-agenda" data-date="${dateKey(day)}">
        ${appointments.length ? appointments.map(renderAgendaAppointment).join("") : `<button class="empty-day-agenda" type="button" data-date="${dateKey(day)}">Slobodan dan</button>`}
      </div>
    `;
  }

  function renderAgendaAppointment(appointment) {
    const starts = parseLocalDateTime(appointment.startsAt);
    const ends = parseLocalDateTime(appointment.endsAt);
    return `
      <button class="agenda-appointment appointment-${appointment.status}" type="button" data-appointment-id="${appointment.id}">
        <span class="appointment-time">${pad(starts.getHours())}:${pad(starts.getMinutes())} - ${pad(ends.getHours())}:${pad(ends.getMinutes())}</span>
        <strong>${window.DrRosaSecurity.escapeHtml(appointment.patientName)}</strong>
        <span>${window.DrRosaSecurity.escapeHtml(appointment.procedureName)}</span>
        <small>${window.DrRosaSecurity.escapeHtml(appointment.doctorName)} / ${window.DrRosaSecurity.escapeHtml(appointment.chairName)}</small>
        <em>${STATUS_LABELS[appointment.status] || appointment.status}</em>
      </button>
    `;
  }

  function shortPatientName(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return parts[0] || "-";
    return `${parts[0]} ${parts[1].charAt(0)}.`;
  }

  function renderAppointmentCard(appointment) {
    const starts = parseLocalDateTime(appointment.startsAt);
    const ends = parseLocalDateTime(appointment.endsAt);
    return `
      <button class="appointment-card appointment-${appointment.status}" type="button" data-appointment-id="${appointment.id}">
        <span class="appointment-time">${pad(starts.getHours())}:${pad(starts.getMinutes())} - ${pad(ends.getHours())}:${pad(ends.getMinutes())}</span>
        <strong>${window.DrRosaSecurity.escapeHtml(appointment.patientName)}</strong>
        <span>${window.DrRosaSecurity.escapeHtml(appointment.procedureName)}</span>
        <small>${window.DrRosaSecurity.escapeHtml(appointment.doctorName)} / ${window.DrRosaSecurity.escapeHtml(appointment.chairName)}</small>
        <em>${STATUS_LABELS[appointment.status] || appointment.status}</em>
      </button>
    `;
  }

  function resetForm(date = new Date()) {
    openPanel();
    document.getElementById("appointment-panel-title").textContent = "Novi termin";
    document.getElementById("appointment-id").value = "";
    document.getElementById("appointment-date").value = dateKey(date);
    document.getElementById("appointment-time").value = "09:00";
    document.getElementById("appointment-duration").value = "30";
    document.getElementById("appointment-status").value = "scheduled";
    document.getElementById("appointment-notes").value = "";
    document.getElementById("create-visit-btn").disabled = true;
    document.getElementById("cancel-appointment-btn").hidden = true;
    document.getElementById("cancel-appointment-btn").disabled = true;
    setAlert("");
  }

  function editAppointment(id) {
    const appointment = state.appointments.find(item => String(item.id) === String(id));
    if (!appointment) return;
    openPanel();
    const starts = parseLocalDateTime(appointment.startsAt);
    document.getElementById("appointment-panel-title").textContent = "Izmena termina";
    document.getElementById("appointment-id").value = appointment.id;
    document.getElementById("appointment-patient").value = appointment.patientId;
    document.getElementById("appointment-doctor").value = appointment.doctorId;
    document.getElementById("appointment-chair").value = appointment.chairId;
    document.getElementById("appointment-procedure").value = appointment.procedureId || "";
    document.getElementById("appointment-date").value = dateKey(starts);
    document.getElementById("appointment-time").value = `${pad(starts.getHours())}:${pad(starts.getMinutes())}`;
    document.getElementById("appointment-duration").value = String(appointment.durationMinutes || 30);
    document.getElementById("appointment-status").value = appointment.status;
    document.getElementById("appointment-notes").value = appointment.notes || "";
    document.getElementById("create-visit-btn").disabled = Boolean(appointment.visitRecordId) || appointment.status === "cancelled";
    document.getElementById("cancel-appointment-btn").hidden = false;
    document.getElementById("cancel-appointment-btn").disabled = appointment.status === "cancelled";
    setAlert(`Google sync: ${appointment.googleSyncStatus || "not_synced"}`, "info");
  }

  function formPayload() {
    const date = document.getElementById("appointment-date").value;
    const time = document.getElementById("appointment-time").value;
    const duration = Number(document.getElementById("appointment-duration").value || 30);
    const start = localInputDateTime(date, time);
    const end = new Date(start.getTime() + duration * 60000);
    const procedureSelect = document.getElementById("appointment-procedure");
    const selectedProcedure = procedureSelect.selectedOptions[0];
    return {
      patient_id: Number(document.getElementById("appointment-patient").value),
      doctor_id: Number(document.getElementById("appointment-doctor").value),
      chair_id: Number(document.getElementById("appointment-chair").value),
      procedure_id: Number(procedureSelect.value) || null,
      procedure_name: selectedProcedure?.dataset.name || selectedProcedure?.textContent || "Kontrola",
      starts_at: localDateTimeString(start),
      ends_at: localDateTimeString(end),
      duration_minutes: duration,
      status: document.getElementById("appointment-status").value,
      notes: document.getElementById("appointment-notes").value
    };
  }

  async function loadAppointments() {
    const range = visibleRange();
    const from = localDateTimeString(range.from);
    const to = localDateTimeString(range.to);
    const doctorId = document.getElementById("doctor-filter").value;
    const status = document.getElementById("status-filter").value;
    state.appointments = await window.DrRosaApi.getAppointments({
      from,
      to,
      doctor_id: doctorId,
      status
    });
    renderCalendar();
  }

  async function loadInitialData() {
    const [patients, doctors, chairs, procedures] = await Promise.all([
      window.DrRosaApi.getPatients(),
      window.DrRosaApi.getDoctors(),
      window.DrRosaApi.getChairs(),
      window.DrRosaApi.getCodebooks("procedure")
    ]);
    state.patients = patients;
    state.doctors = doctors;
    state.chairs = chairs;
    state.procedures = procedures;
    fillSelects();
    closePanel();
    await loadAppointments();
  }

  function bindEvents() {
    document.getElementById("prev-period").addEventListener("click", async () => {
      state.currentDate = state.viewMode === "month" ? addMonths(state.currentDate, -1) : addDays(state.currentDate, state.viewMode === "day" ? -1 : -7);
      await loadAppointments();
    });
    document.getElementById("next-period").addEventListener("click", async () => {
      state.currentDate = state.viewMode === "month" ? addMonths(state.currentDate, 1) : addDays(state.currentDate, state.viewMode === "day" ? 1 : 7);
      await loadAppointments();
    });
    document.getElementById("today-btn").addEventListener("click", async () => {
      state.currentDate = new Date();
      await loadAppointments();
    });
    document.getElementById("calendar-view").addEventListener("change", async event => {
      state.viewMode = event.target.value;
      closePanel();
      await loadAppointments();
    });
    document.getElementById("new-appointment-btn").addEventListener("click", () => resetForm(new Date()));
    document.getElementById("dismiss-appointment-btn").addEventListener("click", closePanel);
    document.getElementById("close-appointment-modal").addEventListener("click", closePanel);
    document.getElementById("appointment-panel").addEventListener("click", event => {
      if (event.target.matches("[data-close-appointment-modal]")) closePanel();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !document.getElementById("appointment-panel").hidden) closePanel();
    });
    document.getElementById("doctor-filter").addEventListener("change", loadAppointments);
    document.getElementById("status-filter").addEventListener("change", loadAppointments);
    document.getElementById("calendar-board").addEventListener("click", event => {
      const appointmentButton = event.target.closest("[data-appointment-id]");
      if (appointmentButton) {
        editAppointment(appointmentButton.dataset.appointmentId);
        return;
      }
      const dayButton = event.target.closest("[data-date]");
      if (dayButton) resetForm(new Date(`${dayButton.dataset.date}T09:00:00`));
    });
    document.getElementById("appointment-form").addEventListener("submit", async event => {
      event.preventDefault();
      const appointmentId = document.getElementById("appointment-id").value;
      try {
        const saved = appointmentId
          ? await window.DrRosaApi.updateAppointment(appointmentId, formPayload())
          : await window.DrRosaApi.createAppointment(formPayload());
        await loadAppointments();
        editAppointment(saved.id);
        setAlert("Termin je sacuvan.", "success");
      } catch (error) {
        setAlert(error.message, "error");
      }
    });
    document.getElementById("cancel-appointment-btn").addEventListener("click", async () => {
      const appointmentId = document.getElementById("appointment-id").value;
      if (!appointmentId) return;
      await window.DrRosaApi.deleteAppointment(appointmentId, { hard: true });
      setAlert("Termin je obrisan.", "success");
      await loadAppointments();
      closePanel();
    });
    document.getElementById("create-visit-btn").addEventListener("click", async () => {
      const appointmentId = document.getElementById("appointment-id").value;
      if (!appointmentId) return;
      try {
        await window.DrRosaApi.createVisitFromAppointment(appointmentId);
        setAlert("Poseta je kreirana iz termina.", "success");
        await loadAppointments();
        editAppointment(appointmentId);
      } catch (error) {
        setAlert(error.message, "error");
      }
    });
  }

  (async function initCalendar() {
    if (!await requireAccess()) return;
    bindEvents();
    try {
      await loadInitialData();
    } catch (error) {
      setAlert(error.message, "error");
    }
  })();
})();
