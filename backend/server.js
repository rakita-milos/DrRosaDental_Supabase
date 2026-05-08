// Dr Rosa Dental Clinic - SQLite Backend API Server
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const isProduction = process.env.NODE_ENV === 'production';

if (!JWT_SECRET || JWT_SECRET.length < 32 || JWT_SECRET === 'your-secret-key-change-in-production') {
  throw new Error('Set JWT_SECRET in backend/.env to a unique value with at least 32 characters.');
}

const dbPath = path.resolve(__dirname, process.env.SQLITE_DB_PATH || './data/drosa.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA journal_mode = WAL');

const schema = fs.readFileSync(path.join(__dirname, 'database.sql'), 'utf8');
db.exec(schema);

applyMigrations();
seedDatabase();

app.disable('x-powered-by');
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
  }
}));
app.use(express.json({ limit: '256kb' }));

function allowedCorsOrigins() {
  const configured = process.env.CORS_ORIGIN || process.env.FRONTEND_ORIGIN || 'http://localhost:5173,http://localhost:3000,http://127.0.0.1:5500';
  return configured
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

function createRateLimiter({ windowMs, max, message }) {
  const hits = new Map();

  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const entry = hits.get(key) || { count: 0, resetAt: now + windowMs };

    if (entry.resetAt <= now) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }

    entry.count += 1;
    hits.set(key, entry);

    if (entry.count > max) {
      return res.status(429).json({ error: message });
    }

    next();
  };
}

const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: 'Too many login attempts. Try again later.'
});

function seedDatabase() {
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
    insertUser.run('director@drosa.com', bcrypt.hashSync(directorPassword, 12), 'Dr Rosa Basic', 'director');
    insertUser.run('staff@drosa.com', bcrypt.hashSync(staffPassword, 12), 'Ana - Medicinska sestra', 'staff');
  }

  seedCodebooks();
  rotateDefaultPasswords();
}

function applyMigrations() {
  ensureColumn('visit_records', 'shift', "TEXT NOT NULL DEFAULT 'Prva smena'");
  ensureColumn('visit_records', 'total_discount', "REAL NOT NULL DEFAULT 0");
  ensureColumn('payments', 'currency', "TEXT NOT NULL DEFAULT 'EUR'");
  ensureColumn('treatments', 'price', "REAL NOT NULL DEFAULT 0");
  ensureColumn('treatments', 'discount', "REAL NOT NULL DEFAULT 0");
  ensureCodebookTable();
  ensureColumn('codebook_items', 'metadata', "TEXT");
  ensureDefaultShiftMetadata();
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
  ['Zakazano', 'U tijeku', 'Zavrseno', 'Otkazano'].forEach((item, index) => add('visit_status', item, item, null, 0, index + 1));
  ['Placeno', 'Dugovanje', 'Delimicno'].forEach((item, index) => add('payment_status', item, item, null, 0, index + 1));
  ['EUR', 'RSD', 'USD'].forEach((item, index) => add('currency', item, item, null, 0, index + 1));
  add('shift', 'Prva smena', 'Prva smena', null, 0, 1, { timeFrom: '08:00', timeTo: '14:00', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] });
  add('shift', 'Druga smena', 'Druga smena', null, 0, 2, { timeFrom: '14:00', timeTo: '20:00', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] });
}

function isStrongInitialPassword(value) {
  return typeof value === 'string' && value.length >= 12 && value !== 'password123';
}

function rotateDefaultPasswords() {
  const users = db.prepare('SELECT id, email, password_hash, role FROM users').all();
  const weakUsers = users.filter(user => bcrypt.compareSync('password123', user.password_hash));

  if (weakUsers.length === 0) return;

  const replacements = {
    director: process.env.INITIAL_DIRECTOR_PASSWORD,
    staff: process.env.INITIAL_STAFF_PASSWORD
  };

  const updatePassword = db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  weakUsers.forEach(user => {
    const replacement = replacements[user.role];
    if (!isStrongInitialPassword(replacement)) {
      throw new Error(`User ${user.email} still has the old default password. Set INITIAL_${user.role.toUpperCase()}_PASSWORD to rotate it.`);
    }
    updatePassword.run(bcrypt.hashSync(replacement, 12), user.id);
  });
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

function requireDirector(req, res, next) {
  if (req.user.role !== 'director') {
    return res.status(403).json({ error: 'Director access required' });
  }
  next();
}

function normalizePaymentStatus(value) {
  const raw = String(value || '').toLowerCase();
  if (raw.includes('pla')) return 'Placeno';
  if (raw.includes('delimi') || raw.includes('delimi')) return 'Delimicno';
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
  if (raw.includes('zavr')) return 'Zavrseno';
  if (raw.includes('otkaz')) return 'Otkazano';
  if (raw.includes('tijek') || raw.includes('toku')) return 'U tijeku';
  return value || 'Zakazano';
}

function rowExists(table, id) {
  return Boolean(db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id));
}

function nullable(value) {
  return value === undefined ? null : value;
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

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

// ============ AUTHENTICATION ENDPOINTS ============

app.post('/api/auth/login', loginLimiter, (req, res) => {
  try {
    const email = cleanText(req.body.email, { max: 255, required: true }).toLowerCase();
    const password = String(req.body.password || '');
    const selectedRole = cleanText(req.body.role, { max: 32 });

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (selectedRole && user.role !== selectedRole) {
      return res.status(403).json({ error: 'Selected role does not match this account' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/verify', authenticateToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// ============ PATIENTS ENDPOINTS ============

app.get('/api/patients', authenticateToken, (_req, res) => {
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

app.get('/api/patients/:id', authenticateToken, (req, res) => {
  try {
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    res.json(patient);
  } catch (error) {
    console.error('Get patient error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/patients', authenticateToken, (req, res) => {
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

app.put('/api/patients/:id', authenticateToken, (req, res) => {
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

app.delete('/api/patients/:id', authenticateToken, (req, res) => {
  try {
    const current = db.prepare('SELECT id FROM patients WHERE id = ?').get(req.params.id);
    if (!current) return res.status(404).json({ error: 'Patient not found' });

    const relatedRecords = db.prepare('SELECT COUNT(*) as count FROM visit_records WHERE patient_id = ?').get(req.params.id).count || 0;
    const relatedPayments = db.prepare('SELECT COUNT(*) as count FROM payments WHERE patient_id = ?').get(req.params.id).count || 0;
    if (relatedRecords > 0 || relatedPayments > 0) {
      return res.status(409).json({
        error: 'Pacijent ima povezanu istoriju/posete i ne moze biti obrisan dok se ti zapisi ne uklone.',
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

// ============ VISIT RECORDS ENDPOINTS ============

app.get('/api/records', authenticateToken, (_req, res) => {
  try {
    const records = db.prepare(`
      SELECT
        vr.id,
        vr.visit_date,
        vr.procedure,
        vr.status,
        vr.shift,
        vr.total_discount,
        p.id as patient_id,
        p.first_name,
        p.last_name,
        d.id as doctor_id,
        d.name as doctor_name,
        COALESCE(pay.amount, 0) as amount_due,
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
      SELECT tooth_number, treatment_type, status, notes, price, discount
      FROM treatments
      WHERE visit_record_id = ?
    `);

    res.json(records.map(record => {
      const treatments = {};
      getTreatments.all(record.id).forEach(treatment => {
        if (!treatments[treatment.tooth_number]) treatments[treatment.tooth_number] = [];
        treatments[treatment.tooth_number].push({
          type: treatment.treatment_type,
          status: treatment.status,
          note: treatment.notes,
          price: Number(treatment.price || 0),
          discount: Number(treatment.discount || 0)
        });
      });
      return { ...record, treatments };
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
    INSERT INTO visit_records (patient_id, doctor_id, visit_date, procedure, status, shift, total_discount, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    patientId,
    doctorId,
    cleanText(record.visit_date, { max: 20, required: true }),
    cleanText(record.procedure, { max: 255, required: true }),
    normalizeStatus(record.status),
    normalizeShift(record.shift),
    Math.max(0, Number(record.total_discount || 0)),
    cleanText(record.notes, { max: 2000 })
  );

  const visitId = visitResult.lastInsertRowid;

  db.prepare(`
    INSERT INTO payments (visit_record_id, patient_id, amount, currency, payment_status)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    visitId,
    patientId,
    Math.max(0, Number(record.amount || 0)),
    normalizeCurrency(record.currency),
    normalizePaymentStatus(record.payment_status)
  );

  if (record.treatments && typeof record.treatments === 'object') {
    const insertTreatment = db.prepare(`
      INSERT INTO treatments (visit_record_id, tooth_number, treatment_type, status, notes, price, discount)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    Object.entries(record.treatments).forEach(([toothNumber, treatments]) => {
      const treatmentList = Array.isArray(treatments) ? treatments : [treatments];
      treatmentList.forEach(treatment => {
        insertTreatment.run(
          visitId,
          cleanText(toothNumber, { max: 10 }),
          cleanText(treatment.type, { max: 255, required: true }),
          normalizeStatus(treatment.status || 'Planirano'),
          cleanText(treatment.note, { max: 1000 }),
          Math.max(0, Number(treatment.price || 0)),
          Math.max(0, Number(treatment.discount || 0))
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

app.post('/api/records', authenticateToken, (req, res) => {
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

app.put('/api/records/:id', authenticateToken, (req, res) => {
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

    res.json({ id: Number(req.params.id), message: 'Record updated successfully' });
  } catch (error) {
    console.error('Update record error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/records/:id', authenticateToken, (req, res) => {
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

// ============ DIRECTOR REPORTS ENDPOINTS ============

app.get('/api/director/reports/financial', authenticateToken, requireDirector, (_req, res) => {
  try {
    const data = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM patients) as total_patients,
        COALESCE(SUM(CASE WHEN payment_status IN ('Placeno', 'Plaćeno') THEN amount ELSE 0 END), 0) as total_revenue,
        COALESCE(SUM(CASE WHEN payment_status IN ('Dugovanje', 'Delimicno', 'Delimično') THEN amount ELSE 0 END), 0) as total_debt,
        (SELECT COUNT(*) FROM visit_records) as total_visits,
        COALESCE(AVG(CASE WHEN payment_status IN ('Placeno', 'Plaćeno') THEN 1.0 ELSE 0.0 END) * 100, 0) as payment_percentage
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

app.get('/api/doctors', authenticateToken, (_req, res) => {
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
      rateSource: cleanText(input.rateSource, { max: 80 }) || null
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

    const url = `https://api.frankfurter.dev/v2/rate/${encodeURIComponent(base)}/${encodeURIComponent(currency)}`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.rate) {
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
    console.error('Exchange rate error:', error);
    res.status(502).json({ error: 'Exchange rate provider unavailable' });
  }
});

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
      return res.status(409).json({ error: 'Sifra vec postoji u ovom sifarniku.' });
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
      return res.status(409).json({ error: 'Sifra vec postoji u ovom sifarniku.' });
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
      return res.status(409).json({ error: 'Sifra se koristi u zapisima i ne moze biti obrisana. Deaktivirajte je umesto brisanja.' });
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

const server = app.listen(PORT, () => {
  console.log(`Dr Rosa Backend API running on http://localhost:${PORT}`);
  console.log('SQLite database configured');
});

function shutdown() {
  server.close(() => {
    db.close();
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { app, server, db, dbPath };
