const assert = require('node:assert');
const { test } = require('node:test');
const {
  loginSchema,
  changePasswordSchema,
  patientCreateSchema,
  patientDocumentSchema,
  importScanSchema,
  recordCreateSchema,
  publicBookingSchema
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
