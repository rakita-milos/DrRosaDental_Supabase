const {
  execute,
  insertReturningId,
  queryMany,
  queryOne,
  withTransaction
} = require('./postgres');
function createRecordsPaymentsRepository({ pgPool }) {
  if (!pgPool) throw new Error('pgPool is required for postgres records repository.');
  return createPostgresRecordsRepository(pgPool);
}

function recordsListSql() {
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
      COALESCE(pay.currency, 'EUR') as currency,
      pay.payment_status,
      vr.notes
    FROM visit_records vr
    JOIN patients p ON vr.patient_id = p.id
    JOIN doctors d ON vr.doctor_id = d.id
    LEFT JOIN payments pay ON vr.id = pay.visit_record_id
    ORDER BY vr.visit_date DESC, vr.id DESC
  `;
}

function createPostgresRecordsRepository(pool) {
  return {
    listRecords() {
      return queryMany(pool, recordsListSql());
    },

    treatmentsForRecord(visitRecordId) {
      return queryMany(pool, `
        SELECT tooth_number, treatment_type, status, notes, price, currency, discount, discount_type, discount_value
        FROM treatments
        WHERE visit_record_id = ?
      `, [visitRecordId]);
    },

    paymentPartsForRecord(visitRecordId) {
      return queryMany(pool, `
        SELECT id, amount, currency, exchange_rate_to_rsd, amount_rsd, payment_method, payment_date, notes
        FROM payment_parts
        WHERE visit_record_id = ?
        ORDER BY payment_date, id
      `, [visitRecordId]);
    },

    findRecordById(id) {
      return queryOne(pool, 'SELECT * FROM visit_records WHERE id = ?', [id]);
    },

    async rowExists(table, id) {
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
