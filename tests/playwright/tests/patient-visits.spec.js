const { test, expect } = require('@playwright/test');
const { authenticate } = require('../utils/auth');
const { createPatient, createRecord, firstDoctorId, apiGet } = require('../utils/api');
const { cleanupRegressionData } = require('../utils/cleanup');

const prefix = 'VisitsHistoryE2E';
test.afterEach(async ({ request, baseURL }) => {
  await cleanupRegressionData(request, baseURL, [prefix]);
});

for (const mobile of [false, true]) {
  test(`Posete: 52 visits, full-history filters and persisted details (${mobile ? 'phone' : 'desktop'})`, async ({ page, request, baseURL }) => {
    test.setTimeout(180000);
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const patient = await createPatient(request, baseURL, { firstName: `${prefix}${Date.now()}`, lastName: 'Synthetic', email: `visits.${Date.now()}@example.com` });
    const doctorId = await firstDoctorId(request, baseURL);
    const visits = [];
    for (let i = 0; i < 52; i++) {
      const visitDate = new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10);
      visits.push(await createRecord(request, baseURL, { patientId: patient.id, doctorId, visitDate, currency: 'RSD', amount: 300,
        procedure: i === 0 ? 'Najstariji postupak' : 'Kontrola', note: `Napomena broj ${i}`,
        treatments: { 11: [{ type: 'Kontrola', note: `Detalji ${i}`, price: 100 }], 12: [{ type: 'Kontrola', note: `Detalji ${i}`, price: 100 }],
          13: [{ type: 'Kontrola', note: i === 0 ? 'Istorijski detalj <script>unsafe</script>' : 'Različiti detalji', price: 100 }] } }));
    }
    await authenticate(page);
    await page.goto(`/src/pages/patient-dashboard.html?patientId=${patient.id}`);
    const tab = page.locator('[data-patient-group="visits"]');
    await expect(tab).toHaveText('Posete (52)');
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    const cards = page.locator('.patient-visit');
    const opened = page.locator('.visit-detail:visible');
    await expect(cards).toHaveCount(10);
    await expect(opened).toHaveCount(1);
    await expect(opened).toContainText('Napomena broj 51');
    await expect(opened.locator('.visit-work')).toHaveCount(2);
    await expect(opened.locator('.visit-work').first()).toContainText('11, 12');
    await expect(opened.locator('.visit-note')).toHaveCount(1);
    await cards.nth(1).getByRole('button', { name: 'Otvori', exact: true }).click();
    await expect(opened).toHaveCount(1);
    await expect(opened).toContainText('Napomena broj 50');
    await page.locator('#visits-next').click();
    await expect(page.locator('#visits-page')).toHaveText('Strana 2 / 6');
    await expect(opened).toContainText('Napomena broj 41');
    await page.locator('#visits-search').fill('Najstariji postupak');
    await expect(cards).toHaveCount(1);
    await expect(opened).toContainText('Napomena broj 0');
    await page.locator('#visits-search').fill('Istorijski detalj');
    await expect(cards).toHaveCount(1);
    await expect(opened).toContainText('unsafe');
    expect(await page.locator('#patient-visits-list script').count()).toBe(0);
    await page.locator('#visits-search').fill('Napomena broj 0');
    await expect(cards).toHaveCount(1);
    await page.locator('#visits-reset').click();
    await page.locator('#visits-tooth').selectOption('13', { force: true });
    await page.locator('[data-drrosa-for="visits-from"]').fill('01.01.2026');
    await page.locator('[data-drrosa-for="visits-from"]').press('Tab');
    await page.locator('[data-drrosa-for="visits-to"]').fill('02.01.2026');
    await page.locator('[data-drrosa-for="visits-to"]').press('Tab');
    await expect(cards).toHaveCount(2);
    await page.locator('#visits-search').fill('nepostojeći postupak');
    await expect(cards).toHaveCount(0);
    await expect(page.locator('#visits-next')).toBeDisabled();
    await page.locator('#visits-reset').click();
    for (let i = 0; i < 5; i++) await page.locator('#visits-next').click();
    await expect(cards).toHaveCount(2);
    await expect(page.locator('#visits-next')).toBeDisabled();
    await page.locator('#visits-reset').click();
    await opened.getByRole('link', { name: 'Uredi posetu' }).click();
    await expect(page.locator('#note')).toHaveValue('Napomena broj 51');
    await expect(page.getByText('Napomena posete', { exact: true })).toBeVisible();
    const savedDetail = page.locator('.saved-treatment-note[data-tooth="11"]');
    await savedDetail.fill('Izmenjeni detalji bez dupliranja');
    await page.locator('.tooth-node[data-tooth="21"]').click();
    await page.locator('#treatment-activity').selectOption({ index: 1 }, { force: true });
    await page.locator('#treatment-type').selectOption({ index: 1 }, { force: true });
    await page.locator('#treatment-note').fill('Detalji pre dodavanja');
    await page.locator('#add-treatment-item').click();
    await page.locator('.pending-treatment-note').fill('Detalji nakon dodavanja');
    await page.locator('#save-treatment').click();
    const updated = page.waitForResponse(response => response.url().includes('/api/records/') && response.request().method() === 'PUT');
    await page.getByRole('button', { name: /Sa.uvaj unos/i }).click();
    expect((await updated).ok()).toBeTruthy();
    await expect(page).toHaveURL(/patient-dashboard\.html/);
    const record = await apiGet(request, baseURL, `/api/records/${visits[51].id}`);
    expect(record.treatments['11']).toHaveLength(1);
    expect(record.treatments['11'][0].note).toBe('Izmenjeni detalji bez dupliranja');
    expect(record.treatments['12'][0].note).toBe('Detalji 51');
    expect(record.treatments['21'][0].note).toBe('Detalji nakon dodavanja');
    expect(record.generalTreatments).toHaveLength(0);
    expect(record.notes).toBe('Napomena broj 51');
    await expect(opened).toContainText('Izmenjeni detalji bez dupliranja');
    await expect(opened).toContainText('Detalji nakon dodavanja');
    await expect(opened.locator('.visit-work')).toHaveCount(4);
    await expect(page.locator('#visit-notes-card')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/visits-${mobile ? 'phone' : 'desktop'}.png`, fullPage: true });
    await page.locator('#patient-clinical-section').screenshot({ path: `test-results/visits-${mobile ? 'phone' : 'desktop'}-tab.png` });
    await cards.first().screenshot({ path: `test-results/visits-${mobile ? 'phone' : 'desktop'}-detail.png` });
  });
}
