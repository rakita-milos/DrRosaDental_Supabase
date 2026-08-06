const {
  execute,
  insertReturningId,
  queryMany,
  queryOne
} = require('./postgres');
function createPatientsRepository({ pgPool }) {
  if (!pgPool) throw new Error('pgPool is required for postgres patients repository.');
  return createPostgresPatientsRepository(pgPool);
}

function patientInsertSql() {
  return `
    INSERT INTO patients (first_name, last_name, date_of_birth, gender, email, phone, address, emergency_contact, medical_history)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
}

function patientInsertParams(patient) {
  return [
    patient.firstName,
    patient.lastName,
    patient.dateOfBirth,
    patient.gender,
    patient.email,
    patient.phone,
    patient.address,
    patient.emergencyContact,
    patient.medicalHistory
  ];
}

function createPostgresPatientsRepository(pool) {
  return {
    listPatients({ search = '', limit = null, offset = 0 } = {}) {
      const params = [];
      let sql = `
        SELECT id, first_name, last_name, date_of_birth, gender, email, phone, address,
               emergency_contact, medical_history, created_at
        FROM patients
      `;
      const cleanedSearch = String(search || '').trim();
      if (cleanedSearch) {
        const phoneSearch = cleanedSearch.replace(/\D/g, '');
        params.push(`%${cleanedSearch}%`, `%${cleanedSearch}%`, `%${cleanedSearch}%`, phoneSearch, `%${phoneSearch}%`);
        sql += `
          WHERE (
            first_name ILIKE ?
            OR last_name ILIKE ?
            OR email ILIKE ?
            OR (?::text <> '' AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') ILIKE ?)
          )
        `;
      }
      sql += ' ORDER BY created_at DESC';
      if (Number.isInteger(limit) && limit > 0) {
        params.push(limit, Math.max(0, Number(offset) || 0));
        sql += ' LIMIT ? OFFSET ?';
      }
      return queryMany(pool, sql, params);
    },

    findPatientById(id) {
      return queryOne(pool, 'SELECT * FROM patients WHERE id = ?', [id]);
    },

    async createPatient(patient) {
      const id = await insertReturningId(pool, patientInsertSql(), patientInsertParams(patient));
      return queryOne(pool, `
        SELECT id, first_name, last_name, email, phone, created_at
        FROM patients
        WHERE id = ?
      `, [id]);
    },

    findDuplicatePatient(patient, excludeId = null) {
      return queryOne(pool, `
        SELECT id, first_name, last_name, date_of_birth, email, phone
        FROM patients
        WHERE lower(btrim(first_name)) = lower(btrim(?))
          AND lower(btrim(last_name)) = lower(btrim(?))
          AND (?::integer IS NULL OR id <> ?::integer)
          AND (
            (?::text IS NOT NULL AND date_of_birth = NULLIF(?::text, '')::date)
            OR (?::text <> '' AND lower(btrim(COALESCE(email, ''))) = lower(btrim(?::text)))
            OR (?::text <> '' AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = regexp_replace(?::text, '\\D', '', 'g'))
            OR (?::text IS NULL AND ?::text = '' AND ?::text = '')
          )
        LIMIT 1
      `, [
        patient.firstName,
        patient.lastName,
        excludeId,
        excludeId,
        patient.dateOfBirth,
        patient.dateOfBirth,
        patient.email || '',
        patient.email || '',
        patient.phone || '',
        patient.phone || '',
        patient.dateOfBirth,
        patient.email || '',
        patient.phone || ''
      ]);
    },

    async updatePatient(id, patient) {
      await execute(pool, `
        UPDATE patients
        SET first_name = ?,
            last_name = ?,
            date_of_birth = ?,
            gender = ?,
            email = ?,
            phone = ?,
            address = ?,
            emergency_contact = ?,
            medical_history = ?,
            updated_at = now()
        WHERE id = ?
      `, [
        patient.firstName,
        patient.lastName,
        patient.dateOfBirth,
        patient.gender,
        patient.email,
        patient.phone,
        patient.address,
        patient.emergencyContact,
        patient.medicalHistory,
        id
      ]);
      return this.findPatientById(id);
    },

    async patientDeleteCounts(id) {
      const rows = await queryOne(pool, `
        SELECT
          (SELECT COUNT(*)::int FROM visit_records WHERE patient_id = ?) as records,
          (SELECT COUNT(*)::int FROM appointments WHERE patient_id = ?) as appointments,
          (SELECT COUNT(*)::int FROM payments WHERE patient_id = ?) as payments,
          (SELECT COUNT(*)::int FROM payment_parts WHERE patient_id = ?) as payment_parts,
          (SELECT COUNT(*)::int FROM patient_documents WHERE patient_id = ? AND is_deleted = false) as documents,
          (SELECT COUNT(*)::int FROM patient_medical_profiles WHERE patient_id = ?) as medical_profiles,
          (SELECT COUNT(*)::int FROM public_booking_requests WHERE patient_id = ?) as public_booking_requests,
          (SELECT COUNT(*)::int FROM treatment_plans WHERE patient_id = ?) as treatment_plans,
          (SELECT COUNT(*)::int FROM perio_charts WHERE patient_id = ?) as perio_charts,
          (SELECT COUNT(*)::int FROM clinical_chart_entries WHERE patient_id = ?) as clinical_chart_entries,
          (SELECT COUNT(*)::int FROM clinical_notes WHERE patient_id = ?) as clinical_notes,
          (SELECT COUNT(*)::int FROM patient_consents WHERE patient_id = ?) as patient_consents,
          (SELECT COUNT(*)::int FROM invoices WHERE patient_id = ?) as invoices,
          (SELECT COUNT(*)::int FROM insurance_claims WHERE patient_id = ?) as insurance_claims,
          (SELECT COUNT(*)::int FROM patient_ledger_entries WHERE patient_id = ?) as ledger_entries
      `, [id, id, id, id, id, id, id, id, id, id, id, id, id, id, id]);
      return {
        records: Number(rows?.records || 0),
        appointments: Number(rows?.appointments || 0),
        payments: Number(rows?.payments || 0),
        paymentParts: Number(rows?.payment_parts || 0),
        documents: Number(rows?.documents || 0),
        medicalProfiles: Number(rows?.medical_profiles || 0),
        publicBookingRequests: Number(rows?.public_booking_requests || 0),
        treatmentPlans: Number(rows?.treatment_plans || 0),
        perioCharts: Number(rows?.perio_charts || 0),
        clinicalChartEntries: Number(rows?.clinical_chart_entries || 0),
        clinicalNotes: Number(rows?.clinical_notes || 0),
        patientConsents: Number(rows?.patient_consents || 0),
        invoices: Number(rows?.invoices || 0),
        insuranceClaims: Number(rows?.insurance_claims || 0),
        ledgerEntries: Number(rows?.ledger_entries || 0)
      };
    },

    deletePatient(id) {
      return execute(pool, 'DELETE FROM patients WHERE id = ?', [id]);
    },

    getMedicalProfile(patientId) {
      return queryOne(pool, 'SELECT * FROM patient_medical_profiles WHERE patient_id = ?', [patientId]);
    },

    async upsertMedicalProfile(patientId, profile) {
      await execute(pool, `
        INSERT INTO patient_medical_profiles (
          patient_id, blood_type, allergies, medications, chronic_conditions, contraindications,
          previous_surgeries, pregnancy_status, smoker, diabetes, high_blood_pressure,
          heart_condition, anesthesia_warning, dental_notes, internal_notes, updated_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(patient_id) DO UPDATE SET
          blood_type = excluded.blood_type,
          allergies = excluded.allergies,
          medications = excluded.medications,
          chronic_conditions = excluded.chronic_conditions,
          contraindications = excluded.contraindications,
          previous_surgeries = excluded.previous_surgeries,
          pregnancy_status = excluded.pregnancy_status,
          smoker = excluded.smoker,
          diabetes = excluded.diabetes,
          high_blood_pressure = excluded.high_blood_pressure,
          heart_condition = excluded.heart_condition,
          anesthesia_warning = excluded.anesthesia_warning,
          dental_notes = excluded.dental_notes,
          internal_notes = excluded.internal_notes,
          updated_by = excluded.updated_by,
          updated_at = now()
      `, [patientId, ...medicalProfileParams(profile)]);
      return this.getMedicalProfile(patientId);
    }
  };
}

function medicalProfileParams(profile) {
  return [
    profile.bloodType,
    profile.allergies,
    profile.medications,
    profile.chronicConditions,
    profile.contraindications,
    profile.previousSurgeries,
    profile.pregnancyStatus,
    profile.smoker,
    profile.diabetes,
    profile.highBloodPressure,
    profile.heartCondition,
    profile.anesthesiaWarning,
    profile.dentalNotes,
    profile.internalNotes,
    profile.updatedBy
  ];
}

module.exports = {
  createPatientsRepository
};
