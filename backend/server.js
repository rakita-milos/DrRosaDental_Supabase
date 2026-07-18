// Dr Rosa Dental Clinic - Backend API Server
const path = require('path');
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
}
const fs = require('fs');
const fsp = fs.promises;
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const util = require('util');
const bcryptCompare = util.promisify(bcrypt.compare);
const bcryptHash = util.promisify(bcrypt.hash);
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { createAuthSessionRepository } = require('./db/auth-session');
const { createPatientsRepository } = require('./db/patients');
const { createPatientDocumentsRepository } = require('./db/patient-documents');
const { createRecordsPaymentsRepository } = require('./db/records-payments');
const { createCalendarRepository } = require('./db/calendar');
const { createDirectorReportsRepository } = require('./db/director-reports');
const { createDirectorAdminRepository } = require('./db/director-admin');
const { createClinicalRepository } = require('./db/clinical');
const { createBillingRepository } = require('./db/billing');
const { createRuntimeSettingsRepository } = require('./db/runtime-settings');
const { createStartupSeedRepository } = require('./db/startup-seed');
const { createPool, initializePostgresSchema } = require('./db/postgres');
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
const DB_CLIENT = 'postgres';

if (process.env.DB_CLIENT && String(process.env.DB_CLIENT).trim().toLowerCase() !== DB_CLIENT) {
  throw new Error('This backend is PostgreSQL-only. Set DB_CLIENT=postgres or remove DB_CLIENT.');
}

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
requireProductionEnv('DATABASE_URL');

let pgPool = createPool();
const authSessions = createAuthSessionRepository({ pgPool });
const patientsRepo = createPatientsRepository({ pgPool });
const patientDocumentsRepo = createPatientDocumentsRepository({ pgPool });
const recordsPaymentsRepo = createRecordsPaymentsRepository({ pgPool });
const calendarRepo = createCalendarRepository({ pgPool });
const directorReports = createDirectorReportsRepository({ pgPool });
const directorAdmin = createDirectorAdminRepository({ pgPool });
const clinicalRepo = createClinicalRepository({ pgPool });
const billingRepo = createBillingRepository({ pgPool });
const runtimeSettings = createRuntimeSettingsRepository({ pgPool });
const startupSeed = createStartupSeedRepository({ pgPool });

let server;
let runtimeReadyPromise;

function closePostgresPool() {
  if (!pgPool) return;
  const pool = pgPool;
  pgPool = null;
  void pool.end().catch(error => {
    console.error('PostgreSQL pool close error:', error);
  });
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

  return async (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const resetAt = now + windowMs;

    try {
      cleanupAfter += 1;
      if (cleanupAfter >= 100) {
        cleanupAfter = 0;
        await runtimeSettings.cleanupRateLimitHits(now);
      }

      const current = await runtimeSettings.rateLimitHit(key);
      let count;
      if (!current || Number(current.reset_at) <= now) {
        count = 1;
        await runtimeSettings.upsertRateLimitHit({ key, count, resetAt });
      } else {
        count = Number(current.count || 0) + 1;
        await runtimeSettings.updateRateLimitCount({ key, count });
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

async function seedDatabase() {
  const doctorCount = await startupSeed.doctorsCount();
  if (doctorCount === 0) {
    await startupSeed.insertDoctor({ name: 'Dr Rosa', specialization: 'General Dentistry', licenseNumber: 'DL001', email: 'rosa@drosa.com', phone: '+381-11-1234567' });
    await startupSeed.insertDoctor({ name: 'Dr Novak', specialization: 'Prosthodontics', licenseNumber: 'DL002', email: 'novak@drosa.com', phone: '+381-11-2345678' });
    await startupSeed.insertDoctor({ name: 'Dr Horvat', specialization: 'Orthodontics', licenseNumber: 'DL003', email: 'horvat@drosa.com', phone: '+381-11-3456789' });
  }

  const chairCount = await startupSeed.chairsCount();
  if (chairCount === 0) {
    await startupSeed.insertChair('Stolica 1');
    await startupSeed.insertChair('Stolica 2');
  }

  const userCount = await startupSeed.usersCount();
  if (userCount === 0) {
    const directorPassword = process.env.INITIAL_DIRECTOR_PASSWORD;
    const staffPassword = process.env.INITIAL_STAFF_PASSWORD;

    if (!isStrongInitialPassword(directorPassword) || !isStrongInitialPassword(staffPassword)) {
      throw new Error('Set INITIAL_DIRECTOR_PASSWORD and INITIAL_STAFF_PASSWORD to unique values with at least 12 characters.');
    }

    const directorHash = await bcryptHash(directorPassword, 12);
    const staffHash = await bcryptHash(staffPassword, 12);
    await startupSeed.insertUser({ email: 'director@drosa.com', passwordHash: directorHash, name: 'Dr Rosa Basic', role: 'director' });
    await startupSeed.insertUser({ email: 'staff@drosa.com', passwordHash: staffHash, name: 'Ana - Medicinska sestra', role: 'staff' });
  }

  await seedCodebooks();
  await ensureDefaultOperationalCodebooksPostgres();
  await rotateDefaultPasswords();
}

async function ensureRuntimeReady() {
  if (!runtimeReadyPromise) {
    runtimeReadyPromise = (async () => {
      await initializePostgresSchema(pgPool);
      await seedDatabase();
    })();
  }
  return runtimeReadyPromise;
}

app.use('/api', async (_req, res, next) => {
  try {
    await ensureRuntimeReady();
    next();
  } catch (error) {
    console.error('Runtime initialization error:', error);
    res.status(503).json({ error: 'Service initialization failed.' });
  }
});

async function appSetting(key, fallback = '') {
  return (await runtimeSettings.appSetting(key))?.value ?? fallback;
}

function setAppSetting(key, value) {
  return runtimeSettings.setAppSetting({ key, value });
}

async function isPublicBookingEnabled() {
  return await appSetting('public_booking_enabled', '1') === '1';
}

async function requirePublicBookingEnabled(_req, res, next) {
  try {
    if (await isPublicBookingEnabled()) return next();
    return res.status(503).json({ error: 'Onlajn zakazivanje trenutno nije dostupno.' });
  } catch (error) {
    console.error('Public booking setting error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function seedCodebooks() {
  const count = await startupSeed.codebookCount();
  if (count > 0) return;

  const inserts = [];
  const add = (type, value, label = value, groupName = null, price = 0, sortOrder = 0, metadata = null) => {
    inserts.push(startupSeed.insertCodebookItem({ type, value, label, groupName, metadata, price, sortOrder }));
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
  await Promise.all(inserts);
}

const DEFAULT_OPERATIONAL_CODEBOOKS = [
  {
    type: 'payment_method',
    value: 'Gotovina',
    label: 'Gotovina',
    sortOrder: 1,
    metadata: { countsAsRevenue: true, countsInCashRegister: true }
  },
  {
    type: 'payment_method',
    value: 'Kartica',
    label: 'Kartica',
    sortOrder: 2,
    metadata: { countsAsRevenue: true, countsInCashRegister: false }
  },
  {
    type: 'payment_method',
    value: 'Virman',
    label: 'Virman',
    sortOrder: 3,
    metadata: { countsAsRevenue: true, countsInCashRegister: false }
  },
  {
    type: 'payment_method',
    value: 'Avans',
    label: 'Avans',
    sortOrder: 4,
    metadata: { countsAsRevenue: true, countsInCashRegister: true }
  },
  {
    type: 'cash_report_item',
    value: 'Kurir',
    label: 'Kurir',
    sortOrder: 1,
    metadata: { lineType: 'outflow' }
  },
  {
    type: 'cash_report_item',
    value: 'Materijal',
    label: 'Materijal',
    sortOrder: 2,
    metadata: { lineType: 'outflow' }
  },
  {
    type: 'cash_report_item',
    value: 'Tehnicar',
    label: 'Tehnicar',
    sortOrder: 3,
    metadata: { lineType: 'outflow' }
  },
  {
    type: 'cash_report_item',
    value: 'Ostalo',
    label: 'Ostalo',
    sortOrder: 99,
    metadata: { lineType: 'outflow' }
  }
];

async function ensureDefaultOperationalCodebooksPostgres() {
  for (const item of DEFAULT_OPERATIONAL_CODEBOOKS) {
    await startupSeed.ensureCodebookItem(item);
  }
}

function isStrongInitialPassword(value) {
  return typeof value === 'string' && value.length >= 12 && value !== 'password123';
}

async function rotateDefaultPasswords() {
  const users = await authSessions.usersForPasswordRotation();
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

  for (const user of weakUsers) {
    const replacement = replacements[user.role];
    if (!isStrongInitialPassword(replacement)) {
      throw new Error(`User ${user.email} still has the old default password. Set INITIAL_${user.role.toUpperCase()}_PASSWORD to rotate it.`);
    }
    const newHash = await bcryptHash(replacement, 12);
    await authSessions.updateUserPasswordHash(user.id, newHash);
  }
}

async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const cookies = parseCookies(req);
  const token = (authHeader && authHeader.split(' ')[1]) || cookies.drrosa_access;

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const tokenUser = jwt.verify(token, JWT_SECRET);
    const user = await authSessions.findUserByIdEmail(
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
  } catch (error) {
    if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
      return res.status(403).json({ error: 'Invalid token' });
    }
    console.error('Auth token error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
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

async function auditLog({ userId = null, action, entityType = null, entityId = null, req = null, metadata = null }) {
  try {
    await authSessions.insertAuditLog({
      userId,
      action,
      entityType,
      entityId: entityId === null || entityId === undefined ? null : String(entityId),
      ipAddress: req?.ip || null,
      metadata: metadata ? JSON.stringify(metadata) : null
    });
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

async function createRefreshToken(userId, req) {
  const token = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await authSessions.createRefreshToken({
    userId,
    tokenHash: hashToken(token),
    userAgent: cleanText(req.headers['user-agent'], { max: 255 }),
    ipAddress: req.ip,
    expiresAt
  });
  return { token, expiresAt };
}

async function issueSession(user, req, res) {
  const refresh = await createRefreshToken(user.id, req);
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

async function registerFailedLogin(user, req) {
  if (!user) return;
  const attempts = Number(user.failed_login_attempts || 0) + 1;
  const lockedUntil = attempts >= LOCKOUT_ATTEMPTS
    ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
    : null;
  await authSessions.updateFailedLogin({ userId: user.id, attempts, lockedUntil });
  await auditLog({ userId: user.id, action: lockedUntil ? 'account_locked' : 'login_failed', entityType: 'user', entityId: user.id, req });
}

async function clearFailedLogins(userId) {
  await authSessions.clearFailedLogins(userId);
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

function postgresBackupUnavailable() {
  const error = new Error('Supabase PostgreSQL backups are managed outside the application. Use Supabase database backups or pg_dump/restore from a maintenance workflow.');
  error.statusCode = 501;
  return error;
}

async function requestPostgresBackup({ type = 'manual', userId = null, req = null } = {}) {
  await auditLog({ userId, action: 'postgres_backup_requested', entityType: 'backup', req, metadata: { type, strategy: 'supabase-managed' } });
  throw postgresBackupUnavailable();
}

async function backupStatus() {
  return {
    mode: 'supabase_postgres',
    lastBackup: null,
    backupCount: 0,
    warning: false,
    warningMessage: null,
    message: 'Supabase PostgreSQL backups are managed outside the application.'
  };
}

async function requestPostgresRestore(backup, userId, req) {
  await auditLog({ userId, action: 'postgres_restore_requested', entityType: 'backup', entityId: backup?.id || null, req, metadata: { strategy: 'supabase-managed' } });
  throw postgresBackupUnavailable();
}

async function requestPostgresRestoreTest(backup, userId, req) {
  await auditLog({ userId, action: 'postgres_restore_test_requested', entityType: 'backup', entityId: backup?.id || null, req, metadata: { strategy: 'supabase-managed' } });
  throw postgresBackupUnavailable();
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

async function procedureByInput({ procedureId, procedureName }) {
  if (procedureId) {
    const byId = await directorAdmin.procedureById(procedureId);
    if (byId) return byId;
  }
  const name = cleanText(procedureName, { max: 255 });
  if (!name) return null;
  return (await directorAdmin.procedureByName(name)) || null;
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
  return directorReports.legalExportRows(table, limit);
}

function legalExportCount(table) {
  return directorReports.legalExportCount(table);
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

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function exchangeRateToRsd(currency) {
  const normalized = normalizeCurrency(currency);
  if (normalized === 'RSD') return 1;
  const local = await localExchangeRate('RSD', normalized);
  if (local?.rate > 0) return 1 / Number(local.rate);
  const direct = await localExchangeRate(normalized, 'RSD');
  if (direct?.rate > 0) return Number(direct.rate);
  return normalized === 'USD' ? 108 : 117;
}

async function normalizePaymentPart(part) {
  const currency = normalizeCurrency(part.currency);
  const amount = money(part.amount);
  const providedRate = Number(part.exchangeRateToRsd ?? part.exchange_rate_to_rsd ?? 0);
  const rate = providedRate > 0 ? providedRate : await exchangeRateToRsd(currency);
  return {
    amount: roundMoney(amount),
    currency,
    exchangeRateToRsd: rate,
    amountRsd: roundMoney(amount * rate),
    paymentMethod: cleanText(part.paymentMethod || part.payment_method, { max: 80 }),
    paymentDate: cleanText(part.paymentDate || part.payment_date || todayIsoDate(), { max: 20 }),
    notes: cleanText(part.notes, { max: 1000 })
  };
}

async function normalizedPaymentParts(record) {
  const parts = Array.isArray(record.paymentParts)
    ? record.paymentParts
    : Array.isArray(record.payment_parts)
      ? record.payment_parts
      : null;
  if (parts) return (await Promise.all(parts.map(normalizePaymentPart))).filter(part => part.amount > 0);

  const amountPaid = money(record.amount_paid ?? record.amountPaid ?? 0);
  if (amountPaid <= 0) return [];
  return [await normalizePaymentPart({
    amount: amountPaid,
    currency: record.currency,
    paymentMethod: record.payment_method,
    paymentDate: record.payment_date
  })];
}

async function calculatePaymentSummary({ amount, currency, paymentParts, paymentStatus }) {
  const total = money(amount);
  const recordCurrency = normalizeCurrency(currency);
  const recordRate = await exchangeRateToRsd(recordCurrency);
  const totalRsd = total * recordRate;
  const paidRsd = paymentParts.reduce((sum, part) => sum + Number(part.amountRsd || 0), 0);
  const paidInRecordCurrency = roundMoney(recordRate > 0 ? paidRsd / recordRate : paidRsd);
  const debtInRecordCurrency = roundMoney(Math.max(0, total - paidInRecordCurrency));
  const status = total > 0
    ? paidRsd <= 0
      ? 'Dugovanje'
      : paidRsd + 0.01 >= totalRsd
        ? 'PlaÄ‡eno'
        : 'DelimiÄno'
    : normalizePaymentStatus(paymentStatus);
  return {
    amountDue: debtInRecordCurrency,
    amountPaid: Math.min(total || paidInRecordCurrency, paidInRecordCurrency),
    paymentStatus: status
  };
}

async function totalAmountForPayment(record, paymentParts, currency) {
  const explicit = money(record.totalAmount ?? record.total_amount ?? 0);
  if (explicit > 0) return explicit;
  const recordRate = await exchangeRateToRsd(currency);
  const paidInRecordCurrency = paymentParts.reduce((sum, part) => sum + (recordRate > 0 ? Number(part.amountRsd || 0) / recordRate : Number(part.amount || 0)), 0);
  return roundMoney(money(record.amount) + paidInRecordCurrency);
}

function normalizedTreatments(record) {
  if (!record.treatments || typeof record.treatments !== 'object') return [];
  return Object.entries(record.treatments).flatMap(([toothNumber, treatments]) => {
    const treatmentList = Array.isArray(treatments) ? treatments : [treatments];
    return treatmentList.map(treatment => {
      const price = Math.max(0, Number(treatment.price || 0));
      const discountType = treatment.discountType === 'percent' || treatment.discount_type === 'percent' ? 'percent' : 'amount';
      const rawDiscountValue = Number(treatment.discountValue ?? treatment.discount_value ?? treatment.discount ?? 0);
      const discountValue = discountType === 'percent'
        ? Math.min(100, Math.max(0, rawDiscountValue))
        : Math.max(0, rawDiscountValue);
      const discount = discountType === 'percent'
        ? Math.min(price, price * discountValue / 100)
        : Math.min(price, discountValue);
      return {
        toothNumber: cleanText(toothNumber, { max: 10 }),
        type: cleanText(treatment.type, { max: 255, required: true }),
        status: normalizeStatus(treatment.status || 'Planirano'),
        note: cleanText(treatment.note, { max: 1000 }),
        price,
        discount,
        discountType,
        discountValue
      };
    });
  });
}

function signedMoney(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function appointmentDurationMinutes(startsAt, endsAt) {
  return Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000);
}

function appointmentConflict({ appointmentId = null, doctorId, chairId, startsAt, endsAt }) {
  return calendarRepo.appointmentConflict({ appointmentId, doctorId, chairId, startsAt, endsAt });
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
  return calendarRepo.appointmentById(id);
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
  await calendarRepo.updateGoogleAccessToken({ accessToken: data.access_token, expiresAt });
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

async function queueCalendarSync(appointmentId, action) {
  await calendarRepo.queueCalendarSync({ appointmentId, action });
}

async function processCalendarSyncRed({ limit = 10 } = {}) {
  const settings = await calendarRepo.googleSettings();
  const rows = await calendarRepo.pendingSyncQueue(limit);

  let processed = 0;
  for (const item of rows) {
    try {
      if (!settings?.sync_enabled || !settings.connected_email || !settings.calendar_id) {
        await calendarRepo.markSyncSkipped({ queueId: item.id, appointmentId: item.appointment_id, error: 'Google Calendar account or calendar is not configured.' });
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
      await calendarRepo.markSyncDone({ queueId: item.id, appointmentId: item.appointment_id, googleEventId });
      processed += 1;
    } catch (error) {
      await calendarRepo.markSyncFailed({ queueId: item.id, error: cleanText(error.message, { max: 500 }) });
    }
  }

  return processed;
}

async function googleEventAppointmentId(event) {
  const raw = event?.extendedProperties?.private?.drrosaAppointmentId;
  const id = positiveInteger(raw);
  if (id) return id;
  const googleEventId = cleanText(event?.id, { max: 255 });
  if (googleEventId) {
    const existingId = await calendarRepo.appointmentIdByGoogleEventId(googleEventId);
    if (existingId) return existingId;
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

async function updateAppointmentFromGoogleEvent(event) {
  const appointmentId = await googleEventAppointmentId(event);
  if (!appointmentId) return { action: 'skipped_external' };

  const current = await appointmentById(appointmentId);
  if (!current) return { action: 'skipped_missing_local', appointmentId };

  if (event.status === 'cancelled') {
    if (current.status !== 'cancelled') {
      await calendarRepo.cancelFromGoogle({ id: current.id, oldStatus: current.status });
      return { action: 'cancelled', appointmentId };
    }
    return { action: 'unchanged', appointmentId };
  }

  const times = googleEventTimes(event);
  if (!times) return { action: 'skipped_unsupported_time', appointmentId };

  const conflict = await appointmentConflict({
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

  await calendarRepo.updateFromGoogle({
    id: current.id,
    startsAt: times.startsAt,
    endsAt: times.endsAt,
    durationMinutes: appointmentDurationMinutes(times.startsAt, times.endsAt),
    procedureName,
    notes,
    googleEventId: event.id,
    status
  });
  return { action: 'updated', appointmentId };
}

async function pullGoogleCalendarChanges({ limit = 250, reset = false } = {}) {
  const settings = await calendarRepo.googleSettings();
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
        await calendarRepo.clearGoogleEventsSyncToken();
        return pullGoogleCalendarChanges({ limit, reset: true });
      }
      throw error;
    }

    for (const event of data.items || []) {
      stats.fetched += 1;
      const result = await updateAppointmentFromGoogleEvent(event);
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
    await calendarRepo.markGooglePull({ syncToken: nextSyncToken });
  } else {
    await calendarRepo.markGooglePull({});
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
  if (!(await patientsRepo.findPatientById(patientId))) {
    const error = new Error('Patient not found');
    error.status = 404;
    throw error;
  }
  if (visitRecordId && !(await recordsPaymentsRepo.findRecordById(visitRecordId))) {
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

  return serializeDocument(await patientDocumentsRepo.createDocument({
    patientId,
    visitRecordId: visitRecordId || null,
    documentType: normalizeDocumentType(documentType),
    title: cleanText(title || originalFilename, { max: 160, required: true }),
    description: cleanText(description, { max: 1000 }),
    documentDate: cleanText(documentDate, { max: 20 }),
    originalFilename: cleanText(originalFilename, { max: 255, required: true }),
    storedFilename,
    filePath: targetPath,
    mimeType,
    fileSize: buffer.length,
    fileHash: hash,
    source: source || 'upload',
    uploadedBy: userId,
    imagingModality: cleanText(imagingModality, { max: 40 }),
    toothNumber: cleanText(toothNumber, { max: 40 }),
    acquisitionDate: cleanText(acquisitionDate || documentDate, { max: 20 }),
    dicomStudyUid: cleanText(dicomStudyUid, { max: 120 }),
    claimAttachmentReady: normalizeBoolean(claimAttachmentReady)
  }));
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

function patientPayloadFromBody(body) {
  return {
    firstName: cleanText(body.first_name, { max: 80, required: true }),
    lastName: cleanText(body.last_name, { max: 80, required: true }),
    dateOfBirth: nullable(cleanText(body.date_of_birth, { max: 20 })),
    gender: nullable(cleanText(body.gender, { max: 30 })),
    email: nullable(cleanText(body.email, { max: 255 })),
    phone: nullable(cleanText(body.phone, { max: 50 })),
    address: nullable(cleanText(body.address, { max: 255 })),
    emergencyContact: nullable(cleanText(body.emergency_contact, { max: 255 })),
    medicalHistory: nullable(cleanText(body.medical_history, { max: 2000 }))
  };
}

function medicalProfilePayloadFromBody(body, updatedBy) {
  return {
    bloodType: cleanText(body.bloodType || body.blood_type, { max: 20 }),
    allergies: cleanText(body.allergies, { max: 2000 }),
    medications: cleanText(body.medications, { max: 2000 }),
    chronicConditions: cleanText(body.chronicConditions || body.chronic_conditions, { max: 2000 }),
    contraindications: cleanText(body.contraindications, { max: 2000 }),
    previousSurgeries: cleanText(body.previousSurgeries || body.previous_surgeries, { max: 2000 }),
    pregnancyStatus: cleanText(body.pregnancyStatus || body.pregnancy_status, { max: 255 }),
    smoker: normalizeBoolean(body.smoker),
    diabetes: normalizeBoolean(body.diabetes),
    highBloodPressure: normalizeBoolean(body.highBloodPressure || body.high_blood_pressure),
    heartCondition: normalizeBoolean(body.heartCondition || body.heart_condition),
    anesthesiaWarning: cleanText(body.anesthesiaWarning || body.anesthesia_warning, { max: 2000 }),
    dentalNotes: cleanText(body.dentalNotes || body.dental_notes, { max: 2000 }),
    internalNotes: cleanText(body.internalNotes || body.internal_notes, { max: 2000 }),
    updatedBy
  };
}

// ============ AUTHENTICATION ENDPOINTS ============

app.post('/api/auth/login', loginLimiter, validateBody(loginSchema), async (req, res) => {
  try {
    const email = String(req.body.email).toLowerCase();
    const password = String(req.body.password);
    const selectedRole = cleanText(req.body.role, { max: 32 });
    const twoFactorCode = cleanText(req.body.twoFactorCode, { max: 16 });

    const user = await authSessions.findUserByEmail(email);
    if (user && isUserLocked(user)) {
      return res.status(423).json({ error: 'Account is temporarily locked. Try again later.' });
    }

    if (!user || !(await bcryptCompare(password, user.password_hash))) {
      await registerFailedLogin(user, req);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (selectedRole && user.role !== selectedRole) {
      await registerFailedLogin(user, req);
      return res.status(403).json({ error: 'Selected role does not match this account' });
    }

    if (user.two_factor_enabled && !verifyTotp(user.two_factor_secret, twoFactorCode)) {
      await auditLog({ userId: user.id, action: 'two_factor_required', entityType: 'user', entityId: user.id, req });
      return res.status(401).json({
        error: twoFactorCode ? 'Invalid two-factor code' : 'Two-factor code required',
        requires2fa: true,
        userId: user.id
      });
    }

    await clearFailedLogins(user.id);
    await auditLog({ userId: user.id, action: 'login_success', entityType: 'user', entityId: user.id, req });
    res.json(await issueSession(user, req, res));
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/verify', authenticateToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

app.post('/api/auth/refresh', async (req, res) => {
  try {
    const refreshToken = String(req.body.refreshToken || parseCookies(req).drrosa_refresh || '');
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });
    const row = await authSessions.findRefreshSessionByTokenHash(hashToken(refreshToken));
    if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    await authSessions.revokeRefreshTokenById(row.id);
    const session = await issueSession({
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

app.post('/api/auth/logout', authenticateToken, async (req, res) => {
  try {
    const refreshToken = String(req.body.refreshToken || parseCookies(req).drrosa_refresh || '');
    if (refreshToken) {
      await authSessions.revokeRefreshTokenByHash(hashToken(refreshToken));
    }
    await auditLog({ userId: req.user.id, action: 'logout', entityType: 'user', entityId: req.user.id, req });
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
    const user = await authSessions.findUserById(req.user.id);
    if (!user || !(await bcryptCompare(currentPassword, user.password_hash))) {
      return res.status(401).json({ error: 'Current password is not correct' });
    }
    const newHash = await bcryptHash(newPassword, 12);
    await authSessions.updatePasswordAndMarkChanged({ userId: req.user.id, passwordHash: newHash });
    await authSessions.revokeRefreshTokensByUserId(req.user.id);
    await auditLog({ userId: req.user.id, action: 'password_changed', entityType: 'user', entityId: req.user.id, req });
    res.json({ success: true });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ PATIENTS ENDPOINTS ============

app.get('/api/patients', authenticateToken, requirePermission('patients:read'), async (_req, res) => {
  try {
    const patients = await patientsRepo.listPatients();
    res.json(patients);
  } catch (error) {
    console.error('Get patients error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/patients/:id', authenticateToken, requirePermission('patients:read'), async (req, res) => {
  try {
    const patient = await patientsRepo.findPatientById(positiveInteger(req.params.id));
    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    res.json(patient);
  } catch (error) {
    console.error('Get patient error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/patients', authenticateToken, requirePermission('patients:write'), validateBody(patientCreateSchema), async (req, res) => {
  try {
    const patientPayload = patientPayloadFromBody(req.body);
    if (!patientPayload.firstName || !patientPayload.lastName) {
      return res.status(400).json({ error: 'First name and last name required' });
    }

    const patient = await patientsRepo.createPatient(patientPayload);
    res.status(201).json(patient);
  } catch (error) {
    console.error('Create patient error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/patients/:id', authenticateToken, requirePermission('patients:write'), validateBody(patientUpdateSchema), async (req, res) => {
  try {
    const patientId = positiveInteger(req.params.id);
    const current = await patientsRepo.findPatientById(patientId);
    if (!current) return res.status(404).json({ error: 'Patient not found' });

    const data = { ...current, ...req.body };
    const patientPayload = patientPayloadFromBody(data);
    if (!patientPayload.firstName || !patientPayload.lastName) {
      return res.status(400).json({ error: 'First name and last name required' });
    }

    res.json(await patientsRepo.updatePatient(patientId, patientPayload));
  } catch (error) {
    console.error('Update patient error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/patients/:id', authenticateToken, requirePermission('patients:write'), async (req, res) => {
  try {
    const patientId = positiveInteger(req.params.id);
    const current = await patientsRepo.findPatientById(patientId);
    if (!current) return res.status(404).json({ error: 'Patient not found' });

    const related = await patientsRepo.patientDeleteCounts(patientId);
    if (related.records > 0 || related.payments > 0) {
      return res.status(409).json({
        error: 'Pacijent ima povezanu istoriju/posete i ne može biti obrisan dok se ti zapisi ne uklone.',
        related: {
          records: related.records,
          payments: related.payments
        }
      });
    }

    await patientsRepo.deletePatient(patientId);
    res.json({ id: patientId, message: 'Patient deleted successfully' });
  } catch (error) {
    console.error('Delete patient error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ PATIENT MEDICAL PROFILE / DOCUMENTS ============

app.get('/api/patients/:id/medical-profile', authenticateToken, requirePermission('patients:read'), async (req, res) => {
  try {
    const patientId = positiveInteger(req.params.id);
    if (!patientId || !(await patientsRepo.findPatientById(patientId))) return res.status(404).json({ error: 'Patient not found' });
    const row = await patientsRepo.getMedicalProfile(patientId);
    res.json(serializeMedicalProfile(row, patientId));
  } catch (error) {
    console.error('Get medical profile error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/patients/:id/medical-profile', authenticateToken, requirePermission('patients:write'), async (req, res) => {
  try {
    const patientId = positiveInteger(req.params.id);
    if (!patientId || !(await patientsRepo.findPatientById(patientId))) return res.status(404).json({ error: 'Patient not found' });

    const row = await patientsRepo.upsertMedicalProfile(
      patientId,
      medicalProfilePayloadFromBody(req.body, req.user.id)
    );
    res.json(serializeMedicalProfile(row, patientId));
  } catch (error) {
    console.error('Update medical profile error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/patients/:id/documents', authenticateToken, requirePermission('documents:read'), async (req, res) => {
  try {
    const patientId = positiveInteger(req.params.id);
    if (!patientId || !(await patientsRepo.findPatientById(patientId))) return res.status(404).json({ error: 'Patient not found' });
    const rows = await patientDocumentsRepo.listByPatient(patientId);
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
    const row = await patientDocumentsRepo.findActiveById(documentId);
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
    const row = await patientDocumentsRepo.findActiveById(documentId);
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

app.delete('/api/documents/:id', authenticateToken, requirePermission('documents:write'), async (req, res) => {
  try {
    const documentId = positiveInteger(req.params.id);
    const row = await patientDocumentsRepo.findActiveById(documentId);
    if (!row) return res.status(404).json({ error: 'Document not found' });
    await patientDocumentsRepo.softDelete(documentId);
    res.json({ id: documentId, message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/documents/:id', authenticateToken, requirePermission('documents:write'), async (req, res) => {
  try {
    const documentId = positiveInteger(req.params.id);
    const current = await patientDocumentsRepo.findActiveById(documentId);
    if (!current) return res.status(404).json({ error: 'Dokument nije pronadjen' });

    const updated = await patientDocumentsRepo.updateDocument(documentId, {
      visitRecordId: positiveInteger(req.body.visitRecordId || req.body.visit_record_id) || null,
      documentType: normalizeDocumentType(req.body.documentType || req.body.document_type || current.document_type),
      title: cleanText(req.body.title ?? current.title, { max: 160, required: true }),
      description: cleanText(req.body.description ?? current.description, { max: 1000 }),
      documentDate: cleanText(req.body.documentDate ?? req.body.document_date ?? current.document_date, { max: 20 }),
      imagingModality: cleanText(req.body.imagingModality ?? req.body.imaging_modality ?? current.imaging_modality, { max: 40 }),
      toothNumber: cleanText(req.body.toothNumber ?? req.body.tooth_number ?? current.tooth_number, { max: 40 }),
      acquisitionDate: cleanText(req.body.acquisitionDate ?? req.body.acquisition_date ?? current.acquisition_date, { max: 20 }),
      dicomStudyUid: cleanText(req.body.dicomStudyUid ?? req.body.dicom_study_uid ?? current.dicom_study_uid, { max: 120 }),
      claimAttachmentReady: req.body.claimAttachmentReady === undefined && req.body.claim_attachment_ready === undefined
        ? current.claim_attachment_ready
        : normalizeBoolean(req.body.claimAttachmentReady ?? req.body.claim_attachment_ready)
    });
    await auditLog({ userId: req.user.id, action: 'document_updated', entityType: 'document', entityId: documentId, req });
    res.json(serializeDocument(updated));
  } catch (error) {
    console.error('Update document error:', error);
    res.status(500).json({ error: 'Dokument nije sačuvan.' });
  }
});

app.get('/api/patients/:id/imaging', authenticateToken, requirePermission('documents:read'), async (req, res) => {
  try {
    const patientId = positiveInteger(req.params.id);
    if (!patientId || !(await patientsRepo.findPatientById(patientId))) return res.status(404).json({ error: 'Patient not found' });
    const rows = await patientDocumentsRepo.listImagingByPatient(patientId);
    res.json(rows.map(serializeDocument));
  } catch (error) {
    console.error('Get imaging error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/documents/:id/imaging', authenticateToken, requirePermission('documents:write'), async (req, res) => {
  try {
    const documentId = positiveInteger(req.params.id);
    const current = await patientDocumentsRepo.findActiveById(documentId);
    if (!current) return res.status(404).json({ error: 'Document not found' });
    const updated = await patientDocumentsRepo.updateImaging(documentId, {
      imagingModality: cleanText(req.body.imagingModality || req.body.imaging_modality || current.imaging_modality, { max: 40 }),
      toothNumber: cleanText(req.body.toothNumber || req.body.tooth_number || current.tooth_number, { max: 40 }),
      acquisitionDate: cleanText(req.body.acquisitionDate || req.body.acquisition_date || current.acquisition_date, { max: 20 }),
      dicomStudyUid: cleanText(req.body.dicomStudyUid || req.body.dicom_study_uid || current.dicom_study_uid, { max: 120 }),
      claimAttachmentReady: req.body.claimAttachmentReady === undefined && req.body.claim_attachment_ready === undefined
        ? current.claim_attachment_ready
        : normalizeBoolean(req.body.claimAttachmentReady || req.body.claim_attachment_ready)
    });
    await auditLog({ userId: req.user.id, action: 'imaging_metadata_updated', entityType: 'document', entityId: documentId, req });
    res.json(serializeDocument(updated));
  } catch (error) {
    console.error('Update imaging metadata error:', error);
    res.status(500).json({ error: 'Metapodaci snimka nije sačuvan.' });
  }
});

app.post('/api/documents/:id/imaging/analyze', authenticateToken, requirePermission('documents:write'), async (req, res) => {
  try {
    const documentId = positiveInteger(req.params.id);
    const current = await patientDocumentsRepo.findActiveById(documentId);
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
    const updated = await patientDocumentsRepo.saveAiFindings(documentId, JSON.stringify(findings));
    await auditLog({ userId: req.user.id, action: 'imaging_ai_reviewed', entityType: 'document', entityId: documentId, req });
    res.json(serializeDocument(updated));
  } catch (error) {
    console.error('Analyze imaging error:', error);
    res.status(500).json({ error: 'AI analiza nije uspela.' });
  }
});

// ============ VISIT RECORDS ENDPOINTS ============

app.get('/api/records', authenticateToken, requirePermission('records:read'), async (_req, res) => {
  try {
    const records = await recordsPaymentsRepo.listRecords();
    const hydrated = [];
    for (const record of records) {
      const treatments = {};
      let treatmentTotal = 0;
      const treatmentRows = await recordsPaymentsRepo.treatmentsForRecord(record.id);
      treatmentRows.forEach(treatment => {
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
      const paymentRows = await recordsPaymentsRepo.paymentPartsForRecord(record.id);
      const paymentParts = paymentRows.map(part => ({
        id: part.id,
        amount: Number(part.amount || 0),
        currency: part.currency || 'EUR',
        exchangeRateToRsd: Number(part.exchange_rate_to_rsd || 0),
        amountRsd: Number(part.amount_rsd || 0),
        paymentMethod: part.payment_method || '',
        paymentDate: part.payment_date || '',
        notes: part.notes || ''
      }));
      hydrated.push({ ...record, amount_paid: Number(record.amount_paid || inferredPaid || 0), paymentParts, treatments });
    }
    res.json(hydrated);
  } catch (error) {
    console.error('Get records error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

async function insertRecordTransaction(record) {
  const patientId = positiveInteger(record.patient_id);
  const doctorId = positiveInteger(record.doctor_id);
  const paymentParts = await normalizedPaymentParts(record);
  const totalAmount = await totalAmountForPayment(record, paymentParts, record.currency);
  const summary = await calculatePaymentSummary({
    amount: totalAmount,
    currency: record.currency,
    paymentParts,
    paymentStatus: record.payment_status
  });
  return recordsPaymentsRepo.createRecord({
    record: {
      patientId,
      doctorId,
      visitDate: cleanText(record.visit_date, { max: 20, required: true }),
      procedure: cleanText(record.procedure, { max: 255, required: true }),
      status: normalizeStatus(record.status),
      shift: normalizeShift(record.shift),
      notes: cleanText(record.notes, { max: 2000 }),
      currency: normalizeCurrency(record.currency)
    },
    paymentSummary: summary,
    paymentParts,
    treatments: normalizedTreatments(record)
  });
}

app.post('/api/records', authenticateToken, requirePermission('records:write'), validateBody(recordCreateSchema), async (req, res) => {
  try {
    const patient_id = positiveInteger(req.body.patient_id);
    const doctor_id = positiveInteger(req.body.doctor_id);
    const visit_date = cleanText(req.body.visit_date, { max: 20, required: true });
    const procedure = cleanText(req.body.procedure, { max: 255, required: true });
    if (!patient_id || !doctor_id || !visit_date || !procedure) {
      return res.status(400).json({ error: 'Patient, doctor, date and procedure required' });
    }
    if (!(await recordsPaymentsRepo.rowExists('patients', patient_id))) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    if (!(await recordsPaymentsRepo.rowExists('doctors', doctor_id))) {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    const visitId = await insertRecordTransaction({ ...req.body, patient_id, doctor_id, visit_date, procedure });
    res.status(201).json({ id: visitId, message: 'Record created successfully' });
  } catch (error) {
    console.error('Create record error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/records/:id', authenticateToken, requirePermission('records:write'), async (req, res) => {
  try {
    const recordId = positiveInteger(req.params.id);
    const current = await recordsPaymentsRepo.findRecordById(recordId);
    if (!current) return res.status(404).json({ error: 'Record not found' });

    const data = { ...current, ...req.body };
    const procedure = cleanText(data.procedure, { max: 255, required: true });
    if (!procedure) {
      return res.status(400).json({ error: 'Procedure required' });
    }

    await recordsPaymentsRepo.updateRecord({
      id: recordId,
      procedure,
      status: normalizeStatus(data.status),
      shift: normalizeShift(data.shift),
      notes: cleanText(data.notes, { max: 2000 })
    });

    if (
      req.body.amount !== undefined
      || req.body.amount_paid !== undefined
      || req.body.amountPaid !== undefined
      || req.body.currency !== undefined
      || req.body.payment_status !== undefined
      || req.body.paymentParts !== undefined
      || req.body.payment_parts !== undefined
    ) {
      const payment = await recordsPaymentsRepo.findPaymentByVisitRecordId(recordId);
      const patientId = payment?.patient_id || current.patient_id;
      const amount = req.body.amount ?? payment?.amount ?? 0;
      const currency = req.body.currency ?? payment?.currency ?? 'EUR';
      const paymentParts = await normalizedPaymentParts({
        ...req.body,
        amount_paid: req.body.amount_paid ?? req.body.amountPaid ?? payment?.amount_paid ?? 0,
        currency
      });
      const summary = await calculatePaymentSummary({
        amount: await totalAmountForPayment({ ...req.body, amount }, paymentParts, currency),
        currency,
        paymentParts,
        paymentStatus: req.body.payment_status ?? payment?.payment_status
      });
      await recordsPaymentsRepo.upsertPayment({
        visitRecordId: recordId,
        patientId,
        payment,
        paymentSummary: summary,
        paymentParts,
        currency: normalizeCurrency(currency)
      });
    }

    res.json({ id: recordId, message: 'Record updated successfully' });
  } catch (error) {
    console.error('Update record error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/records/:id', authenticateToken, requirePermission('records:write'), async (req, res) => {
  try {
    const recordId = positiveInteger(req.params.id);
    const current = await recordsPaymentsRepo.findRecordById(recordId);
    if (!current) return res.status(404).json({ error: 'Record not found' });

    await recordsPaymentsRepo.deleteRecord(recordId);
    res.json({ id: recordId, message: 'Record deleted successfully' });
  } catch (error) {
    console.error('Delete record error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ APPOINTMENTS / CALENDAR ENDPOINTS ============

app.get('/api/chairs', authenticateToken, requirePermission('calendar:read'), async (_req, res) => {
  try {
    res.json(await calendarRepo.listActiveChairs());
  } catch (error) {
    console.error('Get chairs error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/appointments', authenticateToken, requirePermission('calendar:read'), async (req, res) => {
  try {
    const from = normalizeIsoDateTime(req.query.from || '1970-01-01T00:00:00.000Z');
    const to = normalizeIsoDateTime(req.query.to || '2999-12-31T23:59:59.999Z');
    const doctorId = req.query.doctor_id ? positiveInteger(req.query.doctor_id) : null;
    const status = req.query.status ? normalizeAppointmentStatus(req.query.status) : null;
    if (!from || !to) return res.status(400).json({ error: 'Invalid date range' });

    const rows = await calendarRepo.listAppointments({ from, to, doctorId, status });
    res.json(rows.map(serializeAppointment));
  } catch (error) {
    console.error('Get appointments error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/appointments', authenticateToken, requirePermission('calendar:write'), async (req, res) => {
  try {
    const patientId = positiveInteger(req.body.patient_id ?? req.body.patientId);
    const doctorId = positiveInteger(req.body.doctor_id ?? req.body.doctorId);
    const chairId = positiveInteger(req.body.chair_id ?? req.body.chairId);
    const procedureIdInput = positiveInteger(req.body.procedure_id ?? req.body.procedureId);
    const procedure = await procedureByInput({
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
    if (!(await calendarRepo.rowExists('patients', patientId))) return res.status(404).json({ error: 'Patient not found' });
    if (!(await calendarRepo.rowExists('doctors', doctorId))) return res.status(404).json({ error: 'Doctor not found' });
    if (!(await calendarRepo.rowExists('chairs', chairId))) return res.status(404).json({ error: 'Chair not found' });

    const conflict = await appointmentConflict({ doctorId, chairId, startsAt, endsAt });
    if (conflict) {
      return res.status(409).json({ error: 'Termin se preklapa sa postojećim zakazivanjem.', conflict });
    }

    const appointmentId = await calendarRepo.createAppointment({
      patientId,
      doctorId,
      chairId,
      procedureId: procedure.id,
      procedureName,
      startsAt,
      endsAt,
      durationMinutes: appointmentDurationMinutes(startsAt, endsAt),
      status,
      notes,
      userId: req.user.id
    });
    await queueCalendarSync(appointmentId, 'create_google_event');
    processCalendarSyncRed({ limit: 5 });
    res.status(201).json(serializeAppointment(await appointmentById(appointmentId)));
  } catch (error) {
    console.error('Create appointment error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/appointments/:id', authenticateToken, requirePermission('calendar:write'), async (req, res) => {
  try {
    const current = await appointmentById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Appointment not found' });

    const data = { ...current, ...req.body };
    const patientId = positiveInteger(data.patient_id ?? data.patientId);
    const doctorId = positiveInteger(data.doctor_id ?? data.doctorId);
    const chairId = positiveInteger(data.chair_id ?? data.chairId);
    const procedureIdInput = positiveInteger(data.procedure_id ?? data.procedureId);
    const procedure = await procedureByInput({
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

    const conflict = await appointmentConflict({ appointmentId: current.id, doctorId, chairId, startsAt, endsAt });
    if (conflict) {
      return res.status(409).json({ error: 'Termin se preklapa sa postojećim zakazivanjem.', conflict });
    }

    await calendarRepo.updateAppointment(current.id, {
      patientId,
      doctorId,
      chairId,
      procedureId: procedure.id,
      procedureName,
      startsAt,
      endsAt,
      durationMinutes: appointmentDurationMinutes(startsAt, endsAt),
      status,
      notes,
      userId: req.user.id
    }, current.status);
    await queueCalendarSync(current.id, status === 'cancelled' ? 'cancel_google_event' : 'update_google_event');
    processCalendarSyncRed({ limit: 5 });
    res.json(serializeAppointment(await appointmentById(current.id)));
  } catch (error) {
    console.error('Update appointment error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.patch('/api/appointments/:id/status', authenticateToken, requirePermission('calendar:write'), async (req, res) => {
  try {
    const current = await appointmentById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Appointment not found' });
    const status = normalizeAppointmentStatus(req.body.status);
    await calendarRepo.updateAppointmentStatus({ id: current.id, oldStatus: current.status, status, userId: req.user.id });
    await queueCalendarSync(current.id, status === 'cancelled' ? 'cancel_google_event' : 'update_google_event');
    processCalendarSyncRed({ limit: 5 });
    res.json(serializeAppointment(await appointmentById(current.id)));
  } catch (error) {
    console.error('Update appointment status error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/appointments/:id', authenticateToken, requirePermission('calendar:write'), async (req, res) => {
  try {
    const current = await appointmentById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Appointment not found' });
    if (req.query.hard === '1') {
      await calendarRepo.deleteAppointment(current.id);
      return res.json({ id: Number(current.id), message: 'Appointment deleted successfully' });
    }
    await calendarRepo.cancelAppointment({ id: current.id, userId: req.user.id });
    await queueCalendarSync(current.id, 'cancel_google_event');
    processCalendarSyncRed({ limit: 5 });
    res.json({ id: Number(current.id), message: 'Appointment cancelled successfully' });
  } catch (error) {
    console.error('Delete appointment error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/appointments/:id/create-visit', authenticateToken, requirePermission('calendar:write'), requirePermission('records:write'), async (req, res) => {
  try {
    const appointment = await appointmentById(req.params.id);
    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });
    if (appointment.visit_record_id) {
      return res.status(409).json({ error: 'Visit already exists for this appointment', visitRecordId: appointment.visit_record_id });
    }

    const visitId = await insertRecordTransaction({
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
    await calendarRepo.completeAppointment({ id: appointment.id, visitRecordId: visitId, oldStatus: appointment.status, userId: req.user.id });
    await queueCalendarSync(appointment.id, 'update_google_event');
    processCalendarSyncRed({ limit: 5 });
    res.status(201).json({ id: visitId, appointmentId: appointment.id, message: 'Visit created from appointment' });
  } catch (error) {
    console.error('Create visit from appointment error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ PUBLIC BOOKING ENDPOINTS ============

app.get('/api/public/booking/status', publicBookingReadLimiter, async (_req, res) => {
  try {
    res.json({ enabled: await isPublicBookingEnabled() });
  } catch (error) {
    console.error('Public booking status error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/public/booking/options', publicBookingReadLimiter, requirePublicBookingEnabled, async (_req, res) => {
  try {
    res.json(await calendarRepo.publicBookingOptions());
  } catch (error) {
    console.error('Public booking options error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/public/booking/availability', publicBookingReadLimiter, requirePublicBookingEnabled, async (req, res) => {
  try {
    const dateText = cleanText(req.query.date, { max: 20, required: true });
    const doctorId = positiveInteger(req.query.doctor_id);
    const duration = Math.max(15, Math.min(180, Number(req.query.duration || 30)));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return res.status(400).json({ error: 'Valid date is required.' });
    const doctors = await calendarRepo.publicBookingDoctors(doctorId);
    const chair = await calendarRepo.defaultActiveChair();
    if (!chair) return res.json({ slots: [] });
    const slots = [];
    doctors.forEach(doctor => {
      for (let hour = 8; hour < 18; hour += 1) {
        ['00', '30'].forEach(minute => {
          const startsAt = normalizeIsoDateTime(`${dateText}T${String(hour).padStart(2, '0')}:${minute}:00`);
          const endsAt = addMinutes(new Date(startsAt), duration).toISOString();
          // Collected sequentially below to keep async conflict checks deterministic.
          slots.push({ doctorId: doctor.id, doctorName: doctor.name, chairId: chair.id, startsAt, endsAt, durationMinutes: duration, _checkConflict: true });
        });
      }
    });
    const available = [];
    for (const slot of slots) {
      if (!(await appointmentConflict({ doctorId: slot.doctorId, chairId: slot.chairId, startsAt: slot.startsAt, endsAt: slot.endsAt }))) {
        const { _checkConflict, ...publicSlot } = slot;
        available.push(publicSlot);
      }
    }
    res.json({ slots: available });
  } catch (error) {
    console.error('Public availability error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/public/booking', publicBookingWriteLimiter, requirePublicBookingEnabled, validateBody(publicBookingSchema), async (req, res) => {
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
    const defaultChair = await calendarRepo.defaultActiveChair();
    const chairId = positiveInteger(req.body.chairId || req.body.chair_id) || defaultChair?.id;
    const procedureId = positiveInteger(req.body.procedureId || req.body.procedure_id);
    const startsAt = normalizeIsoDateTime(req.body.startsAt || req.body.starts_at);
    const duration = Math.max(15, Math.min(180, Number(req.body.durationMinutes || req.body.duration_minutes || 30)));
    const endsAt = startsAt ? addMinutes(new Date(startsAt), duration).toISOString() : null;
    const procedure = await procedureByInput({
      procedureId,
      procedureName: req.body.procedureName || req.body.procedure_name
    });
    const procedureNameResult = validatedText(req.body.procedureName || req.body.procedure_name || procedure?.label, { field: 'Postupak', max: 255, required: true });
    if (procedureNameResult.error) return res.status(400).json({ error: procedureNameResult.error });
    const procedureName = procedureNameResult.value;

    if (!firstName || !lastName || !phone || !doctorId || !chairId || !procedure || !procedureName || !startsAt || !endsAt) {
      return res.status(400).json({ error: 'Ime, prezime, broj telefona, datum, doktor i postupak su obavezni.' });
    }
    if (!(await calendarRepo.rowExists('doctors', doctorId))) return res.status(404).json({ error: 'Doktor nije pronadjen.' });
    if (!procedure) return res.status(404).json({ error: 'Postupak nije pronadjen.' });
    const conflict = await appointmentConflict({ doctorId, chairId, startsAt, endsAt });
    if (conflict) return res.status(409).json({ error: 'Termin vise nije slobodan.' });

    const responsePayload = await calendarRepo.createPublicBooking({
      patient: { firstName, lastName, email, phone },
      appointment: {
        doctorId,
        chairId,
        procedureId: procedure.id,
        procedureName,
        startsAt,
        endsAt,
        durationMinutes: duration,
        notes: notesResult.value
      },
      booking: { notes: notesResult.value }
    });
    await queueCalendarSync(responsePayload.appointmentId, 'create_google_event');

    processCalendarSyncRed({ limit: 5 });
    res.status(201).json(responsePayload);
  } catch (error) {
    console.error('Public booking create error:', error);
    res.status(500).json({ error: 'Termin nije zakazan.' });
  }
});

// ============ ADVANCED PATIENT WORKFLOW ENDPOINTS ============

async function invoiceNumber() {
  const year = new Date().getFullYear();
  const count = await billingRepo.invoiceCountForYear(year) + 1;
  return `DR-${year}-${String(count).padStart(5, '0')}`;
}

async function serializeTreatmentPlan(plan) {
  const items = await clinicalRepo.treatmentPlanItems(plan.id);
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

function treatmentPlanPayloadFromBody(body, patientId, userId, fallback = {}) {
  return {
    patientId,
    title: cleanText(body.title, { max: 160, required: true }) || fallback.title || 'Plan terapije',
    status: ['draft', 'presented', 'accepted', 'declined', 'completed'].includes(body.status) ? body.status : fallback.status || 'draft',
    currency: normalizeCurrency(body.currency || fallback.currency),
    discount: money(body.discount ?? fallback.discount),
    notes: cleanText(body.notes, { max: 2000 }),
    createdBy: userId
  };
}

function treatmentPlanItemsFromBody(items = []) {
  return items.map((item, index) => ({
    phase: Math.max(1, Number(item.phase || 1)),
    toothNumber: cleanText(item.toothNumber || item.tooth_number, { max: 20 }),
    procedureName: cleanText(item.procedureName || item.procedure_name, { max: 255, required: true }),
    description: cleanText(item.description, { max: 1000 }),
    quantity: Math.max(0.01, Number(item.quantity || 1)),
    unitPrice: money(item.unitPrice || item.unit_price),
    discount: money(item.discount),
    sortOrder: Number(item.sortOrder || item.sort_order || index)
  }));
}

app.get('/api/patients/:id/treatment-plans', authenticateToken, requirePermission('clinical:read'), async (req, res) => {
  const patientId = positiveInteger(req.params.id);
  const plans = await clinicalRepo.treatmentPlansByPatient(patientId);
  res.json(await Promise.all(plans.map(serializeTreatmentPlan)));
});

app.post('/api/patients/:id/treatment-plans', authenticateToken, requirePermission('clinical:write'), async (req, res) => {
  try {
    const patientId = positiveInteger(req.params.id);
    if (!(await patientsRepo.findPatientById(patientId))) return res.status(404).json({ error: 'Patient not found' });
    const plan = await clinicalRepo.createTreatmentPlan(
      treatmentPlanPayloadFromBody(req.body, patientId, req.user.id),
      treatmentPlanItemsFromBody(req.body.items || [])
    );
    await auditLog({ userId: req.user.id, action: 'treatment_plan_created', entityType: 'treatment_plan', entityId: plan.id, req });
    res.status(201).json(await serializeTreatmentPlan(plan));
  } catch (error) {
    console.error('Create treatment plan error:', error);
    res.status(500).json({ error: 'Plan terapije nije sačuvan.' });
  }
});

app.put('/api/treatment-plans/:id', authenticateToken, requirePermission('clinical:write'), async (req, res) => {
  try {
    const planId = positiveInteger(req.params.id);
    const plan = await clinicalRepo.findTreatmentPlan(planId);
    if (!plan) return res.status(404).json({ error: 'Treatment plan not found' });
    const updated = await clinicalRepo.updateTreatmentPlan(
      planId,
      treatmentPlanPayloadFromBody(req.body, plan.patient_id, req.user.id, plan),
      treatmentPlanItemsFromBody(req.body.items || [])
    );
    res.json(await serializeTreatmentPlan(updated));
  } catch (error) {
    console.error('Update treatment plan error:', error);
    res.status(500).json({ error: 'Plan terapije nije azuriran.' });
  }
});

app.post('/api/treatment-plans/:id/accept', authenticateToken, requirePermission('clinical:write'), async (req, res) => {
  const planId = positiveInteger(req.params.id);
  const plan = await clinicalRepo.findTreatmentPlan(planId);
  if (!plan) return res.status(404).json({ error: 'Treatment plan not found' });
  const updated = await clinicalRepo.acceptTreatmentPlan(planId, {
    name: cleanText(req.body.signatureName || req.body.signature_name, { max: 160, required: true }),
    data: cleanText(req.body.signatureData || req.body.signature_data, { max: 4000 })
  });
  await auditLog({ userId: req.user.id, action: 'treatment_plan_accepted', entityType: 'treatment_plan', entityId: planId, req });
  res.json(await serializeTreatmentPlan(updated));
});

app.delete('/api/treatment-plans/:id', authenticateToken, requirePermission('clinical:write'), async (req, res) => {
  const planId = positiveInteger(req.params.id);
  if (!(await clinicalRepo.findTreatmentPlan(planId))) return res.status(404).json({ error: 'Treatment plan not found' });
  await clinicalRepo.deleteTreatmentPlan(planId);
  await auditLog({ userId: req.user.id, action: 'treatment_plan_deleted', entityType: 'treatment_plan', entityId: planId, req });
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
    entryType: row.entry_type || 'clinical',
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

function normalizeClinicalEntryType(value) {
  return value === 'initial_condition' ? 'initial_condition' : 'clinical';
}

function clinicalPriceFields(entryType, body, fallback = {}) {
  if (entryType === 'initial_condition') {
    return { price: 0, currency: 'EUR', priceRsd: 0, exchangeRateToRsd: 0 };
  }
  return {
    price: money(body.price ?? fallback.price),
    currency: normalizeCurrency(body.currency || fallback.currency),
    priceRsd: money(body.priceRsd ?? body.price_rsd ?? fallback.price_rsd),
    exchangeRateToRsd: money(body.exchangeRateToRsd ?? body.exchange_rate_to_rsd ?? fallback.exchange_rate_to_rsd)
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

app.get('/api/patients/:id/clinical-chart', authenticateToken, requirePermission('clinical:read'), async (req, res) => {
  const patientId = positiveInteger(req.params.id);
  if (!patientId || !(await patientsRepo.findPatientById(patientId))) return res.status(404).json({ error: 'Patient not found' });
  const rows = await clinicalRepo.clinicalChartByPatient(patientId);
  res.json(rows.map(serializeClinicalChart));
});

app.post('/api/patients/:id/clinical-chart', authenticateToken, requirePermission('clinical:write'), async (req, res) => {
  try {
    const patientId = positiveInteger(req.params.id);
    if (!patientId || !(await patientsRepo.findPatientById(patientId))) return res.status(404).json({ error: 'Patient not found' });
    const row = await clinicalRepo.createClinicalChart(clinicalChartPayloadFromBody(req.body, patientId, req.user.id));
    await auditLog({ userId: req.user.id, action: 'clinical_chart_created', entityType: 'patient', entityId: patientId, req });
    res.status(201).json(serializeClinicalChart(row));
  } catch (error) {
    console.error('Create clinical chart error:', error);
    res.status(500).json({ error: 'Zubni status nije sačuvan.' });
  }
});

app.put('/api/clinical-chart/:id', authenticateToken, requirePermission('clinical:write'), async (req, res) => {
  try {
    const chartId = positiveInteger(req.params.id);
    const existing = await clinicalRepo.findClinicalChart(chartId);
    if (!existing) return res.status(404).json({ error: 'Zubni status entry not found' });
    const row = await clinicalRepo.updateClinicalChart(chartId, clinicalChartPayloadFromBody(req.body, existing.patient_id, req.user.id, existing));
    await auditLog({ userId: req.user.id, action: 'clinical_chart_updated', entityType: 'clinical_chart', entityId: chartId, req });
    res.json(serializeClinicalChart(row));
  } catch (error) {
    console.error('Update clinical chart error:', error);
    res.status(500).json({ error: 'Zubni status nije izmenjen.' });
  }
});

app.delete('/api/clinical-chart/:id', authenticateToken, requirePermission('clinical:write'), async (req, res) => {
  const chartId = positiveInteger(req.params.id);
  if (!(await clinicalRepo.findClinicalChart(chartId))) return res.status(404).json({ error: 'Zubni status entry not found' });
  await clinicalRepo.deleteClinicalChart(chartId);
  await auditLog({ userId: req.user.id, action: 'clinical_chart_deleted', entityType: 'clinical_chart', entityId: chartId, req });
  res.json({ success: true });
});

app.get('/api/clinical-note-templates', authenticateToken, requirePermission('clinical:read'), async (_req, res) => {
  const rows = await clinicalRepo.clinicalNoteTemplates();
  res.json(rows.map(row => ({
    id: row.id,
    title: row.title,
    category: row.category,
    body: row.body
  })));
});

app.post('/api/director/clinical-note-templates', authenticateToken, requireDirector, async (req, res) => {
  try {
    const row = await clinicalRepo.createClinicalNoteTemplate({
      title: cleanText(req.body.title, { max: 160, required: true }),
      category: cleanText(req.body.category || 'Opste', { max: 80, required: true }),
      body: cleanText(req.body.body, { max: 8000, required: true })
    });
    await auditLog({ userId: req.user.id, action: 'clinical_note_template_created', entityType: 'clinical_note_template', entityId: row.id, req });
    res.status(201).json({ id: row.id, title: row.title, category: row.category, body: row.body });
  } catch (error) {
    console.error('Create clinical note template error:', error);
    res.status(500).json({ error: 'Sablon nije sacuvan.' });
  }
});

app.get('/api/patients/:id/clinical-notes', authenticateToken, requirePermission('clinical:read'), async (req, res) => {
  const patientId = positiveInteger(req.params.id);
  if (!patientId || !(await patientsRepo.findPatientById(patientId))) return res.status(404).json({ error: 'Patient not found' });
  const rows = await clinicalRepo.clinicalNotesByPatient(patientId);
  res.json(rows.map(serializeClinicalNote));
});

app.post('/api/patients/:id/clinical-notes', authenticateToken, requirePermission('clinical:write'), async (req, res) => {
  try {
    const patientId = positiveInteger(req.params.id);
    if (!patientId || !(await patientsRepo.findPatientById(patientId))) return res.status(404).json({ error: 'Patient not found' });
    const row = await clinicalRepo.createClinicalNote({
      patientId,
      visitRecordId: positiveInteger(req.body.visitRecordId || req.body.visit_record_id),
      templateId: positiveInteger(req.body.templateId || req.body.template_id),
      title: cleanText(req.body.title, { max: 160, required: true }),
      body: cleanText(req.body.body, { max: 8000, required: true }),
      signedBy: cleanText(req.body.signedBy || req.body.signed_by, { max: 160 }),
      signedAt: req.body.signedBy || req.body.signed_by ? new Date().toISOString() : null,
      createdBy: req.user.id
    });
    await auditLog({ userId: req.user.id, action: 'clinical_note_created', entityType: 'patient', entityId: patientId, req });
    res.status(201).json(serializeClinicalNote(row));
  } catch (error) {
    console.error('Create clinical note error:', error);
    res.status(500).json({ error: 'Klinicka beleska nije sacuvana.' });
  }
});

app.put('/api/clinical-notes/:id', authenticateToken, requirePermission('clinical:write'), async (req, res) => {
  try {
    const noteId = positiveInteger(req.params.id);
    const current = await clinicalRepo.findClinicalNote(noteId);
    if (!current) return res.status(404).json({ error: 'Klinicka beleska nije pronadjena' });
    const row = await clinicalRepo.updateClinicalNote(noteId, {
      visitRecordId: positiveInteger(req.body.visitRecordId || req.body.visit_record_id) || current.visit_record_id,
      templateId: positiveInteger(req.body.templateId || req.body.template_id) || current.template_id,
      title: cleanText(req.body.title ?? current.title, { max: 160, required: true }),
      body: cleanText(req.body.body ?? current.body, { max: 8000, required: true }),
      signedBy: cleanText(req.body.signedBy ?? req.body.signed_by ?? current.signed_by, { max: 160 }),
      signedAt: req.body.signedBy || req.body.signed_by ? (current.signed_at || new Date().toISOString()) : current.signed_at
    });
    await auditLog({ userId: req.user.id, action: 'clinical_note_updated', entityType: 'clinical_note', entityId: noteId, req });
    res.json(serializeClinicalNote(row));
  } catch (error) {
    console.error('Update clinical note error:', error);
    res.status(500).json({ error: 'Klinicka beleska nije sacuvana.' });
  }
});

app.delete('/api/clinical-notes/:id', authenticateToken, requirePermission('clinical:write'), async (req, res) => {
  try {
    const noteId = positiveInteger(req.params.id);
    if (!(await clinicalRepo.findClinicalNote(noteId))) return res.status(404).json({ error: 'Klinicka beleska nije pronadjena' });
    await clinicalRepo.deleteClinicalNote(noteId);
    await auditLog({ userId: req.user.id, action: 'clinical_note_deleted', entityType: 'clinical_note', entityId: noteId, req });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete clinical note error:', error);
    res.status(500).json({ error: 'Klinicka beleska nije obrisana.' });
  }
});

app.post('/api/clinical-notes/:id/sign', authenticateToken, requirePermission('clinical:write'), async (req, res) => {
  try {
    const noteId = positiveInteger(req.params.id);
    const note = await clinicalRepo.findClinicalNote(noteId);
    if (!note) return res.status(404).json({ error: 'Klinicka beleska not found' });
    const row = await clinicalRepo.signClinicalNote(noteId, cleanText(req.body.signedBy || req.body.signed_by || req.user.name, { max: 160, required: true }));
    await auditLog({ userId: req.user.id, action: 'clinical_note_signed', entityType: 'clinical_note', entityId: noteId, req });
    res.json(serializeClinicalNote(row));
  } catch (error) {
    console.error('Sign clinical note error:', error);
    res.status(500).json({ error: 'Klinicka beleska nije potpisana.' });
  }
});

app.get('/api/patients/:id/consents', authenticateToken, requirePermission('clinical:read'), async (req, res) => {
  const patientId = positiveInteger(req.params.id);
  if (!patientId || !(await patientsRepo.findPatientById(patientId))) return res.status(404).json({ error: 'Patient not found' });
  const rows = await clinicalRepo.consentsByPatient(patientId);
  res.json(rows.map(serializeSaglasnost));
});

app.post('/api/patients/:id/consents', authenticateToken, requirePermission('clinical:write'), async (req, res) => {
  try {
    const patientId = positiveInteger(req.params.id);
    if (!patientId || !(await patientsRepo.findPatientById(patientId))) return res.status(404).json({ error: 'Patient not found' });
    const row = await clinicalRepo.createConsent({
      patientId,
      treatmentPlanId: positiveInteger(req.body.treatmentPlanId || req.body.treatment_plan_id),
      consentType: cleanText(req.body.consentType || req.body.consent_type || 'treatment', { max: 80, required: true }),
      title: cleanText(req.body.title, { max: 160, required: true }),
      body: cleanText(req.body.body, { max: 8000, required: true }),
      signerName: cleanText(req.body.signerName || req.body.signer_name, { max: 160, required: true }),
      signatureData: cleanText(req.body.signatureData || req.body.signature_data, { max: 4000, required: true }),
      signedAt: new Date().toISOString(),
      createdBy: req.user.id
    });
    await auditLog({ userId: req.user.id, action: 'consent_signed', entityType: 'patient', entityId: patientId, req });
    res.status(201).json(serializeSaglasnost(row));
  } catch (error) {
    console.error('Create consent error:', error);
    res.status(500).json({ error: 'Saglasnost nije sacuvana.' });
  }
});

app.put('/api/consents/:id', authenticateToken, requirePermission('clinical:write'), async (req, res) => {
  try {
    const consentId = positiveInteger(req.params.id);
    const current = await clinicalRepo.findConsent(consentId);
    if (!current) return res.status(404).json({ error: 'Saglasnost nije pronadjena' });
    const row = await clinicalRepo.updateConsent(consentId, {
      treatmentPlanId: positiveInteger(req.body.treatmentPlanId || req.body.treatment_plan_id) || current.treatment_plan_id,
      consentType: cleanText(req.body.consentType ?? req.body.consent_type ?? current.consent_type, { max: 80, required: true }),
      title: cleanText(req.body.title ?? current.title, { max: 160, required: true }),
      body: cleanText(req.body.body ?? current.body, { max: 8000, required: true }),
      signerName: cleanText(req.body.signerName ?? req.body.signer_name ?? current.signer_name, { max: 160, required: true }),
      signatureData: cleanText(req.body.signatureData ?? req.body.signature_data ?? current.signature_data, { max: 4000, required: true }),
      signedAt: current.signed_at || new Date().toISOString()
    });
    await auditLog({ userId: req.user.id, action: 'consent_updated', entityType: 'consent', entityId: consentId, req });
    res.json(serializeSaglasnost(row));
  } catch (error) {
    console.error('Update consent error:', error);
    res.status(500).json({ error: 'Saglasnost nije sacuvana.' });
  }
});

app.delete('/api/consents/:id', authenticateToken, requirePermission('clinical:write'), async (req, res) => {
  try {
    const consentId = positiveInteger(req.params.id);
    if (!(await clinicalRepo.findConsent(consentId))) return res.status(404).json({ error: 'Saglasnost nije pronadjena' });
    await clinicalRepo.deleteConsent(consentId);
    await auditLog({ userId: req.user.id, action: 'consent_deleted', entityType: 'consent', entityId: consentId, req });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete consent error:', error);
    res.status(500).json({ error: 'Saglasnost nije obrisana.' });
  }
});

async function serializePerioChart(chart) {
  const measurements = await clinicalRepo.perioMeasurements(chart.id);
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

app.get('/api/patients/:id/perio-charts', authenticateToken, requirePermission('clinical:read'), async (req, res) => {
  const charts = await clinicalRepo.perioChartsByPatient(positiveInteger(req.params.id));
  res.json(await Promise.all(charts.map(serializePerioChart)));
});

app.post('/api/patients/:id/perio-charts', authenticateToken, requirePermission('clinical:write'), async (req, res) => {
  try {
    const patientId = positiveInteger(req.params.id);
    const measurements = (req.body.measurements || []).map(item => ({
      toothNumber: cleanText(item.toothNumber || item.tooth_number, { max: 10, required: true }),
      site: cleanText(item.site, { max: 20, required: true }),
      pocketDepth: Math.max(0, Number(item.pocketDepth || item.pocket_depth || 0)),
      bleeding: normalizeBoolean(item.bleeding),
      gingivalMargin: Number(item.gingivalMargin || item.gingival_margin || 0),
      recession: Number(item.recession || 0),
      mobility: Math.max(0, Number(item.mobility || 0)),
      furcation: Math.max(0, Number(item.furcation || 0)),
      notes: cleanText(item.notes, { max: 500 })
    }));
    const chart = await clinicalRepo.createPerioChart({
      patientId,
      chartDate: cleanText(req.body.chartDate || req.body.chart_date || todayIsoDate(), { max: 20, required: true }),
      notes: cleanText(req.body.notes, { max: 2000 }),
      createdBy: req.user.id
    }, measurements);
    res.status(201).json(await serializePerioChart(chart));
  } catch (error) {
    console.error('Create perio chart error:', error);
    res.status(500).json({ error: 'Perio chart nije sacuvan.' });
  }
});

app.delete('/api/perio-charts/:id', authenticateToken, requirePermission('clinical:write'), async (req, res) => {
  const chartId = positiveInteger(req.params.id);
  if (!(await clinicalRepo.findPerioChart(chartId))) return res.status(404).json({ error: 'Perio chart not found' });
  await clinicalRepo.deletePerioChart(chartId);
  await auditLog({ userId: req.user.id, action: 'perio_chart_deleted', entityType: 'perio_chart', entityId: chartId, req });
  res.json({ success: true });
});

async function serializeInvoice(invoice) {
  const items = await billingRepo.invoiceItems(invoice.id);
  const payments = await billingRepo.invoicePayments(invoice.id);
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

function invoiceItemsFromBody(items = []) {
  return items.map(item => ({
    description: cleanText(item.description, { max: 255, required: true }),
    toothNumber: cleanText(item.toothNumber || item.tooth_number, { max: 20 }),
    quantity: Math.max(0.01, Number(item.quantity || 1)),
    unitPrice: money(item.unitPrice || item.unit_price),
    discount: money(item.discount)
  }));
}

app.get('/api/patients/:id/invoices', authenticateToken, requirePermission('billing:read'), async (req, res) => {
  const invoices = await billingRepo.listInvoicesByPatient(positiveInteger(req.params.id));
  res.json(await Promise.all(invoices.map(serializeInvoice)));
});

app.post('/api/patients/:id/invoices', authenticateToken, requirePermission('billing:write'), async (req, res) => {
  try {
    const patientId = positiveInteger(req.params.id);
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (items.length === 0) return res.status(400).json({ error: 'Dodajte bar jednu stavku racuna.' });
    if (!patientId || !(await patientsRepo.findPatientById(patientId))) return res.status(404).json({ error: 'Patient not found' });

    const invoice = await billingRepo.createInvoice({
      invoice: {
        patientId,
        visitRecordId: positiveInteger(req.body.visitRecordId || req.body.visit_record_id),
        invoiceNumber: cleanText(req.body.invoiceNumber || await invoiceNumber(), { max: 80, required: true }),
        issueDate: cleanText(req.body.issueDate || req.body.issue_date || todayIsoDate(), { max: 20, required: true }),
        dueDate: cleanText(req.body.dueDate || req.body.due_date, { max: 20 }),
        currency: normalizeCurrency(req.body.currency),
        discount: money(req.body.discount),
        tax: money(req.body.tax),
        notes: cleanText(req.body.notes, { max: 2000 }),
        createdBy: req.user.id
      },
      items: invoiceItemsFromBody(items),
      ledger: {
        patientId,
        entryType: 'charge',
        description: 'Racun',
        source: 'invoice',
        entryDate: todayIsoDate(),
        userId: req.user.id
      }
    });
    await auditLog({ userId: req.user.id, action: 'invoice_created', entityType: 'invoice', entityId: invoice.id, req });
    res.status(201).json(await serializeInvoice(invoice));
  } catch (error) {
    console.error('Create invoice error:', error);
    res.status(500).json({ error: 'Racun nije sacuvan.' });
  }
});

app.post('/api/invoices/:id/payments', authenticateToken, requirePermission('billing:write'), async (req, res) => {
  try {
    const invoiceId = positiveInteger(req.params.id);
    if (!(await billingRepo.findInvoice(invoiceId))) return res.status(404).json({ error: 'Invoice not found' });
    const paymentType = ['payment', 'advance', 'installment', 'refund'].includes(req.body.paymentType || req.body.payment_type) ? (req.body.paymentType || req.body.payment_type) : 'payment';
    const amount = money(req.body.amount);
    const invoice = await billingRepo.addInvoicePayment({
      invoiceId,
      payment: {
        amount,
        paymentMethod: cleanText(req.body.paymentMethod || req.body.payment_method, { max: 80 }),
        paymentDate: cleanText(req.body.paymentDate || req.body.payment_date || todayIsoDate(), { max: 20, required: true }),
        paymentType,
        notes: cleanText(req.body.notes, { max: 1000 })
      },
      ledger: {
        entryType: paymentType === 'refund' ? 'refund' : 'patient_payment',
        amount: paymentType === 'refund' ? amount : -amount,
        source: 'invoice_payment',
        entryDate: todayIsoDate(),
        userId: req.user.id
      }
    });
    res.status(201).json(await serializeInvoice(invoice));
  } catch (error) {
    console.error('Invoice payment error:', error);
    res.status(500).json({ error: 'Uplata nije sacuvana.' });
  }
});

app.get('/api/invoices/:id/pdf', authenticateToken, requirePermission('billing:read'), async (req, res) => {
  const invoice = await billingRepo.invoiceForPdf(positiveInteger(req.params.id));
  if (!invoice) return res.status(404).send('Invoice not found');
  const data = await serializeInvoice(invoice);
  const rows = data.items.map(item => `<tr><td>${escapeHtml(item.description)}</td><td>${escapeHtml(item.toothNumber || '-')}</td><td>${escapeHtml(item.quantity)}</td><td>${escapeHtml(item.unitPrice.toFixed(2))}</td><td>${escapeHtml(item.discount.toFixed(2))}</td></tr>`).join('');
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(data.invoiceNumber)}</title><style>body{font-family:Arial;padding:32px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px;text-align:left}</style></head><body><h1>Racun ${escapeHtml(data.invoiceNumber)}</h1><p>Pacijent: ${escapeHtml(invoice.first_name)} ${escapeHtml(invoice.last_name)}</p><p>Datum: ${escapeHtml(data.issueDate)}</p><table><thead><tr><th>Stavka</th><th>Zub</th><th>Kolicina</th><th>Cena</th><th>Popust</th></tr></thead><tbody>${rows}</tbody></table><h2>Ukupno: ${escapeHtml(data.total.toFixed(2))} ${escapeHtml(data.currency)}</h2><p>Placeno: ${escapeHtml(data.amountPaid.toFixed(2))} ${escapeHtml(data.currency)}</p><script>window.print()</script></body></html>`);
});

app.delete('/api/invoices/:id', authenticateToken, requirePermission('billing:write'), async (req, res) => {
  try {
    const invoiceId = positiveInteger(req.params.id);
    const invoice = await billingRepo.findInvoice(invoiceId);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    await billingRepo.deleteInvoice({
      invoice,
      ledger: {
        entryDate: todayIsoDate(),
        userId: req.user.id
      }
    });
    await auditLog({ userId: req.user.id, action: 'invoice_deleted', entityType: 'invoice', entityId: invoiceId, req });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete invoice error:', error);
    res.status(500).json({ error: 'Racun nije obrisan.' });
  }
});

async function serializeClaim(row) {
  const attachments = await billingRepo.claimAttachments(row.id);
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

app.get('/api/patients/:id/insurance-claims', authenticateToken, requirePermission('billing:read'), async (req, res) => {
  const rows = await billingRepo.listClaimsByPatient(positiveInteger(req.params.id));
  res.json(await Promise.all(rows.map(serializeClaim)));
});

app.post('/api/patients/:id/insurance-claims', authenticateToken, requirePermission('billing:write'), async (req, res) => {
  try {
    const patientId = positiveInteger(req.params.id);
    if (!patientId || !(await patientsRepo.findPatientById(patientId))) return res.status(404).json({ error: 'Pacijent nije pronadjen.' });
    const provider = cleanText(req.body.provider, { max: 160 });
    const requestedAmount = money(req.body.requestedAmount || req.body.requested_amount);
    if (!provider) return res.status(400).json({ error: 'Unesite naziv osiguranja.' });
    if (requestedAmount <= 0) return res.status(400).json({ error: 'Unesite trazeni iznos veci od 0.' });
    const claim = await billingRepo.createClaim({
      patientId,
      visitRecordId: positiveInteger(req.body.visitRecordId || req.body.visit_record_id),
      invoiceId: positiveInteger(req.body.invoiceId || req.body.invoice_id),
      provider,
      policyNumber: cleanText(req.body.policyNumber || req.body.policy_number, { max: 120 }),
      claimNumber: cleanText(req.body.claimNumber || req.body.claim_number, { max: 120 }),
      status: ['draft', 'eligibility_checked', 'preauth_sent', 'submitted', 'approved', 'partially_approved', 'denied', 'paid'].includes(req.body.status) ? req.body.status : 'draft',
      requestedAmount,
      approvedAmount: money(req.body.approvedAmount || req.body.approved_amount),
      submittedAt: cleanText(req.body.submittedAt || req.body.submitted_at, { max: 40 }),
      decisionAt: cleanText(req.body.decisionAt || req.body.decision_at, { max: 40 }),
      eligibilityNotes: cleanText(req.body.eligibilityNotes || req.body.eligibility_notes, { max: 2000 }),
      preauthorizationNotes: cleanText(req.body.preauthorizationNotes || req.body.preauthorization_notes, { max: 2000 }),
      notes: cleanText(req.body.notes, { max: 2000 }),
      createdBy: req.user.id
    });
    res.status(201).json(await serializeClaim(claim));
  } catch (error) {
    console.error('Create insurance claim error:', error);
    res.status(500).json({ error: 'Zahtev za osiguranje nije sacuvan.' });
  }
});

app.post('/api/insurance-claims/:id/check-eligibility', authenticateToken, requirePermission('billing:write'), async (req, res) => {
  try {
    const claimId = positiveInteger(req.params.id);
    const claim = await billingRepo.findClaim(claimId);
    if (!claim) return res.status(404).json({ error: 'Insurance claim not found' });
    const status = claim.policy_number ? 'active' : 'manual_review';
    const note = status === 'active'
      ? `Eligibility active for ${claim.provider}.`
      : 'Nedostaje broj polise; potrebna rucna provera.';
    const updated = await billingRepo.updateEligibility({
      claimId,
      status,
      note,
      payerControlNumber: `ELG-${claimId}-${Date.now()}`
    });
    await auditLog({ userId: req.user.id, action: 'insurance_eligibility_checked', entityType: 'insurance_claim', entityId: claimId, req });
    res.json(await serializeClaim(updated));
  } catch (error) {
    console.error('Eligibility check error:', error);
    res.status(500).json({ error: 'Eligibility provera nije uspela.' });
  }
});

app.post('/api/insurance-claims/:id/attachments', authenticateToken, requirePermission('billing:write'), async (req, res) => {
  try {
    const claimId = positiveInteger(req.params.id);
    const documentId = positiveInteger(req.body.documentId || req.body.document_id);
    const claim = await billingRepo.findClaim(claimId);
    if (!claim) return res.status(404).json({ error: 'Insurance claim not found' });
    const document = await billingRepo.findClaimDocument({ documentId, patientId: claim.patient_id });
    if (!document) return res.status(404).json({ error: 'Document not found for this patient' });
    const id = await billingRepo.addClaimAttachment({
      claimId,
      documentId,
      attachmentType: cleanText(req.body.attachmentType || req.body.attachment_type || 'supporting_document', { max: 80, required: true }),
      clearinghouseRef: cleanText(req.body.clearinghouseRef || req.body.clearinghouse_ref, { max: 120 }),
      notes: cleanText(req.body.notes, { max: 1000 }),
      createdBy: req.user.id
    });
    await auditLog({ userId: req.user.id, action: 'insurance_claim_attachment_added', entityType: 'insurance_claim', entityId: claimId, req });
    res.status(201).json({
      id,
      claim: await serializeClaim(await billingRepo.findClaim(claimId))
    });
  } catch (error) {
    console.error('Claim attachment error:', error);
    res.status(500).json({ error: 'Attachment nije dodat na claim.' });
  }
});

app.post('/api/insurance-claims/:id/submit', authenticateToken, requirePermission('billing:write'), async (req, res) => {
  try {
    const claimId = positiveInteger(req.params.id);
    const claim = await billingRepo.findClaim(claimId);
    if (!claim) return res.status(404).json({ error: 'Insurance claim not found' });
    const attachmentCount = await billingRepo.attachmentCount(claimId);
    const clearinghouseRef = cleanText(req.body.clearinghouseRef || req.body.clearinghouse_ref, { max: 120 }) || `CH-${claimId}-${Date.now()}`;
    const updated = await billingRepo.submitClaim({
      claimId,
      submittedAt: new Date().toISOString(),
      clearinghouseRef,
      notes: cleanText(req.body.notes || `Poslato sa ${attachmentCount} priloga.`, { max: 2000 })
    });
    await auditLog({ userId: req.user.id, action: 'insurance_claim_submitted', entityType: 'insurance_claim', entityId: claimId, req });
    res.json(await serializeClaim(updated));
  } catch (error) {
    console.error('Submit claim error:', error);
    res.status(500).json({ error: 'Claim nije poslat.' });
  }
});

app.post('/api/insurance-claims/:id/era', authenticateToken, requirePermission('billing:write'), async (req, res) => {
  try {
    const claimId = positiveInteger(req.params.id);
    const claim = await billingRepo.findClaim(claimId);
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
    const updated = await billingRepo.postEra({
      claim,
      era: {
        status,
        approvedAmount,
        paidAmount,
        decisionAt: new Date().toISOString(),
        denialReason,
        eobJson: JSON.stringify(eob)
      },
      ledger: {
        patientId: claim.patient_id,
        invoiceId: claim.invoice_id,
        claimId,
        entryType: 'insurance_payment',
        amount: -paidAmount,
        currency: 'EUR',
        description: `ERA uplata ${claim.provider}`,
        source: 'era',
        entryDate: todayIsoDate(),
        userId: req.user.id
      }
    });
    await auditLog({ userId: req.user.id, action: 'insurance_era_posted', entityType: 'insurance_claim', entityId: claimId, req });
    res.json(await serializeClaim(updated));
  } catch (error) {
    console.error('ERA posting error:', error);
    res.status(500).json({ error: 'ERA/EOB nije proknjizen.' });
  }
});

app.get('/api/patients/:id/ledger', authenticateToken, requirePermission('billing:read'), async (req, res) => {
  try {
    const patientId = positiveInteger(req.params.id);
    if (!patientId || !(await patientsRepo.findPatientById(patientId))) return res.status(404).json({ error: 'Patient not found' });
    const rows = await billingRepo.ledgerEntriesByPatient(patientId);
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
    res.status(500).json({ error: 'Ledger nije ucitan.' });
  }
});

app.delete('/api/insurance-claims/:id', authenticateToken, requirePermission('billing:write'), async (req, res) => {
  const claimId = positiveInteger(req.params.id);
  if (!(await billingRepo.findClaim(claimId))) return res.status(404).json({ error: 'Insurance claim not found' });
  await billingRepo.deleteClaim(claimId);
  await auditLog({ userId: req.user.id, action: 'insurance_claim_deleted', entityType: 'insurance_claim', entityId: claimId, req });
  res.json({ success: true });
});

// ============ BACKUP AND SECURITY ENDPOINTS ============

app.get('/api/director/backups/status', authenticateToken, requireDirector, async (_req, res) => {
  try {
    res.json(await backupStatus());
  } catch (error) {
    console.error('Backup status error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/director/backups', authenticateToken, requireDirector, async (_req, res) => {
  res.json([]);
});

app.post('/api/director/backups', authenticateToken, requireDirector, async (req, res) => {
  try {
    res.status(201).json(await requestPostgresBackup({ type: 'manual', userId: req.user.id, req }));
  } catch (error) {
    console.error('Create backup error:', error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Rezervna kopija nije mogla da se napravi.' });
  }
});

app.get('/api/director/backups/:id/download', authenticateToken, requireDirector, async (req, res) => {
  try {
    await auditLog({ userId: req.user.id, action: 'postgres_backup_download_requested', entityType: 'backup', entityId: positiveInteger(req.params.id), req, metadata: { strategy: 'supabase-managed' } });
    res.status(501).json({ error: postgresBackupUnavailable().message });
  } catch (error) {
    console.error('Download backup error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/director/backups/:id/restore', authenticateToken, requireDirector, async (req, res) => {
  try {
    await requestPostgresRestore({ id: positiveInteger(req.params.id) }, req.user.id, req);
  } catch (error) {
    console.error('Restore backup error:', error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Vracanje nije uspelo.' });
  }
});

app.post('/api/director/backups/:id/test-restore', authenticateToken, requireDirector, async (req, res) => {
  try {
    await requestPostgresRestoreTest({ id: positiveInteger(req.params.id) }, req.user.id, req);
  } catch (error) {
    console.error('Test restore backup error:', error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Test vracanja nije uspeo.' });
  }
});

app.get('/api/director/security/audit-log', authenticateToken, requireDirector, async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100)));
    const rows = await authSessions.listAuditEntries({
      action: req.query.action ? cleanText(req.query.action, { max: 120 }) : null,
      userId: req.query.user_id ? positiveInteger(req.query.user_id) : null,
      limit
    });
    res.json(rows.map(serializeRevizijaEntry));
  } catch (error) {
    console.error('Revizija log list error:', error);
    res.status(500).json({ error: 'Revizija log nije učitan.' });
  }
});

app.get('/api/director/security/sessions', authenticateToken, requireDirector, async (_req, res) => {
  try {
    const sessions = await authSessions.listActiveSessions(100);
    res.json(sessions.map(serializeSession));
  } catch (error) {
    console.error('Security sessions error:', error);
    res.status(500).json({ error: 'Sesije nisu učitane.' });
  }
});

app.delete('/api/director/security/sessions/:id', authenticateToken, requireDirector, async (req, res) => {
  try {
    const sessionId = positiveInteger(req.params.id);
    const session = await authSessions.findRefreshTokenById(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    await authSessions.revokeRefreshTokenById(sessionId);
    await auditLog({ userId: req.user.id, action: 'session_revoked', entityType: 'refresh_token', entityId: sessionId, req, metadata: { userId: session.user_id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Revoke session error:', error);
    res.status(500).json({ error: 'Sesija nije opozvana.' });
  }
});

app.put('/api/director/security/users/:id/permissions', authenticateToken, requireDirector, async (req, res) => {
  try {
    const userId = positiveInteger(req.params.id);
    const user = await authSessions.findUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const permissions = Array.isArray(req.body.permissions)
      ? req.body.permissions.map(item => cleanText(item, { max: 80 })).filter(Boolean)
      : DEFAULT_PERMISSIONS[user.role] || [];
    const invalid = invalidPermissions(permissions);
    if (invalid.length) {
      return res.status(400).json({ error: `Invalid permissions: ${invalid.join(', ')}` });
    }
    await authSessions.updateUserPermissions({ userId, permissionsJson: JSON.stringify([...new Set(permissions)]) });
    await auditLog({ userId: req.user.id, action: 'permissions_updated', entityType: 'user', entityId: userId, req, metadata: { permissions } });
    res.json(serializeUserSecurity(await authSessions.findUserById(userId)));
  } catch (error) {
    console.error('Update permissions error:', error);
    res.status(500).json({ error: 'Dozvole nisu sačuvane.' });
  }
});

app.get('/api/director/legal-export', authenticateToken, requireDirector, async (req, res) => {
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
    const countEntries = await Promise.all(
      Object.entries(tables).map(async ([key, table]) => [key, await legalExportCount(table)])
    );
    const counts = Object.fromEntries(countEntries);
    const [
      patients,
      records,
      documents,
      invoices,
      insuranceClaims,
      clinicalChart,
      clinicalNotes,
      consents
    ] = await Promise.all([
      legalExportRows(tables.patients, limit),
      legalExportRows(tables.records, limit),
      legalExportRows(tables.documents, limit),
      legalExportRows(tables.invoices, limit),
      legalExportRows(tables.insuranceClaims, limit),
      legalExportRows(tables.clinicalChart, limit),
      legalExportRows(tables.clinicalNotes, limit),
      legalExportRows(tables.consents, limit)
    ]);
    await auditLog({ userId: req.user.id, action: 'legal_export_generated', entityType: 'legal_export', req, metadata: { limit } });
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
        backups: 'Supabase PostgreSQL backup, periodicna provera restore postupka i ogranicen direktor pristup.'
      },
      patients,
      records,
      documents,
      invoices,
      insuranceClaims,
      clinicalChart: clinicalChart.map(row => ({ ...row, surfaces: safeJsonParse(row.surfaces, []) })),
      clinicalNotes,
      consents
    });
  } catch (error) {
    console.error('Pravno export error:', error);
    res.status(500).json({ error: 'Pravno export nije napravljen.' });
  }
});

app.get('/api/director/security/status', authenticateToken, requireDirector, async (_req, res) => {
  try {
    const users = await authSessions.listSecurityUsers();
    const audit = await authSessions.listAuditEntries({ limit: 30 });
    const sessions = await authSessions.listActiveSessions(25);
    const restoreTests = await directorReports.restoreTests(20);
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

app.post('/api/director/security/users/:id/unlock', authenticateToken, requireDirector, async (req, res) => {
  try {
    const userId = positiveInteger(req.params.id);
    if (!(await authSessions.findUserById(userId))) return res.status(404).json({ error: 'User not found' });
    await clearFailedLogins(userId);
    await auditLog({ userId: req.user.id, action: 'account_unlocked', entityType: 'user', entityId: userId, req });
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
    if (!(await authSessions.findUserById(userId))) return res.status(404).json({ error: 'User not found' });
    if (!isStrongInitialPassword(newPassword)) {
      return res.status(400).json({ error: 'Password must have at least 12 characters.' });
    }
    const newHash = await bcryptHash(newPassword, 12);
    await authSessions.resetUserPassword({ userId, passwordHash: newHash });
    await authSessions.revokeRefreshTokensByUserId(userId);
    await auditLog({ userId: req.user.id, action: 'password_reset_by_director', entityType: 'user', entityId: userId, req });
    res.json({ success: true });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/2fa/setup', authenticateToken, requireDirector, async (req, res) => {
  try {
    const user = await authSessions.findUserById(req.user.id);
    const secret = user.two_factor_secret || randomBase32();
    await authSessions.setTwoFactorSecret({ userId: req.user.id, secret });
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

app.post('/api/auth/2fa/verify', authenticateToken, requireDirector, async (req, res) => {
  try {
    const code = cleanText(req.body.code, { max: 16 });
    const user = await authSessions.findUserById(req.user.id);
    if (!user?.two_factor_secret || !verifyTotp(user.two_factor_secret, code)) {
      return res.status(400).json({ error: 'Invalid two-factor code' });
    }
    await authSessions.enableTwoFactor(req.user.id);
    await auditLog({ userId: req.user.id, action: 'two_factor_enabled', entityType: 'user', entityId: req.user.id, req });
    res.json({ success: true });
  } catch (error) {
    console.error('2FA verify error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/2fa/disable', authenticateToken, requireDirector, async (req, res) => {
  try {
    const password = String(req.body.password || '');
    const user = await authSessions.findUserById(req.user.id);
    if (!user || !(await bcryptCompare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Password is not correct' });
    }
    await authSessions.disableTwoFactor(req.user.id);
    await auditLog({ userId: req.user.id, action: 'two_factor_disabled', entityType: 'user', entityId: req.user.id, req });
    res.json({ success: true });
  } catch (error) {
    console.error('2FA disable error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/director/calendar-sync', authenticateToken, requireDirector, async (_req, res) => {
  try {
    const rows = await calendarRepo.calendarSyncRows(50);
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
    await auditLog({ userId: req.user.id, action: 'google_calendar_pulled', entityType: 'google_calendar', entityId: 1, req, metadata: stats });
    res.json(stats);
  } catch (error) {
    console.error('Pull Google Calendar changes error:', error);
    res.status(500).json({ error: error.message || 'Google Calendar pull failed' });
  }
});

app.get('/api/director/public-booking/settings', authenticateToken, requireDirector, async (_req, res) => {
  try {
    const setting = await runtimeSettings.appSetting('public_booking_enabled');
    res.json({
      enabled: await isPublicBookingEnabled(),
      updatedAt: setting?.updated_at || null
    });
  } catch (error) {
    console.error('Get public booking settings error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/director/public-booking/settings', authenticateToken, requireDirector, async (req, res) => {
  try {
    const enabled = req.body.enabled === true || req.body.enabled === 1 || req.body.enabled === '1';
    const setting = await setAppSetting('public_booking_enabled', enabled ? '1' : '0');
    res.json({
      enabled,
      updatedAt: setting?.updated_at || null
    });
  } catch (error) {
    console.error('Update public booking settings error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/director/google-calendar/settings', authenticateToken, requireDirector, async (_req, res) => {
  try {
    const settings = await calendarRepo.googleSettings();
    const pending = await calendarRepo.pendingSyncCount();
    res.json({
      ...publicGoogleSettings(settings),
      pendingSyncItems: Number(pending)
    });
  } catch (error) {
    console.error('Get Google Calendar settings error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/director/google-calendar/settings', authenticateToken, requireDirector, async (req, res) => {
  try {
    const current = await calendarRepo.googleSettings();
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

    await calendarRepo.updateGoogleSettings({
      connectedEmail,
      calendarId,
      calendarName,
      clientId,
      clientSecret,
      redirectUri,
      syncEnabled,
      syncDirection,
      defaultReminderMinutes,
      resetGooglePullToken
    });
    res.json(publicGoogleSettings(await calendarRepo.googleSettings()));
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

    const settings = await calendarRepo.googleSettings();
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
    await calendarRepo.storeGoogleOAuthTokens({ accessToken: data.access_token, refreshToken: data.refresh_token || null, expiresAt });
    await auditLog({ userId: req.user.id, action: 'google_calendar_oauth_connected', entityType: 'google_calendar', entityId: 1, req });
    res.json({ success: true, expiresAt });
  } catch (error) {
    console.error('Google OAuth exchange error:', error);
    res.status(500).json({ error: 'Google OAuth exchange failed' });
  }
});

app.post('/api/director/google-calendar/test-sync', authenticateToken, requireDirector, async (_req, res) => {
  try {
    const processed = await processCalendarSyncRed({ limit: 25 });
    const settings = await calendarRepo.googleSettings();
    res.json({ processed, lastSyncAt: settings.last_sync_at });
  } catch (error) {
    console.error('Google Calendar test sync error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ DIRECTOR REPORTS ENDPOINTS ============

app.get('/api/director/reports/financial', authenticateToken, requireDirector, async (_req, res) => {
  try {
    const data = await directorReports.financialReport();
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

app.get('/api/director/reports/patients', authenticateToken, requireDirector, async (_req, res) => {
  try {
    const data = await directorReports.patientsReport();
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

app.get('/api/director/reports/doctors', authenticateToken, requireDirector, async (_req, res) => {
  try {
    const { totalVisits, rows } = await directorReports.doctorsReport();
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

app.get('/api/director/reports/procedures', authenticateToken, requireDirector, async (_req, res) => {
  try {
    const { totalVisits, rows } = await directorReports.proceduresReport();
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

app.get('/api/doctors', authenticateToken, requirePermission('calendar:read'), async (_req, res) => {
  try {
    const doctors = await directorReports.doctors();
    res.json(doctors);
  } catch (error) {
    console.error('Get doctors error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ DIRECTOR ADMIN CODEBOOKS ============

const CODEBOOK_TYPES = new Set(['activity', 'procedure', 'visit_status', 'payment_status', 'currency', 'shift', 'payment_method', 'cash_report_item']);

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

function clinicalChartPayloadFromBody(body, patientId, createdBy, fallback = {}) {
  const surfaces = Array.isArray(body.surfaces)
    ? body.surfaces.map(surface => cleanText(surface, { max: 20 })).filter(Boolean)
    : safeJsonParse(fallback.surfaces, []);
  const status = ['planned', 'in_progress', 'completed', 'watch', 'referred'].includes(body.status) ? body.status : fallback.status || 'planned';
  const entryType = normalizeClinicalEntryType(body.entryType || body.entry_type || fallback.entry_type);
  const priceFields = clinicalPriceFields(entryType, body, fallback);
  return {
    patientId,
    visitRecordId: positiveInteger(body.visitRecordId || body.visit_record_id || fallback.visit_record_id),
    toothNumber: cleanText(body.toothNumber || body.tooth_number || fallback.tooth_number, { max: 20, required: true }),
    surfacesJson: JSON.stringify(surfaces),
    cdtCode: cleanText(body.cdtCode || body.cdt_code || fallback.cdt_code, { max: 40 }),
    adaCode: cleanText(body.adaCode || body.ada_code || fallback.ada_code, { max: 40 }),
    diagnosis: cleanText(body.diagnosis ?? fallback.diagnosis, { max: 1000 }),
    procedureCode: cleanText(body.procedureCode || body.procedure_code || fallback.procedure_code, { max: 80 }),
    entryType,
    status,
    phase: Math.max(1, Number(body.phase || fallback.phase || 1)),
    price: priceFields.price,
    currency: priceFields.currency,
    priceRsd: priceFields.priceRsd,
    exchangeRateToRsd: priceFields.exchangeRateToRsd,
    providerId: positiveInteger(body.providerId || body.provider_id || fallback.provider_id),
    notes: cleanText(body.notes ?? fallback.notes, { max: 2000 }),
    createdBy
  };
}

function isUniqueConstraintError(error) {
  return error?.code === '23505';
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
  if (type === 'payment_method') {
    return {
      countsAsRevenue: input.countsAsRevenue !== false,
      countsInCashRegister: input.countsInCashRegister === true,
      cashFlow: ['inflow', 'outflow', 'neutral'].includes(input.cashFlow) ? input.cashFlow : 'inflow'
    };
  }
  if (type === 'cash_report_item') {
    return {
      lineType: ['inflow', 'outflow', 'info'].includes(input.lineType) ? input.lineType : 'outflow'
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

    const localFallback = await localExchangeRate(base, currency);
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
      const fallback = localFallback || await localExchangeRate(base, currency);
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
    const fallback = await localExchangeRate(
      cleanText(req.query.base || 'EUR', { max: 10, required: true }).toUpperCase(),
      cleanText(req.query.currency, { max: 10, required: true }).toUpperCase()
    );
    if (fallback) return res.json(fallback);
    res.status(502).json({ error: 'Exchange rate provider unavailable' });
  }
});

async function localExchangeRate(base, currency) {
  if (!currency) return null;
  if (currency === base) {
    return { base, currency, rate: 1, date: new Date().toISOString().slice(0, 10), source: 'local' };
  }
  const row = await directorAdmin.activeCurrencyMetadata(currency);
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

app.get('/api/codebooks', authenticateToken, async (req, res) => {
  try {
    const type = req.query.type ? normalizeCodebookType(req.query.type) : null;
    if (req.query.type && !type) return res.status(400).json({ error: 'Invalid codebook type' });

    const rows = await directorAdmin.listCodebooks({ type, activeOnly: true });
    res.json(rows.map(serializeCodebookItem));
  } catch (error) {
    console.error('Get public codebooks error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/director/codebooks', authenticateToken, requireDirector, async (req, res) => {
  try {
    const type = req.query.type ? normalizeCodebookType(req.query.type) : null;
    if (req.query.type && !type) return res.status(400).json({ error: 'Invalid codebook type' });

    const rows = await directorAdmin.listCodebooks({ type, activeOnly: false });
    res.json(rows.map(serializeCodebookItem));
  } catch (error) {
    console.error('Get codebooks error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/director/codebooks', authenticateToken, requireDirector, async (req, res) => {
  try {
    const type = normalizeCodebookType(req.body.type);
    const value = cleanText(req.body.value, { max: 120, required: true });
    const label = cleanText(req.body.label || req.body.value, { max: 120, required: true });
    const groupName = cleanText(req.body.groupName || req.body.group_name, { max: 120 });
    const metadata = normalizeCodebookMetadata(type, req.body.metadata);
    const price = Math.max(0, Number(req.body.price || 0));
    const sortOrder = Number.isInteger(Number(req.body.sortOrder)) ? Number(req.body.sortOrder) : 0;

    if (!type || !value || !label) return res.status(400).json({ error: 'Type, value and label are required' });

    const row = await directorAdmin.createCodebookItem({
      type,
      value,
      label,
      groupName,
      metadataJson: JSON.stringify(metadata),
      price,
      isActive: req.body.isActive === false ? 0 : 1,
      sortOrder
    });

    res.status(201).json(serializeCodebookItem(row));
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return res.status(409).json({ error: 'Sifra vec postoji u ovom sifarniku.' });
    }
    console.error('Create codebook error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/director/codebooks/:id', authenticateToken, requireDirector, async (req, res) => {
  try {
    const id = positiveInteger(req.params.id);
    const current = await directorAdmin.findCodebookItem(id);
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

    const row = await directorAdmin.updateCodebookItem(id, {
      type,
      value,
      label,
      groupName,
      metadataJson: JSON.stringify(metadata),
      price,
      isActive,
      sortOrder
    });

    res.json(serializeCodebookItem(row));
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return res.status(409).json({ error: 'Sifra vec postoji u ovom sifarniku.' });
    }
    console.error('Update codebook error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/director/codebooks/:id', authenticateToken, requireDirector, async (req, res) => {
  try {
    const id = positiveInteger(req.params.id);
    const current = await directorAdmin.findCodebookItem(id);
    if (!current) return res.status(404).json({ error: 'Codebook item not found' });

    const usage = current.type === 'procedure'
      ? await directorAdmin.procedureUsage(current.value)
      : 0;
    if (usage > 0) {
      return res.status(409).json({ error: 'Sifra se koristi u zapisima i ne moze biti obrisana. Deaktivirajte je umesto brisanja.' });
    }

    await directorAdmin.deleteCodebookItem(id);
    res.json({ id, message: 'Codebook item deleted successfully' });
  } catch (error) {
    console.error('Delete codebook error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ DIRECTOR DAILY CASH REPORT ============

function normalizeReportDate(value) {
  const text = cleanText(value || todayIsoDate(), { max: 20, required: true });
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : todayIsoDate();
}

async function reportCurrencies() {
  const rows = await directorAdmin.activeCurrencyValues();
  const values = rows.map(row => normalizeCurrency(row.value)).filter(Boolean);
  return Array.from(new Set([...values, 'EUR', 'RSD']));
}

function zeroCurrencyMap(currencies) {
  return currencies.reduce((acc, currency) => {
    acc[currency] = 0;
    return acc;
  }, {});
}

function currencyTotals(rows, currencies) {
  const totals = zeroCurrencyMap(currencies);
  rows.forEach(row => {
    const currency = normalizeCurrency(row.currency);
    totals[currency] = roundMoney((totals[currency] || 0) + Number(row.amount || 0));
  });
  return totals;
}

async function paymentMethodCashMap() {
  const rows = await directorAdmin.activePaymentMethods();
  const map = new Map();
  rows.forEach(row => {
    const metadata = safeJsonParse(row.metadata, {});
    map.set(row.value, {
      countsAsRevenue: metadata.countsAsRevenue !== false,
      countsInCashRegister: metadata.countsInCashRegister === true
    });
  });
  if (!map.size) {
    map.set('Gotovina', { countsAsRevenue: true, countsInCashRegister: true });
  }
  return map;
}

async function cashReportItems() {
  return (await directorAdmin.activeCashReportItems()).map(serializeCodebookItem);
}

function ensureDailyCashReport({ reportDate, shift, userId }) {
  return directorAdmin.ensureDailyCashReport({ reportDate, shift, userId });
}

function loadDailyCashReportLines(reportId) {
  return directorAdmin.dailyCashReportLines(reportId);
}

async function buildManualLineRows({ report, currencies }) {
  const items = await cashReportItems();
  const existing = await loadDailyCashReportLines(report.id);
  const byKey = new Map(existing.map(row => [`${row.item_value}|||${row.currency}`, row]));
  return items.map(item => {
    const metadata = item.metadata || {};
    const lineType = ['inflow', 'outflow', 'info'].includes(metadata.lineType) ? metadata.lineType : 'outflow';
    const amounts = zeroCurrencyMap(currencies);
    const notes = {};
    currencies.forEach(currency => {
      const row = byKey.get(`${item.value}|||${currency}`);
      if (row) {
        amounts[currency] = Number(row.amount || 0);
        if (row.notes) notes[currency] = row.notes;
      }
    });
    return {
      itemValue: item.value,
      itemLabel: item.label,
      lineType,
      amounts,
      notes
    };
  });
}

function dailyCashAutoRows({ reportDate, shift }) {
  return directorAdmin.dailyCashAutoRows({ reportDate, shift });
}

async function buildDailyCashReport({ reportDate, shift, userId }) {
  const currencies = await reportCurrencies();
  const report = await ensureDailyCashReport({ reportDate, shift, userId });
  const methods = await paymentMethodCashMap();
  const paymentRows = await dailyCashAutoRows({ reportDate, shift });
  const cashRows = paymentRows.filter(row => methods.get(row.payment_method)?.countsInCashRegister === true);
  const revenueRows = paymentRows.filter(row => methods.get(row.payment_method)?.countsAsRevenue !== false);
  const manualLines = await buildManualLineRows({ report, currencies });
  const manualOutflow = zeroCurrencyMap(currencies);
  const manualInflow = zeroCurrencyMap(currencies);

  manualLines.forEach(line => {
    Object.entries(line.amounts).forEach(([currency, amount]) => {
      if (line.lineType === 'outflow') manualOutflow[currency] = roundMoney((manualOutflow[currency] || 0) + Number(amount || 0));
      if (line.lineType === 'inflow') manualInflow[currency] = roundMoney((manualInflow[currency] || 0) + Number(amount || 0));
    });
  });

  const cashIn = currencyTotals(cashRows, currencies);
  const totalRevenue = currencyTotals(revenueRows, currencies);
  const remaining = zeroCurrencyMap(currencies);
  currencies.forEach(currency => {
    remaining[currency] = roundMoney((cashIn[currency] || 0) + (manualInflow[currency] || 0) - (manualOutflow[currency] || 0));
  });

  const debts = (await directorAdmin.dailyCashDebts({ reportDate, shift })).map(row => ({
    patient: row.patient,
    procedure: row.procedure,
    shift: row.shift,
    amount: Number(row.amount || 0),
    currency: row.currency || 'EUR'
  }));

  return {
    id: report.id,
    reportDate: report.report_date,
    shift: report.shift,
    status: report.status,
    notes: report.notes || '',
    currencies,
    totals: {
      cashIn,
      totalRevenue,
      manualInflow,
      manualOutflow,
      remaining
    },
    manualLines,
    debts
  };
}

app.get('/api/director/daily-cash-report', authenticateToken, requireDirector, async (req, res) => {
  try {
    const reportDate = normalizeReportDate(req.query.date);
    const shift = cleanText(req.query.shift, { max: 80 }) || '';
    res.json(await buildDailyCashReport({ reportDate, shift, userId: req.user.id }));
  } catch (error) {
    console.error('Daily cash report error:', error);
    res.status(500).json({ error: 'Dnevna kasa nije ucitana.' });
  }
});

app.put('/api/director/daily-cash-report', authenticateToken, requireDirector, async (req, res) => {
  try {
    const reportDate = normalizeReportDate(req.body.date || req.body.reportDate);
    const shift = cleanText(req.body.shift, { max: 80 }) || '';
    const report = await ensureDailyCashReport({ reportDate, shift, userId: req.user.id });
    if (report.status === 'locked') {
      return res.status(409).json({ error: 'Dnevna kasa je zakljucana.' });
    }

    const currencies = await reportCurrencies();
    const allowedItems = new Map((await cashReportItems()).map(item => [item.value, item]));
    const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
    const rowsToSave = [];

    lines.forEach(line => {
      const itemValue = cleanText(line.itemValue || line.item_value, { max: 120, required: true });
      const item = allowedItems.get(itemValue);
      if (!item) return;
      const metadata = item.metadata || {};
      const lineType = ['inflow', 'outflow', 'info'].includes(metadata.lineType) ? metadata.lineType : 'outflow';
      const amounts = line.amounts && typeof line.amounts === 'object' ? line.amounts : {};
      currencies.forEach(currency => {
        rowsToSave.push({
          itemValue: item.value,
          itemLabel: item.label,
          lineType,
          currency,
          amount: roundMoney(money(amounts[currency])),
          notes: cleanText(line.notes?.[currency] || line.notes || '', { max: 1000 })
        });
      });
    });

    await directorAdmin.saveDailyCashReport({
      reportId: report.id,
      lines: rowsToSave,
      notes: cleanText(req.body.notes, { max: 2000 }),
      userId: req.user.id
    });

    res.json(await buildDailyCashReport({ reportDate, shift, userId: req.user.id }));
  } catch (error) {
    console.error('Save daily cash report error:', error);
    res.status(500).json({ error: 'Dnevna kasa nije sacuvana.' });
  }
});

// ============ HEALTH CHECK ============

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'API is running',
    database: DB_CLIENT,
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

async function startServer() {
  try {
    await ensureRuntimeReady();

    server = app.listen(PORT, () => {
      console.log(`Dr Rosa Backend API running on http://localhost:${PORT}`);
      console.log(`${DB_CLIENT} database configured`);
    });

    return server;
  } catch (error) {
    console.error('Startup error:', error);
    try {
      closePostgresPool();
    } catch {
      // Ignore close errors during failed startup.
    }
    process.exit(1);
  }
}

function shutdown() {
  if (!server) {
    closePostgresPool();
    return;
  }
  const forceExit = setTimeout(() => {
    try {
      closePostgresPool();
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
      closePostgresPool();
    } catch {
      // Ignore close errors during shutdown.
    }
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (require.main === module) {
  startServer();
}

module.exports = { app, ensureRuntimeReady, get server() { return server; }, startServer };
