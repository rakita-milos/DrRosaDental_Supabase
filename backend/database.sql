-- Dr Rosa Dental Clinic SQLite Schema
-- Active schema used by backend/server.js.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('director', 'staff')),
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  password_changed_at TEXT,
  two_factor_secret TEXT,
  two_factor_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  ip_address TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  ip_address TEXT,
  metadata TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS backup_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  backup_type TEXT NOT NULL CHECK (backup_type IN ('manual', 'automatic', 'pre_restore')),
  encrypted INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'restored', 'failed')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth TEXT,
  gender TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  emergency_contact TEXT,
  medical_history TEXT,
  insurance_provider TEXT,
  insurance_number TEXT,
  payment_method TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS doctors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  specialization TEXT,
  license_number TEXT UNIQUE,
  email TEXT,
  phone TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS codebook_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  label TEXT NOT NULL,
  group_name TEXT,
  metadata TEXT,
  price REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id),
  chair_id INTEGER NOT NULL REFERENCES chairs(id),
  procedure_id INTEGER REFERENCES codebook_items(id),
  procedure_name TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show')),
  notes TEXT,
  google_event_id TEXT,
  google_sync_status TEXT NOT NULL DEFAULT 'not_synced',
  visit_record_id INTEGER REFERENCES visit_records(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS appointment_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by INTEGER REFERENCES users(id),
  changed_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS calendar_sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('create_google_event', 'update_google_event', 'cancel_google_event', 'delete_google_event')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'retry', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT
);

CREATE TABLE IF NOT EXISTS google_calendar_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  connected_email TEXT,
  calendar_id TEXT,
  calendar_name TEXT,
  client_id TEXT,
  client_secret TEXT,
  redirect_uri TEXT,
  oauth_access_token TEXT,
  oauth_refresh_token TEXT,
  oauth_token_expires_at TEXT,
  sync_enabled INTEGER NOT NULL DEFAULT 0,
  sync_direction TEXT NOT NULL DEFAULT 'app_to_google' CHECK (sync_direction IN ('app_to_google', 'two_way')),
  default_reminder_minutes INTEGER NOT NULL DEFAULT 1440,
  last_sync_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS patient_medical_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL UNIQUE REFERENCES patients(id) ON DELETE CASCADE,
  blood_type TEXT,
  allergies TEXT,
  medications TEXT,
  chronic_conditions TEXT,
  contraindications TEXT,
  previous_surgeries TEXT,
  pregnancy_status TEXT,
  smoker INTEGER NOT NULL DEFAULT 0,
  diabetes INTEGER NOT NULL DEFAULT 0,
  high_blood_pressure INTEGER NOT NULL DEFAULT 0,
  heart_condition INTEGER NOT NULL DEFAULT 0,
  anesthesia_warning TEXT,
  dental_notes TEXT,
  internal_notes TEXT,
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS patient_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_record_id INTEGER REFERENCES visit_records(id) ON DELETE SET NULL,
  document_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  document_date TEXT,
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_hash TEXT,
  source TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'scanner')),
  uploaded_by INTEGER REFERENCES users(id),
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS visit_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id),
  visit_date TEXT NOT NULL,
  procedure TEXT NOT NULL,
  status TEXT NOT NULL,
  shift TEXT NOT NULL DEFAULT 'Prva smena',
  total_discount REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS treatments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_record_id INTEGER NOT NULL REFERENCES visit_records(id) ON DELETE CASCADE,
  tooth_number TEXT,
  treatment_type TEXT,
  status TEXT DEFAULT 'Planirano',
  notes TEXT,
  price REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_record_id INTEGER NOT NULL REFERENCES visit_records(id) ON DELETE CASCADE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  payment_status TEXT NOT NULL,
  payment_method TEXT,
  payment_date TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public_booking_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER REFERENCES patients(id) ON DELETE SET NULL,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  doctor_id INTEGER REFERENCES doctors(id),
  procedure_id INTEGER REFERENCES codebook_items(id),
  procedure_name TEXT NOT NULL,
  requested_starts_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('requested', 'booked', 'cancelled')),
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS treatment_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'presented', 'accepted', 'declined', 'completed')),
  currency TEXT NOT NULL DEFAULT 'EUR',
  discount REAL NOT NULL DEFAULT 0,
  accepted_at TEXT,
  signature_name TEXT,
  signature_data TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS treatment_plan_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES treatment_plans(id) ON DELETE CASCADE,
  phase INTEGER NOT NULL DEFAULT 1,
  tooth_number TEXT,
  procedure_name TEXT NOT NULL,
  description TEXT,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS perio_charts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  chart_date TEXT NOT NULL,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS perio_measurements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chart_id INTEGER NOT NULL REFERENCES perio_charts(id) ON DELETE CASCADE,
  tooth_number TEXT NOT NULL,
  site TEXT NOT NULL,
  pocket_depth INTEGER NOT NULL DEFAULT 0,
  bleeding INTEGER NOT NULL DEFAULT 0,
  gingival_margin INTEGER NOT NULL DEFAULT 0,
  recession INTEGER NOT NULL DEFAULT 0,
  mobility INTEGER NOT NULL DEFAULT 0,
  furcation INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  visit_record_id INTEGER REFERENCES visit_records(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'void', 'refunded')),
  issue_date TEXT NOT NULL,
  due_date TEXT,
  currency TEXT NOT NULL DEFAULT 'EUR',
  subtotal REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  amount_paid REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  tooth_number TEXT,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  payment_method TEXT,
  payment_date TEXT NOT NULL,
  payment_type TEXT NOT NULL DEFAULT 'payment' CHECK (payment_type IN ('payment', 'advance', 'installment', 'refund')),
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS insurance_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_record_id INTEGER REFERENCES visit_records(id) ON DELETE SET NULL,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  policy_number TEXT,
  claim_number TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'eligibility_checked', 'preauth_sent', 'submitted', 'approved', 'partially_approved', 'denied', 'paid')),
  requested_amount REAL NOT NULL DEFAULT 0,
  approved_amount REAL NOT NULL DEFAULT 0,
  submitted_at TEXT,
  decision_at TEXT,
  eligibility_notes TEXT,
  preauthorization_notes TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(first_name, last_name);
CREATE INDEX IF NOT EXISTS idx_visit_records_patient ON visit_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_visit_records_doctor ON visit_records(doctor_id);
CREATE INDEX IF NOT EXISTS idx_visit_records_date ON visit_records(visit_date);
CREATE INDEX IF NOT EXISTS idx_payments_patient ON payments(patient_id);
CREATE INDEX IF NOT EXISTS idx_treatments_visit ON treatments(visit_record_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_codebook_items_unique ON codebook_items(type, value, COALESCE(group_name, ''));
CREATE INDEX IF NOT EXISTS idx_codebook_items_type ON codebook_items(type, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_appointments_time ON appointments(starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor ON appointments(doctor_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_appointments_chair ON appointments(chair_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_calendar_sync_queue_status ON calendar_sync_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_patient_documents_patient ON patient_documents(patient_id, is_deleted, created_at);
CREATE INDEX IF NOT EXISTS idx_patient_documents_visit ON patient_documents(visit_record_id);
CREATE INDEX IF NOT EXISTS idx_public_booking_time ON public_booking_requests(requested_starts_at);
CREATE INDEX IF NOT EXISTS idx_treatment_plans_patient ON treatment_plans(patient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_perio_charts_patient ON perio_charts(patient_id, chart_date);
CREATE INDEX IF NOT EXISTS idx_invoices_patient ON invoices(patient_id, issue_date);
CREATE INDEX IF NOT EXISTS idx_insurance_claims_patient ON insurance_claims(patient_id, created_at);
