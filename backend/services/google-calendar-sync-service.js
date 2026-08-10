function createGoogleCalendarSyncService({
  cleanText,
  normalizeIsoDateTime,
  appointmentDurationMinutes
}) {
  function googleEventTimes(event) {
    const startsAt = normalizeIsoDateTime(event?.start?.dateTime);
    const endsAt = normalizeIsoDateTime(event?.end?.dateTime);
    if (!startsAt || !endsAt || appointmentDurationMinutes(startsAt, endsAt) <= 0) return null;
    return { startsAt, endsAt, googleEventType: 'appointment', warning: null, warningCode: null };
  }

  function normalizeGoogleEventText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function isGoogleDoctorAbsenceEvent(event) {
    const text = normalizeGoogleEventText([
      event?.summary,
      event?.description
    ].filter(Boolean).join(' '));
    return /\b(go|godisnji|godisnjem|godisnji odmor|odmor)\b/.test(text);
  }

  function googleEventTimeInfo(event) {
    const timed = googleEventTimes(event);
    if (timed) return timed;

    const startDate = cleanText(event?.start?.date, { max: 20 });
    const endDate = cleanText(event?.end?.date, { max: 20 }) || startDate;
    if (startDate) {
      const startsAt = normalizeIsoDateTime(`${startDate}T00:00:00.000Z`);
      const endsAt = normalizeIsoDateTime(`${endDate}T00:00:00.000Z`) || normalizeIsoDateTime(`${startDate}T23:59:00.000Z`);
      if (isGoogleDoctorAbsenceEvent(event)) {
        return {
          startsAt,
          endsAt: endsAt && new Date(endsAt) > new Date(startsAt) ? endsAt : new Date(new Date(startsAt).getTime() + 24 * 60 * 60000).toISOString(),
          googleEventType: 'doctor_absence',
          warning: null,
          warningCode: null
        };
      }
      return {
        startsAt,
        endsAt: endsAt && new Date(endsAt) > new Date(startsAt) ? endsAt : new Date(new Date(startsAt).getTime() + 24 * 60 * 60000).toISOString(),
        googleEventType: 'google_event',
        warning: 'Google celodnevni dogadjaj je uvezen kao napomena i ne blokira termine.',
        warningCode: 'all_day_event'
      };
    }

    const fallbackStart = new Date();
    fallbackStart.setHours(0, 0, 0, 0);
    return {
      startsAt: fallbackStart.toISOString(),
      endsAt: new Date(fallbackStart.getTime() + 30 * 60000).toISOString(),
      googleEventType: 'google_event',
      warning: 'Google dogadjaj nema validno vreme i zahteva proveru.',
      warningCode: 'invalid_time'
    };
  }

  function googleEventProcedureName(event, fallback) {
    const summary = cleanText(event?.summary, { max: 255 });
    if (!summary) return fallback;
    if (event?.extendedProperties?.private?.drrosaSource === 'drrosa') {
      const [procedure] = summary.split(' - ');
      return cleanText(procedure, { max: 255 }) || fallback;
    }
    return summary;
  }

  function normalizeGoogleChairText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function googleEventChairSearchText(event) {
    return [
      event?.summary,
      event?.description,
      event?.location
    ].map(normalizeGoogleChairText).filter(Boolean).join(' ');
  }

  function chairIdFromGoogleEvent(event, chairs = []) {
    const text = googleEventChairSearchText(event);
    if (!text) return null;

    for (const chair of chairs) {
      const chairName = normalizeGoogleChairText(chair.name);
      if (chairName && text.includes(chairName)) return chair.id;
      const number = String(chair.name || '').match(/\d+/)?.[0];
      if (number && new RegExp(`\\b(?:stolica|chair|s)\\s*${number}\\b`).test(text)) {
        return chair.id;
      }
    }

    return null;
  }

  return {
    googleEventTimes,
    googleEventTimeInfo,
    isGoogleDoctorAbsenceEvent,
    googleEventProcedureName,
    googleEventChairSearchText,
    chairIdFromGoogleEvent
  };
}

module.exports = {
  createGoogleCalendarSyncService
};
