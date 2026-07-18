const {
  execute,
  insertReturningId,
  queryMany,
  queryOne,
  withTransaction
} = require('./postgres');
function createDirectorAdminRepository({ pgPool }) {
  if (!pgPool) throw new Error('pgPool is required for postgres director admin repository.');
  return createPostgresDirectorAdminRepository(pgPool);
}

function createPostgresDirectorAdminRepository(pool) {
  return {
    procedureById(id) {
      return queryOne(pool, "SELECT * FROM codebook_items WHERE id = ? AND type = 'procedure' AND is_active = true", [id]);
    },

    procedureByName(name) {
      return queryOne(pool, `
        SELECT * FROM codebook_items
        WHERE type = 'procedure'
          AND is_active = true
          AND (lower(label) = lower(?) OR lower(value) = lower(?))
        ORDER BY sort_order, id
        LIMIT 1
      `, [name, name]);
    },

    activeCurrencyMetadata(currency) {
      return queryOne(pool, "SELECT metadata FROM codebook_items WHERE type = 'currency' AND value = ? AND is_active = true LIMIT 1", [currency]);
    },

    listCodebooks({ type = null, activeOnly = false } = {}) {
      if (type) {
        return queryMany(pool, `
          SELECT * FROM codebook_items
          WHERE type = ? ${activeOnly ? 'AND is_active = true' : ''}
          ORDER BY sort_order, label
        `, [type]);
      }
      return queryMany(pool, `
        SELECT * FROM codebook_items
        WHERE (? = false OR is_active = true)
        ORDER BY type, sort_order, label
      `, [activeOnly]);
    },

    async createCodebookItem(item) {
      const id = await insertReturningId(pool, `
        INSERT INTO codebook_items (type, value, label, group_name, metadata, price, is_active, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, codebookParams(item, { postgres: true }));
      return this.findCodebookItem(id);
    },

    findCodebookItem(id) {
      return queryOne(pool, 'SELECT * FROM codebook_items WHERE id = ?', [id]);
    },

    async updateCodebookItem(id, item) {
      await execute(pool, `
        UPDATE codebook_items
        SET type = ?, value = ?, label = ?, group_name = ?, metadata = ?, price = ?, is_active = ?, sort_order = ?, updated_at = now()
        WHERE id = ?
      `, [...codebookParams(item, { postgres: true }), id]);
      return this.findCodebookItem(id);
    },

    async procedureUsage(value) {
      const row = await queryOne(pool, 'SELECT COUNT(*)::int as count FROM visit_records WHERE procedure = ?', [value]);
      return Number(row?.count || 0);
    },

    deleteCodebookItem(id) {
      return execute(pool, 'DELETE FROM codebook_items WHERE id = ?', [id]);
    },

    activeCurrencyValues() {
      return queryMany(pool, "SELECT value FROM codebook_items WHERE type = 'currency' AND is_active = true ORDER BY sort_order, label");
    },

    activePaymentMethods() {
      return queryMany(pool, "SELECT value, metadata FROM codebook_items WHERE type = 'payment_method' AND is_active = true");
    },

    activeCashReportItems() {
      return queryMany(pool, `
        SELECT * FROM codebook_items
        WHERE type = 'cash_report_item' AND is_active = true
        ORDER BY sort_order, label
      `);
    },

    async ensureDailyCashReport({ reportDate, shift, userId }) {
      const existing = await queryOne(pool, 'SELECT * FROM daily_cash_reports WHERE report_date = ? AND shift = ?', [reportDate, shift]);
      if (existing) return existing;
      const id = await insertReturningId(pool, `
        INSERT INTO daily_cash_reports (report_date, shift, created_by, updated_by)
        VALUES (?, ?, ?, ?)
      `, [reportDate, shift, userId, userId]);
      return queryOne(pool, 'SELECT * FROM daily_cash_reports WHERE id = ?', [id]);
    },

    dailyCashReportLines(reportId) {
      return queryMany(pool, 'SELECT * FROM daily_cash_report_lines WHERE report_id = ? ORDER BY item_label, currency', [reportId]);
    },

    dailyCashAutoRows({ reportDate, shift }) {
      const params = [reportDate];
      const shiftClause = shift ? 'AND vr.shift = ?' : '';
      if (shift) params.push(shift);
      return queryMany(pool, `
        SELECT pp.amount, pp.currency, COALESCE(NULLIF(pp.payment_method, ''), 'Gotovina') AS payment_method
        FROM payment_parts pp
        JOIN visit_records vr ON vr.id = pp.visit_record_id
        WHERE vr.visit_date = ?
          ${shiftClause}
      `, params);
    },

    dailyCashDebts({ reportDate, shift }) {
      return queryMany(pool, `
        SELECT
          p.first_name || ' ' || p.last_name AS patient,
          vr.procedure,
          vr.shift,
          pay.amount AS amount,
          pay.currency AS currency
        FROM payments pay
        JOIN visit_records vr ON vr.id = pay.visit_record_id
        JOIN patients p ON p.id = pay.patient_id
        WHERE vr.visit_date = ?
          ${shift ? 'AND vr.shift = ?' : ''}
          AND COALESCE(pay.amount, 0) > 0
        ORDER BY patient, vr.procedure
      `, shift ? [reportDate, shift] : [reportDate]);
    },

    saveDailyCashReport({ reportId, lines, notes, userId }) {
      return withTransaction(pool, async (client) => {
        for (const line of lines) {
          await execute(client, `
            INSERT INTO daily_cash_report_lines (report_id, item_value, item_label, line_type, currency, amount, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(report_id, item_value, currency) DO UPDATE SET
              item_label = excluded.item_label,
              line_type = excluded.line_type,
              amount = excluded.amount,
              notes = excluded.notes,
              updated_at = now()
          `, [reportId, line.itemValue, line.itemLabel, line.lineType, line.currency, line.amount, line.notes]);
        }
        await execute(client, 'UPDATE daily_cash_reports SET notes = ?, updated_by = ?, updated_at = now() WHERE id = ?', [notes, userId, reportId]);
      });
    }
  };
}

function codebookParams(item, { postgres = false } = {}) {
  return [
    item.type,
    item.value,
    item.label,
    item.groupName,
    item.metadataJson,
    item.price,
    postgres ? Boolean(item.isActive) : item.isActive,
    item.sortOrder
  ];
}

module.exports = {
  createDirectorAdminRepository
};
