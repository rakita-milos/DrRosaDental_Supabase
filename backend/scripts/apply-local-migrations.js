require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { createPool } = require('../db/postgres');
const { assertIsolatedMigrationDatabase } = require('./local-migration-safety');

const migrationsDir = path.join(__dirname, '..', '..', 'supabase', 'migrations');

async function main() {
  assertIsolatedMigrationDatabase({
    databaseUrl: process.env.DATABASE_URL,
    allowLocalMigrations: process.argv.includes('--allow-local')
  });
  const pool = createPool();
  try {
    const files = (await fs.promises.readdir(migrationsDir)).filter(name => name.endsWith('.sql')).sort();
    await pool.query('CREATE SCHEMA IF NOT EXISTS app');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app.schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    for (const file of files) {
      const alreadyApplied = await pool.query('SELECT 1 FROM app.schema_migrations WHERE filename = $1', [file]);
      if (alreadyApplied.rowCount) {
        console.log(`Skipped ${file} (already applied)`);
        continue;
      }
      const sql = await fs.promises.readFile(path.join(migrationsDir, file), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO app.schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      console.log(`Applied ${file}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
