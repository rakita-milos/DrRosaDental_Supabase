const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { assertSafeTestDatabase } = require('../../tests/playwright/utils/test-database-safety');
const { buildFinancialReport } = require('../services/financial-report-service');

test('financial reports use a consistent PostgreSQL snapshot and protected HTTP contracts', {
  skip: !process.env.SESSION_TEST_DATABASE_URL, timeout: 60000
}, async t => {
  const databaseUrl = process.env.SESSION_TEST_DATABASE_URL;
  assertSafeTestDatabase({ databaseUrl, env: { NODE_ENV: 'test', PLAYWRIGHT_ALLOW_DATABASE_MUTATION: '1' } });
  Object.assign(process.env, {
    NODE_ENV: 'test', DATABASE_URL: databaseUrl, PGSSL: 'false', PG_POOL_MAX: '1',
    JWT_SECRET: 'financial-test-only-secret-at-least-32-characters', DOCUMENT_STORAGE_DRIVER: 'local',
    CORS_ORIGIN: 'http://localhost:3010', API_URL: 'http://localhost:3010', TRUST_PROXY: 'loopback'
  });
  const { createPool } = require('../db/postgres');
  const { createDirectorReportsRepository } = require('../db/director-reports');
  const bcrypt = require('bcryptjs');
  const pool = createPool();
  const stamp = crypto.randomUUID().replaceAll('-', '');
  const currency = 'TST' + [...crypto.randomBytes(7)].map(byte => String.fromCharCode(65 + byte % 26)).join('');
  const missingCurrency = currency.replace(/^TST/, 'ZZZ');
  const userIds = [], patientIds = [], visitIds = [];
  let doctorId, currencyId, backend, server;
  t.after(async () => {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await pool.query('DELETE FROM visit_records WHERE id=ANY($1::int[])', [visitIds]);
    await pool.query('DELETE FROM patients WHERE id=ANY($1::int[])', [patientIds]);
    if (doctorId) await pool.query('DELETE FROM doctors WHERE id=$1', [doctorId]);
    if (currencyId) await pool.query('DELETE FROM codebook_items WHERE id=$1', [currencyId]);
    await pool.query('DELETE FROM audit_log WHERE user_id=ANY($1::int[])', [userIds]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::int[])', [userIds]);
    await pool.end(); backend?.closePostgresPool();
  });
  const password = 'Financial-local-test-2026!';
  const emails = {};
  for (const role of ['director', 'staff']) {
    const email = `financial-${role}-${stamp}@example.com`; emails[role] = email;
    userIds.push((await pool.query('INSERT INTO users(email,password_hash,name,role) VALUES($1,$2,$3,$4) RETURNING id', [email, await bcrypt.hash(password, 4), 'Financial fixture', role])).rows[0].id);
  }
  doctorId = (await pool.query("INSERT INTO doctors(name) VALUES('ZZ Financial fixture') RETURNING id")).rows[0].id;
  currencyId = (await pool.query("INSERT INTO codebook_items(type,value,label,metadata) VALUES('currency',$1,$1,$2) RETURNING id", [currency, JSON.stringify({ exchangeRate: 200, rateBase: currency, rateCurrency: 'RSD' })])).rows[0].id;
  for (let i = 0; i < 2; i++) patientIds.push((await pool.query("INSERT INTO patients(first_name,last_name) VALUES('Financial',$1) RETURNING id", [stamp])).rows[0].id);
  const procedure = `Financial ${stamp}`;
  async function fixture(patientId, code, paid, debt, parts = [], procedureName = procedure) {
    const visitId = (await pool.query("INSERT INTO visit_records(patient_id,doctor_id,visit_date,procedure,status) VALUES($1,$2,'2026-10-15',$3,'Zavrseno') RETURNING id", [patientId, doctorId, procedureName])).rows[0].id;
    visitIds.push(visitId);
    const paymentId = (await pool.query("INSERT INTO payments(visit_record_id,patient_id,amount,amount_paid,currency,payment_status) VALUES($1,$2,$3,$4,$5,'legacy label') RETURNING id", [visitId, patientId, debt, paid, code])).rows[0].id;
    for (const part of parts) await pool.query('INSERT INTO payment_parts(payment_id,visit_record_id,patient_id,amount,currency,amount_rsd,exchange_rate_to_rsd) VALUES($1,$2,$3,$4,$5,$6,$7)', [paymentId, visitId, patientId, ...part]);
    return visitId;
  }
  await fixture(patientIds[0], 'RSD', 400, 600, [[400, 'RSD', 400, 1]]);
  await fixture(patientIds[0], currency, 20, 80, [[20, currency, 2000, 100], [2000, 'RSD', 2000, 1]]);
  await fixture(patientIds[1], 'RSD', 500, 0, [], `${procedure} legacy`);
  backend = require('../server'); await backend.ensureRuntimeReady();
  server = await new Promise(resolve => { const instance = backend.app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const tokens = {};
  for (const role of ['director', 'staff']) {
    const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: emails[role], password }) });
    assert.equal(response.status, 200); tokens[role] = (await response.json()).token;
  }
  async function get(type, role = 'director') {
    const response = await fetch(`${base}/api/director/reports/${type}`, { headers: role ? { Authorization: `Bearer ${tokens[role]}` } : {}, signal: AbortSignal.timeout(15000) });
    return { status: response.status, data: await response.json() };
  }
  await t.test('snapshot does not multiply balances or visits when payment parts are split', async () => {
    let queries = 0;
    const repo = createDirectorReportsRepository({ pgPool: { query(...args) { queries++; return pool.query(...args); } } });
    const snapshot = await repo.financialReport();
    assert.equal(queries, 1);
    const records = snapshot.records.filter(row => patientIds.includes(row.patient_id));
    assert.equal(records.length, 3);
    const report = buildFinancialReport({ ...snapshot, records });
    assert.equal(report.totalRevenue, 4900);
    assert.equal(report.totalDebt, 16600);
    assert.equal(report.totalAmount, 21500);
    assert.equal(report.paymentPercentage, '22.8');
    assert.equal(report.patients.length, 2);
  });
  await t.test('HTTP retains existing summary fields and returns exact native balances', async () => {
    const { status, data } = await get('financial'); assert.equal(status, 200);
    const row = data.patients.find(patient => patient.patientId === patientIds[0]);
    assert.deepEqual(row.amount, { RSD: 1000, [currency]: 100 });
    assert.deepEqual(row.paid, { RSD: 400, [currency]: 20 });
    assert.deepEqual(row.debt, { RSD: 600, [currency]: 80 });
    assert.equal(row.visits, 2);
    assert.equal(data.revenueByCurrency[currency], 20);
    assert.equal(data.debtByCurrency[currency], 80);
    assert.equal(typeof data.totalRevenue, 'number');
    assert.equal(typeof data.totalDebt, 'number');
    assert.equal(typeof data.paymentPercentage, 'string');
    assert.equal(typeof data.details.revenue, 'string');
    assert.ok(data.patients.some(patient => patient.patientId === patientIds[1]));
  });
  await t.test('procedure average includes paid work and converts full prices to RSD', async () => {
    const { status, data } = await get('procedures'); assert.equal(status, 200);
    assert.equal(data.find(row => row.procedure === procedure).avgCost, 10500);
    assert.equal(data.find(row => row.procedure === procedure).count, 2);
    assert.equal(data.find(row => row.procedure === `${procedure} legacy`).avgCost, 500);
  });
  await t.test('staff and anonymous requests cannot access financial data', async () => {
    assert.equal((await get('financial', 'staff')).status, 403);
    assert.equal((await get('financial', null)).status, 401);
  });
  await t.test('missing rate returns a controlled error and succeeds after the bad fixture is removed', async () => {
    const badId = await fixture(patientIds[0], missingCurrency, 0, 1);
    try {
      for (const type of ['financial', 'procedures']) {
        const result = await get(type);
        assert.equal(result.status, 409);
        assert.equal(result.data.code, 'REPORT_RATE_MISSING');
      }
    } finally { await pool.query('DELETE FROM visit_records WHERE id=$1', [badId]); }
    assert.equal((await get('financial')).status, 200);
  });
});
