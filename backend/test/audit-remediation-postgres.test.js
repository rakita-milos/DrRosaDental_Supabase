const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { assertSafeTestDatabase } = require('../../tests/playwright/utils/test-database-safety');

test('audit remediation preserves clinical and payment integrity over HTTP and PostgreSQL', {
  skip: !process.env.SESSION_TEST_DATABASE_URL, timeout: 60000
}, async t => {
  const databaseUrl = process.env.SESSION_TEST_DATABASE_URL;
  assertSafeTestDatabase({ databaseUrl, env: { NODE_ENV: 'test', PLAYWRIGHT_ALLOW_DATABASE_MUTATION: '1' } });
  Object.assign(process.env, {
    NODE_ENV: 'test', DATABASE_URL: databaseUrl, PGSSL: 'false', PG_POOL_MAX: '1',
    JWT_SECRET: 'audit-test-only-secret-at-least-32-characters', DOCUMENT_STORAGE_DRIVER: 'local',
    CORS_ORIGIN: 'http://localhost:3010', API_URL: 'http://localhost:3010', TRUST_PROXY: 'loopback'
  });
  const { createPool } = require('../db/postgres');
  const { createRecordsPaymentsRepository } = require('../db/records-payments');
  const bcrypt = require('bcryptjs');
  const pool = createPool();
  const stamp = crypto.randomUUID().replaceAll('-', '');
  const patientIds = [], recordIds = [], noteIds = [];
  let userId, doctorId, backend, server;
  const triggerName = `audit_fail_${stamp}`;
  t.after(async () => {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON app.payment_parts`);
    await pool.query(`DROP FUNCTION IF EXISTS app.${triggerName}()`);
    await pool.query('DELETE FROM clinical_notes WHERE id=ANY($1::int[])', [noteIds]);
    await pool.query('DELETE FROM visit_records WHERE id=ANY($1::int[])', [recordIds]);
    await pool.query('DELETE FROM patients WHERE id=ANY($1::int[])', [patientIds]);
    if (doctorId) await pool.query('DELETE FROM doctors WHERE id=$1', [doctorId]);
    if (userId) await pool.query('DELETE FROM audit_log WHERE user_id=$1', [userId]);
    if (userId) await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    await pool.end();
    backend?.closePostgresPool();
  });
  const password = 'Audit-local-test-2026!';
  const email = `audit-${stamp}@example.com`;
  userId = (await pool.query("INSERT INTO users(email,password_hash,name,role) VALUES($1,$2,'Audit fixture','director') RETURNING id", [email, await bcrypt.hash(password, 4)])).rows[0].id;
  doctorId = (await pool.query("INSERT INTO doctors(name) VALUES('Audit fixture') RETURNING id")).rows[0].id;
  for (let index = 0; index < 2; index++) {
    patientIds.push((await pool.query("INSERT INTO patients(first_name,last_name,email) VALUES('Audit','Fixture',$1) RETURNING id", [`patient-${index}-${stamp}@example.test`])).rows[0].id);
  }
  backend = require('../server');
  await backend.ensureRuntimeReady();
  server = await new Promise(resolve => { const instance = backend.app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let token;
  async function call(method, route, body) {
    const response = await fetch(base + route, { method, headers: {
      'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {})
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
    return { status: response.status, data: await response.json() };
  }
  const login = await call('POST', '/api/auth/login', { email, password });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  token = login.data.token;
  const visitBody = patientId => ({
    patient_id: patientId, doctor_id: doctorId, visit_date: '2026-10-14', procedure: 'Audit visit',
    notes: 'Original note', totalAmount: 100, currency: 'EUR',
    paymentParts: [{ amount: 20, currency: 'EUR', exchangeRateToRsd: 117, paymentDate: '2026-10-14' }],
    treatments: { '11': { type: 'Original treatment', price: 100, currency: 'EUR' } }
  });
  for (const patientId of patientIds) {
    const result = await call('POST', '/api/records', visitBody(patientId));
    assert.equal(result.status, 201, JSON.stringify(result.data)); recordIds.push(result.data.id);
  }
  const visitId = recordIds[0];
  await t.test('canonical partial status and patient filter retain full relevant history', async () => {
    const result = await call('GET', `/api/records?patientId=${patientIds[0]}`);
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.map(row => row.id), [visitId]);
    assert.equal(result.data[0].payment_status, 'Delimično');
    assert.equal((await call('GET', '/api/records?patientId=bad')).status, 400);
  });
  await t.test('failed payment insertion rolls back notes, deleted treatments and payment history', async () => {
    const snapshot = async () => ({
      visit: (await pool.query('SELECT * FROM visit_records WHERE id=$1', [visitId])).rows,
      treatments: (await pool.query('SELECT * FROM treatments WHERE visit_record_id=$1 ORDER BY id', [visitId])).rows,
      payment: (await pool.query('SELECT * FROM payments WHERE visit_record_id=$1', [visitId])).rows,
      parts: (await pool.query('SELECT * FROM payment_parts WHERE visit_record_id=$1 ORDER BY id', [visitId])).rows
    });
    const before = await snapshot();
    await pool.query(`CREATE FUNCTION app.${triggerName}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.visit_record_id = ${Number(visitId)} THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON app.payment_parts FOR EACH ROW EXECUTE FUNCTION app.${triggerName}()`);
    try {
      const result = await call('PUT', `/api/records/${visitId}`, {
        procedure: 'Replacement visit', notes: 'Must roll back', treatments: { '12': { type: 'Replacement', price: 100 } },
        totalAmount: 100, currency: 'EUR', paymentParts: [{ amount: 30, currency: 'EUR', exchangeRateToRsd: 117 }]
      });
      assert.equal(result.status, 500, JSON.stringify(result.data));
      assert.deepEqual(await snapshot(), before);
    } finally {
      await pool.query(`DROP TRIGGER ${triggerName} ON app.payment_parts`);
      await pool.query(`DROP FUNCTION app.${triggerName}()`);
    }
  });
  await t.test('concurrent euro payments keep every part and the correct remaining debt', async () => {
    const existingId = (await pool.query('SELECT id FROM payment_parts WHERE visit_record_id=$1', [visitId])).rows[0].id;
    const responses = await Promise.all(Array.from({ length: 6 }, () => call('POST', `/api/records/${visitId}/payment-parts`, {
      amount: 10, currency: 'EUR', exchangeRateToRsd: 117, paymentDate: '2026-10-14'
    })));
    assert.ok(responses.every(result => result.status === 201), JSON.stringify(responses));
    const payment = (await pool.query('SELECT * FROM payments WHERE visit_record_id=$1', [visitId])).rows[0];
    assert.equal(Number(payment.amount), 20);
    assert.equal(Number(payment.amount_paid), 80);
    const parts = (await pool.query('SELECT id FROM payment_parts WHERE visit_record_id=$1', [visitId])).rows;
    assert.equal(parts.length, 7);
    assert.ok(parts.some(part => part.id === existingId));
  });
  await t.test('clinical notes and chart entries reject another patient visit on create and update', async () => {
    const foreignVisitId = recordIds[1];
    const invalidNote = await call('POST', `/api/patients/${patientIds[0]}/clinical-notes`, { title: 'Audit', body: 'Audit', visitRecordId: foreignVisitId });
    assert.equal(invalidNote.status, 400);
    const note = await call('POST', `/api/patients/${patientIds[0]}/clinical-notes`, { title: 'Audit', body: 'Audit', visitRecordId: visitId });
    assert.equal(note.status, 201); noteIds.push(note.data.id);
    assert.equal((await call('PUT', `/api/clinical-notes/${note.data.id}`, { body: 'Wrong', visitRecordId: foreignVisitId })).status, 400);
    assert.equal((await pool.query('SELECT body FROM clinical_notes WHERE id=$1', [note.data.id])).rows[0].body, 'Audit');
    assert.equal((await call('POST', `/api/patients/${patientIds[0]}/clinical-chart`, { toothNumber: '11', visitRecordId: foreignVisitId })).status, 400);
    const chart = await call('POST', `/api/patients/${patientIds[0]}/clinical-chart`, { toothNumber: '11', visitRecordId: visitId });
    assert.equal(chart.status, 201, JSON.stringify(chart.data));
    assert.equal((await call('PUT', `/api/clinical-chart/${chart.data.id}`, { visitRecordId: foreignVisitId })).status, 400);
    assert.equal(Number((await pool.query('SELECT visit_record_id FROM clinical_chart_entries WHERE id=$1', [chart.data.id])).rows[0].visit_record_id), visitId);
  });
  await t.test('errors in a previously unwrapped route return JSON and leave the server responsive', async () => {
    // An integer outside PostgreSQL int range makes the real repository reject.
    assert.equal((await call('GET', '/api/patients/999999999999999/invoices')).status, 500);
    assert.equal((await call('GET', '/api/health')).status, 200);
  });
  await t.test('repository locking works across independent connection pools', async () => {
    const otherPool = createPool(databaseUrl);
    try {
      const one = createRecordsPaymentsRepository({ pgPool: pool });
      const two = createRecordsPaymentsRepository({ pgPool: otherPool });
      await Promise.all(Array.from({ length: 6 }, (_, index) => (index % 2 ? one : two).withRecordForUpdate(visitId, async ({ current, records }) => {
        await records.updateRecord({ id: visitId, procedure: String(Number(current.procedure) + 1 || 1), status: current.status, shift: current.shift, notes: current.notes });
      })));
      assert.equal((await pool.query('SELECT procedure FROM visit_records WHERE id=$1', [visitId])).rows[0].procedure, '6');
    } finally { await otherPool.end(); }
  });
});
