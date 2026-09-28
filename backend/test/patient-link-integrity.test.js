const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const serverSource = readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('patient documents reject visits that belong to another patient', () => {
  assert.match(serverSource, /async function assertVisitBelongsToPatient/);
  assert.match(serverSource, /Visit record does not belong to this patient/);
  assert.match(serverSource, /await assertVisitBelongsToPatient\(\{ visitRecordId, patientId \}\)/);
  assert.match(serverSource, /await assertVisitBelongsToPatient\(\{ visitRecordId, patientId: current\.patient_id \}\)/);
});

test('billing routes enforce patient ownership for referenced visits and invoices', () => {
  assert.match(serverSource, /async function assertInvoiceBelongsToPatient/);
  assert.match(serverSource, /Invoice does not belong to this patient/);
  assert.match(serverSource, /await assertInvoiceBelongsToPatient\(\{ invoiceId, patientId \}\)/);
});
