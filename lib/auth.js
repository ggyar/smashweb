// Gemeinsame Zugangscode-Logik für Render (server.js) und Vercel (api/*.js).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const COOKIE = 'smash_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 Tage

const accessCode = () => String(process.env.ACCESS_CODE || '').trim();
// Ohne SESSION_SECRET wird der Zugangscode als Basis genutzt (Cookie ist dann an den Code gebunden).
const secret = () => process.env.SESSION_SECRET || 'smash-' + accessCode();

const sign = () =>
  crypto.createHmac('sha256', secret()).update('smash-ok:' + accessCode()).digest('hex');

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

function parseCookies(header) {
  const out = {};
  String(header || '')
    .split(';')
    .forEach((p) => {
      const i = p.indexOf('=');
      if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
    });
  return out;
}

const configured = () => accessCode().length > 0;

function isAuthed(req) {
  if (!configured()) return false;
  const c = parseCookies(req.headers.cookie)[COOKIE];
  return !!c && safeEqual(c, sign());
}

function cookieHeader(req, clear) {
  const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  const base = `${COOKIE}=${clear ? '' : sign()}; Path=/; HttpOnly; SameSite=Lax${secure}`;
  return base + (clear ? '; Max-Age=0' : `; Max-Age=${MAX_AGE}`);
}

function checkCode(code) {
  return configured() && safeEqual(String(code || '').trim().toLowerCase(), accessCode().toLowerCase());
}

const view = (name) => fs.readFileSync(path.join(__dirname, '..', 'views', name), 'utf8');

module.exports = { isAuthed, cookieHeader, checkCode, configured, view };
