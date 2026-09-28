require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { seedDatabase, closePostgresPool } = require('../server');

async function main() {
  try {
    await seedDatabase();
    console.log('Runtime seed completed successfully.');
  } finally {
    closePostgresPool();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
