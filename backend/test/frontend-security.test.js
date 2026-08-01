const assert = require('node:assert');
const { readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const apiSource = readFileSync(path.join(__dirname, '..', '..', 'src', 'scripts', 'api.js'), 'utf8');
const securitySource = readFileSync(path.join(__dirname, '..', '..', 'src', 'scripts', 'security-utils.js'), 'utf8');
const calendarSource = readFileSync(path.join(__dirname, '..', '..', 'src', 'scripts', 'calendar.js'), 'utf8');
const dashboardSource = readFileSync(path.join(__dirname, '..', '..', 'src', 'scripts', 'script.js'), 'utf8');
const allRecordsSource = readFileSync(path.join(__dirname, '..', '..', 'src', 'scripts', 'all-records.js'), 'utf8');
const newEntrySource = readFileSync(path.join(__dirname, '..', '..', 'src', 'scripts', 'new-entry.js'), 'utf8');
const pagesDir = path.join(__dirname, '..', '..', 'src', 'pages');

test('shared frontend security helpers escape text and attributes', () => {
  assert.match(securitySource, /function escapeHtml\(value\)/);
  assert.match(securitySource, /function escapeAttribute\(value\)/);
  assert.match(securitySource, /window\.DrRosaSecurity = \{/);
  assert.match(apiSource, /const \{ escapeHtml \} = window\.DrRosaSecurity/);
});

test('calendar select rendering escapes option text and attributes', () => {
  assert.match(calendarSource, /value="\$\{window\.DrRosaSecurity\.escapeAttribute\(item\[value\]\)\}"/);
  assert.match(calendarSource, /data-name="\$\{window\.DrRosaSecurity\.escapeAttribute\(item\.value\)\}"/);
  assert.match(calendarSource, /window\.DrRosaSecurity\.escapeHtml\(item\.label\)/);
});

test('dashboard dynamic cards escape patient-facing text', () => {
  assert.match(dashboardSource, /window\.DrRosaSecurity\.escapeHtml\(appointmentPatientName\(appointment\)\)/);
  assert.match(dashboardSource, /window\.DrRosaSecurity\.escapeHtml\(procedure\)/);
  assert.match(dashboardSource, /window\.DrRosaSecurity\.escapeHtml\(alert\.text\)/);
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
