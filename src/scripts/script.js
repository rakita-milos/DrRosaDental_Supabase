async function requireAccess(requiredRole) {
  const session = await window.DrRosaApi.verifySession(requiredRole);
  if (!session) {
    window.location.href = "login.html";
    return null;
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

  return session;
}

function formatDate(rawDate) {
  if (!rawDate) return "-";
  return window.DrRosaDateUtils.formatDate(rawDate);
}

function paymentIsDebt(record) {
  const payment = String(record.paymentStatus || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return Number(record.amountDue || 0) > 0 && ["dugovanje", "delimično"].includes(payment);
}

function isToday(rawDate) {
  if (!rawDate) return false;
  const today = new Date();
  const todayKey = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0")
  ].join("-");
  return String(rawDate).slice(0, 10) === todayKey;
}

function appointmentStart(appointment) {
  return appointment.startsAt || appointment.starts_at;
}

function appointmentPatientId(appointment) {
  return appointment.patientId || appointment.patient_id;
}

function appointmentPatientName(appointment) {
  return appointment.patientName || appointment.patient_name || appointment.patient || "-";
}

function appointmentChairId(appointment) {
  return appointment.chairId || appointment.chair_id;
}

function appointmentChairName(appointment) {
  return appointment.chairName || appointment.chair_name || "Stolica";
}

function patientName(patient) {
  return patient.fullName || [patient.firstName || patient.first_name, patient.lastName || patient.last_name].filter(Boolean).join(" ");
}

function dashboardStatusLabel(status) {
  const labels = {
    scheduled: "Zakazano",
    confirmed: "Potvrdjeno",
    arrived: "Dosao",
    completed: "Zavrseno",
    cancelled: "Otkazano",
    no_show: "Nije dosao"
  };
  return labels[status] || status || "-";
}

function timeLabel(rawDate) {
  if (!rawDate) return "-";
  const date = new Date(rawDate);
  if (!Number.isFinite(date.getTime())) return "-";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function patientDashboardUrlFromAppointment(appointment) {
  const patientId = appointmentPatientId(appointment);
  if (patientId) return `patient-dashboard.html?patientId=${encodeURIComponent(patientId)}`;
  return `patient-dashboard.html?patient=${encodeURIComponent(appointmentPatientName(appointment))}`;
}

function newEntryUrlFromAppointment(appointment) {
  const params = new URLSearchParams();
  const patientId = appointmentPatientId(appointment);
  if (patientId) params.set("patientId", patientId);
  else params.set("patient", appointmentPatientName(appointment));
  if (appointment.id) params.set("appointmentId", appointment.id);
  return `new-entry.html?${params.toString()}`;
}

function recordId(record) {
  return record.recordId || record.record_id || record.id;
}

function patientDashboardUrlFromRecord(record) {
  const patientId = record.patientId || record.patient_id;
  if (patientId) return `patient-dashboard.html?patientId=${encodeURIComponent(patientId)}`;
  return `patient-dashboard.html?patient=${encodeURIComponent(record.patient || "-")}`;
}

function debtPaymentUrlFromRecord(record) {
  const id = recordId(record);
  return id
    ? `new-entry.html?record=${encodeURIComponent(id)}&payment=debt#entry-details-section`
    : patientDashboardUrlFromRecord(record);
}

function formatCurrencyAmounts(amounts) {
  const entries = Object.entries(amounts).filter(([, amount]) => Number(amount || 0) > 0);
  if (!entries.length) return "0.00 RSD";
  return entries.map(([currency, amount]) => window.DrRosaCurrencyUtils
    ? window.DrRosaCurrencyUtils.formatMoney(amount, currency)
    : `${Number(amount || 0).toFixed(2)} ${currency}`).join(" / ");
}

function amountInRsd(amount, currency) {
  return window.DrRosaCurrencyUtils
    ? window.DrRosaCurrencyUtils.convert(amount, currency, "RSD")
    : Number(amount || 0);
}

function patientDebtSummary(records, appointment) {
  const patientId = appointmentPatientId(appointment);
  const name = appointmentPatientName(appointment);
  const patientRecords = records.filter(record => patientId
    ? String(record.patientId || record.patient_id) === String(patientId)
    : record.patient === name);
  const debts = {};
  patientRecords.filter(paymentIsDebt).forEach(record => {
    const currency = record.currency || "RSD";
    debts[currency] = (debts[currency] || 0) + Number(record.amountDue || record.amount_due || 0);
  });
  const summary = formatCurrencyAmounts(debts);
  return summary === "0.00 RSD" ? "" : summary;
}

function renderDueSummary(records) {
  const uniqueDebtors = new Set(records.filter(paymentIsDebt).map(record => record.patient)).size;
  const debtorsCountEl = document.getElementById("debtors-count");
  if (debtorsCountEl) debtorsCountEl.textContent = uniqueDebtors;
}

function dashboardDebtorRows(records) {
  const debtors = new Map();
  records.filter(paymentIsDebt).forEach(record => {
    const patientId = record.patientId || record.patient_id;
    const name = record.patient || "-";
    const key = patientId ? `id:${patientId}` : `name:${name}`;
    const currency = record.currency || "RSD";
    const amount = Number(record.amountDue || record.amount_due || 0);
    const amountRsd = amountInRsd(amount, currency);
    if (!debtors.has(key)) {
      debtors.set(key, {
        patient: name,
        amounts: {},
        totalRsd: 0,
        largestDebtRecord: record,
        largestDebtRsd: amountRsd
      });
    }
    const debtor = debtors.get(key);
    debtor.amounts[currency] = (debtor.amounts[currency] || 0) + amount;
    debtor.totalRsd += amountRsd;
    if (amountRsd > debtor.largestDebtRsd) {
      debtor.largestDebtRecord = record;
      debtor.largestDebtRsd = amountRsd;
    }
  });
  return Array.from(debtors.values())
    .sort((a, b) => b.totalRsd - a.totalRsd)
    .slice(0, 5);
}

function renderDashboardDebtors(records) {
  const container = document.getElementById("dashboard-debtors-list");
  if (!container) return;
  const debtors = dashboardDebtorRows(records);
  if (!debtors.length) {
    container.innerHTML = `
      <div class="dashboard-empty-state">
        <strong>Nema otvorenih dugovanja.</strong>
        <span>Sve evidentirane posete su izmirene.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = debtors.map(debtor => `
    <article class="dashboard-debtor-row">
      <a class="dashboard-debtor-main" href="${debtPaymentUrlFromRecord(debtor.largestDebtRecord)}">
        <strong>${window.DrRosaSecurity.escapeHtml(debtor.patient)}</strong>
        <span>${window.DrRosaSecurity.escapeHtml(formatCurrencyAmounts(debtor.amounts))}</span>
      </a>
      <div class="dashboard-debtor-actions">
        <a class="secondary-btn" href="${debtPaymentUrlFromRecord(debtor.largestDebtRecord)}">Dodaj uplatu</a>
      </div>
    </article>
  `).join("");
}


function setCount(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = String(Number(value || 0));
}

function upcomingAppointments(appointments) {
  const now = Date.now();
  return appointments.filter(appointment => {
    const startsAt = new Date(appointmentStart(appointment)).getTime();
    const status = String(appointment.status || "").toLowerCase();
    return Number.isFinite(startsAt) && startsAt >= now && !["cancelled", "completed", "no_show"].includes(status);
  });
}

function procedureCount(records) {
  return records.reduce((total, record) => {
    const treatments = record.treatments || {};
    const treatmentCount = Object.values(treatments).reduce((sum, items) => sum + (Array.isArray(items) ? items.length : 0), 0);
    return total + (treatmentCount || (record.procedure ? 1 : 0));
  }, 0);
}

function renderNextAppointmentsByChair(appointments, chairs = []) {
  const container = document.getElementById("dashboard-next-chairs");
  if (!container) return;
  const upcoming = upcomingAppointments(appointments)
    .sort((a, b) => new Date(appointmentStart(a)) - new Date(appointmentStart(b)));
  const chairItems = chairs.length
    ? chairs
    : Array.from(new Map(upcoming
      .map(appointment => [appointmentChairId(appointment) || appointmentChairName(appointment), {
        id: appointmentChairId(appointment) || appointmentChairName(appointment),
        name: appointmentChairName(appointment)
      }])
      .filter(([id]) => id)).values());
  const visibleChairs = chairItems.length ? chairItems : [
    { id: "chair-1", name: "Stolica 1" },
    { id: "chair-2", name: "Stolica 2" }
  ];

  container.innerHTML = visibleChairs.map(chair => {
    const nextAppointment = upcoming.find(appointment => String(appointmentChairId(appointment)) === String(chair.id)
      || (!appointmentChairId(appointment) && appointmentChairName(appointment) === chair.name));
    if (!nextAppointment) {
      return `
        <a class="dashboard-next-chair is-free" href="calendar.html">
          <span>${window.DrRosaSecurity.escapeHtml(chair.name)}</span>
          <strong>Slobodno</strong>
          <small>Nema sledeceg termina</small>
        </a>
      `;
    }
    const procedure = nextAppointment.procedureName || nextAppointment.procedure_name || nextAppointment.googleTitle || nextAppointment.google_title || "Termin";
    return `
      <a class="dashboard-next-chair" href="calendar.html">
        <span>${window.DrRosaSecurity.escapeHtml(chair.name)}</span>
        <strong>${window.DrRosaSecurity.escapeHtml(timeLabel(appointmentStart(nextAppointment)))}</strong>
        <small>${window.DrRosaSecurity.escapeHtml(appointmentPatientName(nextAppointment))}</small>
        <em>${window.DrRosaSecurity.escapeHtml(procedure)}</em>
      </a>
    `;
  }).join("");
}

function renderDashboardStats({ patients, appointments, records, chairs = [] }) {
  const patientCount = patients.length;
  const appointmentCount = upcomingAppointments(appointments).length;
  const procedures = procedureCount(records);
  const todaysAppointments = appointments.filter(appointment => isToday(appointmentStart(appointment)));
  const completedToday = records.filter(record => isToday(record.lastVisit) && String(record.status || "").toLowerCase().includes("zavr")).length;
  const debtToday = records.filter(record => isToday(record.lastVisit) && paymentIsDebt(record)).length;

  setCount("patients-count", patientCount);
  setCount("appointments-count", appointmentCount);
  setCount("procedures-count", procedures);
  setCount("today-appointments-count", todaysAppointments.length);
  setCount("today-completed-count", completedToday);
  setCount("today-debt-count", debtToday);
  renderNextAppointmentsByChair(appointments, chairs);
}

function renderTodaySchedule(appointments, records) {
  const container = document.getElementById("today-schedule-list");
  if (!container) return;
  const todaysAppointments = appointments
    .filter(appointment => isToday(appointmentStart(appointment)))
    .sort((a, b) => new Date(appointmentStart(a)) - new Date(appointmentStart(b)));

  if (!todaysAppointments.length) {
    container.innerHTML = `
      <div class="dashboard-empty-state">
        <strong>Nema termina za danas.</strong>
        <span>Kalendar je slobodan ili termini jos nisu uneti.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = todaysAppointments.map(appointment => {
    const status = appointment.status || "scheduled";
    const debt = patientDebtSummary(records, appointment);
    const doctor = appointment.doctorName || appointment.doctor_name || "-";
    const chair = appointment.chairName || appointment.chair_name || "-";
    const procedure = appointment.procedureName || appointment.procedure_name || "Kontrola";
    return `
      <article class="today-appointment-card appointment-${status}" data-appointment-id="${appointment.id || ""}">
        <div class="today-appointment-time">
          <strong>${timeLabel(appointmentStart(appointment))}</strong>
          <span>${dashboardStatusLabel(status)}</span>
        </div>
        <div class="today-appointment-main">
          <h3>${window.DrRosaSecurity.escapeHtml(appointmentPatientName(appointment))}</h3>
          <p>${window.DrRosaSecurity.escapeHtml(procedure)}</p>
          <small>${window.DrRosaSecurity.escapeHtml(doctor)} / ${window.DrRosaSecurity.escapeHtml(chair)}</small>
          ${debt ? `<em>Dug: ${window.DrRosaSecurity.escapeHtml(debt)}</em>` : ""}
        </div>
        <div class="today-appointment-actions">
          <a class="secondary-btn" href="${patientDashboardUrlFromAppointment(appointment)}">Karton</a>
          <a class="secondary-btn" href="${newEntryUrlFromAppointment(appointment)}">Nova poseta</a>
          ${["scheduled", "confirmed"].includes(status) ? `<button class="primary-btn" type="button" data-arrive-appointment="${appointment.id}">Dosao</button>` : ""}
        </div>
      </article>
    `;
  }).join("");
}

function renderDashboardAlerts({ patients, records, appointments }) {
  const container = document.getElementById("dashboard-alert-list");
  if (!container) return;
  const alerts = [];
  const todayRecords = records.filter(record => isToday(record.lastVisit));
  const debtorsToday = todayRecords.filter(paymentIsDebt);
  const openToday = todayRecords.filter(record => !String(record.status || "").toLowerCase().includes("zavr"));
  const upcomingPatientIds = new Set(upcomingAppointments(appointments).map(appointment => String(appointmentPatientId(appointment))).filter(Boolean));
  const noFollowup = patients.filter(patient => patient.id && !upcomingPatientIds.has(String(patient.id))).slice(0, 5);

  if (debtorsToday.length) {
    alerts.push({
      tone: "danger",
      title: `${debtorsToday.length} pacijent${debtorsToday.length === 1 ? "" : "a"} sa dugom danas`,
      text: "Pre naplate ili izlaska pacijenta proveriti dugovanje.",
      href: "all-records.html?filter=debtors",
      action: "Otvori dugovanja"
    });
  }
  if (openToday.length) {
    alerts.push({
      tone: "warning",
      title: `${openToday.length} danasnjih pregleda nije zakljuceno`,
      text: "Proveriti status posete, nalaz i naplatu pre kraja smene.",
      href: "all-records.html",
      action: "Pregled evidencije"
    });
  }
  if (noFollowup.length) {
    alerts.push({
      tone: "info",
      title: `${noFollowup.length} pacijent${noFollowup.length === 1 ? "" : "a"} bez sledece kontrole`,
      text: noFollowup.map(patientName).filter(Boolean).join(", "),
      href: "all-records.html?appointment=no_upcoming",
      action: "Zakazi kontrole"
    });
  }

  if (!alerts.length) {
    container.innerHTML = `
      <div class="dashboard-empty-state">
        <strong>Nema hitnih upozorenja.</strong>
        <span>Danas nema dugovanja, otvorenih statusa ili kriticnih kontrola.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = alerts.map(alert => `
    <article class="dashboard-alert-card ${alert.tone}">
      <strong>${window.DrRosaSecurity.escapeHtml(alert.title)}</strong>
      <span>${window.DrRosaSecurity.escapeHtml(alert.text)}</span>
      <a class="secondary-btn" href="${alert.href}">${window.DrRosaSecurity.escapeHtml(alert.action)}</a>
    </article>
  `).join("");
}

(async function initDashboard() {
  if (!document.getElementById("today-schedule-list")) return;
  if (!await requireAccess()) return;
  try {
    const [patients, records, appointments, chairs] = await Promise.all([
      window.DrRosaApi.getPatients(),
      window.DrRosaApi.getRecords(),
      window.DrRosaApi.getAppointments(),
      window.DrRosaApi.getChairs ? window.DrRosaApi.getChairs().catch(() => []) : []
    ]);
    renderDashboardStats({ patients, appointments, records, chairs });
    renderDueSummary(records);
    renderTodaySchedule(appointments, records);
    renderDashboardDebtors(records);
    renderDashboardAlerts({ patients, records, appointments });
  } catch (error) {
    renderDashboardStats({ patients: [], appointments: [], records: [], chairs: [] });
    renderTodaySchedule([], []);
    renderDashboardDebtors([]);
    renderDashboardAlerts({ patients: [], appointments: [], records: [] });
    console.error("Dashboard load error:", error);
  }
})();

document.getElementById("today-schedule-list")?.addEventListener("click", async event => {
  const arriveButton = event.target.closest("[data-arrive-appointment]");
  if (!arriveButton) return;
  arriveButton.disabled = true;
  try {
    await window.DrRosaApi.updateAppointmentStatus(arriveButton.dataset.arriveAppointment, "arrived");
    window.location.reload();
  } catch (error) {
    arriveButton.disabled = false;
    console.error("Appointment arrival update error:", error);
  }
});
