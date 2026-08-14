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

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function formatDate(rawDate) {
  if (!rawDate) return "-";
  return window.DrRosaDateUtils.formatDate(rawDate);
}

function patientFullName(patient) {
  return patient.fullName || `${patient.firstName || patient.first_name || ""} ${patient.lastName || patient.last_name || ""}`.trim();
}

function isDebt(record) {
  const payment = String(record.paymentStatus || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return Number(record.amountDue || 0) > 0 && ["dugovanje", "delimično"].includes(payment);
}

function formatMoney(amount, currency = "RSD") {
  return window.DrRosaCurrencyUtils
    ? window.DrRosaCurrencyUtils.formatMoney(amount, currency)
    : `${Number(amount || 0).toFixed(2)} ${currency}`;
}

async function runLockedFormSubmit(event, callback, loadingText = "Čuvanje...") {
  event.preventDefault();
  const form = event.currentTarget;
  if (form.dataset.drrosaBusy === "1") return;
  const submitButton = form.querySelector("button[type='submit']");
  const submitText = submitButton?.textContent;
  form.dataset.drrosaBusy = "1";
  form.setAttribute("aria-busy", "true");
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = loadingText;
  }
  try {
    await callback();
  } finally {
    delete form.dataset.drrosaBusy;
    form.removeAttribute("aria-busy");
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = submitText;
    }
  }
}

function recordDetailsUrl(record) {
  const params = new URLSearchParams({ patient: record.patient });
  if (record.id) params.set("record", record.id);
  return `new-entry.html?${params.toString()}`;
}

function treatmentListForValue(treatments) {
  if (!treatments) return [];
  return Array.isArray(treatments) ? treatments : [treatments];
}

function normalizeDiscountType(type) {
  return type === "percent" ? "percent" : "amount";
}

function normalizeDiscountValue(value, type) {
  const amount = Math.max(0, Number(value || 0));
  return normalizeDiscountType(type) === "percent" ? Math.min(100, amount) : amount;
}

function treatmentDiscountAmount(treatment) {
  const price = Number(treatment?.price || 0);
  const type = normalizeDiscountType(treatment?.discountType || treatment?.discount_type);
  const value = normalizeDiscountValue(treatment?.discountValue ?? treatment?.discount_value ?? treatment?.discount ?? 0, type);
  const discount = type === "percent" ? price * value / 100 : value;
  return Math.min(price, Math.max(0, discount));
}

function recordTreatmentEntries(record) {
  if (!record.treatments) return [];
  return Object.values(record.treatments)
    .flatMap(treatmentListForValue)
    .filter(Boolean);
}

function recordVisitCost(record) {
  const treatments = recordTreatmentEntries(record);
  const treatmentsTotal = treatments.reduce((sum, treatment) => {
    return sum + Math.max(0, Number(treatment.price || 0) - treatmentDiscountAmount(treatment));
  }, 0);
  if (treatmentsTotal > 0) {
    return Math.max(0, treatmentsTotal);
  }
  return Math.max(0, Number(record.amountPaid || 0) + Number(record.amountDue || 0));
}

function recordPaymentParts(record) {
  const parts = Array.isArray(record.paymentParts)
    ? record.paymentParts.filter(part => Number(part?.amount || 0) > 0)
    : [];
  if (parts.length) return parts;
  const amountPaid = Number(record.amountPaid || 0);
  if (amountPaid <= 0) return [];
  return [{
    amount: amountPaid,
    currency: record.currency || "RSD",
    paymentMethod: "",
    paymentDate: record.lastVisit || "",
    notes: "Zbirna uplata iz posete"
  }];
}

function paymentExchangeRate(part) {
  const currency = String(part.currency || "RSD").toUpperCase();
  const rate = Number(part.exchangeRateToRsd || part.exchange_rate_to_rsd || 0);
  if (currency === "RSD") return 1;
  return rate > 0 ? rate : 0;
}

function paymentAmountRsd(part) {
  const amountRsd = Number(part.amountRsd || part.amount_rsd || 0);
  if (amountRsd > 0) return amountRsd;
  const amount = Number(part.amount || 0);
  const rate = paymentExchangeRate(part);
  return rate > 0 ? amount * rate : 0;
}

function recordPaidAmount(record) {
  const parts = recordPaymentParts(record);
  if (!parts.length) return Number(record.amountPaid || 0);
  return parts.reduce((sum, part) => {
    const amount = Number(part.amount || 0);
    if (!window.DrRosaCurrencyUtils || !part.currency || part.currency === record.currency) {
      return sum + amount;
    }
    return sum + Number(window.DrRosaCurrencyUtils.convert(amount, part.currency, record.currency || "RSD") || 0);
  }, 0);
}

function recordPaymentSummary(record) {
  const currency = record.currency || "RSD";
  return [
    `Ukupno: ${formatMoney(recordVisitCost(record), currency)}`,
    `Placeno: ${formatMoney(recordPaidAmount(record), currency)}`,
    `Dug: ${formatMoney(record.amountDue || 0, currency)}`
  ].join(" / ");
}

function renderRecordPaymentDetails(record) {
  const parts = recordPaymentParts(record);
  if (!parts.length) return "";
  return `
    <details class="patient-payment-details">
      <summary><span data-payment-label-open>Prikazi uplate</span><span data-payment-label-close>Sakrij uplate</span></summary>
      <table class="patient-payment-table">
        <thead>
          <tr>
            <th>Datum</th>
            <th>Iznos</th>
            <th>Nacin</th>
            <th>Napomena</th>
          </tr>
        </thead>
        <tbody>
          ${parts.map(part => `
            <tr>
              <td>${escapeHtml(formatDate(part.paymentDate || part.payment_date))}</td>
              <td>${escapeHtml(formatMoney(part.amount, part.currency || record.currency || "RSD"))}</td>
              <td>${escapeHtml(part.paymentMethod || part.payment_method || "-")}</td>
              <td>${escapeHtml(part.notes || "-")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </details>
  `;
}

function renderVisitPayments(records) {
  const body = document.getElementById("visit-payments-body");
  if (!body) return;
  const rows = [];
  records.forEach(record => {
    const parts = recordPaymentParts(record);
    if (!parts.length) return;
    parts.forEach((part, index) => {
      const currency = String(part.currency || record.currency || "RSD").toUpperCase();
      const rate = paymentExchangeRate(part);
      rows.push(`
        <tr class="${index === 0 ? "payment-history-visit-row" : "payment-history-part-row"}">
          <td>${index === 0 ? escapeHtml(formatDate(record.lastVisit)) : ""}</td>
          <td>${escapeHtml(formatMoney(part.amount, currency))}</td>
          <td>${escapeHtml(currency)}</td>
          <td>${rate > 0 ? escapeHtml(rate.toFixed(2)) : "-"}</td>
          <td>${escapeHtml(formatMoney(paymentAmountRsd(part), "RSD"))}</td>
          <td>${escapeHtml(part.paymentMethod || part.payment_method || "-")}</td>
          <td>${index === 0 ? escapeHtml(formatMoney(recordVisitCost(record), record.currency || "RSD")) : ""}</td>
          <td>${index === 0 ? escapeHtml(formatMoney(record.amountDue || 0, record.currency || "RSD")) : ""}</td>
        </tr>
      `);
    });
  });
  body.innerHTML = rows.length ? rows.join("") : `<tr><td colspan="8">Nema evidentiranih uplata za posete.</td></tr>`;
}

function renderVisitPaymentHistoryItems(items) {
  const body = document.getElementById("visit-payments-body");
  if (!body) return;
  const rows = [];
  (items || []).forEach(item => {
    const payments = Array.isArray(item.payments) ? item.payments.filter(part => Number(part?.amount || 0) > 0) : [];
    payments.forEach((part, index) => {
      const currency = String(part.currency || item.currency || "RSD").toUpperCase();
      const rate = paymentExchangeRate(part);
      rows.push(`
        <tr class="${index === 0 ? "payment-history-visit-row" : "payment-history-part-row"}">
          <td>${index === 0 ? escapeHtml(formatDate(item.visitDate)) : ""}</td>
          <td>${escapeHtml(formatMoney(part.amount, currency))}</td>
          <td>${escapeHtml(currency)}</td>
          <td>${rate > 0 ? escapeHtml(rate.toFixed(2)) : "-"}</td>
          <td>${escapeHtml(formatMoney(paymentAmountRsd(part), "RSD"))}</td>
          <td>${escapeHtml(part.paymentMethod || part.payment_method || "-")}</td>
          <td>${index === 0 ? escapeHtml(formatMoney(item.totalAmount || 0, item.currency || "RSD")) : ""}</td>
          <td>${index === 0 ? escapeHtml(formatMoney(item.debt || 0, item.currency || "RSD")) : ""}</td>
        </tr>
      `);
    });
  });
  body.innerHTML = rows.length ? rows.join("") : `<tr><td colspan="8">Nema evidentiranih uplata za posete.</td></tr>`;
}

function setVisitPaymentsLoading(message) {
  const body = document.getElementById("visit-payments-body");
  if (body) body.innerHTML = `<tr><td colspan="8">${escapeHtml(message)}</td></tr>`;
}

function renderVisitPaymentControls() {
  const pageLabel = document.getElementById("visit-payments-page");
  const prevButton = document.getElementById("visit-payments-prev");
  const nextButton = document.getElementById("visit-payments-next");
  if (pageLabel) pageLabel.textContent = `Strana ${visitPaymentHistory.page}`;
  if (prevButton) prevButton.disabled = visitPaymentHistory.page <= 1 || visitPaymentHistory.loading;
  if (nextButton) nextButton.disabled = visitPaymentHistory.loading || !visitPaymentHistory.hasMoreByPage.get(visitPaymentHistory.page);
}

function resetVisitPaymentHistory(patientId) {
  visitPaymentHistory = {
    patientId: patientId ? String(patientId) : null,
    page: 1,
    limit: 5,
    cache: new Map(),
    hasMoreByPage: new Map(),
    loading: false
  };
}

async function loadVisitPaymentHistory(patientId, page = visitPaymentHistory.page, { prefetch = false } = {}) {
  if (!patientId || !window.DrRosaApi.getPatientPaymentHistory) return null;
  const patientKey = String(patientId);
  if (visitPaymentHistory.patientId !== patientKey) resetVisitPaymentHistory(patientKey);
  if (visitPaymentHistory.cache.has(page)) {
    const cached = visitPaymentHistory.cache.get(page);
    if (!prefetch) {
      visitPaymentHistory.page = page;
      renderVisitPaymentHistoryItems(cached.items);
      renderVisitPaymentControls();
      loadVisitPaymentHistory(patientId, page + 1, { prefetch: true });
    }
    return cached;
  }
  if (!prefetch) {
    visitPaymentHistory.loading = true;
    setVisitPaymentsLoading("Ucitavanje uplata...");
    renderVisitPaymentControls();
  }
  try {
    const data = await window.DrRosaApi.getPatientPaymentHistory(patientId, { page, limit: visitPaymentHistory.limit });
    if (visitPaymentHistory.patientId !== patientKey) return null;
    visitPaymentHistory.cache.set(page, data);
    visitPaymentHistory.hasMoreByPage.set(page, Boolean(data.hasMore));
    if (!prefetch) {
      visitPaymentHistory.page = page;
      renderVisitPaymentHistoryItems(data.items);
      if (data.hasMore) loadVisitPaymentHistory(patientId, page + 1, { prefetch: true });
    }
    return data;
  } catch (error) {
    if (!prefetch) setVisitPaymentsLoading(error.message || "Uplate nisu ucitane.");
    return null;
  } finally {
    if (!prefetch) {
      visitPaymentHistory.loading = false;
      renderVisitPaymentControls();
    }
  }
}

function initializeVisitPaymentPagination(patientId) {
  const prevButton = document.getElementById("visit-payments-prev");
  const nextButton = document.getElementById("visit-payments-next");
  if (prevButton && prevButton.dataset.ready !== "1") {
    prevButton.dataset.ready = "1";
    prevButton.addEventListener("click", () => {
      if (visitPaymentHistory.page <= 1) return;
      loadVisitPaymentHistory(patientId, visitPaymentHistory.page - 1);
    });
  }
  if (nextButton && nextButton.dataset.ready !== "1") {
    nextButton.dataset.ready = "1";
    nextButton.addEventListener("click", () => {
      if (!visitPaymentHistory.hasMoreByPage.get(visitPaymentHistory.page)) return;
      loadVisitPaymentHistory(patientId, visitPaymentHistory.page + 1);
    });
  }
}

function formatDebtTotals(records) {
  const totals = records.reduce((acc, record) => {
    const currency = record.currency || "RSD";
    acc[currency] = (acc[currency] || 0) + Number(record.amountDue || 0);
    return acc;
  }, {});
  const entries = Object.entries(totals).filter(([, amount]) => amount > 0);
  return entries.length ? entries.map(([currency, amount]) => formatMoney(amount, currency)).join(" / ") : "0.00";
}

function patientAge(patient) {
  const birthDate = patient?.birthDate || patient?.date_of_birth;
  if (!birthDate) return "-";
  const born = new Date(birthDate);
  if (Number.isNaN(born.getTime())) return "-";
  const today = new Date();
  let age = today.getFullYear() - born.getFullYear();
  const monthDelta = today.getMonth() - born.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < born.getDate())) age -= 1;
  return age > 0 ? `${age} god.` : "-";
}

function latestRecord(records) {
  return [...records]
    .filter(record => record.lastVisit)
    .sort((a, b) => String(b.lastVisit).localeCompare(String(a.lastVisit)))[0] || null;
}

function upcomingForPatient(appointments, patientId) {
  const now = Date.now();
  return upcomingAppointmentsForPatient(appointments, patientId)[0] || null;
}

function upcomingAppointmentsForPatient(appointments, patientId, limit = 3) {
  const now = Date.now();
  return appointments
    .filter(appointment => String(appointment.patientId || appointment.patient_id) === String(patientId))
    .filter(appointment => {
      const startsAt = new Date(appointment.startsAt || appointment.starts_at).getTime();
      const status = String(appointment.status || "").toLowerCase();
      return Number.isFinite(startsAt) && startsAt >= now && !["cancelled", "completed", "no_show"].includes(status);
    })
    .sort((a, b) => new Date(a.startsAt || a.starts_at) - new Date(b.startsAt || b.starts_at))
    .slice(0, limit);
}

function renderSummaryLine(label, value, tone = "") {
  return `<div class="patient-summary-line ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "-")}</strong></div>`;
}

function renderRiskList(patient, profile = {}) {
  const risks = [
    profile.allergies || patient?.allergies ? ["Alergije", profile.allergies || patient.allergies, "danger"] : null,
    profile.contraindications ? ["Kontraindikacije", profile.contraindications, "danger"] : null,
    profile.anesthesiaWarning ? ["Anestezija", profile.anesthesiaWarning, "warning"] : null,
    profile.diabetes ? ["Dijabetes", "Da", "warning"] : null,
    profile.heartCondition ? ["Srce", "Da", "warning"] : null,
    profile.highBloodPressure ? ["Pritisak", "Da", "warning"] : null
  ].filter(Boolean);

  return risks.length
    ? risks.map(([label, value, tone]) => `<span class="patient-risk-chip ${tone}"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</span>`).join("")
    : `<p class="muted-text">Nema oznacenih rizika.</p>`;
}

function renderUpcomingAppointments(appointments, patientId) {
  if (!upcomingPanel) return;
  const upcoming = patientId ? upcomingAppointmentsForPatient(appointments, patientId, 3) : [];
  upcomingPanel.innerHTML = `
    <div class="patient-focus-header">
      <div>
        <p class="eyebrow">Termini</p>
        <h2>Predstojeci termini</h2>
      </div>
    </div>
    <div class="patient-mini-list">
      ${upcoming.length ? upcoming.map(appointment => `
        <article class="patient-mini-item">
          <strong>${formatDate(appointment.startsAt || appointment.starts_at)}</strong>
          <span>${escapeHtml(appointment.procedureName || appointment.procedure_name || "Termin")}</span>
          <small>${escapeHtml([appointment.doctorName || appointment.doctor_name, appointment.status].filter(Boolean).join(" / ") || "-")}</small>
        </article>
      `).join("") : `
        <p class="empty-row">Nema zakazanog sledeceg termina.</p>
      `}
    </div>
  `;
}

function renderQuickDocuments() {
  if (!quickDocuments) return;
  const documents = [...loadedDocuments]
    .sort((a, b) => String(b.documentDate || b.createdAt || "").localeCompare(String(a.documentDate || a.createdAt || "")))
    .slice(0, 3);
  quickDocuments.innerHTML = documents.length ? `
    <div class="patient-mini-list">
      ${documents.map(document => `
        <article class="patient-mini-item">
          <strong>${escapeHtml(document.title || "Dokument")}</strong>
          <span>${escapeHtml(documentTypeLabel(document.documentType))}</span>
          <small>${formatDate(document.documentDate || document.createdAt)} / ${formatFileSize(document.fileSize)}</small>
        </article>
      `).join("")}
    </div>
  ` : `<p class="empty-row">Nema dokumenata. Dodajte nalaz, RTG ili fotografiju.</p>`;
}

function renderInternalComments() {
  if (!internalComments) return;
  const comments = [...loadedInternalComments]
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, 2);
  internalComments.innerHTML = comments.length ? `
    <div class="patient-mini-list">
      ${comments.map(note => `
        <article class="patient-mini-item">
          <strong>${escapeHtml(note.title || "Komentar")}</strong>
          <span>${escapeHtml(String(note.body || "").slice(0, 140))}</span>
          <small>${escapeHtml(note.signedBy || "Osoblje")} / ${formatDate(note.createdAt)}</small>
        </article>
      `).join("")}
    </div>
  ` : `
    <div class="patient-empty-action">
      <p>Nema internih komentara za tim.</p>
      <button class="secondary-btn" type="button" data-empty-action="comment">Dodaj komentar</button>
    </div>
  `;
}

function refreshPatientFirstScreen() {
  renderUpcomingAppointments(overviewAppointments, overviewPatientId);
  renderQuickDocuments();
  renderInternalComments();
  refreshPatientTimeline();
}

function renderPatientOverview(patient, records, appointments, profile = {}) {
  const dueRecords = records.filter(isDebt);
  const last = latestRecord(records);
  const next = patient?.id ? upcomingForPatient(appointments, patient.id) : null;
  const nextStart = next ? formatDate(next.startsAt || next.starts_at) : "Nema zakazanog termina";
  const totalDebt = formatDebtTotals(dueRecords);
  overviewRecords = records;
  overviewNextAppointment = next;
  overviewPatientId = patient?.id || null;
  overviewAppointments = appointments;
  initializeVisitPaymentPagination(patient?.id);
  if (patient?.id && window.DrRosaApi.getPatientPaymentHistory) {
    resetVisitPaymentHistory(patient.id);
    loadVisitPaymentHistory(patient.id, 1);
  } else {
    renderVisitPayments(records);
    renderVisitPaymentControls();
  }

  document.getElementById("patient-summary-title").textContent = patientFullName(patient) || "Pacijent";
  document.getElementById("patient-summary-description").textContent = "Detalji i istorija pacijenta, tretmani, naplate, dokumenti i interni komentari.";

  if (patientWorkspace) patientWorkspace.style.display = "grid";
  if (contactSummary) {
    contactSummary.innerHTML = [
      renderSummaryLine("Telefon", patient.phone),
      renderSummaryLine("Email", patient.email),
      renderSummaryLine("Godine", patientAge(patient)),
      renderSummaryLine("Hitno", patient.emergencyContact || patient.emergency_contact)
    ].join("");
  }
  if (riskSummary) riskSummary.innerHTML = renderRiskList(patient, profile);
  if (financeSummary) {
    financeSummary.innerHTML = [
      renderSummaryLine("Dug", totalDebt, dueRecords.length ? "danger" : "success"),
      renderSummaryLine("Zapisa sa dugom", String(dueRecords.length)),
      renderSummaryLine("Zadnja poseta", formatDate(last?.lastVisit)),
      renderSummaryLine("Sledeci termin", nextStart)
    ].join("");
  }
  refreshPatientFirstScreen();
}

function renderPatientTimeline(records, nextAppointment, patientId) {
  const visitItems = [...records]
    .sort((a, b) => String(b.lastVisit || "").localeCompare(String(a.lastVisit || "")))
    .slice(0, 8)
    .map(record => ({
      date: formatDate(record.lastVisit),
      sortKey: record.lastVisit || "",
      title: record.procedure || "Poseta",
      meta: [record.doctor, record.status, record.paymentStatus].filter(Boolean).join(" / "),
      amount: recordPaymentSummary(record),
      details: renderRecordPaymentDetails(record),
      href: recordDetailsUrl(record),
      recordId: record.id,
      actionLabel: "Uredi",
      type: "visit",
      typeLabel: "Poseta"
    }));

  const documentItems = loadedDocuments.slice(0, 4).map(document => ({
    date: formatDate(document.documentDate || document.createdAt),
    sortKey: document.documentDate || document.createdAt || "",
    title: document.title || "Dokument",
    meta: `Dokument / ${documentTypeLabel(document.documentType)}`,
    amount: [imagingModalityLabel(document.imagingModality), document.toothNumber].filter(Boolean).join(" / "),
    href: "#documents-card",
    group: "documents",
    type: "document",
    typeLabel: "Dokument"
  }));

  const noteItems = loadedClinicalNotes.slice(0, 4).map(note => ({
    date: formatDate(note.createdAt),
    sortKey: note.createdAt || "",
    title: note.title || "Klinicka beleska",
    meta: note.signedAt ? "Potpisana beleska" : "Beleska ceka potpis",
    amount: note.signedBy || "",
    href: "#clinical-notes-card",
    group: "clinical",
    type: "note",
    typeLabel: "Beleška"
  }));

  const invoiceItems = loadedInvoices.slice(0, 4).map(invoice => ({
    date: formatDate(invoice.issueDate || invoice.createdAt),
    sortKey: invoice.issueDate || invoice.createdAt || "",
    title: invoice.invoiceNumber || "Racun",
    meta: `Racun / ${labelFromMap(statusLabels, invoice.status)}`,
    amount: `${formatMoney(invoice.total, invoice.currency)} / placeno ${formatMoney(invoice.amountPaid, invoice.currency)}`,
    href: "#invoices-card",
    group: "finance",
    type: "invoice",
    typeLabel: "Naplata"
  }));

  const items = [];
  if (nextAppointment) {
    items.push({
      date: formatDate(nextAppointment.startsAt || nextAppointment.starts_at),
      sortKey: nextAppointment.startsAt || nextAppointment.starts_at || "",
      title: nextAppointment.procedureName || nextAppointment.procedure_name || "Zakazan termin",
      meta: "Sledeci termin",
      amount: nextAppointment.doctorName || nextAppointment.doctor_name || "",
      href: patientId ? `calendar.html?patientId=${encodeURIComponent(patientId)}` : "calendar.html",
      type: "appointment",
      typeLabel: "Termin"
    });
  }
  items.push(...visitItems, ...documentItems, ...noteItems, ...invoiceItems);

  items.sort((a, b) => String(b.sortKey || "").localeCompare(String(a.sortKey || "")));
  activityTimeline.innerHTML = items.length ? items.slice(0, 12).map(item => `
    <article class="patient-timeline-item ${isTimelineHighlight(item) ? "is-highlighted" : ""}">
      <time>${escapeHtml(item.date)}</time>
      <div>
        <strong><span class="patient-timeline-badge ${escapeHtml(item.type || "activity")}">${escapeHtml(item.typeLabel || "Aktivnost")}</span>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.meta || "-")}</span>
        <small>${escapeHtml(item.amount || "")}</small>
        ${item.details || ""}
      </div>
      <div class="patient-timeline-actions">
        ${item.group ? `<button class="secondary-btn timeline-group-btn" type="button" data-patient-group="${escapeHtml(item.group)}">Otvori</button>` : `<a class="secondary-btn" href="${escapeHtml(item.href)}">${escapeHtml(item.actionLabel || "Otvori")}</a>`}
        ${item.recordId ? `<button class="danger-btn delete-record-btn" type="button" data-record-id="${escapeHtml(item.recordId)}">Obriši</button>` : ""}
      </div>
    </article>
  `).join("") : `<p class="empty-row">Nema aktivnosti za prikaz.</p>`;
}

function isTimelineHighlight(item) {
  const highlightRecord = getQueryParam("highlightRecord");
  const highlightVisit = getQueryParam("highlightVisit");
  if (highlightRecord && item.recordId && String(item.recordId) === String(highlightRecord)) return true;
  return Boolean(highlightVisit && item.type === "visit" && String(item.sortKey || "").startsWith(highlightVisit));
}

function refreshPatientTimeline() {
  if (!activityTimeline) return;
  renderPatientTimeline(overviewRecords, overviewNextAppointment, overviewPatientId);
}

function activatePatientGroup(groupName) {
  const panels = Array.from(document.querySelectorAll(".patient-tab-panel"));
  const hasPanel = panels.some(panel => panel.dataset.patientPanelGroup === groupName);
  if (!hasPanel) {
    console.warn(`Patient group "${groupName}" does not have a matching panel.`);
    return;
  }

  document.querySelectorAll(".patient-group-tab").forEach(tab => {
    const isActive = tab.dataset.patientGroup === groupName;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  panels.forEach(panel => {
    const isActive = panel.dataset.patientPanelGroup === groupName;
    panel.classList.toggle("active", isActive);
    panel.hidden = !isActive;
  });
  clinicalSection?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function initializePatientGroupTabs() {
  if (!clinicalSection || clinicalSection.dataset.tabsReady === "1") return;
  clinicalSection.dataset.tabsReady = "1";

  document.querySelectorAll(".patient-group-tab").forEach(tab => {
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", tab.classList.contains("active") ? "true" : "false");
    tab.addEventListener("click", () => activatePatientGroup(tab.dataset.patientGroup));
  });
  document.querySelectorAll(".patient-tab-panel").forEach(panel => {
    panel.setAttribute("role", "tabpanel");
    panel.hidden = !panel.classList.contains("active");
  });

  quickDocumentTabBtn?.addEventListener("click", () => activatePatientGroup("documents"));
  quickUploadDocumentBtn?.addEventListener("click", () => {
    activatePatientGroup("documents");
    document.getElementById("document-file")?.focus();
  });
  internalComments?.addEventListener("click", event => {
    if (!event.target.closest('[data-empty-action="comment"]')) return;
    internalCommentInput?.focus();
  });
}

function initializeInternalCommentForm(patientId) {
  if (!internalCommentForm || internalCommentForm.dataset.ready === "1") return;
  internalCommentForm.dataset.ready = "1";
  window.DrRosaApi.getPatientInternalComments?.(patientId)
    .then(comments => {
      loadedInternalComments = comments;
      renderInternalComments();
    })
    .catch(error => {
      console.warn("Internal comments load error:", error);
      setMessage("quick-internal-comment-message", userFacingError(error, "Interni komentari trenutno nisu ucitani."), true);
    });
  internalCommentForm.addEventListener("submit", async event => {
    await runLockedFormSubmit(event, async () => {
      const body = internalCommentInput?.value.trim();
      const message = document.getElementById("quick-internal-comment-message");
      if (!body) {
        setMessage("quick-internal-comment-message", "Unesite komentar za tim.", true);
        return;
      }
      try {
        await window.DrRosaApi.createPatientInternalComment(patientId, {
          body,
          signedBy: "Osoblje"
        });
        internalCommentInput.value = "";
        loadedInternalComments = await window.DrRosaApi.getPatientInternalComments(patientId);
        renderInternalComments();
        setMessage("quick-internal-comment-message", "Komentar je dodat.");
        message?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } catch (error) {
        setMessage("quick-internal-comment-message", userFacingError(error, "Komentar nije sacuvan."), true);
      }
    });
  });
}

function initializePatientAppointmentScheduler(patient, onCreated) {
  appointmentSchedulerPatient = patient;
  appointmentSchedulerOnCreated = typeof onCreated === "function" ? onCreated : null;
  window.DrRosaAppointmentModal?.bind();
  if (!schedulePatientLink || schedulePatientLink.dataset.schedulerReady === "1") return;
  schedulePatientLink.dataset.schedulerReady = "1";
  schedulePatientLink.addEventListener("click", async event => {
    if (!window.DrRosaAppointmentModal || !appointmentSchedulerPatient?.id) return;
    event.preventDefault();
    setMessage("patient-schedule-message", "");
    await window.DrRosaAppointmentModal.openForPatient(appointmentSchedulerPatient, {
      onCreated: appointmentSchedulerOnCreated
    });
  });
}

const queryPatientId = getQueryParam("patientId") || getQueryParam("id");
const legacyPatientName = getQueryParam("patient");
const title = document.getElementById("patient-name-title");
const summaryCards = document.getElementById("patient-summary-cards");
const editPatientLink = document.getElementById("edit-patient-link");
const deletePatientBtn = document.getElementById("delete-patient-btn");
const schedulePatientLink = document.getElementById("schedule-patient-link");
const patientScheduleMessage = document.getElementById("patient-schedule-message");
const quickDocumentTabBtn = document.getElementById("quick-document-tab-btn");
const quickUploadDocumentBtn = document.getElementById("quick-upload-document-btn");
const patientWorkspace = document.getElementById("patient-workspace");
const contactSummary = document.getElementById("patient-contact-summary");
const riskSummary = document.getElementById("patient-risk-summary");
const financeSummary = document.getElementById("patient-finance-summary");
const upcomingPanel = document.getElementById("patient-upcoming-panel");
const quickDocuments = document.getElementById("patient-quick-documents");
const internalComments = document.getElementById("patient-internal-comments");
const internalCommentForm = document.getElementById("quick-internal-comment-form");
const internalCommentInput = document.getElementById("quick-internal-comment");
const activityTimeline = document.getElementById("patient-activity-timeline");
const escapeHtml = window.DrRosaSecurity.escapeHtml;
const clinicalSection = document.getElementById("patient-clinical-section");
const medicalForm = document.getElementById("medical-profile-form");
const documentForm = document.getElementById("document-form");
const documentsBody = document.getElementById("patient-documents-body");
let invoiceItemsDraft = [];
let loadedDocuments = [];
let initialConditionEditor;
let loadedInternalComments = [];
let loadedClinicalNotes = [];
let loadedPatientConsents = [];
let loadedInvoices = [];
let overviewRecords = [];
let overviewNextAppointment = null;
let overviewPatientId = null;
let overviewAppointments = [];
let visitPaymentHistory = {
  patientId: null,
  page: 1,
  limit: 5,
  cache: new Map(),
  hasMoreByPage: new Map(),
  loading: false
};
let appointmentSchedulerPatient = null;
let appointmentSchedulerOnCreated = null;
let imagingObjectUrl = "";
const imagingState = {
  documentId: null,
  url: "",
  mimeType: "",
  zoom: 1,
  rotation: 0,
  x: 0,
  y: 0,
  brightness: 100,
  contrast: 100,
  invert: false,
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  originX: 0,
  originY: 0
};

const statusLabels = {
  planned: "Planirano",
  in_progress: "U toku",
  completed: "Završeno",
  watch: "Praćenje",
  referred: "Upućen",
  draft: "Nacrt",
  presented: "Prezentovan",
  accepted: "Prihvaćen",
  declined: "Odbijen",
  issued: "Izdat",
  partially_paid: "Delimično placen",
  paid: "Plaćeno",
  void: "Storniran",
  refunded: "Refundiran",
  eligibility_checked: "Proverena podobnost",
  preauth_sent: "Predautorizacija poslata",
  submitted: "Poslato",
  approved: "Odobreno",
  partially_approved: "Delimično odobreno",
  denied: "Odbijeno",
  eligibility_ok: "Podobnost potvrdjena",
  eligibility_failed: "Podobnost odbijena",
  submitted_to_clearinghouse: "Poslato posredniku",
  era_posted: "Obračun proknjizen",
  unreconciled: "Nije uskladjeno",
  reconciled: "Uskladjeno"
};

const consentTypeLabels = {
  treatment: "Terapija",
  surgery: "Hirurgija",
  privacy: "Privatnost",
  financial: "Finansije"
};

const noteCategoryLabels = {
  general: "Opste",
  endodontics: "Endodoncija",
  consent: "Saglasnost"
};

const imagingModalityLabels = {
  intraoral_xray: "Intraoralni RTG",
  panoramic_xray: "Ortopan",
  cbct: "CBCT",
  photo: "Fotografija"
};

const fieldLabels = {
  fileBase64: "Fajl",
  visitRecordId: "Poseta",
  documentType: "Tip dokumenta",
  title: "Naziv",
  description: "Opis",
  documentDate: "Datum dokumenta",
  originalFilename: "Naziv fajla",
  mimeType: "Tip fajla",
  imagingModality: "Modalitet snimka",
  toothNumber: "Zub / regija",
  acquisitionDate: "Datum snimanja",
  dicomStudyUid: "DICOM Study UID",
  claimAttachmentReady: "Spremno za osiguranje",
  templateId: "Sablon",
  body: "Tekst",
  signedBy: "Potpisuje",
  consentType: "Tip saglasnosti",
  signerName: "Potpisnik",
  signatureData: "Potpis"
};

function labelFromMap(map, value) {
  return map[value] || value || "-";
}

function userFacingError(error, fallback) {
  const raw = error?.message || fallback || "Akcija nije uspela.";
  return Object.entries(fieldLabels).reduce((message, [field, label]) => {
    return message.replaceAll(`"${field}"`, `"${label}"`).replaceAll(field, label);
  }, raw);
}

function renderEmpty(message) {
  if (activityTimeline) {
    activityTimeline.innerHTML = `<p class="empty-row">${escapeHtml(message)}</p>`;
  }
}

function setMessage(id, message, isError = false) {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = message || "";
  element.className = `form-alert ${isError ? "alert-error" : "alert-success"}`;
}

function fillMedicalProfile(profile) {
  document.getElementById("medical-blood-type").value = profile.bloodType || "";
  document.getElementById("medical-pregnancy-status").value = profile.pregnancyStatus || "";
  document.getElementById("medical-allergies").value = profile.allergies || "";
  document.getElementById("medical-medications").value = profile.medications || "";
  document.getElementById("medical-chronic-conditions").value = profile.chronicConditions || "";
  document.getElementById("medical-contraindications").value = profile.contraindications || "";
  document.getElementById("medical-previous-surgeries").value = profile.previousSurgeries || "";
  document.getElementById("medical-smoker").checked = Boolean(profile.smoker);
  document.getElementById("medical-diabetes").checked = Boolean(profile.diabetes);
  document.getElementById("medical-high-blood-pressure").checked = Boolean(profile.highBloodPressure);
  document.getElementById("medical-heart-condition").checked = Boolean(profile.heartCondition);
  document.getElementById("medical-anesthesia-warning").value = profile.anesthesiaWarning || "";
  document.getElementById("medical-dental-notes").value = profile.dentalNotes || "";
  document.getElementById("medical-internal-notes").value = profile.internalNotes || "";
}

function readMedicalProfileForm() {
  return {
    bloodType: document.getElementById("medical-blood-type").value,
    pregnancyStatus: document.getElementById("medical-pregnancy-status").value,
    allergies: document.getElementById("medical-allergies").value,
    medications: document.getElementById("medical-medications").value,
    chronicConditions: document.getElementById("medical-chronic-conditions").value,
    contraindications: document.getElementById("medical-contraindications").value,
    previousSurgeries: document.getElementById("medical-previous-surgeries").value,
    smoker: document.getElementById("medical-smoker").checked,
    diabetes: document.getElementById("medical-diabetes").checked,
    highBloodPressure: document.getElementById("medical-high-blood-pressure").checked,
    heartCondition: document.getElementById("medical-heart-condition").checked,
    anesthesiaWarning: document.getElementById("medical-anesthesia-warning").value,
    dentalNotes: document.getElementById("medical-dental-notes").value,
    internalNotes: document.getElementById("medical-internal-notes").value
  };
}

function fillVisitOptions(records) {
  const select = document.getElementById("document-visit");
  select.innerHTML = `<option value="">Bez vezane posete</option>${records.map(record => `
    <option value="${escapeHtml(record.id)}">${formatDate(record.lastVisit)} - ${escapeHtml(record.procedure)}</option>
  `).join("")}`;
}

function formatFileSize(size) {
  const bytes = Number(size || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function documentTypeLabel(type) {
  return {
    rtg: "RTG",
    ortopan: "Ortopan",
    photo: "Fotografija",
    finding: "Nalaz",
    lab: "Laboratorija",
    consent: "Saglasnost",
    invoice: "Račun",
    other: "Ostalo"
  }[type] || type || "-";
}

function imagingModalityLabel(value) {
  return labelFromMap(imagingModalityLabels, value);
}

function renderDocuments(documents) {
  loadedDocuments = documents;
  refreshPatientFirstScreen();
  documentsBody.innerHTML = documents.length ? documents.map(document => `
    <tr>
      <td>${escapeHtml(document.title)}</td>
      <td>${escapeHtml(documentTypeLabel(document.documentType))}</td>
      <td>${formatDate(document.documentDate || document.createdAt)}</td>
      <td>${document.source === "scanner" ? "Skener" : "Otpremanje"}</td>
      <td>${escapeHtml([imagingModalityLabel(document.imagingModality), document.toothNumber].filter(item => item && item !== "-").join(" / ") || "-")}</td>
      <td>${formatFileSize(document.fileSize)}</td>
      <td>
        <button class="secondary-btn view-document-btn" type="button" data-document-id="${document.id}">Pregled</button>
        <button class="secondary-btn edit-document-btn" type="button" data-document-id="${document.id}">Uredi</button>
        <button class="secondary-btn download-document-btn" type="button" data-document-id="${document.id}">Preuzmi</button>
        <button class="danger-btn delete-document-btn" type="button" data-document-id="${document.id}">Obriši</button>
      </td>
    </tr>
  `).join("") : `<tr><td colspan="7" class="empty-row">Nema dokumenata za ovog pacijenta.</td></tr>`;
}

function documentViewUrl(documentId) {
  return `/api/documents/${encodeURIComponent(documentId)}/view`;
}

function documentPreviewMarkup(documentRow) {
  const viewUrl = documentViewUrl(documentRow.id);
  const mimeType = String(documentRow.mimeType || "");
  if (mimeType.startsWith("image/")) {
    return `<img class="document-current-file-preview" src="${escapeHtml(viewUrl)}" alt="${escapeHtml(documentRow.title || "Dokument")}" />`;
  }
  if (mimeType === "application/pdf") {
    return `<iframe class="document-current-file-preview document-current-file-frame" src="${escapeHtml(viewUrl)}" title="${escapeHtml(documentRow.title || "Pregled dokumenta")}"></iframe>`;
  }
  return `<p class="muted-text">Preview nije dostupan za ovaj tip fajla. Koristite Pregled ili Preuzmi.</p>`;
}

function renderCurrentDocumentFile(documentRow) {
  const container = document.getElementById("document-current-file");
  if (!container) return;
  if (!documentRow?.id) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }
  container.hidden = false;
  container.innerHTML = `
    <div class="document-current-file-header">
      <div>
        <p class="eyebrow">Postojeci fajl</p>
        <strong>${escapeHtml(documentRow.originalFilename || documentRow.title || "Dokument")}</strong>
        <span>${escapeHtml(documentRow.mimeType || "-")} / ${formatFileSize(documentRow.fileSize)}</span>
      </div>
      <div class="document-current-file-actions">
        <button class="secondary-btn view-document-btn" type="button" data-document-id="${escapeHtml(documentRow.id)}">Pregled</button>
        <button class="secondary-btn download-document-btn" type="button" data-document-id="${escapeHtml(documentRow.id)}">Preuzmi</button>
      </div>
    </div>
    ${documentPreviewMarkup(documentRow)}
    <p class="form-hint">Postojeci fajl ostaje sacuvan ako ne odaberete novi. Novi fajl dodajte samo ako zelite da zamenite postojeci.</p>
  `;
}

function documentPayloadFromForm() {
  return {
    documentType: document.getElementById("document-type").value,
    title: document.getElementById("document-title").value,
    documentDate: document.getElementById("document-date").value,
    visitRecordId: document.getElementById("document-visit").value,
    description: document.getElementById("document-description").value,
    imagingModality: document.getElementById("document-imaging-modality").value,
    toothNumber: document.getElementById("document-tooth-number").value,
    acquisitionDate: document.getElementById("document-date").value,
    dicomStudyUid: document.getElementById("document-dicom-study-uid").value,
    claimAttachmentReady: Boolean(document.getElementById("document-imaging-modality").value || document.getElementById("document-dicom-study-uid").value)
  };
}

function resetDocumentForm(patientRecords) {
  documentForm.reset();
  document.getElementById("document-id").value = "";
  document.getElementById("document-file").required = false;
  document.getElementById("document-file-label").textContent = "Otpremanje fajla";
  renderCurrentDocumentFile(null);
  document.getElementById("cancel-document-edit-btn").hidden = true;
  document.getElementById("upload-document-btn").textContent = "Otpremi fajl";
  document.getElementById("import-scan-btn").hidden = false;
  fillVisitOptions(patientRecords);
}

function fillDocumentForm(documentRow) {
  document.getElementById("document-id").value = documentRow.id;
  document.getElementById("document-type").value = documentRow.documentType || "other";
  document.getElementById("document-title").value = documentRow.title || "";
  document.getElementById("document-date").value = documentRow.documentDate || documentRow.acquisitionDate || "";
  document.getElementById("document-imaging-modality").value = documentRow.imagingModality || "";
  document.getElementById("document-tooth-number").value = documentRow.toothNumber || "";
  document.getElementById("document-dicom-study-uid").value = documentRow.dicomStudyUid || "";
  document.getElementById("document-visit").value = documentRow.visitRecordId || "";
  document.getElementById("document-description").value = documentRow.description || "";
  document.getElementById("document-file").value = "";
  document.getElementById("document-file-label").textContent = "Novi fajl, samo ako zelite da zamenite postojeci";
  renderCurrentDocumentFile(documentRow);
  document.getElementById("cancel-document-edit-btn").hidden = false;
  document.getElementById("upload-document-btn").textContent = "Sačuvaj dokument";
  document.getElementById("import-scan-btn").hidden = true;
  documentForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function documentFilePayload(file) {
  return {
    originalFilename: file.name,
    mimeType: file.type || (file.name.toLowerCase().endsWith(".dcm") || file.name.toLowerCase().endsWith(".dicom") ? "application/dicom" : "application/octet-stream"),
    fileBase64: await fileToBase64(file)
  };
}

function resetImagingState() {
  imagingState.zoom = 1;
  imagingState.rotation = 0;
  imagingState.x = 0;
  imagingState.y = 0;
  imagingState.brightness = 100;
  imagingState.contrast = 100;
  imagingState.invert = false;
  document.getElementById("imaging-brightness").value = "100";
  document.getElementById("imaging-contrast").value = "100";
}

function applyImagingTransform() {
  const image = document.getElementById("imaging-image");
  image.style.transform = `translate(${imagingState.x}px, ${imagingState.y}px) scale(${imagingState.zoom}) rotate(${imagingState.rotation}deg)`;
  image.style.filter = `brightness(${imagingState.brightness}%) contrast(${imagingState.contrast}%)${imagingState.invert ? " invert(1)" : ""}`;
}

function closeImagingViewer() {
  document.getElementById("imaging-viewer").hidden = true;
  document.getElementById("imaging-image").hidden = true;
  document.getElementById("imaging-dicom-canvas").hidden = true;
  document.getElementById("imaging-frame").hidden = true;
  document.getElementById("imaging-viewer-empty").hidden = true;
  if (imagingObjectUrl) URL.revokeObjectURL(imagingObjectUrl);
  imagingObjectUrl = "";
  imagingState.documentId = null;
  imagingState.url = "";
}

function fitImagingToStage() {
  const image = document.getElementById("imaging-image");
  const stage = document.getElementById("imaging-stage");
  if (image.hidden || !image.naturalWidth || !image.naturalHeight) return;
  const scaleX = (stage.clientWidth * 0.92) / image.naturalWidth;
  const scaleY = (stage.clientHeight * 0.92) / image.naturalHeight;
  imagingState.zoom = Math.max(0.1, Math.min(scaleX, scaleY, 1.6));
  imagingState.x = 0;
  imagingState.y = 0;
  applyImagingTransform();
}

function initializeImagingViewerControls() {
  const viewer = document.getElementById("imaging-viewer");
  const image = document.getElementById("imaging-image");
  const stage = document.getElementById("imaging-stage");
  const brightness = document.getElementById("imaging-brightness");
  const contrast = document.getElementById("imaging-contrast");

  document.getElementById("imaging-close-btn").addEventListener("click", closeImagingViewer);
  document.getElementById("imaging-download-btn").addEventListener("click", async () => {
    if (!imagingState.documentId) return;
    await openDocument(imagingState.documentId, true);
  });

  viewer.addEventListener("click", event => {
    const tool = event.target.closest("[data-imaging-tool]")?.dataset.imagingTool;
    if (!tool || image.hidden) return;
    if (tool === "zoom-in") imagingState.zoom = Math.min(8, imagingState.zoom + 0.2);
    if (tool === "zoom-out") imagingState.zoom = Math.max(0.1, imagingState.zoom - 0.2);
    if (tool === "rotate-left") imagingState.rotation -= 90;
    if (tool === "rotate-right") imagingState.rotation += 90;
    if (tool === "invert") imagingState.invert = !imagingState.invert;
    if (tool === "fit") return fitImagingToStage();
    if (tool === "reset") resetImagingState();
    applyImagingTransform();
  });

  brightness.addEventListener("input", event => {
    imagingState.brightness = Number(event.target.value || 100);
    applyImagingTransform();
  });

  contrast.addEventListener("input", event => {
    imagingState.contrast = Number(event.target.value || 100);
    applyImagingTransform();
  });

  image.addEventListener("load", fitImagingToStage);

  stage.addEventListener("pointerdown", event => {
    if (image.hidden) return;
    imagingState.dragging = true;
    imagingState.dragStartX = event.clientX;
    imagingState.dragStartY = event.clientY;
    imagingState.originX = imagingState.x;
    imagingState.originY = imagingState.y;
    stage.classList.add("is-dragging");
    stage.setPointerCapture(event.pointerId);
  });

  stage.addEventListener("pointermove", event => {
    if (!imagingState.dragging) return;
    imagingState.x = imagingState.originX + event.clientX - imagingState.dragStartX;
    imagingState.y = imagingState.originY + event.clientY - imagingState.dragStartY;
    applyImagingTransform();
  });

  stage.addEventListener("pointerup", event => {
    imagingState.dragging = false;
    stage.classList.remove("is-dragging");
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  });

  stage.addEventListener("wheel", event => {
    if (image.hidden) return;
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.12 : -0.12;
    imagingState.zoom = Math.max(0.1, Math.min(8, imagingState.zoom + delta));
    applyImagingTransform();
  }, { passive: false });
}

async function fetchDocumentBlob(documentId, download = false) {
  const response = await fetch(`/api/documents/${documentId}/${download ? "download" : "view"}`, {
    credentials: "include"
  });
  if (!response.ok) throw new Error("Dokument nije dostupan.");
  return response.blob();
}

async function openDocument(documentId, download = false) {
  const blob = await fetchDocumentBlob(documentId, download);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  if (download) link.download = "drrosa-dokument";
  link.target = "_blank";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isDicomDocument(documentRow, mimeType) {
  const filename = String(documentRow?.originalFilename || "").toLowerCase();
  return mimeType === "application/dicom"
    || filename.endsWith(".dcm")
    || filename.endsWith(".dicom")
    || Boolean(documentRow?.dicomStudyUid);
}

function dicomString(bytes, offset, length) {
  return Array.from(bytes.slice(offset, offset + length))
    .map(code => code ? String.fromCharCode(code) : "")
    .join("")
    .trim();
}

function parseDicomImage(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = bytes.length > 132 && dicomString(bytes, 128, 4) === "DICM" ? 132 : 0;
  const meta = {};
  const longVr = new Set(["OB", "OW", "OF", "SQ", "UT", "UN"]);
  let pixelOffset = 0;
  let pixelLength = 0;

  while (offset + 8 <= bytes.length) {
    const group = view.getUint16(offset, true);
    const element = view.getUint16(offset + 2, true);
    const vr = dicomString(bytes, offset + 4, 2);
    let valueOffset;
    let length;

    if (/^[A-Z]{2}$/.test(vr)) {
      if (longVr.has(vr)) {
        length = view.getUint32(offset + 8, true);
        valueOffset = offset + 12;
      } else {
        length = view.getUint16(offset + 6, true);
        valueOffset = offset + 8;
      }
    } else {
      length = view.getUint32(offset + 4, true);
      valueOffset = offset + 8;
    }

    if (length === 0xffffffff || valueOffset + length > bytes.length) break;
    const tag = `${group.toString(16).padStart(4, "0")}${element.toString(16).padStart(4, "0")}`;
    if (tag === "00280010") meta.rows = view.getUint16(valueOffset, true);
    if (tag === "00280011") meta.columns = view.getUint16(valueOffset, true);
    if (tag === "00280100") meta.bitsAllocated = view.getUint16(valueOffset, true);
    if (tag === "00280103") meta.pixelRepresentation = view.getUint16(valueOffset, true);
    if (tag === "00280004") meta.photometric = dicomString(bytes, valueOffset, length);
    if (tag === "00281050") meta.windowCenter = Number(dicomString(bytes, valueOffset, length).split("\\")[0]);
    if (tag === "00281051") meta.windowWidth = Number(dicomString(bytes, valueOffset, length).split("\\")[0]);
    if (tag === "00281052") meta.rescaleIntercept = Number(dicomString(bytes, valueOffset, length).split("\\")[0]);
    if (tag === "00281053") meta.rescaleSlope = Number(dicomString(bytes, valueOffset, length).split("\\")[0]);
    if (tag === "7fe00010") {
      pixelOffset = valueOffset;
      pixelLength = length;
      break;
    }
    offset = valueOffset + length + (length % 2);
  }

  if (!meta.rows || !meta.columns || !pixelOffset || !pixelLength) {
    throw new Error("DICOM snimak ne može da se procita u pregledacu. Preuzmite fajl ili ga otvorite u DICOM programu.");
  }
  return { ...meta, pixelOffset, pixelLength };
}

function renderDicomToCanvas(buffer) {
  const meta = parseDicomImage(buffer);
  const canvas = document.getElementById("imaging-dicom-canvas");
  const ctx = canvas.getContext("2d");
  const width = meta.columns;
  const height = meta.rows;
  const count = width * height;
  const view = new DataView(buffer, meta.pixelOffset, meta.pixelLength);
  const pixels = new Float32Array(count);
  const bits = Number(meta.bitsAllocated || 16);
  const slope = Number.isFinite(meta.rescaleSlope) ? meta.rescaleSlope : 1;
  const intercept = Number.isFinite(meta.rescaleIntercept) ? meta.rescaleIntercept : 0;
  let min = Infinity;
  let max = -Infinity;

  for (let index = 0; index < count; index += 1) {
    let value = bits <= 8
      ? view.getUint8(index)
      : (meta.pixelRepresentation ? view.getInt16(index * 2, true) : view.getUint16(index * 2, true));
    value = value * slope + intercept;
    pixels[index] = value;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  if (Number.isFinite(meta.windowCenter) && Number.isFinite(meta.windowWidth) && meta.windowWidth > 0) {
    min = meta.windowCenter - meta.windowWidth / 2;
    max = meta.windowCenter + meta.windowWidth / 2;
  }

  const imageData = ctx.createImageData(width, height);
  const inverted = String(meta.photometric || "").toUpperCase().includes("MONOCHROME1");
  const range = Math.max(1, max - min);
  for (let index = 0; index < count; index += 1) {
    let value = Math.round(((pixels[index] - min) / range) * 255);
    value = Math.max(0, Math.min(255, inverted ? 255 - value : value));
    const out = index * 4;
    imageData.data[out] = value;
    imageData.data[out + 1] = value;
    imageData.data[out + 2] = value;
    imageData.data[out + 3] = 255;
  }

  canvas.width = width;
  canvas.height = height;
  ctx.putImageData(imageData, 0, 0);
  canvas.style.transform = "none";
  canvas.hidden = false;
}

async function openImagingViewer(documentId) {
  const documentRow = loadedDocuments.find(item => String(item.id) === String(documentId));
  const blob = await fetchDocumentBlob(documentId, false);
  const mimeType = blob.type || documentRow?.mimeType || "";
  if (imagingObjectUrl) URL.revokeObjectURL(imagingObjectUrl);
  imagingObjectUrl = URL.createObjectURL(blob);

  resetImagingState();
  imagingState.documentId = documentId;
  imagingState.url = imagingObjectUrl;
  imagingState.mimeType = mimeType;

  const viewer = document.getElementById("imaging-viewer");
  const image = document.getElementById("imaging-image");
  const dicomCanvas = document.getElementById("imaging-dicom-canvas");
  const frame = document.getElementById("imaging-frame");
  const empty = document.getElementById("imaging-viewer-empty");
  const title = document.getElementById("imaging-viewer-title");
  const meta = document.getElementById("imaging-viewer-meta");
  const stage = document.getElementById("imaging-stage");

  title.textContent = documentRow?.title || "Snimak";
  meta.textContent = [
    documentTypeLabel(documentRow?.documentType),
    imagingModalityLabel(documentRow?.imagingModality),
    documentRow?.toothNumber ? `Zub/regija: ${documentRow.toothNumber}` : "",
    documentRow?.source === "scanner" ? "Skener" : "Otpremanje",
    formatFileSize(documentRow?.fileSize)
  ].filter(Boolean).join(" | ");

  viewer.hidden = false;
  image.hidden = true;
  dicomCanvas.hidden = true;
  frame.hidden = true;
  empty.hidden = true;
  stage.classList.remove("is-draggable", "is-dragging");

  if (isDicomDocument(documentRow, mimeType)) {
    try {
      renderDicomToCanvas(await blob.arrayBuffer());
    } catch (error) {
      empty.textContent = userFacingError(error, "DICOM pregled nije dostupan. Koristite Preuzmi.");
      empty.hidden = false;
    }
  } else if (mimeType.startsWith("image/")) {
    image.src = imagingObjectUrl;
    image.hidden = false;
    stage.classList.add("is-draggable");
    applyImagingTransform();
  } else if (mimeType === "application/pdf") {
    frame.src = imagingObjectUrl;
    frame.hidden = false;
  } else {
    empty.hidden = false;
  }

  viewer.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadDocuments(patientId) {
  const documents = await window.DrRosaApi.getPatientDocuments(patientId);
  renderDocuments(documents);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function renderInvoiceDraft() {
  const preview = document.getElementById("invoice-items-preview");
  preview.innerHTML = invoiceItemsDraft.length
    ? invoiceItemsDraft.map((item, index) => `<p>${escapeHtml(item.description)} - ${formatMoney(item.unitPrice)} <button class="danger-btn remove-invoice-item" type="button" data-index="${index}">x</button></p>`).join("")
    : "<p>Nema stavki računa.</p>";
}

function readInvoiceItemForm() {
  const description = document.getElementById("invoice-item-description").value.trim();
  if (!description) return null;
  return {
    description,
    quantity: 1,
    unitPrice: Number(document.getElementById("invoice-item-price").value || 0),
    discount: 0
  };
}

function clearInvoiceItemForm() {
  document.getElementById("invoice-item-description").value = "";
  document.getElementById("invoice-item-price").value = "";
}

function renderInvoices(invoices) {
  loadedInvoices = invoices;
  refreshPatientTimeline();
  document.getElementById("invoices-body").innerHTML = invoices.length ? invoices.map(invoice => `
    <tr>
      <td>${escapeHtml(invoice.invoiceNumber)}</td>
      <td>${escapeHtml(labelFromMap(statusLabels, invoice.status))}</td>
      <td>${formatMoney(invoice.total, invoice.currency)}</td>
      <td>${formatMoney(invoice.amountPaid, invoice.currency)}</td>
      <td>
        <button class="secondary-btn invoice-payment-btn" type="button" data-invoice-id="${invoice.id}">Uplata</button>
        <button class="secondary-btn invoice-pdf-btn" type="button" data-invoice-id="${invoice.id}">PDF</button>
      </td>
    </tr>
  `).join("") : `<tr><td colspan="5" class="empty-row">Nema računa.</td></tr>`;
}

function renderLedger(ledger) {
  const summary = document.getElementById("patient-ledger-summary");
  if (!summary) return;
  const entries = ledger.entries || [];
  summary.innerHTML = `<strong>Saldo kartice:</strong> ${formatMoney(ledger.balance || 0)} <span class="muted">(${entries.length} knjizenja)</span>`;
}

function renderInsuranceClaims(claims) {
  document.getElementById("insurance-claims-body").innerHTML = claims.length ? claims.map(claim => `
    <tr>
      <td>${escapeHtml(claim.provider)}<br><small>${escapeHtml(claim.policyNumber || "-")}</small></td>
      <td>${escapeHtml(labelFromMap(statusLabels, claim.status))}${claim.eligibilityStatus ? `<br><small>${escapeHtml(labelFromMap(statusLabels, claim.eligibilityStatus))}</small>` : ""}</td>
      <td>${formatMoney(claim.requestedAmount)}</td>
      <td>${claim.eob ? `${formatMoney(claim.paidAmount)}<br><small>${escapeHtml(labelFromMap(statusLabels, claim.eraStatus) || "Obračun")}</small>` : escapeHtml(claim.denialReason || claim.eligibilityNotes || "-")}</td>
      <td>
        <button class="secondary-btn claim-eligibility-btn" type="button" data-claim-id="${claim.id}">Proveri podobnost</button>
        <button class="secondary-btn claim-submit-btn" type="button" data-claim-id="${claim.id}">Posalji zahtev</button>
        <button class="secondary-btn claim-era-btn" type="button" data-claim-id="${claim.id}" data-amount="${claim.approvedAmount || claim.requestedAmount || 0}">Proknjizi obračun</button>
      </td>
    </tr>
  `).join("") : `<tr><td colspan="5" class="empty-row">Nema zahteva za osiguranje.</td></tr>`;
}

function renderClinicalNoteTemplates(templates) {
  const select = document.getElementById("clinical-note-template");
  select.innerHTML = `<option value="">Prazna beleška</option>${templates.map(template => `
    <option value="${template.id}" data-title="${escapeHtml(template.title)}" data-body="${escapeHtml(template.body)}">${escapeHtml(labelFromMap(noteCategoryLabels, template.category))} - ${escapeHtml(template.title)}</option>
  `).join("")}`;
}

function renderClinicalNotes(notes) {
  loadedClinicalNotes = notes;
  refreshPatientFirstScreen();
  document.getElementById("clinical-notes-body").innerHTML = notes.length ? notes.map(note => `
    <tr>
      <td>${escapeHtml(note.title)}<br><small>${escapeHtml(String(note.body || "").slice(0, 120))}</small></td>
      <td>${note.signedAt ? `${escapeHtml(note.signedBy || "-")}<br><small>${formatDate(note.signedAt)}</small>` : "Nije potpisano"}</td>
      <td>${formatDate(note.createdAt)}</td>
      <td>
        <button class="secondary-btn edit-clinical-note-btn" type="button" data-note-id="${note.id}">Uredi</button>
        ${note.signedAt ? "" : `<button class="primary-btn sign-clinical-note-btn" type="button" data-note-id="${note.id}">Potpis</button>`}
        <button class="danger-btn delete-clinical-note-btn" type="button" data-note-id="${note.id}">Obriši</button>
      </td>
    </tr>
  `).join("") : `<tr><td colspan="4" class="empty-row">Nema kliničkih beleški.</td></tr>`;
}

function renderPatientConsents(consents) {
  loadedPatientConsents = consents;
  document.getElementById("patient-consents-body").innerHTML = consents.length ? consents.map(consent => `
    <tr>
      <td>${escapeHtml(consent.title)}<br><small>${escapeHtml(labelFromMap(consentTypeLabels, consent.consentType))}</small></td>
      <td>${escapeHtml(consent.signerName)}<br><small>${escapeHtml(consent.signatureData)}</small></td>
      <td>${formatDate(consent.signedAt)}</td>
      <td>
        <button class="secondary-btn edit-consent-btn" type="button" data-consent-id="${consent.id}">Uredi</button>
        <button class="danger-btn delete-consent-btn" type="button" data-consent-id="${consent.id}">Obriši</button>
      </td>
    </tr>
  `).join("") : `<tr><td colspan="4" class="empty-row">Nema sačuvanih saglasnosti.</td></tr>`;
}

function clinicalNotePayloadFromForm() {
  return {
    templateId: document.getElementById("clinical-note-template").value,
    title: document.getElementById("clinical-note-title").value,
    body: document.getElementById("clinical-note-body").value,
    signedBy: document.getElementById("clinical-note-signed-by").value
  };
}

function resetClinicalNoteForm() {
  const form = document.getElementById("clinical-note-form");
  form.reset();
  document.getElementById("clinical-note-id").value = "";
  document.getElementById("cancel-clinical-note-edit-btn").hidden = true;
  form.querySelector('button[type="submit"]').textContent = "Sačuvaj belesku";
}

function fillClinicalNoteForm(note) {
  document.getElementById("clinical-note-id").value = note.id;
  document.getElementById("clinical-note-template").value = note.templateId || "";
  document.getElementById("clinical-note-title").value = note.title || "";
  document.getElementById("clinical-note-body").value = note.body || "";
  document.getElementById("clinical-note-signed-by").value = note.signedBy || "";
  document.getElementById("cancel-clinical-note-edit-btn").hidden = false;
  document.getElementById("clinical-note-form").querySelector('button[type="submit"]').textContent = "Sačuvaj izmenu";
  document.getElementById("clinical-note-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

function consentPayloadFromForm() {
  return {
    consentType: document.getElementById("consent-type").value,
    title: document.getElementById("consent-title").value,
    body: document.getElementById("consent-body").value,
    signerName: document.getElementById("consent-signer").value,
    signatureData: document.getElementById("consent-signature").value
  };
}

function resetConsentForm() {
  const form = document.getElementById("patient-consent-form");
  form.reset();
  document.getElementById("consent-id").value = "";
  document.getElementById("cancel-consent-edit-btn").hidden = true;
  form.querySelector('button[type="submit"]').textContent = "Sačuvaj saglasnost";
}

function fillConsentForm(consent) {
  document.getElementById("consent-id").value = consent.id;
  document.getElementById("consent-type").value = consent.consentType || "treatment";
  document.getElementById("consent-title").value = consent.title || "";
  document.getElementById("consent-body").value = consent.body || "";
  document.getElementById("consent-signer").value = consent.signerName || "";
  document.getElementById("consent-signature").value = consent.signatureData || "";
  document.getElementById("cancel-consent-edit-btn").hidden = false;
  document.getElementById("patient-consent-form").querySelector('button[type="submit"]').textContent = "Sačuvaj izmenu";
  document.getElementById("patient-consent-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function initializeClinicalWorkflows(patientId) {
  async function refreshClinicalChart() {
    const entries = await window.DrRosaApi.getClinicalChart(patientId);
    initialConditionEditor?.setEntries(window.DrRosaToothCondition.initialConditionsFromEntries(entries));
  }
  async function refreshClinicalNotes() {
    renderClinicalNotes(await window.DrRosaApi.getClinicalNotes(patientId));
  }
  async function refreshConsents() {
    renderPatientConsents(await window.DrRosaApi.getPatientConsents(patientId));
  }

  const templates = await window.DrRosaApi.getClinicalNoteTemplates();
  renderClinicalNoteTemplates(templates);

  document.getElementById("clinical-note-template").addEventListener("change", event => {
    const selected = event.target.selectedOptions[0];
    if (!selected?.value) return;
    document.getElementById("clinical-note-title").value = selected.dataset.title || "";
    document.getElementById("clinical-note-body").value = selected.dataset.body || "";
  });

  document.getElementById("clinical-note-form").addEventListener("submit", async event => {
    await runLockedFormSubmit(event, async () => {
      try {
        const noteId = document.getElementById("clinical-note-id").value;
        const payload = clinicalNotePayloadFromForm();
        if (noteId) {
          await window.DrRosaApi.updateClinicalNote(noteId, payload);
        } else {
          await window.DrRosaApi.createClinicalNote(patientId, payload);
        }
        resetClinicalNoteForm();
        setMessage("clinical-note-message", noteId ? "Klinicka beleska je izmenjena." : "Klinicka beleska je sacuvana.");
        await refreshClinicalNotes();
      } catch (error) {
        setMessage("clinical-note-message", userFacingError(error, "Klinicka beleska nije sacuvana."), true);
      }
    });
  });
  document.getElementById("cancel-clinical-note-edit-btn").addEventListener("click", () => {
    resetClinicalNoteForm();
    setMessage("clinical-note-message", "");
  });

  document.getElementById("clinical-notes-body").addEventListener("click", async event => {
    const editButton = event.target.closest(".edit-clinical-note-btn");
    const signButton = event.target.closest(".sign-clinical-note-btn");
    const deleteButton = event.target.closest(".delete-clinical-note-btn");
    if (editButton) {
      const note = loadedClinicalNotes.find(item => String(item.id) === String(editButton.dataset.noteId));
      if (note) fillClinicalNoteForm(note);
      return;
    }
    if (signButton) {
      const signedBy = window.prompt("Potpisuje:", "Dr Rosa");
      if (!signedBy) return;
      await window.DrRosaApi.signClinicalNote(signButton.dataset.noteId, { signedBy });
      setMessage("clinical-note-message", "Klinička beleška je potpisana.");
      await refreshClinicalNotes();
      return;
    }
    if (!deleteButton) return;
    if (!confirm("Da li želite da obrišete ovu klinicku belesku?")) return;
    await window.DrRosaApi.deleteClinicalNote(deleteButton.dataset.noteId);
    resetClinicalNoteForm();
    setMessage("clinical-note-message", "Klinička beleška je obrisana.");
    await refreshClinicalNotes();
  });

  document.getElementById("patient-consent-form").addEventListener("submit", async event => {
    await runLockedFormSubmit(event, async () => {
      try {
        const consentId = document.getElementById("consent-id").value;
        const payload = consentPayloadFromForm();
        if (consentId) {
          await window.DrRosaApi.updatePatientConsent(consentId, payload);
        } else {
          await window.DrRosaApi.createPatientConsent(patientId, payload);
        }
        resetConsentForm();
        setMessage("consent-message", consentId ? "Saglasnost je izmenjena." : "Saglasnost je sačuvana i potpisana.");
        await refreshConsents();
      } catch (error) {
        setMessage("consent-message", userFacingError(error, "Saglasnost nije sačuvana."), true);
      }
    });
  });

  document.getElementById("cancel-consent-edit-btn").addEventListener("click", () => {
    resetConsentForm();
    setMessage("consent-message", "");
  });

  document.getElementById("patient-consents-body").addEventListener("click", async event => {
    const editButton = event.target.closest(".edit-consent-btn");
    const deleteButton = event.target.closest(".delete-consent-btn");
    if (editButton) {
      const consent = loadedPatientConsents.find(item => String(item.id) === String(editButton.dataset.consentId));
      if (consent) fillConsentForm(consent);
      return;
    }
    if (!deleteButton) return;
    if (!confirm("Da li želite da obrišete ovu saglasnost?")) return;
    await window.DrRosaApi.deletePatientConsent(deleteButton.dataset.consentId);
    resetConsentForm();
    setMessage("consent-message", "Saglasnost je obrisana.");
    await refreshConsents();
  });

  const initialConditionRoot = document.getElementById("patient-initial-condition-editor");
  if (initialConditionRoot && window.DrRosaToothCondition) {
    initialConditionEditor = window.DrRosaToothCondition.createEditor(initialConditionRoot, {
      title: "Zateceno stanje zuba",
      emptyMessage: "Nema unetog zatecenog stanja za ovog pacijenta.",
      onAdd: payload => window.DrRosaApi.createClinicalChartEntry(patientId, payload),
      onUpdate: (entryId, payload) => window.DrRosaApi.updateClinicalChartEntry(entryId, payload),
      onRemove: entry => window.DrRosaApi.deleteClinicalChartEntry(entry.id)
    });
  }

  await Promise.all([refreshClinicalChart(), refreshClinicalNotes(), refreshConsents()]);
}

async function initializeAdvancedWorkflows(patientId) {
  document.getElementById("invoice-date").value = today();

  async function refreshInvoices() {
    renderInvoices(await window.DrRosaApi.getInvoices(patientId));
    renderLedger(await window.DrRosaApi.getPatientLedger(patientId));
  }
  async function refreshClaims() {
    renderInsuranceClaims(await window.DrRosaApi.getInsuranceClaims(patientId));
  }

  renderInvoiceDraft();
  await Promise.all([refreshInvoices(), refreshClaims()]);

  document.getElementById("add-invoice-item-btn").addEventListener("click", () => {
    const item = readInvoiceItemForm();
    if (!item) return setMessage("invoice-message", "Unesite stavku.", true);
    invoiceItemsDraft.push(item);
    clearInvoiceItemForm();
    renderInvoiceDraft();
    setMessage("invoice-message", "Stavka je dodata na račun.");
  });
  document.getElementById("invoice-items-preview").addEventListener("click", event => {
    const button = event.target.closest(".remove-invoice-item");
    if (!button) return;
    invoiceItemsDraft.splice(Number(button.dataset.index), 1);
    renderInvoiceDraft();
  });
  document.getElementById("invoice-form").addEventListener("submit", async event => {
    await runLockedFormSubmit(event, async () => {
      const currentItem = readInvoiceItemForm();
      if (currentItem) {
        invoiceItemsDraft.push(currentItem);
      }
      if (invoiceItemsDraft.length === 0) {
        setMessage("invoice-message", "Dodajte bar jednu stavku računa.", true);
        return;
      }
      try {
        await window.DrRosaApi.createInvoice(patientId, {
          issueDate: document.getElementById("invoice-date").value || today(),
          dueDate: document.getElementById("invoice-due-date").value,
          currency: "RSD",
          items: invoiceItemsDraft
        });
        invoiceItemsDraft = [];
        event.target.reset();
        document.getElementById("invoice-date").value = today();
        renderInvoiceDraft();
        await refreshInvoices();
        setMessage("invoice-message", "Račun je kreiran.");
      } catch (error) {
        setMessage("invoice-message", error.message || "Račun nije kreiran.", true);
      }
    });
  });
  document.getElementById("invoices-body").addEventListener("click", async event => {
    const button = event.target.closest(".invoice-payment-btn");
    const pdf = event.target.closest(".invoice-pdf-btn");
    if (button) {
      const amount = Number(prompt("Iznos uplate:") || 0);
      if (amount <= 0) return;
      await window.DrRosaApi.addInvoicePayment(button.dataset.invoiceId, { amount, paymentType: "payment", paymentDate: today(), paymentMethod: "cash" });
      await refreshInvoices();
    }
    if (pdf) {
      const response = await fetch(`/api/invoices/${pdf.dataset.invoiceId}/pdf`, {
        credentials: "include"
      });
      const html = await response.text();
      const win = window.open("", "_blank");
      win.document.write(html);
      win.document.close();
    }
  });

  document.getElementById("insurance-form").addEventListener("submit", async event => {
    await runLockedFormSubmit(event, async () => {
      const provider = document.getElementById("insurance-provider").value.trim();
      const requestedAmount = Number(document.getElementById("insurance-requested").value || 0);
      if (!provider) {
        setMessage("insurance-message", "Unesite naziv osiguranja.", true);
        return;
      }
      if (requestedAmount <= 0) {
        setMessage("insurance-message", "Unesite trazeni iznos veci od 0.", true);
        return;
      }
      try {
        await window.DrRosaApi.createInsuranceClaim(patientId, {
          provider,
          policyNumber: document.getElementById("insurance-policy").value,
          status: document.getElementById("insurance-status").value,
          requestedAmount,
          eligibilityNotes: document.getElementById("insurance-notes").value,
          preauthorizationNotes: document.getElementById("insurance-notes").value
        });
        event.target.reset();
        await refreshClaims();
        setMessage("insurance-message", "Zahtev za osiguranje je sačuvan.");
      } catch (error) {
        setMessage("insurance-message", userFacingError(error, "Zahtev nije sačuvan."), true);
      }
    });
  });

  document.getElementById("insurance-claims-body").addEventListener("click", async event => {
    const eligibilityButton = event.target.closest(".claim-eligibility-btn");
    const submitButton = event.target.closest(".claim-submit-btn");
    const eraButton = event.target.closest(".claim-era-btn");
    try {
      if (eligibilityButton) {
        await window.DrRosaApi.checkInsuranceEligibility(eligibilityButton.dataset.claimId);
        setMessage("insurance-message", "Podobnost je proverena.");
      }
      if (submitButton) {
        await window.DrRosaApi.submitInsuranceClaim(submitButton.dataset.claimId);
        setMessage("insurance-message", "Zahtev je poslat u red za obradu.");
      }
      if (eraButton) {
        const amount = Number(eraButton.dataset.amount || 0);
        await window.DrRosaApi.postInsuranceEra(eraButton.dataset.claimId, { paidAmount: amount, approvedAmount: amount });
        await refreshInvoices();
        setMessage("insurance-message", "Obračun je proknjizen u karticu.");
      }
      await refreshClaims();
    } catch (error) {
      setMessage("insurance-message", error.message || "Akcija nad zahtevom nije uspela.", true);
    }
  });
}

async function initializeClinicalSection(patientDetails, patientRecords, appointments = []) {
  if (!patientDetails?.id) return;
  clinicalSection.style.display = "block";
  initializePatientGroupTabs();
  fillVisitOptions(patientRecords);
  const patientId = patientDetails.id;
  initializeInternalCommentForm(patientId);
  let profile = {};
  try {
    profile = await window.DrRosaApi.getMedicalProfile(patientId);
    fillMedicalProfile(profile);
  } catch (error) {
    console.error("Medical profile load error:", error);
    setMessage("medical-profile-message", userFacingError(error, "Medicinski karton trenutno nije učitan."), true);
  }
  renderPatientOverview(patientDetails, patientRecords, appointments, profile);

  const workflowResults = await Promise.allSettled([
    loadDocuments(patientId),
    initializeAdvancedWorkflows(patientId),
    initializeClinicalWorkflows(patientId)
  ]);
  workflowResults.forEach((result, index) => {
    if (result.status === "fulfilled") return;
    const labels = ["documents", "advanced patient workflows", "clinical workflows"];
    console.error(`Patient ${labels[index]} load error:`, result.reason);
  });
  if (activityTimeline) {
    activityTimeline.addEventListener("click", async event => {
      const button = event.target.closest(".timeline-group-btn");
      if (button) {
        activatePatientGroup(button.dataset.patientGroup);
        return;
      }
      const deleteButton = event.target.closest(".delete-record-btn");
      if (!deleteButton) return;
      if (!confirm("Da li ste sigurni da želite da obrišete ovaj zapis iz istorije pacijenta?")) return;
      try {
        await window.DrRosaApi.deleteRecord(deleteButton.dataset.recordId);
        window.location.reload();
      } catch (error) {
        alert(error.message || "Zapis nije obrisan.");
      }
    });
  }

  medicalForm.addEventListener("submit", async event => {
    await runLockedFormSubmit(event, async () => {
      try {
        const updated = await window.DrRosaApi.updateMedicalProfile(patientId, readMedicalProfileForm());
        fillMedicalProfile(updated);
        setMessage("medical-profile-message", "Karton je sačuvan.");
      } catch (error) {
        setMessage("medical-profile-message", error.message || "Karton nije sačuvan.", true);
      }
    });
  });
  documentForm.addEventListener("click", async event => {
    const viewButton = event.target.closest(".view-document-btn");
    const downloadButton = event.target.closest(".download-document-btn");
    if (!viewButton && !downloadButton) return;
    try {
      if (viewButton) await openImagingViewer(viewButton.dataset.documentId);
      if (downloadButton) await openDocument(downloadButton.dataset.documentId, true);
    } catch (error) {
      setMessage("document-message", userFacingError(error, "Dokument nije dostupan."), true);
    }
  });

  documentForm.addEventListener("submit", async event => {
    await runLockedFormSubmit(event, async () => {
      const documentId = document.getElementById("document-id").value;
      const file = document.getElementById("document-file").files[0];
      if (!documentId && !file) {
        setMessage("document-message", "Izaberite fajl za upload.", true);
        return;
      }
      try {
        const payload = documentPayloadFromForm();
        const replacementPayload = file ? await documentFilePayload(file) : {};
        if (documentId) {
          await window.DrRosaApi.updatePatientDocument(documentId, {
            ...payload,
            ...replacementPayload
          });
        } else {
          await window.DrRosaApi.createPatientDocument(patientId, {
            ...payload,
            title: payload.title || file.name,
            ...replacementPayload
          });
        }
        resetDocumentForm(patientRecords);
        await loadDocuments(patientId);
        setMessage("document-message", documentId ? "Dokument je izmenjen." : "Dokument je dodat.");
      } catch (error) {
        setMessage("document-message", userFacingError(error, "Dokument nije sačuvan."), true);
      }
    }, "Otpremanje...");
  });

  document.getElementById("cancel-document-edit-btn").addEventListener("click", () => {
    resetDocumentForm(patientRecords);
    setMessage("document-message", "");
  });

  document.getElementById("import-scan-btn").addEventListener("click", async () => {
    try {
      await window.DrRosaApi.importPatientScan(patientId, {
        documentType: document.getElementById("document-type").value,
        title: document.getElementById("document-title").value || "Skenirani dokument",
        documentDate: document.getElementById("document-date").value,
        visitRecordId: document.getElementById("document-visit").value,
        description: document.getElementById("document-description").value,
        imagingModality: document.getElementById("document-imaging-modality").value,
        toothNumber: document.getElementById("document-tooth-number").value,
        acquisitionDate: document.getElementById("document-date").value,
        dicomStudyUid: document.getElementById("document-dicom-study-uid").value,
        claimAttachmentReady: Boolean(document.getElementById("document-imaging-modality").value)
      });
      documentForm.reset();
      fillVisitOptions(patientRecords);
      await loadDocuments(patientId);
      setMessage("document-message", "Poslednji sken je uvezen.");
    } catch (error) {
      setMessage("document-message", error.message || "Sken nije uvezen.", true);
    }
  });

  documentsBody.addEventListener("click", async event => {
    const viewButton = event.target.closest(".view-document-btn");
    const editButton = event.target.closest(".edit-document-btn");
    const downloadButton = event.target.closest(".download-document-btn");
    const deleteButton = event.target.closest(".delete-document-btn");
    try {
      if (viewButton) await openImagingViewer(viewButton.dataset.documentId);
      if (editButton) {
        const documentRow = loadedDocuments.find(item => String(item.id) === String(editButton.dataset.documentId));
        if (documentRow) fillDocumentForm(documentRow);
      }
      if (downloadButton) await openDocument(downloadButton.dataset.documentId, true);
      if (deleteButton) {
        if (!confirm("Da li želite da obrišete ovaj dokument?")) return;
        await window.DrRosaApi.deleteDocument(deleteButton.dataset.documentId);
        resetDocumentForm(patientRecords);
        await loadDocuments(patientId);
      }
    } catch (error) {
      setMessage("document-message", userFacingError(error, "Akcija nije uspela."), true);
    }
  });

  initializeImagingViewerControls();
}

(async function init() {
  if (!await requireAccess()) return;

  if (!queryPatientId && !legacyPatientName) {
    title.textContent = "Pacijent nije odabran";
    summaryCards.innerHTML = `<div class="hero-stats-card"><p class="eyebrow">Greška</p><span>Odaberite pacijenta iz evidencije.</span></div>`;
    return;
  }

  let records = [];
  let patients = [];
  let appointments = [];
  let patientDetails = null;
  try {
    if (queryPatientId) {
      [records, patientDetails, appointments] = await Promise.all([
        window.DrRosaApi.getRecords(),
        window.DrRosaApi.getPatient(queryPatientId),
        window.DrRosaApi.getAppointments ? window.DrRosaApi.getAppointments().catch(() => []) : []
      ]);
    } else {
      [records, patients, appointments] = await Promise.all([
        window.DrRosaApi.getRecords(),
        window.DrRosaApi.getPatients(),
        window.DrRosaApi.getAppointments ? window.DrRosaApi.getAppointments().catch(() => []) : []
      ]);
      patientDetails = patients.find(patient => patientFullName(patient) === legacyPatientName);
    }
  } catch (error) {
    console.error("Patient load error:", error);
  }

  const selectedPatientId = patientDetails?.id || queryPatientId;
  const selectedPatientName = patientDetails ? patientFullName(patientDetails) : legacyPatientName;

  if (!selectedPatientName) {
    title.textContent = "Pacijent nije pronadjen";
    summaryCards.innerHTML = `<div class="hero-stats-card"><p class="eyebrow">Greška</p><span>Pacijent nije pronadjen.</span></div>`;
    return;
  }

  title.textContent = selectedPatientName;
  document.getElementById("new-entry-for-patient").href = selectedPatientId
    ? `new-entry.html?patientId=${encodeURIComponent(selectedPatientId)}`
    : `new-entry.html?patient=${encodeURIComponent(selectedPatientName)}`;
  if (schedulePatientLink) {
    schedulePatientLink.href = selectedPatientId
      ? `calendar.html?patientId=${encodeURIComponent(selectedPatientId)}`
      : `calendar.html?patient=${encodeURIComponent(selectedPatientName)}`;
  }

  const patientRecords = selectedPatientId
    ? records.filter(record => String(record.patientId) === String(selectedPatientId))
    : records.filter(record => record.patient === selectedPatientName);

  if (patientDetails) {
    initializePatientAppointmentScheduler(patientDetails, async () => {
      appointments = window.DrRosaApi.getAppointments
        ? await window.DrRosaApi.getAppointments().catch(() => appointments)
        : appointments;
      const refreshedNextAppointment = selectedPatientId ? upcomingForPatient(appointments, selectedPatientId) : null;
      summaryCards.innerHTML = `
        <div class="hero-stats-card"><p class="eyebrow">Ukupno poseta</p><span>${totalVisits}</span></div>
        <div class="hero-stats-card"><p class="eyebrow">Zadnja poseta</p><span>${formatDate(lastVisit)}</span></div>
        <div class="hero-stats-card"><p class="eyebrow">Sledeci termin</p><span>${refreshedNextAppointment ? formatDate(refreshedNextAppointment.startsAt || refreshedNextAppointment.starts_at) : "-"}</span></div>
        <div class="hero-stats-card"><p class="eyebrow">Iznos duga</p><span>${formatDebtTotals(dueRecords)}</span></div>
      `;
      renderPatientOverview(patientDetails, patientRecords, appointments);
      setMessage("patient-schedule-message", "Termin je zakazan.");
    });
  }

  const totalVisits = patientRecords.length;
  const dueRecords = patientRecords.filter(isDebt);
  const lastVisit = patientRecords.map(record => record.lastVisit).filter(Boolean).sort().pop();
  const nextAppointment = selectedPatientId ? upcomingForPatient(appointments, selectedPatientId) : null;

  summaryCards.innerHTML = `
    <div class="hero-stats-card"><p class="eyebrow">Ukupno poseta</p><span>${totalVisits}</span></div>
    <div class="hero-stats-card"><p class="eyebrow">Zadnja poseta</p><span>${formatDate(lastVisit)}</span></div>
    <div class="hero-stats-card"><p class="eyebrow">Sledeci termin</p><span>${nextAppointment ? formatDate(nextAppointment.startsAt || nextAppointment.starts_at) : "-"}</span></div>
    <div class="hero-stats-card"><p class="eyebrow">Iznos duga</p><span>${formatDebtTotals(dueRecords)}</span></div>
  `;

  if (patientDetails) {
    editPatientLink.href = `new-patient.html?patient=${encodeURIComponent(patientDetails.id)}`;
    deletePatientBtn.addEventListener("click", async () => {
      const confirmMessage = patientRecords.length > 0
        ? `Pacijent ima ${patientRecords.length} povezanih zapisa. Brisanje pacijenta će biti odbijeno dok postoji istorija. Želite li ipak pokušati?`
        : "Da li ste sigurni da želite da obrišete ovog pacijenta?";
      if (!confirm(confirmMessage)) return;
      try {
        await window.DrRosaApi.deletePatient(patientDetails.id);
        window.location.href = "all-records.html";
      } catch (error) {
        alert(error.message || "Pacijent nije obrisan.");
      }
    });
    renderPatientOverview(patientDetails, patientRecords, appointments);
    try {
      await initializeClinicalSection(patientDetails, patientRecords, appointments);
    } catch (error) {
      console.error("Clinical section load error:", error);
      setMessage("medical-profile-message", "Karton trenutno nije učitan.", true);
    }
  }

  if (patientRecords.length === 0) {
    renderEmpty("Nema zapisa za ovog pacijenta.");
    return;
  }

  document.querySelectorAll(".delete-record-btn").forEach(button => {
    button.addEventListener("click", async event => {
      event.stopPropagation();
      if (!confirm("Da li ste sigurni da želite da obrišete ovaj zapis iz istorije pacijenta?")) return;
      try {
        await window.DrRosaApi.deleteRecord(button.dataset.recordId);
        window.location.reload();
      } catch (error) {
        alert(error.message || "Zapis nije obrisan.");
      }
    });
  });

})();



