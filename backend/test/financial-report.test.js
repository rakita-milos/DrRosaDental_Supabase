const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildFinancialReport, buildProceduresReport } = require('../services/financial-report-service');

const currencies = [{ value: 'EUR', metadata: JSON.stringify({ exchangeRate: 200, rateBase: 'EUR', rateCurrency: 'RSD' }) }];
const visit = (overrides = {}) => ({ visit_id: 1, patient_id: 1, patient_name: 'Same Name', procedure: 'Exam', currency: 'RSD', amount_due: 600, amount_paid: 400, payment_parts: [], ...overrides });

test('financial revenue includes partial receipts; price and debt remain separate', () => {
  const report = buildFinancialReport({ total_patients: 3, currencies, records: [visit(), visit({ visit_id: 2, amount_due: 0, amount_paid: 200 })] });
  assert.equal(report.totalRevenue, 600);
  assert.equal(report.totalDebt, 600);
  assert.equal(report.totalAmount, 1200);
  assert.equal(report.paymentPercentage, '50.0');
  assert.deepEqual(report.revenueByCurrency, { RSD: 600 });
  assert.equal(report.patients[0].visits, 2);
  assert.deepEqual(report.patients[0].paid, { RSD: 600 });
  assert.deepEqual(report.patients[0].amount, { RSD: 1200 });
  assert.equal(report.totalPatients, 3);
});

test('split receipts use saved RSD values while debt uses the current configured rate', () => {
  const report = buildFinancialReport({ currencies, records: [visit({ currency: 'EUR', amount_due: 80, amount_paid: 20,
    payment_parts: [{ amount: 20, currency: 'EUR', amount_rsd: 2000, exchange_rate_to_rsd: 100 }, { amount: 2000, currency: 'RSD', amount_rsd: 2000, exchange_rate_to_rsd: 1 }]
  })] });
  assert.equal(report.totalRevenue, 4000);
  assert.equal(report.totalDebt, 16000);
  assert.equal(report.totalAmount, 20000);
  assert.equal(report.paymentPercentage, '20.0');
  assert.deepEqual(report.revenueByCurrency, { EUR: 20, RSD: 2000 });
  assert.deepEqual(report.debtByCurrency, { EUR: 80 });
  assert.deepEqual(report.patients[0].paid, { EUR: 20 });
});

test('patients with the same name keep separate balances by patient id', () => {
  const report = buildFinancialReport({ currencies, records: [visit(), visit({ patient_id: 2, amount_due: 0, amount_paid: 300 })] });
  assert.equal(report.patients.length, 2);
  assert.deepEqual(report.patients.map(row => row.patientId), [1, 2]);
  assert.deepEqual(report.patients[1].debt, { RSD: 0 });
});

test('missing or invalid rates never relabel foreign amounts as RSD', () => {
  assert.throws(() => buildFinancialReport({ records: [visit({ currency: 'XYZ' })] }), error => error.code === 'REPORT_RATE_MISSING');
  for (const configured of [[{ value: 'EUR', metadata: 'broken JSON' }], [{ value: 'EUR', metadata: { exchangeRate: -1 } }]]) {
    assert.throws(() => buildFinancialReport({ currencies: configured, records: [visit({ currency: 'EUR' })] }), error => error.code === 'REPORT_RATE_MISSING' && error.status === 409);
  }
});

test('unconfigured standard currencies use the same existing defaults as payment writes', () => {
  const report = buildFinancialReport({ records: [visit({ currency: 'EUR', amount_paid: 10, amount_due: 0 }), visit({ currency: 'USD', amount_paid: 10, amount_due: 0 })] });
  assert.equal(report.totalRevenue, 2250);
});

test('inverse rates, legacy payments without parts and cent rounding are supported', () => {
  const report = buildFinancialReport({ currencies: [{ value: 'EUR', metadata: { exchangeRate: 0.005, rateBase: 'RSD', rateCurrency: 'EUR' } }],
    records: [visit({ currency: 'EUR', amount_paid: 0.1, amount_due: 0 }), visit({ visit_id: 2, currency: 'EUR', amount_paid: 0.2, amount_due: 0 })] });
  assert.deepEqual(report.revenueByCurrency, { EUR: 0.3 });
  assert.equal(report.totalRevenue, 60);
  assert.equal(report.paymentPercentage, '100.0');
  assert.equal(report.legacyPaymentCount, 2);
});

test('empty and zero-value reports remain usable without currency metadata', () => {
  const empty = buildFinancialReport({ records: [], total_patients: 7 });
  assert.equal(empty.totalRevenue, 0);
  assert.equal(empty.paymentPercentage, '0.0');
  assert.equal(empty.totalPatients, 7);
  assert.deepEqual(empty.patients, []);
  assert.equal(buildFinancialReport({ records: [visit({ currency: 'XYZ', amount_paid: 0, amount_due: 0 })] }).totalAmount, 0);
});

test('procedure average uses full visit cost instead of outstanding debt', () => {
  const rows = buildProceduresReport({ currencies, records: [visit(), visit({ visit_id: 2, amount_due: 0, amount_paid: 200 }),
    visit({ visit_id: 3, procedure: 'Foreign exam', currency: 'EUR', amount_due: 80, amount_paid: 20 })] });
  assert.deepEqual(rows.find(row => row.procedure === 'Exam'), { procedure: 'Exam', count: 2, percentage: 66.7, avgCost: 600 });
  assert.equal(rows.find(row => row.procedure === 'Foreign exam').avgCost, 20000);
});

test('invalid financial amounts fail instead of producing NaN or Infinity', () => {
  for (const amount_paid of ['NaN', Infinity, -1]) {
    assert.throws(() => buildFinancialReport({ records: [visit({ amount_paid })] }), error => error.code === 'REPORT_INVALID_AMOUNT');
  }
  assert.throws(() => buildFinancialReport({ currencies: [{ value: 'EUR', metadata: { exchangeRate: 1e308, rateBase: 'EUR', rateCurrency: 'RSD' } }], records: [visit({ currency: 'EUR' })] }), error => error.code === 'REPORT_INVALID_AMOUNT');
});
