require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { createPool, initializePostgresSchema } = require('../db/postgres');

const marker = 'DEMO-SEED-2026-05';

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('Set DATABASE_URL to the Supabase PostgreSQL connection string before running this command.');
  }

  const pool = createPool();

  try {
    await initializePostgresSchema(pool);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await seedDemoData(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

async function seedDemoData(client) {
  const doctors = (await client.query('SELECT id, name FROM doctors ORDER BY id')).rows;
  if (doctors.length === 0) {
    throw new Error('No doctors found. Start the backend once before seeding demo data.');
  }

  const demoVisits = await client.query('SELECT id FROM visit_records WHERE notes LIKE $1', [`%${marker}%`]);
  for (const visit of demoVisits.rows) {
    await client.query('DELETE FROM visit_records WHERE id = $1', [visit.id]);
  }
  await client.query('DELETE FROM patients WHERE email LIKE $1', ['demo.seed.%@drosa.test']);

  const patients = [
    ['Mina', 'Jovanovic', '1991-03-12', 'Z', '+381601110001', 'Kralja Petra 12, Beograd'],
    ['Nemanja', 'Stankovic', '1984-07-22', 'M', '+381601110002', 'Bulevar Oslobodjenja 44, Novi Sad'],
    ['Sara', 'Milosevic', '1997-11-05', 'Z', '+381601110003', 'Cara Dusana 9, Zemun'],
    ['Viktor', 'Nikolic', '1979-01-30', 'M', '+381601110004', 'Vojvode Stepe 133, Beograd'],
    ['Jelena', 'Petrovic', '1988-09-18', 'Z', '+381601110005', 'Gospodar Jovanova 18, Beograd'],
    ['Lazar', 'Ilic', '1993-04-27', 'M', '+381601110006', 'Mise Dimitrijevica 21, Novi Sad'],
    ['Tamara', 'Radovic', '1975-12-10', 'Z', '+381601110007', 'Njegoseva 31, Beograd'],
    ['Ognjen', 'Kovacevic', '2000-06-02', 'M', '+381601110008', 'Zmaj Jovina 4, Pancevo'],
    ['Ivana', 'Simic', '1982-02-16', 'Z', '+381601110009', 'Takovska 56, Beograd'],
    ['Marko', 'Lukic', '1995-08-24', 'M', '+381601110010', 'Dunavska 7, Novi Sad']
  ];

  const patientIds = [];
  for (let index = 0; index < patients.length; index += 1) {
    const patient = patients[index];
    const result = await client.query(`
      INSERT INTO patients (first_name, last_name, date_of_birth, gender, email, phone, address, emergency_contact, medical_history)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `, [
      patient[0],
      patient[1],
      patient[2],
      patient[3],
      `demo.seed.${String(index + 1).padStart(2, '0')}@drosa.test`,
      patient[4],
      patient[5],
      '+381601119999',
      'Demo pacijent za testiranje izvestaja'
    ]);
    patientIds.push(Number(result.rows[0].id));
  }

  const procedures = ['Kontrola i ciscenje', 'Plomba', 'Endodontija', 'Krunica', 'Most', 'Implant', 'Vadjenje', 'Ortodontija', 'Izbeljivanje', 'Parodontologija'];
  const statuses = ['Zakazano', 'U toku', 'Zavrseno', 'Zavrseno', 'Zavrseno', 'U toku'];
  const paymentStatuses = ['Placeno', 'Placeno', 'Placeno', 'Delimicno', 'Dugovanje'];
  const teeth = ['11', '12', '14', '16', '21', '24', '26', '31', '36', '41', '44', '46'];

  for (let index = 0; index < 50; index += 1) {
    const patientId = patientIds[index % patientIds.length];
    const doctor = doctors[index % doctors.length];
    const currency = index < 25 ? 'RSD' : 'EUR';
    const shift = index < 17 ? 'Prva smena' : 'Druga smena';
    const procedure = procedures[index % procedures.length];
    const status = statuses[index % statuses.length];
    const paymentStatus = paymentStatuses[index % paymentStatuses.length];
    const day = String((index % 28) + 1).padStart(2, '0');
    const month = String(1 + (index % 5)).padStart(2, '0');
    const amount = currency === 'RSD' ? 3500 + (index % 8) * 1200 : 35 + (index % 8) * 18;

    const visit = await client.query(`
      INSERT INTO visit_records (patient_id, doctor_id, visit_date, procedure, status, shift, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `, [patientId, doctor.id, `2026-${month}-${day}`, procedure, status, shift, `${marker}; ${shift}; valuta ${currency}; doktor ${doctor.name}`]);
    const visitId = Number(visit.rows[0].id);

    await client.query(`
      INSERT INTO payments (visit_record_id, patient_id, amount, currency, payment_status, payment_method, payment_date, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [visitId, patientId, amount, currency, paymentStatus, index % 3 === 0 ? 'Kartica' : 'Gotovina', `2026-${month}-${day}`, `${marker}; ${paymentStatus}`]);

    await client.query(`
      INSERT INTO treatments (visit_record_id, tooth_number, treatment_type, status, notes)
      VALUES ($1, $2, $3, $4, $5)
    `, [visitId, teeth[index % teeth.length], procedure, status === 'Zavrseno' ? 'Zavrseno' : 'Planirano', `${marker}; demo tretman`]);
  }

  console.log('Demo data seeded: 10 patients, 50 records, 25 RSD, 25 EUR, 17 first shift, 33 second shift.');
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
