// Dr Rosa Dental Clinic - SQLite Backend API Server
require('dotenv').config();

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const util = require('util');
const bcryptCompare = util.promisify(bcrypt.compare);
const bcryptHash = util.promisify(bcrypt.hash);
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const {
  validateBody,
  loginSchema,
  changePasswordSchema,
  patientCreateSchema,
  patientUpdateSchema,
  patientDocumentSchema,
  recordCreateSchema,
  publicBookingSchema,
  importScanSchema
} = require('./validation');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const isProduction = process.env.NODE_ENV === 'production';

function flagEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isLocalOrigin(value) {
  try {
    const origin = new URL(value);
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(origin.hostname);
  } catch {
    return false;
  }
}

function configuredOrigins() {
  return [
    ...(process.env.CORS_ORIGIN || process.env.FRONTEND_ORIGIN || '').split(','),
    process.env.API_URL || ''
  ].map(origin => origin.trim()).filter(Boolean);
}

function hasPublicRuntimeOrigin() {
  return configuredOrigins().some(origin => !isLocalOrigin(origin));
}

const requiresProductionReadiness = isProduction || flagEnabled(process.env.REQUIRE_PRODUCTION_READY);

if (!isProduction && hasPublicRuntimeOrigin()) {
  throw new Error('Public API_URL/CORS_ORIGIN requires NODE_ENV=production before startup.');
}

if (!JWT_SECRET || JWT_SECRET.length < 32 || JWT_SECRET === 'your-secret-key-change-in-production') {
  throw new Error('Set JWT_SECRET in backend/.env to a unique value with at least 32 characters.');
}

function requireProductionEnv(name) {
  if (requiresProductionReadiness && !String(process.env[name] || '').trim()) {
    throw new Error(`Set ${name} before production startup.`);
  }
}

requireProductionEnv('CORS_ORIGIN');
requireProductionEnv('UPLOAD_DIR');
requireProductionEnv('SCANNER_IMPORT_DIR');
requireProductionEnv('STAFF_DEFAULT_PERMISSIONS');
requireProductionEnv('TRUST_PROXY');

const dbPath = path.resolve(__dirname, process.env.SQLITE_DB_PATH || './data/drosa.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const schema = fs.readFileSync(path.join(__dirname, 'database.sql'), 'utf8');

let db = openDatabase();
let server;
let automaticBackupTimer;
let restoreInProgress = false;

function openDatabase() {
  const database = new DatabaseSync(dbPath);
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA journal_mode = WAL');
  database.exec(schema);
  return database;
}

function configuredTrustProxy() {
  const raw = String(process.env.TRUST_PROXY || '').trim();
  if (!raw) return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  if (['true', '1', 'yes', 'on'].includes(raw.toLowerCase())) return true;
  if (['false', '0', 'no', 'off'].includes(raw.toLowerCase())) return false;
  return raw;
}

app.disable('x-powered-by');
app.set('trust proxy', configuredTrustProxy());
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", ...allowedCorsOrigins()],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  hsts: isProduction
}));
app.use(cors({
  origin(origin, callback) {
    const allowed = allowedCorsOrigins();
    if (!origin || allowed.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('CORS origin not allowed'));
  },
  credentials: true
}));
app.use(express.json({ limit: '15mb' }));
app.use((req, res, next) => {
  if (!restoreInProgress || req.path === '/api/health') return next();
  return res.status(503).json({ error: 'Maintenance in progress. Try again shortly.' });
});

function allowedCorsOrigins() {
  const configured = process.env.CORS_ORIGIN || process.env.FRONTEND_ORIGIN || (isProduction ? '' : 'http://localhost:5173,http://localhost:3000,http://127.0.0.1:5500');
  if (requiresProductionReadiness && /(^|,)\s*https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|,|$)/i.test(configured)) {
    throw new Error('Production CORS_ORIGIN must not include localhost origins.');
  }
  return configured
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

function createRateLimiter({ windowMs, max, message }) {
  let cleanupAfter = 0;

  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const resetAt = now + windowMs;

    try {
      cleanupAfter += 1;
      if (cleanupAfter >= 100) {
        cleanupAfter = 0;
        db.prepare('DELETE FROM rate_limit_hits WHERE reset_at <= ?').run(now);
      }

      const current = db.prepare('SELECT count, reset_at FROM rate_limit_hits WHERE key = ?').get(key);
      let count;
      if (!current || Number(current.reset_at) <= now) {
        count = 1;
        db.prepare(`
          INSERT INTO rate_limit_hits (key, count, reset_at, updated_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(key) DO UPDATE SET count = excluded.count, reset_at = excluded.reset_at, updated_at = CURRENT_TIMESTAMP
        `).run(key, count, resetAt);
      } else {
        count = Number(current.count || 0) + 1;
        db.prepare('UPDATE rate_limit_hits SET count = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?').run(count, key);
      }

      if (count > max) {
        return res.status(429).json({ error: message });
      }
    } catch (error) {
      console.error('Rate limiter error:', error);
      return res.status(503).json({ error: 'Rate limiter unavailable. Try again later.' });
    }

    next();
  };
}

const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX || 50),
  message: 'Too many login attempts. Try again later.'
});

const publicBookingReadLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.PUBLIC_BOOKING_READ_RATE_LIMIT_MAX || 120),
  message: 'Too many booking requests. Try again later.'
});

const publicBookingWriteLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.PUBLIC_BOOKING_RATE_LIMIT_MAX || 20),
  message: 'Too many booking requests. Try again later.'
});

const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || '15m';
const REFRESH_TOKEN_DAYS = Number(process.env.REFRESH_TOKEN_DAYS || 14);
const LOCKOUT_ATTEMPTS = Number(process.env.LOCKOUT_ATTEMPTS || 5);
const LOCKOUT_MINUTES = Number(process.env.LOCKOUT_MINUTES || 15);
const BACKUP_DIR = path.resolve(__dirname, process.env.BACKUP_DIR || process.env.SQLITE_BACKUP_DIR || './backups');
const BACKUP_KEY_SOURCE = process.env.BACKUP_ENCRYPTION_KEY || JWT_SECRET;
const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

if (requiresProductionReadiness && (!process.env.BACKUP_ENCRYPTION_KEY || process.env.BACKUP_ENCRYPTION_KEY === JWT_SECRET)) {
  throw new Error('Set BACKUP_ENCRYPTION_KEY to a unique value separate from JWT_SECRET before production startup.');
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });

async function seedDatabase() {
  const doctorCount = db.prepare('SELECT COUNT(*) as count FROM doctors').get().count;
  if (doctorCount === 0) {
    const insertDoctor = db.prepare(`
      INSERT INTO doctors (name, specialization, license_number, email, phone)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertDoctor.run('Dr Rosa', 'General Dentistry', 'DL001', 'rosa@drosa.com', '+381-11-1234567');
    insertDoctor.run('Dr Novak', 'Prosthodontics', 'DL002', 'novak@drosa.com', '+381-11-2345678');
    insertDoctor.run('Dr Horvat', 'Orthodontics', 'DL003', 'horvat@drosa.com', '+381-11-3456789');
  }

  const chairCount = db.prepare('SELECT COUNT(*) as count FROM chairs').get().count;
  if (chairCount === 0) {
    const insertChair = db.prepare('INSERT INTO chairs (name) VALUES (?)');
    insertChair.run('Stolica 1');
    insertChair.run('Stolica 2');
  }

  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0) {
    const directorPassword = process.env.INITIAL_DIRECTOR_PASSWORD;
    const staffPassword = process.env.INITIAL_STAFF_PASSWORD;

    if (!isStrongInitialPassword(directorPassword) || !isStrongInitialPassword(staffPassword)) {
      throw new Error('Set INITIAL_DIRECTOR_PASSWORD and INITIAL_STAFF_PASSWORD to unique values with at least 12 characters.');
    }

    const insertUser = db.prepare(`
      INSERT INTO users (email, password_hash, name, role)
      VALUES (?, ?, ?, ?)
    `);
    const directorHash = await bcryptHash(directorPassword, 12);
    const staffHash = await bcryptHash(staffPassword, 12);
    insertUser.run('director@drosa.com', directorHash, 'Dr Rosa Basic', 'director');
    insertUser.run('staff@drosa.com', staffHash, 'Ana - Medicinska sestra', 'staff');
  }

  seedCodebooks();
  await rotateDefaultPasswords();
}

function applyMigrations() {
  ensureMigrationLedger();
  runMigration('2026-06-22-runtime-schema-guards', () => {
  ensureSecurityTables();
  ensureCalendarTables();
  ensureGoogleCalendarOAuthColumns();
  ensurePatientDocumentTables();
  ensureAdvancedWorkflowTables();
  ensureClinicalWorkflowTables();
  ensureColumn('visit_records', 'shift', "TEXT NOT NULL DEFAULT 'Prva smena'");
  ensureColumn('payments', 'currency', "TEXT NOT NULL DEFAULT 'EUR'");
  ensureColumn('payments', 'amount_paid', "REAL NOT NULL DEFAULT 0");
  ensureColumn('treatments', 'price', "REAL NOT NULL DEFAULT 0");
  ensureColumn('treatments', 'discount', "REAL NOT NULL DEFAULT 0");
  ensureColumn('clinical_chart_entries', 'price', "REAL NOT NULL DEFAULT 0");
  ensureColumn('clinical_chart_entries', 'currency', "TEXT NOT NULL DEFAULT 'EUR'");
  ensureColumn('clinical_chart_entries', 'price_rsd', "REAL NOT NULL DEFAULT 0");
  ensureColumn('clinical_chart_entries', 'exchange_rate_to_rsd', "REAL NOT NULL DEFAULT 0");
  ensureColumn('patient_consents', 'updated_at', 'TEXT');
  ensureCodebookTable();
  ensureColumn('codebook_items', 'metadata', "TEXT");
  ensureDefaultShiftMetadata();
  ensureDefaultCurrencyMetadata();
  });
  runMigration('2026-06-30-public-booking-settings', () => {
    ensureAppSettingsTable();
    seedAppSetting('public_booking_enabled', '1');
  });
  runMigration('2026-06-30-google-calendar-two-way-pull', () => {
    ensureColumn('google_calendar_settings', 'events_sync_token', 'TEXT');
    ensureColumn('google_calendar_settings', 'last_google_pull_at', 'TEXT');
  });
  runMigration('2026-07-03-treatment-discount-types', () => {
    ensureColumn('treatments', 'discount_type', "TEXT NOT NULL DEFAULT 'amount'");
    ensureColumn('treatments', 'discount_value', "REAL NOT NULL DEFAULT 0");
  });
  runMigration('2026-07-03-payment-amount-paid', () => {
    ensureColumn('payments', 'amount_paid', "REAL NOT NULL DEFAULT 0");
  });
}

function ensureMigrationLedger() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function runMigration(version, migrate) {
  const existing = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(version);
  if (existing) return;
  migrate();
  db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
}

function ensureAppSettingsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function seedAppSetting(key, value) {
  db.prepare(`
    INSERT INTO app_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO NOTHING
  `).run(key, value);
}

function appSetting(key, fallback = '') {
  return db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value ?? fallback;
}

function setAppSetting(key, value) {
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(key, value);
}

function isPublicBookingEnabled() {
  return appSetting('public_booking_enabled', '1') === '1';
}

function requirePublicBookingEnabled(_req, res, next) {
  if (isPublicBookingEnabled()) return next();
  return res.status(503).json({ error: 'Onlajn zakazivanje trenutno nije dostupno.' });
}

function ensureClinicalWorkflowTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clinical_chart_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      visit_record_id INTEGER REFERENCES visit_records(id) ON DELETE SET NULL,
      tooth_number TEXT NOT NULL,
      surfaces TEXT,
      cdt_code TEXT,
      ada_code TEXT,
      diagnosis TEXT,
      procedure_code TEXT,
      status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed', 'watch', 'referred')),
      phase INTEGER NOT NULL DEFAULT 1,
      price REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'EUR',
      price_rsd REAL NOT NULL DEFAULT 0,
      exchange_rate_to_rsd REAL NOT NULL DEFAULT 0,
      provider_id INTEGER REFERENCES doctors(id),
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS clinical_note_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      body TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS clinical_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      visit_record_id INTEGER REFERENCES visit_records(id) ON DELETE SET NULL,
      template_id INTEGER REFERENCES clinical_note_templates(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      signed_by TEXT,
      signed_at TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS patient_consents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      treatment_plan_id INTEGER REFERENCES treatment_plans(id) ON DELETE SET NULL,
      consent_type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      signer_name TEXT NOT NULL,
      signature_data TEXT NOT NULL,
      signed_at TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_clinical_chart_patient ON clinical_chart_entries(patient_id, tooth_number, created_at);
    CREATE INDEX IF NOT EXISTS idx_clinical_notes_patient ON clinical_notes(patient_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_patient_consents_patient ON patient_consents(patient_id, signed_at);
  `);

  const templateCount = db.prepare('SELECT COUNT(*) as count FROM clinical_note_templates').get().count;
  if (templateCount === 0) {
    const insert = db.prepare('INSERT INTO clinical_note_templates (title, category, body) VALUES (?, ?, ?)');
    insert.run('Kontrola', 'general', 'Subjektivno: \\nObjektivno: \\nDijagnoza: \\nTerapija: \\nPlan: ');
    insert.run('Endodontski tretman', 'endodontics', 'Anestezija: \\nRadna duzina: \\nIspiranje: \\nPunjenje: \\nKontrola: ');
    insert.run('Hirurska saglasnost', 'consent', 'Pacijent je informisan o indikacijama, alternativama, rizicima i postoperativnim uputstvima.');
  }
}

function ensureGoogleCalendarOAuthColumns() {
  ensureColumn('google_calendar_settings', 'client_id', 'TEXT');
  ensureColumn('google_calendar_settings', 'client_secret', 'TEXT');
  ensureColumn('google_calendar_settings', 'redirect_uri', 'TEXT');
  ensureColumn('google_calendar_settings', 'oauth_access_token', 'TEXT');
  ensureColumn('google_calendar_settings', 'oauth_refresh_token', 'TEXT');
  ensureColumn('google_calendar_settings', 'oauth_token_expires_at', 'TEXT');
}

function ensureAdvancedWorkflowTables() {
  db.exec(`
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

    CREATE TABLE IF NOT EXISTS insurance_claim_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      claim_id INTEGER NOT NULL REFERENCES insurance_claims(id) ON DELETE CASCADE,
      document_id INTEGER NOT NULL REFERENCES patient_documents(id) ON DELETE RESTRICT,
      attachment_type TEXT NOT NULL DEFAULT 'supporting_document',
      clearinghouse_ref TEXT,
      status TEXT NOT NULL DEFAULT 'attached' CHECK (status IN ('attached', 'submitted', 'accepted', 'rejected')),
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS patient_ledger_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
      claim_id INTEGER REFERENCES insurance_claims(id) ON DELETE SET NULL,
      entry_type TEXT NOT NULL CHECK (entry_type IN ('charge', 'patient_payment', 'insurance_payment', 'adjustment', 'refund')),
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'EUR',
      description TEXT NOT NULL,
      entry_date TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  ensureColumn('insurance_claims', 'eligibility_status', 'TEXT');
  ensureColumn('insurance_claims', 'payer_control_number', 'TEXT');
  ensureColumn('insurance_claims', 'clearinghouse_ref', 'TEXT');
  ensureColumn('insurance_claims', 'denial_reason', 'TEXT');
  ensureColumn('insurance_claims', 'eob_json', 'TEXT');
  ensureColumn('insurance_claims', 'era_status', 'TEXT');
  ensureColumn('insurance_claims', 'paid_amount', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('insurance_claims', 'ledger_status', "TEXT NOT NULL DEFAULT 'unreconciled'");
}

function ensureSecurityTables() {
  ensureColumn('users', 'failed_login_attempts', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('users', 'locked_until', 'TEXT');
  ensureColumn('users', 'password_changed_at', 'TEXT');
  ensureColumn('users', 'two_factor_secret', 'TEXT');
  ensureColumn('users', 'two_factor_enabled', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('users', 'permissions_json', 'TEXT');
  db.exec(`
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

    CREATE TABLE IF NOT EXISTS rate_limit_hits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      reset_at INTEGER NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_reset ON rate_limit_hits(reset_at);

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

    CREATE TABLE IF NOT EXISTS backup_restore_tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      backup_id INTEGER REFERENCES backup_files(id) ON DELETE SET NULL,
      status TEXT NOT NULL,
      message TEXT,
      checked_tables TEXT,
      checked_at TEXT DEFAULT CURRENT_TIMESTAMP,
      checked_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    );
  `);
}

function ensurePatientDocumentTables() {
  db.exec(`
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

    CREATE INDEX IF NOT EXISTS idx_patient_documents_patient ON patient_documents(patient_id, is_deleted, created_at);
    CREATE INDEX IF NOT EXISTS idx_patient_documents_visit ON patient_documents(visit_record_id);
  `);
  ensureColumn('patient_documents', 'imaging_modality', 'TEXT');
  ensureColumn('patient_documents', 'tooth_number', 'TEXT');
  ensureColumn('patient_documents', 'acquisition_date', 'TEXT');
  ensureColumn('patient_documents', 'dicom_study_uid', 'TEXT');
  ensureColumn('patient_documents', 'ai_findings', 'TEXT');
  ensureColumn('patient_documents', 'claim_attachment_ready', 'INTEGER NOT NULL DEFAULT 0');
}

function ensureCalendarTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chairs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1,
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
      sync_enabled INTEGER NOT NULL DEFAULT 0,
      sync_direction TEXT NOT NULL DEFAULT 'app_to_google' CHECK (sync_direction IN ('app_to_google', 'two_way')),
      default_reminder_minutes INTEGER NOT NULL DEFAULT 1440,
      last_sync_at TEXT,
      events_sync_token TEXT,
      last_google_pull_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_appointments_time ON appointments(starts_at, ends_at);
    CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_doctor ON appointments(doctor_id, starts_at);
    CREATE INDEX IF NOT EXISTS idx_appointments_chair ON appointments(chair_id, starts_at);
    CREATE INDEX IF NOT EXISTS idx_calendar_sync_queue_status ON calendar_sync_queue(status, created_at);
  `);
  db.prepare(`
    INSERT INTO google_calendar_settings (id, sync_enabled, sync_direction, default_reminder_minutes)
    VALUES (1, 0, 'app_to_google', 1440)
    ON CONFLICT(id) DO NOTHING
  `).run();
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some(existing => existing.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function ensureCodebookTable() {
  db.exec(`
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
    )
  `);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_codebook_items_unique ON codebook_items(type, value, COALESCE(group_name, \'\'))');
  db.exec('CREATE INDEX IF NOT EXISTS idx_codebook_items_type ON codebook_items(type, is_active, sort_order)');
}

function ensureDefaultShiftMetadata() {
  const update = db.prepare('UPDATE codebook_items SET metadata = ? WHERE type = ? AND value = ? AND (metadata IS NULL OR metadata = ?)');
  update.run(JSON.stringify({ timeFrom: '08:00', timeTo: '14:00', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] }), 'shift', 'Prva smena', '');
  update.run(JSON.stringify({ timeFrom: '14:00', timeTo: '20:00', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] }), 'shift', 'Druga smena', '');
}

function ensureDefaultCurrencyMetadata() {
  const update = db.prepare('UPDATE codebook_items SET metadata = ? WHERE type = ? AND value = ? AND (metadata IS NULL OR metadata = ?)');
  update.run(JSON.stringify({ exchangeRate: 117, rateDate: 'manual', rateBase: 'EUR', rateCurrency: 'RSD', rateSource: 'default' }), 'currency', 'EUR', '');
  update.run(JSON.stringify({ exchangeRate: 1, rateDate: 'manual', rateBase: 'RSD', rateCurrency: 'RSD', rateSource: 'default' }), 'currency', 'RSD', '');
  update.run(JSON.stringify({ exchangeRate: 108, rateDate: 'manual', rateBase: 'USD', rateCurrency: 'RSD', rateSource: 'default' }), 'currency', 'USD', '');
}

function seedCodebooks() {
  const count = db.prepare('SELECT COUNT(*) as count FROM codebook_items').get().count;
  if (count > 0) return;

  const insert = db.prepare(`
    INSERT INTO codebook_items (type, value, label, group_name, metadata, price, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const add = (type, value, label = value, groupName = null, price = 0, sortOrder = 0, metadata = null) => {
    insert.run(type, value, label, groupName, metadata ? JSON.stringify(metadata) : null, price, sortOrder);
  };

  ['Opsta stomatologija', 'Hirurgija', 'Protetika', 'Ortodoncija'].forEach((item, index) => add('activity', item, item, null, 0, index + 1));
  [
    ['Kontrola', 'Opsta stomatologija', 30],
    ['Ciscenje', 'Opsta stomatologija', 50],
    ['Kontrola i ciscenje', 'Opsta stomatologija', 50],
    ['Plomba', 'Opsta stomatologija', 60],
    ['Endodontija', 'Opsta stomatologija', 120],
    ['Izbeljivanje', 'Opsta stomatologija', 150],
    ['Parodontologija', 'Opsta stomatologija', 90],
    ['Vadjenja zuba', 'Hirurgija', 50],
    ['Hirursko vadjenje', 'Hirurgija', 90],
    ['Impakcija umnjaka', 'Hirurgija', 180],
    ['Apikotomija', 'Hirurgija', 180],
    ['Implant', 'Hirurgija', 600],
    ['Keramicka kruna', 'Protetika', 250],
    ['Cirkonijum kruna', 'Protetika', 300],
    ['Totalna proteza', 'Protetika', 450],
    ['Parcijalna proteza', 'Protetika', 350],
    ['Fasete', 'Protetika', 220],
    ['Mobilna', 'Ortodoncija', 600],
    ['Fiksna', 'Ortodoncija', 900],
    ['Ostalo', 'Ortodoncija', 0]
  ].forEach(([value, groupName, price], index) => add('procedure', value, value, groupName, price, index + 1));
  ['Zakazano', 'U toku', 'Završeno', 'Otkazano'].forEach((item, index) => add('visit_status', item, item, null, 0, index + 1));
  ['Plaćeno', 'Dugovanje', 'Delimično'].forEach((item, index) => add('payment_status', item, item, null, 0, index + 1));
  [
    ['EUR', { exchangeRate: 117, rateDate: 'manual', rateBase: 'EUR', rateCurrency: 'RSD', rateSource: 'default' }],
    ['RSD', { exchangeRate: 1, rateDate: 'manual', rateBase: 'RSD', rateCurrency: 'RSD', rateSource: 'default' }],
    ['USD', { exchangeRate: 108, rateDate: 'manual', rateBase: 'USD', rateCurrency: 'RSD', rateSource: 'default' }]
  ].forEach(([item, metadata], index) => add('currency', item, item, null, 0, index + 1, metadata));
  add('shift', 'Prva smena', 'Prva smena', null, 0, 1, { timeFrom: '08:00', timeTo: '14:00', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] });
  add('shift', 'Druga smena', 'Druga smena', null, 0, 2, { timeFrom: '14:00', timeTo: '20:00', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] });
}

function isStrongInitialPassword(value) {
  return typeof value === 'string' && value.length >= 12 && value !== 'password123';
}

async function rotateDefaultPasswords() {
  const users = db.prepare('SELECT id, email, password_hash, role FROM users').all();
  const weakUsers = [];
  for (const user of users) {
    try {
      const isWeak = await bcryptCompare('password123', user.password_hash);
      if (isWeak) weakUsers.push(user);
    } catch (e) {
      // ignore compare errors
    }
  }

  if (weakUsers.length === 0) return;

  const replacements = {
    director: process.env.INITIAL_DIRECTOR_PASSWORD,
    staff: process.env.INITIAL_STAFF_PASSWORD
  };

  const updatePassword = db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  for (const user of weakUsers) {
    const replacement = replacements[user.role];
    if (!isStrongInitialPassword(replacement)) {
      throw new Error(`User ${user.email} still has the old default password. Set INITIAL_${user.role.toUpperCase()}_PASSWORD to rotate it.`);
    }
    const newHash = await bcryptHash(replacement, 12);
    updatePassword.run(newHash, user.id);
  }
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const cookies = parseCookies(req);
  const token = (authHeader && authHeader.split(' ')[1]) || cookies.drrosa_access;

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  jwt.verify(token, JWT_SECRET, (err, tokenUser) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND email = ?').get(
      positiveInteger(tokenUser.id),
      String(tokenUser.email || '').toLowerCase()
    );
    if (!user) return res.status(403).json({ error: 'Invalid token user' });
    if (isUserLocked(user)) return res.status(423).json({ error: 'Account is temporarily locked. Try again later.' });
    if (user.password_changed_at && tokenUser.iat && new Date(user.password_changed_at).getTime() > tokenUser.iat * 1000) {
      return res.status(403).json({ error: 'Session expired after password change' });
    }
    req.user = publicUser(user);
    req.user.permissions = permissionsForUser(user);
    next();
  });
}

function requireDirector(req, res, next) {
  if (req.user.role !== 'director') {
    return res.status(403).json({ error: 'Director access required' });
  }
  next();
}

function requirePermission(permission) {
  return (req, res, next) => {
    const permissions = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
    if (permissions.includes('*') || permissions.includes(permission)) return next();
    return res.status(403).json({ error: 'Permission required' });
  };
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    twoFactorEnabled: Boolean(user.two_factor_enabled)
  };
}

function auditLog({ userId = null, action, entityType = null, entityId = null, req = null, metadata = null }) {
  try {
    db.prepare(`
      INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      action,
      entityType,
      entityId === null || entityId === undefined ? null : String(entityId),
      req?.ip || null,
      metadata ? JSON.stringify(metadata) : null
    );
  } catch (error) {
    console.error('Revizija log error:', error);
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseCookies(req) {
  return String(req.headers.cookie || '')
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const index = part.indexOf('=');
      if (index === -1) return cookies;
      const key = part.slice(0, index);
      const value = part.slice(index + 1);
      try {
        cookies[key] = decodeURIComponent(value);
      } catch {
        cookies[key] = value;
      }
      return cookies;
    }, {});
}

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'Strict',
    maxAge,
    path: '/api'
  };
}

function tokenTtlMs(value) {
  const match = String(value || '').trim().match(/^(\d+)([smhd])?$/i);
  if (!match) return 15 * 60 * 1000;
  const amount = Number(match[1]);
  const unit = (match[2] || 's').toLowerCase();
  const multipliers = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return amount * multipliers[unit];
}

function createAccessToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

function createRefreshToken(userId, req) {
  const token = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO refresh_tokens (user_id, token_hash, user_agent, ip_address, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, hashToken(token), cleanText(req.headers['user-agent'], { max: 255 }), req.ip, expiresAt);
  return { token, expiresAt };
}

function issueSession(user, req, res) {
  const refresh = createRefreshToken(user.id, req);
  const accessToken = createAccessToken(user);
  if (res) {
    try {
      res.cookie('drrosa_access', accessToken, cookieOptions(tokenTtlMs(ACCESS_TOKEN_TTL)));
      res.cookie('drrosa_refresh', refresh.token, cookieOptions(REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000));
    } catch (e) {
      console.error('Failed to set refresh cookie', e);
    }
  }
  return {
    ...(isProduction ? {} : { token: accessToken, refreshToken: refresh.token }),
    refreshExpiresAt: refresh.expiresAt,
    user: publicUser(user)
  };
}

function isUserLocked(user) {
  return user.locked_until && new Date(user.locked_until).getTime() > Date.now();
}

function registerFailedLogin(user, req) {
  if (!user) return;
  const attempts = Number(user.failed_login_attempts || 0) + 1;
  const lockedUntil = attempts >= LOCKOUT_ATTEMPTS
    ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
    : null;
  db.prepare(`
    UPDATE users
    SET failed_login_attempts = ?, locked_until = COALESCE(?, locked_until), updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(attempts, lockedUntil, user.id);
  auditLog({ userId: user.id, action: lockedUntil ? 'account_locked' : 'login_failed', entityType: 'user', entityId: user.id, req });
}

function clearFailedLogins(userId) {
  db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
}

function randomBase32(length = 32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
}

function base32ToBuffer(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(secret || '').replace(/=+$/g, '').toUpperCase();
  let bits = '';
  for (const char of clean) {
    const value = alphabet.indexOf(char);
    if (value < 0) continue;
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function totpCode(secret, step = Math.floor(Date.now() / 30000)) {
  const counter = Buffer.alloc(8);
  counter.writeUInt32BE(Math.floor(step / 0x100000000), 0);
  counter.writeUInt32BE(step >>> 0, 4);
  const hmac = crypto.createHmac('sha1', base32ToBuffer(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
  return code;
}

function verifyTotp(secret, code) {
  const clean = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  const submitted = Buffer.from(clean);
  const currentStep = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some(offset => {
    const expected = Buffer.from(totpCode(secret, currentStep + offset));
    return expected.length === submitted.length && crypto.timingSafeEqual(expected, submitted);
  });
}

function backupKey() {
  return crypto.createHash('sha256').update(BACKUP_KEY_SOURCE).digest();
}

function encryptBuffer(buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', backupKey(), iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from('DRROSAENC1'), iv, tag, encrypted]);
}

function decryptBuffer(buffer) {
  const marker = buffer.subarray(0, 10).toString();
  if (marker !== 'DRROSAENC1') throw new Error('Invalid encrypted backup format');
  const iv = buffer.subarray(10, 22);
  const tag = buffer.subarray(22, 38);
  const encrypted = buffer.subarray(38);
  const decipher = crypto.createDecipheriv('aes-256-gcm', backupKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function backupFilename(type) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `drrosa-${type}-backup-${stamp}.sqlite.enc`;
}

async function createEncryptedBackup({ type = 'manual', userId = null, req = null } = {}) {
  db.exec('PRAGMA wal_checkpoint(FULL)');
  const plain = await fsp.readFile(dbPath);
  const encrypted = encryptBuffer(plain);
  const filename = backupFilename(type);
  const filePath = path.join(BACKUP_DIR, filename);
  await fsp.writeFile(filePath, encrypted, { mode: 0o600 });
  const result = db.prepare(`
    INSERT INTO backup_files (filename, file_path, file_size, backup_type, encrypted, created_by)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(filename, filePath, encrypted.length, type, userId);
  auditLog({ userId, action: 'backup_created', entityType: 'backup', entityId: result.lastInsertRowid, req, metadata: { type } });
  return serializeBackup(db.prepare('SELECT * FROM backup_files WHERE id = ?').get(result.lastInsertRowid));
}

function serializeBackup(row) {
  return {
    id: row.id,
    filename: row.filename,
    fileSize: Number(row.file_size || 0),
    backupType: row.backup_type,
    encrypted: Boolean(row.encrypted),
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at
  };
}

function backupStatus() {
  const last = db.prepare("SELECT * FROM backup_files WHERE status = 'ready' ORDER BY created_at DESC LIMIT 1").get();
  const count = db.prepare("SELECT COUNT(*) as count FROM backup_files WHERE status = 'ready'").get().count;
  const ageMs = last ? Date.now() - new Date(last.created_at).getTime() : null;
  return {
    lastBackup: last ? serializeBackup(last) : null,
    backupCount: count,
    warning: !last || ageMs > AUTO_BACKUP_INTERVAL_MS,
    warningMessage: !last
      ? 'Rezervna kopija još nije urađena.'
      : ageMs > AUTO_BACKUP_INTERVAL_MS
        ? 'Rezervna kopija je starija od 24 sata.'
        : null
  };
}

async function restoreEncryptedBackup(backup, userId, req) {
  await createEncryptedBackup({ type: 'pre_restore', userId, req });
  const encrypted = await fsp.readFile(backup.file_path);
  const plain = decryptBuffer(encrypted);
  const tempPath = path.join(path.dirname(dbPath), `restore-${Date.now()}.sqlite`);
  await fsp.writeFile(tempPath, plain, { mode: 0o600 });
  const validationDb = new DatabaseSync(tempPath);
  validationDb.prepare('SELECT name FROM sqlite_master WHERE type = ? LIMIT 1').get('table');
  validationDb.close();

  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const target = `${dbPath}${suffix}`;
    try {
      await fsp.unlink(target);
    } catch {
      // ignore missing files
    }
  }
  await fsp.rename(tempPath, dbPath);
  db = openDatabase();
  applyMigrations();
  db.prepare("UPDATE backup_files SET status = 'restored' WHERE id = ?").run(backup.id);
  auditLog({ userId, action: 'backup_restored', entityType: 'backup', entityId: backup.id, req });
}

async function testEncryptedBackupRestore(backup, userId, req) {
  const encrypted = await fsp.readFile(backup.file_path);
  const plain = decryptBuffer(encrypted);
  const tempPath = path.join(path.dirname(dbPath), `restore-test-${Date.now()}.sqlite`);
  const requiredTables = ['patients', 'visit_records', 'appointments', 'users', 'audit_log'];
  try {
    await fsp.writeFile(tempPath, plain, { mode: 0o600 });
    const validationDb = new DatabaseSync(tempPath);
    const foundTables = validationDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);
    const missingTables = requiredTables.filter(table => !foundTables.includes(table));
    validationDb.close();
    const status = missingTables.length ? 'failed' : 'passed';
    const message = missingTables.length
      ? `Nedostaju tabele: ${missingTables.join(', ')}`
      : 'Rezervna kopija je dekriptovana i osnovne tabele su proverene.';
    const result = db.prepare(`
      INSERT INTO backup_restore_tests (backup_id, status, message, checked_tables, checked_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(backup.id, status, message, JSON.stringify(requiredTables), userId);
    auditLog({ userId, action: 'backup_restore_tested', entityType: 'backup', entityId: backup.id, req, metadata: { status, missingTables } });
    return serializeRestoreTest(db.prepare('SELECT * FROM backup_restore_tests WHERE id = ?').get(result.lastInsertRowid));
  } finally {
    try {
      await fsp.unlink(tempPath);
    } catch {
      // ignore
    }
  }
}

function serializeSession(row) {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email || '',
    name: row.name || '',
    role: row.role || '',
    userAgent: row.user_agent || '',
    ipAddress: row.ip_address || '',
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at || null,
    createdAt: row.created_at
  };
}

function serializeRevizijaEntry(row) {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email || '',
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    ipAddress: row.ip_address || '',
    metadata: safeJsonParse(row.metadata, null),
    createdAt: row.created_at
  };
}

function serializeRestoreTest(row) {
  return {
    id: row.id,
    backupId: row.backup_id,
    status: row.status,
    message: row.message || '',
    checkedTables: safeJsonParse(row.checked_tables, []),
    checkedAt: row.checked_at,
    checkedBy: row.checked_by
  };
}

function normalizePaymentStatus(value) {
  const raw = String(value || '').toLowerCase();
  if (raw.includes('pla')) return 'Plaćeno';
  if (raw.includes('delimi') || raw.includes('delimi')) return 'Delimično';
  if (raw.includes('dug')) return 'Dugovanje';
  return 'Dugovanje';
}

function normalizeCurrency(value) {
  const raw = String(value || '').toUpperCase();
  if (raw === 'RSD' || raw.includes('DIN')) return 'RSD';
  if (raw === 'USD' || raw.includes('DOL')) return 'USD';
  return 'EUR';
}

function normalizeShift(value) {
  const raw = String(value || '').toLowerCase();
  if (raw.includes('drug') || raw.includes('2')) return 'Druga smena';
  return 'Prva smena';
}

function normalizeStatus(value) {
  const raw = String(value || '').toLowerCase();
  if (raw.includes('zavr')) return 'Završeno';
  if (raw.includes('otkaz')) return 'Otkazano';
  if (raw.includes('tijek') || raw.includes('toku')) return 'U toku';
  return value || 'Zakazano';
}

function rowExists(table, id) {
  return Boolean(db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id));
}

function procedureByInput({ procedureId, procedureName }) {
  if (procedureId) {
    const byId = db.prepare("SELECT * FROM codebook_items WHERE id = ? AND type = 'procedure' AND is_active = 1").get(procedureId);
    if (byId) return byId;
  }
  const name = cleanText(procedureName, { max: 255 });
  if (!name) return null;
  return db.prepare(`
    SELECT * FROM codebook_items
    WHERE type = 'procedure'
      AND is_active = 1
      AND (lower(label) = lower(?) OR lower(value) = lower(?))
    ORDER BY sort_order, id
    LIMIT 1
  `).get(name, name) || null;
}

function nullable(value) {
  return value === undefined ? null : value;
}

function safeJsonParse(value, fallback = null) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_error) {
    return fallback;
  }
}

const KNOWN_PERMISSIONS = new Set([
  'patients:read',
  'patients:write',
  'records:read',
  'records:write',
  'calendar:read',
  'calendar:write',
  'documents:read',
  'documents:write',
  'clinical:read',
  'clinical:write',
  'billing:read',
  'billing:write'
]);

function parsePermissionList(value) {
  return String(value || '')
    .split(',')
    .map(permission => permission.trim())
    .filter(Boolean);
}

function configuredStaffPermissions() {
  const permissions = parsePermissionList(process.env.STAFF_DEFAULT_PERMISSIONS);
  const invalid = invalidPermissions(permissions);
  if (invalid.length) {
    throw new Error(`Invalid STAFF_DEFAULT_PERMISSIONS values: ${invalid.join(', ')}`);
  }
  return permissions;
}

const staffDefaultPermissions = configuredStaffPermissions();

const DEFAULT_PERMISSIONS = {
  director: ['*'],
  staff: staffDefaultPermissions.length ? staffDefaultPermissions : [
    'patients:read',
    'patients:write',
    'records:read',
    'records:write',
    'calendar:read',
    'calendar:write',
    'documents:read',
    'documents:write',
    'clinical:read',
    'clinical:write',
    'billing:read',
    'billing:write'
  ]
};

function permissionsForUser(user) {
  const custom = safeJsonParse(user?.permissions_json, null);
  if (Array.isArray(custom)) return custom;
  return DEFAULT_PERMISSIONS[user?.role] || [];
}

function invalidPermissions(permissions) {
  return permissions.filter(permission => permission !== '*' && !KNOWN_PERMISSIONS.has(permission));
}

function serializeUserSecurity(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    permissions: permissionsForUser(user),
    failedLoginAttempts: Number(user.failed_login_attempts || 0),
    lockedUntil: user.locked_until,
    passwordChangedAt: user.password_changed_at,
    twoFactorEnabled: Boolean(user.two_factor_enabled),
    createdAt: user.created_at,
    updatedAt: user.updated_at
  };
}

function legalExportRows(table, limit) {
  return db.prepare(`SELECT * FROM ${table} ORDER BY id LIMIT ?`).all(limit);
}

function legalExportCount(table) {
  return Number(db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get().count || 0);
}

function cleanText(value, { max = 255, required = false } = {}) {
  if (value === undefined || value === null) {
    return required ? '' : null;
  }
  const cleaned = String(value)
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  return required ? cleaned : cleaned || null;
}

function normalizeGoogleAuthCode(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const match = raw.match(/(?:^|[?&])code=([^&#\s]+)/i);
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }

  return raw;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function hasCodeLikeContent(value) {
  const text = String(value || '');
  return /[<>`{}]/.test(text)
    || /\bjavascript\s*:/i.test(text)
    || /\bon[a-z]+\s*=/i.test(text)
    || /\b(select|insert|update|delete|drop|alter|union|exec)\b[\s\S]*\b(from|into|table|set|where)\b/i.test(text);
}

function validatedText(value, { field, max = 255, required = false, pattern = null } = {}) {
  const raw = value === undefined || value === null ? '' : String(value);
  const cleaned = cleanText(raw, { max, required });
  if (required && !cleaned) return { error: `${field} je obavezno polje.` };
  if (!cleaned) return { value: null };
  if (hasCodeLikeContent(raw)) return { error: `${field} ne sme sadrzati kod ili specijalne znakove.` };
  if (pattern && !pattern.test(cleaned)) return { error: `${field} nije u ispravnom formatu.` };
  return { value: cleaned };
}

function validatedPhone(value, { required = false } = {}) {
  const result = validatedText(value, {
    field: 'Broj telefona',
    max: 50,
    required,
    pattern: /^\+?[\d\s()./-]{6,30}$/
  });
  if (result.error || !result.value) return result;
  const digits = result.value.replace(/\D/g, '');
  if (digits.length < 6 || digits.length > 15) return { error: 'Broj telefona nije u ispravnom formatu.' };
  return result;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

const APPOINTMENT_STATUSES = new Set(['scheduled', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show']);
const BLOCKING_APPOINTMENT_STATUSES = ['scheduled', 'confirmed', 'arrived'];

function normalizeAppointmentStatus(value) {
  const raw = String(value || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  const map = {
    zakazano: 'scheduled',
    potvrdjeno: 'confirmed',
    potvrdeno: 'confirmed',
    došao: 'arrived',
    dosla: 'arrived',
    završeno: 'completed',
    otkazano: 'cancelled',
    nije_došao: 'no_show',
    no_show: 'no_show'
  };
  const status = map[raw] || raw || 'scheduled';
  return APPOINTMENT_STATUSES.has(status) ? status : 'scheduled';
}

function normalizeIsoDateTime(value) {
  const text = cleanText(value, { max: 40, required: true });
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function money(value) {
  return Math.max(0, Number(value || 0));
}

function signedMoney(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function appointmentDurationMinutes(startsAt, endsAt) {
  return Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000);
}

function appointmentConflict({ appointmentId = null, doctorId, chairId, startsAt, endsAt }) {
  return db.prepare(`
    SELECT
      a.id,
      a.starts_at,
      a.ends_at,
      a.status,
      p.first_name || ' ' || p.last_name as patient_name,
      d.name as doctor_name,
      c.name as chair_name,
      CASE WHEN a.doctor_id = ? THEN 'doctor' ELSE 'chair' END as conflict_type
    FROM appointments a
    JOIN patients p ON a.patient_id = p.id
    JOIN doctors d ON a.doctor_id = d.id
    JOIN chairs c ON a.chair_id = c.id
    WHERE a.id != COALESCE(?, 0)
      AND a.status IN (${BLOCKING_APPOINTMENT_STATUSES.map(() => '?').join(', ')})
      AND (a.doctor_id = ? OR a.chair_id = ?)
      AND a.starts_at < ?
      AND a.ends_at > ?
    ORDER BY a.starts_at
    LIMIT 1
  `).get(doctorId, appointmentId, ...BLOCKING_APPOINTMENT_STATUSES, doctorId, chairId, endsAt, startsAt);
}

function serializeAppointment(row) {
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    doctorId: row.doctor_id,
    doctorName: row.doctor_name,
    chairId: row.chair_id,
    chairName: row.chair_name,
    procedureId: row.procedure_id,
    procedureName: row.procedure_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    durationMinutes: Number(row.duration_minutes || appointmentDurationMinutes(row.starts_at, row.ends_at)),
    status: row.status,
    notes: row.notes,
    googleEventId: row.google_event_id,
    googleSyncStatus: row.google_sync_status,
    visitRecordId: row.visit_record_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function appointmentById(id) {
  return db.prepare(`
    SELECT
      a.*,
      p.first_name || ' ' || p.last_name as patient_name,
      d.name as doctor_name,
      c.name as chair_name
    FROM appointments a
    JOIN patients p ON a.patient_id = p.id
    JOIN doctors d ON a.doctor_id = d.id
    JOIN chairs c ON a.chair_id = c.id
    WHERE a.id = ?
  `).get(id);
}

function googleCalendarEventPayload(appointment, settings) {
  const patient = cleanText(appointment.patient_name || 'Pacijent', { max: 255 }) || 'Pacijent';
  return {
    summary: `${appointment.procedure_name || 'Termin'} - ${patient}`,
    description: appointment.notes || '',
    start: { dateTime: appointment.starts_at },
    end: { dateTime: appointment.ends_at },
    extendedProperties: {
      private: {
        drrosaAppointmentId: String(appointment.appointment_id || appointment.id || ''),
        drrosaSource: 'drrosa'
      }
    },
    reminders: {
      useDefault: false,
      overrides: Number(settings.default_reminder_minutes || 0) > 0
        ? [{ method: 'popup', minutes: Number(settings.default_reminder_minutes || 1440) }]
        : []
    }
  };
}

function publicGoogleSettings(settings) {
  return {
    connectedEmail: settings.connected_email,
    calendarId: settings.calendar_id,
    calendarName: settings.calendar_name,
    clientId: settings.client_id,
    clientSecret: settings.client_secret,
    redirectUri: settings.redirect_uri,
    oauthConnected: Boolean(settings.oauth_refresh_token || settings.oauth_access_token),
    oauthTokenExpiresAt: settings.oauth_token_expires_at,
    syncEnabled: Boolean(settings.sync_enabled),
    syncDirection: settings.sync_direction,
    defaultReminderMinutes: Number(settings.default_reminder_minutes || 1440),
    lastSyncAt: settings.last_sync_at,
    lastGooglePullAt: settings.last_google_pull_at,
    googlePullConfigured: Boolean(settings.events_sync_token)
  };
}

async function refreshGoogleAccessToken(settings) {
  if (!settings.oauth_refresh_token || !settings.client_id || !settings.client_secret) return null;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: settings.client_id,
      client_secret: settings.client_secret,
      refresh_token: settings.oauth_refresh_token,
      grant_type: 'refresh_token'
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(data.error_description || 'Google token refresh failed');
  const expiresAt = new Date(Date.now() + Number(data.expires_in || 3600) * 1000).toISOString();
  db.prepare(`
    UPDATE google_calendar_settings
    SET oauth_access_token = ?, oauth_token_expires_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(data.access_token, expiresAt);
  return data.access_token;
}

async function googleAccessToken(settings) {
  if (!settings.oauth_access_token) return refreshGoogleAccessToken(settings);
  const expiresAt = settings.oauth_token_expires_at ? new Date(settings.oauth_token_expires_at).getTime() : 0;
  if (expiresAt && expiresAt - 60000 > Date.now()) return settings.oauth_access_token;
  return refreshGoogleAccessToken(settings);
}

async function callGoogleCalendar(settings, method, path, payload) {
  const token = await googleAccessToken(settings);
  if (!token) throw new Error('Google OAuth is not connected.');
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: payload ? JSON.stringify(payload) : undefined
  });
  if (response.status === 204) return {};
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message || 'Google Calendar API request failed');
    error.status = response.status;
    error.googleError = data.error || data;
    throw error;
  }
  return data;
}

function queueCalendarSync(appointmentId, action) {
  const settings = db.prepare('SELECT sync_enabled FROM google_calendar_settings WHERE id = 1').get();
  const status = settings?.sync_enabled ? 'pending' : 'skipped';
  db.prepare(`
    INSERT INTO calendar_sync_queue (appointment_id, action, status, last_error, processed_at)
    VALUES (?, ?, ?, ?, CASE WHEN ? = 'skipped' THEN CURRENT_TIMESTAMP ELSE NULL END)
  `).run(
    appointmentId,
    action,
    status,
    status === 'skipped' ? 'Google Calendar sync is disabled.' : null,
    status
  );
  db.prepare('UPDATE appointments SET google_sync_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(status === 'pending' ? 'pending' : 'skipped', appointmentId);
}

async function processCalendarSyncRed({ limit = 10 } = {}) {
  const settings = db.prepare('SELECT * FROM google_calendar_settings WHERE id = 1').get();
  const rows = db.prepare(`
    SELECT q.*, a.google_event_id, a.procedure_name, a.starts_at, a.ends_at, a.notes,
           p.first_name || ' ' || p.last_name as patient_name
    FROM calendar_sync_queue q
    LEFT JOIN appointments a ON q.appointment_id = a.id
    LEFT JOIN patients p ON p.id = a.patient_id
    WHERE q.status IN ('pending', 'retry')
    ORDER BY q.created_at
    LIMIT ?
  `).all(limit);

  let processed = 0;
  for (const item of rows) {
    try {
      if (!settings?.sync_enabled || !settings.connected_email || !settings.calendar_id) {
        db.prepare(`
          UPDATE calendar_sync_queue
          SET status = 'skipped', attempts = attempts + 1, last_error = ?, processed_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run('Google Calendar account or calendar is not configured.', item.id);
        db.prepare('UPDATE appointments SET google_sync_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run('skipped', item.appointment_id);
        continue;
      }

      const calendarId = encodeURIComponent(settings.calendar_id);
      const eventPayload = googleCalendarEventPayload(item, settings);
      let googleEventId = item.google_event_id;
      if (item.action === 'create_google_event' || !googleEventId) {
        const event = await callGoogleCalendar(settings, 'POST', `/calendars/${calendarId}/events`, eventPayload);
        googleEventId = event.id;
      } else if (item.action === 'delete_google_event' || item.action === 'cancel_google_event') {
        await callGoogleCalendar(settings, 'DELETE', `/calendars/${calendarId}/events/${encodeURIComponent(googleEventId)}`);
      } else {
        const event = await callGoogleCalendar(settings, 'PATCH', `/calendars/${calendarId}/events/${encodeURIComponent(googleEventId)}`, eventPayload);
        googleEventId = event.id || googleEventId;
      }
      db.prepare(`
        UPDATE appointments
        SET google_event_id = ?, google_sync_status = 'synced', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(googleEventId, item.appointment_id);
      db.prepare(`
        UPDATE calendar_sync_queue
        SET status = 'done', attempts = attempts + 1, last_error = NULL, processed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(item.id);
      db.prepare('UPDATE google_calendar_settings SET last_sync_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = 1').run();
      processed += 1;
    } catch (error) {
      db.prepare(`
        UPDATE calendar_sync_queue
        SET status = CASE WHEN attempts >= 2 THEN 'failed' ELSE 'retry' END,
            attempts = attempts + 1,
            last_error = ?,
            processed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(cleanText(error.message, { max: 500 }), item.id);
    }
  }

  return processed;
}

function googleEventAppointmentId(event) {
  const raw = event?.extendedProperties?.private?.drrosaAppointmentId;
  const id = positiveInteger(raw);
  if (id) return id;
  const googleEventId = cleanText(event?.id, { max: 255 });
  if (googleEventId) {
    const existing = db.prepare('SELECT id FROM appointments WHERE google_event_id = ?').get(googleEventId);
    if (existing?.id) return existing.id;
  }
  return null;
}

function googleEventTimes(event) {
  const startsAt = normalizeIsoDateTime(event?.start?.dateTime);
  const endsAt = normalizeIsoDateTime(event?.end?.dateTime);
  if (!startsAt || !endsAt || appointmentDurationMinutes(startsAt, endsAt) <= 0) return null;
  return { startsAt, endsAt };
}

function googleEventProcedureName(event, fallback) {
  const summary = cleanText(event?.summary, { max: 255 });
  if (!summary) return fallback;
  const [procedure] = summary.split(' - ');
  return cleanText(procedure, { max: 255 }) || fallback;
}

function updateAppointmentFromGoogleEvent(event) {
  const appointmentId = googleEventAppointmentId(event);
  if (!appointmentId) return { action: 'skipped_external' };

  const current = appointmentById(appointmentId);
  if (!current) return { action: 'skipped_missing_local', appointmentId };

  if (event.status === 'cancelled') {
    if (current.status !== 'cancelled') {
      db.prepare(`
        UPDATE appointments
        SET status = 'cancelled', google_sync_status = 'synced', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(current.id);
      db.prepare('INSERT INTO appointment_status_history (appointment_id, old_status, new_status, changed_by) VALUES (?, ?, ?, NULL)')
        .run(current.id, current.status, 'cancelled');
      return { action: 'cancelled', appointmentId };
    }
    return { action: 'unchanged', appointmentId };
  }

  const times = googleEventTimes(event);
  if (!times) return { action: 'skipped_unsupported_time', appointmentId };

  const conflict = appointmentConflict({
    appointmentId: current.id,
    doctorId: current.doctor_id,
    chairId: current.chair_id,
    startsAt: times.startsAt,
    endsAt: times.endsAt
  });
  if (conflict) return { action: 'skipped_conflict', appointmentId, conflictId: conflict.id };

  const procedureName = googleEventProcedureName(event, current.procedure_name);
  const notes = cleanText(event.description, { max: 2000 });
  const status = normalizeAppointmentStatus(current.status);
  const changed = current.starts_at !== times.startsAt
    || current.ends_at !== times.endsAt
    || current.procedure_name !== procedureName
    || (current.notes || null) !== notes
    || current.google_event_id !== event.id;

  if (!changed) return { action: 'unchanged', appointmentId };

  db.prepare(`
    UPDATE appointments
    SET starts_at = ?, ends_at = ?, duration_minutes = ?, procedure_name = ?, notes = ?,
        google_event_id = ?, google_sync_status = 'synced', status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    times.startsAt,
    times.endsAt,
    appointmentDurationMinutes(times.startsAt, times.endsAt),
    procedureName,
    notes,
    event.id,
    status,
    current.id
  );
  return { action: 'updated', appointmentId };
}

async function pullGoogleCalendarChanges({ limit = 250, reset = false } = {}) {
  const settings = db.prepare('SELECT * FROM google_calendar_settings WHERE id = 1').get();
  if (!settings?.sync_enabled) throw new Error('Google Calendar sync is disabled.');
  if (settings.sync_direction !== 'two_way') throw new Error('Two-way sync is not enabled.');
  if (!settings.connected_email || !settings.calendar_id) throw new Error('Google Calendar account or calendar is not configured.');

  const calendarId = encodeURIComponent(settings.calendar_id);
  const stats = {
    fetched: 0,
    updated: 0,
    cancelled: 0,
    unchanged: 0,
    skippedExternal: 0,
    skippedMissingLocal: 0,
    skippedUnsupportedTime: 0,
    skippedConflicts: 0,
    fullSync: reset || !settings.events_sync_token
  };
  let nextSyncToken = null;
  let pageToken = null;
  let usedReset = reset;

  do {
    const query = new URLSearchParams({ maxResults: String(limit) });
    if (!usedReset && settings.events_sync_token) {
      query.set('syncToken', settings.events_sync_token);
    } else {
      query.set('singleEvents', 'true');
      query.set('showDeleted', 'true');
      query.set('timeMin', new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString());
    }
    if (pageToken) query.set('pageToken', pageToken);

    let data;
    try {
      data = await callGoogleCalendar(settings, 'GET', `/calendars/${calendarId}/events?${query.toString()}`);
    } catch (error) {
      if (error.status === 410 && !usedReset) {
        db.prepare('UPDATE google_calendar_settings SET events_sync_token = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = 1').run();
        return pullGoogleCalendarChanges({ limit, reset: true });
      }
      throw error;
    }

    for (const event of data.items || []) {
      stats.fetched += 1;
      const result = updateAppointmentFromGoogleEvent(event);
      if (result.action === 'updated') stats.updated += 1;
      if (result.action === 'cancelled') stats.cancelled += 1;
      if (result.action === 'unchanged') stats.unchanged += 1;
      if (result.action === 'skipped_external') stats.skippedExternal += 1;
      if (result.action === 'skipped_missing_local') stats.skippedMissingLocal += 1;
      if (result.action === 'skipped_unsupported_time') stats.skippedUnsupportedTime += 1;
      if (result.action === 'skipped_conflict') stats.skippedConflicts += 1;
    }

    pageToken = data.nextPageToken || null;
    nextSyncToken = data.nextSyncToken || nextSyncToken;
  } while (pageToken);

  if (nextSyncToken) {
    db.prepare(`
      UPDATE google_calendar_settings
      SET events_sync_token = ?, last_google_pull_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run(nextSyncToken);
  } else {
    db.prepare('UPDATE google_calendar_settings SET last_google_pull_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = 1').run();
  }

  return stats;
}

const DOCUMENT_TYPES = new Set(['rtg', 'ortopan', 'photo', 'finding', 'lab', 'consent', 'invoice', 'other']);
const ALLOWED_DOCUMENT_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/dicom', 'application/octet-stream']);
const ALLOWED_SCAN_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.dcm', '.dicom']);
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;
const uploadRoot = path.resolve(__dirname, process.env.UPLOAD_DIR || './uploads');
const scannerInboxDir = path.resolve(__dirname, process.env.SCANNER_IMPORT_DIR || './data/scanner-inbox');

function normalizeDocumentType(value) {
  const type = cleanText(value, { max: 40 }) || 'other';
  return DOCUMENT_TYPES.has(type) ? type : 'other';
}

function normalizeBoolean(value) {
  return value === true || value === 1 || value === '1' || String(value || '').toLowerCase() === 'true' ? 1 : 0;
}

function serializeMedicalProfile(row, patientId) {
  return {
    patientId: Number(row?.patient_id || patientId),
    bloodType: row?.blood_type || '',
    allergies: row?.allergies || '',
    medications: row?.medications || '',
    chronicConditions: row?.chronic_conditions || '',
    contraindications: row?.contraindications || '',
    previousSurgeries: row?.previous_surgeries || '',
    pregnancyStatus: row?.pregnancy_status || '',
    smoker: Boolean(row?.smoker),
    diabetes: Boolean(row?.diabetes),
    highBloodPressure: Boolean(row?.high_blood_pressure),
    heartCondition: Boolean(row?.heart_condition),
    anesthesiaWarning: row?.anesthesia_warning || '',
    dentalNotes: row?.dental_notes || '',
    internalNotes: row?.internal_notes || '',
    updatedAt: row?.updated_at || null
  };
}

function serializeDocument(row) {
  return {
    id: row.id,
    patientId: row.patient_id,
    visitRecordId: row.visit_record_id,
    documentType: row.document_type,
    title: row.title,
    description: row.description || '',
    documentDate: row.document_date || '',
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    fileSize: Number(row.file_size || 0),
    source: row.source,
    imagingModality: row.imaging_modality || '',
    toothNumber: row.tooth_number || '',
    acquisitionDate: row.acquisition_date || '',
    dicomStudyUid: row.dicom_study_uid || '',
    aiFindings: row.ai_findings ? safeJsonParse(row.ai_findings, []) : [],
    claimAttachmentReady: Boolean(row.claim_attachment_ready),
    createdAt: row.created_at
  };
}

function safeExtension(filename, mimeType) {
  const ext = path.extname(filename || '').toLowerCase();
  if (ALLOWED_SCAN_EXTENSIONS.has(ext)) return ext;
  if (mimeType === 'application/pdf') return '.pdf';
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'application/dicom') return '.dcm';
  return '';
}

function mimeFromExtension(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.dcm' || ext === '.dicom') return 'application/dicom';
  return 'application/octet-stream';
}

function detectedDocumentMime(buffer, filename) {
  if (!buffer || buffer.length < 4) return null;
  const ext = path.extname(filename || '').toLowerCase();
  if (buffer.subarray(0, 4).toString() === '%PDF') return 'application/pdf';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (
    buffer.subarray(0, 4).toString() === 'RIFF'
    && buffer.length >= 12
    && buffer.subarray(8, 12).toString() === 'WEBP'
  ) return 'image/webp';
  if (buffer.length > 132 && buffer.subarray(128, 132).toString() === 'DICM') return 'application/dicom';
  if (ext === '.dcm' || ext === '.dicom') return 'application/dicom';
  return null;
}

function documentMimeMatches({ declaredMime, detectedMime }) {
  if (!detectedMime) return false;
  if (declaredMime === detectedMime) return true;
  return declaredMime === 'application/octet-stream' && detectedMime === 'application/dicom';
}

async function patientUploadDir(patientId) {
  const dir = path.join(uploadRoot, 'patients', String(patientId));
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

function uniqueStoredFilename(originalFilename, mimeType) {
  const ext = safeExtension(originalFilename, mimeType);
  return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
}

async function savePatientDocument({ patientId, visitRecordId, documentType, title, description, documentDate, originalFilename, mimeType, buffer, source, userId, imagingModality, toothNumber, acquisitionDate, dicomStudyUid, claimAttachmentReady }) {
  if (!rowExists('patients', patientId)) {
    const error = new Error('Patient not found');
    error.status = 404;
    throw error;
  }
  if (visitRecordId && !rowExists('visit_records', visitRecordId)) {
    const error = new Error('Visit record not found');
    error.status = 404;
    throw error;
  }
  if (!ALLOWED_DOCUMENT_MIME.has(mimeType)) {
    const error = new Error('Dozvoljeni su PDF, JPG, PNG, WEBP i DICOM fajlovi.');
    error.status = 400;
    throw error;
  }
  if (!buffer || buffer.length === 0 || buffer.length > MAX_DOCUMENT_SIZE) {
    const error = new Error('Fajl mora biti manji od 10 MB.');
    error.status = 400;
    throw error;
  }
  const detectedMime = detectedDocumentMime(buffer, originalFilename);
  if (!documentMimeMatches({ declaredMime: mimeType, detectedMime })) {
    const error = new Error('Sadrzaj fajla ne odgovara dozvoljenom tipu dokumenta.');
    error.status = 400;
    throw error;
  }

  const storedFilename = uniqueStoredFilename(originalFilename, mimeType);
  const targetPath = path.join(await patientUploadDir(patientId), storedFilename);
  await fsp.writeFile(targetPath, buffer, { flag: 'wx' });
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');

  const result = db.prepare(`
    INSERT INTO patient_documents (
      patient_id, visit_record_id, document_type, title, description, document_date,
      original_filename, stored_filename, file_path, mime_type, file_size, file_hash, source, uploaded_by,
      imaging_modality, tooth_number, acquisition_date, dicom_study_uid, claim_attachment_ready
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    patientId,
    visitRecordId || null,
    normalizeDocumentType(documentType),
    cleanText(title || originalFilename, { max: 160, required: true }),
    cleanText(description, { max: 1000 }),
    cleanText(documentDate, { max: 20 }),
    cleanText(originalFilename, { max: 255, required: true }),
    storedFilename,
    targetPath,
    mimeType,
    buffer.length,
    hash,
    source || 'upload',
    userId,
    cleanText(imagingModality, { max: 40 }),
    cleanText(toothNumber, { max: 40 }),
    cleanText(acquisitionDate || documentDate, { max: 20 }),
    cleanText(dicomStudyUid, { max: 120 }),
    normalizeBoolean(claimAttachmentReady)
  );

  return serializeDocument(db.prepare('SELECT * FROM patient_documents WHERE id = ?').get(result.lastInsertRowid));
}

async function latestScannerFile() {
  await fsp.mkdir(scannerInboxDir, { recursive: true });
  const entries = await fsp.readdir(scannerInboxDir);
  const files = await Promise.all(entries.map(async (name) => {
    const filePath = path.join(scannerInboxDir, name);
    try {
      const stat = await fsp.stat(filePath);
      return { name, filePath, stat };
    } catch {
      return null;
    }
  }));
  return files
    .filter(file => file && file.stat.isFile() && ALLOWED_SCAN_EXTENSIONS.has(path.extname(file.name).toLowerCase()))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0] || null;
}

// ============ AUTHENTICATION ENDPOINTS ============

app.post('/api/auth/login', loginLimiter, validateBody(loginSchema), async (req, res) => {
  try {
    const email = String(req.body.email).toLowerCase();
    const password = String(req.body.password);
    const selectedRole = cleanText(req.body.role, { max: 32 });
    const twoFactorCode = cleanText(req.body.twoFactorCode, { max: 16 });

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (user && isUserLocked(user)) {
      return res.status(423).json({ error: 'Account is temporarily locked. Try again later.' });
    }

    if (!user || !(await bcryptCompare(password, user.password_hash))) {
      registerFailedLogin(user, req);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (selectedRole && user.role !== selectedRole) {
      registerFailedLogin(user, req);
      return res.status(403).json({ error: 'Selected role does not match this account' });
    }

    if (user.two_factor_enabled && !verifyTotp(user.two_factor_secret, twoFactorCode)) {
      auditLog({ userId: user.id, action: 'two_factor_required', entityType: 'user', entityId: user.id, req });
      return res.status(401).json({
        error: twoFactorCode ? 'Invalid two-factor code' : 'Two-factor code required',
        requires2fa: true,
        userId: user.id
      });
    }

    clearFailedLogins(user.id);
    auditLog({ userId: user.id, action: 'login_success', entityType: 'user', entityId: user.id, req });
    res.json(issueSession(user, req, res));
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/verify', authenticateToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

app.post('/api/auth/refresh', (req, res) => {
  try {
    const refreshToken = String(req.body.refreshToken || parseCookies(req).drrosa_refresh || '');
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });
    const row = db.prepare(`
      SELECT rt.*, u.email, u.name, u.role, u.two_factor_enabled
      FROM refresh_tokens rt
      JOIN users u ON u.id = rt.user_id
      WHERE rt.token_hash = ?
    `).get(hashToken(refreshToken));
    if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    db.prepare('UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
    const session = issueSession({
      id: row.user_id,
      email: row.email,
      name: row.name,
      role: row.role,
      two_factor_enabled: row.two_factor_enabled
    }, req, res);
    res.json(session);
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/logout', authenticateToken, (req, res) => {
  try {
    const refreshToken = String(req.body.refreshToken || parseCookies(req).drrosa_refresh || '');
    if (refreshToken) {
      db.prepare('UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ?').run(hashToken(refreshToken));
    }
    auditLog({ userId: req.user.id, action: 'logout', entityType: 'user', entityId: req.user.id, req });
    try {
      res.clearCookie('drrosa_access', { path: '/api' });
      res.clearCookie('drrosa_refresh', { path: '/api' });
    } catch (e) {
      // ignore
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/change-password', authenticateToken, validateBody(changePasswordSchema), async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword);
    const newPassword = String(req.body.newPassword);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user || !(await bcryptCompare(currentPassword, user.password_hash))) {
      return res.status(401).json({ error: 'Current password is not correct' });
    }
    const newHash = await bcryptHash(newPassword, 12);
    db.prepare(`
      UPDATE users
      SET password_hash = ?, password_changed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newHash, req.user.id);
    db.prepare('UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(req.user.id);
    auditLog({ userId: req.user.id, action: 'password_changed', entityType: 'user', entityId: req.user.id, req });
    res.json({ success: true });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ PATIENTS ENDPOINTS ============

app.get('/api/patients', authenticateToken, requirePermission('patients:read'), (_req, res) => {
  try {
    const patients = db.prepare(`
      SELECT id, first_name, last_name, date_of_birth, gender, email, phone, address,
             emergency_contact, medical_history, created_at
      FROM patients
      ORDER BY created_at DESC
    `).all();
    res.json(patients);
  } catch (error) {
    console.error('Get patients error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/patients/:id', authenticateToken, requirePermission('patients:read'), (req, res) => {
  try {
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    res.json(patient);
  } catch (error) {
    console.error('Get patient error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/patients', authenticateToken, requirePermission('patients:write'), validateBody(patientCreateSchema), (req, res) => {
  try {
    const first_name = cleanText(req.body.first_name, { max: 80, required: true });
    const last_name = cleanText(req.body.last_name, { max: 80, required: true });
    const date_of_birth = cleanText(req.body.date_of_birth, { max: 20 });
    const gender = cleanText(req.body.gender, { max: 30 });
    const email = cleanText(req.body.email, { max: 255 });
    const phone = cleanText(req.body.phone, { max: 50 });
    const address = cleanText(req.body.address, { max: 255 });
    const emergency_contact = cleanText(req.body.emergency_contact, { max: 255 });
    const medical_history = cleanText(req.body.medical_history, { max: 2000 });

    if (!first_name || !last_name) {
      return res.status(400).json({ error: 'First name and last name required' });
    }

    const result = db.prepare(`
      INSERT INTO patients (first_name, last_name, date_of_birth, gender, email, phone, address, emergency_contact, medical_history)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      first_name,
      last_name,
      nullable(date_of_birth),
      nullable(gender),
      nullable(email),
      nullable(phone),
      nullable(address),
      nullable(emergency_contact),
      nullable(medical_history)
    );

    const patient = db.prepare(`
      SELECT id, first_name, last_name, email, phone, created_at
      FROM patients
      WHERE id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json(patient);
  } catch (error) {
    console.error('Create patient error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/patients/:id', authenticateToken, requirePermission('patients:write'), validateBody(patientUpdateSchema), (req, res) => {
  try {
    const current = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
    if (!current) return res.status(404).json({ error: 'Patient not found' });

    const data = { ...current, ...req.body };
    const firstName = cleanText(data.first_name, { max: 80, required: true });
    const lastName = cleanText(data.last_name, { max: 80, required: true });
    if (!firstName || !lastName) {
      return res.status(400).json({ error: 'First name and last name required' });
    }

    db.prepare(`
      UPDATE patients
      SET first_name = ?,
          last_name = ?,
          date_of_birth = ?,
          gender = ?,
          email = ?,
          phone = ?,
          address = ?,
          emergency_contact = ?,
          medical_history = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      firstName,
      lastName,
      cleanText(data.date_of_birth, { max: 20 }),
      cleanText(data.gender, { max: 30 }),
      cleanText(data.email, { max: 255 }),
      cleanText(data.phone, { max: 50 }),
      cleanText(data.address, { max: 255 }),
      cleanText(data.emergency_contact, { max: 255 }),
      cleanText(data.medical_history, { max: 2000 }),
      req.params.id
    );

    res.json(db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id));
  } catch (error) {
    console.error('Update patient error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/patients/:id', authenticateToken, requirePermission('patients:write'), (req, res) => {
  try {
    const current = db.prepare('SELECT id FROM patients WHERE id = ?').get(req.params.id);
    if (!current) return res.status(404).json({ error: 'Patient not found' });

    const relatedRecords = db.prepare('SELECT COUNT(*) as count FROM visit_records WHERE patient_id = ?').get(req.params.id).count || 0;
    const relatedPayments = db.prepare('SELECT COUNT(*) as count FROM payments WHERE patient_id = ?').get(req.params.id).count || 0;
    if (relatedRecords > 0 || relatedPayments > 0) {
      return res.status(409).json({
        error: 'Pacijent ima povezanu istoriju/posete i ne može biti obrisan dok se ti zapisi ne uklone.',
        related: {
          records: Number(relatedRecords),
          payments: Number(relatedPayments)
        }
      });
    }

    db.prepare('DELETE FROM patients WHERE id = ?').run(req.params.id);
    res.json({ id: Number(req.params.id), message: 'Patient deleted successfully' });
  } catch (error) {
    console.error('Delete patient error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ PATIENT MEDICAL PROFILE / DOCUMENTS ============

app.get('/api/patients/:id/medical-profile', authenticateToken, requirePermission('patients:read'), (req, res) => {
  try {
    const patientId = positiveInteger(req.params.id);
    if (!patientId || !rowExists('patients', patientId)) return res.status(404).json({ error: 'Patient not found' });
    const row = db.prepare('SELECT * FROM patient_medical_profiles WHERE patient_id = ?').get(patientId);
    res.json(serializeMedicalProfile(row, patientId));
  } catch (error) {
    console.error('Get medical profile error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/patients/:id/medical-profile', authenticateToken, requirePermission('patients:write'), (req, res) => {
  try {
    const patientId = positiveInteger(req.params.id);
    if (!patientId || !rowExists('patients', patientId)) return res.status(404).json({ error: 'Patient not found' });

    db.prepare(`
      INSERT INTO patient_medical_profiles (
        patient_id, blood_type, allergies, medications, chronic_conditions, contraindications,
        previous_surgeries, pregnancy_status, smoker, diabetes, high_blood_pressure,
        heart_condition, anesthesia_warning, dental_notes, internal_notes, updated_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(patient_id) DO UPDATE SET
        blood_type = excluded.blood_type,
        allergies = excluded.allergies,
        medications = excluded.medications,
        chronic_conditions = excluded.chronic_conditions,
        contraindications = excluded.contraindications,
        previous_surgeries = excluded.previous_surgeries,
        pregnancy_status = excluded.pregnancy_status,
        smoker = excluded.smoker,
        diabetes = excluded.diabetes,
        high_blood_pressure = excluded.high_blood_pressure,
        heart_condition = excluded.heart_condition,
        anesthesia_warning = excluded.anesthesia_warning,
        dental_notes = excluded.dental_notes,
        internal_notes = excluded.internal_notes,
        updated_by = excluded.updated_by,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      patientId,
      cleanText(req.body.bloodType || req.body.blood_type, { max: 20 }),
      cleanText(req.body.allergies, { max: 2000 }),
      cleanText(req.body.medications, { max: 2000 }),
      cleanText(req.body.chronicConditions || req.body.chronic_conditions, { max: 2000 }),
      cleanText(req.body.contraindications, { max: 2000 }),
      cleanText(req.body.previousSurgeries || req.body.previous_surgeries, { max: 2000 }),
      cleanText(req.body.pregnancyStatus || req.body.pregnancy_status, { max: 255 }),
      normalizeBoolean(req.body.smoker),
      normalizeBoolean(req.body.diabetes),
      normalizeBoolean(req.body.highBloodPressure || req.body.high_blood_pressure),
      normalizeBoolean(req.body.heartCondition || req.body.heart_condition),
      cleanText(req.body.anesthesiaWarning || req.body.anesthesia_warning, { max: 2000 }),
      cleanText(req.body.dentalNotes || req.body.dental_notes, { max: 2000 }),
      cleanText(req.body.internalNotes || req.body.internal_notes, { max: 2000 }),
      req.user.id
    );

    const row = db.prepare('SELECT * FROM patient_medical_profiles WHERE patient_id = ?').get(patientId);
    res.json(serializeMedicalProfile(row, patientId));
  } catch (error) {
    console.error('Update medical profile error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/patients/:id/documents', authenticateToken, requirePermission('documents:read'), (req, res) => {
  try {
    const patientId = positiveInteger(req.params.id);
    if (!patientId || !rowExists('patients', patientId)) return res.status(404).json({ error: 'Patient not found' });
    const rows = db.prepare(`
      SELECT * FROM patient_documents
      WHERE patient_id = ? AND is_deleted = 0
      ORDER BY created_at DESC, id DESC
    `).all(patientId);
    res.json(rows.map(serializeDocument));
  } catch (error) {
    console.error('Get patient documents error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/patients/:id/documents', authenticateToken, requirePermission('documents:write'), validateBody(patientDocumentSchema), async (req, res) => {
  try {
    const patientId = positiveInteger(req.params.id);
    const base64 = String(req.body.fileBase64 || '').replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');
    const document = await savePatientDocument({
      patientId,
      visitRecordId: positiveInteger(req.body.visitRecordId || req.body.visit_record_id),
      documentType: req.body.documentType || req.body.document_type,
      title: req.body.title,
      description: req.body.description,
      documentDate: req.body.documentDate || req.body.document_date,
      originalFilename: cleanText(req.body.originalFilename || req.body.original_filename, { max: 255, required: true }),
      mimeType: cleanText(req.body.mimeType || req.body.mime_type, { max: 100, required: true }),
      buffer,
      source: 'upload',
      userId: req.user.id,
      imagingModality: req.body.imagingModality || req.body.imaging_modality,
      toothNumber: req.body.toothNumber || req.body.tooth_number,
      acquisitionDate: req.body.acquisitionDate || req.body.acquisition_date,
      dicomStudyUid: req.body.dicomStudyUid || req.body.dicom_study_uid,
      claimAttachmentReady: req.body.claimAttachmentReady || req.body.claim_attachment_ready
    });
    res.status(201).json(document);
  } catch (error) {
    console.error('Create patient document error:', error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Server error' });
  }
});

app.post('/api/patients/:id/documents/import-scan', authenticateToken, requirePermission('documents:write'), validateBody(importScanSchema), async (req, res) => {
  try {
    const patientId = positiveInteger(req.params.id);
    const scan = await latestScannerFile();
    if (!scan) return res.status(404).json({ error: `Nema skeniranih PDF/slika u folderu: ${scannerInboxDir}` });

    const buffer = await fsp.readFile(scan.filePath);
    const document = await savePatientDocument({
      patientId,
      visitRecordId: positiveInteger(req.body.visitRecordId || req.body.visit_record_id),
      documentType: req.body.documentType || req.body.document_type,
      title: req.body.title || scan.name,
      description: req.body.description,
      documentDate: req.body.documentDate || req.body.document_date,
      originalFilename: scan.name,
      mimeType: mimeFromExtension(scan.name),
      buffer,
      source: 'scanner',
      userId: req.user.id,
      imagingModality: req.body.imagingModality || req.body.imaging_modality,
      toothNumber: req.body.toothNumber || req.body.tooth_number,
      acquisitionDate: req.body.acquisitionDate || req.body.acquisition_date,
      dicomStudyUid: req.body.dicomStudyUid || req.body.dicom_study_uid,
      claimAttachmentReady: req.body.claimAttachmentReady || req.body.claim_attachment_ready
    });

    const importedDir = path.join(scannerInboxDir, 'imported');
    await fsp.mkdir(importedDir, { recursive: true });
    await fsp.rename(scan.filePath, path.join(importedDir, `${Date.now()}-${scan.name}`));

    res.status(201).json(document);
  } catch (error) {
    console.error('Import scan error:', error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Server error' });
  }
});

app.get('/api/documents/:id/view', authenticateToken, requirePermission('documents:read'), async (req, res) => {
  try {
    const documentId = positiveInteger(req.params.id);
    const row = db.prepare('SELECT * FROM patient_documents WHERE id = ? AND is_deleted = 0').get(documentId);
    if (!row) return res.status(404).json({ error: 'Document not found' });
    try {
      await fsp.access(row.file_path);
    } catch {
      return res.status(404).json({ error: 'File not found' });
    }
    res.setHeader('Content-Type', row.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${row.original_filename.replace(/"/g, '')}"`);
    res.sendFile(row.file_path);
  } catch (error) {
    console.error('View document error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/documents/:id/download', authenticateToken, requirePermission('documents:read'), async (req, res) => {
  try {
    const documentId = positiveInteger(req.params.id);
    const row = db.prepare('SELECT * FROM patient_documents WHERE id = ? AND is_deleted = 0').get(documentId);
    if (!row) return res.status(404).json({ error: 'Document not found' });
    try {
      await fsp.access(row.file_path);
    } catch {
      return res.status(404).json({ error: 'File not found' });
    }
    res.download(row.file_path, row.original_filename);
  } catch (error) {
    console.error('Download document error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/documents/:id', authenticateToken, requirePermission('documents:write'), (req, res) => {
  try {
    const documentId = positiveInteger(req.params.id);
    const row = db.prepare('SELECT id FROM patient_documents WHERE id = ? AND is_deleted = 0').get(documentId);
    if (!row) return res.status(404).json({ error: 'Document not found' });
    db.prepare('UPDATE patient_documents SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(documentId);
    res.json({ id: documentId, message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/documents/:id', authenticateToken, requirePermission('documents:write'), (req, res) => {
  try {
    const documentId = positiveInteger(req.params.id);
    const current = db.prepare('SELECT * FROM patient_documents WHERE id = ? AND is_deleted = 0').get(documentId);
    if (!current) return res.status(404).json({ error: 'Dokument nije pronadjen' });

    db.prepare(`
      UPDATE patient_documents
      SET visit_record_id = ?, document_type = ?, title = ?, description = ?, document_date = ?,
          imaging_modality = ?, tooth_number = ?, acquisition_date = ?, dicom_study_uid = ?,
          claim_attachment_ready = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      positiveInteger(req.body.visitRecordId || req.body.visit_record_id) || null,
      normalizeDocumentType(req.body.documentType || req.body.document_type || current.document_type),
      cleanText(req.body.title ?? current.title, { max: 160, required: true }),
      cleanText(req.body.description ?? current.description, { max: 1000 }),
      cleanText(req.body.documentDate ?? req.body.document_date ?? current.document_date, { max: 20 }),
      cleanText(req.body.imagingModality ?? req.body.imaging_modality ?? current.imaging_modality, { max: 40 }),
      cleanText(req.body.toothNumber ?? req.body.tooth_number ?? current.tooth_number, { max: 40 }),
      cleanText(req.body.acquisitionDate ?? req.body.acquisition_date ?? current.acquisition_date, { max: 20 }),
      cleanText(req.body.dicomStudyUid ?? req.body.dicom_study_uid ?? current.dicom_study_uid, { max: 120 }),
      req.body.claimAttachmentReady === undefined && req.body.claim_attachment_ready === undefined
        ? current.claim_attachment_ready
        : normalizeBoolean(req.body.claimAttachmentReady ?? req.body.claim_attachment_ready),
      documentId
    );
    auditLog({ userId: req.user.id, action: 'document_updated', entityType: 'document', entityId: documentId, req });
    res.json(serializeDocument(db.prepare('SELECT * FROM patient_documents WHERE id = ?').get(documentId)));
  } catch (error) {
    console.error('Update document error:', error);
    res.status(500).json({ error: 'Dokument nije sačuvan.' });
  }
});

app.get('/api/patients/:id/imaging', authenticateToken, requirePermission('documents:read'), (req, res) => {
  try {
    const patientId = positiveInteger(req.params.id);
    if (!patientId || !rowExists('patients', patientId)) return res.status(404).json({ error: 'Patient not found' });
    const rows = db.prepare(`
      SELECT * FROM patient_documents
      WHERE patient_id = ?
        AND is_deleted = 0
        AND (document_type IN ('rtg', 'ortopan', 'photo') OR imaging_modality IS NOT NULL OR dicom_study_uid IS NOT NULL)
      ORDER BY COALESCE(acquisition_date, document_date, created_at) DESC, id DESC
    `).all(patientId);
    res.json(rows.map(serializeDocument));
  } catch (error) {
    console.error('Get imaging error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/documents/:id/imaging', authenticateToken, requirePermission('documents:write'), (req, res) => {
  try {
    const documentId = positiveInteger(req.params.id);
    const current = db.prepare('SELECT * FROM patient_documents WHERE id = ? AND is_deleted = 0').get(documentId);
    if (!current) return res.status(404).json({ error: 'Document not found' });
    db.prepare(`
      UPDATE patient_documents
      SET imaging_modality = ?, tooth_number = ?, acquisition_date = ?, dicom_study_uid = ?,
          claim_attachment_ready = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      cleanText(req.body.imagingModality || req.body.imaging_modality || current.imaging_modality, { max: 40 }),
      cleanText(req.body.toothNumber || req.body.tooth_number || current.tooth_number, { max: 40 }),
      cleanText(req.body.acquisitionDate || req.body.acquisition_date || current.acquisition_date, { max: 20 }),
      cleanText(req.body.dicomStudyUid || req.body.dicom_study_uid || current.dicom_study_uid, { max: 120 }),
      req.body.claimAttachmentReady === undefined && req.body.claim_attachment_ready === undefined
        ? current.claim_attachment_ready
        : normalizeBoolean(req.body.claimAttachmentReady || req.body.claim_attachment_ready),
      documentId
    );
    auditLog({ userId: req.user.id, action: 'imaging_metadata_updated', entityType: 'document', entityId: documentId, req });
    res.json(serializeDocument(db.prepare('SELECT * FROM patient_documents WHERE id = ?').get(documentId)));
  } catch (error) {
    console.error('Update imaging metadata error:', error);
    res.status(500).json({ error: 'Metapodaci snimka nije sačuvan.' });
  }
});

app.post('/api/documents/:id/imaging/analyze', authenticateToken, requirePermission('documents:write'), (req, res) => {
  try {
    const documentId = positiveInteger(req.params.id);
    const current = db.prepare('SELECT * FROM patient_documents WHERE id = ? AND is_deleted = 0').get(documentId);
    if (!current) return res.status(404).json({ error: 'Document not found' });
    const findings = [
      {
        type: current.document_type === 'ortopan' ? 'panoramic_review' : 'radiology_review',
        severity: current.tooth_number ? 'medium' : 'low',
        toothNumber: current.tooth_number || '',
        note: current.tooth_number
          ? `AI preliminarno oznacava snimak za zub ${current.tooth_number}; potrebno je klinicko potvrdjivanje.`
          : 'AI preliminarni pregled nije pronasao hitnu oznaku; potrebno je klinicko potvrdjivanje.'
      }
    ];
    db.prepare(`
      UPDATE patient_documents
      SET ai_findings = ?, claim_attachment_ready = 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(JSON.stringify(findings), documentId);
    auditLog({ userId: req.user.id, action: 'imaging_ai_reviewed', entityType: 'document', entityId: documentId, req });
    res.json(serializeDocument(db.prepare('SELECT * FROM patient_documents WHERE id = ?').get(documentId)));
  } catch (error) {
    console.error('Analyze imaging error:', error);
    res.status(500).json({ error: 'AI analiza nije uspela.' });
  }
});

// ============ VISIT RECORDS ENDPOINTS ============

app.get('/api/records', authenticateToken, requirePermission('records:read'), (_req, res) => {
  try {
    const records = db.prepare(`
      SELECT
        vr.id,
        vr.visit_date,
        vr.procedure,
        vr.status,
        vr.shift,
        p.id as patient_id,
        p.first_name,
        p.last_name,
        d.id as doctor_id,
        d.name as doctor_name,
        COALESCE(pay.amount, 0) as amount_due,
        COALESCE(pay.amount_paid, 0) as amount_paid,
        COALESCE(pay.currency, 'EUR') as currency,
        pay.payment_status,
        vr.notes
      FROM visit_records vr
      JOIN patients p ON vr.patient_id = p.id
      JOIN doctors d ON vr.doctor_id = d.id
      LEFT JOIN payments pay ON vr.id = pay.visit_record_id
      ORDER BY vr.visit_date DESC, vr.id DESC
    `).all();

    const getTreatments = db.prepare(`
      SELECT tooth_number, treatment_type, status, notes, price, discount, discount_type, discount_value
      FROM treatments
      WHERE visit_record_id = ?
    `);

    res.json(records.map(record => {
      const treatments = {};
      let treatmentTotal = 0;
      getTreatments.all(record.id).forEach(treatment => {
        if (!treatments[treatment.tooth_number]) treatments[treatment.tooth_number] = [];
        treatmentTotal += Math.max(0, Number(treatment.price || 0) - Number(treatment.discount || 0));
        treatments[treatment.tooth_number].push({
          type: treatment.treatment_type,
          status: treatment.status,
          note: treatment.notes,
          price: Number(treatment.price || 0),
          discount: Number(treatment.discount || 0),
          discountType: treatment.discount_type || 'amount',
          discountValue: Number(treatment.discount_value ?? treatment.discount ?? 0)
        });
      });
      const inferredPaid = Math.max(0, treatmentTotal - Number(record.amount_due || 0));
      return { ...record, amount_paid: Number(record.amount_paid || inferredPaid || 0), treatments };
    }));
  } catch (error) {
    console.error('Get records error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

function insertRecordTransaction(record) {
  db.exec('BEGIN');
  try {
  const patientId = positiveInteger(record.patient_id);
  const doctorId = positiveInteger(record.doctor_id);
  const visitResult = db.prepare(`
    INSERT INTO visit_records (patient_id, doctor_id, visit_date, procedure, status, shift, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    patientId,
    doctorId,
    cleanText(record.visit_date, { max: 20, required: true }),
    cleanText(record.procedure, { max: 255, required: true }),
    normalizeStatus(record.status),
    normalizeShift(record.shift),
    cleanText(record.notes, { max: 2000 })
  );

  const visitId = visitResult.lastInsertRowid;

  db.prepare(`
    INSERT INTO payments (visit_record_id, patient_id, amount, amount_paid, currency, payment_status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    visitId,
    patientId,
    Math.max(0, Number(record.amount || 0)),
    Math.max(0, Number(record.amount_paid ?? record.amountPaid ?? 0)),
    normalizeCurrency(record.currency),
    normalizePaymentStatus(record.payment_status)
  );

  if (record.treatments && typeof record.treatments === 'object') {
    const insertTreatment = db.prepare(`
      INSERT INTO treatments (visit_record_id, tooth_number, treatment_type, status, notes, price, discount, discount_type, discount_value)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    Object.entries(record.treatments).forEach(([toothNumber, treatments]) => {
      const treatmentList = Array.isArray(treatments) ? treatments : [treatments];
      treatmentList.forEach(treatment => {
        const price = Math.max(0, Number(treatment.price || 0));
        const discountType = treatment.discountType === 'percent' || treatment.discount_type === 'percent' ? 'percent' : 'amount';
        const rawDiscountValue = Number(treatment.discountValue ?? treatment.discount_value ?? treatment.discount ?? 0);
        const discountValue = discountType === 'percent'
          ? Math.min(100, Math.max(0, rawDiscountValue))
          : Math.max(0, rawDiscountValue);
        const discount = discountType === 'percent'
          ? Math.min(price, price * discountValue / 100)
          : Math.min(price, discountValue);
        insertTreatment.run(
          visitId,
          cleanText(toothNumber, { max: 10 }),
          cleanText(treatment.type, { max: 255, required: true }),
          normalizeStatus(treatment.status || 'Planirano'),
          cleanText(treatment.note, { max: 1000 }),
          price,
          discount,
          discountType,
          discountValue
        );
      });
    });
  }

    db.exec('COMMIT');
    return visitId;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

app.post('/api/records', authenticateToken, requirePermission('records:write'), validateBody(recordCreateSchema), (req, res) => {
  try {
    const patient_id = positiveInteger(req.body.patient_id);
    const doctor_id = positiveInteger(req.body.doctor_id);
    const visit_date = cleanText(req.body.visit_date, { max: 20, required: true });
    const procedure = cleanText(req.body.procedure, { max: 255, required: true });
    if (!patient_id || !doctor_id || !visit_date || !procedure) {
      return res.status(400).json({ error: 'Patient, doctor, date and procedure required' });
    }
    if (!rowExists('patients', patient_id)) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    if (!rowExists('doctors', doctor_id)) {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    const visitId = insertRecordTransaction({ ...req.body, patient_id, doctor_id, visit_date, procedure });
    res.status(201).json({ id: visitId, message: 'Record created successfully' });
  } catch (error) {
    console.error('Create record error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/records/:id', authenticateToken, requirePermission('records:write'), (req, res) => {
  try {
    const current = db.prepare('SELECT * FROM visit_records WHERE id = ?').get(req.params.id);
    if (!current) return res.status(404).json({ error: 'Record not found' });

    const data = { ...current, ...req.body };
    const procedure = cleanText(data.procedure, { max: 255, required: true });
    if (!procedure) {
      return res.status(400).json({ error: 'Procedure required' });
    }

    db.prepare(`
      UPDATE visit_records
      SET procedure = ?, status = ?, shift = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(procedure, normalizeStatus(data.status), normalizeShift(data.shift), cleanText(data.notes, { max: 2000 }), req.params.id);

    if (
      req.body.amount !== undefined
      || req.body.amount_paid !== undefined
      || req.body.amountPaid !== undefined
      || req.body.currency !== undefined
      || req.body.payment_status !== undefined
    ) {
      db.prepare(`
        UPDATE payments
        SET amount = ?, amount_paid = ?, currency = ?, payment_status = ?
        WHERE visit_record_id = ?
      `).run(
        Math.max(0, Number(req.body.amount ?? 0)),
        Math.max(0, Number(req.body.amount_paid ?? req.body.amountPaid ?? 0)),
        normalizeCurrency(req.body.currency),
        normalizePaymentStatus(req.body.payment_status),
        req.params.id
      );
    }

    res.json({ id: Number(req.params.id), message: 'Record updated successfully' });
  } catch (error) {
    console.error('Update record error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/records/:id', authenticateToken, requirePermission('records:write'), (req, res) => {
  try {
    const current = db.prepare('SELECT id FROM visit_records WHERE id = ?').get(req.params.id);
    if (!current) return res.status(404).json({ error: 'Record not found' });

    db.prepare('DELETE FROM visit_records WHERE id = ?').run(req.params.id);
    res.json({ id: Number(req.params.id), message: 'Record deleted successfully' });
  } catch (error) {
    console.error('Delete record error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ APPOINTMENTS / CALENDAR ENDPOINTS ============

app.get('/api/chairs', authenticateToken, requirePermission('calendar:read'), (_req, res) => {
  try {
    res.json(db.prepare('SELECT id, name, is_active FROM chairs WHERE is_active = 1 ORDER BY name').all());
  } catch (error) {
    console.error('Get chairs error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/appointments', authenticateToken, requirePermission('calendar:read'), (req, res) => {
  try {
    const from = normalizeIsoDateTime(req.query.from || '1970-01-01T00:00:00.000Z');
    const to = normalizeIsoDateTime(req.query.to || '2999-12-31T23:59:59.999Z');
    const doctorId = req.query.doctor_id ? positiveInteger(req.query.doctor_id) : null;
    const status = req.query.status ? normalizeAppointmentStatus(req.query.status) : null;
    if (!from || !to) return res.status(400).json({ error: 'Invalid date range' });

    const filters = ['a.starts_at < ?', 'a.ends_at > ?'];
    const params = [to, from];
    if (doctorId) {
      filters.push('a.doctor_id = ?');
      params.push(doctorId);
    }
    if (status) {
      filters.push('a.status = ?');
      params.push(status);
    }

    const rows = db.prepare(`
      SELECT
        a.*,
        p.first_name || ' ' || p.last_name as patient_name,
        d.name as doctor_name,
        c.name as chair_name
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      JOIN doctors d ON a.doctor_id = d.id
      JOIN chairs c ON a.chair_id = c.id
      WHERE ${filters.join(' AND ')}
      ORDER BY a.starts_at, a.id
    `).all(...params);
    res.json(rows.map(serializeAppointment));
  } catch (error) {
    console.error('Get appointments error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/appointments', authenticateToken, requirePermission('calendar:write'), (req, res) => {
  try {
    const patientId = positiveInteger(req.body.patient_id ?? req.body.patientId);
    const doctorId = positiveInteger(req.body.doctor_id ?? req.body.doctorId);
    const chairId = positiveInteger(req.body.chair_id ?? req.body.chairId);
    const procedureIdInput = positiveInteger(req.body.procedure_id ?? req.body.procedureId);
    const procedure = procedureByInput({
      procedureId: procedureIdInput,
      procedureName: req.body.procedure_name ?? req.body.procedureName
    });
    const procedureNameResult = validatedText(req.body.procedure_name ?? req.body.procedureName ?? procedure?.label, { field: 'Postupak', max: 255, required: true });
    const notesResult = validatedText(req.body.notes, { field: 'Napomena', max: 2000 });
    const textError = procedureNameResult.error || notesResult.error;
    if (textError) return res.status(400).json({ error: textError });
    const procedureName = procedureNameResult.value;
    const startsAt = normalizeIsoDateTime(req.body.starts_at ?? req.body.startsAt);
    const durationMinutes = Math.max(5, Math.min(480, Number(req.body.duration_minutes ?? req.body.durationMinutes ?? 30)));
    const endsAt = normalizeIsoDateTime(req.body.ends_at ?? req.body.endsAt) ||
      (startsAt ? new Date(new Date(startsAt).getTime() + durationMinutes * 60000).toISOString() : null);
    const status = normalizeAppointmentStatus(req.body.status);
    const notes = notesResult.value;

    if (!patientId || !doctorId || !chairId || !procedure || !procedureName || !startsAt || !endsAt) {
      return res.status(400).json({ error: 'Pacijent, doktor, stolica, datum i postupak su obavezni.' });
    }
    if (appointmentDurationMinutes(startsAt, endsAt) <= 0) return res.status(400).json({ error: 'End time must be after start time' });
    if (!rowExists('patients', patientId)) return res.status(404).json({ error: 'Patient not found' });
    if (!rowExists('doctors', doctorId)) return res.status(404).json({ error: 'Doctor not found' });
    if (!rowExists('chairs', chairId)) return res.status(404).json({ error: 'Chair not found' });

    const conflict = appointmentConflict({ doctorId, chairId, startsAt, endsAt });
    if (conflict) {
      return res.status(409).json({ error: 'Termin se preklapa sa postojećim zakazivanjem.', conflict });
    }

    const result = db.prepare(`
      INSERT INTO appointments (
        patient_id, doctor_id, chair_id, procedure_id, procedure_name, starts_at, ends_at,
        duration_minutes, status, notes, created_by, updated_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      patientId,
      doctorId,
      chairId,
      procedure.id,
      procedureName,
      startsAt,
      endsAt,
      appointmentDurationMinutes(startsAt, endsAt),
      status,
      notes,
      req.user.id,
      req.user.id
    );

    db.prepare('INSERT INTO appointment_status_history (appointment_id, old_status, new_status, changed_by) VALUES (?, NULL, ?, ?)')
      .run(result.lastInsertRowid, status, req.user.id);
    queueCalendarSync(result.lastInsertRowid, 'create_google_event');
    processCalendarSyncRed({ limit: 5 });
    res.status(201).json(serializeAppointment(appointmentById(result.lastInsertRowid)));
  } catch (error) {
    console.error('Create appointment error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/appointments/:id', authenticateToken, requirePermission('calendar:write'), (req, res) => {
  try {
    const current = appointmentById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Appointment not found' });

    const data = { ...current, ...req.body };
    const patientId = positiveInteger(data.patient_id ?? data.patientId);
    const doctorId = positiveInteger(data.doctor_id ?? data.doctorId);
    const chairId = positiveInteger(data.chair_id ?? data.chairId);
    const procedureIdInput = positiveInteger(data.procedure_id ?? data.procedureId);
    const procedure = procedureByInput({
      procedureId: procedureIdInput,
      procedureName: data.procedure_name ?? data.procedureName
    });
    const procedureNameResult = validatedText(data.procedure_name ?? data.procedureName ?? procedure?.label, { field: 'Postupak', max: 255, required: true });
    const notesResult = validatedText(data.notes, { field: 'Napomena', max: 2000 });
    const textError = procedureNameResult.error || notesResult.error;
    if (textError) return res.status(400).json({ error: textError });
    const procedureName = procedureNameResult.value;
    const startsAt = normalizeIsoDateTime(data.starts_at ?? data.startsAt);
    const endsAt = normalizeIsoDateTime(data.ends_at ?? data.endsAt);
    const status = normalizeAppointmentStatus(data.status);
    const notes = notesResult.value;

    if (!patientId || !doctorId || !chairId || !procedure || !procedureName || !startsAt || !endsAt) {
      return res.status(400).json({ error: 'Pacijent, doktor, stolica, datum i postupak su obavezni.' });
    }
    if (appointmentDurationMinutes(startsAt, endsAt) <= 0) return res.status(400).json({ error: 'End time must be after start time' });

    const conflict = appointmentConflict({ appointmentId: current.id, doctorId, chairId, startsAt, endsAt });
    if (conflict) {
      return res.status(409).json({ error: 'Termin se preklapa sa postojećim zakazivanjem.', conflict });
    }

    db.prepare(`
      UPDATE appointments
      SET patient_id = ?, doctor_id = ?, chair_id = ?, procedure_id = ?, procedure_name = ?,
          starts_at = ?, ends_at = ?, duration_minutes = ?, status = ?, notes = ?,
          updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      patientId,
      doctorId,
      chairId,
      procedure.id,
      procedureName,
      startsAt,
      endsAt,
      appointmentDurationMinutes(startsAt, endsAt),
      status,
      notes,
      req.user.id,
      current.id
    );
    if (current.status !== status) {
      db.prepare('INSERT INTO appointment_status_history (appointment_id, old_status, new_status, changed_by) VALUES (?, ?, ?, ?)')
        .run(current.id, current.status, status, req.user.id);
    }
    queueCalendarSync(current.id, status === 'cancelled' ? 'cancel_google_event' : 'update_google_event');
    processCalendarSyncRed({ limit: 5 });
    res.json(serializeAppointment(appointmentById(current.id)));
  } catch (error) {
    console.error('Update appointment error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.patch('/api/appointments/:id/status', authenticateToken, requirePermission('calendar:write'), (req, res) => {
  try {
    const current = appointmentById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Appointment not found' });
    const status = normalizeAppointmentStatus(req.body.status);
    db.prepare('UPDATE appointments SET status = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(status, req.user.id, current.id);
    db.prepare('INSERT INTO appointment_status_history (appointment_id, old_status, new_status, changed_by) VALUES (?, ?, ?, ?)')
      .run(current.id, current.status, status, req.user.id);
    queueCalendarSync(current.id, status === 'cancelled' ? 'cancel_google_event' : 'update_google_event');
    processCalendarSyncRed({ limit: 5 });
    res.json(serializeAppointment(appointmentById(current.id)));
  } catch (error) {
    console.error('Update appointment status error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/appointments/:id', authenticateToken, requirePermission('calendar:write'), (req, res) => {
  try {
    const current = appointmentById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Appointment not found' });
    if (req.query.hard === '1') {
      db.prepare('DELETE FROM appointments WHERE id = ?').run(current.id);
      return res.json({ id: Number(current.id), message: 'Appointment deleted successfully' });
    }
    db.prepare('UPDATE appointments SET status = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('cancelled', req.user.id, current.id);
    queueCalendarSync(current.id, 'cancel_google_event');
    processCalendarSyncRed({ limit: 5 });
    res.json({ id: Number(current.id), message: 'Appointment cancelled successfully' });
  } catch (error) {
    console.error('Delete appointment error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/appointments/:id/create-visit', authenticateToken, requirePermission('calendar:write'), requirePermission('records:write'), (req, res) => {
  try {
    const appointment = appointmentById(req.params.id);
    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });
    if (appointment.visit_record_id) {
      return res.status(409).json({ error: 'Visit already exists for this appointment', visitRecordId: appointment.visit_record_id });
    }

    const visitId = insertRecordTransaction({
      patient_id: appointment.patient_id,
      doctor_id: appointment.doctor_id,
      visit_date: appointment.starts_at.slice(0, 10),
      procedure: appointment.procedure_name,
      status: 'Završeno',
      notes: appointment.notes || `Termin ${appointment.starts_at}`,
      amount: req.body.amount || 0,
      currency: req.body.currency || 'EUR',
      payment_status: req.body.payment_status || 'Plaćeno',
      shift: req.body.shift || 'Prva smena',
      treatments: req.body.treatments || {}
    });
    db.prepare(`
      UPDATE appointments
      SET status = 'completed', visit_record_id = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(visitId, req.user.id, appointment.id);
    db.prepare('INSERT INTO appointment_status_history (appointment_id, old_status, new_status, changed_by) VALUES (?, ?, ?, ?)')
      .run(appointment.id, appointment.status, 'completed', req.user.id);
    queueCalendarSync(appointment.id, 'update_google_event');
    processCalendarSyncRed({ limit: 5 });
    res.status(201).json({ id: visitId, appointmentId: appointment.id, message: 'Visit created from appointment' });
  } catch (error) {
    console.error('Create visit from appointment error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ PUBLIC BOOKING ENDPOINTS ============

app.get('/api/public/booking/status', publicBookingReadLimiter, (_req, res) => {
  try {
    res.json({ enabled: isPublicBookingEnabled() });
  } catch (error) {
    console.error('Public booking status error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/public/booking/options', publicBookingReadLimiter, requirePublicBookingEnabled, (_req, res) => {
  try {
    res.json({
      doctors: db.prepare('SELECT id, name, specialization FROM doctors ORDER BY name').all(),
      procedures: db.prepare("SELECT id, value, label, price FROM codebook_items WHERE type = 'procedure' AND is_active = 1 ORDER BY sort_order, label").all()
    });
  } catch (error) {
    console.error('Public booking options error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/public/booking/availability', publicBookingReadLimiter, requirePublicBookingEnabled, (req, res) => {
  try {
    const dateText = cleanText(req.query.date, { max: 20, required: true });
    const doctorId = positiveInteger(req.query.doctor_id);
    const duration = Math.max(15, Math.min(180, Number(req.query.duration || 30)));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return res.status(400).json({ error: 'Valid date is required.' });
    const doctors = doctorId
      ? db.prepare('SELECT id, name FROM doctors WHERE id = ?').all(doctorId)
      : db.prepare('SELECT id, name FROM doctors ORDER BY name').all();
    const chair = db.prepare('SELECT id FROM chairs WHERE is_active = 1 ORDER BY id LIMIT 1').get();
    if (!chair) return res.json({ slots: [] });
    const slots = [];
    doctors.forEach(doctor => {
      for (let hour = 8; hour < 18; hour += 1) {
        ['00', '30'].forEach(minute => {
          const startsAt = normalizeIsoDateTime(`${dateText}T${String(hour).padStart(2, '0')}:${minute}:00`);
          const endsAt = addMinutes(new Date(startsAt), duration).toISOString();
          if (!appointmentConflict({ doctorId: doctor.id, chairId: chair.id, startsAt, endsAt })) {
            slots.push({ doctorId: doctor.id, doctorName: doctor.name, chairId: chair.id, startsAt, endsAt, durationMinutes: duration });
          }
        });
      }
    });
    res.json({ slots });
  } catch (error) {
    console.error('Public availability error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/public/booking', publicBookingWriteLimiter, requirePublicBookingEnabled, validateBody(publicBookingSchema), (req, res) => {
  try {
    const namePattern = /^[\p{L}][\p{L}\p{N}\s.'-]{0,79}$/u;
    const firstNameResult = validatedText(req.body.firstName || req.body.first_name, { field: 'Ime', max: 80, required: true, pattern: namePattern });
    const lastNameResult = validatedText(req.body.lastName || req.body.last_name, { field: 'Prezime', max: 80, required: true, pattern: namePattern });
    const emailResult = validatedText(req.body.email, { field: 'Email', max: 255, pattern: /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/ });
    const phoneResult = validatedPhone(req.body.phone, { required: true });
    const notesResult = validatedText(req.body.notes, { field: 'Napomena', max: 1000 });
    const textError = firstNameResult.error || lastNameResult.error || emailResult.error || phoneResult.error || notesResult.error;
    if (textError) return res.status(400).json({ error: textError });

    const firstName = firstNameResult.value;
    const lastName = lastNameResult.value;
    const email = emailResult.value;
    const phone = phoneResult.value;
    const doctorId = positiveInteger(req.body.doctorId || req.body.doctor_id);
    const chairId = positiveInteger(req.body.chairId || req.body.chair_id) || db.prepare('SELECT id FROM chairs WHERE is_active = 1 ORDER BY id LIMIT 1').get()?.id;
    const procedureId = positiveInteger(req.body.procedureId || req.body.procedure_id);
    const startsAt = normalizeIsoDateTime(req.body.startsAt || req.body.starts_at);
    const duration = Math.max(15, Math.min(180, Number(req.body.durationMinutes || req.body.duration_minutes || 30)));
    const endsAt = startsAt ? addMinutes(new Date(startsAt), duration).toISOString() : null;
    const procedure = procedureByInput({
      procedureId,
      procedureName: req.body.procedureName || req.body.procedure_name
    });
    const procedureNameResult = validatedText(req.body.procedureName || req.body.procedure_name || procedure?.label, { field: 'Postupak', max: 255, required: true });
    if (procedureNameResult.error) return res.status(400).json({ error: procedureNameResult.error });
    const procedureName = procedureNameResult.value;

    if (!firstName || !lastName || !phone || !doctorId || !chairId || !procedure || !procedureName || !startsAt || !endsAt) {
      return res.status(400).json({ error: 'Ime, prezime, broj telefona, datum, doktor i postupak su obavezni.' });
    }
    if (!rowExists('doctors', doctorId)) return res.status(404).json({ error: 'Doktor nije pronadjen.' });
    if (!procedure) return res.status(404).json({ error: 'Postupak nije pronadjen.' });
    const conflict = appointmentConflict({ doctorId, chairId, startsAt, endsAt });
    if (conflict) return res.status(409).json({ error: 'Termin vise nije slobodan.' });

    db.exec('BEGIN');
    let responsePayload;
    try {
      let patient = email ? db.prepare('SELECT * FROM patients WHERE lower(email) = lower(?) LIMIT 1').get(email) : null;
      if (!patient) {
        const result = db.prepare(`
          INSERT INTO patients (first_name, last_name, email, phone)
          VALUES (?, ?, ?, ?)
        `).run(firstName, lastName, email, phone);
        patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(result.lastInsertRowid);
      }

      const appointmentResult = db.prepare(`
        INSERT INTO appointments (patient_id, doctor_id, chair_id, procedure_id, procedure_name, starts_at, ends_at, duration_minutes, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)
      `).run(patient.id, doctorId, chairId, procedure.id, procedureName, startsAt, endsAt, duration, notesResult.value);
      queueCalendarSync(appointmentResult.lastInsertRowid, 'create_google_event');

      const bookingResult = db.prepare(`
        INSERT INTO public_booking_requests (
          patient_id, appointment_id, first_name, last_name, email, phone, doctor_id, procedure_id, procedure_name,
          requested_starts_at, duration_minutes, status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'booked', ?)
      `).run(patient.id, appointmentResult.lastInsertRowid, firstName, lastName, email, phone, doctorId, procedure.id, procedureName, startsAt, duration, notesResult.value);
      responsePayload = { id: bookingResult.lastInsertRowid, appointmentId: appointmentResult.lastInsertRowid, patientId: patient.id, status: 'booked' };
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    processCalendarSyncRed({ limit: 5 });
    res.status(201).json(responsePayload);
  } catch (error) {
    console.error('Public booking create error:', error);
    res.status(500).json({ error: 'Termin nije zakazan.' });
  }
});

// ============ ADVANCED PATIENT WORKFLOW ENDPOINTS ============

function invoiceNumber() {
  const year = new Date().getFullYear();
  const count = db.prepare("SELECT COUNT(*) as count FROM invoices WHERE invoice_number LIKE ?").get(`DR-${year}-%`).count + 1;
  return `DR-${year}-${String(count).padStart(5, '0')}`;
}

function serializeTreatmentPlan(plan) {
  const items = db.prepare('SELECT * FROM treatment_plan_items WHERE plan_id = ? ORDER BY phase, sort_order, id').all(plan.id);
  const subtotal = items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity || 1) * Number(item.unit_price || 0) - Number(item.discount || 0)), 0);
  return {
    id: plan.id,
    patientId: plan.patient_id,
    title: plan.title,
    status: plan.status,
    currency: plan.currency,
    discount: Number(plan.discount || 0),
    subtotal,
    total: Math.max(0, subtotal - Number(plan.discount || 0)),
    acceptedAt: plan.accepted_at,
    signatureName: plan.signature_name,
    signatureData: plan.signature_data,
    notes: plan.notes || '',
    createdAt: plan.created_at,
    items: items.map(item => ({
      id: item.id,
      phase: Number(item.phase || 1),
      toothNumber: item.tooth_number || '',
      procedureName: item.procedure_name,
      description: item.description || '',
      quantity: Number(item.quantity || 1),
      unitPrice: Number(item.unit_price || 0),
      discount: Number(item.discount || 0),
      sortOrder: Number(item.sort_order || 0)
    }))
  };
}

function saveTreatmentPlanItems(planId, items = []) {
  db.prepare('DELETE FROM treatment_plan_items WHERE plan_id = ?').run(planId);
  const insert = db.prepare(`
    INSERT INTO treatment_plan_items (plan_id, phase, tooth_number, procedure_name, description, quantity, unit_price, discount, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  items.forEach((item, index) => {
    insert.run(
      planId,
      Math.max(1, Number(item.phase || 1)),
      cleanText(item.toothNumber || item.tooth_number, { max: 20 }),
      cleanText(item.procedureName || item.procedure_name, { max: 255, required: true }),
      cleanText(item.description, { max: 1000 }),
      Math.max(0.01, Number(item.quantity || 1)),
      money(item.unitPrice || item.unit_price),
      money(item.discount),
      Number(item.sortOrder || item.sort_order || index)
    );
  });
}

app.get('/api/patients/:id/treatment-plans', authenticateToken, requirePermission('clinical:read'), (req, res) => {
  const patientId = positiveInteger(req.params.id);
  const plans = db.prepare('SELECT * FROM treatment_plans WHERE patient_id = ? ORDER BY created_at DESC').all(patientId);
  res.json(plans.map(serializeTreatmentPlan));
});

app.post('/api/patients/:id/treatment-plans', authenticateToken, requirePermission('clinical:write'), (req, res) => {
  try {
    const patientId = positiveInteger(req.params.id);
    if (!rowExists('patients', patientId)) return res.status(404).json({ error: 'Patient not found' });
    const result = db.prepare(`
      INSERT INTO treatment_plans (patient_id, title, status, currency, discount, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      patientId,
      cleanText(req.body.title, { max: 160, required: true }) || 'Plan terapije',
      ['draft', 'presented', 'accepted', 'declined', 'completed'].includes(req.body.status) ? req.body.status : 'draft',
      normalizeCurrency(req.body.currency),
      money(req.body.discount),
      cleanText(req.body.notes, { max: 2000 }),
      req.user.id
    );
    saveTreatmentPlanItems(result.lastInsertRowid, req.body.items || []);
    auditLog({ userId: req.user.id, action: 'treatment_plan_created', entityType: 'treatment_plan', entityId: result.lastInsertRowid, req });
    res.status(201).json(serializeTreatmentPlan(db.prepare('SELECT * FROM treatment_plans WHERE id = ?').get(result.lastInsertRowid)));
  } catch (error) {
    console.error('Create treatment plan error:', error);
    res.status(500).json({ error: 'Plan terapije nije sačuvan.' });
  }
});

app.put('/api/treatment-plans/:id', authenticateToken, requirePermission('clinical:write'), (req, res) => {
  try {
    const planId = positiveInteger(req.params.id);
    const plan = db.prepare('SELECT * FROM treatment_plans WHERE id = ?').get(planId);
    if (!plan) return res.status(404).json({ error: 'Treatment plan not found' });
    db.prepare(`
      UPDATE treatment_plans
      SET title = ?, status = ?, currency = ?, discount = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      cleanText(req.body.title, { max: 160, required: true }) || plan.title,
      ['draft', 'presented', 'accepted', 'declined', 'completed'].includes(req.body.status) ? req.body.status : plan.status,
      normalizeCurrency(req.body.currency || plan.currency),
      money(req.body.discount),
      cleanText(req.body.notes, { max: 2000 }),
      planId
    );
    saveTreatmentPlanItems(planId, req.body.items || []);
    res.json(serializeTreatmentPlan(db.prepare('SELECT * FROM treatment_plans WHERE id = ?').get(planId)));
  } catch (error) {
    console.error('Update treatment plan error:', error);
    res.status(500).json({ error: 'Plan terapije nije azuriran.' });
  }
});

app.post('/api/treatment-plans/:id/accept', authenticateToken, requirePermission('clinical:write'), (req, res) => {
  const planId = positiveInteger(req.params.id);
  const plan = db.prepare('SELECT * FROM treatment_plans WHERE id = ?').get(planId);
  if (!plan) return res.status(404).json({ error: 'Treatment plan not found' });
  db.prepare(`
    UPDATE treatment_plans
    SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP, signature_name = ?, signature_data = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(cleanText(req.body.signatureName || req.body.signature_name, { max: 160, required: true }), cleanText(req.body.signatureData || req.body.signature_data, { max: 4000 }), planId);
  auditLog({ userId: req.user.id, action: 'treatment_plan_accepted', entityType: 'treatment_plan', entityId: planId, req });
  res.json(serializeTreatmentPlan(db.prepare('SELECT * FROM treatment_plans WHERE id = ?').get(planId)));
});

app.delete('/api/treatment-plans/:id', authenticateToken, requirePermission('clinical:write'), (req, res) => {
  const planId = positiveInteger(req.params.id);
  if (!rowExists('treatment_plans', planId)) return res.status(404).json({ error: 'Treatment plan not found' });
  db.prepare('DELETE FROM treatment_plans WHERE id = ?').run(planId);
  auditLog({ userId: req.user.id, action: 'treatment_plan_deleted', entityType: 'treatment_plan', entityId: planId, req });
  res.json({ success: true });
});

function serializeClinicalChart(row) {
  return {
    id: row.id,
    patientId: row.patient_id,
    visitRecordId: row.visit_record_id,
    toothNumber: row.tooth_number,
    surfaces: safeJsonParse(row.surfaces, []),
    cdtCode: row.cdt_code || '',
    adaCode: row.ada_code || '',
    diagnosis: row.diagnosis || '',
    procedureCode: row.procedure_code || '',
    status: row.status,
    phase: Number(row.phase || 1),
    price: Number(row.price || 0),
    currency: row.currency || 'EUR',
    priceRsd: Number(row.price_rsd || 0),
    exchangeRateToRsd: Number(row.exchange_rate_to_rsd || 0),
    providerId: row.provider_id,
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeClinicalNote(row) {
  return {
    id: row.id,
    patientId: row.patient_id,
    visitRecordId: row.visit_record_id,
    templateId: row.template_id,
    title: row.title,
    body: row.body,
    signedBy: row.signed_by || '',
    signedAt: row.signed_at || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeSaglasnost(row) {
  return {
    id: row.id,
    patientId: row.patient_id,
    treatmentPlanId: row.treatment_plan_id,
    consentType: row.consent_type,
    title: row.title,
    body: row.body,
    signerName: row.signer_name,
    signatureData: row.signature_data,
    signedAt: row.signed_at,
    createdAt: row.created_at
  };
}

app.get('/api/patients/:id/clinical-chart', authenticateToken, requirePermission('clinical:read'), (req, res) => {
  const patientId = positiveInteger(req.params.id);
  if (!patientId || !rowExists('patients', patientId)) return res.status(404).json({ error: 'Patient not found' });
  const rows = db.prepare('SELECT * FROM clinical_chart_entries WHERE patient_id = ? ORDER BY tooth_number, phase, created_at DESC').all(patientId);
  res.json(rows.map(serializeClinicalChart));
});

app.post('/api/patients/:id/clinical-chart', authenticateToken, requirePermission('clinical:write'), (req, res) => {
  try {
    const patientId = positiveInteger(req.params.id);
    if (!patientId || !rowExists('patients', patientId)) return res.status(404).json({ error: 'Patient not found' });
    const surfaces = Array.isArray(req.body.surfaces) ? req.body.surfaces.map(surface => cleanText(surface, { max: 20 })).filter(Boolean) : [];
    const status = ['planned', 'in_progress', 'completed', 'watch', 'referred'].includes(req.body.status) ? req.body.status : 'planned';
    const result = db.prepare(`
      INSERT INTO clinical_chart_entries (
        patient_id, visit_record_id, tooth_number, surfaces, cdt_code, ada_code, diagnosis,
        procedure_code, status, phase, price, currency, price_rsd, exchange_rate_to_rsd, provider_id, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      patientId,
      positiveInteger(req.body.visitRecordId || req.body.visit_record_id),
      cleanText(req.body.toothNumber || req.body.tooth_number, { max: 20, required: true }),
      JSON.stringify(surfaces),
      cleanText(req.body.cdtCode || req.body.cdt_code, { max: 40 }),
      cleanText(req.body.adaCode || req.body.ada_code, { max: 40 }),
      cleanText(req.body.diagnosis, { max: 1000 }),
      cleanText(req.body.procedureCode || req.body.procedure_code, { max: 80 }),
      status,
      Math.max(1, Number(req.body.phase || 1)),
      money(req.body.price),
      normalizeCurrency(req.body.currency),
      money(req.body.priceRsd || req.body.price_rsd),
      money(req.body.exchangeRateToRsd || req.body.exchange_rate_to_rsd),
      positiveInteger(req.body.providerId || req.body.provider_id),
      cleanText(req.body.notes, { max: 2000 }),
      req.user.id
    );
    auditLog({ userId: req.user.id, action: 'clinical_chart_created', entityType: 'patient', entityId: patientId, req });
    res.status(201).json(serializeClinicalChart(db.prepare('SELECT * FROM clinical_chart_entries WHERE id = ?').get(result.lastInsertRowid)));
  } catch (error) {
    console.error('Create clinical chart error:', error);
    res.status(500).json({ error: 'Zubni status nije sačuvan.' });
  }
});

app.put('/api/clinical-chart/:id', authenticateToken, requirePermission('clinical:write'), (req, res) => {
  try {
    const chartId = positiveInteger(req.params.id);
    const existing = db.prepare('SELECT * FROM clinical_chart_entries WHERE id = ?').get(chartId);
    if (!existing) return res.status(404).json({ error: 'Zubni status entry not found' });
    const surfaces = Array.isArray(req.body.surfaces)
      ? req.body.surfaces.map(surface => cleanText(surface, { max: 20 })).filter(Boolean)
      : safeJsonParse(existing.surfaces, []);
    const status = ['planned', 'in_progress', 'completed', 'watch', 'referred'].includes(req.body.status)
      ? req.body.status
      : existing.status;
    db.prepare(`
      UPDATE clinical_chart_entries
      SET tooth_number = ?, surfaces = ?, cdt_code = ?, ada_code = ?, diagnosis = ?,
          procedure_code = ?, status = ?, phase = ?, price = ?, currency = ?, price_rsd = ?,
          exchange_rate_to_rsd = ?, provider_id = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      cleanText(req.body.toothNumber || req.body.tooth_number || existing.tooth_number, { max: 20, required: true }),
      JSON.stringify(surfaces),
      cleanText(req.body.cdtCode || req.body.cdt_code || existing.cdt_code, { max: 40 }),
      cleanText(req.body.adaCode || req.body.ada_code || existing.ada_code, { max: 40 }),
      cleanText(req.body.diagnosis ?? existing.diagnosis, { max: 1000 }),
      cleanText(req.body.procedureCode || req.body.procedure_code || existing.procedure_code, { max: 80 }),
      status,
      Math.max(1, Number(req.body.phase || existing.phase || 1)),
      money(req.body.price ?? existing.price),
      normalizeCurrency(req.body.currency || existing.currency),
      money(req.body.priceRsd ?? req.body.price_rsd ?? existing.price_rsd),
      money(req.body.exchangeRateToRsd ?? req.body.exchange_rate_to_rsd ?? existing.exchange_rate_to_rsd),
      positiveInteger(req.body.providerId || req.body.provider_id || existing.provider_id),
      cleanText(req.body.notes ?? existing.notes, { max: 2000 }),
      chartId
    );
    auditLog({ userId: req.user.id, action: 'clinical_chart_updated', entityType: 'clinical_chart', entityId: chartId, req });
    res.json(serializeClinicalChart(db.prepare('SELECT * FROM clinical_chart_entries WHERE id = ?').get(chartId)));
  } catch (error) {
    console.error('Update clinical chart error:', error);
    res.status(500).json({ error: 'Zubni status nije izmenjen.' });
  }
});

app.delete('/api/clinical-chart/:id', authenticateToken, requirePermission('clinical:write'), (req, res) => {
  const chartId = positiveInteger(req.params.id);
  if (!rowExists('clinical_chart_entries', chartId)) return res.status(404).json({ error: 'Zubni status entry not found' });
  db.prepare('DELETE FROM clinical_chart_entries WHERE id = ?').run(chartId);
  auditLog({ userId: req.user.id, action: 'clinical_chart_deleted', entityType: 'clinical_chart', entityId: chartId, req });
  res.json({ success: true });
});

app.get('/api/clinical-note-templates', authenticateToken, requirePermission('clinical:read'), (_req, res) => {
  const rows = db.prepare('SELECT * FROM clinical_note_templates WHERE is_active = 1 ORDER BY category, title').all();
  res.json(rows.map(row => ({
    id: row.id,
    title: row.title,
    category: row.category,
    body: row.body
  })));
});

app.post('/api/director/clinical-note-templates', authenticateToken, requireDirector, (req, res) => {
  try {
    const result = db.prepare(`
      INSERT INTO clinical_note_templates (title, category, body)
      VALUES (?, ?, ?)
    `).run(
      cleanText(req.body.title, { max: 160, required: true }),
      cleanText(req.body.category || 'Opste', { max: 80, required: true }),
      cleanText(req.body.body, { max: 8000, required: true })
    );
    auditLog({ userId: req.user.id, action: 'clinical_note_template_created', entityType: 'clinical_note_template', entityId: result.lastInsertRowid, req });
    const row = db.prepare('SELECT * FROM clinical_note_templates WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ id: row.id, title: row.title, category: row.category, body: row.body });
  } catch (error) {
    console.error('Create clinical note template error:', error);
    res.status(500).json({ error: 'Šablon nije sačuvan.' });
  }
});

app.get('/api/patients/:id/clinical-notes', authenticateToken, requirePermission('clinical:read'), (req, res) => {
  const patientId = positiveInteger(req.params.id);
  if (!patientId || !rowExists('patients', patientId)) return res.status(404).json({ error: 'Patient not found' });
  const rows = db.prepare('SELECT * FROM clinical_notes WHERE patient_id = ? ORDER BY created_at DESC, id DESC').all(patientId);
  res.json(rows.map(serializeClinicalNote));
});

app.post('/api/patients/:id/clinical-notes', authenticateToken, requirePermission('clinical:write'), (req, res) => {
  try {
    const patientId = positiveInteger(req.params.id);
    if (!patientId || !rowExists('patients', patientId)) return res.status(404).json({ error: 'Patient not found' });
    const result = db.prepare(`
      INSERT INTO clinical_notes (
        patient_id, visit_record_id, template_id, title, body, signed_by, signed_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      patientId,
      positiveInteger(req.body.visitRecordId || req.body.visit_record_id),
      positiveInteger(req.body.templateId || req.body.template_id),
      cleanText(req.body.title, { max: 160, required: true }),
      cleanText(req.body.body, { max: 8000, required: true }),
      cleanText(req.body.signedBy || req.body.signed_by, { max: 160 }),
      req.body.signedBy || req.body.signed_by ? new Date().toISOString() : null,
      req.user.id
    );
    auditLog({ userId: req.user.id, action: 'clinical_note_created', entityType: 'patient', entityId: patientId, req });
    res.status(201).json(serializeClinicalNote(db.prepare('SELECT * FROM clinical_notes WHERE id = ?').get(result.lastInsertRowid)));
  } catch (error) {
    console.error('Create clinical note error:', error);
    res.status(500).json({ error: 'Klinička beleška nije sačuvan.' });
  }
});

app.put('/api/clinical-notes/:id', authenticateToken, requirePermission('clinical:write'), (req, res) => {
  try {
    const noteId = positiveInteger(req.params.id);
    const current = db.prepare('SELECT * FROM clinical_notes WHERE id = ?').get(noteId);
    if (!current) return res.status(404).json({ error: 'Klinička beleška nije pronadjena' });
    db.prepare(`
      UPDATE clinical_notes
      SET visit_record_id = ?, template_id = ?, title = ?, body = ?, signed_by = ?, signed_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      positiveInteger(req.body.visitRecordId || req.body.visit_record_id) || current.visit_record_id,
      positiveInteger(req.body.templateId || req.body.template_id) || current.template_id,
      cleanText(req.body.title ?? current.title, { max: 160, required: true }),
      cleanText(req.body.body ?? current.body, { max: 8000, required: true }),
      cleanText(req.body.signedBy ?? req.body.signed_by ?? current.signed_by, { max: 160 }),
      req.body.signedBy || req.body.signed_by ? (current.signed_at || new Date().toISOString()) : current.signed_at,
      noteId
    );
    auditLog({ userId: req.user.id, action: 'clinical_note_updated', entityType: 'clinical_note', entityId: noteId, req });
    res.json(serializeClinicalNote(db.prepare('SELECT * FROM clinical_notes WHERE id = ?').get(noteId)));
  } catch (error) {
    console.error('Update clinical note error:', error);
    res.status(500).json({ error: 'Klinička beleška nije sačuvana.' });
  }
});

app.delete('/api/clinical-notes/:id', authenticateToken, requirePermission('clinical:write'), (req, res) => {
  try {
    const noteId = positiveInteger(req.params.id);
    if (!rowExists('clinical_notes', noteId)) return res.status(404).json({ error: 'Klinička beleška nije pronadjena' });
    db.prepare('DELETE FROM clinical_notes WHERE id = ?').run(noteId);
    auditLog({ userId: req.user.id, action: 'clinical_note_deleted', entityType: 'clinical_note', entityId: noteId, req });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete clinical note error:', error);
    res.status(500).json({ error: 'Klinička beleška nije obrisana.' });
  }
});

app.post('/api/clinical-notes/:id/sign', authenticateToken, requirePermission('clinical:write'), (req, res) => {
  try {
    const noteId = positiveInteger(req.params.id);
    const note = db.prepare('SELECT * FROM clinical_notes WHERE id = ?').get(noteId);
    if (!note) return res.status(404).json({ error: 'Klinička beleška not found' });
    db.prepare('UPDATE clinical_notes SET signed_by = ?, signed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(cleanText(req.body.signedBy || req.body.signed_by || req.user.name, { max: 160, required: true }), noteId);
    auditLog({ userId: req.user.id, action: 'clinical_note_signed', entityType: 'clinical_note', entityId: noteId, req });
    res.json(serializeClinicalNote(db.prepare('SELECT * FROM clinical_notes WHERE id = ?').get(noteId)));
  } catch (error) {
    console.error('Sign clinical note error:', error);
    res.status(500).json({ error: 'Klinička beleška nije potpisan.' });
  }
});

app.get('/api/patients/:id/consents', authenticateToken, requirePermission('clinical:read'), (req, res) => {
  const patientId = positiveInteger(req.params.id);
  if (!patientId || !rowExists('patients', patientId)) return res.status(404).json({ error: 'Patient not found' });
  const rows = db.prepare('SELECT * FROM patient_consents WHERE patient_id = ? ORDER BY signed_at DESC, id DESC').all(patientId);
  res.json(rows.map(serializeSaglasnost));
});

app.post('/api/patients/:id/consents', authenticateToken, requirePermission('clinical:write'), (req, res) => {
  try {
    const patientId = positiveInteger(req.params.id);
    if (!patientId || !rowExists('patients', patientId)) return res.status(404).json({ error: 'Patient not found' });
    const result = db.prepare(`
      INSERT INTO patient_consents (
        patient_id, treatment_plan_id, consent_type, title, body, signer_name, signature_data, signed_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      patientId,
      positiveInteger(req.body.treatmentPlanId || req.body.treatment_plan_id),
      cleanText(req.body.consentType || req.body.consent_type || 'treatment', { max: 80, required: true }),
      cleanText(req.body.title, { max: 160, required: true }),
      cleanText(req.body.body, { max: 8000, required: true }),
      cleanText(req.body.signerName || req.body.signer_name, { max: 160, required: true }),
      cleanText(req.body.signatureData || req.body.signature_data, { max: 4000, required: true }),
      new Date().toISOString(),
      req.user.id
    );
    auditLog({ userId: req.user.id, action: 'consent_signed', entityType: 'patient', entityId: patientId, req });
    res.status(201).json(serializeSaglasnost(db.prepare('SELECT * FROM patient_consents WHERE id = ?').get(result.lastInsertRowid)));
  } catch (error) {
    console.error('Create consent error:', error);
    res.status(500).json({ error: 'Saglasnost nije sačuvan.' });
  }
});

app.put('/api/consents/:id', authenticateToken, requirePermission('clinical:write'), (req, res) => {
  try {
    const consentId = positiveInteger(req.params.id);
    const current = db.prepare('SELECT * FROM patient_consents WHERE id = ?').get(consentId);
    if (!current) return res.status(404).json({ error: 'Saglasnost nije pronadjena' });
    db.prepare(`
      UPDATE patient_consents
      SET treatment_plan_id = ?, consent_type = ?, title = ?, body = ?, signer_name = ?,
          signature_data = ?, signed_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      positiveInteger(req.body.treatmentPlanId || req.body.treatment_plan_id) || current.treatment_plan_id,
      cleanText(req.body.consentType ?? req.body.consent_type ?? current.consent_type, { max: 80, required: true }),
      cleanText(req.body.title ?? current.title, { max: 160, required: true }),
      cleanText(req.body.body ?? current.body, { max: 8000, required: true }),
      cleanText(req.body.signerName ?? req.body.signer_name ?? current.signer_name, { max: 160, required: true }),
      cleanText(req.body.signatureData ?? req.body.signature_data ?? current.signature_data, { max: 4000, required: true }),
      current.signed_at || new Date().toISOString(),
      consentId
    );
    auditLog({ userId: req.user.id, action: 'consent_updated', entityType: 'consent', entityId: consentId, req });
    res.json(serializeSaglasnost(db.prepare('SELECT * FROM patient_consents WHERE id = ?').get(consentId)));
  } catch (error) {
    console.error('Update consent error:', error);
    res.status(500).json({ error: 'Saglasnost nije sačuvana.' });
  }
});

app.delete('/api/consents/:id', authenticateToken, requirePermission('clinical:write'), (req, res) => {
  try {
    const consentId = positiveInteger(req.params.id);
    if (!rowExists('patient_consents', consentId)) return res.status(404).json({ error: 'Saglasnost nije pronadjena' });
    db.prepare('DELETE FROM patient_consents WHERE id = ?').run(consentId);
    auditLog({ userId: req.user.id, action: 'consent_deleted', entityType: 'consent', entityId: consentId, req });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete consent error:', error);
    res.status(500).json({ error: 'Saglasnost nije obrisana.' });
  }
});

function serializePerioChart(chart) {
  const measurements = db.prepare('SELECT * FROM perio_measurements WHERE chart_id = ? ORDER BY tooth_number, site').all(chart.id);
  return {
    id: chart.id,
    patientId: chart.patient_id,
    chartDate: chart.chart_date,
    notes: chart.notes || '',
    createdAt: chart.created_at,
    measurements: measurements.map(item => ({
      toothNumber: item.tooth_number,
      site: item.site,
      pocketDepth: Number(item.pocket_depth || 0),
      bleeding: Boolean(item.bleeding),
      gingivalMargin: Number(item.gingival_margin || 0),
      recession: Number(item.recession || 0),
      mobility: Number(item.mobility || 0),
      furcation: Number(item.furcation || 0),
      notes: item.notes || ''
    }))
  };
}

app.get('/api/patients/:id/perio-charts', authenticateToken, requirePermission('clinical:read'), (req, res) => {
  const charts = db.prepare('SELECT * FROM perio_charts WHERE patient_id = ? ORDER BY chart_date DESC, id DESC').all(positiveInteger(req.params.id));
  res.json(charts.map(serializePerioChart));
});

app.post('/api/patients/:id/perio-charts', authenticateToken, requirePermission('clinical:write'), (req, res) => {
  try {
    const patientId = positiveInteger(req.params.id);
    const result = db.prepare('INSERT INTO perio_charts (patient_id, chart_date, notes, created_by) VALUES (?, ?, ?, ?)')
      .run(patientId, cleanText(req.body.chartDate || req.body.chart_date || todayIsoDate(), { max: 20, required: true }), cleanText(req.body.notes, { max: 2000 }), req.user.id);
    const insert = db.prepare(`
      INSERT INTO perio_measurements (chart_id, tooth_number, site, pocket_depth, bleeding, gingival_margin, recession, mobility, furcation, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    (req.body.measurements || []).forEach(item => insert.run(
      result.lastInsertRowid,
      cleanText(item.toothNumber || item.tooth_number, { max: 10, required: true }),
      cleanText(item.site, { max: 20, required: true }),
      Math.max(0, Number(item.pocketDepth || item.pocket_depth || 0)),
      normalizeBoolean(item.bleeding),
      Number(item.gingivalMargin || item.gingival_margin || 0),
      Number(item.recession || 0),
      Math.max(0, Number(item.mobility || 0)),
      Math.max(0, Number(item.furcation || 0)),
      cleanText(item.notes, { max: 500 })
    ));
    res.status(201).json(serializePerioChart(db.prepare('SELECT * FROM perio_charts WHERE id = ?').get(result.lastInsertRowid)));
  } catch (error) {
    console.error('Create perio chart error:', error);
    res.status(500).json({ error: 'Perio chart nije sačuvan.' });
  }
});

app.delete('/api/perio-charts/:id', authenticateToken, requirePermission('clinical:write'), (req, res) => {
  const chartId = positiveInteger(req.params.id);
  if (!rowExists('perio_charts', chartId)) return res.status(404).json({ error: 'Perio chart not found' });
  db.prepare('DELETE FROM perio_charts WHERE id = ?').run(chartId);
  auditLog({ userId: req.user.id, action: 'perio_chart_deleted', entityType: 'perio_chart', entityId: chartId, req });
  res.json({ success: true });
});

function serializeInvoice(invoice) {
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order, id').all(invoice.id);
  const payments = db.prepare('SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY payment_date, id').all(invoice.id);
  return {
    id: invoice.id,
    patientId: invoice.patient_id,
    visitRecordId: invoice.visit_record_id,
    invoiceNumber: invoice.invoice_number,
    status: invoice.status,
    issueDate: invoice.issue_date,
    dueDate: invoice.due_date || '',
    currency: invoice.currency,
    subtotal: Number(invoice.subtotal || 0),
    discount: Number(invoice.discount || 0),
    tax: Number(invoice.tax || 0),
    total: Number(invoice.total || 0),
    amountPaid: Number(invoice.amount_paid || 0),
    balance: Math.max(0, Number(invoice.total || 0) - Number(invoice.amount_paid || 0)),
    notes: invoice.notes || '',
    items: items.map(item => ({
      id: item.id,
      description: item.description,
      toothNumber: item.tooth_number || '',
      quantity: Number(item.quantity || 1),
      unitPrice: Number(item.unit_price || 0),
      discount: Number(item.discount || 0)
    })),
    payments: payments.map(payment => ({
      id: payment.id,
      amount: Number(payment.amount || 0),
      paymentMethod: payment.payment_method || '',
      paymentDate: payment.payment_date,
      paymentType: payment.payment_type,
      notes: payment.notes || ''
    }))
  };
}

function recalculateInvoice(invoiceId) {
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(invoiceId);
  const subtotal = items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity || 1) * Number(item.unit_price || 0) - Number(item.discount || 0)), 0);
  const invoice = db.prepare('SELECT discount, tax FROM invoices WHERE id = ?').get(invoiceId);
  const total = Math.max(0, subtotal - Number(invoice.discount || 0) + Number(invoice.tax || 0));
  const paid = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN payment_type = 'refund' THEN -amount ELSE amount END), 0) as paid
    FROM invoice_payments WHERE invoice_id = ?
  `).get(invoiceId).paid || 0;
  const status = paid <= 0 ? 'issued' : paid >= total ? 'paid' : 'partially_paid';
  db.prepare('UPDATE invoices SET subtotal = ?, total = ?, amount_paid = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(subtotal, total, paid, status, invoiceId);
}

function addLedgerEntry({ patientId, invoiceId = null, claimId = null, entryType, amount, currency = 'EUR', description, source = 'manual', userId = null }) {
  db.prepare(`
    INSERT INTO patient_ledger_entries (
      patient_id, invoice_id, claim_id, entry_type, amount, currency, description, entry_date, source, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    patientId,
    invoiceId,
    claimId,
    entryType,
    signedMoney(amount),
    normalizeCurrency(currency),
    cleanText(description, { max: 255, required: true }),
    todayIsoDate(),
    cleanText(source, { max: 80, required: true }),
    userId
  );
}

function saveInvoiceItems(invoiceId, items = []) {
  db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(invoiceId);
  const insert = db.prepare('INSERT INTO invoice_items (invoice_id, description, tooth_number, quantity, unit_price, discount, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)');
  items.forEach((item, index) => insert.run(
    invoiceId,
    cleanText(item.description, { max: 255, required: true }),
    cleanText(item.toothNumber || item.tooth_number, { max: 20 }),
    Math.max(0.01, Number(item.quantity || 1)),
    money(item.unitPrice || item.unit_price),
    money(item.discount),
    index
  ));
  recalculateInvoice(invoiceId);
}

app.get('/api/patients/:id/invoices', authenticateToken, requirePermission('billing:read'), (req, res) => {
  const invoices = db.prepare('SELECT * FROM invoices WHERE patient_id = ? ORDER BY issue_date DESC, id DESC').all(positiveInteger(req.params.id));
  res.json(invoices.map(serializeInvoice));
});

app.post('/api/patients/:id/invoices', authenticateToken, requirePermission('billing:write'), (req, res) => {
  try {
    const patientId = positiveInteger(req.params.id);
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (items.length === 0) return res.status(400).json({ error: 'Dodajte bar jednu stavku računa.' });
    if (!patientId || !rowExists('patients', patientId)) return res.status(404).json({ error: 'Patient not found' });
    db.exec('BEGIN');
    let invoiceId;
    try {
      const result = db.prepare(`
        INSERT INTO invoices (patient_id, visit_record_id, invoice_number, status, issue_date, due_date, currency, discount, tax, notes, created_by)
        VALUES (?, ?, ?, 'issued', ?, ?, ?, ?, ?, ?, ?)
      `).run(patientId, positiveInteger(req.body.visitRecordId || req.body.visit_record_id), cleanText(req.body.invoiceNumber || invoiceNumber(), { max: 80, required: true }), cleanText(req.body.issueDate || req.body.issue_date || todayIsoDate(), { max: 20, required: true }), cleanText(req.body.dueDate || req.body.due_date, { max: 20 }), normalizeCurrency(req.body.currency), money(req.body.discount), money(req.body.tax), cleanText(req.body.notes, { max: 2000 }), req.user.id);
      invoiceId = result.lastInsertRowid;
      saveInvoiceItems(invoiceId, items);
      recalculateInvoice(invoiceId);
      const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
      addLedgerEntry({
        patientId,
        invoiceId,
        entryType: 'charge',
        amount: invoice.total,
        currency: invoice.currency,
        description: `Račun ${invoice.invoice_number}`,
        source: 'invoice',
        userId: req.user.id
      });
      auditLog({ userId: req.user.id, action: 'invoice_created', entityType: 'invoice', entityId: invoiceId, req });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.status(201).json(serializeInvoice(db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId)));
  } catch (error) {
    console.error('Create invoice error:', error);
    res.status(500).json({ error: 'Račun nije sačuvan.' });
  }
});

app.post('/api/invoices/:id/payments', authenticateToken, requirePermission('billing:write'), (req, res) => {
  try {
    const invoiceId = positiveInteger(req.params.id);
    if (!rowExists('invoices', invoiceId)) return res.status(404).json({ error: 'Invoice not found' });
    db.exec('BEGIN');
    try {
      const paymentType = ['payment', 'advance', 'installment', 'refund'].includes(req.body.paymentType || req.body.payment_type) ? (req.body.paymentType || req.body.payment_type) : 'payment';
      db.prepare('INSERT INTO invoice_payments (invoice_id, amount, payment_method, payment_date, payment_type, notes) VALUES (?, ?, ?, ?, ?, ?)')
        .run(invoiceId, money(req.body.amount), cleanText(req.body.paymentMethod || req.body.payment_method, { max: 80 }), cleanText(req.body.paymentDate || req.body.payment_date || todayIsoDate(), { max: 20, required: true }), paymentType, cleanText(req.body.notes, { max: 1000 }));
      recalculateInvoice(invoiceId);
      const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
      addLedgerEntry({
        patientId: invoice.patient_id,
        invoiceId,
        entryType: paymentType === 'refund' ? 'refund' : 'patient_payment',
        amount: paymentType === 'refund' ? money(req.body.amount) : -money(req.body.amount),
        currency: invoice.currency,
        description: `${paymentType === 'refund' ? 'Povracaj' : 'Uplata'} za račun ${invoice.invoice_number}`,
        source: 'invoice_payment',
        userId: req.user.id
      });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.status(201).json(serializeInvoice(db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId)));
  } catch (error) {
    console.error('Invoice payment error:', error);
    res.status(500).json({ error: 'Uplata nije sačuvana.' });
  }
});

app.get('/api/invoices/:id/pdf', authenticateToken, requirePermission('billing:read'), (req, res) => {
  const invoice = db.prepare('SELECT i.*, p.first_name, p.last_name, p.email, p.phone FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE i.id = ?').get(positiveInteger(req.params.id));
  if (!invoice) return res.status(404).send('Invoice not found');
  const data = serializeInvoice(invoice);
  const rows = data.items.map(item => `<tr><td>${escapeHtml(item.description)}</td><td>${escapeHtml(item.toothNumber || '-')}</td><td>${escapeHtml(item.quantity)}</td><td>${escapeHtml(item.unitPrice.toFixed(2))}</td><td>${escapeHtml(item.discount.toFixed(2))}</td></tr>`).join('');
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(data.invoiceNumber)}</title><style>body{font-family:Arial;padding:32px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px;text-align:left}</style></head><body><h1>Račun ${escapeHtml(data.invoiceNumber)}</h1><p>Pacijent: ${escapeHtml(invoice.first_name)} ${escapeHtml(invoice.last_name)}</p><p>Datum: ${escapeHtml(data.issueDate)}</p><table><thead><tr><th>Stavka</th><th>Zub</th><th>Količina</th><th>Cena</th><th>Popust</th></tr></thead><tbody>${rows}</tbody></table><h2>Ukupno: ${escapeHtml(data.total.toFixed(2))} ${escapeHtml(data.currency)}</h2><p>Plaćeno: ${escapeHtml(data.amountPaid.toFixed(2))} ${escapeHtml(data.currency)}</p><script>window.print()</script></body></html>`);
});

app.delete('/api/invoices/:id', authenticateToken, requirePermission('billing:write'), (req, res) => {
  try {
    const invoiceId = positiveInteger(req.params.id);
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    db.exec('BEGIN');
    try {
      const ledgerBalance = db.prepare('SELECT COALESCE(SUM(amount), 0) as amount FROM patient_ledger_entries WHERE invoice_id = ?').get(invoiceId).amount || 0;
      if (Number(ledgerBalance) !== 0) {
        addLedgerEntry({
          patientId: invoice.patient_id,
          invoiceId,
          entryType: Number(ledgerBalance) > 0 ? 'adjustment' : 'charge',
          amount: -Number(ledgerBalance),
          currency: invoice.currency,
          description: `Storno računa ${invoice.invoice_number}`,
          source: 'invoice_delete',
          userId: req.user.id
        });
      }
      db.prepare('DELETE FROM invoices WHERE id = ?').run(invoiceId);
      auditLog({ userId: req.user.id, action: 'invoice_deleted', entityType: 'invoice', entityId: invoiceId, req });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Delete invoice error:', error);
    res.status(500).json({ error: 'Račun nije obrisan.' });
  }
});

function serializeClaim(row) {
  const attachments = db.prepare(`
    SELECT ca.*, d.title, d.document_type, d.original_filename
    FROM insurance_claim_attachments ca
    JOIN patient_documents d ON d.id = ca.document_id
    WHERE ca.claim_id = ?
    ORDER BY ca.created_at DESC, ca.id DESC
  `).all(row.id);
  return {
    id: row.id,
    patientId: row.patient_id,
    visitRecordId: row.visit_record_id,
    invoiceId: row.invoice_id,
    provider: row.provider,
    policyNumber: row.policy_number || '',
    claimNumber: row.claim_number || '',
    status: row.status,
    requestedAmount: Number(row.requested_amount || 0),
    approvedAmount: Number(row.approved_amount || 0),
    paidAmount: Number(row.paid_amount || 0),
    submittedAt: row.submitted_at,
    decisionAt: row.decision_at,
    eligibilityStatus: row.eligibility_status || '',
    payerControlNumber: row.payer_control_number || '',
    clearinghouseRef: row.clearinghouse_ref || '',
    denialReason: row.denial_reason || '',
    eraStatus: row.era_status || '',
    eob: safeJsonParse(row.eob_json, null),
    ledgerStatus: row.ledger_status || 'unreconciled',
    eligibilityNotes: row.eligibility_notes || '',
    preauthorizationNotes: row.preauthorization_notes || '',
    notes: row.notes || '',
    attachments: attachments.map(attachment => ({
      id: attachment.id,
      documentId: attachment.document_id,
      title: attachment.title,
      documentType: attachment.document_type,
      originalFilename: attachment.original_filename,
      attachmentType: attachment.attachment_type,
      clearinghouseRef: attachment.clearinghouse_ref || '',
      status: attachment.status,
      notes: attachment.notes || '',
      createdAt: attachment.created_at
    })),
    createdAt: row.created_at
  };
}

app.get('/api/patients/:id/insurance-claims', authenticateToken, requirePermission('billing:read'), (req, res) => {
  const rows = db.prepare('SELECT * FROM insurance_claims WHERE patient_id = ? ORDER BY created_at DESC').all(positiveInteger(req.params.id));
  res.json(rows.map(serializeClaim));
});

app.post('/api/patients/:id/insurance-claims', authenticateToken, requirePermission('billing:write'), (req, res) => {
  try {
    const patientId = positiveInteger(req.params.id);
    if (!patientId || !rowExists('patients', patientId)) return res.status(404).json({ error: 'Pacijent nije pronadjen.' });
    const provider = cleanText(req.body.provider, { max: 160 });
    const requestedAmount = money(req.body.requestedAmount || req.body.requested_amount);
    if (!provider) return res.status(400).json({ error: 'Unesite naziv osiguranja.' });
    if (requestedAmount <= 0) return res.status(400).json({ error: 'Unesite trazeni iznos veci od 0.' });
    const result = db.prepare(`
      INSERT INTO insurance_claims (
        patient_id, visit_record_id, invoice_id, provider, policy_number, claim_number, status,
        requested_amount, approved_amount, submitted_at, decision_at, eligibility_notes, preauthorization_notes, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      patientId,
      positiveInteger(req.body.visitRecordId || req.body.visit_record_id),
      positiveInteger(req.body.invoiceId || req.body.invoice_id),
      provider,
      cleanText(req.body.policyNumber || req.body.policy_number, { max: 120 }),
      cleanText(req.body.claimNumber || req.body.claim_number, { max: 120 }),
      ['draft', 'eligibility_checked', 'preauth_sent', 'submitted', 'approved', 'partially_approved', 'denied', 'paid'].includes(req.body.status) ? req.body.status : 'draft',
      requestedAmount,
      money(req.body.approvedAmount || req.body.approved_amount),
      cleanText(req.body.submittedAt || req.body.submitted_at, { max: 40 }),
      cleanText(req.body.decisionAt || req.body.decision_at, { max: 40 }),
      cleanText(req.body.eligibilityNotes || req.body.eligibility_notes, { max: 2000 }),
      cleanText(req.body.preauthorizationNotes || req.body.preauthorization_notes, { max: 2000 }),
      cleanText(req.body.notes, { max: 2000 }),
      req.user.id
    );
    res.status(201).json(serializeClaim(db.prepare('SELECT * FROM insurance_claims WHERE id = ?').get(result.lastInsertRowid)));
  } catch (error) {
    console.error('Create insurance claim error:', error);
    res.status(500).json({ error: 'Zahtev za osiguranje nije sačuvan.' });
  }
});

app.post('/api/insurance-claims/:id/check-eligibility', authenticateToken, requirePermission('billing:write'), (req, res) => {
  try {
    const claimId = positiveInteger(req.params.id);
    const claim = db.prepare('SELECT * FROM insurance_claims WHERE id = ?').get(claimId);
    if (!claim) return res.status(404).json({ error: 'Insurance claim not found' });
    const status = claim.policy_number ? 'active' : 'manual_review';
    const note = status === 'active'
      ? `Eligibility active for ${claim.provider}.`
      : 'Nedostaje broj polise; potrebna rucna provera.';
    db.prepare(`
      UPDATE insurance_claims
      SET status = 'eligibility_checked', eligibility_status = ?, eligibility_notes = ?,
          payer_control_number = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, note, `ELG-${claimId}-${Date.now()}`, claimId);
    auditLog({ userId: req.user.id, action: 'insurance_eligibility_checked', entityType: 'insurance_claim', entityId: claimId, req });
    res.json(serializeClaim(db.prepare('SELECT * FROM insurance_claims WHERE id = ?').get(claimId)));
  } catch (error) {
    console.error('Eligibility check error:', error);
    res.status(500).json({ error: 'Eligibility provera nije uspela.' });
  }
});

app.post('/api/insurance-claims/:id/attachments', authenticateToken, requirePermission('billing:write'), (req, res) => {
  try {
    const claimId = positiveInteger(req.params.id);
    const documentId = positiveInteger(req.body.documentId || req.body.document_id);
    const claim = db.prepare('SELECT * FROM insurance_claims WHERE id = ?').get(claimId);
    if (!claim) return res.status(404).json({ error: 'Insurance claim not found' });
    const document = db.prepare('SELECT * FROM patient_documents WHERE id = ? AND patient_id = ? AND is_deleted = 0').get(documentId, claim.patient_id);
    if (!document) return res.status(404).json({ error: 'Document not found for this patient' });
    const result = db.prepare(`
      INSERT INTO insurance_claim_attachments (claim_id, document_id, attachment_type, clearinghouse_ref, status, notes, created_by)
      VALUES (?, ?, ?, ?, 'attached', ?, ?)
    `).run(
      claimId,
      documentId,
      cleanText(req.body.attachmentType || req.body.attachment_type || 'supporting_document', { max: 80, required: true }),
      cleanText(req.body.clearinghouseRef || req.body.clearinghouse_ref, { max: 120 }),
      cleanText(req.body.notes, { max: 1000 }),
      req.user.id
    );
    db.prepare('UPDATE patient_documents SET claim_attachment_ready = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(documentId);
    auditLog({ userId: req.user.id, action: 'insurance_claim_attachment_added', entityType: 'insurance_claim', entityId: claimId, req });
    res.status(201).json({
      id: result.lastInsertRowid,
      claim: serializeClaim(db.prepare('SELECT * FROM insurance_claims WHERE id = ?').get(claimId))
    });
  } catch (error) {
    console.error('Claim attachment error:', error);
    res.status(500).json({ error: 'Attachment nije dodat na claim.' });
  }
});

app.post('/api/insurance-claims/:id/submit', authenticateToken, requirePermission('billing:write'), (req, res) => {
  try {
    const claimId = positiveInteger(req.params.id);
    const claim = db.prepare('SELECT * FROM insurance_claims WHERE id = ?').get(claimId);
    if (!claim) return res.status(404).json({ error: 'Insurance claim not found' });
    const attachmentCount = db.prepare('SELECT COUNT(*) as count FROM insurance_claim_attachments WHERE claim_id = ?').get(claimId).count || 0;
    const clearinghouseRef = cleanText(req.body.clearinghouseRef || req.body.clearinghouse_ref, { max: 120 }) || `CH-${claimId}-${Date.now()}`;
    db.prepare(`
      UPDATE insurance_claims
      SET status = 'submitted', submitted_at = ?, clearinghouse_ref = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      new Date().toISOString(),
      clearinghouseRef,
      cleanText(req.body.notes || `Poslato sa ${attachmentCount} priloga.`, { max: 2000 }),
      claimId
    );
    db.prepare("UPDATE insurance_claim_attachments SET status = 'submitted', clearinghouse_ref = ? WHERE claim_id = ?")
      .run(clearinghouseRef, claimId);
    auditLog({ userId: req.user.id, action: 'insurance_claim_submitted', entityType: 'insurance_claim', entityId: claimId, req });
    res.json(serializeClaim(db.prepare('SELECT * FROM insurance_claims WHERE id = ?').get(claimId)));
  } catch (error) {
    console.error('Submit claim error:', error);
    res.status(500).json({ error: 'Claim nije poslat.' });
  }
});

app.post('/api/insurance-claims/:id/era', authenticateToken, requirePermission('billing:write'), (req, res) => {
  try {
    const claimId = positiveInteger(req.params.id);
    const claim = db.prepare('SELECT * FROM insurance_claims WHERE id = ?').get(claimId);
    if (!claim) return res.status(404).json({ error: 'Insurance claim not found' });
    const paidAmount = money(req.body.paidAmount || req.body.paid_amount || req.body.approvedAmount || req.body.approved_amount);
    const approvedAmount = money(req.body.approvedAmount || req.body.approved_amount || paidAmount);
    const denialReason = cleanText(req.body.denialReason || req.body.denial_reason, { max: 1000 });
    const status = denialReason ? 'denied' : (paidAmount >= Number(claim.requested_amount || 0) ? 'paid' : 'partially_approved');
    const eob = {
      payer: claim.provider,
      payerControlNumber: claim.payer_control_number || `EOB-${claimId}`,
      approvedAmount,
      paidAmount,
      adjustment: Math.max(0, Number(claim.requested_amount || 0) - approvedAmount),
      denialReason: denialReason || '',
      receivedAt: new Date().toISOString()
    };
    db.prepare(`
      UPDATE insurance_claims
      SET status = ?, approved_amount = ?, paid_amount = ?, decision_at = ?,
          denial_reason = ?, eob_json = ?, era_status = 'received', ledger_status = 'reconciled',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, approvedAmount, paidAmount, new Date().toISOString(), denialReason, JSON.stringify(eob), claimId);
    if (paidAmount > 0) {
      addLedgerEntry({
        patientId: claim.patient_id,
        invoiceId: claim.invoice_id,
        claimId,
        entryType: 'insurance_payment',
        amount: -paidAmount,
        currency: 'EUR',
        description: `ERA uplata ${claim.provider}`,
        source: 'era',
        userId: req.user.id
      });
    }
    auditLog({ userId: req.user.id, action: 'insurance_era_posted', entityType: 'insurance_claim', entityId: claimId, req });
    res.json(serializeClaim(db.prepare('SELECT * FROM insurance_claims WHERE id = ?').get(claimId)));
  } catch (error) {
    console.error('ERA posting error:', error);
    res.status(500).json({ error: 'ERA/EOB nije proknjizen.' });
  }
});

app.get('/api/patients/:id/ledger', authenticateToken, requirePermission('billing:read'), (req, res) => {
  try {
    const patientId = positiveInteger(req.params.id);
    if (!patientId || !rowExists('patients', patientId)) return res.status(404).json({ error: 'Patient not found' });
    const rows = db.prepare(`
      SELECT * FROM patient_ledger_entries
      WHERE patient_id = ?
      ORDER BY entry_date DESC, created_at DESC, id DESC
    `).all(patientId);
    const balance = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    res.json({
      patientId,
      balance,
      entries: rows.map(row => ({
        id: row.id,
        invoiceId: row.invoice_id,
        claimId: row.claim_id,
        entryType: row.entry_type,
        amount: Number(row.amount || 0),
        currency: row.currency,
        description: row.description,
        entryDate: row.entry_date,
        source: row.source,
        createdAt: row.created_at
      }))
    });
  } catch (error) {
    console.error('Patient ledger error:', error);
    res.status(500).json({ error: 'Ledger nije učitan.' });
  }
});

app.delete('/api/insurance-claims/:id', authenticateToken, requirePermission('billing:write'), (req, res) => {
  const claimId = positiveInteger(req.params.id);
  if (!rowExists('insurance_claims', claimId)) return res.status(404).json({ error: 'Insurance claim not found' });
  db.prepare('DELETE FROM insurance_claims WHERE id = ?').run(claimId);
  auditLog({ userId: req.user.id, action: 'insurance_claim_deleted', entityType: 'insurance_claim', entityId: claimId, req });
  res.json({ success: true });
});

// ============ BACKUP AND SECURITY ENDPOINTS ============

app.get('/api/director/backups/status', authenticateToken, requireDirector, (_req, res) => {
  try {
    res.json(backupStatus());
  } catch (error) {
    console.error('Backup status error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/director/backups', authenticateToken, requireDirector, (_req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM backup_files ORDER BY created_at DESC LIMIT 50').all().map(serializeBackup));
  } catch (error) {
    console.error('List backups error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/director/backups', authenticateToken, requireDirector, async (req, res) => {
  try {
    res.status(201).json(await createEncryptedBackup({ type: 'manual', userId: req.user.id, req }));
  } catch (error) {
    console.error('Create backup error:', error);
    res.status(500).json({ error: 'Rezervna kopija nije mogla da se napravi.' });
  }
});

app.get('/api/director/backups/:id/download', authenticateToken, requireDirector, async (req, res) => {
  try {
    const backup = db.prepare("SELECT * FROM backup_files WHERE id = ? AND status IN ('ready', 'restored')").get(positiveInteger(req.params.id));
    if (!backup) return res.status(404).json({ error: 'Rezervna kopija nije pronađena.' });
    try {
      await fsp.access(backup.file_path);
    } catch {
      return res.status(404).json({ error: 'Rezervna kopija nije pronađena.' });
    }
    auditLog({ userId: req.user.id, action: 'backup_downloaded', entityType: 'backup', entityId: backup.id, req });
    res.download(backup.file_path, backup.filename);
  } catch (error) {
    console.error('Download backup error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/director/backups/:id/restore', authenticateToken, requireDirector, async (req, res) => {
  if (restoreInProgress) {
    return res.status(409).json({ error: 'Vraćanje rezervne kopije je već u toku.' });
  }
  try {
    const confirmation = cleanText(req.body.confirmation, { max: 80 });
    if (confirmation !== 'VRATI BACKUP') {
      return res.status(400).json({ error: 'Unesite VRATI BACKUP da potvrdite vraćanje.' });
    }
    const backup = db.prepare("SELECT * FROM backup_files WHERE id = ? AND status = 'ready'").get(positiveInteger(req.params.id));
    if (!backup) return res.status(404).json({ error: 'Rezervna kopija nije pronađena.' });
    try {
      await fsp.access(backup.file_path);
    } catch {
      return res.status(404).json({ error: 'Rezervna kopija nije pronađena.' });
    }
    restoreInProgress = true;
    await restoreEncryptedBackup(backup, req.user.id, req);
    res.json({ success: true, message: 'Rezervna kopija je vraćena. Osvežite aplikaciju pre nastavka rada.' });
  } catch (error) {
    console.error('Restore backup error:', error);
    res.status(500).json({ error: 'Vraćanje nije uspelo. Pre vraćanja je pokušana izrada rezervne kopije.' });
  } finally {
    restoreInProgress = false;
  }
});

app.post('/api/director/backups/:id/test-restore', authenticateToken, requireDirector, async (req, res) => {
  try {
    const backup = db.prepare("SELECT * FROM backup_files WHERE id = ? AND status IN ('ready', 'restored')").get(positiveInteger(req.params.id));
    if (!backup) return res.status(404).json({ error: 'Rezervna kopija nije pronađena.' });
    try {
      await fsp.access(backup.file_path);
    } catch {
      return res.status(404).json({ error: 'Rezervna kopija nije pronađena.' });
    }
    res.status(201).json(await testEncryptedBackupRestore(backup, req.user.id, req));
  } catch (error) {
    console.error('Test restore backup error:', error);
    res.status(500).json({ error: 'Test vraćanja nije uspeo.' });
  }
});

app.get('/api/director/security/audit-log', authenticateToken, requireDirector, (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100)));
    const filters = [];
    const params = [];
    if (req.query.action) {
      filters.push('a.action = ?');
      params.push(cleanText(req.query.action, { max: 120 }));
    }
    if (req.query.user_id) {
      filters.push('a.user_id = ?');
      params.push(positiveInteger(req.query.user_id));
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = db.prepare(`
      SELECT a.*, u.email
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.user_id
      ${where}
      ORDER BY a.created_at DESC
      LIMIT ?
    `).all(...params, limit);
    res.json(rows.map(serializeRevizijaEntry));
  } catch (error) {
    console.error('Revizija log list error:', error);
    res.status(500).json({ error: 'Revizija log nije učitan.' });
  }
});

app.get('/api/director/security/sessions', authenticateToken, requireDirector, (_req, res) => {
  try {
    const sessions = db.prepare(`
      SELECT rt.*, u.email, u.name, u.role
      FROM refresh_tokens rt
      LEFT JOIN users u ON u.id = rt.user_id
      WHERE rt.revoked_at IS NULL AND rt.expires_at > datetime('now')
      ORDER BY rt.created_at DESC
      LIMIT 100
    `).all();
    res.json(sessions.map(serializeSession));
  } catch (error) {
    console.error('Security sessions error:', error);
    res.status(500).json({ error: 'Sesije nisu učitane.' });
  }
});

app.delete('/api/director/security/sessions/:id', authenticateToken, requireDirector, (req, res) => {
  try {
    const sessionId = positiveInteger(req.params.id);
    const session = db.prepare('SELECT * FROM refresh_tokens WHERE id = ?').get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    db.prepare('UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?').run(sessionId);
    auditLog({ userId: req.user.id, action: 'session_revoked', entityType: 'refresh_token', entityId: sessionId, req, metadata: { userId: session.user_id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Revoke session error:', error);
    res.status(500).json({ error: 'Sesija nije opozvana.' });
  }
});

app.put('/api/director/security/users/:id/permissions', authenticateToken, requireDirector, (req, res) => {
  try {
    const userId = positiveInteger(req.params.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const permissions = Array.isArray(req.body.permissions)
      ? req.body.permissions.map(item => cleanText(item, { max: 80 })).filter(Boolean)
      : DEFAULT_PERMISSIONS[user.role] || [];
    const invalid = invalidPermissions(permissions);
    if (invalid.length) {
      return res.status(400).json({ error: `Invalid permissions: ${invalid.join(', ')}` });
    }
    db.prepare('UPDATE users SET permissions_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(JSON.stringify([...new Set(permissions)]), userId);
    auditLog({ userId: req.user.id, action: 'permissions_updated', entityType: 'user', entityId: userId, req, metadata: { permissions } });
    res.json(serializeUserSecurity(db.prepare('SELECT * FROM users WHERE id = ?').get(userId)));
  } catch (error) {
    console.error('Update permissions error:', error);
    res.status(500).json({ error: 'Dozvole nisu sačuvane.' });
  }
});

app.get('/api/director/legal-export', authenticateToken, requireDirector, (req, res) => {
  try {
    const limit = Math.min(5000, Math.max(1, Number(req.query.limit || 1000)));
    const tables = {
      patients: 'patients',
      records: 'visit_records',
      documents: 'patient_documents',
      invoices: 'invoices',
      insuranceClaims: 'insurance_claims',
      clinicalChart: 'clinical_chart_entries',
      clinicalNotes: 'clinical_notes',
      consents: 'patient_consents'
    };
    const counts = Object.fromEntries(Object.entries(tables).map(([key, table]) => [key, legalExportCount(table)]));
    auditLog({ userId: req.user.id, action: 'legal_export_generated', entityType: 'legal_export', req, metadata: { limit } });
    res.json({
      generatedAt: new Date().toISOString(),
      generatedBy: req.user.email,
      meta: {
        limit,
        counts,
        truncated: Object.fromEntries(Object.entries(counts).map(([key, count]) => [key, count > limit]))
      },
      retentionPolicy: {
        patientRecords: 'Cuvati prema vazecim lokalnim zdravstvenim i poreskim propisima.',
        backups: 'Encrypted backup, periodican test restore i ogranicen direktor pristup.'
      },
      patients: legalExportRows(tables.patients, limit),
      records: legalExportRows(tables.records, limit),
      documents: legalExportRows(tables.documents, limit),
      invoices: legalExportRows(tables.invoices, limit),
      insuranceClaims: legalExportRows(tables.insuranceClaims, limit),
      clinicalChart: legalExportRows(tables.clinicalChart, limit).map(row => ({ ...row, surfaces: safeJsonParse(row.surfaces, []) })),
      clinicalNotes: legalExportRows(tables.clinicalNotes, limit),
      consents: legalExportRows(tables.consents, limit)
    });
  } catch (error) {
    console.error('Pravno export error:', error);
    res.status(500).json({ error: 'Pravno export nije napravljen.' });
  }
});

app.get('/api/director/security/status', authenticateToken, requireDirector, (_req, res) => {
  try {
    const users = db.prepare(`
      SELECT *
      FROM users
      ORDER BY role, email
    `).all();
    const audit = db.prepare(`
      SELECT a.*, u.email
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at DESC
      LIMIT 30
    `).all();
    const sessions = db.prepare(`
      SELECT rt.*, u.email, u.name, u.role
      FROM refresh_tokens rt
      LEFT JOIN users u ON u.id = rt.user_id
      WHERE rt.revoked_at IS NULL AND rt.expires_at > datetime('now')
      ORDER BY rt.created_at DESC
      LIMIT 25
    `).all();
    const restoreTests = db.prepare('SELECT * FROM backup_restore_tests ORDER BY checked_at DESC, id DESC LIMIT 20').all();
    res.json({
      accessTokenTtl: ACCESS_TOKEN_TTL,
      refreshTokenDays: REFRESH_TOKEN_DAYS,
      lockoutAttempts: LOCKOUT_ATTEMPTS,
      lockoutMinutes: LOCKOUT_MINUTES,
      users: users.map(serializeUserSecurity),
      sessions: sessions.map(serializeSession),
      restoreTests: restoreTests.map(serializeRestoreTest),
      auditLog: audit.map(serializeRevizijaEntry)
    });
  } catch (error) {
    console.error('Security status error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/director/security/users/:id/unlock', authenticateToken, requireDirector, (req, res) => {
  try {
    const userId = positiveInteger(req.params.id);
    if (!rowExists('users', userId)) return res.status(404).json({ error: 'User not found' });
    clearFailedLogins(userId);
    auditLog({ userId: req.user.id, action: 'account_unlocked', entityType: 'user', entityId: userId, req });
    res.json({ success: true });
  } catch (error) {
    console.error('Unlock user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/director/security/users/:id/reset-password', authenticateToken, requireDirector, async (req, res) => {
  try {
    const userId = positiveInteger(req.params.id);
    const newPassword = String(req.body.newPassword || '');
    if (!rowExists('users', userId)) return res.status(404).json({ error: 'User not found' });
    if (!isStrongInitialPassword(newPassword)) {
      return res.status(400).json({ error: 'Password must have at least 12 characters.' });
    }
    const newHash = await bcryptHash(newPassword, 12);
    db.prepare(`
      UPDATE users
      SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL, password_changed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newHash, userId);
    db.prepare('UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(userId);
    auditLog({ userId: req.user.id, action: 'password_reset_by_director', entityType: 'user', entityId: userId, req });
    res.json({ success: true });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/2fa/setup', authenticateToken, requireDirector, (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const secret = user.two_factor_secret || randomBase32();
    db.prepare('UPDATE users SET two_factor_secret = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(secret, req.user.id);
    const issuer = encodeURIComponent('Dr Rosa');
    const label = encodeURIComponent(user.email);
    res.json({
      secret,
      otpauthUrl: `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}&digits=6&period=30`
    });
  } catch (error) {
    console.error('2FA setup error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/2fa/verify', authenticateToken, requireDirector, (req, res) => {
  try {
    const code = cleanText(req.body.code, { max: 16 });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user?.two_factor_secret || !verifyTotp(user.two_factor_secret, code)) {
      return res.status(400).json({ error: 'Invalid two-factor code' });
    }
    db.prepare('UPDATE users SET two_factor_enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.user.id);
    auditLog({ userId: req.user.id, action: 'two_factor_enabled', entityType: 'user', entityId: req.user.id, req });
    res.json({ success: true });
  } catch (error) {
    console.error('2FA verify error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/2fa/disable', authenticateToken, requireDirector, async (req, res) => {
  try {
    const password = String(req.body.password || '');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user || !(await bcryptCompare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Password is not correct' });
    }
    db.prepare('UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.user.id);
    auditLog({ userId: req.user.id, action: 'two_factor_disabled', entityType: 'user', entityId: req.user.id, req });
    res.json({ success: true });
  } catch (error) {
    console.error('2FA disable error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/director/calendar-sync', authenticateToken, requireDirector, (_req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM calendar_sync_queue ORDER BY created_at DESC LIMIT 50').all();
    res.json(rows);
  } catch (error) {
    console.error('Get sync queue error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/director/calendar-sync/retry', authenticateToken, requireDirector, async (_req, res) => {
  try {
    const processed = await processCalendarSyncRed({ limit: 25 });
    res.json({ processed });
  } catch (error) {
    console.error('Retry sync queue error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/director/calendar-sync/pull-google', authenticateToken, requireDirector, async (req, res) => {
  try {
    const stats = await pullGoogleCalendarChanges({ reset: req.body?.reset === true });
    auditLog({ userId: req.user.id, action: 'google_calendar_pulled', entityType: 'google_calendar', entityId: 1, req, metadata: stats });
    res.json(stats);
  } catch (error) {
    console.error('Pull Google Calendar changes error:', error);
    res.status(500).json({ error: error.message || 'Google Calendar pull failed' });
  }
});

app.get('/api/director/public-booking/settings', authenticateToken, requireDirector, (_req, res) => {
  try {
    res.json({
      enabled: isPublicBookingEnabled(),
      updatedAt: db.prepare('SELECT updated_at FROM app_settings WHERE key = ?').get('public_booking_enabled')?.updated_at || null
    });
  } catch (error) {
    console.error('Get public booking settings error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/director/public-booking/settings', authenticateToken, requireDirector, (req, res) => {
  try {
    const enabled = req.body.enabled === true || req.body.enabled === 1 || req.body.enabled === '1';
    setAppSetting('public_booking_enabled', enabled ? '1' : '0');
    res.json({
      enabled,
      updatedAt: db.prepare('SELECT updated_at FROM app_settings WHERE key = ?').get('public_booking_enabled')?.updated_at || null
    });
  } catch (error) {
    console.error('Update public booking settings error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/director/google-calendar/settings', authenticateToken, requireDirector, (_req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM google_calendar_settings WHERE id = 1').get();
    const pending = db.prepare("SELECT COUNT(*) as count FROM calendar_sync_queue WHERE status IN ('pending', 'retry', 'failed')").get().count || 0;
    res.json({
      ...publicGoogleSettings(settings),
      pendingSyncItems: Number(pending)
    });
  } catch (error) {
    console.error('Get Google Calendar settings error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/director/google-calendar/settings', authenticateToken, requireDirector, (req, res) => {
  try {
    const current = db.prepare('SELECT * FROM google_calendar_settings WHERE id = 1').get();
    const connectedEmail = cleanText(req.body.connectedEmail ?? req.body.connected_email, { max: 255 });
    const calendarId = cleanText(req.body.calendarId ?? req.body.calendar_id, { max: 255 });
    const calendarName = cleanText(req.body.calendarName ?? req.body.calendar_name, { max: 255 });
    const clientId = cleanText(req.body.clientId ?? req.body.client_id, { max: 255 });
    const clientSecret = cleanText(req.body.clientSecret ?? req.body.client_secret, { max: 255 });
    const redirectUri = cleanText(req.body.redirectUri ?? req.body.redirect_uri, { max: 500 });
    const syncEnabled = req.body.syncEnabled === true || req.body.sync_enabled === 1 ? 1 : 0;
    const syncDirection = req.body.syncDirection === 'two_way' ? 'two_way' : 'app_to_google';
    const defaultReminderMinutes = Math.max(0, Math.min(10080, Number(req.body.defaultReminderMinutes ?? req.body.default_reminder_minutes ?? 1440)));

    if (syncEnabled && (!connectedEmail || !calendarId)) {
      return res.status(400).json({ error: 'Povezan email i kalendar su obavezni kada je sinhronizacija uključena.' });
    }

    const resetGooglePullToken = current?.calendar_id !== calendarId || current?.sync_direction !== syncDirection;

    db.prepare(`
      UPDATE google_calendar_settings
      SET connected_email = ?, calendar_id = ?, calendar_name = ?,
          client_id = COALESCE(?, client_id),
          client_secret = COALESCE(?, client_secret),
          redirect_uri = COALESCE(?, redirect_uri),
          sync_enabled = ?,
          sync_direction = ?, default_reminder_minutes = ?,
          events_sync_token = CASE WHEN ? THEN NULL ELSE events_sync_token END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run(connectedEmail, calendarId, calendarName, clientId, clientSecret, redirectUri, syncEnabled, syncDirection, defaultReminderMinutes, resetGooglePullToken ? 1 : 0);
    res.json(publicGoogleSettings(db.prepare('SELECT * FROM google_calendar_settings WHERE id = 1').get()));
  } catch (error) {
    console.error('Update Google Calendar settings error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/director/google-calendar/oauth/exchange', authenticateToken, requireDirector, async (req, res) => {
  try {
    const rawCode = req.body?.code;
    const code = normalizeGoogleAuthCode(rawCode);
    if (!code) {
      return res.status(400).json({ error: 'OAuth code is required. Paste only the authorization code, not the whole callback URL.' });
    }

    const settings = db.prepare('SELECT * FROM google_calendar_settings WHERE id = 1').get();
    if (!settings.client_id || !settings.client_secret || !settings.redirect_uri) {
      return res.status(400).json({ error: 'Google OAuth client ID, secret and redirect URI are required.' });
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: settings.client_id,
        client_secret: settings.client_secret,
        redirect_uri: settings.redirect_uri,
        grant_type: 'authorization_code'
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
      const detail = data.error_description || data.error || 'Google OAuth exchange failed';
      return res.status(400).json({ error: detail });
    }
    const expiresAt = new Date(Date.now() + Number(data.expires_in || 3600) * 1000).toISOString();
    db.prepare(`
      UPDATE google_calendar_settings
      SET oauth_access_token = ?, oauth_refresh_token = COALESCE(?, oauth_refresh_token),
          oauth_token_expires_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run(data.access_token, data.refresh_token || null, expiresAt);
    auditLog({ userId: req.user.id, action: 'google_calendar_oauth_connected', entityType: 'google_calendar', entityId: 1, req });
    res.json({ success: true, expiresAt });
  } catch (error) {
    console.error('Google OAuth exchange error:', error);
    res.status(500).json({ error: 'Google OAuth exchange failed' });
  }
});

app.post('/api/director/google-calendar/test-sync', authenticateToken, requireDirector, async (_req, res) => {
  try {
    const processed = await processCalendarSyncRed({ limit: 25 });
    const settings = db.prepare('SELECT last_sync_at FROM google_calendar_settings WHERE id = 1').get();
    res.json({ processed, lastSyncAt: settings.last_sync_at });
  } catch (error) {
    console.error('Google Calendar test sync error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ DIRECTOR REPORTS ENDPOINTS ============

app.get('/api/director/reports/financial', authenticateToken, requireDirector, (_req, res) => {
  try {
    const data = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM patients) as total_patients,
        COALESCE(SUM(CASE WHEN payment_status IN ('Plaćeno', 'Plaćeno') THEN amount ELSE 0 END), 0) as total_revenue,
        COALESCE(SUM(CASE WHEN payment_status IN ('Dugovanje', 'Delimično', 'Delimično') THEN amount ELSE 0 END), 0) as total_debt,
        (SELECT COUNT(*) FROM visit_records) as total_visits,
        COALESCE(AVG(CASE WHEN payment_status IN ('Plaćeno', 'Plaćeno') THEN 1.0 ELSE 0.0 END) * 100, 0) as payment_percentage
      FROM payments
    `).get();

    res.json({
      totalRevenue: Number(data.total_revenue || 0),
      totalDebt: Number(data.total_debt || 0),
      totalPatients: Number(data.total_patients || 0),
      totalVisits: Number(data.total_visits || 0),
      paymentPercentage: Number(data.payment_percentage || 0).toFixed(1),
      details: {
        revenue: Number(data.total_revenue || 0).toFixed(2),
        debt: Number(data.total_debt || 0).toFixed(2),
        paidPercentage: Number(data.payment_percentage || 0).toFixed(1)
      }
    });
  } catch (error) {
    console.error('Financial report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/director/reports/patients', authenticateToken, requireDirector, (_req, res) => {
  try {
    const data = db.prepare(`
      SELECT
        COUNT(*) as total_patients,
        SUM(CASE WHEN visit_count > 1 THEN 1 ELSE 0 END) as regular_patients,
        SUM(CASE WHEN visit_count <= 1 THEN 1 ELSE 0 END) as new_patients
      FROM (
        SELECT p.id, COUNT(vr.id) as visit_count
        FROM patients p
        LEFT JOIN visit_records vr ON p.id = vr.patient_id
        GROUP BY p.id
      ) patient_visits
    `).get();

    res.json({
      total: Number(data.total_patients || 0),
      regular: Number(data.regular_patients || 0),
      new: Number(data.new_patients || 0)
    });
  } catch (error) {
    console.error('Patients report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/director/reports/doctors', authenticateToken, requireDirector, (_req, res) => {
  try {
    const totalVisits = db.prepare('SELECT COUNT(*) as count FROM visit_records').get().count || 0;
    const rows = db.prepare(`
      SELECT d.id, d.name, COUNT(vr.id) as visit_count, COUNT(DISTINCT vr.patient_id) as patient_count
      FROM doctors d
      LEFT JOIN visit_records vr ON d.id = vr.doctor_id
      GROUP BY d.id, d.name
      ORDER BY visit_count DESC
    `).all();

    res.json(rows.map(row => ({
      doctor: row.name,
      visits: Number(row.visit_count || 0),
      patients: Number(row.patient_count || 0),
      percentage: totalVisits ? Number(((row.visit_count / totalVisits) * 100).toFixed(1)) : 0
    })));
  } catch (error) {
    console.error('Doctors report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/director/reports/procedures', authenticateToken, requireDirector, (_req, res) => {
  try {
    const totalVisits = db.prepare('SELECT COUNT(*) as count FROM visit_records').get().count || 0;
    const rows = db.prepare(`
      SELECT
        vr.procedure,
        COUNT(*) as count,
        AVG(COALESCE(pay.amount, 0)) as avg_cost
      FROM visit_records vr
      LEFT JOIN payments pay ON vr.id = pay.visit_record_id
      GROUP BY vr.procedure
      ORDER BY count DESC
    `).all();

    res.json(rows.map(row => ({
      procedure: row.procedure,
      count: Number(row.count || 0),
      percentage: totalVisits ? Number(((row.count / totalVisits) * 100).toFixed(1)) : 0,
      avgCost: Number(row.avg_cost || 0)
    })));
  } catch (error) {
    console.error('Procedures report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ DOCTORS ENDPOINTS ============

app.get('/api/doctors', authenticateToken, requirePermission('calendar:read'), (_req, res) => {
  try {
    const doctors = db.prepare('SELECT id, name, specialization, email, phone FROM doctors ORDER BY name').all();
    res.json(doctors);
  } catch (error) {
    console.error('Get doctors error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ DIRECTOR ADMIN CODEBOOKS ============

const CODEBOOK_TYPES = new Set(['activity', 'procedure', 'visit_status', 'payment_status', 'currency', 'shift']);

function normalizeCodebookType(value) {
  const type = cleanText(value, { max: 40, required: true });
  return CODEBOOK_TYPES.has(type) ? type : null;
}

function serializeCodebookItem(row) {
  let metadata = {};
  try {
    metadata = row.metadata ? JSON.parse(row.metadata) : {};
  } catch (_error) {
    metadata = {};
  }
  return {
    id: row.id,
    type: row.type,
    value: row.value,
    label: row.label,
    groupName: row.group_name,
    metadata,
    price: Number(row.price || 0),
    isActive: Boolean(row.is_active),
    sortOrder: Number(row.sort_order || 0)
  };
}

function normalizeCodebookMetadata(type, metadata) {
  const input = metadata && typeof metadata === 'object' ? metadata : {};
  if (type === 'currency') {
    return {
      exchangeRate: input.exchangeRate === undefined || input.exchangeRate === null || input.exchangeRate === ''
        ? null
        : Math.max(0, Number(input.exchangeRate || 0)),
      rateDate: cleanText(input.rateDate, { max: 20 }),
      rateBase: cleanText(input.rateBase, { max: 10 }) || 'EUR',
      rateCurrency: cleanText(input.rateCurrency, { max: 10 }) || null,
      rateSource: cleanText(input.rateSource, { max: 80 }) || null,
      autoUpdatedAt: cleanText(input.autoUpdatedAt, { max: 20 }) || null
    };
  }
  if (type !== 'shift') return {};
  const allowedDays = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);
  const days = Array.isArray(input.days)
    ? input.days.map(day => cleanText(day, { max: 20 })).filter(day => allowedDays.has(day))
    : [];
  return {
    timeFrom: cleanText(input.timeFrom, { max: 5 }) || null,
    timeTo: cleanText(input.timeTo, { max: 5 }) || null,
    days
  };
}

app.get('/api/director/exchange-rate', authenticateToken, requireDirector, async (req, res) => {
  try {
    const base = cleanText(req.query.base || 'EUR', { max: 10, required: true }).toUpperCase();
    const currency = cleanText(req.query.currency, { max: 10, required: true }).toUpperCase();
    if (!currency) return res.status(400).json({ error: 'Currency is required' });
    if (currency === base) {
      return res.json({ base, currency, rate: 1, date: new Date().toISOString().slice(0, 10), source: 'local' });
    }

    const localFallback = localExchangeRate(base, currency);
    if (localFallback && flagEnabled(process.env.EXCHANGE_RATE_LOCAL_FIRST || 'true')) {
      return res.json(localFallback);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.EXCHANGE_RATE_TIMEOUT_MS || 5000));
    const url = `https://api.frankfurter.dev/v2/rate/${encodeURIComponent(base)}/${encodeURIComponent(currency)}`;
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    clearTimeout(timeout);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.rate) {
      const fallback = localFallback || localExchangeRate(base, currency);
      if (fallback) return res.json(fallback);
      return res.status(502).json({ error: data.message || 'Exchange rate provider unavailable' });
    }

    res.json({
      base,
      currency,
      rate: Number(data.rate),
      date: data.date || new Date().toISOString().slice(0, 10),
      source: 'Frankfurter'
    });
  } catch (error) {
    console.warn('Exchange rate provider unavailable:', error.message);
    const fallback = localExchangeRate(
      cleanText(req.query.base || 'EUR', { max: 10, required: true }).toUpperCase(),
      cleanText(req.query.currency, { max: 10, required: true }).toUpperCase()
    );
    if (fallback) return res.json(fallback);
    res.status(502).json({ error: 'Exchange rate provider unavailable' });
  }
});

function localExchangeRate(base, currency) {
  if (!currency) return null;
  if (currency === base) {
    return { base, currency, rate: 1, date: new Date().toISOString().slice(0, 10), source: 'local' };
  }
  const row = db.prepare("SELECT metadata FROM codebook_items WHERE type = 'currency' AND value = ? AND is_active = 1 LIMIT 1").get(currency);
  const metadata = safeJsonParse(row?.metadata, null);
  const rate = Number(metadata?.exchangeRate || 0);
  if (metadata?.rateBase === base && rate > 0) {
    return {
      base,
      currency,
      rate,
      date: metadata.rateDate || new Date().toISOString().slice(0, 10),
      source: metadata.rateSource || 'local-codebook'
    };
  }
  if (metadata?.rateCurrency === base && rate > 0) {
    return {
      base,
      currency,
      rate: 1 / rate,
      date: metadata.rateDate || new Date().toISOString().slice(0, 10),
      source: metadata.rateSource || 'local-codebook'
    };
  }
  return null;
}

app.get('/api/codebooks', authenticateToken, (req, res) => {
  try {
    const type = req.query.type ? normalizeCodebookType(req.query.type) : null;
    if (req.query.type && !type) return res.status(400).json({ error: 'Invalid codebook type' });

    const rows = type
      ? db.prepare('SELECT * FROM codebook_items WHERE type = ? AND is_active = 1 ORDER BY sort_order, label').all(type)
      : db.prepare('SELECT * FROM codebook_items WHERE is_active = 1 ORDER BY type, sort_order, label').all();

    res.json(rows.map(serializeCodebookItem));
  } catch (error) {
    console.error('Get public codebooks error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/director/codebooks', authenticateToken, requireDirector, (req, res) => {
  try {
    const type = req.query.type ? normalizeCodebookType(req.query.type) : null;
    if (req.query.type && !type) return res.status(400).json({ error: 'Invalid codebook type' });

    const rows = type
      ? db.prepare('SELECT * FROM codebook_items WHERE type = ? ORDER BY sort_order, label').all(type)
      : db.prepare('SELECT * FROM codebook_items ORDER BY type, sort_order, label').all();

    res.json(rows.map(serializeCodebookItem));
  } catch (error) {
    console.error('Get codebooks error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/director/codebooks', authenticateToken, requireDirector, (req, res) => {
  try {
    const type = normalizeCodebookType(req.body.type);
    const value = cleanText(req.body.value, { max: 120, required: true });
    const label = cleanText(req.body.label || req.body.value, { max: 120, required: true });
    const groupName = cleanText(req.body.groupName || req.body.group_name, { max: 120 });
    const metadata = normalizeCodebookMetadata(type, req.body.metadata);
    const price = Math.max(0, Number(req.body.price || 0));
    const sortOrder = Number.isInteger(Number(req.body.sortOrder)) ? Number(req.body.sortOrder) : 0;

    if (!type || !value || !label) return res.status(400).json({ error: 'Type, value and label are required' });

    const result = db.prepare(`
      INSERT INTO codebook_items (type, value, label, group_name, price, is_active, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(type, value, label, groupName, price, req.body.isActive === false ? 0 : 1, sortOrder);

    db.prepare('UPDATE codebook_items SET metadata = ? WHERE id = ?').run(JSON.stringify(metadata), result.lastInsertRowid);

    res.status(201).json(serializeCodebookItem(db.prepare('SELECT * FROM codebook_items WHERE id = ?').get(result.lastInsertRowid)));
  } catch (error) {
    if (error.code === 'ERR_SQLITE_ERROR') {
      return res.status(409).json({ error: 'Šifra vec postoji u ovom šifarniku.' });
    }
    console.error('Create codebook error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/director/codebooks/:id', authenticateToken, requireDirector, (req, res) => {
  try {
    const current = db.prepare('SELECT * FROM codebook_items WHERE id = ?').get(req.params.id);
    if (!current) return res.status(404).json({ error: 'Codebook item not found' });

    const data = { ...current, ...req.body };
    const type = normalizeCodebookType(current.type);
    const value = current.value;
    const label = cleanText(data.label || data.value, { max: 120, required: true });
    const groupName = cleanText(data.groupName ?? data.group_name, { max: 120 });
    const metadata = normalizeCodebookMetadata(type, data.metadata);
    const price = Math.max(0, Number(data.price || 0));
    const isActive = data.isActive === false || data.is_active === 0 ? 0 : 1;
    const sortOrder = Number.isInteger(Number(data.sortOrder ?? data.sort_order)) ? Number(data.sortOrder ?? data.sort_order) : 0;

    if (!type || !value || !label) return res.status(400).json({ error: 'Type, value and label are required' });

    db.prepare(`
      UPDATE codebook_items
      SET type = ?, value = ?, label = ?, group_name = ?, metadata = ?, price = ?, is_active = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(type, value, label, groupName, JSON.stringify(metadata), price, isActive, sortOrder, req.params.id);

    res.json(serializeCodebookItem(db.prepare('SELECT * FROM codebook_items WHERE id = ?').get(req.params.id)));
  } catch (error) {
    if (error.code === 'ERR_SQLITE_ERROR') {
      return res.status(409).json({ error: 'Šifra vec postoji u ovom šifarniku.' });
    }
    console.error('Update codebook error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/director/codebooks/:id', authenticateToken, requireDirector, (req, res) => {
  try {
    const current = db.prepare('SELECT * FROM codebook_items WHERE id = ?').get(req.params.id);
    if (!current) return res.status(404).json({ error: 'Codebook item not found' });

    const usage = current.type === 'procedure'
      ? db.prepare('SELECT COUNT(*) as count FROM visit_records WHERE procedure = ?').get(current.value).count || 0
      : 0;
    if (usage > 0) {
      return res.status(409).json({ error: 'Šifra se koristi u zapisima i ne može biti obrisana. Deaktivirajte je umesto brisanja.' });
    }

    db.prepare('DELETE FROM codebook_items WHERE id = ?').run(req.params.id);
    res.json({ id: Number(req.params.id), message: 'Codebook item deleted successfully' });
  } catch (error) {
    console.error('Delete codebook error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ HEALTH CHECK ============

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'API is running',
    database: 'sqlite',
    timestamp: new Date().toISOString()
  });
});

// ============ STATIC FRONTEND ============

const frontendRoot = path.resolve(__dirname, '..');
app.use('/src', express.static(path.join(frontendRoot, 'src')));
app.get(['/', '/index.html'], (_req, res) => {
  res.sendFile(path.join(frontendRoot, 'index.html'));
});

// ============ ERROR HANDLING ============

app.use((err, _req, res, next) => {
  if (!err) return next();
  if (err.message === 'CORS origin not allowed') {
    return res.status(403).json({ error: 'CORS origin not allowed' });
  }
  console.error('Unhandled error:', err);
  return res.status(500).json({ error: 'Server error' });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

async function runAutomaticBackupIfNeeded() {
  try {
    const status = backupStatus();
    if (!status.warning) return;
    await createEncryptedBackup({ type: 'automatic' });
  } catch (error) {
    console.error('Automatic backup error:', error);
  }
}

async function startServer() {
  try {
    applyMigrations();
    await seedDatabase();

    server = app.listen(PORT, () => {
      console.log(`Dr Rosa Backend API running on http://localhost:${PORT}`);
      console.log('SQLite database configured');
    });

    await runAutomaticBackupIfNeeded();
    automaticBackupTimer = setInterval(runAutomaticBackupIfNeeded, 60 * 60 * 1000);
    return server;
  } catch (error) {
    console.error('Startup error:', error);
    try {
      db.close();
    } catch {
      // Ignore close errors during failed startup.
    }
    process.exit(1);
  }
}

function shutdown() {
  if (automaticBackupTimer) clearInterval(automaticBackupTimer);
  if (!server) {
    db.close();
    return;
  }
  const forceExit = setTimeout(() => {
    try {
      db.close();
    } catch {
      // Ignore close errors during forced shutdown.
    }
    process.exit(0);
  }, 1000);
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  server.close(() => {
    clearTimeout(forceExit);
    try {
      db.close();
    } catch {
      // Ignore close errors during shutdown.
    }
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startServer();

module.exports = { app, get server() { return server; }, db, dbPath, startServer };
