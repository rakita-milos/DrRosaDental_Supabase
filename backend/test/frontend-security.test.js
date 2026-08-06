const assert = require('node:assert');
const { readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const apiSource = readFileSync(path.join(__dirname, '..', '..', 'src', 'scripts', 'api.js'), 'utf8');
const serverSource = readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const calendarDbSource = readFileSync(path.join(__dirname, '..', 'db', 'calendar.js'), 'utf8');
const securitySource = readFileSync(path.join(__dirname, '..', '..', 'src', 'scripts', 'security-utils.js'), 'utf8');
const calendarSource = readFileSync(path.join(__dirname, '..', '..', 'src', 'scripts', 'calendar.js'), 'utf8');
const indexPageSource = readFileSync(path.join(__dirname, '..', '..', 'src', 'pages', 'index.html'), 'utf8');
const dashboardSource = readFileSync(path.join(__dirname, '..', '..', 'src', 'scripts', 'script.js'), 'utf8');
const allRecordsSource = readFileSync(path.join(__dirname, '..', '..', 'src', 'scripts', 'all-records.js'), 'utf8');
const allRecordsPageSource = readFileSync(path.join(__dirname, '..', '..', 'src', 'pages', 'all-records.html'), 'utf8');
const newEntrySource = readFileSync(path.join(__dirname, '..', '..', 'src', 'scripts', 'new-entry.js'), 'utf8');
const newEntryPageSource = readFileSync(path.join(__dirname, '..', '..', 'src', 'pages', 'new-entry.html'), 'utf8');
const newPatientSource = readFileSync(path.join(__dirname, '..', '..', 'src', 'scripts', 'new-patient.js'), 'utf8');
const newPatientPageSource = readFileSync(path.join(__dirname, '..', '..', 'src', 'pages', 'new-patient.html'), 'utf8');
const patientDashboardSource = readFileSync(path.join(__dirname, '..', '..', 'src', 'scripts', 'patient-dashboard.js'), 'utf8');
const patientDashboardPageSource = readFileSync(path.join(__dirname, '..', '..', 'src', 'pages', 'patient-dashboard.html'), 'utf8');
const appointmentModalSource = readFileSync(path.join(__dirname, '..', '..', 'src', 'scripts', 'appointment-modal.js'), 'utf8');
const publicBookingSource = readFileSync(path.join(__dirname, '..', '..', 'src', 'scripts', 'public-booking.js'), 'utf8');
const stylesSource = readFileSync(path.join(__dirname, '..', '..', 'src', 'styles', 'styles.css'), 'utf8');
const pagesDir = path.join(__dirname, '..', '..', 'src', 'pages');

test('shared frontend security helpers escape text and attributes', () => {
  assert.match(securitySource, /function escapeHtml\(value\)/);
  assert.match(securitySource, /function escapeAttribute\(value\)/);
  assert.match(securitySource, /window\.DrRosaSecurity = \{/);
  assert.match(apiSource, /const \{ escapeHtml \} = window\.DrRosaSecurity/);
});

test('global notifications do not replay old Google sync toasts on app open', () => {
  assert.match(apiSource, /getNotifications\(\{ latest: true, limit: 1 \}\)/);
  assert.match(apiSource, /const startedAt = Date\.now\(\)/);
  assert.match(apiSource, /Date\.parse\(notification\.createdAt \|\| ""\)/);
  assert.match(apiSource, /createdAt >= startedAt - historicalToastGraceMs/);
  assert.match(serverSource, /const latest = String\(req\.query\.latest \|\| ''\)\.toLowerCase\(\) === 'true'/);
  assert.match(serverSource, /notificationsSince\(\{ sinceId, limit, latest \}\)/);
  assert.match(calendarDbSource, /notificationsSince\(\{ sinceId = 0, limit = 20, latest = false \} = \{\}\)/);
  assert.match(calendarDbSource, /ORDER BY n\.id DESC/);
});

test('calendar select rendering escapes option text and attributes', () => {
  assert.match(calendarSource, /value="\$\{window\.DrRosaSecurity\.escapeAttribute\(item\[value\]\)\}"/);
  assert.match(calendarSource, /data-name="\$\{window\.DrRosaSecurity\.escapeAttribute\(item\.value\)\}"/);
  assert.match(calendarSource, /window\.DrRosaSecurity\.escapeHtml\(item\.label\)/);
});

test('all records page lists every patient, including patients without visits', () => {
  assert.match(allRecordsSource, /let allPatients = \[\]/);
  assert.match(allRecordsSource, /function buildPatientRows\(patients, records\)/);
  assert.match(allRecordsSource, /patients\.forEach\(patient =>/);
  assert.match(allRecordsSource, /visits: 0/);
  assert.match(allRecordsSource, /function filterPatients\(patientRows\)/);
  assert.match(allRecordsSource, /window\.DrRosaApi\.getPatients\(\),\s*window\.DrRosaApi\.getRecords\(\)/);
  assert.match(allRecordsSource, /Nema poseta/);
  assert.match(allRecordsSource, /Bez posete/);
  assert.match(allRecordsSource, /populatePatientFilter\(\)[\s\S]*allPatients/);
  assert.match(allRecordsSource, /currentExportRows = patientRows\.map/);
});

test('all records doctor filter is populated from the doctors reference list', () => {
  assert.match(allRecordsSource, /let allDoctors = \[\]/);
  assert.match(allRecordsSource, /function populateDoctorFilter\(\)/);
  assert.match(allRecordsSource, /window\.DrRosaApi\.getDoctors/);
  assert.match(allRecordsSource, /populateDoctorFilter\(\)/);
  assert.match(allRecordsSource, /doctorFilter\.innerHTML = option\("", "Svi doktori"\) \+ doctors\.map/);
  assert.doesNotMatch(allRecordsPageSource, /<option value="Dr Novak">/);
  assert.doesNotMatch(allRecordsPageSource, /<option value="Dr Horvat">/);
});

test('shared API caches reference dropdown data and invalidates it after admin changes', () => {
  assert.match(apiSource, /const cachedRequests = new Map\(\)/);
  assert.match(apiSource, /function cachedRequest\(key, loader, \{ forceRefresh = false \} = \{\}\)/);
  assert.match(apiSource, /async function getDoctors\(options = \{\}\)/);
  assert.match(apiSource, /cachedRequest\("doctors", \(\) => request\("\/doctors"\), options\)/);
  assert.match(apiSource, /async function getChairs\(options = \{\}\)/);
  assert.match(apiSource, /cachedRequest\("chairs", \(\) => request\("\/chairs"\), options\)/);
  assert.match(apiSource, /async function getCodebooks\(type, options = \{\}\)/);
  assert.match(apiSource, /const cacheKey = type \? `codebooks:\$\{type\}` : "codebooks"/);
  assert.match(apiSource, /clearReferenceCache\("doctors"\)/);
  assert.match(apiSource, /clearReferenceCache\("codebooks"\)/);
  assert.match(apiSource, /clearReferenceCache,/);
});

test('shared API supports query parameters for large clinical lists', () => {
  assert.match(apiSource, /function queryString\(params = \{\}\)/);
  assert.match(apiSource, /async function getPatients\(params = \{\}\)/);
  assert.match(apiSource, /request\(`\/patients\$\{query \? `\?\$\{query\}` : ""\}`\)/);
  assert.match(apiSource, /async function getRecords\(params = \{\}\)/);
  assert.match(apiSource, /request\(`\/records\$\{query \? `\?\$\{query\}` : ""\}`\)/);
});

test('calendar week view groups slots and agenda by chair', () => {
  assert.match(calendarSource, /function activeChairs\(\)/);
  assert.match(calendarSource, /function renderWeekChairCell\(day, hour, chair, appointments\)/);
  assert.match(calendarSource, /String\(appointment\.chairId\) === String\(chair\.id\) && starts\.getHours\(\) === hour/);
  assert.match(calendarSource, /class="week-chair-mini-columns"/);
  assert.match(calendarSource, /data-chair-id="\$\{window\.DrRosaSecurity\.escapeAttribute\(chair\.id\)\}"/);
  assert.match(calendarSource, /visibleItems\.map\(renderCalendarItem\)/);
  assert.match(calendarSource, /function renderCalendarItem\(appointment\)/);
  assert.match(calendarSource, /chairItems\.map\(renderWeekAppointment\)/);
  assert.doesNotMatch(calendarSource, /more-appointments/);
  assert.match(stylesSource, /\.week-chair-mini-columns/);
  assert.match(stylesSource, /\.week-agenda-chair-columns/);
  assert.doesNotMatch(stylesSource, /\.more-appointments/);
  assert.match(stylesSource, /@media \(max-width: 640px\)[\s\S]*\.calendar-board-week \.week-agenda-chair-columns[\s\S]*grid-template-columns: 1fr/);
});

test('calendar event cards use compact title-first content', () => {
  assert.match(calendarSource, /function appointmentDisplayTitle\(appointment\)/);
  assert.match(calendarSource, /function compactAppointmentMarkup\(appointment, starts, ends, options = \{\}\)/);
  assert.match(calendarSource, /appointmentTimeLine\(starts, ends, \{ compact = false \} = \{\}\)/);
  assert.match(calendarSource, /compactAppointmentMarkup\(appointment, starts, ends, \{ compact: true \}\)/);
  assert.match(calendarSource, /class="appointment-title-line"/);
  assert.match(calendarSource, /class="appointment-doctor-line"/);
  assert.match(calendarSource, /class="appointment-warning-marker"/);
  assert.match(stylesSource, /\.appointment-title-line[\s\S]*-webkit-line-clamp: 2/);
  assert.match(stylesSource, /\.appointment-warning-marker[\s\S]*position: absolute/);
  assert.match(stylesSource, /\.week-appointment \.appointment-time[\s\S]*overflow: visible/);
  assert.match(stylesSource, /\.week-appointment \.appointment-warning-marker[\s\S]*bottom: 5px/);
});

test('calendar renders Google doctor absence separately from chair appointments', () => {
  assert.match(calendarSource, /function isDoctorAbsenceEvent\(appointment\)/);
  assert.match(calendarSource, /appointment\.googleEventType === "doctor_absence"/);
  assert.match(calendarSource, /appointment\.googleEventType === "appointment"/);
  assert.match(calendarSource, /\(go\|godisnji\|godisnji odmor\|odmor\)/);
  assert.match(calendarSource, /durationHours >= 12/);
  assert.match(calendarSource, /function googleEventDateRangeLine\(appointment\)/);
  assert.match(calendarSource, /function renderGoogleEventCard\(appointment, baseClass = "agenda-appointment"\)/);
  assert.match(calendarSource, /function renderWeekDayHeading\(day, index\)/);
  assert.match(calendarSource, /function renderWeekAbsenceLane\(days\)/);
  assert.match(calendarSource, /function renderWeekAbsenceBar\(appointment, days\)/);
  assert.match(calendarSource, /function renderMonthSchedule\(days\)/);
  assert.match(calendarSource, /function renderMonthAbsenceLane\(days\)/);
  assert.match(calendarSource, /function renderMonthAbsenceBar\(appointment, days\)/);
  assert.match(calendarSource, /appointments\.filter\(appointment => !isDoctorAbsenceEvent\(appointment\)\)/);
  assert.match(calendarSource, /class="week-heading-notes"/);
  assert.match(calendarSource, /class="week-absence-lane"/);
  assert.match(calendarSource, /class="month-absence-lane"/);
  assert.match(calendarSource, /appointmentUiClass\(appointment, "month-absence-bar"\)/);
  assert.match(calendarSource, /appointment => isGoogleNoteEvent\(appointment\) && !isDoctorAbsenceEvent\(appointment\)/);
  assert.match(calendarSource, /Odsustva i napomene/);
  assert.match(calendarSource, /parseLocalDateTime\(item\.startsAt\) < dayEnd && parseLocalDateTime\(item\.endsAt\) > dayStart/);
  assert.match(stylesSource, /\.doctor-absence-event/);
  assert.match(stylesSource, /\.google-event-date-range/);
  assert.match(stylesSource, /\.week-day-heading-cell/);
  assert.match(stylesSource, /\.week-absence-lane/);
  assert.match(stylesSource, /\.week-absence-bar/);
  assert.match(stylesSource, /\.month-week/);
  assert.match(stylesSource, /\.month-absence-lane/);
  assert.match(stylesSource, /\.month-absence-bar/);
});

test('calendar view select stays in sync with rendered view after refresh', () => {
  assert.match(calendarSource, /const VIEW_MODES = new Set\(\["day", "week", "month"\]\)/);
  assert.match(calendarSource, /const CALENDAR_VIEW_STORAGE_KEY = "drrosa-calendar-view"/);
  assert.match(calendarSource, /function initializeCalendarViewMode\(\)/);
  assert.match(calendarSource, /setCalendarViewMode\(validViewMode\(calendarViewControl\(\)\?\.value\) \|\| savedMode \|\| state\.viewMode\)/);
  assert.match(calendarSource, /setCalendarViewMode\(state\.viewMode\)/);
  assert.match(calendarSource, /setCalendarViewMode\(event\.target\.value, \{ persist: true \}\)/);
  assert.match(calendarSource, /initializeCalendarViewMode\(\);\s*bindEvents\(\);/);
});

test('new entry step navigation keeps clicked section active during smooth scroll', () => {
  assert.match(newEntrySource, /let manualStepTarget = ""/);
  assert.match(newEntrySource, /let manualStepLockTimer = 0/);
  assert.match(newEntrySource, /function scrollToEntrySection\(section\)/);
  assert.match(newEntrySource, /lockManualStep\(section\.id\)/);
  assert.match(newEntrySource, /window\.history\.replaceState\(null, "", `#\$\{section\.id\}`\)/);
  assert.match(newEntrySource, /if \(manualStepTarget\)/);
  assert.match(newEntrySource, /targetEntry && targetEntry\.intersectionRatio >= 0\.28/);
  assert.match(stylesSource, /#entry-basics-section,[\s\S]*#entry-summary-section[\s\S]*scroll-margin-top: 86px/);
});

test('new entry procedure fallback stays hidden until requested', () => {
  assert.match(newEntryPageSource, /id="toggle-procedure-fallback"[\s\S]*aria-expanded="false"[\s\S]*aria-controls="procedure-fallback-block"/);
  assert.match(newEntryPageSource, /id="procedure-fallback-block" hidden/);
  assert.match(newEntrySource, /function hasProcedureFallbackValue\(\)/);
  assert.match(newEntrySource, /function setProcedureFallbackVisible\(isVisible\)/);
  assert.match(newEntrySource, /block\.hidden = !isVisible/);
  assert.match(newEntrySource, /button\.setAttribute\("aria-expanded", isVisible \? "true" : "false"\)/);
  assert.match(newEntrySource, /setProcedureFallbackVisible\(hasProcedureFallbackValue\(\)\)/);
  assert.match(newEntrySource, /Sakrij opste postupke/);
});

test('new entry summary is compact and placed inside the full-width form', () => {
  assert.match(newEntryPageSource, /Rezime unosa/);
  assert.doesNotMatch(newEntryPageSource, /Brzi pregled/);
  assert.doesNotMatch(newEntryPageSource, /id="toggle-entry-summary"/);
  assert.doesNotMatch(newEntryPageSource, /<aside class="summary-panel entry-summary-panel"/);
  assert.match(newEntryPageSource, /<section class="summary-panel entry-summary-panel full-width" id="entry-summary-section">/);
  assert.match(newEntryPageSource, /class="preview-card entry-summary-card" id="entry-summary-card"/);
  assert.match(newEntryPageSource, /id="preview-teeth-count"/);
  assert.match(newEntryPageSource, /id="preview-total-amount"/);
  assert.match(newEntryPageSource, /id="preview-note-badge" hidden/);
  assert.match(newEntryPageSource, /entry-payment-sync-20260804/);
  assert.match(newEntryPageSource, /class="entry-summary-identity"/);
  assert.match(newEntryPageSource, /class="entry-summary-money"/);
  assert.match(newEntryPageSource, /class="entry-summary-payment-status"/);
  assert.match(newEntrySource, /function selectedTreatmentTeethCount\(\)/);
  assert.match(newEntrySource, /previewElements\.debtRow\.classList\.toggle\("has-debt", hasDebt\)/);
  assert.match(stylesSource, /\.form-page[\s\S]*grid-template-columns: 1fr/);
  assert.match(stylesSource, /\.entry-summary-money[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(stylesSource, /@media \(max-width: 640px\)[\s\S]*\.entry-summary-money[\s\S]*grid-template-columns: 1fr/);
  assert.doesNotMatch(stylesSource, /\.entry-summary-panel\s*\{[^}]*position: sticky/);
});

test('new entry payment rows use one-line desktop layout without per-payment notes', () => {
  assert.match(newEntryPageSource, /entry-payment-sync-20260804/);
  assert.match(newEntrySource, /class="payment-part-number">#\$\{index \+ 1\}/);
  assert.match(newEntrySource, /class="danger-btn payment-part-remove"[\s\S]*>×<\/button>/);
  assert.doesNotMatch(newEntrySource, /payment-part-note/);
  assert.doesNotMatch(newEntrySource, /payment-part-fields/);
  assert.match(stylesSource, /\.payment-part-row[\s\S]*grid-template-columns: 38px minmax\(110px, 1fr\) minmax\(82px, 0\.72fr\) minmax\(130px, 1fr\) minmax\(136px, 1fr\) 40px/);
  assert.match(stylesSource, /\.payment-part-row[\s\S]*overflow: visible/);
  assert.doesNotMatch(stylesSource, /\.payment-part-fields/);
  assert.doesNotMatch(stylesSource, /\.payment-part-notes/);
});

test('new entry syncs payment rows before adding another payment', () => {
  assert.match(newEntrySource, /function paymentPartFromRow\(row\)/);
  assert.match(newEntrySource, /function syncPaymentPartsFromDom\(\)/);
  assert.match(newEntrySource, /paymentParts = rows\.map\(paymentPartFromRow\)/);
  assert.match(newEntrySource, /const updatePart = \(\) => \{[\s\S]*paymentParts\[index\] = paymentPartFromRow\(row\)/);
  assert.match(newEntrySource, /inputs\.addPaymentPart\?\.[\s\S]*syncPaymentPartsFromDom\(\);[\s\S]*paymentParts\.push/);
  assert.match(newEntrySource, /updatePaymentCalculation\(\{ render: false \}\)/);
});

test('new entry hides redundant payment fields from the visible form', () => {
  assert.match(newEntryPageSource, /class="entry-technical-payment-fields" hidden/);
  assert.match(newEntryPageSource, /id="status" name="status" type="hidden"/);
  assert.match(newEntryPageSource, /id="currency" name="currency" type="hidden"/);
  assert.match(newEntryPageSource, /id="amount-due" name="amountDue" type="hidden"/);
  assert.match(newEntryPageSource, /id="total-amount" name="totalAmount" type="hidden"/);
  assert.doesNotMatch(newEntryPageSource, /<label>\s*Status\s*<select id="status"/);
  assert.doesNotMatch(newEntryPageSource, /Valuta pla/);
  assert.doesNotMatch(newEntryPageSource, /Iznos duga\s*<input id="amount-due"/);
  assert.doesNotMatch(newEntryPageSource, /Ukupno za naplatu\s*<input id="total-amount"/);
  assert.doesNotMatch(newEntryPageSource, /id="preview-status"/);
  assert.match(newEntrySource, /if \(!select\.options\) \{/);
});

test('new entry patient selection updates the summary even outside the form element', () => {
  assert.match(newEntryPageSource, /<input[^>]*id="patient-name"[^>]*form="new-entry-form"/);
  assert.match(newEntrySource, /inputs\.patient\.addEventListener\("input", \(\) => \{[\s\S]*updatePreview\(\);[\s\S]*\}\);/);
  assert.match(newEntrySource, /inputs\.patient\.addEventListener\("change", \(\) => \{[\s\S]*updatePreview\(\);[\s\S]*\}\);/);
  assert.match(newEntrySource, /inputs\.patient\.addEventListener\("blur", \(\) => \{[\s\S]*updatePreview\(\);/);
  assert.match(newEntrySource, /function lockPatientFromQuery\(\)[\s\S]*closePatientSuggestions\(\);\s*updatePreview\(\);/);
});

test('patient dashboard tabs initialize before async clinical workflows', () => {
  assert.match(patientDashboardSource, /function initializePatientGroupTabs\(\)/);
  assert.match(patientDashboardSource, /clinicalSection\.dataset\.tabsReady === "1"/);
  assert.match(patientDashboardSource, /tab\.setAttribute\("aria-selected", isActive \? "true" : "false"\)/);
  assert.match(patientDashboardSource, /panel\.setAttribute\("role", "tabpanel"\)/);
  assert.match(patientDashboardSource, /clinicalSection\.style\.display = "block";\s*initializePatientGroupTabs\(\);/);
  assert.match(patientDashboardSource, /const workflowResults = await Promise\.allSettled\(\[/);
  assert.match(patientDashboardSource, /loadDocuments\(patientId\),\s*initializeAdvancedWorkflows\(patientId\),\s*initializeClinicalWorkflows\(patientId\)/);
  assert.doesNotMatch(patientDashboardSource, /await loadDocuments\(patientId\);\s*await initializeAdvancedWorkflows\(patientId\);\s*await initializeClinicalWorkflows\(patientId\);\s*document\.querySelectorAll\("\.patient-group-tab"\)/);
});

test('patient dashboard quick internal comments bind early and refresh the first-screen panel', () => {
  assert.match(patientDashboardSource, /function initializeInternalCommentForm\(patientId\)/);
  assert.match(patientDashboardSource, /internalCommentForm\.dataset\.ready === "1"/);
  assert.match(apiSource, /function getPatientInternalComments\(patientId\)/);
  assert.match(apiSource, /function createPatientInternalComment\(patientId, comment\)/);
  assert.match(patientDashboardSource, /let loadedInternalComments = \[\]/);
  assert.match(patientDashboardSource, /window\.DrRosaApi\.getPatientInternalComments\?\.\(patientId\)/);
  assert.match(patientDashboardSource, /internalCommentForm\.addEventListener\("submit", async event => \{\s*await runLockedFormSubmit\(event, async \(\) => \{/);
  assert.match(patientDashboardSource, /await window\.DrRosaApi\.createPatientInternalComment\(patientId, \{\s*body,/);
  assert.match(patientDashboardSource, /loadedInternalComments = await window\.DrRosaApi\.getPatientInternalComments\(patientId\);\s*renderInternalComments\(\);/);
  assert.match(patientDashboardSource, /clinicalSection\.style\.display = "block";[\s\S]*initializeInternalCommentForm\(patientId\);[\s\S]*const workflowResults = await Promise\.allSettled/);
  assert.doesNotMatch(patientDashboardSource, /false && internalCommentForm/);
});

test('patient dashboard clinical forms keep locked submit wrappers intact', () => {
  const clinicalChartIndex = patientDashboardSource.indexOf('clinical-chart-form").addEventListener("submit"');
  const clinicalNoteIndex = patientDashboardSource.indexOf('clinical-note-form").addEventListener("submit"');
  assert.ok(clinicalChartIndex > -1);
  assert.ok(clinicalNoteIndex > -1);
  assert.match(patientDashboardSource.slice(clinicalChartIndex, clinicalChartIndex + 260), /await runLockedFormSubmit\(event, async \(\) => \{/);
  assert.match(patientDashboardSource.slice(clinicalNoteIndex, clinicalNoteIndex + 260), /await runLockedFormSubmit\(event, async \(\) => \{/);
});

test('patient dashboard uses one primary scheduling action and no duplicate document CTA', () => {
  assert.match(patientDashboardPageSource, /id="schedule-patient-link"[\s\S]*>Zakazi termin<\/a>/);
  assert.doesNotMatch(patientDashboardPageSource, /id="quick-document-tab-btn"/);
  assert.match(patientDashboardPageSource, /id="quick-upload-document-btn"/);
  assert.doesNotMatch(patientDashboardSource, /data-empty-action="documents"/);
  assert.doesNotMatch(patientDashboardSource, /<a class="secondary-btn" href="\$\{calendarHref\}">Zakazi<\/a>/);
  assert.doesNotMatch(patientDashboardSource, />Zakazi termin<\/a>/);
  assert.strictEqual((patientDashboardSource.match(/function renderUpcomingAppointments/g) || []).length, 1);
  assert.strictEqual((patientDashboardSource.match(/function renderQuickDocuments/g) || []).length, 1);
});

test('patient dashboard appointment modal creates appointments without redirecting to calendar', () => {
  assert.match(patientDashboardPageSource, /appointment-modal\.js\?v=patient-scheduler-20260804/);
  assert.match(patientDashboardPageSource, /id="patient-appointment-panel"/);
  assert.match(patientDashboardSource, /function initializePatientAppointmentScheduler\(patient, onCreated\)/);
  assert.match(patientDashboardSource, /event\.preventDefault\(\);[\s\S]*DrRosaAppointmentModal\.openForPatient\(appointmentSchedulerPatient/);
  assert.match(patientDashboardSource, /appointments = window\.DrRosaApi\.getAppointments/);
  assert.match(patientDashboardSource, /setMessage\("patient-schedule-message", "Termin je zakazan\."\)/);
  assert.match(appointmentModalSource, /window\.DrRosaAppointmentModal = \{/);
  assert.match(appointmentModalSource, /async function openForPatient\(patient, options = \{\}\)/);
  assert.match(appointmentModalSource, /await window\.DrRosaApi\.createAppointment\(formPayload\(\)\)/);
  assert.match(appointmentModalSource, /if \(form\.dataset\.drrosaBusy === "1"\) return/);
  assert.match(appointmentModalSource, /patient_id: Number\(state\.patient\.id\)/);
  assert.match(appointmentModalSource, /doctor_id: Number\(byId\("patient-appointment-doctor"\)\.value\)/);
  assert.match(appointmentModalSource, /chair_id: Number\(byId\("patient-appointment-chair"\)\.value\)/);
});

test('patient dashboard hero identifies the currently opened patient', () => {
  assert.match(patientDashboardPageSource, /id="patient-summary-title">Detalji i istorija<\/h2>/);
  assert.match(patientDashboardSource, /document\.getElementById\("patient-summary-title"\)\.textContent = patientFullName\(patient\) \|\| "Pacijent"/);
  assert.match(patientDashboardSource, /Detalji i istorija pacijenta, tretmani, naplate, dokumenti i interni komentari\./);
  assert.doesNotMatch(patientDashboardPageSource, /patient-identity-tags/);
  assert.doesNotMatch(patientDashboardSource, /renderPatientIdentityTags/);
  assert.doesNotMatch(stylesSource, /\.patient-identity-tags/);
});

test('patient document edit shows existing file preview and supports optional replacement file', () => {
  assert.match(patientDashboardSource, /function renderCurrentDocumentFile\(documentRow\)/);
  assert.match(patientDashboardSource, /Postojeci fajl ostaje sacuvan ako ne odaberete novi/);
  assert.match(patientDashboardSource, /document-file-label"\)\.textContent = "Novi fajl, samo ako zelite da zamenite postojeci"/);
  assert.match(patientDashboardSource, /function documentFilePayload\(file\)/);
  assert.match(patientDashboardSource, /fileBase64: await fileToBase64\(file\)/);
  assert.match(patientDashboardSource, /const replacementPayload = file \? await documentFilePayload\(file\) : \{\}/);
  assert.match(patientDashboardSource, /updatePatientDocument\(documentId, \{\s*\.\.\.payload,\s*\.\.\.replacementPayload\s*\}\)/);
  assert.match(patientDashboardSource, /renderCurrentDocumentFile\(documentRow\)/);
});

test('patient documents hide AI review action until the feature is enabled again', () => {
  assert.doesNotMatch(patientDashboardSource, /AI pregled/);
  assert.doesNotMatch(patientDashboardSource, /analyze-imaging-btn/);
});

test('dashboard dynamic cards escape patient-facing text', () => {
  assert.match(dashboardSource, /window\.DrRosaSecurity\.escapeHtml\(appointmentPatientName\(appointment\)\)/);
  assert.match(dashboardSource, /window\.DrRosaSecurity\.escapeHtml\(procedure\)/);
  assert.match(dashboardSource, /window\.DrRosaSecurity\.escapeHtml\(alert\.text\)/);
});

test('dashboard primary KPI links are part of the patient evidence hero', () => {
  const heroStart = indexPageSource.indexOf('class="hero-card dashboard-hero"');
  const operationsStart = indexPageSource.indexOf('class="dashboard-operations-grid"');
  const heroMarkup = indexPageSource.slice(heroStart, operationsStart);
  assert.ok(heroStart >= 0);
  assert.ok(operationsStart > heroStart);
  assert.match(heroMarkup, /class="dashboard-hero-copy"/);
  assert.match(heroMarkup, /class="dashboard-next-card"/);
  assert.match(heroMarkup, /id="dashboard-next-chairs"/);
  assert.match(heroMarkup, /class="dashboard-kpi-grid"/);
  assert.match(heroMarkup, /id="patients-count"/);
  assert.match(heroMarkup, /id="appointments-count"/);
  assert.match(heroMarkup, /id="procedures-count"/);
  assert.match(heroMarkup, /id="debtors-count"/);
  assert.doesNotMatch(indexPageSource, /id="next-appointment-time"/);
  assert.match(dashboardSource, /function renderNextAppointmentsByChair\(appointments, chairs = \[\]\)/);
  assert.match(dashboardSource, /window\.DrRosaApi\.getChairs/);
  assert.match(dashboardSource, /getElementById\("dashboard-next-chairs"\)/);
  assert.match(dashboardSource, /appointmentChairId\(appointment\)/);
  assert.strictEqual((indexPageSource.match(/id="patients-count"/g) || []).length, 1);
  assert.strictEqual((indexPageSource.match(/id="appointments-count"/g) || []).length, 1);
  assert.strictEqual((indexPageSource.match(/id="procedures-count"/g) || []).length, 1);
  assert.strictEqual((indexPageSource.match(/id="debtors-count"/g) || []).length, 1);
});

test('form option and autocomplete attributes use attribute escaping', () => {
  assert.match(allRecordsSource, /value="\$\{window\.DrRosaSecurity\.escapeAttribute\(value\)\}"/);
  assert.match(newEntrySource, /const escapeAttribute = window\.DrRosaSecurity\.escapeAttribute/);
  assert.match(newEntrySource, /value="\$\{escapeAttribute\(value\)\}"/);
  assert.match(newEntrySource, /data-patient-name="\$\{escapeAttribute\(name\)\}"/);
  assert.match(newEntrySource, /data-price-currency="\$\{escapeAttribute\(priceInfo\.currency \|\| "EUR"\)\}"/);
});

test('pages load security helpers before the API bundle', () => {
  for (const file of readdirSync(pagesDir).filter(name => name.endsWith('.html'))) {
    const source = readFileSync(path.join(pagesDir, file), 'utf8');
    const securityIndex = source.indexOf('../scripts/security-utils.js');
    const apiIndex = source.indexOf('../scripts/api.js');
    assert.ok(securityIndex >= 0, `${file} should include security-utils.js`);
    assert.ok(apiIndex >= 0, `${file} should include api.js`);
    assert.ok(securityIndex < apiIndex, `${file} should load security-utils.js before api.js`);
  }
});

test('online booking is not exposed from protected application navigation while disabled', () => {
  const protectedPages = [
    'index.html',
    'calendar.html',
    'new-entry.html',
    'new-patient.html',
    'all-records.html',
    'patient-dashboard.html',
    'director-panel.html'
  ];
  for (const file of protectedPages) {
    const source = readFileSync(path.join(pagesDir, file), 'utf8');
    assert.doesNotMatch(source, /href="public-booking\.html" class="nav-link">Onlajn zakazivanje<\/a>/, `${file} should not expose online booking in nav`);
  }
});

test('public booking page shows unavailable state instead of loading the booking workflow when disabled', () => {
  assert.match(publicBookingSource, /function showUnavailableMessage\(\)/);
  assert.match(publicBookingSource, /Onlajn zakazivanje trenutno nije dostupno\./);
  assert.match(publicBookingSource, /const status = await window\.DrRosaApi\.getPublicBookingStatus\(\)/);
  assert.match(publicBookingSource, /if \(!status\.enabled\) \{/);
  assert.match(publicBookingSource, /form\?\.querySelector\("\.input-grid"\)\?\.setAttribute\("hidden", ""\)/);
  assert.match(publicBookingSource, /form\?\.querySelector\("\.form-actions"\)\?\.setAttribute\("hidden", ""\)/);
});

test('frontend create forms guard against duplicate submissions', () => {
  assert.match(apiSource, /async function withActionLock\(target, action, options = \{\}\)/);
  assert.match(apiSource, /window\.DrRosaUi = \{/);
  assert.match(apiSource, /target\.dataset\.drrosaBusy === "1"/);

  assert.match(newPatientPageSource, /id="patient-form-message"/);
  assert.match(newPatientSource, /form\.dataset\.drrosaBusy === "1"/);
  assert.match(newPatientSource, /form\.setAttribute\("aria-busy", "true"\)/);

  assert.match(calendarSource, /appointment-form/);
  assert.match(calendarSource, /event\.currentTarget\.dataset\.drrosaBusy === "1"/);

  assert.match(publicBookingSource, /public-booking-form/);
  assert.match(publicBookingSource, /event\.currentTarget\.dataset\.drrosaBusy === "1"/);

  assert.match(patientDashboardSource, /async function runLockedFormSubmit\(event, callback/);
  [
    "clinical-chart-form",
    "clinical-note-form",
    "patient-consent-form",
    "treatment-plan-form",
    "perio-form",
    "invoice-form",
    "insurance-form",
    "medical-profile-form",
    "quick-internal-comment-form",
    "document-form"
  ].forEach(formId => {
    assert.match(patientDashboardSource, new RegExp(formId));
  });
});
