const { test } = require('node:test');
const assert = require('node:assert/strict');
const { financialAmount } = require('../db/financial-requests');
const { invoicePaymentSchema, insuranceEraSchema, paymentPartAppendSchema } = require('../validation');

test('financial amounts accept decimal values and reject coercion and database overflow', () => {
  for (const value of [true, false, [], [100], {}, null, undefined, '', ' ', '0x10', '1e2', Infinity, NaN, -1, 10000000000, '9999999999.999']) {
    assert.throws(() => financialAmount(value), { status: 400 }, JSON.stringify(value));
  }
  for (const [value, expected] of [[0, 0], ['0.00', 0], [100, 100], ['100.50', 100.5], [1.005, 1.01], ['9999999999.99', 9999999999.99]]) {
    assert.equal(financialAmount(value), expected);
  }
  for (const value of [0, '0.00', 0.001]) {
    assert.throws(() => financialAmount(value, { positive: true }), { status: 400 });
  }
});

test('financial amounts round decimal ties as NUMERIC(12,2), without binary multiplication drift', () => {
  for (const [input, expected] of [
    [10.075, 10.08], ['10.075', 10.08], [1.005, 1.01], [8.005, 8.01],
    ['1.00499999999999999999', 1], ['0.005', 0.01], [1e-7, 0],
    ['0.0000000000000000001', 0], ['000010.0750', 10.08],
    [9999999999.985, 9999999999.99]
  ]) {
    assert.equal(financialAmount(input), expected, String(input));
    const validated = invoicePaymentSchema.validate({ amount: input });
    if (expected === 0) assert.ok(validated.error, String(input));
    else {
      assert.equal(validated.error, undefined, String(input));
      assert.equal(validated.value.amount, expected, String(input));
    }
    assert.equal(insuranceEraSchema.validate({ paidAmount: input }).value.paidAmount, expected, String(input));
  }
});

test('payment schemas reject invalid amounts, dates and types before writes', () => {
  for (const amount of [true, [100], {}, null, '', '0x10', '1e2', -1, 10000000000]) {
    assert.ok(invoicePaymentSchema.validate({ amount }).error);
    assert.ok(paymentPartAppendSchema.validate({ amount }).error);
    assert.ok(insuranceEraSchema.validate({ paidAmount: amount }).error);
  }
  for (const paymentDate of ['2026-02-30', '2026-13-01', '2026-10-21T12:00:00Z', 'bad']) {
    assert.ok(invoicePaymentSchema.validate({ amount: 10, paymentDate }).error);
    assert.ok(paymentPartAppendSchema.validate({ amount: 10, paymentDate }).error);
  }
  assert.ok(invoicePaymentSchema.validate({ amount: 10, paymentType: 'anything' }).error);
  assert.ok(insuranceEraSchema.validate({}).error);
  assert.ok(insuranceEraSchema.validate({ paidAmount: 0, eventId: 'bad key' }).error);
  assert.equal(invoicePaymentSchema.validate({ amount: '10.50', payment_date: '2026-10-21', payment_type: 'refund' }).value.amount, 10.5);
  assert.equal(insuranceEraSchema.validate({ paid_amount: 0, approved_amount: 0, event_id: 'correction-2' }).error, undefined);
});
