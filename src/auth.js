'use strict';
// Anmeldung für privaten NAS-Betrieb. Sessions werden nur gehasht in SQLite gespeichert.
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const HASH = process.env.HOM_PASSWORD_HASH || '';
const enabled = Boolean(HASH);
const cookieName = 'hom_session';
const rememberMs = 30 * 24 * 60 * 60 * 1000;
const shortMs = 12 * 60 * 60 * 1000;
const failures = new Map();

if (enabled && !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(HASH)) {
  throw new Error('HOM_PASSWORD_HASH ist kein gültiger bcrypt-Hash.');
}

function init(db) {
  if (!enabled) return;
  db.exec(`CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  )`);
}
function getToken(req) {
  const cookie = (req.headers.cookie || '').split(';').map(s => s.trim()).find(x => x.startsWith(cookieName + '='));
  const value = cookie?.slice(cookieName.length + 1) || '';
  return /^[a-f0-9]{64}$/.test(value) ? value : '';
}
function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
function isAuthenticated(db, req) {
  if (!enabled) return true;
  const token = getToken(req);
  if (!token) return false;
  const row = db.prepare('SELECT expires_at FROM auth_sessions WHERE token_hash=?').get(tokenHash(token));
  return Boolean(row && row.expires_at > Date.now());
}
function readForm(req) {
  return new Promise((resolve, reject) => {
    if (!String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) {
      reject(Object.assign(new Error('Ungültiges Formular.'), {status:415})); return;
    }
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString('utf8');
      if (Buffer.byteLength(body, 'utf8') > 4096) {
        reject(Object.assign(new Error('Formular zu groß.'), {status:413}));
        req.destroy();
      }
    });
    req.on('end', () => resolve(new URLSearchParams(body)));
    req.on('error', reject);
  });
}
function redirect(res, dest, cookie) {
  const headers = {
    Location: dest, 'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff'
  };
  if (cookie) headers['Set-Cookie'] = cookie;
  res.writeHead(303, headers); res.end();
}
function cookie(token, duration) {
  // Die App ist von außen ausschließlich via HTTPS-Gateway erreichbar.
  return `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict` +
    (duration ? `; Max-Age=${Math.floor(duration / 1000)}` : '');
}
async function login(db, req, res) {
  const remote = req.socket.remoteAddress || 'gateway';
  const now = Date.now();
  const record = failures.get(remote);
  if (record && record.until > now) return redirect(res, '/login?error=limit');

  const values = await readForm(req);
  const user = String(values.get('username') || '');
  const password = String(values.get('password') || '');
  const valid = user === 'hom' && password.length >= 1 && password.length <= 256 &&
    await bcrypt.compare(password, HASH);

  if (!valid) {
    const n = record && now - record.first < 10 * 60 * 1000 ? record.count + 1 : 1;
    failures.set(remote, {first: n === 1 ? now : record.first, count:n, until:n >= 10 ? now + 5 * 60 * 1000 : 0});
    return redirect(res, '/login?error=1');
  }
  failures.delete(remote);
  const remember = values.get('remember') === 'on';
  const duration = remember ? rememberMs : shortMs;
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').run(now);
  db.prepare('INSERT INTO auth_sessions (token_hash,expires_at) VALUES (?,?)')
    .run(tokenHash(token), now + duration);
  return redirect(res, '/', cookie(token, remember ? duration : 0));
}
function logout(db, req, res) {
  const token = getToken(req);
  if (token) db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(tokenHash(token));
  return redirect(res, '/login', cookie('', -1).replace('Max-Age=-1','Max-Age=0') +
    '; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
}
module.exports = {enabled, init, isAuthenticated, login, logout, redirect};
