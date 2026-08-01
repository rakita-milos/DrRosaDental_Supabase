require('dotenv').config({ path: 'backend/.env' });

const { createPool } = require('../db/postgres');

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function isoDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? value : null;
}

async function main() {
  // Read-only diagnostic script. It must not write to production data.
  const fromDay = isoDay(argValue('--from', null)) || new Date().toISOString().slice(0, 10);
  const toFallback = new Date(new Date(`${fromDay}T00:00:00.000Z`).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const toDay = isoDay(argValue('--to', null)) || toFallback;
  const from = `${fromDay} 00:00:00 Europe/Belgrade`;
  const to = `${toDay} 00:00:00 Europe/Belgrade`;
  const pool = createPool();
  try {
    const settings = await pool.query(`
      SELECT events_sync_token IS NOT NULL AS has_sync_token,
             last_google_pull_at,
             sync_enabled,
             sync_direction
      FROM google_calendar_settings
      WHERE id = 1
    `);
    console.log(`SETTINGS ${JSON.stringify(settings.rows[0])}`);

    const counts = await pool.query(`
      SELECT date(starts_at AT TIME ZONE 'Europe/Belgrade') AS day,
             count(*)::int AS count,
             count(*) FILTER (WHERE google_event_id IS NOT NULL)::int AS google_count,
             count(*) FILTER (WHERE google_sync_warning_code IS NOT NULL)::int AS warning_count
      FROM appointments
      WHERE starts_at >= $1::timestamptz
        AND starts_at < $2::timestamptz
      GROUP BY 1
      ORDER BY 1
    `, [from, to]);
    console.log(`COUNTS ${JSON.stringify(counts.rows)}`);

    const jobs = await pool.query(`
      SELECT id, status, started_at, finished_at, fetched, imported, updated, cancelled,
             unchanged, imported_with_warning, partial, error_message, result_json
      FROM google_calendar_sync_jobs
      ORDER BY started_at DESC
      LIMIT 5
    `);
    console.log(`JOBS ${JSON.stringify(jobs.rows)}`);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error('DB_ERROR', error.code, error.message);
  process.exit(1);
});
