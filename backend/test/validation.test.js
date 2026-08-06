const assert = require('node:assert');
const { test } = require('node:test');
const {
  loginSchema,
  changePasswordSchema,
  patientCreateSchema,
  patientDocumentSchema,
  importScanSchema,
  recordCreateSchema,
  publicBookingSchema,
  googlePullSchema,
  medicalProfileSchema,
  documentUpdateSchema,
  recordUpdateSchema,
  publicBookingSettingsSchema,
  googleCalendarSettingsSchema,
  googleOAuthExchangeSchema,
  doctorWriteSchema,
  codebookWriteSchema,
  dailyCashReportSchema
} = require('../validation');

test('login schema validates valid credentials', () => {
  const { error } = loginSchema.validate({
    email: 'test@example.com',
    password: '123456789012',
    role: 'staff'
  });
  assert.equal(error, undefined);
});

test('login schema rejects invalid email', () => {
  const { error } = loginSchema.validate({
    email: 'not-an-email',
    password: '123456789012'
  });
  assert(error instanceof Error);
});

test('change password schema requires strong passwords', () => {
  const { error } = changePasswordSchema.validate({
    currentPassword: 'short',
    newPassword: 'short'
  });
  assert(error instanceof Error);
});

test('patient create schema validates minimal payload', () => {
  const { error } = patientCreateSchema.validate({
    first_name: 'Ana',
    last_name: 'Kovac'
  });
  assert.equal(error, undefined);
});

test('patient document schema validates file upload payload', () => {
  const { error } = patientDocumentSchema.validate({
    fileBase64: Buffer.from('hello').toString('base64'),
    originalFilename: 'file.pdf',
    mimeType: 'application/pdf'
  });
  assert.equal(error, undefined);
});

test('document update schema accepts optional replacement file only with metadata', () => {
  const { error } = documentUpdateSchema.validate({
    title: 'Novi naziv',
    fileBase64: Buffer.from('%PDF-1.7').toString('base64'),
    originalFilename: 'file.pdf',
    mimeType: 'application/pdf'
  });
  assert.equal(error, undefined);

  const missingMetadata = documentUpdateSchema.validate({
    title: 'Novi naziv',
    fileBase64: Buffer.from('%PDF-1.7').toString('base64')
  });
  assert(missingMetadata.error instanceof Error);
});

test('import scan schema accepts optional metadata', () => {
  const { error } = importScanSchema.validate({
    documentType: 'rtg'
  });
  assert.equal(error, undefined);
});

test('record create schema validates required visit payload', () => {
  const { error, value } = recordCreateSchema.validate({
    patient_id: 1,
    doctor_id: 1,
    visit_date: '2026-06-22',
    procedure: 'Kontrola',
    treatments: [{ toothNumber: '11', type: 'Kontrola', price: 10 }]
  });
  assert.equal(error, undefined);
  assert.equal(value.patient_id, 1);
});

test('record create schema accepts treatment percentage discounts', () => {
  const { error, value } = recordCreateSchema.validate({
    patient_id: 1,
    doctor_id: 1,
    visit_date: '2026-07-03',
    procedure: 'Plomba',
    treatments: {
      16: [{
        type: 'Plomba',
        price: 100,
        discount: 10,
        discountType: 'percent',
        discountValue: 10
      }]
    }
  });
  assert.equal(error, undefined);
  assert.equal(value.treatments['16'][0].discountType, 'percent');
});

test('record create schema accepts general treatments without tooth map', () => {
  const { error, value } = recordCreateSchema.validate({
    patient_id: 1,
    doctor_id: 1,
    visit_date: '2026-07-03',
    procedure: 'Ciscenje svih zuba; Izbeljivanje',
    generalTreatments: [
      { type: 'Ciscenje svih zuba', price: 50, currency: 'EUR' },
      { type: 'Izbeljivanje', price: 120, currency: 'EUR' }
    ],
    treatments: {
      16: [{ type: 'Plomba', price: 40, currency: 'EUR' }]
    }
  });
  assert.equal(error, undefined);
  assert.equal(value.generalTreatments.length, 2);
});

test('public booking schema accepts camelCase booking payload', () => {
  const { error, value } = publicBookingSchema.validate({
    firstName: 'Mina',
    lastName: 'Jovanovic',
    phone: '060123456',
    doctorId: 1,
    procedureId: 1,
    startsAt: '2026-06-22T10:00:00.000Z'
  });
  assert.equal(error, undefined);
  assert.equal(value.firstName, 'Mina');
});

test('google pull schema accepts explicit visible range refresh', () => {
  const { error, value } = googlePullSchema.validate({
    mode: 'range',
    reset: true,
    limit: 100,
    complete: true,
    timeMin: '2026-08-01T00:00:00.000Z',
    timeMax: '2026-08-04T00:00:00.000Z'
  });
  assert.equal(error, undefined);
  assert.equal(value.mode, 'range');
  assert.equal(value.timeMin, '2026-08-01T00:00:00.000Z');
});

test('critical write schemas accept expected director and clinical payloads', () => {
  assert.equal(medicalProfileSchema.validate({ allergies: 'Penicilin', smoker: false }).error, undefined);
  assert.equal(documentUpdateSchema.validate({ title: 'Ortopan', claimAttachmentReady: true }).error, undefined);
  assert.equal(recordUpdateSchema.validate({ procedure: 'Kontrola', notes: 'Bez tegoba' }).error, undefined);
  assert.equal(publicBookingSettingsSchema.validate({ enabled: true }).error, undefined);
  assert.equal(googleCalendarSettingsSchema.validate({
    connectedEmail: 'dr@example.com',
    calendarId: 'calendar-id',
    redirectUri: 'https://example.com/callback',
    syncEnabled: true,
    syncDirection: 'two_way',
    directorPassword: '123456789012'
  }).error, undefined);
  assert.equal(googleOAuthExchangeSchema.validate({ code: '4/abc' }).error, undefined);
  assert.equal(doctorWriteSchema.validate({ name: 'Dr Rosa', email: 'rosa@example.com', calendarColor: '#ffffff' }).error, undefined);
  assert.equal(doctorWriteSchema.validate({ name: 'Dr Rosa', email: 'rosa@example.com', calendarColor: 'dc2127', calendarTextColor: '1d1d1d' }).error, undefined);
  assert.equal(codebookWriteSchema.validate({ type: 'procedure', value: 'kontrola', label: 'Kontrola', price: 10 }).error, undefined);
  assert.equal(dailyCashReportSchema.validate({
    date: '2026-08-01',
    shift: 'prepodne',
    lines: [{ itemValue: 'cash', amounts: { EUR: 10 }, notes: { EUR: 'ok' } }]
  }).error, undefined);
});
