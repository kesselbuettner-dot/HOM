'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {mkdtempSync,rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const path = require('node:path');
const bcrypt = require('bcryptjs');

const tmp = mkdtempSync(path.join(tmpdir(),'hom-login-test-'));
process.env.HAUSKOSTEN_DATA=tmp;
process.env.HOM_PASSWORD_HASH=bcrypt.hashSync('EinStarkesTestpasswort!123',4);
process.env.HOST='127.0.0.1';
const {server} = require('../server');

test('HOM: Loginseite, API-Schutz, 30-Tage-Cookie, Abmeldung', async (t) => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    rmSync(tmp,{recursive:true,force:true});
  });
  const url='http://127.0.0.1:'+server.address().port;
  const options={redirect:'manual'};
  const front=await fetch(url+'/',options);
  assert.equal(front.status,303);
  assert.equal(front.headers.get('location'),'/login');
  const denied=await fetch(url+'/api/state');
  assert.equal(denied.status,401);
  assert.match(await denied.text(),/anmelden/);

  const loginPage=await fetch(url+'/login',options);
  assert.equal(loginPage.status,200);
  assert.match(await loginPage.text(),/30 Tage angemeldet bleiben/);

  const login=async (password,remember=false)=>fetch(url+'/login',{
    method:'POST',redirect:'manual',
    headers:{'content-type':'application/x-www-form-urlencoded','origin':'http://127.0.0.1:4317'},
    body:new URLSearchParams({username:'hom',password,...(remember?{remember:'on'}:{})}).toString()
  });
  const wrong=await login('falsch');
  assert.equal(wrong.status,303);
  assert.equal(wrong.headers.get('location'),'/login?error=1');
  const good=await login('EinStarkesTestpasswort!123',true);
  assert.equal(good.status,303);
  assert.equal(good.headers.get('location'),'/');
  const setCookie=good.headers.get('set-cookie');
  assert.match(setCookie,/HttpOnly/);
  assert.match(setCookie,/Secure/);
  assert.match(setCookie,/SameSite=Strict/);
  assert.match(setCookie,/Max-Age=2592000/);
  const sessionCookie=setCookie.split(';')[0];
  const state=await fetch(url+'/api/state',{headers:{cookie:sessionCookie}});
  assert.equal(state.status,200);
  const backup=await fetch(url+'/api/backup');
  assert.equal(backup.status,401);
  const end=await fetch(url+'/logout',{
    method:'POST',redirect:'manual',
    headers:{cookie:sessionCookie,origin:'http://127.0.0.1:4317'}
  });
  assert.equal(end.status,303);
  assert.match(end.headers.get('set-cookie'),/Max-Age=0/);
  const revoked=await fetch(url+'/api/state',{headers:{cookie:sessionCookie}});
  assert.equal(revoked.status,401);
});
