const assert = require('node:assert');
const { test } = require('node:test');
const { checks, legacyDocumentsCheck, runPreflight } = require('../scripts/preflight-runtime-migration');

test('runtime migration preflight checks every new patient ownership invariant and legacy document reference', async () => {
  assert.equal(checks.length, 5);
  assert.match(checks.map(check => check.sql).join('\n'), /google_event_id/);
  assert.match(checks.map(check => check.sql).join('\n'), /patient_documents/);
  assert.match(checks.map(check => check.sql).join('\n'), /insurance_claims/);
  assert.match(legacyDocumentsCheck.sql, /file_path NOT LIKE 'supabase:%'/);

  const queried = [];
  const report = await runPreflight({
    query: async sql => {
      queried.push(sql);
      return { rows: sql === legacyDocumentsCheck.sql ? [{ id: 7 }] : [] };
    }
  });
  assert.equal(queried.length, 6);
  assert.deepEqual(report.failures, []);
  assert.deepEqual(report.legacyDocuments, [{ id: 7 }]);
});
