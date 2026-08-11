const {
  execute,
  insertReturningId,
  queryMany,
  queryOne,
  withTransaction
} = require('./postgres');
const ROW_EXISTS_TABLES = new Set(['patients']);

function createRecordsPaymentsRepository({ pgPool }) {
  if (!pgPool) throw new Error('pgPool is required for postgres records repository.');
  return createPostgresRecordsRepository(pgPool);
}

function recordsListSql({ search = '', limit = null, offset = 0 } = {}) {
  const params = [];
  let sql = `
    SELECT
      vr.id,
      vr.patient_id,
      p.first_name,
      p.last_name,
      p.first_name || ' ' || p.last_name as patient_name,
      vr.doctor_id,
      d.name as doctor_name,
      vr.visit_date,
      vr.procedure,
      vr.status,
      vr.shift,
      COALESCE(pay.amount, 0) as amount_due,
      COALESCE(pay.amount_paid, 0) as amount_paid,
      COALESCE(pay.currency, 'RSD') as currency,
      pay.payment_status,
      vr.notes
    FROM visit_records vr
    JOIN patients p ON vr.patient_id = p.id
    JOIN doctors d ON vr.doctor_id = d.id
    LEFT JOIN payments pay ON vr.id = pay.visit_record_id
  `;
  const cleanedSearch = String(search || '').trim();
  if (cleanedSearch) {
    params.push(`%${cleanedSearch}%`, `%${cleanedSearch}%`, `%${cleanedSearch}%`, `%${cleanedSearch}%`);
    sql += `
      WHERE (
        p.first_name ILIKE ?
        OR p.last_name ILIKE ?
        OR d.name ILIKE ?
        OR vr.procedure ILIKE ?
      )
    `;
  }
  sql += ' ORDER BY vr.visit_date DESC, vr.id DESC';
  if (Number.isInteger(limit) && limit > 0) {
    params.push(limit, Math.max(0, Number(offset) || 0));
    sql += ' LIMIT ? OFFSET ?';
  }
  return { sql, params };
}

function recordByIdSql() {
  return `
    SELECT
      vr.id,
      vr.patient_id,
      p.first_name,
      p.last_name,
      p.first_name || ' ' || p.last_name as patient_name,
      vr.doctor_id,
      d.name as doctor_name,
      vr.visit_date,
      vr.procedure,
      vr.status,
      vr.shift,
      COALESCE(pay.amount, 0) as amount_due,
      COALESCE(pay.amount_paid, 0) as amount_paid,
      COALESCE(pay.currency, 'RSD') as currency,
      pay.payment_status,
      vr.notes
    FROM visit_records vr
    JOIN patients p ON vr.patient_id = p.id
    JOIN doctors d ON vr.doctor_id = d.id
    LEFT JOIN payments pay ON vr.id = pay.visit_record_id
    WHERE vr.id = ?
    LIMIT 1
  `;
}

function patientPaymentHistorySql({ limit, offset }) {
  const params = [limit, offset];
  return {
    sql: `
      SELECT
        vr.id,
        vr.patient_id,
        p.first_name,
        p.last_name,
        p.first_name || ' ' || p.last_name as patient_name,
        vr.doctor_id,
        d.name as doctor_name,
        vr.visit_date,
        vr.procedure,
        vr.status,
        vr.shift,
        COALESCE(pay.amount, 0) as amount_due,
        COALESCE(pay.amount_paid, 0) as amount_paid,
        COALESCE(pay.currency, 'RSD') as currency,
        pay.payment_status,
        vr.notes
      FROM visit_records vr
      JOIN patients p ON vr.patient_id = p.id
      JOIN doctors d ON vr.doctor_id = d.id
      LEFT JOIN payments pay ON vr.id = pay.visit_record_id
      WHERE vr.patient_id = ?
      ORDER BY vr.visit_date DESC, vr.id DESC
      LIMIT ? OFFSET ?
    `,
    params
  };
}

function patientSummaryFilters(options = {}) {
  const conditions = [];
  const params = [];
  const patientConditions = [];
  const patientParams = [];
  const patientId = Number(options.patientId || 0);
  const doctor = String(options.doctor || '').trim();
  const status = String(options.status || '').trim();
  const date = String(options.date || '').trim();
  const period = String(options.period || '').trim();
  const payment = String(options.payment || '').trim();
  const procedure = String(options.procedure || '').trim();
  const procedures = Array.isArray(options.procedures) ? options.procedures.map(item => String(item || '').trim()).filter(Boolean) : [];

  if (patientId > 0) {
    patientConditions.push('p.id = ?');
    patientParams.push(patientId);
  }
  if (doctor) {
    conditions.push('d.name ILIKE ?');
    params.push(`%${doctor}%`);
  }
  if (status) {
    conditions.push('vr.status = ?');
    params.push(status);
  }
  if (date) {
    conditions.push('vr.visit_date = ?');
    params.push(date);
  }
  if (period === 'day') {
    conditions.push('vr.visit_date = CURRENT_DATE');
  } else if (period === 'week') {
    conditions.push("vr.visit_date >= CURRENT_DATE - INTERVAL '7 days'");
  } else if (period === 'month') {
    conditions.push("date_trunc('month', vr.visit_date::date) = date_trunc('month', CURRENT_DATE)");
  }
  if (payment === 'debtors') {
    conditions.push("(COALESCE(pay.amount, 0) > 0 OR lower(COALESCE(pay.payment_status, '')) IN ('dugovanje', 'delimično', 'delimicno'))");
  } else if (payment) {
    conditions.push('pay.payment_status = ?');
    params.push(payment);
  }
  if (procedure) {
    conditions.push('vr.procedure ILIKE ?');
    params.push(`%${procedure}%`);
  } else if (procedures.length) {
    conditions.push('vr.procedure = ANY(?::text[])');
    params.push(procedures);
  }

  return {
    sql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
    hasRecordFilters: conditions.length > 0,
    patientSql: patientConditions.length ? patientConditions.join(' AND ') : '',
    patientParams
  };
}

function patientSummariesSql(options = {}) {
  const filters = patientSummaryFilters(options);
  return {
    sql: `
      WITH matching_records AS (
        SELECT
          vr.id,
          vr.patient_id,
          vr.visit_date,
          vr.shift,
          COALESCE(pay.amount, 0) AS amount_due,
          COALESCE(pay.currency, 'RSD') AS currency,
          COALESCE(pay.payment_status, '') AS payment_status
        FROM visit_records vr
        JOIN doctors d ON vr.doctor_id = d.id
        LEFT JOIN payments pay ON vr.id = pay.visit_record_id
        ${filters.sql}
      ),
      debt_totals AS (
        SELECT patient_id, currency, SUM(amount_due) AS total_debt
        FROM matching_records
        WHERE amount_due > 0
        GROUP BY patient_id, currency
      )
      SELECT
        p.id AS patient_id,
        p.first_name,
        p.last_name,
        p.first_name || ' ' || p.last_name AS patient_name,
        COUNT(mr.id)::int AS visits,
        MAX(mr.visit_date) AS last_visit,
        COALESCE(BOOL_OR(mr.amount_due > 0 OR lower(mr.payment_status) IN ('dugovanje', 'delimično', 'delimicno')), false) AS has_debt,
        COALESCE((
          SELECT jsonb_object_agg(dt.currency, dt.total_debt)
          FROM debt_totals dt
          WHERE dt.patient_id = p.id
        ), '{}'::jsonb) AS total_debt,
        COALESCE(array_agg(DISTINCT mr.currency) FILTER (WHERE mr.id IS NOT NULL), ARRAY[]::text[]) AS currencies,
        COALESCE(array_agg(DISTINCT mr.shift) FILTER (WHERE mr.id IS NOT NULL AND mr.shift IS NOT NULL), ARRAY[]::text[]) AS shifts
      FROM patients p
      LEFT JOIN matching_records mr ON mr.patient_id = p.id
      ${filters.patientSql || filters.hasRecordFilters ? `WHERE ${[
        filters.patientSql,
        filters.hasRecordFilters ? 'mr.id IS NOT NULL' : ''
      ].filter(Boolean).join(' AND ')}` : ''}
      GROUP BY p.id, p.first_name, p.last_name
      ORDER BY patient_name
    `,
    params: [...filters.params, ...filters.patientParams]
  };
}

function createPostgresRecordsRepository(pool) {
  return {
    listRecords(options = {}) {
      const { sql, params } = recordsListSql(options);
      return queryMany(pool, sql, params);
    },

    recordByIdForList(id) {
      return queryOne(pool, recordByIdSql(), [id]);
    },

    patientPaymentHistoryRecords(patientId, { limit, offset }) {
      const { sql, params } = patientPaymentHistorySql({ limit, offset });
      return queryMany(pool, sql, [patientId, ...params]);
    },

    patientSummaries(options = {}) {
      const { sql, params } = patientSummariesSql(options);
      return queryMany(pool, sql, params);
    },

    treatmentsForRecord(visitRecordId) {
      return queryMany(pool, `
        SELECT tooth_number, treatment_type, status, notes, price, currency, discount, discount_type, discount_value
        FROM treatments
        WHERE visit_record_id = ?
      `, [visitRecordId]);
    },

    treatmentsForRecords(visitRecordIds) {
      if (!Array.isArray(visitRecordIds) || visitRecordIds.length === 0) return [];
      return queryMany(pool, `
        SELECT visit_record_id, tooth_number, treatment_type, status, notes, price, currency, discount, discount_type, discount_value
        FROM treatments
        WHERE visit_record_id = ANY(?::int[])
        ORDER BY visit_record_id, id
      `, [visitRecordIds]);
    },

    paymentPartsForRecord(visitRecordId) {
      return queryMany(pool, `
        SELECT id, amount, currency, exchange_rate_to_rsd, amount_rsd, payment_method, payment_date, notes
        FROM payment_parts
        WHERE visit_record_id = ?
        ORDER BY payment_date, id
      `, [visitRecordId]);
    },

    paymentPartsForRecords(visitRecordIds) {
      if (!Array.isArray(visitRecordIds) || visitRecordIds.length === 0) return [];
      return queryMany(pool, `
        SELECT id, visit_record_id, amount, currency, exchange_rate_to_rsd, amount_rsd, payment_method, payment_date, notes
        FROM payment_parts
        WHERE visit_record_id = ANY(?::int[])
        ORDER BY visit_record_id, payment_date, id
      `, [visitRecordIds]);
    },

    findRecordById(id) {
      return queryOne(pool, 'SELECT * FROM visit_records WHERE id = ?', [id]);
    },

    async rowExists(table, id) {
      if (!ROW_EXISTS_TABLES.has(table)) throw new Error('Unsupported rowExists table.');
      const row = await queryOne(pool, `SELECT id FROM ${table} WHERE id = ?`, [id]);
      return Boolean(row);
    },

    createRecord({ record, paymentSummary, paymentParts, treatments }) {
      return withTransaction(pool, async client => {
        const visitId = await insertReturningId(client, `
          INSERT INTO visit_records (patient_id, doctor_id, visit_date, procedure, status, shift, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [record.patientId, record.doctorId, record.visitDate, record.procedure, record.status, record.shift, record.notes]);
        const paymentId = await insertReturningId(client, `
          INSERT INTO payments (visit_record_id, patient_id, amount, amount_paid, currency, payment_status)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [visitId, record.patientId, paymentSummary.amountDue, paymentSummary.amountPaid, record.currency, paymentSummary.paymentStatus]);
        await replacePaymentPartsPostgres(client, { paymentId, visitRecordId: visitId, patientId: record.patientId, paymentParts });
        await insertTreatmentsPostgres(client, visitId, treatments);
        return Number(visitId);
      });
    },

    findPaymentByVisitRecordId(visitRecordId) {
      return queryOne(pool, 'SELECT * FROM payments WHERE visit_record_id = ?', [visitRecordId]);
    },

    updateRecord({ id, procedure, status, shift, notes }) {
      return execute(pool, `
        UPDATE visit_records
        SET procedure = ?, status = ?, shift = ?, notes = ?, updated_at = now()
        WHERE id = ?
      `, [procedure, status, shift, notes, id]);
    },

    async replaceTreatments(visitRecordId, treatments) {
      await execute(pool, 'DELETE FROM treatments WHERE visit_record_id = ?', [visitRecordId]);
      await insertTreatmentsPostgres(pool, visitRecordId, treatments);
    },

    async upsertPayment({ visitRecordId, patientId, payment, paymentSummary, paymentParts, currency }) {
      if (!payment) {
        const paymentId = await insertReturningId(pool, `
          INSERT INTO payments (visit_record_id, patient_id, amount, amount_paid, currency, payment_status)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [visitRecordId, patientId, paymentSummary.amountDue, paymentSummary.amountPaid, currency, paymentSummary.paymentStatus]);
        await replacePaymentPartsPostgres(pool, { paymentId, visitRecordId, patientId, paymentParts });
        return;
      }
      await execute(pool, `
        UPDATE payments
        SET amount = ?, amount_paid = ?, currency = ?, payment_status = ?
        WHERE visit_record_id = ?
      `, [paymentSummary.amountDue, paymentSummary.amountPaid, currency, paymentSummary.paymentStatus, visitRecordId]);
      await replacePaymentPartsPostgres(pool, { paymentId: payment.id, visitRecordId, patientId, paymentParts });
    },

    deleteRecord(id) {
      return execute(pool, 'DELETE FROM visit_records WHERE id = ?', [id]);
    }
  };
}

async function replacePaymentPartsPostgres(client, { paymentId, visitRecordId, patientId, paymentParts }) {
  await execute(client, 'DELETE FROM payment_parts WHERE payment_id = ?', [paymentId]);
  for (const part of paymentParts) {
    await execute(client, paymentPartInsertSql(), paymentPartParams({ paymentId, visitRecordId, patientId, part }));
  }
}

function paymentPartInsertSql() {
  return `
    INSERT INTO payment_parts (
      payment_id, visit_record_id, patient_id, amount, currency, exchange_rate_to_rsd,
      amount_rsd, payment_method, payment_date, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
}

function paymentPartParams({ paymentId, visitRecordId, patientId, part }) {
  return [
    paymentId,
    visitRecordId,
    patientId,
    part.amount,
    part.currency,
    part.exchangeRateToRsd,
    part.amountRsd,
    part.paymentMethod,
    part.paymentDate,
    part.notes
  ];
}

async function insertTreatmentsPostgres(client, visitId, treatments) {
  for (const treatment of treatments) {
    await execute(client, treatmentInsertSql(), treatmentParams(visitId, treatment));
  }
}

function treatmentInsertSql() {
  return `
    INSERT INTO treatments (visit_record_id, tooth_number, treatment_type, status, notes, price, currency, discount, discount_type, discount_value)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
}

function treatmentParams(visitId, treatment) {
  return [
    visitId,
    treatment.toothNumber,
    treatment.type,
    treatment.status,
    treatment.note,
    treatment.price,
    treatment.currency,
    treatment.discount,
    treatment.discountType,
    treatment.discountValue
  ];
}

module.exports = {
  createRecordsPaymentsRepository
};
