const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../../src/scripts/api.js'),'utf8');
const session = {id:2,email:'client@example.test',role:'staff',sessionId:'22'};
const reply=(status,data={})=>({status,ok:status>=200&&status<300,json:async()=>data});
function client(fetch, pathname = '/src/pages/index.html') {
  const redirects = [];
  const store=new Map([['drrosa-session',JSON.stringify(session)]]);
  const document={readyState:'loading',body:null,addEventListener(){},querySelectorAll:()=>[],getElementById:()=>null};
  const window={DrRosaSecurity:{},addEventListener(){},navigator:{}};
  const context={window,document,location:{pathname,replace:url=>redirects.push(url)},crypto:require('node:crypto').webcrypto,encodeURIComponent,fetch,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},Map,Date,Math,Error,JSON,URLSearchParams};
  vm.createContext(context);vm.runInContext(source,context);
  return {api:window.DrRosaApi,store,redirects};
}

test('payment double submit shares an in-flight request; equal completed payments get distinct keys', async () => {
  const calls = [];
  let release;
  const c = client(async (url, options) => {
    calls.push({ url, ...options });
    if (calls.length === 1) await new Promise(resolve => { release = resolve; });
    return reply(201, { id: calls.length });
  });
  const payment = { amount: 10, currency: 'RSD' };
  const one = c.api.addRecordPaymentPart(12, payment);
  const two = c.api.addRecordPaymentPart(12, payment);
  assert.equal(calls.length, 1);
  release();
  assert.deepEqual(await one, await two);
  await c.api.addRecordPaymentPart(12, payment);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
});

test('payment retry after response loss reuses its key; changed input and login use new keys', async () => {
  const calls = [];
  const c = client(async (url, options) => {
    calls.push(options);
    if (calls.length === 1) throw new Error('Response lost');
    return reply(201, { amountPaid: 10 });
  });
  const payment = { amount: 10, paymentDate: '2026-10-16' };
  await assert.rejects(c.api.addInvoicePayment(5, payment), /Response lost/);
  await c.api.addInvoicePayment(5, payment);
  assert.equal(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
  await c.api.addInvoicePayment(5, { ...payment, amount: 20 });
  assert.notEqual(calls[1].headers['Idempotency-Key'], calls[2].headers['Idempotency-Key']);
  c.store.set('drrosa-auth-epoch', 'new-login');
  await c.api.addInvoicePayment(5, payment);
  assert.notEqual(calls[1].headers['Idempotency-Key'], calls[3].headers['Idempotency-Key']);
});

test('an interrupted successful payment body keeps the original retry key', async () => {
  const calls = [];
  const c = client(async (url, options) => {
    calls.push(options);
    return calls.length === 1
      ? { ok: true, status: 201, json: async () => { throw new Error('body interrupted'); } }
      : reply(201, { id: 5, amountPaid: 100 });
  });
  await assert.rejects(c.api.addInvoicePayment(5, { amount: 100 }));
  await c.api.addInvoicePayment(5, { amount: 100 });
  assert.equal(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
});

test('empty successful payment responses remain unresolved; pending data is a copy and logout clears it', async () => {
  for (const body of [{}, null, []]) {
    const c = client(async () => reply(201, body));
    await assert.rejects(c.api.addInvoicePayment(5, { amount: 10 }), { code: 'PAYMENT_RESPONSE_INCOMPLETE' });
    const pending = c.api.getPendingInvoicePayment(5);
    assert.equal(pending.amount, 10);
    pending.amount = 999;
    assert.equal(c.api.getPendingInvoicePayment(5).amount, 10);
    c.api.clearSession();
    assert.equal(c.api.getPendingInvoicePayment(5), null);
  }
});

test('an uncertain payment must be resolved before changing its input or starting a new payment', async () => {
  const calls = [], receipts = new Map();
  let total = 0;
  const c = client(async (url, options) => {
    calls.push(options);
    const key = options.headers['Idempotency-Key'];
    if (!receipts.has(key)) {
      total += JSON.parse(options.body).amount;
      receipts.set(key, { id: 5, amountPaid: total });
    }
    if (calls.length === 1) throw new Error('response lost after commit');
    return reply(201, receipts.get(key));
  });
  await assert.rejects(c.api.addInvoicePayment(5, { amount: 100, paymentType: 'payment' }));
  await assert.rejects(c.api.addInvoicePayment(5, { amount: 200 }), { code: 'PAYMENT_UNRESOLVED' });
  assert.equal(calls.length, 1);
  // Object property order does not create a different action.
  assert.equal((await c.api.addInvoicePayment(5, { paymentType: 'payment', amount: 100 })).amountPaid, 100);
  assert.equal((await c.api.addInvoicePayment(5, { amount: 200 })).amountPaid, 300);
  assert.equal((await c.api.addInvoicePayment(5, { amount: 100 })).amountPaid, 400);
  assert.equal(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
  assert.notEqual(calls[0].headers['Idempotency-Key'], calls[3].headers['Idempotency-Key']);
});

test('rejected payment input can be corrected without an unresolved attempt', async () => {
  const calls = [];
  const c = client(async (url, options) => {
    calls.push(options);
    return calls.length === 1 ? reply(400, { error: 'Invalid amount' }) : reply(201, { id: 5 });
  });
  await assert.rejects(c.api.addInvoicePayment(5, { amount: -1 }));
  await c.api.addInvoicePayment(5, { amount: 10 });
  assert.notEqual(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
});

test('parallel browser requests share one renewal and keep the login', async()=>{
  let renewed=false,refreshes=0;
  const c=client(async url=>{
    if(url.endsWith('/auth/refresh')) {refreshes++;await new Promise(r=>setTimeout(r,10));renewed=true;return reply(200,{user:session,sessionId:'22'});}
    return renewed ? reply(200,{user:session,sessionId:'22'}) : reply(401,{code:'ACCESS_EXPIRED'});
  });
  const users=await Promise.all([c.api.verifySession(),c.api.verifySession(),c.api.verifySession()]);
  assert.equal(refreshes,1);assert.ok(users.every(u=>u.id===2));assert.equal(c.api.getSession().id,2);
});

test('temporary refresh failure and forbidden action do not clear login',async()=>{
  for(const kind of ['temporary','forbidden']) {
    let refreshes=0;
    const c=client(async url=>{
      if(url.endsWith('/auth/refresh')) {refreshes++;return reply(503,{error:'Temporary error'});}
      return kind==='forbidden'?reply(403,{error:'Permission required'}):reply(401,{code:'ACCESS_EXPIRED'});
    });
    assert.equal((await c.api.verifySession()).id,2);assert.equal(c.api.getSession().id,2);
    assert.equal(refreshes,kind==='forbidden'?0:1);assert.deepEqual(c.redirects,[]);
  }
});

test('confirmed expiration clears state and failed logout stays locally blocked',async()=>{
  const expired=client(async()=>reply(401,{code:'SESSION_ENDED',error:'Expired'}));
  assert.equal(await expired.api.verifySession(),null);assert.equal(expired.api.getSession(),null);
  assert.deepEqual(expired.redirects,['/src/pages/login.html?reason=session-ended']);
  expired.api.redirectToLogin();
  assert.deepEqual(expired.redirects,['/src/pages/login.html?reason=session-ended']);
  const offline=client(async()=>{throw new Error('offline');});
  await assert.rejects(offline.api.logout(),/offline/);
  assert.equal(offline.api.getSession(),null);assert.equal(await offline.api.verifySession(),null);
  assert.equal(offline.store.get('drrosa-logout-pending'),'1');
});

test('late refresh cannot restore local login after logout',async()=>{
  let release;const gate=new Promise(r=>release=r);
  const c=client(async url=>{
    if(url.endsWith('/auth/logout')) return reply(200,{success:true});
    if(url.endsWith('/auth/refresh')) {await gate;return reply(200,{user:session,sessionId:'22'});}
    return reply(401,{code:'ACCESS_EXPIRED'});
  });
  const verification=c.api.verifySession();await new Promise(r=>setTimeout(r,5));
  await c.api.logout();release();await verification;
  assert.equal(c.api.getSession(),null);
});

test('expiration on login clears state without a redirect loop',async()=>{
  const c=client(async()=>reply(401,{code:'SESSION_ENDED'}),'/src/pages/login.html');
  assert.equal(await c.api.verifySession(),null);
  assert.equal(c.api.getSession(),null);
  assert.deepEqual(c.redirects,[]);
});

test('navigation abort preserves the session without redirecting',async()=>{
  const c=client(async()=>{throw Object.assign(new Error('Navigation aborted'),{name:'AbortError'});});
  assert.equal((await c.api.verifySession()).id,session.id);
  assert.equal(c.api.getSession().id,session.id);
  assert.deepEqual(c.redirects,[]);
});

test('page access redirect runs once and does not clear shared login state',()=>{
  const c=client(async()=>reply(200));
  c.api.redirectToLogin();
  c.api.redirectToLogin();
  assert.deepEqual(c.redirects,['/src/pages/login.html']);
  assert.equal(c.api.getSession().id,session.id);
});

test('late refresh cannot restore login after another request confirms expiration',async()=>{
  let release;const gate=new Promise(r=>release=r);
  let started;const refreshing=new Promise(r=>started=r);
  const c=client(async url=>{
    if(url.endsWith('/auth/refresh')) {started();await gate;return reply(200,{user:session,sessionId:'22'});}
    if(url.endsWith('/patients')) return reply(401,{code:'SESSION_ENDED'});
    return reply(401,{code:'ACCESS_EXPIRED'});
  });
  const verification=c.api.verifySession();await refreshing;
  await assert.rejects(c.api.getPatients(),error=>error.code==='SESSION_ENDED');
  release();await verification;
  assert.equal(c.api.getSession(),null);
  assert.deepEqual(c.redirects,['/src/pages/login.html?reason=session-ended']);
});
