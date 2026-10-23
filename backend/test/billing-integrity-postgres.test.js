const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { assertSafeTestDatabase } = require('../../tests/playwright/utils/test-database-safety');

test('billing numbering and retries preserve financial integrity over real connections', {
  skip: !process.env.SESSION_TEST_DATABASE_URL, timeout: 90000
}, async t => {
  const databaseUrl = process.env.SESSION_TEST_DATABASE_URL;
  assertSafeTestDatabase({ databaseUrl, env: { NODE_ENV: 'test', PLAYWRIGHT_ALLOW_DATABASE_MUTATION: '1' } });
  Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: databaseUrl, PGSSL: 'false', PG_POOL_MAX: process.env.BILLING_TEST_POOL_MAX || '4',
    JWT_SECRET: 'billing-integrity-test-only-secret-at-least-32-characters', DOCUMENT_STORAGE_DRIVER: 'local',
    CORS_ORIGIN: 'http://localhost:3010', API_URL: 'http://localhost:3010', TRUST_PROXY: 'loopback' });
  const { createPool } = require('../db/postgres');
  const { createBillingRepository } = require('../db/billing');
  const bcrypt = require('bcryptjs');
  const pool = createPool(), otherPool = createPool();
  const stamp = crypto.randomUUID().replaceAll('-', '');
  const invoiceIds = [], claimIds = [], visitIds = [];
  let patientId, userId, backend, server, token, doctorId;
  const failTrigger = `billing_fail_${stamp}`;
  t.after(async () => {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await pool.query(`DROP TRIGGER IF EXISTS ${failTrigger} ON app.patient_ledger_entries`);
    await pool.query(`DROP FUNCTION IF EXISTS app.${failTrigger}()`);
    await pool.query('DELETE FROM financial_requests WHERE scope = ANY($1::text[])', [
      [...invoiceIds.map(id => `invoice-payment:${id}`), ...claimIds.map(id => `era:${id}`), ...visitIds.map(id => `visit-payment:${id}`)]
    ]);
    if (patientId) {
      await pool.query('DELETE FROM patient_ledger_entries WHERE patient_id=$1', [patientId]);
      await pool.query('DELETE FROM insurance_claims WHERE patient_id=$1', [patientId]);
      await pool.query('DELETE FROM invoices WHERE patient_id=$1', [patientId]);
      await pool.query('DELETE FROM visit_records WHERE patient_id=$1', [patientId]);
      await pool.query('DELETE FROM patients WHERE id=$1', [patientId]);
    }
    if (doctorId) await pool.query('DELETE FROM doctors WHERE id=$1', [doctorId]);
    if (userId) { await pool.query('DELETE FROM audit_log WHERE user_id=$1', [userId]); await pool.query('DELETE FROM users WHERE id=$1', [userId]); }
    await pool.end(); await otherPool.end(); backend?.closePostgresPool();
  });
  patientId = (await pool.query("INSERT INTO patients(first_name,last_name) VALUES('Billing',$1) RETURNING id", [stamp])).rows[0].id;
  doctorId = (await pool.query("INSERT INTO doctors(name) VALUES('Billing fixture') RETURNING id")).rows[0].id;
  const password = 'Billing-local-fixture-2026!', email = `billing-${stamp}@example.com`;
  userId = (await pool.query("INSERT INTO users(email,password_hash,name,role) VALUES($1,$2,'Billing fixture','director') RETURNING id", [email, await bcrypt.hash(password, 4)])).rows[0].id;
  backend = require('../server'); await backend.ensureRuntimeReady();
  server = await new Promise(resolve => { const instance = backend.app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(path, body, key, method = 'POST') {
    const response = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
    return { status: response.status, body: await response.json() };
  }
  const login = await call('/auth/login', { email, password });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  token = login.body.token;
  const invoiceInput = { patientId, visitRecordId: null, invoiceNumber: null, issueDate: '2026-10-16', dueDate: null,
    currency: 'RSD', discount: 0, tax: 0, notes: stamp, createdBy: userId };
  const items = [{ description: 'Exam', quantity: 1, unitPrice: 1000, discount: 0, toothNumber: null }];
  const ledger = { patientId, entryType: 'charge', source: 'invoice', entryDate: '2026-10-16', userId };
  const repositories = [pool, otherPool].map(pgPool => createBillingRepository({ pgPool }));
  let invoice;

  await t.test('independent connection pools allocate unique numbers in the same transaction', async () => {
    const rows = await Promise.all(Array.from({ length: 8 }, (_, i) => repositories[i % 2].createInvoice({ invoice: invoiceInput, items, ledger })));
    invoiceIds.push(...rows.map(row => row.id)); invoice = rows[0];
    assert.equal(new Set(rows.map(row => row.invoice_number)).size, 8);
    assert.ok(rows.every(row => /^DR-\d{4}-\d{5,}$/.test(row.invoice_number)));
    const businessYear = (await pool.query("SELECT extract(year FROM current_timestamp AT TIME ZONE 'Europe/Belgrade')::int AS year")).rows[0].year;
    assert.ok(rows.every(row => row.invoice_number.startsWith(`DR-${businessYear}-`)));
  });

  await t.test('manual numbers remain available; duplicates return 409; deletion does not reuse a number', async () => {
    const manual = `CUSTOM-${stamp}`;
    const first = await call(`/patients/${patientId}/invoices`, { invoiceNumber: manual, items, currency: 'RSD' });
    assert.equal(first.status, 201); invoiceIds.push(first.body.id);
    assert.equal(first.body.invoiceNumber, manual);
    const listed = await call(`/patients/${patientId}/invoices`, undefined, undefined, 'GET');
    assert.equal(listed.status, 200);
    assert.ok(listed.body.find(row => row.id === first.body.id)?.items.length);
    assert.equal((await call(`/patients/${patientId}/invoices`, { invoiceNumber: manual, items })).status, 409);
    const latest = await repositories[0].createInvoice({ invoice: invoiceInput, items, ledger }); invoiceIds.push(latest.id);
    await pool.query('DELETE FROM patient_ledger_entries WHERE invoice_id=$1', [latest.id]);
    await pool.query('DELETE FROM invoices WHERE id=$1', [latest.id]);
    const next = await repositories[1].createInvoice({ invoice: invoiceInput, items, ledger }); invoiceIds.push(next.id);
    assert.equal(BigInt(next.invoice_number.split('-')[2]), BigInt(latest.invoice_number.split('-')[2]) + 1n);
  });

  await t.test('failed invoice creation rolls back its counter and all associated writes', async () => {
    const before = await pool.query('SELECT * FROM invoice_number_counters ORDER BY year');
    await assert.rejects(repositories[0].createInvoice({ invoice: invoiceInput, items: [{ ...items[0], description: null }], ledger }));
    assert.deepEqual((await pool.query('SELECT * FROM invoice_number_counters ORDER BY year')).rows, before.rows);
  });

  const payment = { amount: 100, paymentDate: '2026-10-16', paymentMethod: 'cash' };
  const paymentPath = `/invoices/${invoice.id}/payments`, paymentKey = crypto.randomUUID();
  let originalPayment;
  await t.test('parallel invoice payment retries return one original response and one ledger posting', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => call(paymentPath, payment, paymentKey)));
    assert.ok(results.every(result => result.status === 201));
    originalPayment = results[0].body;
    for (const result of results) assert.deepEqual(result.body, originalPayment);
    assert.equal(originalPayment.amountPaid, 100);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id=$1', [invoice.id])).rows[0].n, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM patient_ledger_entries WHERE invoice_id=$1 AND source='invoice_payment'", [invoice.id])).rows[0].n, 1);
    assert.equal((await call(paymentPath, { ...payment, amount: 101 }, paymentKey)).status, 409);
  });

  await t.test('a different key permits an equal payment; retry after a lost response returns its historical snapshot', async () => {
    assert.equal((await call(paymentPath, payment, crypto.randomUUID())).body.amountPaid, 200);
    assert.deepEqual((await call(paymentPath, payment, paymentKey)).body, originalPayment);
    // Commit the HTTP request but deliberately discard the response before retrying.
    const key = crypto.randomUUID();
    const discarded = await fetch(base + '/api' + paymentPath, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': key }, body: JSON.stringify(payment) });
    await discarded.body.cancel();
    assert.equal((await call(paymentPath, payment, key)).body.amountPaid, 300);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id=$1', [invoice.id])).rows[0].n, 3);
  });

  await t.test('ledger failure rolls back invoice payment and receipt; the same key can retry', async () => {
    const key = crypto.randomUUID();
    await pool.query(`CREATE FUNCTION app.${failTrigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture ledger failure'; END $$`);
    await pool.query(`CREATE TRIGGER ${failTrigger} BEFORE INSERT ON app.patient_ledger_entries FOR EACH ROW WHEN (NEW.patient_id = ${patientId} AND NEW.source = 'invoice_payment') EXECUTE FUNCTION app.${failTrigger}()`);
    assert.equal((await call(paymentPath, payment, key)).status, 500);
    assert.equal((await pool.query('SELECT amount_paid FROM invoices WHERE id=$1', [invoice.id])).rows[0].amount_paid, '300.00');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM financial_requests WHERE scope=$1 AND request_key=$2', [`invoice-payment:${invoice.id}`, key])).rows[0].n, 0);
    await pool.query(`DROP TRIGGER ${failTrigger} ON app.patient_ledger_entries`);
    assert.equal((await call(paymentPath, payment, key)).body.amountPaid, 400);
  });

  let claimId;
  await t.test('legacy ERA clicks post once, explicit corrections post only the cumulative difference', async () => {
    claimId = (await pool.query("INSERT INTO insurance_claims(patient_id,provider,requested_amount) VALUES($1,'Test payer',1000) RETURNING id", [patientId])).rows[0].id; claimIds.push(claimId);
    const path = `/insurance-claims/${claimId}/era`;
    const results = await Promise.all(Array.from({ length: 5 }, () => call(path, { paidAmount: 100, approvedAmount: 100 })));
    assert.ok(results.every(result => result.status === 200));
    for (const result of results) assert.deepEqual(result.body, results[0].body);
    assert.equal((await call(path, { paidAmount: 200, approvedAmount: 200 })).status, 409);
    const correction = await call(path, { eventId: 'correction-1', paidAmount: 250, approvedAmount: 250 });
    assert.equal(correction.status, 200); assert.equal(correction.body.paidAmount, 250);
    assert.equal((await call(path, { eventId: 'correction-1', paidAmount: 260, approvedAmount: 260 })).status, 409);
    assert.equal((await call(path, { eventId: 'correction-2', paidAmount: 0, approvedAmount: 0 })).body.paidAmount, 0);
    const postings = (await pool.query("SELECT amount FROM patient_ledger_entries WHERE claim_id=$1 AND source='era' ORDER BY id", [claimId])).rows.map(row => Number(row.amount));
    assert.deepEqual(postings, [-100, -150, 250]);
    assert.deepEqual((await call(path, { eventId: 'correction-1', paidAmount: 250, approvedAmount: 250 })).body, correction.body);
    const listed = await call(`/patients/${patientId}/insurance-claims`, undefined, undefined, 'GET');
    assert.equal(listed.status, 200);
    assert.equal(listed.body.find(row => row.id === claimId).paidAmount, 0);
  });

  await t.test('distinct concurrent invoice payments keep all totals; a refund is idempotent too', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => call(paymentPath, { ...payment, amount: 1 }, crypto.randomUUID())));
    assert.ok(results.every(result => result.status === 201));
    assert.deepEqual(results.map(result => result.body.amountPaid).sort((a, b) => a - b), [401, 402, 403, 404, 405, 406]);
    const body = { ...payment, amount: 20, paymentType: 'refund' }, key = crypto.randomUUID();
    const refund = await call(paymentPath, body, key);
    assert.equal(refund.body.amountPaid, 386);
    assert.deepEqual((await call(paymentPath, body, key)).body, refund.body);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id=$1 AND payment_type='refund'", [invoice.id])).rows[0].n, 1);
    for (const amount of [0, -1, 'not-a-number', true, [100], null, '0x10', '1e2', 10000000000]) assert.equal((await call(paymentPath, { amount }, crypto.randomUUID())).status, 400);
  });

  await t.test('historical ERA without a receipt is recognized without rewriting old ledger entries', async () => {
    const id = (await pool.query("INSERT INTO insurance_claims(patient_id,provider,requested_amount,paid_amount,approved_amount,era_status) VALUES($1,'Historical',1000,80,80,'received') RETURNING id", [patientId])).rows[0].id; claimIds.push(id);
    assert.equal((await call(`/insurance-claims/${id}/era`, { paidAmount: 80, approvedAmount: 80 })).status, 200);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM patient_ledger_entries WHERE claim_id=$1', [id])).rows[0].n, 0);
  });

  await t.test('ERA ledger failure rolls back both claim state and event identity', async () => {
    await pool.query(`CREATE TRIGGER ${failTrigger} BEFORE INSERT ON app.patient_ledger_entries FOR EACH ROW WHEN (NEW.patient_id = ${patientId} AND NEW.source = 'era') EXECUTE FUNCTION app.${failTrigger}()`);
    const path = `/insurance-claims/${claimId}/era`, body = { eventId: 'retry-correction', paidAmount: 70, approvedAmount: 70 };
    assert.equal((await call(path, body)).status, 500);
    assert.equal((await pool.query('SELECT paid_amount FROM insurance_claims WHERE id=$1', [claimId])).rows[0].paid_amount, '0.00');
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM financial_requests WHERE scope=$1 AND request_key='retry-correction'", [`era:${claimId}`])).rows[0].n, 0);
    await pool.query(`DROP TRIGGER ${failTrigger} ON app.patient_ledger_entries`);
    assert.equal((await call(path, body)).body.paidAmount, 70);
  });

  await t.test('visit payment retries do not append twice, including after the debt is fully paid', async () => {
    const id = (await pool.query("INSERT INTO visit_records(patient_id,doctor_id,visit_date,procedure,status) VALUES($1,$2,'2026-10-16','Exam','Zavrseno') RETURNING id", [patientId, doctorId])).rows[0].id; visitIds.push(id);
    await pool.query("INSERT INTO payments(visit_record_id,patient_id,amount,amount_paid,currency,payment_status) VALUES($1,$2,100,0,'RSD','Dugovanje')", [id, patientId]);
    const path = `/records/${id}/payment-parts`, body = { amount: 100, currency: 'RSD', paymentDate: '2026-10-16' }, key = crypto.randomUUID();
    const results = await Promise.all(Array.from({ length: 5 }, () => call(path, body, key)));
    assert.ok(results.every(result => result.status === 201), JSON.stringify(results));
    for (const result of results) assert.deepEqual(result.body, results[0].body);
    assert.equal(results[0].body.debt, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM payment_parts WHERE visit_record_id=$1', [id])).rows[0].n, 1);
    assert.equal((await call(path, { ...body, amount: 90 }, key)).status, 409);
    assert.equal((await call(path, body, crypto.randomUUID())).status, 400);
  });

  await t.test('internal financial state is protected by RLS and a unique request identity', async () => {
    const rows = (await pool.query("SELECT relname,relrowsecurity FROM pg_class WHERE oid IN ('app.financial_requests'::regclass,'app.invoice_number_counters'::regclass)")).rows;
    assert.equal(rows.length, 2); assert.ok(rows.every(row => row.relrowsecurity));
    assert.equal((await call(paymentPath, payment, 'bad key')).status, 400);
  });

  await t.test('invalid invoice and ERA input never adds a receipt or financial entry', async () => {
    const count = async () => (await pool.query('SELECT (SELECT count(*) FROM financial_requests WHERE scope=ANY($2::text[])) AS requests, (SELECT count(*) FROM patient_ledger_entries WHERE patient_id=$1) AS entries', [patientId, [`invoice-payment:${invoice.id}`, `era:${claimId}`]])).rows[0];
    const before = await count();
    for (const body of [{ paidAmount: true }, { paidAmount: [100] }, { paidAmount: null }, { paidAmount: '0x10' }, { paidAmount: 10000000000 }, {}]) {
      assert.equal((await call(`/insurance-claims/${claimId}/era`, body, crypto.randomUUID())).status, 400);
    }
    assert.equal((await call(paymentPath, { amount: 10, paymentDate: '2026-02-30' }, crypto.randomUUID())).status, 400);
    assert.equal((await call(paymentPath, { amount: 10, paymentType: 'typo' }, crypto.randomUUID())).status, 400);
    assert.deepEqual(await count(), before);
  });

  await t.test('invoice deletion and payment serialize so the retained ledger balances to zero', async () => {
    const row = await repositories[0].createInvoice({ invoice: invoiceInput, items, ledger }); invoiceIds.push(row.id);
    const [paymentResult, deletion] = await Promise.all([
      call(`/invoices/${row.id}/payments`, payment, crypto.randomUUID()),
      call(`/invoices/${row.id}`, undefined, undefined, 'DELETE')
    ]);
    assert.equal(deletion.status, 200);
    assert.ok([201, 404].includes(paymentResult.status));
    const sum = (await pool.query('SELECT COALESCE(sum(amount),0) AS balance FROM patient_ledger_entries WHERE patient_id=$1 AND description LIKE $2', [patientId, `%${row.invoice_number}`])).rows[0].balance;
    assert.equal(Number(sum), 0);
  });

  await t.test('a transaction-scoped billing repository joins the caller transaction', async () => {
    const before = (await pool.query('SELECT count(*)::int AS n FROM patient_ledger_entries WHERE patient_id=$1', [patientId])).rows[0].n;
    const client = await pool.connect();
    let id;
    try {
      await client.query('BEGIN');
      const repository = createBillingRepository({ pgPool: client, inTransaction: true });
      const row = await repository.createInvoice({ invoice: invoiceInput, items, ledger }); id = row.id;
      await repository.deleteInvoice({ invoice: row, ledger });
      assert.equal((await client.query('SELECT count(*)::int AS n FROM invoices WHERE id=$1', [id])).rows[0].n, 0);
    } finally { await client.query('ROLLBACK'); client.release(); }
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM patient_ledger_entries WHERE patient_id=$1', [patientId])).rows[0].n, before);
  });

  await t.test('decimal rounding agrees with PostgreSQL in payments, refunds, ERA and visit receipts', async () => {
    const row = await repositories[0].createInvoice({ invoice: invoiceInput, items, ledger }); invoiceIds.push(row.id);
    for (const amount of [10.075, '10.075', 1.005, '1.00499999999999999999', 8.005, 0.005]) {
      const expected = Number((await pool.query('SELECT $1::numeric(12,2) AS amount', [String(amount)])).rows[0].amount);
      for (const paymentType of ['payment', 'refund']) {
        const result = await call(`/invoices/${row.id}/payments`, { ...payment, amount, paymentType }, crypto.randomUUID());
        assert.equal(result.status, 201, JSON.stringify(result.body));
        assert.equal(result.body.payments.at(-1).amount, expected);
        const posting = (await pool.query("SELECT amount FROM patient_ledger_entries WHERE invoice_id=$1 AND source='invoice_payment' ORDER BY id DESC LIMIT 1", [row.id])).rows[0];
        assert.equal(Number(posting.amount), paymentType === 'refund' ? expected : -expected);
      }
    }
    const claim = (await pool.query("INSERT INTO insurance_claims(patient_id,provider,requested_amount) VALUES($1,'Decimal fixture',100) RETURNING id", [patientId])).rows[0]; claimIds.push(claim.id);
    const era = await call(`/insurance-claims/${claim.id}/era`, { paidAmount: 10.075, approvedAmount: 10.075 });
    assert.equal(era.status, 200); assert.equal(era.body.paidAmount, 10.08);
    assert.equal(Number((await pool.query('SELECT amount FROM patient_ledger_entries WHERE claim_id=$1', [claim.id])).rows[0].amount), -10.08);
    const visit = (await pool.query("INSERT INTO visit_records(patient_id,doctor_id,visit_date,procedure,status) VALUES($1,$2,'2026-10-23','Decimal fixture','Zavrseno') RETURNING id", [patientId, doctorId])).rows[0]; visitIds.push(visit.id);
    await pool.query("INSERT INTO payments(visit_record_id,patient_id,amount,amount_paid,currency,payment_status) VALUES($1,$2,100,0,'RSD','Dugovanje')", [visit.id, patientId]);
    const receipt = await call(`/records/${visit.id}/payment-parts`, { amount: 10.075, currency: 'RSD', paymentDate: '2026-10-23' }, crypto.randomUUID());
    assert.equal(receipt.status, 201); assert.equal(receipt.body.payments[0].amount, 10.08);
    assert.equal(Number((await pool.query('SELECT amount FROM payment_parts WHERE visit_record_id=$1', [visit.id])).rows[0].amount), 10.08);
  });
});
