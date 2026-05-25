const Joi = require('joi');

const ALLOWED_DOCUMENT_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp'
];

function validateBody(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });
    if (error) {
      return res.status(400).json({
        error: error.details.map(detail => detail.message).join(', ')
      });
    }
    req.body = value;
    next();
  };
}

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(12).required(),
  role: Joi.string().valid('director', 'staff').optional(),
  twoFactorCode: Joi.string().pattern(/^\d{6}$/).optional().allow('', null)
});

const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().min(12).required(),
  newPassword: Joi.string().min(12).required()
});

const patientCreateSchema = Joi.object({
  first_name: Joi.string().max(80).required(),
  last_name: Joi.string().max(80).required(),
  date_of_birth: Joi.string().max(20).allow('', null),
  gender: Joi.string().max(30).allow('', null),
  email: Joi.string().email().allow('', null),
  phone: Joi.string().max(50).allow('', null),
  address: Joi.string().max(255).allow('', null),
  emergency_contact: Joi.string().max(255).allow('', null),
  medical_history: Joi.string().max(2000).allow('', null)
});

const patientUpdateSchema = patientCreateSchema;

const patientDocumentSchema = Joi.object({
  fileBase64: Joi.string().base64({ paddingRequired: false }).required(),
  visitRecordId: Joi.number().integer().positive().optional().allow(null),
  documentType: Joi.string().max(40).optional().allow('', null),
  title: Joi.string().max(160).optional().allow('', null),
  description: Joi.string().max(1000).optional().allow('', null),
  documentDate: Joi.string().max(20).optional().allow('', null),
  originalFilename: Joi.string().max(255).required(),
  mimeType: Joi.string().valid(...ALLOWED_DOCUMENT_MIME).required(),
  imagingModality: Joi.string().max(40).optional().allow('', null),
  toothNumber: Joi.string().max(40).optional().allow('', null),
  acquisitionDate: Joi.string().max(20).optional().allow('', null),
  dicomStudyUid: Joi.string().max(120).optional().allow('', null),
  claimAttachmentReady: Joi.boolean().optional().default(false)
});

const importScanSchema = Joi.object({
  visitRecordId: Joi.number().integer().positive().optional().allow(null),
  documentType: Joi.string().max(40).optional().allow('', null),
  title: Joi.string().max(160).optional().allow('', null),
  description: Joi.string().max(1000).optional().allow('', null),
  documentDate: Joi.string().max(20).optional().allow('', null),
  imagingModality: Joi.string().max(40).optional().allow('', null),
  toothNumber: Joi.string().max(40).optional().allow('', null),
  acquisitionDate: Joi.string().max(20).optional().allow('', null),
  dicomStudyUid: Joi.string().max(120).optional().allow('', null),
  claimAttachmentReady: Joi.boolean().optional().default(false)
});

module.exports = {
  validateBody,
  loginSchema,
  changePasswordSchema,
  patientCreateSchema,
  patientUpdateSchema,
  patientDocumentSchema,
  importScanSchema
};
