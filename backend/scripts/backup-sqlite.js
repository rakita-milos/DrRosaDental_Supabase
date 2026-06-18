require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.resolve(__dirname, '..', process.env.SQLITE_DB_PATH || './data/drosa.sqlite');
const backupDir = path.resolve(__dirname, '..', process.env.BACKUP_DIR || process.env.SQLITE_BACKUP_DIR || './backups');
const backupKeySource = process.env.BACKUP_ENCRYPTION_KEY || process.env.JWT_SECRET;

if (!fs.existsSync(dbPath)) {
  console.error(`SQLite database not found: ${dbPath}`);
  process.exit(1);
}

if (!backupKeySource || backupKeySource.length < 32) {
  console.error('Set BACKUP_ENCRYPTION_KEY or JWT_SECRET to at least 32 characters before creating backups.');
  process.exit(1);
}

fs.mkdirSync(backupDir, { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
db.close();

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupDir, `drosa-manual-backup-${timestamp}.sqlite.enc`);

function backupKey() {
  return crypto.createHash('sha256').update(backupKeySource).digest();
}

function encryptBuffer(buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', backupKey(), iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from('DRROSAENC1'), iv, tag, encrypted]);
}

fs.writeFileSync(backupPath, encryptBuffer(fs.readFileSync(dbPath)), { mode: 0o600 });
console.log(`Encrypted backup created: ${backupPath}`);
