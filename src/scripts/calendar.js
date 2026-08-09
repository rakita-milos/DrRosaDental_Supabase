(function () {
  const STATUS_LABELS = {
    scheduled: "Zakazano",
    confirmed: "Potvrdjeno",
    arrived: "Došao",
    completed: "Završeno",
    cancelled: "Otkazano",
    no_show: "Nije došao"
  };
  const DAY_NAMES = ["Pon", "Uto", "Sre", "Cet", "Pet", "Sub", "Ned"];
  const VIEW_MODES = new Set(["day", "week", "month"]);
  const CALENDAR_VIEW_STORAGE_KEY = "drrosa-calendar-view";
  const urlParams = new URLSearchParams(window.location.search);
  const patientIdParam = urlParams.get("patientId") || urlParams.get("id");
  const patientNameParam = urlParams.get("patient");
  const state = {
    currentDate: new Date(),
    viewMode: "week",
    appointments: [],
    records: [],
    patients: [],
    doctors: [],
    chairs: [],
    procedures: []
  };

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function dateKey(date) {
    return window.DrRosaDateUtils.isoDateKey(date);
  }

  function localDateTimeString(date) {
    return window.DrRosaDateUtils.localDateTimeString(date);
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

  function calendarViewControl() {
    return document.getElementById("calendar-view");
  }

  function validViewMode(value) {
    return VIEW_MODES.has(String(value || "")) ? String(value) : "";
  }

  function setCalendarViewMode(value, { persist = false } = {}) {
    const mode = validViewMode(value) || "week";
    state.viewMode = mode;
    const control = calendarViewControl();
    if (control && control.value !== mode) control.value = mode;
    if (persist) {
      try {
        window.localStorage?.setItem(CALENDAR_VIEW_STORAGE_KEY, mode);
      } catch {
        // Browser storage can be disabled; calendar still works with in-memory state.
      }
    }
  }

  function initializeCalendarViewMode() {
    let savedMode = "";
    try {
      savedMode = validViewMode(window.localStorage?.getItem(CALENDAR_VIEW_STORAGE_KEY));
    } catch {
      savedMode = "";
    }
    setCalendarViewMode(validViewMode(calendarViewControl()?.value) || savedMode || state.viewMode);
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

  function visibleSyncRange() {
    const range = visibleRange();
    return {
      timeMin: range.from.toISOString(),
      timeMax: range.to.toISOString()
    };
  }

  function setAlert(message, type = "info") {
    const alert = document.getElementById("appointment-alert");
    alert.textContent = message || "";
    alert.className = `form-alert ${type ? `alert-${type}` : ""}`;
  }

  function setGoogleSyncStatus(message = "", type = "") {
    const status = document.getElementById("google-sync-status");
    if (!status) return;
    status.textContent = message;
    status.className = `google-sync-status ${type || ""}`.trim();
  }

  function googleSyncMessage(result = {}) {
    const warnings = Number(result.warningTotal || result.importedWithWarning || 0);
    const conflictWarnings = Number(result.conflictWarningTotal || result.conflicts || 0);
    const skipped = Number(result.skippedTotal || 0)
      || Number(result.skippedExternal || 0)
      + Number(result.skippedMissingLocal || 0)
      + Number(result.skippedUnsupportedTime || 0)
      + Number(result.skippedConflicts || 0);
    const parts = [
      `Procitano: ${Number(result.fetched || 0)}`,
      `uvezeno: ${Number(result.imported || 0)}`,
      `azurirano: ${Number(result.updated || 0)}`,
      `uvezeno/ažurirano sa upozorenjem: ${warnings}`,
      `all-day: ${Number(result.allDayEvents || 0)}`,
      `konflikti rasporeda kao upozorenje: ${conflictWarnings}`,
      `preskoceno: ${skipped}`
    ];
    const doctorConflicts = Number(result.doctorConflictWarnings || 0);
    const chairConflicts = Number(result.chairConflictWarnings || 0);
    if (doctorConflicts || chairConflicts) {
      parts.push(`detalji konflikata: doktor ${doctorConflicts}, stolica ${chairConflicts}`);
    }
    if (result.partial) parts.push("NIJE zavrseno sve - pokrenite sync ponovo");
    return parts.join(", ");
  }

  function googleSyncStatsFromJob(job = {}) {
    return job.progress || job.result || {
      fetched: job.fetched,
      imported: job.imported,
      updated: job.updated,
      cancelled: job.cancelled,
      unchanged: job.unchanged,
      importedWithWarning: job.importedWithWarning,
      allDayEvents: job.allDayEvents,
      conflicts: job.conflicts,
      invalidTime: job.invalidTime,
      partial: job.partial
    };
  }

  function wait(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }

  async function runGoogleSyncJob(jobId) {
    let currentJobId = jobId;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const result = await window.DrRosaApi.stepGoogleCalendarSync({ jobId: currentJobId });
      currentJobId = result?.job?.id || currentJobId;
      const stats = result?.stats || googleSyncStatsFromJob(result?.job);
      if (stats) {
        setGoogleSyncStatus(`Google sync je u toku. ${googleSyncMessage(stats)}.`, "info");
      }
      if (!result?.running) return stats || googleSyncStatsFromJob(result?.job);
      await wait(1200);
    }
    throw new Error("Google sync i dalje traje. Proverite status za nekoliko sekundi.");
  }

  function setGoogleSyncLoading(isLoading) {
    const button = document.getElementById("google-calendar-sync-btn");
    const label = button?.querySelector("[data-google-sync-label]");
    if (!button || !label) return;
    button.disabled = isLoading;
    button.classList.toggle("is-loading", isLoading);
    label.textContent = isLoading ? "Sinhronizacija..." : "Sync Google";
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function hexColor(value, fallback = "") {
    const text = String(value || "").trim();
    return /^#[0-9a-fA-F]{6}$/.test(text) ? text : fallback;
  }

  function appointmentColorStyle(appointment) {
    const background = hexColor(appointment.doctorCalendarColor);
    const foreground = hexColor(appointment.doctorCalendarTextColor, "#ffffff");
    if (!background) return "";
    return ` style="border-left-color:${background}; background:${background}; color:${foreground};"`;
  }

  function appointmentInlineColor(appointment) {
    const background = hexColor(appointment.doctorCalendarColor);
    const foreground = hexColor(appointment.doctorCalendarTextColor, "#ffffff");
    if (!background) return "";
    return `border-left-color:${background}; background:${background}; color:${foreground};`;
  }

  function appointmentUiClass(appointment, baseClass) {
    return [
      baseClass,
      `appointment-${appointment.status}`,
      appointment.googleEventType && appointment.googleEventType !== "appointment" ? "google-event-note" : "",
      isDoctorAbsenceEvent(appointment) ? "doctor-absence-event" : "",
      appointment.googleSyncWarning ? "google-event-warning" : ""
    ].filter(Boolean).join(" ");
  }

  function googleWarningLine(appointment) {
    if (!appointment.googleSyncWarning) return "";
    const label = appointment.googleSyncWarningCode === "all_day_event" ? "Google event" : "Za proveru";
    return `<small class="google-warning-line">${label}: ${window.DrRosaSecurity.escapeHtml(appointment.googleSyncWarning)}</small>`;
  }

  function appointmentDisplayTitle(appointment) {
    return normalizeText(appointment.googleTitle || appointment.procedureName || "Termin");
  }

  function appointmentDoctorLine(appointment) {
    return normalizeText(appointment.doctorName);
  }

  function appointmentTimeLine(starts, ends, { compact = false } = {}) {
    const separator = compact ? "-" : " - ";
    return `${pad(starts.getHours())}:${pad(starts.getMinutes())}${separator}${pad(ends.getHours())}:${pad(ends.getMinutes())}`;
  }

  function displayEndDateForGoogleEvent(appointment) {
    const ends = parseLocalDateTime(appointment.endsAt);
    if (!appointment.googleEventType || appointment.googleEventType === "appointment") return ends;
    if (ends.getHours() === 0 && ends.getMinutes() === 0 && ends.getSeconds() === 0) {
      return addDays(ends, -1);
    }
    return ends;
  }

  function googleEventDateRangeLine(appointment) {
    const starts = parseLocalDateTime(appointment.startsAt);
    const ends = displayEndDateForGoogleEvent(appointment);
    const from = window.DrRosaDateUtils.formatDate(starts);
    const to = window.DrRosaDateUtils.formatDate(ends);
    return from === to ? from : `${from} - ${to}`;
  }

  function compactAppointmentMarkup(appointment, starts, ends, options = {}) {
    const title = appointmentDisplayTitle(appointment);
    const doctor = appointmentDoctorLine(appointment);
    return `
      <span class="appointment-time">${appointmentTimeLine(starts, ends, options)}</span>
      <strong class="appointment-title-line" title="${window.DrRosaSecurity.escapeAttribute(title)}">${window.DrRosaSecurity.escapeHtml(title)}</strong>
      ${doctor ? `<small class="appointment-doctor-line">${window.DrRosaSecurity.escapeHtml(doctor)}</small>` : ""}
      ${appointment.googleSyncWarning ? `<span class="appointment-warning-marker" aria-label="Google upozorenje">!</span>` : ""}
    `;
  }

  function googleEventMarkup(appointment) {
    const isAbsence = isDoctorAbsenceEvent(appointment);
    const title = appointmentDisplayTitle(appointment);
    const doctor = appointmentDoctorLine(appointment);
    return `
      <span class="google-event-type">${isAbsence ? "GO" : "Google napomena"}</span>
      <strong class="appointment-title-line" title="${window.DrRosaSecurity.escapeAttribute(title)}">${window.DrRosaSecurity.escapeHtml(isAbsence && doctor ? doctor : title)}</strong>
      <small class="google-event-date-range">${googleEventDateRangeLine(appointment)}</small>
      ${isAbsence && title ? `<small class="appointment-doctor-line">${window.DrRosaSecurity.escapeHtml(title)}</small>` : ""}
      ${!isAbsence && doctor ? `<small class="appointment-doctor-line">${window.DrRosaSecurity.escapeHtml(doctor)}</small>` : ""}
      ${appointment.googleSyncWarning ? `<span class="appointment-warning-marker" aria-label="Google upozorenje">!</span>` : ""}
    `;
  }

  function renderGooglePatientMatchMessage(appointment = null) {
    const box = document.getElementById("appointment-google-patient-match");
    if (!box) return;
    const note = appointment?.googlePatientMatchNote;
    if (!appointment?.googleEventId || !note) {
      box.hidden = true;
      box.textContent = "";
      box.className = "google-patient-match-message";
      return;
    }
    const status = appointment.googlePatientMatchStatus || "not_found";
    box.hidden = false;
    box.className = `google-patient-match-message google-patient-match-${status}`;
    box.innerHTML = `
      <strong>Google pacijent</strong>
      <span>${window.DrRosaSecurity.escapeHtml(note)}</span>
      ${appointment.googleTitle ? `<small>Naslov: ${window.DrRosaSecurity.escapeHtml(appointment.googleTitle)}</small>` : ""}
    `;
  }

  function hasCodeLikeContent(value) {
    const text = String(value || "");
    return /[<>`{}]/.test(text)
      || /\bjavascript\s*:/i.test(text)
      || /\bon[a-z]+\s*=/i.test(text)
      || /\b(select|insert|update|delete|drop|alter|union|exec)\b[\s\S]*\b(from|into|table|set|where)\b/i.test(text);
  }

  function normalizeFormInputs() {
    const title = document.getElementById("appointment-title");
    const notes = document.getElementById("appointment-notes");
    if (title) title.value = normalizeText(title.value);
    if (notes) notes.value = normalizeText(notes.value);
  }

  function fillTitleFromProcedureIfEmpty() {
    const title = document.getElementById("appointment-title");
    const procedureSelect = document.getElementById("appointment-procedure");
    if (!title || !procedureSelect || title.value.trim()) return;
    const selectedProcedure = procedureSelect.selectedOptions[0];
    title.value = selectedProcedure?.dataset.name || selectedProcedure?.textContent || "";
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
    return items.map(item => `<option value="${window.DrRosaSecurity.escapeAttribute(item[value])}">${window.DrRosaSecurity.escapeHtml(item[label])}</option>`).join("");
  }

  function formatMoney(amount, currency = "EUR") {
    return window.DrRosaCurrencyUtils
      ? window.DrRosaCurrencyUtils.formatMoney(amount, currency)
      : `${Number(amount || 0).toFixed(2)} ${currency}`;
  }

  function recordForAppointment(appointment) {
    if (!appointment?.visitRecordId) return null;
    return state.records.find(record => String(record.id) === String(appointment.visitRecordId)) || null;
  }

  function paymentLine(appointment) {
    const record = recordForAppointment(appointment);
    if (!record) return "";
    const currency = record.currency || "EUR";
    const paid = Number(record.amountPaid || 0);
    const due = Number(record.amountDue || 0);
    return `<small class="appointment-payment">Plaćeno: ${formatMoney(paid, currency)}${due > 0 ? ` / Dug: ${formatMoney(due, currency)}` : ""}</small>`;
  }

  function fillSelects() {
    document.getElementById("doctor-filter").innerHTML = `<option value="">Svi doktori</option>${optionList(state.doctors)}`;
    document.getElementById("appointment-doctor").innerHTML = optionList(state.doctors);
    document.getElementById("appointment-chair").innerHTML = optionList(state.chairs);
    document.getElementById("appointment-patient").innerHTML = optionList(state.patients, { label: "fullName" });
    document.getElementById("appointment-procedure").innerHTML = state.procedures
      .map(item => `<option value="${window.DrRosaSecurity.escapeAttribute(item.id)}" data-name="${window.DrRosaSecurity.escapeAttribute(item.value)}">${window.DrRosaSecurity.escapeHtml(item.label)}</option>`)
      .join("");
  }

  function renderTitle() {
    if (state.viewMode === "day") {
      document.getElementById("calendar-title").textContent = window.DrRosaDateUtils.formatDate(state.currentDate);
      return;
    }
    if (state.viewMode === "month") {
      const start = startOfMonth(state.currentDate);
      const end = addDays(endOfMonth(state.currentDate), -1);
      document.getElementById("calendar-title").textContent = `${window.DrRosaDateUtils.formatDate(start)} - ${window.DrRosaDateUtils.formatDate(end)}`;
      return;
    }
    const start = startOfWeek(state.currentDate);
    const end = addDays(start, 6);
    document.getElementById("calendar-title").textContent = `${window.DrRosaDateUtils.formatDate(start)} - ${window.DrRosaDateUtils.formatDate(end)}`;
  }

  function renderCalendar() {
    renderTitle();
    setCalendarViewMode(state.viewMode);
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
    board.innerHTML = renderMonthSchedule(days);
  }

  function appointmentsForDay(day) {
    const dayStart = new Date(day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = addDays(dayStart, 1);
    return state.appointments
      .filter(item => parseLocalDateTime(item.startsAt) < dayEnd && parseLocalDateTime(item.endsAt) > dayStart)
      .sort((a, b) => parseLocalDateTime(a.startsAt) - parseLocalDateTime(b.startsAt));
  }

  function isDoctorAbsenceEvent(appointment) {
    if (appointment.googleEventType === "doctor_absence") return true;
    if (!appointment.googleEventId || appointment.googleEventType === "appointment") return false;
    const text = String([
      appointment.googleTitle,
      appointment.procedureName,
      appointment.notes
    ].filter(Boolean).join(" "))
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    if (!/\b(go|godisnji|godisnji odmor|odmor)\b/.test(text)) return false;
    const starts = parseLocalDateTime(appointment.startsAt);
    const ends = parseLocalDateTime(appointment.endsAt);
    const durationHours = (ends - starts) / 3600000;
    return durationHours >= 12 || (starts.getHours() === 0 && starts.getMinutes() === 0);
  }

  function isGoogleNoteEvent(appointment) {
    return appointment.googleEventType && appointment.googleEventType !== "appointment";
  }

  function activeChairs() {
    return state.chairs.length ? state.chairs : [{ id: "", name: "Stolica" }];
  }

  function chairLabel(appointment) {
    const chair = state.chairs.find(item => String(item.id) === String(appointment.chairId));
    return chair?.name || appointment.chairName || "Stolica";
  }

  function chairShortLabel(appointment) {
    const label = chairLabel(appointment);
    const match = label.match(/\d+/);
    return match ? `S${match[0]}` : label.slice(0, 2).toUpperCase();
  }

  function renderMonthItems(appointments) {
    const visibleItems = appointments.filter(appointment => !isDoctorAbsenceEvent(appointment));
    if (!visibleItems.length) return `<p class="empty-row">Slobodno</p>`;
    return `
      ${visibleItems.map(renderCalendarItem).join("")}
    `;
  }

  function renderCalendarItem(appointment) {
    return isGoogleNoteEvent(appointment)
      ? renderGoogleEventCard(appointment, "appointment-compact month-google-event")
      : renderCompactAppointment(appointment);
  }

  function renderMonthSchedule(days) {
    const weeks = Array.from({ length: Math.ceil(days.length / 7) }, (_, index) => days.slice(index * 7, index * 7 + 7));
    return weeks.map(renderMonthWeek).join("");
  }

  function renderMonthWeek(days) {
    return `
      <section class="month-week">
        <div class="month-week-days">
          ${days.map(renderMonthDay).join("")}
        </div>
        ${renderMonthAbsenceLane(days)}
      </section>
    `;
  }

  function renderMonthDay(day, index) {
    const key = dateKey(day);
    const dayAppointments = appointmentsForDay(day);
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
  }

  function renderMonthAbsenceLane(days) {
    const absences = weekVisibleAbsences(days);
    if (!absences.length) return "";
    return `
      <div class="month-absence-lane">
        ${absences.map(appointment => renderMonthAbsenceBar(appointment, days)).join("")}
      </div>
    `;
  }

  function renderMonthAbsenceBar(appointment, days) {
    const title = appointmentDisplayTitle(appointment);
    const doctor = appointmentDoctorLine(appointment);
    const label = doctor || title || "Godišnji";
    return `
      <button class="${appointmentUiClass(appointment, "month-absence-bar")}" type="button" data-appointment-id="${appointment.id}" style="grid-column:${absenceGridColumn(appointment, days, 1)};${appointmentInlineColor(appointment)}">
        <span>GO</span>
        <strong title="${window.DrRosaSecurity.escapeAttribute(title)}">${window.DrRosaSecurity.escapeHtml(label)}</strong>
        <small>${googleEventDateRangeLine(appointment)}</small>
      </button>
    `;
  }

  function renderWeekSchedule(days) {
    const hours = Array.from({ length: 13 }, (_, index) => 8 + index);
    const chairs = activeChairs();
    return `
      <div class="week-grid">
        <div class="week-corner"></div>
        ${days.map(renderWeekDayHeading).join("")}
        ${renderWeekAbsenceLane(days)}
        ${hours.map(hour => `
          <div class="week-hour">${pad(hour)}:00</div>
          ${days.map(day => renderWeekSlot(day, hour, chairs)).join("")}
        `).join("")}
      </div>
      <div class="week-agenda">
        ${days.map(day => renderWeekAgendaDay(day, chairs)).join("")}
      </div>
    `;
  }

  function renderWeekDayHeading(day, index) {
    const noteEvents = appointmentsForDay(day).filter(appointment => isGoogleNoteEvent(appointment) && !isDoctorAbsenceEvent(appointment));
    return `
      <div class="week-day-heading-cell">
        <button class="week-day-heading" type="button" data-date="${dateKey(day)}">
          <span>${DAY_NAMES[index]}</span>
          <strong>${day.getDate()}</strong>
        </button>
        ${noteEvents.length ? `
          <div class="week-heading-notes">
            ${noteEvents.map(appointment => renderGoogleEventCard(appointment, "week-absence-card")).join("")}
          </div>
        ` : ""}
      </div>
    `;
  }

  function weekVisibleAbsences(days) {
    const weekStart = new Date(days[0]);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = addDays(new Date(days[days.length - 1]), 1);
    return state.appointments
      .filter(isDoctorAbsenceEvent)
      .filter(appointment => parseLocalDateTime(appointment.startsAt) < weekEnd && parseLocalDateTime(appointment.endsAt) > weekStart)
      .sort((a, b) => parseLocalDateTime(a.startsAt) - parseLocalDateTime(b.startsAt));
  }

  function weekAbsenceGridColumn(appointment, days) {
    return absenceGridColumn(appointment, days, 2);
  }

  function absenceGridColumn(appointment, days, offset = 1) {
    const starts = parseLocalDateTime(appointment.startsAt);
    const ends = parseLocalDateTime(appointment.endsAt);
    const firstIndex = days.findIndex(day => {
      const dayStart = new Date(day);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = addDays(dayStart, 1);
      return starts < dayEnd && ends > dayStart;
    });
    const lastIndexFromEnd = [...days].reverse().findIndex(day => {
      const dayStart = new Date(day);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = addDays(dayStart, 1);
      return starts < dayEnd && ends > dayStart;
    });
    const start = Math.max(0, firstIndex);
    const end = days.length - Math.max(0, lastIndexFromEnd) - 1;
    return `${start + offset} / ${end + offset + 1}`;
  }

  function renderWeekAbsenceLane(days) {
    const absences = weekVisibleAbsences(days);
    if (!absences.length) return "";
    return `
      <div class="week-absence-lane">
        <span class="week-absence-lane-label">GO</span>
        ${absences.map(appointment => renderWeekAbsenceBar(appointment, days)).join("")}
      </div>
    `;
  }

  function renderWeekAbsenceBar(appointment, days) {
    const title = appointmentDisplayTitle(appointment);
    const doctor = appointmentDoctorLine(appointment);
    const label = doctor || title || "Godišnji";
    return `
      <button class="${appointmentUiClass(appointment, "week-absence-bar")}" type="button" data-appointment-id="${appointment.id}" style="grid-column:${weekAbsenceGridColumn(appointment, days)};${appointmentInlineColor(appointment)}">
        <span>GO</span>
        <strong title="${window.DrRosaSecurity.escapeAttribute(title)}">${window.DrRosaSecurity.escapeHtml(label)}</strong>
        <small>${googleEventDateRangeLine(appointment)}</small>
      </button>
    `;
  }

  function renderWeekAgendaDay(day, chairs = activeChairs()) {
    const appointments = appointmentsForDay(day);
    const noteEvents = appointments.filter(isGoogleNoteEvent);
    const chairAppointments = appointments.filter(appointment => !isGoogleNoteEvent(appointment));
    return `
      <section class="week-agenda-day" data-date="${dateKey(day)}">
        <button class="week-agenda-heading" type="button" data-date="${dateKey(day)}">
          <span>${DAY_NAMES[(day.getDay() || 7) - 1]}</span>
          <strong>${window.DrRosaDateUtils.formatDate(day)}</strong>
        </button>
        ${noteEvents.length ? `
          <div class="week-google-notes">
            ${noteEvents.map(appointment => renderGoogleEventCard(appointment, "agenda-appointment")).join("")}
          </div>
        ` : ""}
        <div class="week-agenda-chair-columns" style="--chair-count:${chairs.length}">
          ${chairs.map(chair => {
            const chairItems = chairAppointments.filter(appointment => String(appointment.chairId) === String(chair.id));
            return `
              <div class="week-agenda-chair" data-chair-id="${window.DrRosaSecurity.escapeAttribute(chair.id)}">
                <div class="week-agenda-chair-header">
                  <span>${window.DrRosaSecurity.escapeHtml(chair.name)}</span>
                  <strong>${chairItems.length}</strong>
                </div>
                <div class="week-agenda-list">
                  ${chairItems.length ? chairItems.map(renderAgendaAppointment).join("") : `<button class="empty-day-agenda" type="button" data-date="${dateKey(day)}" data-chair-id="${window.DrRosaSecurity.escapeAttribute(chair.id)}">Slobodno</button>`}
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </section>
    `;
  }

  function renderWeekSlot(day, hour, chairs = activeChairs()) {
    const slotAppointments = appointmentsForDay(day).filter(appointment => !isGoogleNoteEvent(appointment));
    return `
      <div class="week-slot" data-date="${dateKey(day)}" data-hour="${hour}">
        <div class="week-chair-mini-columns" style="--chair-count:${chairs.length}">
          ${chairs.map(chair => renderWeekChairCell(day, hour, chair, slotAppointments)).join("")}
        </div>
      </div>
    `;
  }

  function renderWeekChairCell(day, hour, chair, appointments) {
    const chairItems = appointments.filter(appointment => {
      const starts = parseLocalDateTime(appointment.startsAt);
      return String(appointment.chairId) === String(chair.id) && starts.getHours() === hour;
    });
    return `
      <div class="week-chair-cell" data-date="${dateKey(day)}" data-hour="${hour}" data-chair-id="${window.DrRosaSecurity.escapeAttribute(chair.id)}">
        <span class="week-chair-cell-label">${window.DrRosaSecurity.escapeHtml(chair.name)}</span>
        ${chairItems.map(renderWeekAppointment).join("")}
      </div>
    `;
  }

  function renderDayAgenda(day) {
    const appointments = appointmentsForDay(day);
    const noteEvents = appointments.filter(isGoogleNoteEvent);
    const chairAppointments = appointments.filter(appointment => !isGoogleNoteEvent(appointment));
    const chairs = activeChairs();
    const hours = Array.from({ length: 13 }, (_, index) => 8 + index);
    return `
      <div class="day-chair-board" data-date="${dateKey(day)}">
        ${noteEvents.length ? `
          <section class="google-day-notes" aria-label="Odsustva i Google napomene">
            <div class="google-day-notes-header">
              <span>Odsustva i napomene</span>
              <strong>${noteEvents.length}</strong>
            </div>
            <div class="google-day-notes-list">
              ${noteEvents.map(appointment => renderGoogleEventCard(appointment, "agenda-appointment")).join("")}
            </div>
          </section>
        ` : ""}
        <div class="day-chair-switch" aria-label="Izbor stolice">
          ${chairs.map((chair, index) => `
            <button class="${index === 0 ? "is-active" : ""}" type="button" data-chair-tab="${chair.id}">
              ${window.DrRosaSecurity.escapeHtml(chair.name)}
            </button>
          `).join("")}
        </div>
        <div class="day-chair-columns" style="--chair-count:${chairs.length}">
          ${chairs.map(chair => `
            <section class="day-chair-column" data-chair-id="${chair.id}">
              <header class="day-chair-header">
                <span>${window.DrRosaSecurity.escapeHtml(chair.name)}</span>
                <strong>${chairAppointments.filter(appointment => String(appointment.chairId) === String(chair.id)).length}</strong>
              </header>
              <div class="day-chair-slots">
                ${hours.map(hour => renderChairSlot(day, chair, hour, chairAppointments)).join("")}
              </div>
            </section>
          `).join("")}
        </div>
      </div>
    `;
  }

  function renderChairSlot(day, chair, hour, appointments) {
    const slotAppointments = appointments.filter(appointment => {
      const starts = parseLocalDateTime(appointment.startsAt);
      return String(appointment.chairId) === String(chair.id) && starts.getHours() === hour;
    });
    return `
      <div class="day-chair-slot" data-date="${dateKey(day)}" data-hour="${hour}" data-chair-id="${chair.id}">
        <button class="day-chair-slot-time" type="button" data-date="${dateKey(day)}" data-hour="${hour}" data-chair-id="${chair.id}">
          ${pad(hour)}:00
        </button>
        <div class="day-chair-slot-items">
          ${slotAppointments.length ? slotAppointments.map(renderAgendaAppointment).join("") : `<button class="empty-day-agenda" type="button" data-date="${dateKey(day)}" data-hour="${hour}" data-chair-id="${chair.id}">Slobodno</button>`}
        </div>
      </div>
    `;
  }

  function renderCompactAppointment(appointment) {
    const starts = parseLocalDateTime(appointment.startsAt);
    const ends = appointment.endsAt
      ? parseLocalDateTime(appointment.endsAt)
      : new Date(starts.getTime() + Number(appointment.durationMinutes || 30) * 60000);
    return `
      <button class="${appointmentUiClass(appointment, "appointment-compact")}" type="button" data-appointment-id="${appointment.id}"${appointmentColorStyle(appointment)}>
        ${compactAppointmentMarkup(appointment, starts, ends)}
      </button>
    `;
  }

  function renderGoogleEventCard(appointment, baseClass = "agenda-appointment") {
    return `
      <button class="${appointmentUiClass(appointment, baseClass)}" type="button" data-appointment-id="${appointment.id}"${appointmentColorStyle(appointment)}>
        ${googleEventMarkup(appointment)}
      </button>
    `;
  }

  function renderWeekAppointment(appointment) {
    const starts = parseLocalDateTime(appointment.startsAt);
    const ends = appointment.endsAt
      ? parseLocalDateTime(appointment.endsAt)
      : new Date(starts.getTime() + Number(appointment.durationMinutes || 30) * 60000);
    return `
      <button class="${appointmentUiClass(appointment, "week-appointment")}" type="button" data-appointment-id="${appointment.id}"${appointmentColorStyle(appointment)}>
        ${compactAppointmentMarkup(appointment, starts, ends, { compact: true })}
      </button>
    `;
  }

  function renderAgendaAppointment(appointment) {
    const starts = parseLocalDateTime(appointment.startsAt);
    const ends = appointment.endsAt
      ? parseLocalDateTime(appointment.endsAt)
      : new Date(starts.getTime() + Number(appointment.durationMinutes || 30) * 60000);
    return `
      <button class="${appointmentUiClass(appointment, "agenda-appointment")}" type="button" data-appointment-id="${appointment.id}"${appointmentColorStyle(appointment)}>
        ${compactAppointmentMarkup(appointment, starts, ends)}
      </button>
    `;
  }

  function renderAppointmentCard(appointment) {
    const starts = parseLocalDateTime(appointment.startsAt);
    const ends = appointment.endsAt
      ? parseLocalDateTime(appointment.endsAt)
      : new Date(starts.getTime() + Number(appointment.durationMinutes || 30) * 60000);
    return `
      <button class="${appointmentUiClass(appointment, "appointment-card")}" type="button" data-appointment-id="${appointment.id}"${appointmentColorStyle(appointment)}>
        ${compactAppointmentMarkup(appointment, starts, ends)}
      </button>
    `;
  }

  function resetForm(date = new Date(), options = {}) {
    openPanel();
    const context = document.getElementById("appointment-patient-context");
    const patientSelect = document.getElementById("appointment-patient");
    if (context) {
      context.hidden = true;
      context.innerHTML = "";
    }
    renderGooglePatientMatchMessage(null);
    patientSelect?.classList.remove("locked-patient-input");
    document.getElementById("appointment-panel-title").textContent = "Novi termin";
    document.getElementById("appointment-id").value = "";
    document.getElementById("appointment-title").value = "";
    document.getElementById("appointment-date").value = dateKey(date);
    document.getElementById("appointment-time").value = "09:00";
    document.getElementById("appointment-duration").value = "30";
    document.getElementById("appointment-status").value = "scheduled";
    document.getElementById("appointment-notes").value = "";
    fillTitleFromProcedureIfEmpty();
    if (options.chairId) document.getElementById("appointment-chair").value = options.chairId;
    if (Number.isInteger(options.hour)) document.getElementById("appointment-time").value = `${pad(options.hour)}:00`;
    document.getElementById("create-visit-btn").disabled = true;
    document.getElementById("cancel-appointment-btn").hidden = true;
    document.getElementById("cancel-appointment-btn").disabled = true;
    setAlert("");
  }

  function applyPatientQueryPreset() {
    if (!patientIdParam && !patientNameParam) return;
    const patient = patientIdParam
      ? state.patients.find(item => String(item.id) === String(patientIdParam))
      : state.patients.find(item => String(item.fullName || "").toLowerCase() === String(patientNameParam || "").toLowerCase());
    if (!patient) return;
    resetForm(new Date());
    const patientSelect = document.getElementById("appointment-patient");
    const context = document.getElementById("appointment-patient-context");
    patientSelect.value = patient.id;
    patientSelect.classList.add("locked-patient-input");
    if (context) {
      context.hidden = false;
      context.innerHTML = `
        <div>
          <span>Zakazivanje za pacijenta</span>
          <strong>${window.DrRosaSecurity.escapeHtml(patient.fullName)}</strong>
          <small>${window.DrRosaSecurity.escapeHtml([patient.phone, patient.email].filter(Boolean).join(" / ") || "Kontakt nije unet")}</small>
        </div>
        <a class="secondary-btn" href="patient-dashboard.html?patientId=${encodeURIComponent(patient.id)}">Karton</a>
      `;
    }
    document.getElementById("appointment-panel-title").textContent = `Novi termin - ${patient.fullName}`;
    setAlert("Pacijent je unapred izabran iz kartona.", "info");
  }

  function editAppointment(id) {
    const appointment = state.appointments.find(item => String(item.id) === String(id));
    if (!appointment) return;
    openPanel();
    const starts = parseLocalDateTime(appointment.startsAt);
    document.getElementById("appointment-panel-title").textContent = "Izmena termina";
    document.getElementById("appointment-id").value = appointment.id;
    document.getElementById("appointment-title").value = appointment.googleTitle || appointment.procedureName || "";
    document.getElementById("appointment-patient").value = appointment.patientId;
    document.getElementById("appointment-doctor").value = appointment.doctorId;
    document.getElementById("appointment-chair").value = appointment.chairId;
    document.getElementById("appointment-procedure").value = appointment.procedureId || "";
    document.getElementById("appointment-date").value = dateKey(starts);
    document.getElementById("appointment-time").value = `${pad(starts.getHours())}:${pad(starts.getMinutes())}`;
    document.getElementById("appointment-duration").value = String(appointment.durationMinutes || 30);
    document.getElementById("appointment-status").value = appointment.status;
    document.getElementById("appointment-notes").value = appointment.notes || "";
    renderGooglePatientMatchMessage(appointment);
    const isGoogleOnlyEvent = isGoogleNoteEvent(appointment);
    document.getElementById("create-visit-btn").disabled = Boolean(appointment.visitRecordId) || appointment.status === "cancelled" || isGoogleOnlyEvent;
    document.getElementById("cancel-appointment-btn").hidden = false;
    document.getElementById("cancel-appointment-btn").disabled = appointment.status === "cancelled";
    if (isDoctorAbsenceEvent(appointment)) {
      setAlert(`Godišnji/odsustvo: ${googleEventDateRangeLine(appointment)}. Ovaj Google dogadjaj ne blokira stolice.`, "info");
    } else if (isGoogleOnlyEvent) {
      setAlert(`Google napomena: ${googleEventDateRangeLine(appointment)}. Ovaj dogadjaj nije termin pacijenta.`, "info");
    } else {
      setAlert(`Google sinhronizacija: ${appointment.googleSyncStatus || "not_synced"}`, "info");
    }
  }

  function formPayload() {
    normalizeFormInputs();
    const date = document.getElementById("appointment-date").value;
    const time = document.getElementById("appointment-time").value;
    const duration = Number(document.getElementById("appointment-duration").value || 30);
    const start = localInputDateTime(date, time);
    const end = new Date(start.getTime() + duration * 60000);
    const procedureSelect = document.getElementById("appointment-procedure");
    const selectedProcedure = procedureSelect.selectedOptions[0];
    const title = normalizeText(document.getElementById("appointment-title").value)
      || selectedProcedure?.dataset.name
      || selectedProcedure?.textContent
      || "Kontrola";
    return {
      patient_id: Number(document.getElementById("appointment-patient").value),
      doctor_id: Number(document.getElementById("appointment-doctor").value),
      chair_id: Number(document.getElementById("appointment-chair").value),
      procedure_id: Number(procedureSelect.value) || null,
      procedure_name: title,
      starts_at: localDateTimeString(start),
      ends_at: localDateTimeString(end),
      duration_minutes: duration,
      status: document.getElementById("appointment-status").value,
      notes: document.getElementById("appointment-notes").value
    };
  }

  function validateAppointmentForm() {
    normalizeFormInputs();
    const requiredFields = [
      ["appointment-patient", "Pacijent"],
      ["appointment-title", "Naziv termina"],
      ["appointment-date", "Datum"],
      ["appointment-time", "Vreme"],
      ["appointment-doctor", "Doktor"],
      ["appointment-chair", "Stolica"],
      ["appointment-procedure", "Postupak"]
    ];
    const missing = requiredFields.find(([id]) => !document.getElementById(id).value);
    if (missing) return `${missing[1]} je obavezno polje.`;
    if (hasCodeLikeContent(document.getElementById("appointment-notes").value)) {
      return "Napomena ne sme sadrzati kod ili specijalne znakove.";
    }
    if (hasCodeLikeContent(document.getElementById("appointment-title").value)) {
      return "Naziv termina ne sme sadrzati kod ili specijalne znakove.";
    }
    return "";
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
    if (window.DrRosaApi.getRecords) {
      state.records = await window.DrRosaApi.getRecords().catch(() => state.records);
    }
    renderCalendar();
  }

  async function loadInitialData() {
    const [patients, doctors, chairs, procedures, records, currencies] = await Promise.all([
      window.DrRosaApi.getPatients(),
      window.DrRosaApi.getDoctors(),
      window.DrRosaApi.getChairs(),
      window.DrRosaApi.getCodebooks("procedure"),
      window.DrRosaApi.getRecords ? window.DrRosaApi.getRecords().catch(() => []) : [],
      window.DrRosaApi.getCodebooks ? window.DrRosaApi.getCodebooks("currency").catch(() => []) : []
    ]);
    state.patients = patients;
    state.doctors = doctors;
    state.chairs = chairs;
    state.procedures = procedures;
    state.records = records;
    window.DrRosaCurrencyUtils?.setCurrencies(currencies);
    fillSelects();
    closePanel();
    await loadAppointments();
    applyPatientQueryPreset();
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
    document.getElementById("google-calendar-sync-btn")?.addEventListener("click", async () => {
      setGoogleSyncLoading(true);
      setGoogleSyncStatus("Pokrecem sinhronizaciju sa Google Kalendarom...", "info");
      try {
        const started = await window.DrRosaApi.pullGoogleCalendarChanges({
          mode: "range",
          reset: true,
          limit: 25,
          complete: false,
          async: true,
          ...visibleSyncRange()
        });
        const job = started?.job || {};
        setGoogleSyncStatus(started?.alreadyRunning
          ? "Google sync je vec u toku. Nastavljam pracenje statusa..."
          : "Google sync je pokrenut. Obradjujem termine u manjim koracima...", "info");
        const result = await runGoogleSyncJob(job.id);
        setGoogleSyncStatus(`Google sync zavrsen. ${googleSyncMessage(result)}.`, result.partial ? "error" : "success");
        await loadAppointments();
      } catch (error) {
        let message = error.message || "Google sync nije uspeo.";
        if (/API request failed|timeout|504/i.test(message)) {
          message = "Google sync traje duze od ocekivanog. Osvezite status ili pokrenite proveru ponovo za nekoliko sekundi.";
        }
        setGoogleSyncStatus(message, "error");
      } finally {
        setGoogleSyncLoading(false);
      }
    });
    document.getElementById("calendar-view").addEventListener("change", async event => {
      setCalendarViewMode(event.target.value, { persist: true });
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
    document.getElementById("appointment-notes").addEventListener("blur", normalizeFormInputs);
    document.getElementById("appointment-title").addEventListener("blur", normalizeFormInputs);
    document.getElementById("appointment-procedure").addEventListener("change", fillTitleFromProcedureIfEmpty);
    document.getElementById("calendar-board").addEventListener("click", event => {
      const appointmentButton = event.target.closest("[data-appointment-id]");
      if (appointmentButton) {
        editAppointment(appointmentButton.dataset.appointmentId);
        return;
      }
      const slotButton = event.target.closest("[data-date][data-chair-id]");
      if (slotButton) {
        resetForm(new Date(`${slotButton.dataset.date}T09:00:00`), {
          chairId: slotButton.dataset.chairId,
          hour: Number(slotButton.dataset.hour)
        });
        return;
      }
      const chairTab = event.target.closest("[data-chair-tab]");
      if (chairTab) {
        const board = chairTab.closest(".day-chair-board");
        const column = board?.querySelector(`.day-chair-column[data-chair-id="${CSS.escape(chairTab.dataset.chairTab)}"]`);
        board?.querySelectorAll("[data-chair-tab]").forEach(button => button.classList.toggle("is-active", button === chairTab));
        column?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
        return;
      }
      const dayButton = event.target.closest("[data-date]");
      if (dayButton) resetForm(new Date(`${dayButton.dataset.date}T09:00:00`));
    });
    document.getElementById("appointment-form").addEventListener("submit", async event => {
      event.preventDefault();
      if (event.currentTarget.dataset.drrosaBusy === "1") return;
      const submitButton = event.currentTarget.querySelector("button[type='submit']");
      const submitText = submitButton?.textContent;
      event.currentTarget.dataset.drrosaBusy = "1";
      event.currentTarget.setAttribute("aria-busy", "true");
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Čuvanje...";
      }
      const appointmentId = document.getElementById("appointment-id").value;
      const validationError = validateAppointmentForm();
      if (validationError) {
        setAlert(validationError, "error");
        delete event.currentTarget.dataset.drrosaBusy;
        event.currentTarget.removeAttribute("aria-busy");
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = submitText;
        }
        return;
      }
      try {
        const saved = appointmentId
          ? await window.DrRosaApi.updateAppointment(appointmentId, formPayload())
          : await window.DrRosaApi.createAppointment(formPayload());
        await loadAppointments();
        editAppointment(saved.id);
        setAlert("Termin je sačuvan.", "success");
      } catch (error) {
        setAlert(error.message, "error");
      } finally {
        delete event.currentTarget.dataset.drrosaBusy;
        event.currentTarget.removeAttribute("aria-busy");
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = submitText;
        }
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
    initializeCalendarViewMode();
    bindEvents();
    try {
      await loadInitialData();
    } catch (error) {
      setAlert(error.message, "error");
    }
  })();
})();
