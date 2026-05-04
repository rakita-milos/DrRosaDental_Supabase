require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.resolve(__dirname, '..', process.env.SQLITE_DB_PATH || './data/drosa.sqlite');
const backupDir = path.resolve(__dirname, '..', process.env.SQLITE_BACKUP_DIR || './backups');

if (!fs.existsSync(dbPath)) {
  console.error(`SQLite database not found: ${dbPath}`);
  process.exit(1);
}

fs.mkdirSync(backupDir, { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
db.close();

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupDir, `drosa-${timestamp}.sqlite`);

fs.copyFileSync(dbPath, backupPath);
console.log(`Backup created: ${backupPath}`);
