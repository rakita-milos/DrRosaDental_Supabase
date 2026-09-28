const CLINIC_TIME_ZONE = 'Europe/Belgrade';

function clinicDateFromInstant(value) {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error('A valid appointment start time is required.');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CLINIC_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(instant);
  const fields = Object.fromEntries(parts.filter(part => ['year', 'month', 'day'].includes(part.type)).map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

module.exports = { CLINIC_TIME_ZONE, clinicDateFromInstant };
