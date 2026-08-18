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

function requiredText(max) {
  return Joi.string().trim().min(1).max(max).required();
}

function optionalText(max) {
  return Joi.string().trim().max(max).allow('', null);
}

const loginSchema = Joi.object({
  email: requiredText(255).email(),
  password: Joi.string().min(12).required(),
  role: Joi.string().valid('director', 'staff').optional(),
  twoFactorCode: optionalText(6).pattern(/^\d{6}$/)
});

const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().min(12).required(),
  newPassword: Joi.string().min(12).required()
});

const patientCreateSchema = Joi.object({
  first_name: requiredText(80),
  last_name: requiredText(80),
  date_of_birth: optionalText(20),
  gender: optionalText(30),
  email: optionalText(255).email(),
  phone: optionalText(50),
  address: optionalText(255),
  emergency_contact: optionalText(255),
  medical_history: optionalText(2000)
});

const patientUpdateSchema = patientCreateSchema;

const patientDocumentSchema = Joi.object({
  fileBase64: Joi.string().base64({ paddingRequired: false }).required(),
  visitRecordId: Joi.number().integer().positive().optional().allow(null),
  documentType: optionalText(40).optional(),
  title: optionalText(160).optional(),
  description: optionalText(1000).optional(),
  documentDate: optionalText(20).optional(),
  originalFilename: Joi.string().max(255).required(),
  mimeType: Joi.string().valid(...ALLOWED_DOCUMENT_MIME).required(),
  imagingModality: optionalText(40).optional(),
  toothNumber: optionalText(40).optional(),
  acquisitionDate: optionalText(20).optional(),
  dicomStudyUid: optionalText(120).optional(),
  claimAttachmentReady: Joi.boolean().optional().default(false)
});

const treatmentSchema = Joi.object({
  tooth: optionalText(20).optional(),
  toothNumber: optionalText(20).optional(),
  type: optionalText(255).optional(),
  treatmentType: optionalText(255).optional(),
  status: optionalText(80).optional(),
  note: optionalText(1000).optional(),
  notes: optionalText(1000).optional(),
  price: Joi.number().min(0).optional().allow(null),
  priceCurrency: optionalText(10).optional(),
  price_currency: optionalText(10).optional(),
  basePriceEur: Joi.number().min(0).optional().allow(null),
  base_price_eur: Joi.number().min(0).optional().allow(null),
  currency: optionalText(10).optional(),
  discount: Joi.number().min(0).optional().allow(null),
  discountType: Joi.string().valid('amount', 'percent').optional().allow(null),
  discount_type: Joi.string().valid('amount', 'percent').optional().allow(null),
  discountValue: Joi.number().min(0).optional().allow(null),
  discount_value: Joi.number().min(0).optional().allow(null)
});

const paymentPartSchema = Joi.object({
  amount: Joi.number().min(0).required(),
  currency: optionalText(10).optional(),
  exchangeRateToRsd: Joi.number().min(0).optional().allow(null),
  exchange_rate_to_rsd: Joi.number().min(0).optional().allow(null),
  paymentMethod: optionalText(80).optional(),
  payment_method: optionalText(80).optional(),
  paymentDate: optionalText(20).optional(),
  payment_date: optionalText(20).optional(),
  notes: optionalText(1000).optional()
});

const paymentPartAppendSchema = paymentPartSchema.keys({
  amount: Joi.number().greater(0).required()
});

const recordCreateSchema = Joi.object({
  patient_id: Joi.number().integer().positive().required(),
  doctor_id: Joi.number().integer().positive().required(),
  visit_date: requiredText(20),
  procedure: requiredText(255),
  status: optionalText(80).optional(),
  notes: optionalText(2000).optional(),
  totalAmount: Joi.number().min(0).optional().allow(null),
  total_amount: Joi.number().min(0).optional().allow(null),
  amount: Joi.number().min(0).optional().allow(null),
  amount_paid: Joi.number().min(0).optional().allow(null),
  amountPaid: Joi.number().min(0).optional().allow(null),
  currency: optionalText(10).optional(),
  payment_status: optionalText(80).optional(),
  shift: optionalText(80).optional(),
  paymentParts: Joi.array().items(paymentPartSchema).optional(),
  payment_parts: Joi.array().items(paymentPartSchema).optional(),
  generalTreatments: Joi.array().items(treatmentSchema).optional(),
  general_treatments: Joi.array().items(treatmentSchema).optional(),
  treatments: Joi.alternatives().try(
    Joi.array().items(treatmentSchema),
    Joi.object().pattern(Joi.string().max(20), Joi.alternatives().try(treatmentSchema, Joi.array().items(treatmentSchema)))
  ).optional().allow(null)
});

const publicBookingSchema = Joi.object({
  firstName: requiredText(80).optional(),
  first_name: requiredText(80).optional(),
  lastName: requiredText(80).optional(),
  last_name: requiredText(80).optional(),
  email: optionalText(255).email().optional(),
  phone: requiredText(50),
  notes: optionalText(1000).optional(),
  doctorId: Joi.number().integer().positive().optional(),
  doctor_id: Joi.number().integer().positive().optional(),
  chairId: Joi.number().integer().positive().optional(),
  chair_id: Joi.number().integer().positive().optional(),
  procedureId: Joi.number().integer().positive().optional(),
  procedure_id: Joi.number().integer().positive().optional(),
  procedureName: requiredText(255).optional(),
  procedure_name: requiredText(255).optional(),
  startsAt: requiredText(40).optional(),
  starts_at: requiredText(40).optional(),
  durationMinutes: Joi.number().integer().min(15).max(180).optional(),
  duration_minutes: Joi.number().integer().min(15).max(180).optional(),
  turnstileToken: optionalText(4096).optional(),
  captchaToken: optionalText(4096).optional()
}).or('firstName', 'first_name')
  .or('lastName', 'last_name')
  .or('doctorId', 'doctor_id')
  .or('procedureId', 'procedure_id', 'procedureName', 'procedure_name')
  .or('startsAt', 'starts_at');

const appointmentWriteSchema = Joi.object({
  patient_id: Joi.number().integer().positive().optional(),
  patientId: Joi.number().integer().positive().optional(),
  doctor_id: Joi.number().integer().positive().optional(),
  doctorId: Joi.number().integer().positive().optional(),
  chair_id: Joi.number().integer().positive().optional(),
  chairId: Joi.number().integer().positive().optional(),
  procedure_id: Joi.number().integer().positive().optional().allow(null),
  procedureId: Joi.number().integer().positive().optional().allow(null),
  procedure_name: optionalText(255).optional(),
  procedureName: optionalText(255).optional(),
  starts_at: requiredText(40).optional(),
  startsAt: requiredText(40).optional(),
  ends_at: optionalText(40).optional(),
  endsAt: optionalText(40).optional(),
  duration_minutes: Joi.number().integer().min(5).max(480).optional(),
  durationMinutes: Joi.number().integer().min(5).max(480).optional(),
  status: Joi.string().valid('scheduled', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show').optional(),
  notes: optionalText(2000).optional()
});

const appointmentStatusSchema = Joi.object({
  status: Joi.string().valid('scheduled', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show').required()
});

const googlePullSchema = Joi.object({
  mode: Joi.string().valid('incremental', 'range').optional().default('incremental'),
  reset: Joi.boolean().optional().default(false),
  limit: Joi.number().integer().min(1).max(100).optional().default(100),
  daysPast: Joi.number().integer().min(0).max(30).optional(),
  days_past: Joi.number().integer().min(0).max(30).optional(),
  daysFuture: Joi.number().integer().min(1).max(180).optional(),
  days_future: Joi.number().integer().min(1).max(180).optional(),
  timeMin: Joi.string().isoDate().optional(),
  time_min: Joi.string().isoDate().optional(),
  timeMax: Joi.string().isoDate().optional(),
  time_max: Joi.string().isoDate().optional(),
  complete: Joi.boolean().optional().default(true),
  async: Joi.boolean().optional().default(false)
});

const importScanSchema = Joi.object({
  visitRecordId: Joi.number().integer().positive().optional().allow(null),
  documentType: optionalText(40).optional(),
  title: optionalText(160).optional(),
  description: optionalText(1000).optional(),
  documentDate: optionalText(20).optional(),
  imagingModality: optionalText(40).optional(),
  toothNumber: optionalText(40).optional(),
  acquisitionDate: optionalText(20).optional(),
  dicomStudyUid: optionalText(120).optional(),
  claimAttachmentReady: Joi.boolean().optional().default(false)
});

const medicalProfileSchema = Joi.object({
  bloodType: optionalText(20).optional(),
  blood_type: optionalText(20).optional(),
  allergies: optionalText(2000).optional(),
  medications: optionalText(2000).optional(),
  chronicConditions: optionalText(2000).optional(),
  chronic_conditions: optionalText(2000).optional(),
  contraindications: optionalText(2000).optional(),
  previousSurgeries: optionalText(2000).optional(),
  previous_surgeries: optionalText(2000).optional(),
  pregnancyStatus: optionalText(255).optional(),
  pregnancy_status: optionalText(255).optional(),
  smoker: Joi.boolean().truthy(1, '1', 'true').falsy(0, '0', 'false').optional(),
  diabetes: Joi.boolean().truthy(1, '1', 'true').falsy(0, '0', 'false').optional(),
  highBloodPressure: Joi.boolean().truthy(1, '1', 'true').falsy(0, '0', 'false').optional(),
  high_blood_pressure: Joi.boolean().truthy(1, '1', 'true').falsy(0, '0', 'false').optional(),
  heartCondition: Joi.boolean().truthy(1, '1', 'true').falsy(0, '0', 'false').optional(),
  heart_condition: Joi.boolean().truthy(1, '1', 'true').falsy(0, '0', 'false').optional(),
  anesthesiaWarning: optionalText(2000).optional(),
  anesthesia_warning: optionalText(2000).optional(),
  dentalNotes: optionalText(2000).optional(),
  dental_notes: optionalText(2000).optional(),
  internalNotes: optionalText(2000).optional(),
  internal_notes: optionalText(2000).optional()
});

const documentUpdateSchema = Joi.object({
  fileBase64: Joi.string().base64({ paddingRequired: false }).optional(),
  originalFilename: optionalText(255).optional(),
  mimeType: Joi.string().valid(...ALLOWED_DOCUMENT_MIME).optional(),
  visitRecordId: Joi.number().integer().positive().optional().allow(null),
  visit_record_id: Joi.number().integer().positive().optional().allow(null),
  documentType: optionalText(40).optional(),
  document_type: optionalText(40).optional(),
  title: optionalText(160).optional(),
  description: optionalText(1000).optional(),
  documentDate: optionalText(20).optional(),
  document_date: optionalText(20).optional(),
  imagingModality: optionalText(40).optional(),
  imaging_modality: optionalText(40).optional(),
  toothNumber: optionalText(40).optional(),
  tooth_number: optionalText(40).optional(),
  acquisitionDate: optionalText(20).optional(),
  acquisition_date: optionalText(20).optional(),
  dicomStudyUid: optionalText(120).optional(),
  dicom_study_uid: optionalText(120).optional(),
  claimAttachmentReady: Joi.boolean().optional(),
  claim_attachment_ready: Joi.boolean().optional()
}).with('fileBase64', ['originalFilename', 'mimeType']);

const recordUpdateSchema = recordCreateSchema.fork(['patient_id', 'doctor_id', 'visit_date'], schema => schema.optional());

const publicBookingSettingsSchema = Joi.object({
  enabled: Joi.boolean().truthy(1, '1', 'true').falsy(0, '0', 'false').required()
});

const googleCalendarSettingsSchema = Joi.object({
  connectedEmail: optionalText(255).email().optional(),
  connected_email: optionalText(255).email().optional(),
  calendarId: optionalText(255).optional(),
  calendar_id: optionalText(255).optional(),
  calendarName: optionalText(255).optional(),
  calendar_name: optionalText(255).optional(),
  clientId: optionalText(255).optional(),
  client_id: optionalText(255).optional(),
  clientSecret: optionalText(255).optional(),
  client_secret: optionalText(255).optional(),
  redirectUri: optionalText(500).uri().optional(),
  redirect_uri: optionalText(500).uri().optional(),
  syncEnabled: Joi.boolean().truthy(1, '1', 'true').falsy(0, '0', 'false').optional(),
  sync_enabled: Joi.boolean().truthy(1, '1', 'true').falsy(0, '0', 'false').optional(),
  syncDirection: Joi.string().valid('app_to_google', 'two_way').optional(),
  sync_direction: Joi.string().valid('app_to_google', 'two_way').optional(),
  defaultReminderMinutes: Joi.number().integer().min(0).max(10080).optional(),
  default_reminder_minutes: Joi.number().integer().min(0).max(10080).optional(),
  directorPassword: requiredText(255).min(12).optional(),
  director_password: requiredText(255).min(12).optional()
});

const googleOAuthExchangeSchema = Joi.object({
  code: requiredText(4096)
});

const doctorWriteSchema = Joi.object({
  name: optionalText(120).optional(),
  specialization: optionalText(120).optional(),
  licenseNumber: optionalText(80).optional(),
  license_number: optionalText(80).optional(),
  email: optionalText(255).email().optional(),
  phone: optionalText(50).optional(),
  isActive: Joi.boolean().optional(),
  is_active: Joi.boolean().optional(),
  googleColorId: optionalText(40).optional(),
  google_color_id: optionalText(40).optional(),
  calendarColor: optionalText(20).optional(),
  calendar_color: optionalText(20).optional(),
  calendarTextColor: optionalText(20).optional(),
  calendar_text_color: optionalText(20).optional()
});

const codebookWriteSchema = Joi.object({
  type: requiredText(40).optional(),
  value: requiredText(120).optional(),
  label: optionalText(120).optional(),
  groupName: optionalText(120).optional(),
  group_name: optionalText(120).optional(),
  metadata: Joi.object().unknown(true).optional().allow(null),
  price: Joi.number().min(0).optional().allow(null),
  priceCurrency: optionalText(10).optional(),
  price_currency: optionalText(10).optional(),
  isActive: Joi.boolean().optional(),
  is_active: Joi.boolean().optional(),
  sortOrder: Joi.number().integer().optional(),
  sort_order: Joi.number().integer().optional()
});

const dailyCashReportSchema = Joi.object({
  date: requiredText(20).optional(),
  reportDate: requiredText(20).optional(),
  shift: optionalText(80).optional(),
  notes: optionalText(2000).optional(),
  lines: Joi.array().items(Joi.object({
    itemValue: requiredText(120).optional(),
    item_value: requiredText(120).optional(),
    amounts: Joi.object().pattern(optionalText(10), Joi.number().min(0)).optional(),
    notes: Joi.alternatives().try(
      optionalText(1000),
      Joi.object().pattern(optionalText(10), optionalText(1000))
    ).optional()
  })).optional().default([])
}).or('date', 'reportDate');

module.exports = {
  validateBody,
  loginSchema,
  changePasswordSchema,
  patientCreateSchema,
  patientUpdateSchema,
  patientDocumentSchema,
  recordCreateSchema,
  paymentPartAppendSchema,
  publicBookingSchema,
  appointmentWriteSchema,
  appointmentStatusSchema,
  googlePullSchema,
  importScanSchema,
  medicalProfileSchema,
  documentUpdateSchema,
  recordUpdateSchema,
  publicBookingSettingsSchema,
  googleCalendarSettingsSchema,
  googleOAuthExchangeSchema,
  doctorWriteSchema,
  codebookWriteSchema,
  dailyCashReportSchema
};
