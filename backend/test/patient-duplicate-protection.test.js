const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const patientsRepoSource = readFileSync(path.join(__dirname, '..', 'db', 'patients.js'), 'utf8');
const serverSource = readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('patient repository exposes deterministic duplicate lookup', () => {
  assert.match(patientsRepoSource, /findDuplicatePatient\(patient, excludeId = null\)/);
  assert.match(patientsRepoSource, /lower\(btrim\(first_name\)\) = lower\(btrim\(\?\)\)/);
  assert.match(patientsRepoSource, /lower\(btrim\(last_name\)\) = lower\(btrim\(\?\)\)/);
  assert.match(patientsRepoSource, /\?::integer IS NULL OR id <> \?::integer/);
  assert.match(patientsRepoSource, /\?::text IS NOT NULL AND date_of_birth = NULLIF\(\?::text, ''\)::date/);
  assert.match(patientsRepoSource, /regexp_replace\(COALESCE\(phone, ''\), '\\\\D', '', 'g'\)/);
});

test('create patient endpoint rejects duplicates before insert', () => {
  assert.match(serverSource, /const duplicate = await patientsRepo\.findDuplicatePatient\(patientPayload\)/);
  assert.match(serverSource, /res\.status\(409\)\.json\(\{/);
  assert.match(serverSource, /duplicatePatientId: duplicate\.id/);
  assert.match(serverSource, /await patientsRepo\.createPatient\(patientPayload\)/);
  assert.ok(
    serverSource.indexOf('findDuplicatePatient(patientPayload)') < serverSource.indexOf('createPatient(patientPayload)'),
    'duplicate lookup should run before patient insert'
  );
});
