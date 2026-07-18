const { queryMany, queryOne } = require('./postgres');
const LEGAL_EXPORT_TABLES = new Set([
  'patients',
  'visit_records',
  'patient_documents',
  'invoices',
  'insurance_claims',
  'clinical_chart_entries',
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

function createPostgresDirectorReportsRepository(pool) {
  return {
    legalExportRows(table, limit) {
      assertLegalTable(table);
      return queryMany(pool, `SELECT * FROM ${table} ORDER BY id LIMIT ?`, [limit]);
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
      return queryOne(pool, `
        SELECT
          (SELECT COUNT(*)::int FROM patients) as total_patients,
          COALESCE(SUM(CASE WHEN payment_status IN ('Plaćeno', 'Plaćeno') THEN amount ELSE 0 END), 0) as total_revenue,
          COALESCE(SUM(CASE WHEN payment_status IN ('Dugovanje', 'Delimično', 'Delimično') THEN amount ELSE 0 END), 0) as total_debt,
          (SELECT COUNT(*)::int FROM visit_records) as total_visits,
          COALESCE(AVG(CASE WHEN payment_status IN ('Plaćeno', 'Plaćeno') THEN 1.0 ELSE 0.0 END) * 100, 0) as payment_percentage
        FROM payments
      `);
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

    async proceduresReport() {
      const total = await queryOne(pool, 'SELECT COUNT(*)::int as count FROM visit_records');
      const rows = await queryMany(pool, `
        SELECT
          vr.procedure,
          COUNT(*)::int as count,
          AVG(COALESCE(pay.amount, 0)) as avg_cost
        FROM visit_records vr
        LEFT JOIN payments pay ON vr.id = pay.visit_record_id
        GROUP BY vr.procedure
        ORDER BY count DESC
      `);
      return { totalVisits: Number(total?.count || 0), rows };
    },

    doctors() {
      return queryMany(pool, 'SELECT id, name, specialization, email, phone FROM doctors ORDER BY name');
    }
  };
}

module.exports = {
  createDirectorReportsRepository
};
