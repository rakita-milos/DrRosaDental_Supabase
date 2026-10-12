const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const user = { id: 42, email: 'synthetic@example.test', role: 'staff' };

async function setup(context) {
  let rejected = false;
  const session = { ...user, sessionId: 'synthetic-session',
    idleExpiresAt: new Date(Date.now() + 20 * 60000).toISOString(),
    sessionExpiresAt: new Date(Date.now() + 8 * 3600000).toISOString() };
  await context.addInitScript(value => {
    if (!sessionStorage.getItem('fixture-initialized')) {
      sessionStorage.setItem('fixture-initialized', '1');
      if (!localStorage.getItem('drrosa-session')) localStorage.setItem('drrosa-session', JSON.stringify(value));
    }
  }, session);
  await context.route('http://drrosa.test/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/auth/logout') return route.fulfill({ json: { success: true } });
      if (url.pathname === '/api/auth/login') rejected = false;
      if (url.pathname.startsWith('/api/auth/')) return route.fulfill({
        status: rejected ? 401 : 200,
        json: rejected ? { code: 'SESSION_ENDED' } : { ...session, user, serverTime: new Date().toISOString() },
      });
      return route.fulfill({ json: [] });
    }
    const file = path.resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404 });
    return route.fulfill({ path: file });
  });
  return { reject: () => { rejected = true; } };
}

test('idle deadline warns then opens standard login, discards draft and allows login', async ({ page, context }) => {
  await setup(context);
  await page.clock.install();
  await page.goto('/src/pages/new-patient.html');
  await page.locator('#first-name').fill('Unsaved synthetic draft');
  await page.clock.fastForward(19 * 60000 + 1000);
  await expect(page.locator('#drrosa-session-warning')).toBeVisible();
  await page.clock.fastForward(60000);
  await expect(page).toHaveURL(/login\.html\?reason=session-ended/);
  await expect(page.locator('#error-msg')).toContainText('Sesija je istekla');
  expect(await page.evaluate(() => localStorage.getItem('drrosa-session'))).toBeNull();
  await page.locator('#email').fill(user.email);
  await page.locator('#password').fill('synthetic-password');
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/index\.html/);
  await page.goto('/src/pages/new-patient.html');
  await expect(page.locator('#first-name')).toHaveValue('');
});

test('confirmed server expiration sends both tabs to login', async ({ page, context }) => {
  const api = await setup(context);
  await page.goto('/src/pages/index.html');
  await page.goto('/src/pages/new-patient.html');
  const tab = await context.newPage();
  await tab.goto('/src/pages/new-patient.html');
  api.reject();
  await page.evaluate(() => window.DrRosaApi.verifySession()).catch(error => {
    if (!/Execution context was destroyed/.test(error.message)) throw error;
  });
  await expect(page).toHaveURL(/login\.html/);
  await expect(tab).toHaveURL(/login\.html/);
  await expect(tab.locator('#error-msg')).toContainText('Sesija je istekla');
  await page.goBack();
  await expect(page).toHaveURL(/login\.html/);
});

test('manual logout sends both tabs to login', async ({ page, context }) => {
  await setup(context);
  await page.goto('/src/pages/index.html');
  const tab = await context.newPage();
  await tab.goto('/src/pages/index.html');
  await page.locator('#logout-btn').click();
  await expect(page).toHaveURL(/login\.html/);
  await expect(tab).toHaveURL(/login\.html/);
  expect(await tab.evaluate(() => localStorage.getItem('drrosa-session'))).toBeNull();
});

test('absolute deadline warns then redirects on a narrow screen', async ({ page, context }) => {
  await setup(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install();
  await page.goto('/src/pages/index.html');
  await page.evaluate(() => {
    const session = window.DrRosaApi.getSession();
    session.sessionExpiresAt = new Date(Date.now() + 3000).toISOString();
    localStorage.setItem('drrosa-session', JSON.stringify(session));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
  });
  await expect(page.locator('#drrosa-session-warning')).toContainText('maksimalnog trajanja');
  await page.clock.fastForward(4000);
  await expect(page).toHaveURL(/login\.html/);
  await expect(page.locator('#login-form')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('restored page with removed session redirects to login', async ({ page, context }) => {
  await setup(context);
  await page.goto('/src/pages/index.html');
  await page.evaluate(() => {
    localStorage.removeItem('drrosa-session');
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(page).toHaveURL(/login\.html/);
  await expect(page.locator('#login-form')).toBeVisible();
});
