const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRecordsPaymentsRepository } = require('../db/records-payments');
const { asyncRoute } = require('../route-utils');
const { clinicDateFromInstant } = require('../utils/clinic-time');

function loadFunctions(file, names, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
  const context = vm.createContext(globals);
  for (const name of names) {
    const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?^\\}`, 'm'));
    assert.ok(match, `Missing ${name}`);
    vm.runInContext(match[0], context);
  }
  return context;
}

test('payment summary uses canonical statuses for unpaid, partial and paid visits', async () => {
  const context = loadFunctions('backend/server.js', ['calculatePaymentSummary'], {
    directorAdmin: {}, money: Number, normalizeCurrency: value => value,
    exchangeRateToRsd: async () => 1, roundMoney: value => Math.round(value * 100) / 100,
    PAYMENT_ROUNDING_TOLERANCE_RSD: 1, normalizePaymentStatus: value => value
  });
  for (const [paid, expectedDebt, status] of [[0, 100, 'Dugovanje'], [40, 60, 'Delimično'], [100, 0, 'Plaćeno'], [99.5, 0, 'Plaćeno']]) {
    const result = await context.calculatePaymentSummary({ amount: 100, currency: 'RSD', paymentParts: [{ amountRsd: paid }] });
    assert.equal(result.paymentStatus, status);
    assert.equal(result.amountDue, expectedDebt);
    assert.equal(result.amountPaid, expectedDebt === 0 ? 100 : paid);
  }
});

test('patient debt includes partial payments and legacy labels when balance is positive', () => {
  const context = loadFunctions('src/scripts/patient-dashboard.js', ['isDebt']);
  for (const paymentStatus of ['Delimično', 'Dugovanje', 'DelimiÄno', '', 'Plaćeno']) {
    assert.equal(context.isDebt({ amountDue: 60, paymentStatus }), true);
    assert.equal(context.isDebt({ amountDue: 0, paymentStatus }), false);
  }
});

test('runtime readiness shares a failed attempt and retries on the next request', async () => {
  let calls = 0;
  const context = loadFunctions('backend/server.js', ['ensureRuntimeReady'], {
    runtimeReadyPromise: null,
    pgPool: { query: async () => { if (++calls === 1) throw new Error('temporary failure'); return 'ready'; } }
  });
  const results = await Promise.allSettled([context.ensureRuntimeReady(), context.ensureRuntimeReady()]);
  assert.ok(results.every(result => result.status === 'rejected'));
  assert.equal(calls, 1);
  assert.equal(await context.ensureRuntimeReady(), 'ready');
  assert.equal(await context.ensureRuntimeReady(), 'ready');
  assert.equal(calls, 2);
});

test('same-name patients require an explicit id, and stale selections are not reused', () => {
  const context = loadFunctions('src/scripts/new-entry.js', ['patientName', 'findPatientByName', 'selectedPatient'], {
    patients: [{ id: 1, first_name: 'Ana', last_name: 'Test' }, { id: 2, first_name: 'Ana', last_name: 'Test' }],
    patientIdParam: '', inputs: { patient: { value: 'Ana Test', dataset: {} } }
  });
  assert.equal(context.selectedPatient(), null);
  context.inputs.patient.dataset.patientId = '2';
  assert.equal(context.selectedPatient().id, 2);
  context.inputs.patient.value = 'Other name';
  assert.equal(context.selectedPatient(), null);
  context.patientIdParam = '1';
  assert.equal(context.selectedPatient().id, 1);
});

test('visit edits use one connection and roll back after treatment deletion fails', async () => {
  const queries = [];
  let released = false;
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (/INSERT INTO treatments/.test(sql)) throw new Error('treatment insert failed');
      return { rows: /FOR UPDATE/.test(sql) ? [{ id: 7, patient_id: 9 }] : [], rowCount: 1 };
    },
    release() { released = true; }
  };
  const repository = createRecordsPaymentsRepository({ pgPool: {
    connect: async () => client, query() { throw new Error('escaped transaction'); }
  } });
  await assert.rejects(repository.withRecordForUpdate(7, async ({ current, records }) => {
    assert.equal(current.id, 7);
    await records.updateRecord({ id: 7, procedure: 'New', status: 'Done', shift: 'One', notes: 'New' });
    await records.replaceTreatments(7, [{ toothNumber: '11', type: 'New' }]);
  }), /treatment insert failed/);
  assert.equal(queries.filter(query => query.sql === 'BEGIN').length, 1);
  assert.match(queries[1].sql, /FOR UPDATE/);
  assert.equal(queries.at(-1).sql, 'ROLLBACK');
  assert.ok(queries.some(query => /DELETE FROM treatments/.test(query.sql)));
  assert.equal(released, true);
});

test('records filter binds patient id together with search and pagination', async () => {
  let query;
  const repository = createRecordsPaymentsRepository({ pgPool: { async query(sql, params) {
    query = { sql, params }; return { rows: [] };
  } } });
  await repository.listRecords({ patientId: 7, search: 'Ana', limit: 10, offset: 20 });
  assert.match(query.sql, /WHERE vr.patient_id = \$1 AND/);
  assert.deepEqual(query.params, [7, '%Ana%', '%Ana%', '%Ana%', '%Ana%', 10, 20]);
});

test('async route forwards repository failures to the error middleware', async () => {
  const error = new Error('database failure');
  await new Promise(resolve => {
    asyncRoute(async () => { throw error; })({}, {}, received => {
      assert.equal(received, error); resolve();
    });
  });
});

test('default business dates use Belgrade on both sides of midnight', () => {
  class FixedDate extends Date { constructor() { super('2026-10-14T22:30:00Z'); } }
  const context = loadFunctions('backend/server.js', ['todayIsoDate'], { Date: FixedDate, clinicDateFromInstant });
  assert.equal(context.todayIsoDate(), '2026-10-15');
});
