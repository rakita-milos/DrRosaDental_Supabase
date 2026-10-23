const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createPool } = require('../db/postgres');
const { assertSafeTestDatabase } = require('../../tests/playwright/utils/test-database-safety');

test('billing migration upgrades historical data and protects internal state', {
  skip: !process.env.SESSION_TEST_DATABASE_URL, timeout: 60000
}, async t => {
  const databaseUrl = process.env.SESSION_TEST_DATABASE_URL;
  assertSafeTestDatabase({ databaseUrl, env: { NODE_ENV: 'test', PLAYWRIGHT_ALLOW_DATABASE_MUTATION: '1' } });
  // Never reset the integration database: create and remove only this fixture DB.
  const name = `drrosa_migration_${crypto.randomUUID().replaceAll('-', '')}`;
  assert.match(name, /^drrosa_migration_[a-f0-9]{32}$/);
  const admin = createPool(databaseUrl);
  let created = false, fixture, client;
  t.after(async () => {
    try {
      if (client) { await client.query('ROLLBACK'); client.release(); }
      if (fixture) await fixture.end();
      if (created) await admin.query(`DROP DATABASE "${name}"`);
    } finally { await admin.end(); }
  });
  await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
  created = true;
  const target = new URL(databaseUrl); target.pathname = `/${name}`;
  fixture = createPool(target.toString()); client = await fixture.connect();
  await client.query('BEGIN');
  await client.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  END $$`);
  const dir = path.join(__dirname, '../../supabase/migrations');
  const migration = '20261015223148_billing_request_integrity.sql';
  for (const file of (await fs.readdir(dir)).filter(file => file.endsWith('.sql') && file < migration).sort()) {
    await client.query(await fs.readFile(path.join(dir, file), 'utf8'));
  }
  const patientId = (await client.query("INSERT INTO app.patients(first_name,last_name) VALUES('Synthetic','Migration') RETURNING id")).rows[0].id;
  const year = (await client.query("SELECT extract(year FROM current_timestamp AT TIME ZONE 'Europe/Belgrade')::int AS year")).rows[0].year;
  await client.query("INSERT INTO app.invoices(patient_id,invoice_number,issue_date,total) VALUES($1,$2,'2026-10-16',123.45),($1,$3,'2026-10-16',90)", [patientId, `DR-${year}-99999`, `DR-${year - 1}-00020`]);
  await client.query("INSERT INTO app.patient_ledger_entries(patient_id,entry_type,amount,currency,description,entry_date,source) VALUES($1,'charge',123.45,'RSD',$2,'2026-10-16','invoice'),($1,'adjustment',-123.45,'RSD',$3,'2026-10-16','invoice_delete')", [patientId, `Racun DR-${year}-100005`, `Storno racuna DR-${year}-100005`]);
  const history = async () => ({
    invoices: (await client.query('SELECT * FROM app.invoices ORDER BY id')).rows,
    ledger: (await client.query('SELECT * FROM app.patient_ledger_entries ORDER BY id')).rows
  });
  const before = await history();
  await client.query(await fs.readFile(path.join(dir, migration), 'utf8'));
  assert.deepEqual(await history(), before);
  assert.equal((await client.query('SELECT last_number FROM app.invoice_number_counters WHERE year=$1', [year - 1])).rows[0].last_number, '20');
  const insert = number => client.query("INSERT INTO app.invoices(patient_id,invoice_number,issue_date) VALUES($1,$2,'2026-10-16') RETURNING id,invoice_number", [patientId, number]);
  const generated = (await insert(null)).rows[0];
  assert.equal(generated.invoice_number, `DR-${year}-100006`);
  await client.query('DELETE FROM app.invoices WHERE id=$1', [generated.id]);
  assert.equal((await insert(null)).rows[0].invoice_number, `DR-${year}-100007`);
  await insert(`DR-${year}-999999`);
  assert.equal((await insert(null)).rows[0].invoice_number, `DR-${year}-1000000`);
  const counter = (await client.query('SELECT last_number FROM app.invoice_number_counters WHERE year=$1', [year])).rows[0];
  await client.query('SAVEPOINT failed_invoice');
  await insert(null);
  await client.query('ROLLBACK TO SAVEPOINT failed_invoice');
  assert.deepEqual((await client.query('SELECT last_number FROM app.invoice_number_counters WHERE year=$1', [year])).rows[0], counter);
  const access = (await client.query(`SELECT
    has_table_privilege('anon','app.financial_requests','SELECT') AS anon_read,
    has_table_privilege('authenticated','app.financial_requests','INSERT') AS client_write,
    has_table_privilege('service_role','app.financial_requests','INSERT') AS server_write`)).rows[0];
  assert.deepEqual(access, { anon_read: false, client_write: false, server_write: true });
  const rls = (await client.query("SELECT relrowsecurity FROM pg_class WHERE oid IN ('app.financial_requests'::regclass,'app.invoice_number_counters'::regclass)")).rows;
  assert.equal(rls.length, 2); assert.ok(rls.every(row => row.relrowsecurity));
});
