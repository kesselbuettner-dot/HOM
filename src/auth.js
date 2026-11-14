'use strict';
// HOM-Konten und Sessions. Ehemaliges gemeinsames Passwort wird initialer Admin.
const crypto=require('node:crypto');
const bcrypt=require('bcryptjs');
const HASH=process.env.HOM_PASSWORD_HASH||'';
let enabled=false;
const cookieName='hom_session';
const rememberMs=30*24*60*60*1000, shortMs=12*60*60*1000;
const failures=new Map();
if(HASH&&!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(HASH))
  throw new Error('HOM_PASSWORD_HASH ist kein gültiger bcrypt-Hash.');
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function publicUser(u){
  if(!u)return null;
  return {id:u.id,username:u.username,display_name:u.display_name,role:u.role,active:u.active,created_at:u.created_at};
}
function init(db){
  db.exec("CREATE TABLE IF NOT EXISTS auth_users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','user')), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  db.exec("CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)");
  if(!db.prepare('PRAGMA table_info(auth_sessions)').all().some(c=>c.name==='user_id'))
    db.exec('ALTER TABLE auth_sessions ADD COLUMN user_id INTEGER REFERENCES auth_users(id)');
  if(!db.prepare('SELECT 1 FROM auth_users LIMIT 1').get()&&HASH){
    const id=Number(db.prepare("INSERT INTO auth_users (username,display_name,password_hash,role,active) VALUES ('hom','Administrator',?,'admin',1)").run(HASH).lastInsertRowid);
    // Bisherige gültige Sitzungen des gemeinsamen hom-Logins bleiben verwendbar.
    db.prepare('UPDATE auth_sessions SET user_id=? WHERE user_id IS NULL').run(id);
  }
  enabled=!!db.prepare('SELECT 1 FROM auth_users LIMIT 1').get();
}
function getToken(req){
  const item=(req.headers.cookie||'').split(';').map(c=>c.trim()).find(c=>c.startsWith(cookieName+'='));
  const value=item?.slice(cookieName.length+1)||'';
  return /^[a-f0-9]{64}$/.test(value)?value:'';
}
const tokenHash=token=>crypto.createHash('sha256').update(token).digest('hex');
function currentUser(db,req){
  if(!enabled)return {id:0,username:'local',display_name:'Lokale Entwicklung',role:'admin',active:1};
  const token=getToken(req);
  if(!token)return null;
  return db.prepare('SELECT u.id,u.username,u.display_name,u.role,u.active,u.created_at FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1').get(tokenHash(token),Date.now())||null;
}
function isAuthenticated(db,req){return !!currentUser(db,req);}
function isAdmin(db,req){return currentUser(db,req)?.role==='admin';}
function readForm(req){
  return new Promise((resolve,reject)=>{
    if(!String(req.headers['content-type']||'').startsWith('application/x-www-form-urlencoded')){
      reject(Object.assign(new Error('Ungültiges Formular.'),{status:415}));return;
    }
    let body='',tooLong=false;
    req.on('data',chunk=>{
      body+=chunk.toString('utf8');
      if(Buffer.byteLength(body,'utf8')>4096&&!tooLong){
        tooLong=true;reject(Object.assign(new Error('Formular zu groß.'),{status:413}));req.destroy();
      }
    });
    req.on('end',()=>{if(!tooLong)resolve(new URLSearchParams(body));});
    req.on('error',reject);
  });
}
function redirect(res,dest,setCookie){
  const headers={Location:dest,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
  if(setCookie)headers['Set-Cookie']=setCookie;
  res.writeHead(303,headers);res.end();
}
function cookie(token,duration){
  return cookieName+'='+token+'; Path=/; HttpOnly; Secure; SameSite=Strict'+(duration?'; Max-Age='+Math.floor(duration/1000):'');
}
async function login(db,req,res){
  const remote=req.socket.remoteAddress||'gateway',now=Date.now(),record=failures.get(remote);
  if(record&&record.until>now)return redirect(res,'/login?error=limit');
  const form=await readForm(req);
  const username=String(form.get('username')||'').trim(),password=String(form.get('password')||'');
  const user=db.prepare('SELECT * FROM auth_users WHERE username=? COLLATE NOCASE').get(username);
  const valid=!!(user&&user.active&&password.length>=1&&password.length<=256&&await bcrypt.compare(password,user.password_hash));
  if(!valid){
    const count=record&&now-record.first<10*60*1000?record.count+1:1;
    failures.set(remote,{first:count===1?now:record.first,count,until:count>=10?now+5*60*1000:0});
    return redirect(res,'/login?error=1');
  }
  failures.delete(remote);
  const remember=form.get('remember')==='on',duration=remember?rememberMs:shortMs;
  const token=crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').run(now);
  db.prepare('INSERT INTO auth_sessions (token_hash,expires_at,user_id) VALUES (?,?,?)').run(tokenHash(token),now+duration,user.id);
  return redirect(res,'/',cookie(token,remember?duration:0));
}
function logout(db,req,res){
  const token=getToken(req);
  if(token)db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(tokenHash(token));
  return redirect(res,'/login',cookieName+'=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
}
function validName(v,label,max=80){
  const s=String(v??'').trim();
  if(!s||s.length>max)fail(label+' muss 1 bis '+max+' Zeichen lang sein.');
  return s;
}
function validPassword(v){
  if(typeof v!=='string'||v.length<10||v.length>128)fail('Passwort muss 10 bis 128 Zeichen lang sein.');
  return v;
}
function listUsers(db){
  return db.prepare('SELECT id,username,display_name,role,active,created_at FROM auth_users ORDER BY id').all();
}
async function createUser(db,body){
  const username=String(body.username||'').trim().toLowerCase();
  if(!/^[a-z0-9._-]{3,32}$/.test(username))fail('Benutzername: 3 bis 32 Zeichen, a-z, 0-9, Punkt, Unterstrich oder Bindestrich.');
  const displayName=validName(body.display_name,'Anzeigename');
  const role=body.role==='admin'?'admin':body.role==='user'?'user':fail('Ungültige Rolle.');
  const active=body.active===false?0:1;
  const hash=await bcrypt.hash(validPassword(body.password),12);
  const id=db.prepare('INSERT INTO auth_users (username,display_name,password_hash,role,active) VALUES (?,?,?,?,?)').run(username,displayName,hash,role,active).lastInsertRowid;
  return publicUser(db.prepare('SELECT * FROM auth_users WHERE id=?').get(id));
}
async function updateUser(db,targetId,body){
  const target=db.prepare('SELECT * FROM auth_users WHERE id=?').get(targetId);
  if(!target)fail('Benutzer nicht gefunden.',404);
  const role=body.role==='admin'?'admin':body.role==='user'?'user':fail('Ungültige Rolle.');
  if(body.active!==true&&body.active!==false)fail('Status muss aktiv oder inaktiv sein.');
  const active=body.active?1:0;
  if(target.role==='admin'&&target.active&&(!active||role!=='admin')){
    const count=db.prepare("SELECT COUNT(*) AS n FROM auth_users WHERE role='admin' AND active=1").get().n;
    if(count<=1)fail('Der letzte aktive Administrator darf nicht deaktiviert oder herabgestuft werden.');
  }
  const displayName=validName(body.display_name,'Anzeigename');
  const newHash=body.password?await bcrypt.hash(validPassword(body.password),12):null;
  if(newHash)db.prepare('UPDATE auth_users SET display_name=?,role=?,active=?,password_hash=? WHERE id=?').run(displayName,role,active,newHash,targetId);
  else db.prepare('UPDATE auth_users SET display_name=?,role=?,active=? WHERE id=?').run(displayName,role,active,targetId);
  if(newHash||!active)db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(targetId);
  return publicUser(db.prepare('SELECT * FROM auth_users WHERE id=?').get(targetId));
}
async function changePassword(db,req,currentPassword,newPassword){
  const user=currentUser(db,req);
  if(!user||!user.id)fail('Bitte anmelden.',401);
  const row=db.prepare('SELECT password_hash FROM auth_users WHERE id=?').get(user.id);
  if(typeof currentPassword!=='string'||!await bcrypt.compare(currentPassword,row.password_hash))
    fail('Das bisherige Passwort stimmt nicht.');
  const hash=await bcrypt.hash(validPassword(newPassword),12);
  db.prepare('UPDATE auth_users SET password_hash=? WHERE id=?').run(hash,user.id);
  const token=getToken(req);
  db.prepare('DELETE FROM auth_sessions WHERE user_id=? AND token_hash<>?').run(user.id,tokenHash(token));
  return {ok:true};
}
module.exports={get enabled(){return enabled;},init,currentUser,isAuthenticated,isAdmin,login,logout,redirect,publicUser,listUsers,createUser,updateUser,changePassword};
