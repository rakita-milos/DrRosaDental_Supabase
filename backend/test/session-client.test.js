const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../../src/scripts/api.js'),'utf8');
const session = {id:2,email:'client@example.test',role:'staff',sessionId:'22'};
const reply=(status,data={})=>({status,ok:status>=200&&status<300,json:async()=>data});
function client(fetch) {
  const store=new Map([['drrosa-session',JSON.stringify(session)]]);
  const document={readyState:'loading',body:null,addEventListener(){},querySelectorAll:()=>[],getElementById:()=>null};
  const window={DrRosaSecurity:{},addEventListener(){},navigator:{}};
  const context={window,document,location:{pathname:'/src/pages/index.html'},fetch,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},Map,Date,Math,Error,JSON,URLSearchParams};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../../src/scripts/session-lock.js'),'utf8'),context);vm.runInContext(source,context);
  return {api:window.DrRosaApi,store};
}

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
    assert.equal(refreshes,kind==='forbidden'?0:1);
  }
});

test('confirmed expiration clears state and failed logout stays locally blocked',async()=>{
  const expired=client(async()=>reply(401,{code:'SESSION_ENDED',error:'Expired'}));
  assert.equal(await expired.api.verifySession(),null);assert.equal(expired.api.getSession(),null);
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
