-- LEGACY / NOT ACTIVE
-- The active backend uses the SQLite schema in backend/database.sql.
-- Keep this file only as historical SQLite reference.

-- Users table for authentication
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('staff', 'director')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Patients table
CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    birth_date DATE,
    card_number TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Treatment records table
CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    doctor TEXT NOT NULL,
    procedure TEXT NOT NULL,
    date DATE NOT NULL,
    time TIME NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    paid BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
);

-- Procedures table (optional, for predefined procedures)
CREATE TABLE IF NOT EXISTS procedures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    default_price DECIMAL(10,2),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_records_patient_id ON records(patient_id);
CREATE INDEX IF NOT EXISTS idx_records_date ON records(date);
CREATE INDEX IF NOT EXISTS idx_patients_card_number ON patients(card_number);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Insert demo users (passwords should be hashed in production)
-- Password for demo users is 'password123' (hashed)
INSERT OR IGNORE INTO users (name, email, password_hash, role) VALUES
('Dr Rosa Bašić', 'rosa@drrosa.ba', '$2b$10$example.hash.for.demo', 'director'),
('Staff Member', 'staff@drrosa.ba', '$2b$10$example.hash.for.demo', 'staff');

-- Insert some sample procedures
INSERT OR IGNORE INTO procedures (name, description, default_price) VALUES
('Pregled', 'Opći pregled zuba', 50.00),
('Čišćenje', 'Profesionalno čišćenje zuba', 80.00),
('Plomba', 'Postavljanje plombe', 120.00),
('Vađenje', 'Vađenje zuba', 150.00),
('Ortodoncija', 'Ortodontski tretman', 500.00);
