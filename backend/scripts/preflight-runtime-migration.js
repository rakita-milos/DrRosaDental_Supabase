require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { createPool } = require('../db/postgres');

const checks = [
  {
    name: 'duplicate Google Calendar event IDs',
    sql: `SELECT google_event_id, COUNT(*)::int AS count
          FROM appointments
          WHERE google_event_id IS NOT NULL
          GROUP BY google_event_id
          HAVING COUNT(*) > 1`
  },
  {
    name: 'documents linked to another patient visit',
    sql: `SELECT d.id, d.patient_id, d.visit_record_id
          FROM patient_documents d
          LEFT JOIN visit_records v ON v.id = d.visit_record_id
          WHERE d.visit_record_id IS NOT NULL AND (v.id IS NULL OR v.patient_id <> d.patient_id)`
  },
  {
    name: 'invoices linked to another patient visit',
    sql: `SELECT i.id, i.patient_id, i.visit_record_id
          FROM invoices i
          LEFT JOIN visit_records v ON v.id = i.visit_record_id
          WHERE i.visit_record_id IS NOT NULL AND (v.id IS NULL OR v.patient_id <> i.patient_id)`
  },
  {
    name: 'claims linked to another patient visit',
    sql: `SELECT c.id, c.patient_id, c.visit_record_id
          FROM insurance_claims c
          LEFT JOIN visit_records v ON v.id = c.visit_record_id
          WHERE c.visit_record_id IS NOT NULL AND (v.id IS NULL OR v.patient_id <> c.patient_id)`
  },
  {
    name: 'claims linked to another patient invoice',
    sql: `SELECT c.id, c.patient_id, c.invoice_id
          FROM insurance_claims c
          LEFT JOIN invoices i ON i.id = c.invoice_id
          WHERE c.invoice_id IS NOT NULL AND (i.id IS NULL OR i.patient_id <> c.patient_id)`
  }
];

const legacyDocumentsCheck = {
  name: 'legacy local document references requiring Storage migration',
  sql: `SELECT id, patient_id, file_path, file_size, file_hash
        FROM patient_documents
        WHERE is_deleted = false AND file_path NOT LIKE 'supabase:%'`
};

async function runPreflight(pool) {
  const failures = [];
  for (const check of checks) {
    const { rows } = await pool.query(check.sql);
    if (rows.length) failures.push({ ...check, rows });
  }
  const { rows: legacyDocuments } = await pool.query(legacyDocumentsCheck.sql);
  return { failures, legacyDocuments };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to the database being reviewed. This command is read-only.');
  const pool = createPool();
  try {
    const { failures, legacyDocuments } = await runPreflight(pool);
    for (const failure of failures) console.error(`FAIL: ${failure.name} (${failure.rows.length})`, failure.rows.slice(0, 20));
    if (legacyDocuments.length) console.warn(`ACTION REQUIRED: ${legacyDocuments.length} legacy local document references require a verified Storage migration before enabling Supabase document storage.`, legacyDocuments.slice(0, 20));
    if (failures.length) process.exitCode = 1;
    else console.log('Schema integrity preflight passed.');
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { checks, legacyDocumentsCheck, runPreflight };
