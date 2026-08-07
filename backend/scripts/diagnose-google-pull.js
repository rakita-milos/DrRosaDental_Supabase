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

function hasFlag(name) {
  return process.argv.includes(name);
}

function safeGoogleSettings(row = {}) {
  return {
    has_sync_token: Boolean(row.has_sync_token),
    last_google_pull_at: row.last_google_pull_at,
    sync_enabled: row.sync_enabled,
    sync_direction: row.sync_direction,
    calendar_id: row.calendar_id,
    calendar_name: row.calendar_name,
    oauth_connected: Boolean(row.oauth_access_token || row.oauth_refresh_token),
    oauth_token_expires_at: row.oauth_token_expires_at
  };
}

async function fetchJson(url, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, {
    headers
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `Google request failed: ${response.status}`);
  }
  return data;
}

async function main() {
  // Read-only diagnostic script. It must not write to production data.
  const fromDay = isoDay(argValue('--from', null)) || new Date().toISOString().slice(0, 10);
  const toFallback = new Date(new Date(`${fromDay}T00:00:00.000Z`).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const toDay = isoDay(argValue('--to', null)) || toFallback;
  const from = `${fromDay} 00:00:00 Europe/Belgrade`;
  const to = `${toDay} 00:00:00 Europe/Belgrade`;
  const onlyGoogleEvents = hasFlag('--only-google-events');
  const pool = createPool();
  try {
    const settings = await pool.query(`
      SELECT *,
             events_sync_token IS NOT NULL AS has_sync_token,
             last_google_pull_at,
             sync_enabled,
             sync_direction
      FROM google_calendar_settings
      WHERE id = 1
    `);
    console.log(`SETTINGS ${JSON.stringify(safeGoogleSettings(settings.rows[0]))}`);

    if (!onlyGoogleEvents) {
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
               unchanged, imported_with_warning, partial, error_message
        FROM google_calendar_sync_jobs
        ORDER BY started_at DESC
        LIMIT 5
      `);
      console.log(`JOBS ${JSON.stringify(jobs.rows)}`);
    }

    if (!onlyGoogleEvents && hasFlag('--details')) {
      const doctors = await pool.query(`
        SELECT id, name, google_color_id, calendar_color, calendar_text_color, is_active
        FROM doctors
        ORDER BY id
      `);
      console.log(`DOCTORS ${JSON.stringify(doctors.rows)}`);

      const byDoctor = await pool.query(`
        SELECT d.id AS doctor_id,
               d.name AS doctor_name,
               d.google_color_id,
               d.calendar_color,
               a.google_sync_warning_code,
               count(*)::int AS count
        FROM appointments a
        JOIN doctors d ON d.id = a.doctor_id
        WHERE a.google_event_id IS NOT NULL
          AND a.starts_at >= $1::timestamptz
          AND a.starts_at < $2::timestamptz
        GROUP BY d.id, d.name, d.google_color_id, d.calendar_color, a.google_sync_warning_code
        ORDER BY d.id, a.google_sync_warning_code NULLS FIRST
      `, [from, to]);
      console.log(`APPOINTMENTS_BY_DOCTOR_WARNING ${JSON.stringify(byDoctor.rows)}`);

      const sample = await pool.query(`
        SELECT a.id,
               a.google_event_id,
               a.procedure_name,
               a.starts_at AT TIME ZONE 'Europe/Belgrade' AS local_start,
               a.google_sync_warning_code,
               d.id AS doctor_id,
               d.name AS doctor_name,
               d.google_color_id,
               d.calendar_color,
               d.calendar_text_color
        FROM appointments a
        JOIN doctors d ON d.id = a.doctor_id
        WHERE a.google_event_id IS NOT NULL
          AND a.starts_at >= $1::timestamptz
          AND a.starts_at < $2::timestamptz
        ORDER BY a.starts_at
        LIMIT 40
      `, [from, to]);
      console.log(`SAMPLE ${JSON.stringify(sample.rows)}`);
    }

    if (hasFlag('--google-events')) {
      const row = settings.rows[0];
      if (!row?.oauth_access_token || !row?.calendar_id) {
        console.log('GOOGLE_EVENTS {"error":"Google OAuth token or calendar_id missing"}');
      } else {
        const calendarId = encodeURIComponent(row.calendar_id);
        const params = new URLSearchParams({
          singleEvents: 'true',
          showDeleted: 'false',
          maxResults: '2500',
          eventLabelVersion: '1',
          timeMin: new Date(`${fromDay}T00:00:00+02:00`).toISOString(),
          timeMax: new Date(`${toDay}T00:00:00+02:00`).toISOString()
        });
        const data = await fetchJson(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?${params.toString()}`, row.oauth_access_token);
        let colorsError = '';
        let calendarError = '';
        const colors = await fetchJson('https://www.googleapis.com/calendar/v3/colors', null).catch(error => {
          colorsError = error.message;
          return {};
        });
        const calendar = await fetchJson(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}?eventLabelVersion=1`, row.oauth_access_token).catch(error => {
          calendarError = error.message;
          return {};
        });
        const labels = calendar?.labelProperties?.eventLabels || [];
        const byColor = new Map();
        for (const event of data.items || []) {
          const key = `${event.eventLabelId || ''}|||${event.colorId || ''}`;
          const label = event.eventLabelId ? labels.find(item => item?.id === event.eventLabelId) : null;
          const googleColor = event.colorId ? colors?.event?.[event.colorId] : null;
          const item = byColor.get(key) || {
            eventLabelId: event.eventLabelId || '',
            colorId: event.colorId || '',
            labelName: label?.label || label?.displayName || '',
            labelBackground: label?.backgroundColor || '',
            colorBackground: googleColor?.background || '',
            colorForeground: googleColor?.foreground || '',
            count: 0,
            examples: []
          };
          item.count += 1;
          if (item.examples.length < 5) item.examples.push(event.summary || 'Bez naslova');
          byColor.set(key, item);
        }
        console.log(`GOOGLE_EVENTS ${JSON.stringify({
          fetched: Number(data.items?.length || 0),
          colorsError,
          calendarError,
          eventLabels: labels.map(label => ({
            id: label.id || '',
            name: label.label || label.displayName || '',
            background: label.backgroundColor || '',
            foreground: label.foregroundColor || ''
          })),
          eventColors: Object.entries(colors?.event || {}).map(([id, color]) => ({
            id,
            background: color?.background || '',
            foreground: color?.foreground || ''
          })),
          byColor: Array.from(byColor.values()).sort((a, b) => b.count - a.count)
        })}`);
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error('DB_ERROR', error.code, error.message);
  process.exit(1);
});
