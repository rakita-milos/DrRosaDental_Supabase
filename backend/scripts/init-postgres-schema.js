require('dotenv').config();

const { createPool, initializePostgresSchema } = require('../db/postgres');

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('Set DATABASE_URL to the Supabase PostgreSQL connection string before running this command.');
  }

  const pool = createPool();

  try {
    await initializePostgresSchema(pool);
    console.log('PostgreSQL schema initialized successfully.');
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
