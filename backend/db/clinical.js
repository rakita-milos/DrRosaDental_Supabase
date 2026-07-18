const {
  execute,
  insertReturningId,
  queryMany,
  queryOne,
  withTransaction
} = require('./postgres');
function createClinicalRepository({ pgPool }) {
  if (!pgPool) throw new Error('pgPool is required for postgres clinical repository.');
  return createPostgresClinicalRepository(pgPool);
}

function createPostgresClinicalRepository(pool) {
  return {
    treatmentPlansByPatient(patientId) {
      return queryMany(pool, 'SELECT * FROM treatment_plans WHERE patient_id = ? ORDER BY created_at DESC', [patientId]);
    },
    treatmentPlanItems(planId) {
      return queryMany(pool, 'SELECT * FROM treatment_plan_items WHERE plan_id = ? ORDER BY phase, sort_order, id', [planId]);
    },
    findTreatmentPlan(id) {
      return queryOne(pool, 'SELECT * FROM treatment_plans WHERE id = ?', [id]);
    },
    async createTreatmentPlan(plan, items) {
      return withTransaction(pool, async (client) => {
        const id = await insertReturningId(client, `
          INSERT INTO treatment_plans (patient_id, title, status, currency, discount, notes, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [plan.patientId, plan.title, plan.status, plan.currency, plan.discount, plan.notes, plan.createdBy]);
        await replaceTreatmentPlanItemsPostgres(client, id, items);
        return queryOne(client, 'SELECT * FROM treatment_plans WHERE id = ?', [id]);
      });
    },
    async updateTreatmentPlan(id, plan, items) {
      return withTransaction(pool, async (client) => {
        await execute(client, `
          UPDATE treatment_plans
          SET title = ?, status = ?, currency = ?, discount = ?, notes = ?, updated_at = now()
          WHERE id = ?
        `, [plan.title, plan.status, plan.currency, plan.discount, plan.notes, id]);
        await replaceTreatmentPlanItemsPostgres(client, id, items);
        return queryOne(client, 'SELECT * FROM treatment_plans WHERE id = ?', [id]);
      });
    },
    async acceptTreatmentPlan(id, signature) {
      await execute(pool, `
        UPDATE treatment_plans
        SET status = 'accepted', accepted_at = now(), signature_name = ?, signature_data = ?, updated_at = now()
        WHERE id = ?
      `, [signature.name, signature.data, id]);
      return this.findTreatmentPlan(id);
    },
    deleteTreatmentPlan(id) {
      return execute(pool, 'DELETE FROM treatment_plans WHERE id = ?', [id]);
    },

    clinicalChartByPatient(patientId) {
      return queryMany(pool, 'SELECT * FROM clinical_chart_entries WHERE patient_id = ? ORDER BY tooth_number, phase, created_at DESC', [patientId]);
    },
    findClinicalChart(id) {
      return queryOne(pool, 'SELECT * FROM clinical_chart_entries WHERE id = ?', [id]);
    },
    async createClinicalChart(entry) {
      const id = await insertReturningId(pool, `
        INSERT INTO clinical_chart_entries (
          patient_id, visit_record_id, tooth_number, surfaces, cdt_code, ada_code, diagnosis,
          procedure_code, entry_type, status, phase, price, currency, price_rsd, exchange_rate_to_rsd, provider_id, notes, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [...clinicalChartParams(entry), entry.createdBy]);
      return this.findClinicalChart(id);
    },
    async updateClinicalChart(id, entry) {
      await execute(pool, `
        UPDATE clinical_chart_entries
        SET tooth_number = ?, surfaces = ?, cdt_code = ?, ada_code = ?, diagnosis = ?,
            procedure_code = ?, entry_type = ?, status = ?, phase = ?, price = ?, currency = ?, price_rsd = ?,
            exchange_rate_to_rsd = ?, provider_id = ?, notes = ?, updated_at = now()
        WHERE id = ?
      `, [...clinicalChartUpdateParams(entry), id]);
      return this.findClinicalChart(id);
    },
    deleteClinicalChart(id) {
      return execute(pool, 'DELETE FROM clinical_chart_entries WHERE id = ?', [id]);
    },

    clinicalNoteTemplates() {
      return queryMany(pool, 'SELECT * FROM clinical_note_templates WHERE is_active = true ORDER BY category, title');
    },
    async createClinicalNoteTemplate(template) {
      const id = await insertReturningId(pool, 'INSERT INTO clinical_note_templates (title, category, body) VALUES (?, ?, ?)', [template.title, template.category, template.body]);
      return queryOne(pool, 'SELECT * FROM clinical_note_templates WHERE id = ?', [id]);
    },
    clinicalNotesByPatient(patientId) {
      return queryMany(pool, 'SELECT * FROM clinical_notes WHERE patient_id = ? ORDER BY created_at DESC, id DESC', [patientId]);
    },
    findClinicalNote(id) {
      return queryOne(pool, 'SELECT * FROM clinical_notes WHERE id = ?', [id]);
    },
    async createClinicalNote(note) {
      const id = await insertReturningId(pool, `
        INSERT INTO clinical_notes (
          patient_id, visit_record_id, template_id, title, body, signed_by, signed_at, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [note.patientId, note.visitRecordId, note.templateId, note.title, note.body, note.signedBy, note.signedAt, note.createdBy]);
      return this.findClinicalNote(id);
    },
    async updateClinicalNote(id, note) {
      await execute(pool, `
        UPDATE clinical_notes
        SET visit_record_id = ?, template_id = ?, title = ?, body = ?, signed_by = ?, signed_at = ?, updated_at = now()
        WHERE id = ?
      `, [note.visitRecordId, note.templateId, note.title, note.body, note.signedBy, note.signedAt, id]);
      return this.findClinicalNote(id);
    },
    deleteClinicalNote(id) {
      return execute(pool, 'DELETE FROM clinical_notes WHERE id = ?', [id]);
    },
    async signClinicalNote(id, signedBy) {
      await execute(pool, 'UPDATE clinical_notes SET signed_by = ?, signed_at = now(), updated_at = now() WHERE id = ?', [signedBy, id]);
      return this.findClinicalNote(id);
    },

    consentsByPatient(patientId) {
      return queryMany(pool, 'SELECT * FROM patient_consents WHERE patient_id = ? ORDER BY signed_at DESC, id DESC', [patientId]);
    },
    findConsent(id) {
      return queryOne(pool, 'SELECT * FROM patient_consents WHERE id = ?', [id]);
    },
    async createConsent(consent) {
      const id = await insertReturningId(pool, `
        INSERT INTO patient_consents (
          patient_id, treatment_plan_id, consent_type, title, body, signer_name, signature_data, signed_at, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [consent.patientId, consent.treatmentPlanId, consent.consentType, consent.title, consent.body, consent.signerName, consent.signatureData, consent.signedAt, consent.createdBy]);
      return this.findConsent(id);
    },
    async updateConsent(id, consent) {
      await execute(pool, `
        UPDATE patient_consents
        SET treatment_plan_id = ?, consent_type = ?, title = ?, body = ?, signer_name = ?,
            signature_data = ?, signed_at = ?, updated_at = now()
        WHERE id = ?
      `, [consent.treatmentPlanId, consent.consentType, consent.title, consent.body, consent.signerName, consent.signatureData, consent.signedAt, id]);
      return this.findConsent(id);
    },
    deleteConsent(id) {
      return execute(pool, 'DELETE FROM patient_consents WHERE id = ?', [id]);
    },

    perioChartsByPatient(patientId) {
      return queryMany(pool, 'SELECT * FROM perio_charts WHERE patient_id = ? ORDER BY chart_date DESC, id DESC', [patientId]);
    },
    perioMeasurements(chartId) {
      return queryMany(pool, 'SELECT * FROM perio_measurements WHERE chart_id = ? ORDER BY tooth_number, site', [chartId]);
    },
    findPerioChart(id) {
      return queryOne(pool, 'SELECT * FROM perio_charts WHERE id = ?', [id]);
    },
    async createPerioChart(chart, measurements) {
      return withTransaction(pool, async (client) => {
        const id = await insertReturningId(client, 'INSERT INTO perio_charts (patient_id, chart_date, notes, created_by) VALUES (?, ?, ?, ?)', [chart.patientId, chart.chartDate, chart.notes, chart.createdBy]);
        for (const measurement of measurements) {
          await execute(client, `
            INSERT INTO perio_measurements (chart_id, tooth_number, site, pocket_depth, bleeding, gingival_margin, recession, mobility, furcation, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, perioMeasurementParams(id, measurement, { postgres: true }));
        }
        return queryOne(client, 'SELECT * FROM perio_charts WHERE id = ?', [id]);
      });
    },
    deletePerioChart(id) {
      return execute(pool, 'DELETE FROM perio_charts WHERE id = ?', [id]);
    }
  };
}

async function replaceTreatmentPlanItemsPostgres(client, planId, items) {
  await execute(client, 'DELETE FROM treatment_plan_items WHERE plan_id = ?', [planId]);
  for (const item of items) {
    await execute(client, `
      INSERT INTO treatment_plan_items (plan_id, phase, tooth_number, procedure_name, description, quantity, unit_price, discount, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, treatmentPlanItemParams(planId, item));
  }
}

function treatmentPlanItemParams(planId, item) {
  return [planId, item.phase, item.toothNumber, item.procedureName, item.description, item.quantity, item.unitPrice, item.discount, item.sortOrder];
}

function clinicalChartParams(entry) {
  return [
    entry.patientId,
    entry.visitRecordId,
    entry.toothNumber,
    entry.surfacesJson,
    entry.cdtCode,
    entry.adaCode,
    entry.diagnosis,
    entry.procedureCode,
    entry.entryType,
    entry.status,
    entry.phase,
    entry.price,
    entry.currency,
    entry.priceRsd,
    entry.exchangeRateToRsd,
    entry.providerId,
    entry.notes
  ];
}

function clinicalChartUpdateParams(entry) {
  return clinicalChartParams(entry).slice(2);
}

function perioMeasurementParams(chartId, measurement, { postgres = false } = {}) {
  return [
    chartId,
    measurement.toothNumber,
    measurement.site,
    measurement.pocketDepth,
    postgres ? Boolean(measurement.bleeding) : measurement.bleeding,
    measurement.gingivalMargin,
    measurement.recession,
    measurement.mobility,
    measurement.furcation,
    measurement.notes
  ];
}

module.exports = {
  createClinicalRepository
};
