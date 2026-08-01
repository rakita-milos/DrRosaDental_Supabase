function appointmentDurationMinutes(startsAt, endsAt) {
  return Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000);
}

function boundedAppointmentDuration(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration)) return 30;
  return Math.max(5, Math.min(480, duration));
}

function isAppointmentOverlapConstraintError(error) {
  return error?.code === '23P01'
    && ['appointments_doctor_no_overlap', 'appointments_chair_no_overlap', 'appointments_runtime_no_overlap'].includes(error.constraint);
}

function sendAppointmentConflictError(res) {
  return res.status(409).json({ error: 'Termin se preklapa sa postojecim zakazivanjem.' });
}

function createAppointmentService({
  calendarRepo,
  procedureByInput,
  activeDoctorExists,
  positiveInteger,
  validatedText,
  normalizeIsoDateTime,
  normalizeAppointmentStatus
}) {
  async function payloadFromInput(data, { validatePatient = true, validateChair = true } = {}) {
    const patientId = positiveInteger(data.patient_id ?? data.patientId);
    const doctorId = positiveInteger(data.doctor_id ?? data.doctorId);
    const chairId = positiveInteger(data.chair_id ?? data.chairId);
    const procedureIdInput = positiveInteger(data.procedure_id ?? data.procedureId);
    const procedure = await procedureByInput({
      procedureId: procedureIdInput,
      procedureName: data.procedure_name ?? data.procedureName
    });
    const procedureNameResult = validatedText(data.procedure_name ?? data.procedureName ?? procedure?.label, { field: 'Postupak', max: 255, required: true });
    const notesResult = validatedText(data.notes, { field: 'Napomena', max: 2000 });
    const textError = procedureNameResult.error || notesResult.error;
    if (textError) return { status: 400, error: textError };

    const procedureName = procedureNameResult.value;
    const startsAt = normalizeIsoDateTime(data.starts_at ?? data.startsAt);
    const durationMinutesInput = boundedAppointmentDuration(data.duration_minutes ?? data.durationMinutes ?? 30);
    const endsAt = normalizeIsoDateTime(data.ends_at ?? data.endsAt) ||
      (startsAt ? new Date(new Date(startsAt).getTime() + durationMinutesInput * 60000).toISOString() : null);
    const status = normalizeAppointmentStatus(data.status);
    const notes = notesResult.value;

    if (!patientId || !doctorId || !chairId || !procedure || !procedureName || !startsAt || !endsAt) {
      return { status: 400, error: 'Pacijent, doktor, stolica, datum i postupak su obavezni.' };
    }
    if (appointmentDurationMinutes(startsAt, endsAt) <= 0) {
      return { status: 400, error: 'End time must be after start time' };
    }
    if (validatePatient && !(await calendarRepo.rowExists('patients', patientId))) {
      return { status: 404, error: 'Patient not found' };
    }
    if (!(await activeDoctorExists(doctorId))) {
      return { status: 404, error: 'Doctor not found' };
    }
    if (validateChair && !(await calendarRepo.rowExists('chairs', chairId))) {
      return { status: 404, error: 'Chair not found' };
    }

    return {
      value: {
        patientId,
        doctorId,
        chairId,
        procedureId: procedure.id,
        procedureName,
        startsAt,
        endsAt,
        durationMinutes: appointmentDurationMinutes(startsAt, endsAt),
        status,
        notes
      }
    };
  }

  function conflict({ appointmentId = null, doctorId, chairId, startsAt, endsAt }) {
    return calendarRepo.appointmentConflict({ appointmentId, doctorId, chairId, startsAt, endsAt });
  }

  return {
    payloadFromInput,
    conflict
  };
}

module.exports = {
  createAppointmentService,
  appointmentDurationMinutes,
  boundedAppointmentDuration,
  isAppointmentOverlapConstraintError,
  sendAppointmentConflictError
};
