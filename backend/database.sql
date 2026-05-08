-- Dr Rosa Dental Clinic SQLite Schema
-- Active schema used by backend/server.js.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('director', 'staff')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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

CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(first_name, last_name);
CREATE INDEX IF NOT EXISTS idx_visit_records_patient ON visit_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_visit_records_doctor ON visit_records(doctor_id);
CREATE INDEX IF NOT EXISTS idx_visit_records_date ON visit_records(visit_date);
CREATE INDEX IF NOT EXISTS idx_payments_patient ON payments(patient_id);
CREATE INDEX IF NOT EXISTS idx_treatments_visit ON treatments(visit_record_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_codebook_items_unique ON codebook_items(type, value, COALESCE(group_name, ''));
CREATE INDEX IF NOT EXISTS idx_codebook_items_type ON codebook_items(type, is_active, sort_order);
