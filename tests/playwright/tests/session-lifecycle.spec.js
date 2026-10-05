const { test, expect } = require('@playwright/test');
const { Pool } = require('pg');
const { assertSafeTestDatabase, requireTestDatabaseUrl } = require('../utils/test-database-safety');

let pool;
test.beforeAll(() => {
  const databaseUrl = requireTestDatabaseUrl(process.env);
  assertSafeTestDatabase({databaseUrl, env:process.env});
  pool = new Pool({connectionString:databaseUrl,ssl:false,options:'-c search_path=app,public'});
});
test.afterAll(async()=>{await pool.end();});

async function signIn(page, role='staff') {
  await page.goto('/src/pages/login.html');
  await page.locator('#email').fill(`${role}@drosa.com`);
  await page.locator('#password').fill(role==='director'?process.env.INITIAL_DIRECTOR_PASSWORD:process.env.INITIAL_STAFF_PASSWORD);
  await page.locator('#role').selectOption(role);
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(role==='director'?/director-panel\.html/:/index\.html/);
  return page.evaluate(()=>window.DrRosaApi.getSession());
}

test('two devices stay independent and logout blocks old access',async({browser,baseURL})=>{
  const a=await browser.newContext({baseURL}), b=await browser.newContext({baseURL});
  try {
    const one=await a.newPage(),two=await b.newPage();
    const first=await signIn(one), second=await signIn(two);
    expect(first.sessionId).not.toBe(second.sessionId);
    const cookie=(await a.cookies()).find(c=>c.name==='drrosa_access').value;
    await one.locator('#logout-btn').click();await expect(one).toHaveURL(/login\.html/);
    await two.reload();await expect(two).toHaveURL(/index\.html/);
    expect((await two.evaluate(()=>window.DrRosaApi.verifySession())).role).toBe('staff');
    const stale=await a.request.post('/api/auth/verify',{headers:{Authorization:`Bearer ${cookie}`},data:{}});
    expect(stale.status()).toBe(401);expect((await stale.json()).code).toBe('SESSION_ENDED');
    expect((await pool.query('SELECT revoked_at FROM auth_sessions WHERE id=$1',[first.sessionId])).rows[0].revoked_at).toBeTruthy();
  } finally {await a.close();await b.close();}
});

test('idle lock preserves an unsaved draft and reauth restores access',async({page},testInfo)=>{
  const session=await signIn(page);
  await page.goto('/src/pages/new-patient.html');
  await page.locator('#first-name').fill('Unsaved local draft');
  await pool.query("UPDATE auth_sessions SET last_activity_at=clock_timestamp()-interval '21 minutes' WHERE id=$1",[session.sessionId]);
  await page.evaluate(()=>window.DrRosaApi.verifySession());
  await expect(page.locator('#drrosa-session-lock')).toBeVisible();
  for(const width of [1440,768,390]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
    await page.screenshot({path:testInfo.outputPath(`lock-${width}.png`)});
  }
  await expect(page.locator('#drrosa-session-lock [name=password]')).toBeFocused();
  await page.locator('#drrosa-session-lock [name=password]').fill(process.env.INITIAL_STAFF_PASSWORD);
  await page.locator('#drrosa-session-lock button').click();
  await expect(page.locator('#drrosa-session-lock')).toHaveCount(0);
  await expect(page.locator('#first-name')).toHaveValue('Unsaved local draft');
  expect((await page.evaluate(()=>window.DrRosaApi.verifySession())).role).toBe('staff');
});

test('tab logout propagates and refresh preserves shared login',async({page,context})=>{
  await signIn(page);
  const tab=await context.newPage();await tab.goto('/src/pages/index.html');
  await tab.reload();expect((await tab.evaluate(()=>window.DrRosaApi.getSession())).role).toBe('staff');
  await page.locator('#logout-btn').click();
  await expect(tab).toHaveURL(/login\.html/);
  expect(await tab.evaluate(()=>window.DrRosaApi.getSession())).toBeNull();
});

test('activity is shared between tabs without duplicate immediate requests',async({page,context})=>{
  await signIn(page);
  const tab=await context.newPage();await tab.goto('/src/pages/index.html');
  await page.evaluate(()=>localStorage.removeItem('drrosa-activity'));
  let activityRequests=0;
  context.on('request',request=>{if(request.url().endsWith('/api/auth/activity')) activityRequests++;});
  await page.bringToFront();
  await page.locator('.dashboard-hero-copy h2').click();
  await expect.poll(()=>activityRequests).toBe(1);
  await tab.bringToFront();
  await tab.locator('.dashboard-hero-copy h2').click();
  await tab.waitForTimeout(500);
  expect(activityRequests).toBe(1);
  const session=await tab.evaluate(()=>window.DrRosaApi.getSession());
  const row=(await pool.query('SELECT last_activity_at FROM auth_sessions WHERE id=$1',[session.sessionId])).rows[0];
  expect(Date.now()-new Date(row.last_activity_at).getTime()).toBeLessThan(5000);
});

test('restored page locks when browser session was removed while suspended',async({page})=>{
  await signIn(page);
  await page.evaluate(()=>{
    localStorage.removeItem('drrosa-session');
    window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
  });
  await expect(page.locator('#drrosa-session-lock')).toBeVisible();
  expect(await page.locator('main').evaluate(element=>Boolean(element.closest('[inert]')))).toBeTruthy();
});

test('scheduled absolute deadline warns then locks without polling',async({page})=>{
  const session=await signIn(page);
  await pool.query("UPDATE auth_sessions SET created_at=clock_timestamp()-interval '8 hours',expires_at=clock_timestamp()+interval '3 seconds' WHERE id=$1",[session.sessionId]);
  await page.evaluate(()=>window.DrRosaApi.verifySession());
  await expect(page.locator('#drrosa-session-warning')).toBeVisible();
  await expect(page.locator('#drrosa-session-lock')).toBeVisible();
  const response=await page.request.post('/api/auth/verify',{data:{}});
  expect(response.status()).toBe(401);
  expect((await response.json()).code).toBe('SESSION_ENDED');
});

test('temporary refresh failure retains login and recovers on retry',async({page,context})=>{
  await signIn(page);
  const cookies=(await context.cookies()).filter(c=>c.name!=='drrosa_access');
  await context.clearCookies();await context.addCookies(cookies);
  await page.route('**/api/auth/refresh',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Simulated temporary outage'})}));
  await page.evaluate(()=>window.DrRosaApi.verifySession());
  expect((await page.evaluate(()=>window.DrRosaApi.getSession())).role).toBe('staff');
  await expect(page.locator('#drrosa-session-lock')).toHaveCount(0);
  await page.unroute('**/api/auth/refresh');
  expect((await page.evaluate(()=>window.DrRosaApi.verifySession())).role).toBe('staff');
  expect((await context.cookies()).some(c=>c.name==='drrosa_access')).toBeTruthy();
});

test('restored browser state respects server idle expiration',async({browser,baseURL})=>{
  const first=await browser.newContext({baseURL});const page=await first.newPage();
  const session=await signIn(page);const state=await first.storageState();await first.close();
  const restored=await browser.newContext({baseURL,storageState:state});
  try {
    const tab=await restored.newPage();await tab.goto('/src/pages/index.html');await expect(tab).toHaveURL(/index\.html/);
    await pool.query("UPDATE auth_sessions SET last_activity_at=clock_timestamp()-interval '21 minutes' WHERE id=$1",[session.sessionId]);
    await tab.reload();await expect(tab).toHaveURL(/login\.html/);
  } finally {await restored.close();}
});
