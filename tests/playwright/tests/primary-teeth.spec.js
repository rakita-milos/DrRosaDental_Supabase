const { test, expect } = require('@playwright/test');
const { authenticate, tokenFor, credentialsFor } = require('../utils/auth');
const { createPatient, apiGet, apiPost, apiPut, firstDoctorId, createRecord, createAppointment } = require('../utils/api');
const { cleanupRegressionData } = require('../utils/cleanup');
const PREFIX = 'E2EPrimaryTeeth';

test.afterEach(async ({ request, baseURL }) => cleanupRegressionData(request, baseURL, [PREFIX]));
async function patientFor(request, baseURL) {
  return createPatient(request, baseURL, { firstName: `${PREFIX}${Date.now()}`, lastName: 'Dete', birthDate: '2019-05-08', email: `primary.${Date.now()}@example.com` });
}
async function begin(page, patient) {
  await authenticate(page, 'director');
  await page.goto(`/src/pages/new-entry.html?patientId=${patient.id}`);
  await expect(page.locator('#doctor option')).not.toHaveCount(0);
}
async function fillWork(page, tooth, detail) {
  await page.locator(`.tooth-node[data-tooth="${tooth}"]`).click();
  await page.locator('#treatment-activity').selectOption('Decja stomatologija');
  await page.locator('#treatment-type').selectOption('Plomba na mlecnom zubu I klasa');
  await page.locator('#treatment-note').fill(detail);
}

test('primary map, guarded switching, mixed visit, payments and persisted edit', async ({ page, request, baseURL }) => {
  const patient = await patientFor(request, baseURL);
  await begin(page, patient);
  const map = page.locator('#entry-tooth-map');
  await map.getByRole('tab', { name: 'Mlečni zubi' }).click();
  await expect(map.locator('[data-dentition-panel="primary"] .tooth-node')).toHaveCount(20);
  const upperRight = await map.locator('[data-tooth="51"]').boundingBox();
  const upperLeft = await map.locator('[data-tooth="61"]').boundingBox();
  const lowerRight = await map.locator('[data-tooth="81"]').boundingBox();
  const lowerLeft = await map.locator('[data-tooth="71"]').boundingBox();
  expect(upperRight.x).toBeLessThan(upperLeft.x);
  expect(lowerRight.x).toBeLessThan(lowerLeft.x);
  await fillWork(page, '55', 'Rad na mlečnom 55');
  await map.getByRole('tab', { name: 'Stalni zubi' }).click();
  await expect(page.locator('#dentition-switch-notice')).toBeVisible();
  await page.locator('#dentition-switch-cancel').click();
  await expect(page.locator('#treatment-note')).toHaveValue('Rad na mlečnom 55');
  await map.getByRole('tab', { name: 'Stalni zubi' }).click();
  await page.locator('#dentition-switch-save').click();
  await expect(map.getByRole('tab', { name: 'Stalni zubi' })).toHaveAttribute('aria-selected','true');
  await expect(map.locator('.selected')).toHaveCount(0);
  await expect(page.locator('#teeth-summary')).toContainText('Rad na mlečnom 55');
  await fillWork(page, '16', 'Rad na stalnom 16');
  await page.locator('#save-treatment').click();
  await expect(page.locator('#total-amount')).toHaveValue('5000.00');
  await page.locator('#doctor').selectOption({ index: 0 });
  const visitDate = await page.locator('#last-visit').inputValue();
  const post = page.waitForResponse(r => r.url().endsWith('/api/records') && r.request().method() === 'POST');
  await page.getByRole('button', { name: /Sa.uvaj unos/i }).click();
  const response = await post;
  expect(response.status()).toBe(201);
  await expect(page).toHaveURL(/patient-dashboard/);
  const records = (await apiGet(request, baseURL, '/api/records')).filter(item => Number(item.patient_id) === Number(patient.id));
  expect(records).toHaveLength(1);
  const id = records[0].id;
  const saved = await apiGet(request, baseURL, `/api/records/${id}`);
  expect(saved.visit_date).toBe(visitDate);
  expect(saved.treatments['55'][0]).toMatchObject({ note: 'Rad na mlečnom 55', price: 2500 });
  expect(saved.treatments['16'][0]).toMatchObject({ note: 'Rad na stalnom 16', price: 2500 });
  expect(Number(saved.amount_due)).toBe(5000);
  await page.locator('[data-patient-group="teeth"]').first().click();
  const editor = page.locator('#patient-initial-condition-editor');
  await editor.getByRole('tab', { name: 'Mlečni zubi' }).click();
  await expect(editor.locator('.tooth-details')).toContainText('Rad na mlečnom 55');
  await expect(editor.locator('.tooth-details')).not.toContainText('Rad na stalnom 16');
  await editor.locator('[data-tooth="55"]').click();
  await editor.locator('.tooth-presence').selectOption('exfoliated');
  await editor.locator('.tooth-state-note').fill('Prirodna smena');
  await editor.locator('.tooth-state-save').click();
  await expect(editor.locator('.condition-message')).toContainText('Stanje je evidentirano');
  await page.reload();
  await page.locator('[data-patient-group="teeth"]').first().click();
  await editor.getByRole('tab', { name: 'Mlečni zubi' }).click();
  await expect(editor.locator('[data-tooth="55"]')).toHaveAttribute('data-presence','exfoliated');
  await expect(editor.locator('.tooth-details')).toContainText('Rad na mlečnom 55');
  const unchanged = await apiGet(request, baseURL, `/api/records/${id}`);
  expect(unchanged.amount_due).toBe(saved.amount_due);
  expect(unchanged.treatments).toEqual(saved.treatments);
  await page.screenshot({ path: 'test-results/primary-teeth-desktop.png', fullPage: true });
  await page.goto(`/src/pages/new-entry.html?record=${id}&patientId=${patient.id}`);
  await expect(page.locator('#teeth-summary')).toContainText('Rad na mlečnom 55');
  await page.locator('.saved-treatment-note[data-tooth="55"]').fill('Izmenjen detalj 55');
  const put = page.waitForResponse(r => r.url().endsWith(`/api/records/${id}`) && r.request().method() === 'PUT');
  await page.getByRole('button', { name: /Sa.uvaj unos/i }).click();
  expect((await put).ok()).toBeTruthy();
  const edited = await apiGet(request, baseURL, `/api/records/${id}`);
  expect(edited.treatments['55']).toHaveLength(1);
  expect(edited.treatments['55'][0].note).toBe('Izmenjen detalj 55');
  expect(edited.treatments['16']).toEqual(saved.treatments['16']);
  expect(Number(edited.amount_due)).toBe(5000);
  await page.locator('#visits-dentition').selectOption('primary');
  await expect(page.locator('#patient-visits-list')).toContainText('55');
  await expect(page.locator('#patient-visits-list')).toContainText('16');
  await page.locator('#visits-dentition').selectOption('permanent');
  await expect(page.locator('#patient-visits-list')).toContainText('Izmenjen detalj 55');
});

test('state history is append-only, date ordered and validates FDI and authentication', async ({ request, baseURL }) => {
  const patient = await patientFor(request, baseURL);
  const endpoint = `/api/patients/${patient.id}/tooth-states`;
  const event = { toothNumber: '51', presence: 'present', effectiveDate: '2026-01-01', notes: 'Početno stanje' };
  const created = await apiPost(request, baseURL, endpoint, { events: [event] }, 'director', 201);
  expect(created[0]).toMatchObject(event);
  expect(created[0].recordedBy).toBeTruthy();
  await apiPost(request, baseURL, endpoint, { events: [{...event, presence:'exfoliated', effectiveDate:'2026-02-01'}] }, 'director', 201);
  await apiPost(request, baseURL, endpoint, { events: [{...event, effectiveDate:'2025-12-01'}] }, 'director', 201);
  const history = await apiGet(request, baseURL, endpoint, 'director');
  expect(history).toHaveLength(3);
  expect(history[0].presence).toBe('exfoliated');
  for (const invalid of [{...event, toothNumber:'56'}, {...event,toothNumber:'11',presence:'exfoliated'}, {...event,effectiveDate:'2026-02-30'}, {...event,effectiveDate:'2099-01-01'}]) {
    const response = await request.post(baseURL+endpoint,{ headers:{Authorization:`Bearer ${tokenFor('director')}`}, data:{events:[invalid]} });
    expect(response.status()).toBe(400);
  }
  expect((await request.get(baseURL+endpoint)).status()).toBe(401);
  const staffSession = await apiPost(request, baseURL, '/api/auth/verify', {}, 'staff', 200);
  const originalPermissions = staffSession.user.permissions;
  const permissionEndpoint = `${baseURL}/api/director/security/users/${staffSession.user.id}/permissions`;
  const permissionHeaders = {
    Authorization: `Bearer ${tokenFor('director')}`,
    'x-drrosa-director-password': credentialsFor('director').password
  };
  try {
    const restricted = await request.put(permissionEndpoint, {
      headers: permissionHeaders,
      data: { permissions: originalPermissions.filter(permission => permission !== 'clinical:write' && permission !== '*') }
    });
    expect(restricted.status()).toBe(200);
    const denied = await request.post(baseURL+endpoint,{ headers:{Authorization:`Bearer ${tokenFor('staff')}`}, data:{events:[event]} });
    expect(denied.status()).toBe(403);
  } finally {
    const restored = await request.put(permissionEndpoint, { headers: permissionHeaders, data: { permissions: originalPermissions } });
    expect(restored.status()).toBe(200);
  }
  expect((await apiGet(request, baseURL, endpoint, 'director'))).toHaveLength(3);
  const batch = await request.post(baseURL+endpoint, { headers:{Authorization:`Bearer ${tokenFor('director')}`}, data:{events:[event,{...event,toothNumber:'56'}]} });
  expect(batch.status()).toBe(400);
  expect((await apiGet(request, baseURL, endpoint, 'director'))).toHaveLength(3);
  const deletion = await request.delete(`${baseURL}/api/patients/${patient.id}`, {headers:{Authorization:`Bearer ${tokenFor('director')}`}});
  expect(deletion.status()).toBe(409);
  expect((await deletion.json()).related.toothStateEvents).toBe(3);
  const legal = await request.get(`${baseURL}/api/director/legal-export`,{headers:{Authorization:`Bearer ${tokenFor('director')}`,'x-drrosa-director-password':credentialsFor('director').password}});
  expect(legal.ok()).toBeTruthy();
  const exported = await legal.json();
  expect(exported.toothStates.filter(row => row.patient_id === patient.id)).toHaveLength(3);
  expect(exported.toothStates.find(row => row.id === created[0].id).effective_date).toBe(event.effectiveDate);
  const doctor = await firstDoctorId(request, baseURL);
  const invalidRecord = await request.post(`${baseURL}/api/records`,{ headers:{Authorization:`Bearer ${tokenFor()}`}, data:{patient_id:patient.id,doctor_id:doctor,visit_date:'2026-01-01',procedure:'Test',treatments:{'56':[{type:'Test',price:100}]}} });
  expect(invalidRecord.status()).toBe(400);
  expect((await apiGet(request,baseURL,'/api/records')).filter(item => Number(item.patient_id) === Number(patient.id))).toHaveLength(0);
});

test('mixed visit discounts and split payments survive legacy-label editing without accepting new invalid labels', async ({ request, baseURL }) => {
  const patient = await patientFor(request, baseURL);
  const doctorId = await firstDoctorId(request, baseURL);
  const created = await apiPost(request, baseURL, '/api/records', {
    patient_id:patient.id,doctor_id:doctorId,visit_date:'2026-10-01',procedure:'Mešovita poseta',currency:'RSD',total_amount:4750,amount:2750,
    treatments:{'55':[{type:'Plomba',price:2500,discount:250,discountType:'percent',discountValue:10}], '16':[{type:'Plomba',price:2500}]},
    paymentParts:[{amount:1000,currency:'RSD',paymentDate:'2026-10-01'}, {amount:1000,currency:'RSD',paymentDate:'2026-10-02'}]
  },'staff',201);
  const record = await apiGet(request,baseURL,`/api/records/${created.id}`);
  expect(record.total_amount).toBe(4750);
  expect(Number(record.amount_due)).toBe(2750);
  expect(record.amount_paid).toBe(2000);
  expect(record.paymentParts).toHaveLength(2);
  expect(record.treatments['55'][0]).toMatchObject({discount:250,discountType:'percent',discountValue:10});
  // Only the disposable local database is used to model an old free-text label.
  const { Pool } = require('pg');
  const { requireTestDatabaseUrl, assertSafeTestDatabase } = require('../utils/test-database-safety');
  const databaseUrl = requireTestDatabaseUrl(process.env);
  assertSafeTestDatabase({databaseUrl,env:process.env});
  const pool = new Pool({connectionString:databaseUrl,ssl:false,options:'-c search_path=app,public'});
  try { await pool.query('UPDATE treatments SET tooth_number=$1 WHERE visit_record_id=$2 AND tooth_number=$3',['ranije-55',created.id,'55']); }
  finally { await pool.end(); }
  const legacy = await apiGet(request,baseURL,`/api/records/${created.id}`);
  const edited = await apiPut(request,baseURL,`/api/records/${created.id}`,{procedure:'Dopunjena poseta',treatments:legacy.treatments});
  expect(edited).toBeTruthy();
  const unchanged = await apiGet(request,baseURL,`/api/records/${created.id}`);
  expect(unchanged.treatments['ranije-55']).toEqual(legacy.treatments['ranije-55']);
  expect(unchanged.paymentParts).toEqual(record.paymentParts);
  expect(Number(unchanged.amount_due)).toBe(2750);
  const rejected = await request.put(`${baseURL}/api/records/${created.id}`,{headers:{Authorization:`Bearer ${tokenFor()}`},data:{procedure:'Ne sme se sačuvati',treatments:{...legacy.treatments,'56':[{type:'Test',price:100}]}}});
  expect(rejected.status()).toBe(400);
  expect((await apiGet(request,baseURL,`/api/records/${created.id}`)).procedure).toBe('Dopunjena poseta');
});

test('new patient can record primary initial condition and status on a phone', async ({ page, request, baseURL }) => {
  await page.setViewportSize({width:390,height:844});
  await authenticate(page, 'director');
  await page.goto('/src/pages/new-patient.html');
  const firstName = `${PREFIX}${Date.now()}`;
  await page.locator('#first-name').fill(firstName);
  await page.locator('#last-name').fill('Novi');
  await page.locator('#birth-date').evaluate(el => { el.value = '2020-01-01'; });
  await page.locator('#toggle-patient-extra-fields').click();
  const editor = page.locator('#initial-condition-editor');
  await editor.getByRole('tab',{name:'Mlečni zubi'}).click();
  const originalMap = await editor.locator('svg').first().elementHandle();
  await editor.locator('[data-tooth="65"]').click();
  expect(await editor.locator('.dentition-panel:not([hidden])').evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await editor.locator('.condition-notes').fill('Stara plomba');
  await editor.locator('.condition-add-btn').click();
  await editor.locator('[data-tooth="65"]').click();
  await editor.locator('.tooth-presence').selectOption('present');
  await editor.locator('.tooth-state-save').click();
  expect(await originalMap.evaluate(el => el.isConnected)).toBe(true);
  expect(await editor.locator('.dentition-panel:not([hidden])').evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await page.screenshot({path:'test-results/primary-teeth-phone.png',fullPage:true});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const post = page.waitForResponse(r => r.url().endsWith('/api/patients') && r.request().method()==='POST');
  await page.getByRole('button',{name:/Sa.uvaj pacijenta/i}).click();
  const response = await post;
  expect(response.status()).toBe(201);
  await expect(page).toHaveURL(/new-entry/);
  const patients = await apiGet(request,baseURL,'/api/patients');
  const patient = patients.find(item => item.first_name === firstName || item.firstName === firstName);
  expect(patient).toBeTruthy();
  const entries = await apiGet(request,baseURL,`/api/patients/${patient.id}/clinical-chart`, 'director');
  expect(entries).toEqual(expect.arrayContaining([expect.objectContaining({toothNumber:'65',notes:'Stara plomba',price:0})]));
  const states = await apiGet(request,baseURL,`/api/patients/${patient.id}/tooth-states`, 'director');
  expect(states).toEqual(expect.arrayContaining([expect.objectContaining({toothNumber:'65',presence:'present'})]));
});

test('partial patient save supports persisted edits, deletion and retry without duplicating the patient', async ({ page, request, baseURL }) => {
  await authenticate(page, 'director');
  page.on('dialog', dialog => dialog.dismiss());
  await page.goto('/src/pages/new-patient.html');
  const firstName = `${PREFIX}Retry${Date.now()}`;
  await page.locator('#first-name').fill(firstName);
  await page.locator('#last-name').fill('Retry');
  await page.locator('#toggle-patient-extra-fields').click();
  const editor = page.locator('#initial-condition-editor');
  await editor.locator('[data-tooth="11"]').click();
  await editor.locator('.condition-notes').fill('Original condition');
  await editor.locator('.condition-add-btn').click();
  await editor.locator('[data-tooth="11"]').click();
  await editor.locator('.tooth-presence').selectOption('present');
  await editor.locator('.tooth-state-save').click();
  await page.route('**/api/patients/*/tooth-states', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Simulated state save failure' }) }), { times: 1 });
  const failed = page.waitForResponse(r => r.url().includes('/tooth-states') && r.status() === 503);
  await page.locator('#patient-form button[type="submit"]').click();
  await failed;
  await expect(page.locator('#patient-form')).not.toHaveAttribute('data-drrosa-busy', '1');
  const patients = await apiGet(request, baseURL, '/api/patients');
  const patient = patients.find(p => p.first_name === firstName);
  expect(patient).toBeTruthy();
  const endpoint = `/api/patients/${patient.id}/clinical-chart`;
  expect(await apiGet(request, baseURL, endpoint, 'director')).toHaveLength(1);
  await editor.locator('.condition-edit-btn').click();
  await editor.locator('.condition-notes').fill('Edited after partial save');
  await editor.locator('.condition-add-btn').click();
  await expect.poll(async () => (await apiGet(request, baseURL, endpoint, 'director'))[0]?.notes).toBe('Edited after partial save');
  await editor.locator('.condition-remove-btn').click();
  await expect.poll(async () => (await apiGet(request, baseURL, endpoint, 'director')).length).toBe(0);
  await editor.locator('[data-tooth="11"]').click();
  await editor.locator('.condition-notes').fill('Replacement condition');
  await editor.locator('.condition-add-btn').click();
  await expect(editor.locator('.condition-list')).toContainText('Replacement condition');
  await page.locator('#patient-form button[type="submit"]').click();
  await expect(page).toHaveURL(/new-entry/);
  expect((await apiGet(request, baseURL, '/api/patients')).filter(p => p.first_name === firstName)).toHaveLength(1);
  const entries = await apiGet(request, baseURL, endpoint, 'director');
  expect(entries).toHaveLength(1);
  expect(entries[0].notes).toBe('Replacement condition');
  const states = await apiGet(request, baseURL, `/api/patients/${patient.id}/tooth-states`, 'director');
  expect(states).toHaveLength(1);
  expect(states[0]).toMatchObject({ toothNumber: '11', presence: 'present' });
});

test('calendar opens a linked visit and reuses it on subsequent navigation', async ({ page, request, baseURL }) => {
  const patient = await patientFor(request, baseURL);
  await authenticate(page, 'director');
  await page.goto('/src/pages/calendar.html');
  await page.locator('#calendar-view').selectOption('day');
  await page.locator('#today-btn').click();
  const date = await page.locator('.day-chair-board').getAttribute('data-date');
  const appointment = await createAppointment(request, baseURL, {
    patientId: patient.id, startsAt: new Date(`${date}T10:15:00`).toISOString(),
    durationMinutes: 30, note: PREFIX
  }, 'director');
  await page.reload();
  await page.locator(`[data-appointment-id="${appointment.id}"]`).first().click();
  const create = page.waitForResponse(r => r.url().endsWith(`/appointments/${appointment.id}/create-visit`));
  await page.locator('[data-open-appointment-visit]').click();
  const response = await create;
  expect(response.status()).toBe(201);
  await expect(page).toHaveURL(/new-entry\.html\?record=\d+/);
  const records = (await apiGet(request, baseURL, '/api/records')).filter(r => Number(r.patient_id) === patient.id);
  expect(records).toHaveLength(1);
  const visitId = records[0].id;
  await expect(page).toHaveURL(new RegExp(`record=${visitId}`));
  await expect(page.locator('#patient-name')).toHaveValue(`${patient.first_name} ${patient.last_name}`);
  await page.goto('/src/pages/calendar.html');
  await page.locator(`[data-appointment-id="${appointment.id}"]`).first().click();
  await expect(page.locator('#create-visit-btn')).toBeDisabled();
  await expect(page.locator('[data-open-appointment-visit]')).toHaveCount(0);
  await page.locator('#appointment-clinical-links').getByRole('link', { name: 'Otvori posetu' }).click();
  await expect(page).toHaveURL(new RegExp(`record=${visitId}`));
  expect((await apiGet(request, baseURL, '/api/records')).filter(r => Number(r.patient_id) === patient.id)).toHaveLength(1);
});

test('historical extraction is distinct from explicit state in both maps and history has one heading', async ({ page, request, baseURL }) => {
  const patient = await patientFor(request, baseURL);
  await createRecord(request, baseURL, { patientId: patient.id, treatments: { '55': [{ type: 'Vađenje mlečnog zuba', price: 1000 }] } });
  await begin(page, patient);
  await page.getByRole('tab', { name: 'Mlečni zubi' }).click();
  await expect(page.locator('[data-tooth="55"]')).toHaveAttribute('data-extraction-history', 'true');
  await expect(page.locator('[data-tooth="55"] .tooth-surface')).toHaveCSS('stroke', 'rgb(180, 83, 9)');
  await expect(page.locator('[data-tooth="55"]')).toHaveAttribute('data-presence', 'unknown');
  await page.goto(`/src/pages/patient-dashboard.html?patientId=${patient.id}`);
  await page.locator('[data-patient-group="teeth"]').first().click();
  const editor = page.locator('#patient-initial-condition-editor');
  await editor.getByRole('tab', { name: 'Mlečni zubi' }).click();
  await expect(editor.locator('[data-tooth="55"]')).toHaveAttribute('data-extraction-history', 'true');
  await expect(editor.locator('.tooth-details').getByRole('heading', { name: 'Mlečni zubi', exact: true })).toHaveCount(0);
  await apiPost(request, baseURL, `/api/patients/${patient.id}/tooth-states`, { events: [{ toothNumber: '55', presence: 'present', effectiveDate: '2026-01-01' }] }, 'director', 201);
  await page.reload();
  await page.locator('[data-patient-group="teeth"]').first().click();
  await editor.getByRole('tab', { name: 'Mlečni zubi' }).click();
  await expect(editor.locator('[data-tooth="55"]')).toHaveAttribute('data-extraction-history', 'false');
  await expect(editor.locator('[data-tooth="55"]')).toHaveAttribute('data-presence', 'present');
  await expect(editor.locator('[data-tooth="55"] .tooth-surface')).toHaveCSS('stroke', 'rgb(21, 128, 61)');
});

test('grouped state writes persist all teeth and roll back the entire batch on a database constraint failure', async ({ request, baseURL }) => {
  const patient = await patientFor(request, baseURL);
  const dental = require('../../../src/scripts/dental-notation');
  const events = dental.rows.primary.flat().map(toothNumber => ({ toothNumber, presence: 'present', effectiveDate: '2026-01-01', notes: `State ${toothNumber}` }));
  const endpoint = `/api/patients/${patient.id}/tooth-states`;
  const saved = await apiPost(request, baseURL, endpoint, { events }, 'director', 201);
  expect(saved).toHaveLength(20);
  for (const event of events) expect(saved.find(row => row.toothNumber === event.toothNumber)).toMatchObject({ ...event, recordedByName: expect.any(String) });
  expect(new Set(saved.map(row => row.id)).size).toBe(20);
  const { Pool } = require('pg');
  const { createClinicalRepository } = require('../../../backend/db/clinical');
  const { requireTestDatabaseUrl, assertSafeTestDatabase } = require('../utils/test-database-safety');
  const connectionString = requireTestDatabaseUrl(process.env);
  assertSafeTestDatabase({ databaseUrl: connectionString, env: process.env });
  const pool = new Pool({ connectionString, ssl: false, options: '-c search_path=app,public' });
  try {
    const repo = createClinicalRepository({ pgPool: pool });
    await expect(repo.addToothStateEvents(patient.id, [events[0], { ...events[1], toothNumber: '56' }], saved[0].recordedBy)).rejects.toThrow();
  } finally { await pool.end(); }
  const history = await apiGet(request, baseURL, endpoint, 'director');
  expect(history).toHaveLength(20);
  expect(history.map(row => row.id).sort((a,b) => a-b)).toEqual(saved.map(row => row.id).sort((a,b) => a-b));
});
