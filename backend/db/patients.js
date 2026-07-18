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
    listPatients() {
      return queryMany(pool, `
        SELECT id, first_name, last_name, date_of_birth, gender, email, phone, address,
               emergency_contact, medical_history, created_at
        FROM patients
        ORDER BY created_at DESC
      `);
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
          (SELECT COUNT(*)::int FROM payments WHERE patient_id = ?) as payments
      `, [id, id]);
      return {
        records: Number(rows?.records || 0),
        payments: Number(rows?.payments || 0)
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
