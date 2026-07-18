const {
  execute,
  insertReturningId,
  queryMany,
  queryOne
} = require('./postgres');
function createPatientDocumentsRepository({ pgPool }) {
  if (!pgPool) throw new Error('pgPool is required for postgres patient documents repository.');
  return createPostgresPatientDocumentsRepository(pgPool);
}

function insertDocumentSql() {
  return `
    INSERT INTO patient_documents (
      patient_id, visit_record_id, document_type, title, description, document_date,
      original_filename, stored_filename, file_path, mime_type, file_size, file_hash, source, uploaded_by,
      imaging_modality, tooth_number, acquisition_date, dicom_study_uid, claim_attachment_ready
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
}

function documentParams(document, { postgres = false } = {}) {
  return [
    document.patientId,
    document.visitRecordId,
    document.documentType,
    document.title,
    document.description,
    document.documentDate,
    document.originalFilename,
    document.storedFilename,
    document.filePath,
    document.mimeType,
    document.fileSize,
    document.fileHash,
    document.source,
    document.uploadedBy,
    document.imagingModality,
    document.toothNumber,
    document.acquisitionDate,
    document.dicomStudyUid,
    postgres ? Boolean(document.claimAttachmentReady) : document.claimAttachmentReady
  ];
}

function createPostgresPatientDocumentsRepository(pool) {
  return {
    listByPatient(patientId) {
      return queryMany(pool, `
        SELECT * FROM patient_documents
        WHERE patient_id = ? AND is_deleted = false
        ORDER BY created_at DESC, id DESC
      `, [patientId]);
    },

    async createDocument(document) {
      const id = await insertReturningId(pool, insertDocumentSql(), documentParams(document, { postgres: true }));
      return this.findById(id);
    },

    findActiveById(id) {
      return queryOne(pool, 'SELECT * FROM patient_documents WHERE id = ? AND is_deleted = false', [id]);
    },

    findById(id) {
      return queryOne(pool, 'SELECT * FROM patient_documents WHERE id = ?', [id]);
    },

    softDelete(id) {
      return execute(pool, 'UPDATE patient_documents SET is_deleted = true, updated_at = now() WHERE id = ?', [id]);
    },

    async updateDocument(id, document) {
      await execute(pool, `
        UPDATE patient_documents
        SET visit_record_id = ?, document_type = ?, title = ?, description = ?, document_date = ?,
            imaging_modality = ?, tooth_number = ?, acquisition_date = ?, dicom_study_uid = ?,
            claim_attachment_ready = ?, updated_at = now()
        WHERE id = ?
      `, [...documentUpdateParams(document, { postgres: true }), id]);
      return this.findById(id);
    },

    listImagingByPatient(patientId) {
      return queryMany(pool, `
        SELECT * FROM patient_documents
        WHERE patient_id = ?
          AND is_deleted = false
          AND (document_type IN ('rtg', 'ortopan', 'photo') OR imaging_modality IS NOT NULL OR dicom_study_uid IS NOT NULL)
        ORDER BY COALESCE(acquisition_date, document_date, created_at::date) DESC, id DESC
      `, [patientId]);
    },

    async updateImaging(id, document) {
      await execute(pool, `
        UPDATE patient_documents
        SET imaging_modality = ?, tooth_number = ?, acquisition_date = ?, dicom_study_uid = ?,
            claim_attachment_ready = ?, updated_at = now()
        WHERE id = ?
      `, [...imagingUpdateParams(document, { postgres: true }), id]);
      return this.findById(id);
    },

    async saveAiFindings(id, findingsJson) {
      await execute(pool, `
        UPDATE patient_documents
        SET ai_findings = ?, claim_attachment_ready = true, updated_at = now()
        WHERE id = ?
      `, [findingsJson, id]);
      return this.findById(id);
    }
  };
}

function documentUpdateParams(document, { postgres = false } = {}) {
  return [
    document.visitRecordId,
    document.documentType,
    document.title,
    document.description,
    document.documentDate,
    document.imagingModality,
    document.toothNumber,
    document.acquisitionDate,
    document.dicomStudyUid,
    postgres ? Boolean(document.claimAttachmentReady) : document.claimAttachmentReady
  ];
}

function imagingUpdateParams(document, { postgres = false } = {}) {
  return [
    document.imagingModality,
    document.toothNumber,
    document.acquisitionDate,
    document.dicomStudyUid,
    postgres ? Boolean(document.claimAttachmentReady) : document.claimAttachmentReady
  ];
}

module.exports = {
  createPatientDocumentsRepository
};
