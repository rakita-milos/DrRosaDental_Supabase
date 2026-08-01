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

const appointmentWriteSchema = Joi.object({
  patient_id: Joi.number().integer().positive().optional(),
  patientId: Joi.number().integer().positive().optional(),
  doctor_id: Joi.number().integer().positive().optional(),
  doctorId: Joi.number().integer().positive().optional(),
  chair_id: Joi.number().integer().positive().optional(),
  chairId: Joi.number().integer().positive().optional(),
  procedure_id: Joi.number().integer().positive().optional().allow(null),
  procedureId: Joi.number().integer().positive().optional().allow(null),
  procedure_name: Joi.string().max(255).optional().allow('', null),
  procedureName: Joi.string().max(255).optional().allow('', null),
  starts_at: Joi.string().max(40).optional(),
  startsAt: Joi.string().max(40).optional(),
  ends_at: Joi.string().max(40).optional().allow('', null),
  endsAt: Joi.string().max(40).optional().allow('', null),
  duration_minutes: Joi.number().integer().min(5).max(480).optional(),
  durationMinutes: Joi.number().integer().min(5).max(480).optional(),
  status: Joi.string().valid('scheduled', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show').optional(),
  notes: Joi.string().max(2000).optional().allow('', null)
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
  complete: Joi.boolean().optional().default(true)
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

const medicalProfileSchema = Joi.object({
  bloodType: Joi.string().max(20).optional().allow('', null),
  blood_type: Joi.string().max(20).optional().allow('', null),
  allergies: Joi.string().max(2000).optional().allow('', null),
  medications: Joi.string().max(2000).optional().allow('', null),
  chronicConditions: Joi.string().max(2000).optional().allow('', null),
  chronic_conditions: Joi.string().max(2000).optional().allow('', null),
  contraindications: Joi.string().max(2000).optional().allow('', null),
  previousSurgeries: Joi.string().max(2000).optional().allow('', null),
  previous_surgeries: Joi.string().max(2000).optional().allow('', null),
  pregnancyStatus: Joi.string().max(255).optional().allow('', null),
  pregnancy_status: Joi.string().max(255).optional().allow('', null),
  smoker: Joi.boolean().truthy(1, '1', 'true').falsy(0, '0', 'false').optional(),
  diabetes: Joi.boolean().truthy(1, '1', 'true').falsy(0, '0', 'false').optional(),
  highBloodPressure: Joi.boolean().truthy(1, '1', 'true').falsy(0, '0', 'false').optional(),
  high_blood_pressure: Joi.boolean().truthy(1, '1', 'true').falsy(0, '0', 'false').optional(),
  heartCondition: Joi.boolean().truthy(1, '1', 'true').falsy(0, '0', 'false').optional(),
  heart_condition: Joi.boolean().truthy(1, '1', 'true').falsy(0, '0', 'false').optional(),
  anesthesiaWarning: Joi.string().max(2000).optional().allow('', null),
  anesthesia_warning: Joi.string().max(2000).optional().allow('', null),
  dentalNotes: Joi.string().max(2000).optional().allow('', null),
  dental_notes: Joi.string().max(2000).optional().allow('', null),
  internalNotes: Joi.string().max(2000).optional().allow('', null),
  internal_notes: Joi.string().max(2000).optional().allow('', null)
});

const documentUpdateSchema = Joi.object({
  visitRecordId: Joi.number().integer().positive().optional().allow(null),
  visit_record_id: Joi.number().integer().positive().optional().allow(null),
  documentType: Joi.string().max(40).optional().allow('', null),
  document_type: Joi.string().max(40).optional().allow('', null),
  title: Joi.string().max(160).optional().allow('', null),
  description: Joi.string().max(1000).optional().allow('', null),
  documentDate: Joi.string().max(20).optional().allow('', null),
  document_date: Joi.string().max(20).optional().allow('', null),
  imagingModality: Joi.string().max(40).optional().allow('', null),
  imaging_modality: Joi.string().max(40).optional().allow('', null),
  toothNumber: Joi.string().max(40).optional().allow('', null),
  tooth_number: Joi.string().max(40).optional().allow('', null),
  acquisitionDate: Joi.string().max(20).optional().allow('', null),
  acquisition_date: Joi.string().max(20).optional().allow('', null),
  dicomStudyUid: Joi.string().max(120).optional().allow('', null),
  dicom_study_uid: Joi.string().max(120).optional().allow('', null),
  claimAttachmentReady: Joi.boolean().optional(),
  claim_attachment_ready: Joi.boolean().optional()
});

const recordUpdateSchema = recordCreateSchema.fork(['patient_id', 'doctor_id', 'visit_date'], schema => schema.optional());

const publicBookingSettingsSchema = Joi.object({
  enabled: Joi.boolean().truthy(1, '1', 'true').falsy(0, '0', 'false').required()
});

const googleCalendarSettingsSchema = Joi.object({
  connectedEmail: Joi.string().email().optional().allow('', null),
  connected_email: Joi.string().email().optional().allow('', null),
  calendarId: Joi.string().max(255).optional().allow('', null),
  calendar_id: Joi.string().max(255).optional().allow('', null),
  calendarName: Joi.string().max(255).optional().allow('', null),
  calendar_name: Joi.string().max(255).optional().allow('', null),
  clientId: Joi.string().max(255).optional().allow('', null),
  client_id: Joi.string().max(255).optional().allow('', null),
  clientSecret: Joi.string().max(255).optional().allow('', null),
  client_secret: Joi.string().max(255).optional().allow('', null),
  redirectUri: Joi.string().uri().max(500).optional().allow('', null),
  redirect_uri: Joi.string().uri().max(500).optional().allow('', null),
  syncEnabled: Joi.boolean().truthy(1, '1', 'true').falsy(0, '0', 'false').optional(),
  sync_enabled: Joi.boolean().truthy(1, '1', 'true').falsy(0, '0', 'false').optional(),
  syncDirection: Joi.string().valid('app_to_google', 'two_way').optional(),
  sync_direction: Joi.string().valid('app_to_google', 'two_way').optional(),
  defaultReminderMinutes: Joi.number().integer().min(0).max(10080).optional(),
  default_reminder_minutes: Joi.number().integer().min(0).max(10080).optional(),
  directorPassword: Joi.string().min(12).optional(),
  director_password: Joi.string().min(12).optional()
});

const googleOAuthExchangeSchema = Joi.object({
  code: Joi.string().max(4096).required()
});

const doctorWriteSchema = Joi.object({
  name: Joi.string().max(120).optional().allow('', null),
  specialization: Joi.string().max(120).optional().allow('', null),
  licenseNumber: Joi.string().max(80).optional().allow('', null),
  license_number: Joi.string().max(80).optional().allow('', null),
  email: Joi.string().email().optional().allow('', null),
  phone: Joi.string().max(50).optional().allow('', null),
  isActive: Joi.boolean().optional(),
  is_active: Joi.boolean().optional(),
  googleColorId: Joi.string().max(40).optional().allow('', null),
  google_color_id: Joi.string().max(40).optional().allow('', null),
  calendarColor: Joi.string().max(7).optional().allow('', null),
  calendar_color: Joi.string().max(7).optional().allow('', null),
  calendarTextColor: Joi.string().max(7).optional().allow('', null),
  calendar_text_color: Joi.string().max(7).optional().allow('', null)
});

const codebookWriteSchema = Joi.object({
  type: Joi.string().max(40).optional(),
  value: Joi.string().max(120).optional(),
  label: Joi.string().max(120).optional().allow('', null),
  groupName: Joi.string().max(120).optional().allow('', null),
  group_name: Joi.string().max(120).optional().allow('', null),
  metadata: Joi.object().unknown(true).optional().allow(null),
  price: Joi.number().min(0).optional().allow(null),
  priceCurrency: Joi.string().max(10).optional().allow('', null),
  price_currency: Joi.string().max(10).optional().allow('', null),
  isActive: Joi.boolean().optional(),
  is_active: Joi.boolean().optional(),
  sortOrder: Joi.number().integer().optional(),
  sort_order: Joi.number().integer().optional()
});

const dailyCashReportSchema = Joi.object({
  date: Joi.string().max(20).optional(),
  reportDate: Joi.string().max(20).optional(),
  shift: Joi.string().max(80).optional().allow('', null),
  notes: Joi.string().max(2000).optional().allow('', null),
  lines: Joi.array().items(Joi.object({
    itemValue: Joi.string().max(120).optional(),
    item_value: Joi.string().max(120).optional(),
    amounts: Joi.object().pattern(Joi.string().max(10), Joi.number().min(0)).optional(),
    notes: Joi.alternatives().try(
      Joi.string().max(1000).allow('', null),
      Joi.object().pattern(Joi.string().max(10), Joi.string().max(1000).allow('', null))
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
