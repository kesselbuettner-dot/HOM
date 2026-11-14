'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const bcrypt=require('bcryptjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hom-users-'));
process.env.HAUSKOSTEN_DATA=dir;
process.env.HOM_PASSWORD_HASH=bcrypt.hashSync('UrspruenglichesPasswort!123',4);
process.env.HOST='127.0.0.1';
const {server}=require('../server');

test('Admin kann Accounts verwalten, Titel ändern; Mitglieder dürfen alle Hausdaten bearbeiten',async t=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  const origin='http://127.0.0.1:4317';
  const request=async(url,method='GET',data,cookie)=>{
    const resp=await fetch(base+url,{method,redirect:'manual',headers:{
      ...(data?{'Content-Type':'application/json'}:{}),
      ...(method!=='GET'?{origin}:{}),...(cookie?{cookie}:{})
    },body:data?JSON.stringify(data):undefined});
    const value=resp.headers.get('Content-Type')?.includes('application/json')?await resp.json():await resp.text();
    return {resp,value};
  };
  const login=async(username,password)=>{
    const resp=await fetch(base+'/login',{method:'POST',redirect:'manual',
      headers:{'Content-Type':'application/x-www-form-urlencoded',origin},
      body:new URLSearchParams({username,password}).toString()});
    assert.equal(resp.status,303);
    assert.equal(resp.headers.get('location'),'/');
    return resp.headers.get('set-cookie').split(';')[0];
  };
  const admin=await login('hom','UrspruenglichesPasswort!123');
  let r=await request('/api/auth/me','GET',undefined,admin);
  assert.equal(r.value.user.role,'admin');
  assert.equal(r.value.user.username,'hom');
  assert.equal(r.value.house_title,'Villa Kunterbunt');
  assert.equal(r.value.auth_enabled,true);

  r=await request('/api/users','GET',undefined,admin);
  assert.equal(r.value.users.length,1);
  assert.equal(r.value.users[0].password_hash,undefined);
  const adminId=r.value.users[0].id;
  r=await request('/api/users','POST',{username:'familie1',display_name:'Familie Eins',password:'EigenesFamilienPasswort!234',role:'user'},admin);
  assert.equal(r.resp.status,201);
  const memberId=r.value.user.id;
  r=await request('/api/users','POST',{username:'zehnzeichen',display_name:'Zehn',password:'abc1234DEF',role:'user'},admin);
  assert.equal(r.resp.status,201);
  r=await request('/api/users','POST',{username:'neunzeichen',display_name:'Neun',password:'abc1234DE',role:'user'},admin);
  assert.equal(r.resp.status,400);
  r=await request('/api/users','POST',{username:'pausiert',display_name:'Noch gesperrt',password:'NochNichtAktiv!123456',role:'user',active:false},admin);
  assert.equal(r.resp.status,201);
  assert.equal(r.value.user.active,0);
  const family=await login('FAMILIE1','EigenesFamilienPasswort!234');
  r=await request('/api/auth/me','GET',undefined,family);
  assert.equal(r.value.user.role,'user');
  r=await request('/api/users','GET',undefined,family);
  assert.equal(r.resp.status,403);
  r=await request('/api/users','POST',{username:'stolper',password:'EinSehrLangesPasswort',display_name:'X',role:'admin'},family);
  assert.equal(r.resp.status,403);
  r=await request('/api/settings','PATCH',{house_title:'Unberechtigt'},family);
  assert.equal(r.resp.status,403);

  r=await request('/api/households','POST',{name:'Familienwohnung',area_m2:62,occupants:2,active:'1'},family);
  assert.equal(r.resp.status,201);
  r=await request('/api/households','GET',undefined,admin);
  assert.equal(r.value.length,1);

  r=await request('/api/settings','PATCH',{house_title:'Villa Kunterbunt & Freunde'},admin);
  assert.equal(r.resp.status,200);
  r=await request('/api/settings','GET',undefined,family);
  assert.equal(r.value.house_title,'Villa Kunterbunt & Freunde');
  r=await request('/login');
  assert.match(r.value,/Villa Kunterbunt &amp; Freunde/);
  r=await request('/api/auth/me','GET',undefined,admin);
  assert.equal(r.value.house_title,'Villa Kunterbunt & Freunde');

  r=await request('/api/users/'+adminId,'PATCH',{display_name:'Admin',role:'user',active:true},admin);
  assert.equal(r.resp.status,400);
  r=await request('/api/users/'+memberId,'PATCH',{display_name:'Familie Eins',role:'user',active:false},admin);
  assert.equal(r.resp.status,200);
  r=await request('/api/state','GET',undefined,family);
  assert.equal(r.resp.status,401);

  r=await request('/api/users/'+memberId,'PATCH',{display_name:'Familie Eins',role:'user',active:true,password:'WiederAktiviertPasswort!345'},admin);
  assert.equal(r.resp.status,200);
  const family2=await login('familie1','WiederAktiviertPasswort!345');
  r=await request('/api/auth/password','POST',{current_password:'WiederAktiviertPasswort!345',new_password:'NeueStarkePassphrase!456'},family2);
  assert.equal(r.resp.status,200);
  assert.equal(r.value.ok,true);
  const newFamily=await login('familie1','NeueStarkePassphrase!456');
  r=await request('/api/state','GET',undefined,newFamily);
  assert.equal(r.resp.status,200);
});
