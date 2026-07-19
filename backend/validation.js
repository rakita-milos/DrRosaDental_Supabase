const Joi = require('joi');

const ALLOWED_DOCUMENT_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/dicom',
  'application/octet-stream'
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

const treatmentSchema = Joi.object({
  tooth: Joi.string().max(20).optional().allow('', null),
  toothNumber: Joi.string().max(20).optional().allow('', null),
  type: Joi.string().max(255).optional().allow('', null),
  treatmentType: Joi.string().max(255).optional().allow('', null),
  status: Joi.string().max(80).optional().allow('', null),
  note: Joi.string().max(1000).optional().allow('', null),
  notes: Joi.string().max(1000).optional().allow('', null),
  price: Joi.number().min(0).optional().allow(null),
  priceCurrency: Joi.string().max(10).optional().allow('', null),
  price_currency: Joi.string().max(10).optional().allow('', null),
  basePriceEur: Joi.number().min(0).optional().allow(null),
  base_price_eur: Joi.number().min(0).optional().allow(null),
  currency: Joi.string().max(10).optional().allow('', null),
  discount: Joi.number().min(0).optional().allow(null),
  discountType: Joi.string().valid('amount', 'percent').optional().allow(null),
  discount_type: Joi.string().valid('amount', 'percent').optional().allow(null),
  discountValue: Joi.number().min(0).optional().allow(null),
  discount_value: Joi.number().min(0).optional().allow(null)
});

const paymentPartSchema = Joi.object({
  amount: Joi.number().min(0).required(),
  currency: Joi.string().max(10).optional().allow('', null),
  exchangeRateToRsd: Joi.number().min(0).optional().allow(null),
  exchange_rate_to_rsd: Joi.number().min(0).optional().allow(null),
  paymentMethod: Joi.string().max(80).optional().allow('', null),
  payment_method: Joi.string().max(80).optional().allow('', null),
  paymentDate: Joi.string().max(20).optional().allow('', null),
  payment_date: Joi.string().max(20).optional().allow('', null),
  notes: Joi.string().max(1000).optional().allow('', null)
});

const recordCreateSchema = Joi.object({
  patient_id: Joi.number().integer().positive().required(),
  doctor_id: Joi.number().integer().positive().required(),
  visit_date: Joi.string().max(20).required(),
  procedure: Joi.string().max(255).required(),
  status: Joi.string().max(80).optional().allow('', null),
  notes: Joi.string().max(2000).optional().allow('', null),
  totalAmount: Joi.number().min(0).optional().allow(null),
  total_amount: Joi.number().min(0).optional().allow(null),
  amount: Joi.number().min(0).optional().allow(null),
  amount_paid: Joi.number().min(0).optional().allow(null),
  amountPaid: Joi.number().min(0).optional().allow(null),
  currency: Joi.string().max(10).optional().allow('', null),
  payment_status: Joi.string().max(80).optional().allow('', null),
  shift: Joi.string().max(80).optional().allow('', null),
  paymentParts: Joi.array().items(paymentPartSchema).optional(),
  payment_parts: Joi.array().items(paymentPartSchema).optional(),
  treatments: Joi.alternatives().try(
    Joi.array().items(treatmentSchema),
    Joi.object().pattern(Joi.string().max(20), Joi.alternatives().try(treatmentSchema, Joi.array().items(treatmentSchema)))
  ).optional().allow(null)
});

const publicBookingSchema = Joi.object({
  firstName: Joi.string().max(80).optional(),
  first_name: Joi.string().max(80).optional(),
  lastName: Joi.string().max(80).optional(),
  last_name: Joi.string().max(80).optional(),
  email: Joi.string().email().optional().allow('', null),
  phone: Joi.string().max(50).required(),
  notes: Joi.string().max(1000).optional().allow('', null),
  doctorId: Joi.number().integer().positive().optional(),
  doctor_id: Joi.number().integer().positive().optional(),
  chairId: Joi.number().integer().positive().optional(),
  chair_id: Joi.number().integer().positive().optional(),
  procedureId: Joi.number().integer().positive().optional(),
  procedure_id: Joi.number().integer().positive().optional(),
  procedureName: Joi.string().max(255).optional().allow('', null),
  procedure_name: Joi.string().max(255).optional().allow('', null),
  startsAt: Joi.string().max(40).optional(),
  starts_at: Joi.string().max(40).optional(),
  durationMinutes: Joi.number().integer().min(15).max(180).optional(),
  duration_minutes: Joi.number().integer().min(15).max(180).optional(),
  turnstileToken: Joi.string().max(4096).optional().allow('', null),
  captchaToken: Joi.string().max(4096).optional().allow('', null)
}).or('firstName', 'first_name')
  .or('lastName', 'last_name')
  .or('doctorId', 'doctor_id')
  .or('procedureId', 'procedure_id', 'procedureName', 'procedure_name')
  .or('startsAt', 'starts_at');

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
  recordCreateSchema,
  publicBookingSchema,
  importScanSchema
};
