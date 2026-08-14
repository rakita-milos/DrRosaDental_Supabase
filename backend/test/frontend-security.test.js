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
const directorPanelPageSource = readFileSync(path.join(__dirname, '..', '..', 'src', 'pages', 'director-panel.html'), 'utf8');
const directorReportsSource = readFileSync(path.join(__dirname, '..', '..', 'src', 'scripts', 'director-reports.js'), 'utf8');
const stylesSource = readFileSync(path.join(__dirname, '..', '..', 'src', 'styles', 'styles.css'), 'utf8');
const pagesDir = path.join(__dirname, '..', '..', 'src', 'pages');

test('shared frontend security helpers escape text and attributes', () => {
  assert.match(securitySource, /function escapeHtml\(value\)/);
  assert.match(securitySource, /function escapeAttribute\(value\)/);
  assert.match(securitySource, /window\.DrRosaSecurity = \{/);
  assert.match(apiSource, /const \{ escapeHtml, escapeAttribute \} = window\.DrRosaSecurity/);
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
  assert.match(allRecordsSource, /let allPatientRows = \[\]/);
  assert.match(allRecordsSource, /let allPatientOptions = \[\]/);
  assert.match(apiSource, /async function getPatientSummaries\(params = \{\}\)/);
  assert.match(apiSource, /request\(`\/patient-summaries/);
  assert.match(allRecordsSource, /loadPatientSummaries\(summaryFilterParams\(\)\)/);
  assert.match(allRecordsSource, /allPatientOptions = allPatientRows/);
  assert.match(allRecordsSource, /visits: 0/);
  assert.match(allRecordsSource, /function filterPatients\(patientRows\)/);
  assert.doesNotMatch(allRecordsSource, /window\.DrRosaApi\.getRecords\(\)/);
  assert.match(allRecordsSource, /Nema poseta/);
  assert.match(allRecordsSource, /Bez posete/);
  assert.match(allRecordsSource, /populatePatientFilter\(\)[\s\S]*allPatientOptions/);
  assert.match(allRecordsSource, /currentExportRows = patientRows\.map/);
});

test('all records summary table omits last procedure and uses compact columns', () => {
  const tableStart = allRecordsPageSource.indexOf('<table class="records-table">');
  const tableMarkup = allRecordsPageSource.slice(tableStart, tableStart + 900);
  assert.match(tableMarkup, /<th>Pacijent<\/th>/);
  assert.match(tableMarkup, /<th>Poslednja poseta<\/th>/);
  assert.match(tableMarkup, /<th>Sledeci termin<\/th>/);
  assert.match(tableMarkup, /<th>Poseta<\/th>/);
  assert.doesNotMatch(tableMarkup, /Poslednja procedura/);
  assert.doesNotMatch(allRecordsSource, /window\.DrRosaSecurity\.cell\(patient\.lastProcedure/);
  assert.doesNotMatch(allRecordsSource, /<dt>Procedura<\/dt>/);
  assert.match(allRecordsSource, /colspan="7"/);
  assert.match(stylesSource, /\.records-table th[\s\S]*white-space: nowrap/);
  assert.match(stylesSource, /\.records-table th:last-child,[\s\S]*min-width: 214px/);
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

test('all records patient dropdown supports searchable custom select options', () => {
  assert.match(allRecordsPageSource, /<select id="search-input"[^>]*data-searchable="true"/);
  assert.match(apiSource, /function foldSearchText\(value\)/);
  assert.match(apiSource, /function filterSelectOptions\(wrap, term\)/);
  assert.match(apiSource, /custom-select-search-input/);
  assert.match(apiSource, /custom-select-empty/);
  assert.match(stylesSource, /\.custom-select-search-input/);
  assert.match(stylesSource, /\.custom-select-empty/);
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
  assert.match(apiSource, /async function getPatientSummaries\(params = \{\}\)/);
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

test('calendar month mobile view renders as a readable day agenda', () => {
  assert.match(stylesSource, /@media \(max-width: 640px\)[\s\S]*\.calendar-board-month \.month-week-days,[\s\S]*\.calendar-board-month \.month-absence-lane[\s\S]*grid-template-columns: 1fr/);
  assert.match(stylesSource, /@media \(max-width: 640px\)[\s\S]*\.calendar-board-month \.calendar-day-muted[\s\S]*display: none/);
  assert.match(stylesSource, /@media \(max-width: 640px\)[\s\S]*\.calendar-board-month \.calendar-day-list[\s\S]*overflow: visible/);
  assert.match(stylesSource, /@media \(max-width: 640px\)[\s\S]*\.calendar-board-month \.appointment-card small,[\s\S]*\.calendar-board-month \.appointment-card em[\s\S]*display: block/);
});

test('mobile modals and pickers stay within the viewport', () => {
  assert.match(stylesSource, /@media \(max-width: 640px\)[\s\S]*\.appointment-dialog[\s\S]*max-height: calc\(100dvh - 20px\)/);
  assert.match(stylesSource, /@media \(max-width: 640px\)[\s\S]*\.appointment-dialog[\s\S]*overscroll-behavior: contain/);
  assert.match(stylesSource, /@media \(max-width: 640px\)[\s\S]*\.drrosa-picker-popover[\s\S]*position: fixed/);
  assert.match(stylesSource, /@media \(max-width: 640px\)[\s\S]*\.drrosa-picker-popover[\s\S]*max-height: calc\(100dvh - 20px\)/);
});

test('mobile data tables use compact overflow instead of forcing desktop width', () => {
  assert.match(stylesSource, /@media \(max-width: 640px\)[\s\S]*\.table-wrap table:not\(\.excel-sheet-table\):not\(\.doctor-admin-table\)[\s\S]*min-width: 560px/);
  assert.match(stylesSource, /@media \(max-width: 640px\)[\s\S]*\.excel-sheet-table[\s\S]*min-width: 640px/);
  assert.match(stylesSource, /@media \(max-width: 640px\)[\s\S]*\.excel-sheet-table th,[\s\S]*\.excel-sheet-table td[\s\S]*min-width: 58px/);
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
  assert.match(calendarSource, /\(go\|godisnji\|godisnjem\|godisnji odmor\|odmor\)/);
  assert.doesNotMatch(calendarSource, /isAbsence && doctor \? doctor : title/);
  assert.doesNotMatch(calendarSource, /doctor \|\| title \|\| "Godišnji"/);
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
  assert.match(newEntryPageSource, /id="procedure-fallback-block" hidden[\s\S]*id="clear-general-treatment-draft" hidden[\s\S]*Poništi izbor/);
  assert.match(newEntrySource, /function hasProcedureFallbackValue\(\)/);
  assert.match(newEntrySource, /function updateGeneralTreatmentDraftActions\(\)/);
  assert.match(newEntrySource, /inputs\.clearGeneralTreatmentDraft\.hidden = !hasProcedureFallbackValue\(\)/);
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
  assert.match(newEntryPageSource, /entry-debt-payment-20260812/);
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
  assert.match(newEntryPageSource, /entry-debt-payment-20260812/);
  assert.match(newEntrySource, /class="payment-part-number">#\$\{index \+ 1\}/);
  assert.match(newEntrySource, /class="danger-btn payment-part-remove"[\s\S]*>×<\/button>/);
  assert.doesNotMatch(newEntrySource, /payment-part-note/);
  assert.doesNotMatch(newEntrySource, /payment-part-fields/);
  assert.match(stylesSource, /\.payment-part-row[\s\S]*grid-template-columns: 38px minmax\(110px, 1fr\) minmax\(82px, 0\.72fr\) minmax\(130px, 1fr\) minmax\(136px, 1fr\) 40px/);
  assert.match(stylesSource, /\.payment-part-row[\s\S]*overflow: visible/);
  assert.doesNotMatch(stylesSource, /\.payment-part-fields/);
  assert.doesNotMatch(stylesSource, /\.payment-part-notes/);
});

test('new entry tooth treatment note sits directly before saving selected teeth', () => {
  const pendingListIndex = newEntryPageSource.indexOf('id="pending-treatment-list"');
  const noteIndex = newEntryPageSource.indexOf('id="treatment-note"');
  const saveIndex = newEntryPageSource.indexOf('id="save-treatment"');
  assert.ok(pendingListIndex > -1);
  assert.ok(noteIndex > pendingListIndex);
  assert.ok(saveIndex > noteIndex);
  assert.doesNotMatch(newEntryPageSource.slice(noteIndex, saveIndex), /id="add-treatment-item"/);
});

test('new entry syncs payment rows before adding another payment', () => {
  assert.match(newEntrySource, /function paymentPartFromRow\(row\)/);
  assert.match(newEntrySource, /function syncPaymentPartsFromDom\(\)/);
  assert.match(newEntrySource, /paymentParts = rows\.map\(paymentPartFromRow\)/);
  assert.match(newEntrySource, /const updatePart = \(\) => \{[\s\S]*paymentParts\[index\] = paymentPartFromRow\(row\)/);
  assert.match(newEntrySource, /inputs\.addPaymentPart\?\.[\s\S]*syncPaymentPartsFromDom\(\);[\s\S]*paymentParts\.push/);
  assert.match(newEntrySource, /updatePaymentCalculation\(\{ render: false \}\)/);
});

test('new entry suggests remaining payment amount and converts row currency changes', () => {
  assert.match(newEntryPageSource, /new-entry\.js\?v=payment-rounding-tolerance-20260815/);
  assert.match(newEntrySource, /function paymentPartAmountInVisitCurrency\(part\)/);
  assert.match(newEntrySource, /function remainingPaymentAmount\(\{ excludeIndex = null \} = \{\}\)/);
  assert.match(newEntrySource, /function suggestedPaymentPart\(\{ currency = paymentCurrency\(\) \} = \{\}\)/);
  assert.match(newEntrySource, /const PAYMENT_ROUNDING_TOLERANCE_RSD = 1/);
  assert.match(newEntrySource, /function paymentRoundingTolerance\(\)/);
  assert.match(newEntrySource, /const debt = rawDebt <= paymentRoundingTolerance\(\) \? 0 : rawDebt/);
  assert.match(newEntrySource, /const effectivePaid = debt <= 0 && total > 0 \? total : clampedPaid/);
  assert.match(newEntrySource, /paymentParts\.push\(suggestedPaymentPart\(\{ currency: paymentCurrency\(\) \}\)\)/);
  assert.match(newEntrySource, /data-previous-currency="\$\{escapeHtml\(normalized\.currency\)\}"/);
  assert.match(newEntrySource, /currencySelect\?\.addEventListener\("change", \(\) => \{/);
  assert.match(newEntrySource, /currencyUtils[\s\S]*\.convert\(amount, previousCurrency, nextCurrency\)/);
  assert.match(newEntrySource, /amountInput\.value = converted > 0 \? converted\.toFixed\(2\) : ""/);
});

test('new entry shows paginated previous patient payments separately from current payment rows', () => {
  assert.match(newEntryPageSource, /id="previous-payments-panel"/);
  assert.match(newEntryPageSource, /Prethodne uplate pacijenta/);
  assert.match(newEntryPageSource, /<th>Datum<\/th><th>Uplata<\/th><th>Valuta<\/th><th>Kurs<\/th><th>U RSD<\/th><th>Nacin<\/th><th>Ukupno za posetu<\/th><th>Dug<\/th><th>Akcija<\/th>/);
  assert.match(apiSource, /async function getPatientPaymentHistory\(patientId, params = \{\}\)/);
  assert.match(apiSource, /request\(`\/patients\/\$\{patientId\}\/payment-history/);
  assert.match(newEntrySource, /let patientPaymentHistory = \{/);
  assert.match(newEntrySource, /cache: new Map\(\)/);
  assert.match(newEntrySource, /loadPreviousPaymentsPage\(page \+ 1, \{ prefetch: true \}\)/);
  assert.match(newEntrySource, /refreshPreviousPaymentsForPatient\(\{ force: true \}\)/);
  assert.match(newEntrySource, /patientPaymentHistory\.limit: 5|limit: 5/);
  assert.match(newEntrySource, /paymentParts: paymentParts\.map\(normalizedPaymentPart\)\.filter/);
});

test('new entry adds debt payments only from indebted previous visit rows', () => {
  assert.match(newEntryPageSource, /id="previous-debt-payment-form" class="previous-debt-payment-form" hidden/);
  assert.match(newEntryPageSource, /id="previous-debt-record-id"/);
  assert.match(newEntrySource, /const hasDebt = Number\(item\.debt \|\| 0\) > 0\.009/);
  assert.match(newEntrySource, /index === 0 && hasDebt \? `<button type="button" class="secondary-btn previous-debt-payment-btn"/);
  assert.match(newEntrySource, /function openPreviousDebtPaymentForm\(record\)/);
  assert.match(newEntrySource, /window\.DrRosaApi\.addRecordPaymentPart\(recordId/);
  assert.match(apiSource, /async function addRecordPaymentPart\(recordId, paymentPart\)/);
  assert.match(apiSource, /request\(`\/records\/\$\{recordId\}\/payment-parts`/);
  assert.match(newEntrySource, /patientPaymentHistory\.cache\.clear\(\)/);
  assert.match(newEntrySource, /paymentParts: paymentParts\.map\(normalizedPaymentPart\)\.filter/);
});

test('new entry edit mode fetches the exact record before rendering payments', () => {
  assert.match(apiSource, /async function getRecord\(recordId\)/);
  assert.match(apiSource, /request\(`\/records\/\$\{recordId\}`\)/);
  assert.match(newEntrySource, /await window\.DrRosaApi\.getRecord\(recordParam\)/);
  assert.match(newEntrySource, /Poseta nije pronadjena/);
  assert.match(newEntrySource, /Number\(record\.totalAmount \|\| record\.total_amount \|\| 0\)/);
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
  const clinicalNoteIndex = patientDashboardSource.indexOf('clinical-note-form").addEventListener("submit"');
  assert.ok(clinicalNoteIndex > -1);
  assert.match(patientDashboardSource.slice(clinicalNoteIndex, clinicalNoteIndex + 260), /await runLockedFormSubmit\(event, async \(\) => \{/);
});

test('patient dashboard teeth and finance tabs keep only daily-use panels', () => {
  assert.match(patientDashboardPageSource, /id="initial-condition-card" data-patient-panel-group="teeth"/);
  assert.match(patientDashboardPageSource, /id="patient-initial-condition-editor"/);
  assert.doesNotMatch(patientDashboardPageSource, /id="clinical-chart-card"/);
  assert.doesNotMatch(patientDashboardPageSource, /id="clinical-chart-form"/);
  assert.doesNotMatch(patientDashboardPageSource, /id="perio-card"/);
  assert.doesNotMatch(patientDashboardPageSource, /id="perio-form"/);
  assert.doesNotMatch(patientDashboardPageSource, /id="plans-card"/);
  assert.doesNotMatch(patientDashboardPageSource, /id="treatment-plan-form"/);
  assert.match(patientDashboardPageSource, /id="invoices-card" data-patient-panel-group="finance"/);
  assert.doesNotMatch(patientDashboardSource, /clinical-chart-form"\)\.addEventListener/);
  assert.doesNotMatch(patientDashboardSource, /perio-form"\)\.addEventListener/);
  assert.doesNotMatch(patientDashboardSource, /treatment-plan-form"\)\.addEventListener/);
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

test('patient dashboard timeline exposes visit payment parts behind a toggle', () => {
  const visitPaymentsIndex = patientDashboardPageSource.indexOf('id="visit-payments-body"');
  const visitPaymentsMarkup = patientDashboardPageSource.slice(Math.max(0, visitPaymentsIndex - 420), visitPaymentsIndex + 320);
  assert.match(patientDashboardSource, /function recordPaymentParts\(record\)/);
  assert.match(patientDashboardSource, /function renderRecordPaymentDetails\(record\)/);
  assert.match(patientDashboardSource, /function renderVisitPayments\(records\)/);
  assert.match(patientDashboardSource, /<details class="patient-payment-details">/);
  assert.match(patientDashboardSource, /data-payment-label-open>Prikazi uplate/);
  assert.match(patientDashboardSource, /data-payment-label-close>Sakrij uplate/);
  assert.match(patientDashboardSource, /patient-payment-table/);
  assert.match(patientDashboardPageSource, /id="visit-payments-body"/);
  assert.match(patientDashboardPageSource, /id="visit-payments-prev"/);
  assert.match(patientDashboardPageSource, /id="visit-payments-next"/);
  assert.match(visitPaymentsMarkup, /<th>Datum<\/th><th>Uplata<\/th><th>Valuta<\/th><th>Kurs<\/th><th>U RSD<\/th><th>Nacin<\/th><th>Ukupno za posetu<\/th><th>Dug<\/th>/);
  assert.match(patientDashboardSource, /function paymentExchangeRate\(part\)/);
  assert.match(patientDashboardSource, /function paymentAmountRsd\(part\)/);
  assert.match(patientDashboardSource, /let visitPaymentHistory = \{/);
  assert.match(patientDashboardSource, /function loadVisitPaymentHistory\(patientId, page = visitPaymentHistory\.page/);
  assert.match(patientDashboardSource, /window\.DrRosaApi\.getPatientPaymentHistory\(patientId, \{ page, limit: visitPaymentHistory\.limit \}\)/);
  assert.match(patientDashboardSource, /loadVisitPaymentHistory\(patientId, page \+ 1, \{ prefetch: true \}\)/);
  assert.match(patientDashboardSource, /payment-history-visit-row/);
  assert.match(patientDashboardSource, /payment-history-part-row/);
  assert.doesNotMatch(visitPaymentsMarkup, /<th>Postupak<\/th>/);
  assert.doesNotMatch(visitPaymentsMarkup, /<th>Napomena<\/th>/);
  assert.match(patientDashboardSource, /Zbirna uplata iz posete/);
  assert.match(patientDashboardSource, /recordPaymentSummary\(record\)/);
  assert.match(stylesSource, /\.patient-payment-details/);
  assert.match(stylesSource, /\.patient-payment-details\[open\]/);
  assert.match(stylesSource, /\.patient-payment-table/);
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
  assert.match(newEntrySource, /data-price-currency="\$\{escapeAttribute\(priceInfo\.currency \|\| "RSD"\)\}"/);
  assert.match(directorReportsSource, /const escapeAttribute = window\.DrRosaSecurity\.escapeAttribute/);
  assert.match(directorReportsSource, /value="\$\{escapeAttribute\(item\.value\)\}"/);
});

test('director procedure activity field is a linked dropdown', () => {
  assert.match(directorPanelPageSource, /<select id="codebook-group"><\/select>/);
  assert.doesNotMatch(directorPanelPageSource, /id="codebook-group" type="text"/);
  assert.match(directorReportsSource, /Odaberi delatnost/);
  assert.match(directorReportsSource, /elements\.group\.required = activeCodebookType === "procedure"/);
  assert.match(serverSource, /async function validateCodebookGroupName\(type, groupName\)/);
  assert.match(serverSource, /directorAdmin\.activeActivityByValue\(groupName\)/);
  assert.match(serverSource, /Delatnost nije pronađena u šifarniku\./);
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

test('new patient page keeps quick entry fields visible and hides optional details by default', () => {
  assert.match(newPatientPageSource, /class="form-grid patient-basic-fields"/);
  assert.match(newPatientPageSource, /id="first-name" type="text" required/);
  assert.match(newPatientPageSource, /id="last-name" type="text" required/);
  assert.match(newPatientPageSource, /id="birth-date" type="date" required/);
  assert.match(newPatientPageSource, /id="gender" required/);
  assert.match(newPatientPageSource, /id="address" type="text"/);
  assert.match(newPatientPageSource, /id="phone" type="tel"/);
  assert.match(newPatientPageSource, /id="toggle-patient-extra-fields"/);
  assert.match(newPatientPageSource, /aria-controls="patient-extra-fields"/);
  assert.match(newPatientPageSource, /id="patient-extra-fields" class="patient-extra-fields" hidden/);
  assert.match(newPatientPageSource, /id="initial-condition-editor" class="initial-condition-section"/);
  assert.match(newPatientSource, /function setExtraFieldsOpen\(open\)/);
  assert.match(newPatientSource, /hasAdditionalPatientDetails\(patient, chartEntries\)/);
  assert.match(newPatientSource, /setExtraFieldsOpen\(false\)/);
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
    "clinical-note-form",
    "patient-consent-form",
    "invoice-form",
    "insurance-form",
    "medical-profile-form",
    "quick-internal-comment-form",
    "document-form"
  ].forEach(formId => {
    assert.match(patientDashboardSource, new RegExp(formId));
  });
});
