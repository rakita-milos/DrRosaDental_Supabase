const {
  execute,
  insertReturningId,
  queryMany,
  queryOne,
  withTransaction
} = require('./postgres');
const BLOCKING_STATUSES = ['scheduled', 'confirmed', 'arrived'];
const ROW_EXISTS_TABLES = new Set(['patients', 'doctors', 'chairs', 'codebook_items']);

function createCalendarRepository({ pgPool }) {
  if (!pgPool) throw new Error('pgPool is required for postgres calendar repository.');
  return createPostgresCalendarRepository(pgPool);
}

function appointmentSelectSql(whereClause) {
  return `
    SELECT
      a.*,
      p.first_name || ' ' || p.last_name as patient_name,
      d.name as doctor_name,
      d.google_color_id as doctor_google_color_id,
      d.calendar_color as doctor_calendar_color,
      d.calendar_text_color as doctor_calendar_text_color,
      c.name as chair_name
    FROM appointments a
    JOIN patients p ON a.patient_id = p.id
    JOIN doctors d ON a.doctor_id = d.id
    JOIN chairs c ON a.chair_id = c.id
    ${whereClause}
  `;
}

function phoneLookupKeys(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const keys = new Set();
  if (digits) keys.add(digits);
  if (digits.startsWith('381') && digits.length > 5) keys.add(`0${digits.slice(3)}`);
  if (digits.startsWith('0') && digits.length > 5) keys.add(`381${digits.slice(1)}`);
  return Array.from(keys);
}

function createPostgresCalendarRepository(pool) {
  return {
    listActiveChairs() {
      return queryMany(pool, 'SELECT id, name, is_active FROM chairs WHERE is_active = true ORDER BY name');
    },

    listAppointments({ from, to, doctorId = null, status = null }) {
      const filters = ['a.starts_at < ?', 'a.ends_at > ?'];
      const params = [to, from];
      if (doctorId) {
        filters.push('a.doctor_id = ?');
        params.push(doctorId);
      }
      if (status) {
        filters.push('a.status = ?');
        params.push(status);
      }
      return queryMany(pool, `${appointmentSelectSql(`WHERE ${filters.join(' AND ')}`)} ORDER BY a.starts_at, a.id`, params);
    },

    appointmentById(id) {
      return queryOne(pool, appointmentSelectSql('WHERE a.id = ?'), [id]);
    },

    async rowExists(table, id) {
      if (!ROW_EXISTS_TABLES.has(table)) throw new Error('Unsupported rowExists table.');
      const row = await queryOne(pool, `SELECT id FROM ${table} WHERE id = ?`, [id]);
      return Boolean(row);
    },

    appointmentConflict({ appointmentId = null, doctorId, chairId, startsAt, endsAt }) {
      return queryOne(pool, conflictSql(), [doctorId, appointmentId, ...BLOCKING_STATUSES, doctorId, chairId, endsAt, startsAt]);
    },

    async createAppointment(appointment) {
      const id = await insertReturningId(pool, appointmentInsertSql(), appointmentInsertParams(appointment));
      await execute(pool, 'INSERT INTO appointment_status_history (appointment_id, old_status, new_status, changed_by) VALUES (?, NULL, ?, ?)', [id, appointment.status, appointment.userId]);
      return Number(id);
    },

    async updateAppointment(id, appointment, oldStatus) {
      await execute(pool, `
        UPDATE appointments
        SET patient_id = ?, doctor_id = ?, chair_id = ?, procedure_id = ?, procedure_name = ?,
            starts_at = ?, ends_at = ?, duration_minutes = ?, status = ?, notes = ?,
            patient_match_locked = CASE WHEN ? THEN true ELSE patient_match_locked END,
            google_patient_match_status = CASE WHEN ? THEN 'manual' ELSE google_patient_match_status END,
            google_patient_match_note = CASE WHEN ? THEN 'Pacijent je rucno izabran u aplikaciji.' ELSE google_patient_match_note END,
            updated_by = ?, updated_at = now()
        WHERE id = ?
      `, [...appointmentUpdateParams(appointment), Boolean(appointment.lockPatientMatch), Boolean(appointment.lockPatientMatch), Boolean(appointment.lockPatientMatch), id]);
      if (oldStatus !== appointment.status) {
        await execute(pool, 'INSERT INTO appointment_status_history (appointment_id, old_status, new_status, changed_by) VALUES (?, ?, ?, ?)', [id, oldStatus, appointment.status, appointment.userId]);
      }
    },

    async updateAppointmentStatus({ id, oldStatus, status, userId }) {
      await execute(pool, 'UPDATE appointments SET status = ?, updated_by = ?, updated_at = now() WHERE id = ?', [status, userId, id]);
      await execute(pool, 'INSERT INTO appointment_status_history (appointment_id, old_status, new_status, changed_by) VALUES (?, ?, ?, ?)', [id, oldStatus, status, userId]);
    },

    deleteAppointment(id) {
      return execute(pool, 'DELETE FROM appointments WHERE id = ?', [id]);
    },

    cancelAppointment({ id, userId }) {
      return execute(pool, 'UPDATE appointments SET status = ?, updated_by = ?, updated_at = now() WHERE id = ?', ['cancelled', userId, id]);
    },

    async completeAppointment({ id, visitRecordId, oldStatus, userId }) {
      await execute(pool, `
        UPDATE appointments
        SET status = 'completed', visit_record_id = ?, updated_by = ?, updated_at = now()
        WHERE id = ?
      `, [visitRecordId, userId, id]);
      await execute(pool, 'INSERT INTO appointment_status_history (appointment_id, old_status, new_status, changed_by) VALUES (?, ?, ?, ?)', [id, oldStatus, 'completed', userId]);
    },

    async publicBookingOptions() {
      return {
        doctors: await queryMany(pool, 'SELECT id, name, specialization FROM doctors WHERE is_active = true ORDER BY name'),
        procedures: await queryMany(pool, "SELECT id, value, label, price, price_currency FROM codebook_items WHERE type = 'procedure' AND is_active = true ORDER BY sort_order, label")
      };
    },

    publicBookingDoctors(doctorId = null) {
      return doctorId
        ? queryMany(pool, 'SELECT id, name, google_color_id, calendar_color, calendar_text_color FROM doctors WHERE id = ? AND is_active = true', [doctorId])
        : queryMany(pool, 'SELECT id, name, google_color_id, calendar_color, calendar_text_color FROM doctors WHERE is_active = true ORDER BY name');
    },

    defaultActiveChair() {
      return queryOne(pool, 'SELECT id FROM chairs WHERE is_active = true ORDER BY id LIMIT 1');
    },

    activeChairs() {
      return queryMany(pool, 'SELECT id, name FROM chairs WHERE is_active = true ORDER BY id');
    },

    activeDoctors() {
      return queryMany(pool, 'SELECT id, name FROM doctors WHERE is_active = true ORDER BY id');
    },

    defaultActiveDoctor() {
      return queryOne(pool, 'SELECT id FROM doctors WHERE is_active = true ORDER BY id LIMIT 1');
    },

    doctorByGoogleColor({ googleColorId = null, calendarColor = null }) {
      const normalizedCalendarColor = calendarColor ? String(calendarColor).toLowerCase() : null;
      return queryOne(pool, `
        SELECT id FROM doctors
        WHERE is_active = true
          AND (
            (?::text IS NOT NULL AND google_color_id = ?::text)
            OR (?::text IS NOT NULL AND lower(calendar_color) = ?::text)
          )
        ORDER BY id
        LIMIT 1
      `, [googleColorId, googleColorId, normalizedCalendarColor, normalizedCalendarColor]);
    },

    findPatientByEmail(email) {
      return queryOne(pool, 'SELECT * FROM patients WHERE lower(email) = lower(?) LIMIT 1', [email]);
    },

    findPatientsForGoogleTitle({ firstName = '', lastName = '', phone = '' }) {
      const phoneKeys = phoneLookupKeys(phone);
      const filters = [];
      const params = [];
      if (phoneKeys.length) {
        filters.push("regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = ANY(?::text[])");
        params.push(phoneKeys);
      }
      if (firstName && lastName) {
        filters.push('(lower(btrim(first_name)) = lower(btrim(?)) AND lower(btrim(last_name)) = lower(btrim(?)))');
        params.push(firstName, lastName);
      }
      if (!filters.length) return [];
      return queryMany(pool, `
        SELECT id, first_name, last_name, phone, email
        FROM patients
        WHERE (${filters.join(' OR ')})
        ORDER BY created_at DESC
        LIMIT 10
      `, params);
    },

    async ensureGoogleImportPatient() {
      const existing = await queryOne(pool, `
        SELECT id FROM patients
        WHERE first_name = 'Google Calendar' AND last_name = 'Import'
        ORDER BY id
        LIMIT 1
      `);
      if (existing) return Number(existing.id);

      const id = await insertReturningId(pool, `
        INSERT INTO patients (first_name, last_name, medical_history)
        VALUES ('Google Calendar', 'Import', 'Fallback patient for Google Calendar imports without a matched patient.')
      `);
      return Number(id);
    },

    createPublicBooking({ patient, appointment, booking }) {
      return withTransaction(pool, async client => {
        let patientRow = patient.email ? await queryOne(client, 'SELECT * FROM patients WHERE lower(email) = lower(?) LIMIT 1', [patient.email]) : null;
        if (!patientRow) {
          const patientId = await insertReturningId(client, 'INSERT INTO patients (first_name, last_name, email, phone) VALUES (?, ?, ?, ?)', [patient.firstName, patient.lastName, patient.email, patient.phone]);
          patientRow = await queryOne(client, 'SELECT * FROM patients WHERE id = ?', [patientId]);
        }
        const appointmentId = await insertReturningId(client, `
          INSERT INTO appointments (patient_id, doctor_id, chair_id, procedure_id, procedure_name, starts_at, ends_at, duration_minutes, status, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)
        `, [patientRow.id, appointment.doctorId, appointment.chairId, appointment.procedureId, appointment.procedureName, appointment.startsAt, appointment.endsAt, appointment.durationMinutes, appointment.notes]);
        const bookingId = await insertReturningId(client, `
          INSERT INTO public_booking_requests (
            patient_id, appointment_id, first_name, last_name, email, phone, doctor_id, procedure_id, procedure_name,
            requested_starts_at, duration_minutes, status, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'booked', ?)
        `, [patientRow.id, appointmentId, patient.firstName, patient.lastName, patient.email, patient.phone, appointment.doctorId, appointment.procedureId, appointment.procedureName, appointment.startsAt, appointment.durationMinutes, booking.notes]);
        return { id: Number(bookingId), appointmentId: Number(appointmentId), patientId: Number(patientRow.id), status: 'booked' };
      });
    },

    googleSettings() {
      return queryOne(pool, 'SELECT * FROM google_calendar_settings WHERE id = 1');
    },

    async pendingSyncCount() {
      const row = await queryOne(pool, "SELECT COUNT(*)::int as count FROM calendar_sync_queue WHERE status IN ('pending', 'retry', 'failed')");
      return Number(row?.count || 0);
    },

    updateGoogleAccessToken({ accessToken, expiresAt }) {
      return execute(pool, `
        UPDATE google_calendar_settings
        SET oauth_access_token = ?, oauth_token_expires_at = ?, updated_at = now()
        WHERE id = 1
      `, [accessToken, expiresAt]);
    },

    async queueCalendarSync({ appointmentId, action }) {
      const settings = await queryOne(pool, 'SELECT sync_enabled FROM google_calendar_settings WHERE id = 1');
      const status = settings?.sync_enabled ? 'pending' : 'skipped';
      await execute(pool, `
        INSERT INTO calendar_sync_queue (appointment_id, action, status, last_error, processed_at)
        VALUES (?, ?, ?, ?, CASE WHEN ? = 'skipped' THEN now() ELSE NULL END)
      `, [appointmentId, action, status, status === 'skipped' ? 'Google Calendar sync is disabled.' : null, status]);
      await execute(pool, 'UPDATE appointments SET google_sync_status = ?, updated_at = now() WHERE id = ?', [status === 'pending' ? 'pending' : 'skipped', appointmentId]);
    },

    pendingSyncQueue(limit) {
      return queryMany(pool, `
        SELECT q.*, a.google_event_id, a.procedure_name, a.starts_at, a.ends_at, a.notes,
               p.first_name || ' ' || p.last_name as patient_name,
               d.google_color_id as doctor_google_color_id
        FROM calendar_sync_queue q
        LEFT JOIN appointments a ON q.appointment_id = a.id
        LEFT JOIN patients p ON p.id = a.patient_id
        LEFT JOIN doctors d ON d.id = a.doctor_id
        WHERE q.status IN ('pending', 'retry')
        ORDER BY q.created_at
        LIMIT ?
      `, [limit]);
    },

    async markSyncSkipped({ queueId, appointmentId, error }) {
      await execute(pool, `
        UPDATE calendar_sync_queue
        SET status = 'skipped', attempts = attempts + 1, last_error = ?, processed_at = now()
        WHERE id = ?
      `, [error, queueId]);
      await execute(pool, 'UPDATE appointments SET google_sync_status = ?, updated_at = now() WHERE id = ?', ['skipped', appointmentId]);
    },

    async markSyncDone({ queueId, appointmentId, googleEventId }) {
      await execute(pool, `
        UPDATE appointments
        SET google_event_id = ?, google_sync_status = 'synced', updated_at = now()
        WHERE id = ?
      `, [googleEventId, appointmentId]);
      await execute(pool, `
        UPDATE calendar_sync_queue
        SET status = 'done', attempts = attempts + 1, last_error = NULL, processed_at = now()
        WHERE id = ?
      `, [queueId]);
      await execute(pool, 'UPDATE google_calendar_settings SET last_sync_at = now(), updated_at = now() WHERE id = 1');
    },

    markSyncFailed({ queueId, error }) {
      return execute(pool, `
        UPDATE calendar_sync_queue
        SET status = CASE WHEN attempts >= 2 THEN 'failed' ELSE 'retry' END,
            attempts = attempts + 1,
            last_error = ?,
            processed_at = now()
        WHERE id = ?
      `, [error, queueId]);
    },

    async appointmentIdByGoogleEventId(googleEventId) {
      const row = await queryOne(pool, 'SELECT id FROM appointments WHERE google_event_id = ?', [googleEventId]);
      return row?.id || null;
    },

    async cancelFromGoogle({ id, oldStatus }) {
      await execute(pool, `
        UPDATE appointments
        SET status = 'cancelled', google_sync_status = 'synced', updated_at = now()
        WHERE id = ?
      `, [id]);
      await execute(pool, 'INSERT INTO appointment_status_history (appointment_id, old_status, new_status, changed_by) VALUES (?, ?, ?, NULL)', [id, oldStatus, 'cancelled']);
    },

    updateFromGoogle({ id, startsAt, endsAt, durationMinutes, procedureName, notes, googleEventId, status }) {
      return execute(pool, `
        UPDATE appointments
        SET starts_at = ?, ends_at = ?, duration_minutes = ?, procedure_name = ?, notes = ?,
            google_event_id = ?, google_sync_status = 'synced', status = ?, updated_at = now()
        WHERE id = ?
      `, [startsAt, endsAt, durationMinutes, procedureName, notes, googleEventId, status, id]);
    },

    updateFromGoogleWithWarning({ id, startsAt, endsAt, durationMinutes, procedureName, notes, googleEventId, status, doctorId, chairId, googleEventType = 'appointment', warning = null, warningCode = null, patientId = null, googleTitle = null, patientMatchStatus = null, patientMatchNote = null, patientMatchLocked = false }) {
      return execute(pool, `
        UPDATE appointments
        SET patient_id = ?, doctor_id = ?, chair_id = ?, starts_at = ?, ends_at = ?, duration_minutes = ?, procedure_name = ?, notes = ?,
            google_event_id = ?, google_sync_status = ?, google_event_type = ?, google_sync_warning = ?,
            google_sync_warning_code = ?, google_title = ?, google_patient_match_status = ?,
            google_patient_match_note = ?, patient_match_locked = ?, status = ?, updated_at = now()
        WHERE id = ?
      `, [patientId, doctorId, chairId, startsAt, endsAt, durationMinutes, procedureName, notes, googleEventId, warning ? 'warning' : 'synced', googleEventType, warning, warningCode, googleTitle, patientMatchStatus, patientMatchNote, Boolean(patientMatchLocked), status, id]);
    },

    async importAppointmentFromGoogle(appointment) {
      const id = await insertReturningId(pool, `
        INSERT INTO appointments (
          patient_id, doctor_id, chair_id, procedure_id, procedure_name,
          starts_at, ends_at, duration_minutes, status, notes,
          google_event_id, google_sync_status, google_event_type, google_sync_warning,
          google_sync_warning_code, google_title, google_patient_match_status,
          google_patient_match_note, patient_match_locked, created_by, updated_by
        )
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
      `, [
        appointment.patientId,
        appointment.doctorId,
        appointment.chairId,
        appointment.procedureName,
        appointment.startsAt,
        appointment.endsAt,
        appointment.durationMinutes,
        appointment.status,
        appointment.notes,
        appointment.googleEventId,
        appointment.warning ? 'warning' : 'synced',
        appointment.googleEventType || 'appointment',
        appointment.warning || null,
        appointment.warningCode || null,
        appointment.googleTitle || null,
        appointment.patientMatchStatus || null,
        appointment.patientMatchNote || null,
        Boolean(appointment.patientMatchLocked)
      ]);
      await execute(pool, 'INSERT INTO appointment_status_history (appointment_id, old_status, new_status, changed_by) VALUES (?, NULL, ?, NULL)', [id, appointment.status]);
      return Number(id);
    },

    clearGoogleEventsSyncToken() {
      return execute(pool, 'UPDATE google_calendar_settings SET events_sync_token = NULL, updated_at = now() WHERE id = 1');
    },

    markGooglePull({ syncToken = null }) {
      if (syncToken) {
        return execute(pool, `
          UPDATE google_calendar_settings
          SET events_sync_token = ?, last_google_pull_at = now(), updated_at = now()
          WHERE id = 1
        `, [syncToken]);
      }
      return execute(pool, 'UPDATE google_calendar_settings SET last_google_pull_at = now(), updated_at = now() WHERE id = 1');
    },

    updateGoogleSettings(settings) {
      return execute(pool, `
        INSERT INTO google_calendar_settings (
          id, connected_email, calendar_id, calendar_name, client_id, client_secret,
          redirect_uri, sync_enabled, sync_direction, default_reminder_minutes
        )
        VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE
        SET connected_email = EXCLUDED.connected_email,
            calendar_id = EXCLUDED.calendar_id,
            calendar_name = EXCLUDED.calendar_name,
            client_id = COALESCE(EXCLUDED.client_id, google_calendar_settings.client_id),
            client_secret = COALESCE(EXCLUDED.client_secret, google_calendar_settings.client_secret),
            redirect_uri = COALESCE(EXCLUDED.redirect_uri, google_calendar_settings.redirect_uri),
            sync_enabled = EXCLUDED.sync_enabled,
            sync_direction = EXCLUDED.sync_direction,
            default_reminder_minutes = EXCLUDED.default_reminder_minutes,
            events_sync_token = CASE WHEN ? THEN NULL ELSE google_calendar_settings.events_sync_token END,
            updated_at = now()
      `, [settings.connectedEmail, settings.calendarId, settings.calendarName, settings.clientId, settings.clientSecret, settings.redirectUri, settings.syncEnabled, settings.syncDirection, settings.defaultReminderMinutes, settings.resetGooglePullToken]);
    },

    storeGoogleOAuthTokens({ accessToken, refreshToken, expiresAt }) {
      return execute(pool, `
        UPDATE google_calendar_settings
        SET oauth_access_token = ?, oauth_refresh_token = COALESCE(?, oauth_refresh_token),
            oauth_token_expires_at = ?, updated_at = now()
        WHERE id = 1
      `, [accessToken, refreshToken || null, expiresAt]);
    },

    calendarSyncRows(limit = 50) {
      return queryMany(pool, 'SELECT * FROM calendar_sync_queue ORDER BY created_at DESC LIMIT ?', [limit]);
    },

    async startGoogleSyncJob({ userId = null, request = null } = {}) {
      return withTransaction(pool, async client => {
        await execute(client, `
          UPDATE google_calendar_sync_jobs
          SET status = 'failed', finished_at = now(), error_message = 'Google sync lock expired before completion.'
          WHERE status = 'running' AND started_at <= now() - interval '15 minutes'
        `);
        const running = await queryOne(client, `
          SELECT id, started_at
          FROM google_calendar_sync_jobs
          WHERE status = 'running'
          ORDER BY started_at DESC
          LIMIT 1
          FOR UPDATE
        `);
        if (running) return { alreadyRunning: true, job: running };
        try {
          const id = await insertReturningId(client, `
            INSERT INTO google_calendar_sync_jobs (status, started_by, request_json, progress_json, last_heartbeat_at)
            VALUES ('running', ?, ?, ?, now())
          `, [userId, request ? JSON.stringify(request) : null, JSON.stringify({})]);
          return { alreadyRunning: false, job: { id, started_by: userId } };
        } catch (error) {
          if (error?.code === '23505') {
            const job = await queryOne(client, `
              SELECT id, started_at
              FROM google_calendar_sync_jobs
              WHERE status = 'running'
              ORDER BY started_at DESC
              LIMIT 1
            `);
            return { alreadyRunning: true, job };
          }
          throw error;
        }
      });
    },

    googleSyncJobById(jobId) {
      return queryOne(pool, `
        SELECT j.*, u.name as started_by_name, u.role as started_by_role
        FROM google_calendar_sync_jobs j
        LEFT JOIN users u ON u.id = j.started_by
        WHERE j.id = ?
        LIMIT 1
      `, [jobId]);
    },

    latestRunningGoogleSyncJob() {
      return queryOne(pool, `
        SELECT j.*, u.name as started_by_name, u.role as started_by_role
        FROM google_calendar_sync_jobs j
        LEFT JOIN users u ON u.id = j.started_by
        WHERE j.status = 'running'
        ORDER BY j.started_at DESC
        LIMIT 1
      `);
    },

    updateGoogleSyncJobProgress({ jobId, stats, cursor = null }) {
      return execute(pool, `
        UPDATE google_calendar_sync_jobs
        SET fetched = ?, imported = ?, updated = ?, cancelled = ?, unchanged = ?,
            imported_with_warning = ?, all_day_events = ?, conflicts = ?, invalid_time = ?,
            partial = ?, progress_json = ?, cursor_json = ?, last_heartbeat_at = now()
        WHERE id = ? AND status = 'running'
      `, [
        Number(stats?.fetched || 0),
        Number(stats?.imported || 0),
        Number(stats?.updated || 0),
        Number(stats?.cancelled || 0),
        Number(stats?.unchanged || 0),
        Number(stats?.importedWithWarning || 0),
        Number(stats?.allDayEvents || 0),
        Number(stats?.conflicts || 0),
        Number(stats?.invalidTime || 0),
        Boolean(stats?.partial),
        JSON.stringify(stats || {}),
        cursor ? JSON.stringify(cursor) : null,
        jobId
      ]);
    },

    finishGoogleSyncJob({ jobId, status, stats, errorMessage = null }) {
      return execute(pool, `
        UPDATE google_calendar_sync_jobs
        SET status = ?, finished_at = now(), fetched = ?, imported = ?, updated = ?, cancelled = ?,
            unchanged = ?, imported_with_warning = ?, all_day_events = ?, conflicts = ?,
            invalid_time = ?, partial = ?, error_message = ?, cursor_json = NULL, progress_json = ?, result_json = ?
        WHERE id = ?
      `, [
        status,
        Number(stats?.fetched || 0),
        Number(stats?.imported || 0),
        Number(stats?.updated || 0),
        Number(stats?.cancelled || 0),
        Number(stats?.unchanged || 0),
        Number(stats?.importedWithWarning || 0),
        Number(stats?.allDayEvents || 0),
        Number(stats?.conflicts || 0),
        Number(stats?.invalidTime || 0),
        Boolean(stats?.partial),
        errorMessage,
        JSON.stringify(stats || {}),
        JSON.stringify(stats || {}),
        jobId
      ]);
    },

    latestGoogleSyncJob() {
      return queryOne(pool, `
        SELECT j.*, u.name as started_by_name, u.role as started_by_role
        FROM google_calendar_sync_jobs j
        LEFT JOIN users u ON u.id = j.started_by
        ORDER BY j.started_at DESC
        LIMIT 1
      `);
    },

    createNotification({ type, title, message, metadata = null, userId = null }) {
      return insertReturningId(pool, `
        INSERT INTO app_notifications (type, title, message, metadata, created_by)
        VALUES (?, ?, ?, ?, ?)
      `, [type, title, message, metadata ? JSON.stringify(metadata) : null, userId]);
    },

    notificationsSince({ sinceId = 0, limit = 20, latest = false } = {}) {
      if (latest) {
        return queryMany(pool, `
          SELECT n.*, u.name as created_by_name
          FROM app_notifications n
          LEFT JOIN users u ON u.id = n.created_by
          ORDER BY n.id DESC
          LIMIT ?
        `, [limit]);
      }

      return queryMany(pool, `
        SELECT n.*, u.name as created_by_name
        FROM app_notifications n
        LEFT JOIN users u ON u.id = n.created_by
        WHERE n.id > ?
        ORDER BY n.id ASC
        LIMIT ?
      `, [sinceId, limit]);
    }
  };
}

function conflictSql() {
  return `
    SELECT
      a.id,
      a.starts_at,
      a.ends_at,
      a.status,
      p.first_name || ' ' || p.last_name as patient_name,
      d.name as doctor_name,
      c.name as chair_name,
      CASE WHEN a.doctor_id = ? THEN 'doctor' ELSE 'chair' END as conflict_type
    FROM appointments a
    JOIN patients p ON a.patient_id = p.id
    JOIN doctors d ON a.doctor_id = d.id
    JOIN chairs c ON a.chair_id = c.id
    WHERE a.id != COALESCE(?, 0)
      AND a.status IN (?, ?, ?)
      AND COALESCE(a.google_event_type, 'appointment') = 'appointment'
      AND (a.doctor_id = ? OR a.chair_id = ?)
      AND a.starts_at < ?
      AND a.ends_at > ?
    ORDER BY a.starts_at
    LIMIT 1
  `;
}

function appointmentInsertSql() {
  return `
    INSERT INTO appointments (
      patient_id, doctor_id, chair_id, procedure_id, procedure_name, starts_at, ends_at,
      duration_minutes, status, notes, created_by, updated_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
}

function appointmentInsertParams(appointment) {
  return [
    appointment.patientId,
    appointment.doctorId,
    appointment.chairId,
    appointment.procedureId,
    appointment.procedureName,
    appointment.startsAt,
    appointment.endsAt,
    appointment.durationMinutes,
    appointment.status,
    appointment.notes,
    appointment.userId,
    appointment.userId
  ];
}

function appointmentUpdateParams(appointment) {
  return [
    appointment.patientId,
    appointment.doctorId,
    appointment.chairId,
    appointment.procedureId,
    appointment.procedureName,
    appointment.startsAt,
    appointment.endsAt,
    appointment.durationMinutes,
    appointment.status,
    appointment.notes,
    appointment.userId
  ];
}

module.exports = {
  createCalendarRepository
};
