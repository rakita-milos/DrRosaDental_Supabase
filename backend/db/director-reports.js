const { queryMany, queryOne } = require('./postgres');
const LEGAL_EXPORT_TABLES = new Set([
  'patients',
  'visit_records',
  'patient_documents',
  'invoices',
  'insurance_claims',
  'clinical_chart_entries',
  'tooth_state_events',
  'clinical_notes',
  'patient_consents'
]);

function createDirectorReportsRepository({ pgPool }) {
  if (!pgPool) throw new Error('pgPool is required for postgres director reports repository.');
  return createPostgresDirectorReportsRepository(pgPool);
}

function assertLegalTable(table) {
  if (!LEGAL_EXPORT_TABLES.has(table)) {
    throw new Error(`Illegal export table: ${table}`);
  }
}

// One statement gives balances, receipts and currency metadata from the same
// PostgreSQL snapshot. Aggregate parts before joining so split payments do not
// multiply visit counts or outstanding balances.
function readFinancialSnapshot(pool) {
  return queryOne(pool, `
    WITH receipt_parts AS (
      SELECT payment_id, jsonb_agg(jsonb_build_object(
        'amount', amount, 'currency', currency, 'amount_rsd', amount_rsd,
        'exchange_rate_to_rsd', exchange_rate_to_rsd
      ) ORDER BY payment_date, id) AS parts
      FROM payment_parts GROUP BY payment_id
    ), report_records AS (
      SELECT vr.id AS visit_id, p.id AS patient_id,
        p.first_name || ' ' || p.last_name AS patient_name, vr.procedure,
        COALESCE(pay.amount, 0) AS amount_due,
        COALESCE(pay.amount_paid, 0) AS amount_paid,
        COALESCE(pay.currency, 'RSD') AS currency,
        COALESCE(rp.parts, '[]'::jsonb) AS payment_parts
      FROM visit_records vr
      JOIN patients p ON p.id = vr.patient_id
      LEFT JOIN payments pay ON pay.visit_record_id = vr.id
      LEFT JOIN receipt_parts rp ON rp.payment_id = pay.id
    )
    SELECT (SELECT COUNT(*)::int FROM patients) AS total_patients,
      COALESCE((SELECT jsonb_agg(r ORDER BY visit_id) FROM report_records r), '[]'::jsonb) AS records,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('value', value, 'metadata', metadata) ORDER BY id)
        FROM codebook_items WHERE type = 'currency' AND is_active = true), '[]'::jsonb) AS currencies
  `);
}

function createPostgresDirectorReportsRepository(pool) {
  return {
    legalExportRows(table, limit) {
      assertLegalTable(table);
      const columns = table === 'tooth_state_events' ? '*, effective_date::text AS effective_date' : '*';
      return queryMany(pool, `SELECT ${columns} FROM ${table} ORDER BY id LIMIT ?`, [limit]);
    },

    async legalExportCount(table) {
      assertLegalTable(table);
      const row = await queryOne(pool, `SELECT COUNT(*)::int as count FROM ${table}`);
      return Number(row?.count || 0);
    },

    restoreTests(limit = 20) {
      return queryMany(pool, 'SELECT * FROM backup_restore_tests ORDER BY checked_at DESC, id DESC LIMIT ?', [limit]);
    },

    financialReport() {
      return readFinancialSnapshot(pool);
    },

    patientsReport() {
      return queryOne(pool, `
        SELECT
          COUNT(*)::int as total_patients,
          SUM(CASE WHEN visit_count > 1 THEN 1 ELSE 0 END)::int as regular_patients,
          SUM(CASE WHEN visit_count <= 1 THEN 1 ELSE 0 END)::int as new_patients
        FROM (
          SELECT p.id, COUNT(vr.id) as visit_count
          FROM patients p
          LEFT JOIN visit_records vr ON p.id = vr.patient_id
          GROUP BY p.id
        ) patient_visits
      `);
    },

    async doctorsReport() {
      const total = await queryOne(pool, 'SELECT COUNT(*)::int as count FROM visit_records');
      const rows = await queryMany(pool, `
        SELECT d.id, d.name, COUNT(vr.id)::int as visit_count, COUNT(DISTINCT vr.patient_id)::int as patient_count
        FROM doctors d
        LEFT JOIN visit_records vr ON d.id = vr.doctor_id
        GROUP BY d.id, d.name
        ORDER BY visit_count DESC
      `);
      return { totalVisits: Number(total?.count || 0), rows };
    },

    proceduresReport() {
      return readFinancialSnapshot(pool);
    },

    doctors({ activeOnly = true } = {}) {
      return queryMany(pool, `
        SELECT id, name, specialization, license_number, email, phone, is_active,
               google_color_id, calendar_color, calendar_text_color
        FROM doctors
        WHERE (? = false OR is_active = true)
        ORDER BY name
      `, [activeOnly]);
    }
  };
}

module.exports = {
  createDirectorReportsRepository
};
