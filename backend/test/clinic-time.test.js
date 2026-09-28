const assert = require('node:assert');
const { test } = require('node:test');
const { clinicDateFromInstant } = require('../utils/clinic-time');

test('appointment visits use the clinic date instead of the UTC date', () => {
  assert.equal(clinicDateFromInstant('2026-01-15T23:30:00.000Z'), '2026-01-16');
  assert.equal(clinicDateFromInstant('2026-03-29T00:30:00.000Z'), '2026-03-29');
  assert.equal(clinicDateFromInstant('2026-10-25T00:30:00.000Z'), '2026-10-25');
  assert.throws(() => clinicDateFromInstant('not-a-date'), /valid appointment start/);
});
