const {
  execute,
  insertReturningId,
  queryMany,
  queryOne,
  withTransaction
} = require('./postgres');
const BLOCKING_STATUSES = ['scheduled', 'confirmed', 'arrived'];

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
      c.name as chair_name
    FROM appointments a
    JOIN patients p ON a.patient_id = p.id
    JOIN doctors d ON a.doctor_id = d.id
    JOIN chairs c ON a.chair_id = c.id
    ${whereClause}
  `;
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
            updated_by = ?, updated_at = now()
        WHERE id = ?
      `, [...appointmentUpdateParams(appointment), id]);
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
        doctors: await queryMany(pool, 'SELECT id, name, specialization FROM doctors ORDER BY name'),
        procedures: await queryMany(pool, "SELECT id, value, label, price FROM codebook_items WHERE type = 'procedure' AND is_active = true ORDER BY sort_order, label")
      };
    },

    publicBookingDoctors(doctorId = null) {
      return doctorId
        ? queryMany(pool, 'SELECT id, name FROM doctors WHERE id = ?', [doctorId])
        : queryMany(pool, 'SELECT id, name FROM doctors ORDER BY name');
    },

    defaultActiveChair() {
      return queryOne(pool, 'SELECT id FROM chairs WHERE is_active = true ORDER BY id LIMIT 1');
    },

    findPatientByEmail(email) {
      return queryOne(pool, 'SELECT * FROM patients WHERE lower(email) = lower(?) LIMIT 1', [email]);
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
               p.first_name || ' ' || p.last_name as patient_name
        FROM calendar_sync_queue q
        LEFT JOIN appointments a ON q.appointment_id = a.id
        LEFT JOIN patients p ON p.id = a.patient_id
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
        UPDATE google_calendar_settings
        SET connected_email = ?, calendar_id = ?, calendar_name = ?,
            client_id = COALESCE(?, client_id),
            client_secret = COALESCE(?, client_secret),
            redirect_uri = COALESCE(?, redirect_uri),
            sync_enabled = ?,
            sync_direction = ?, default_reminder_minutes = ?,
            events_sync_token = CASE WHEN ? THEN NULL ELSE events_sync_token END,
            updated_at = now()
        WHERE id = 1
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
