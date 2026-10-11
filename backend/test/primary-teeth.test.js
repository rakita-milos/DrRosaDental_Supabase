const { test } = require('node:test');
const assert = require('node:assert/strict');
const dental = require('../../src/scripts/dental-notation');
const { recordCreateSchema, toothStateWriteSchema, validateBody } = require('../validation');
const { createClinicalRepository } = require('../db/clinical');

test('FDI distinguishes both dentitions and rejects gaps between quadrants', () => {
  assert.equal(dental.typeOf('55'), 'primary');
  assert.equal(dental.typeOf('16'), 'permanent');
  for (const invalid of ['19', '49', '50', '56', '66', '76', '86', '99', 'abc']) assert.equal(dental.isTooth(invalid), false);
});

test('visit write middleware rejects invalid tooth keys instead of silently stripping them', () => {
  const middleware = validateBody(recordCreateSchema);
  const payload = treatments => ({ patient_id:1, doctor_id:1, visit_date:'2026-10-09', procedure:'Test', treatments });
  for (const treatments of [{ '56': [{type:'Test',price:100}] }, {'abc':{type:'Test'}}, [{toothNumber:'66',type:'Test'}]]) {
    let status, next = false;
    const response = { status(value) { status = value; return this; }, json() {} };
    middleware({body:payload(treatments)}, response, () => { next = true; });
    assert.equal(status,400);
    assert.equal(next,false);
  }
  const result = recordCreateSchema.validate(payload({'55':[{type:'Dečji rad',price:2500}], '16':[{type:'Kontrola',price:1000}]}), {stripUnknown:true});
  assert.equal(result.error,undefined);
  assert.deepEqual(Object.keys(result.value.treatments),['16','55']);
});

test('presence validates real dates and permits exfoliation only for primary teeth', () => {
  const event = {toothNumber:'55',presence:'exfoliated',effectiveDate:'2026-10-09'};
  assert.equal(toothStateWriteSchema.validate({events:[event]}).error,undefined);
  for (const invalid of [{...event,toothNumber:'16'}, {...event,effectiveDate:'2026-02-30'}, {...event,presence:'healthy'}, {...event,toothNumber:'56'}]) {
    assert.ok(toothStateWriteSchema.validate({events:[event,invalid]}).error);
  }
});

test('backdated presence does not replace current state and same-day draft changes use the last entry', () => {
  const events = [
    {id:2,toothNumber:'51',presence:'exfoliated',effectiveDate:'2026-02-01',createdAt:'2026-02-01T12:00:00Z'},
    {id:3,toothNumber:'51',presence:'present',effectiveDate:'2026-01-01',createdAt:'2026-03-01T12:00:00Z'}
  ];
  assert.equal(dental.latestStates(events).get('51').presence,'exfoliated');
  assert.equal(dental.latestStates([{toothNumber:'51',presence:'present',effectiveDate:'2026-01-01'},{toothNumber:'51',presence:'exfoliated',effectiveDate:'2026-01-01'}]).get('51').presence,'exfoliated');
});

test('grouped state writes use one query and release the transaction on success or failure', async () => {
  for (const fail of [false, true]) {
    const calls = [];
    let released = false;
    const rows = [{ id: 1, tooth_number: '55', effective_date: '2026-01-01' }];
    const client = { async query(sql, params) {
      calls.push({ sql, params });
      if (params && fail) throw new Error('batch failed');
      return { rows: params ? rows : [] };
    }, release() { released = true; } };
    const repo = createClinicalRepository({ pgPool: { connect: async () => client } });
    const events = ['55', '16'].map(toothNumber => ({ toothNumber, presence: 'present', effectiveDate: '2026-01-01' }));
    if (fail) await assert.rejects(repo.addToothStateEvents(2, events, 3), /batch failed/);
    else assert.deepEqual(await repo.addToothStateEvents(2, events, 3), rows);
    assert.equal(calls.length, 3);
    assert.equal(calls[0].sql, 'BEGIN');
    assert.equal(calls[2].sql, fail ? 'ROLLBACK' : 'COMMIT');
    assert.deepEqual(calls[1].params, [2, '55', 'present', '2026-01-01', '', 3, 2, '16', 'present', '2026-01-01', '', 3]);
    assert.equal(released, true);
  }
});
