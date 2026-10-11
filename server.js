// Server für Render (und lokal): node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const { isAuthed, cookieHeader, checkCode, configured, view } = require('./lib/auth');

const PORT = process.env.PORT || 3000;
const fails = new Map(); // IP -> { n, until }

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
};
const html = (res, name) => send(res, 200, view(name), { 'Content-Type': 'text/html; charset=utf-8' });
const json = (res, status, obj, headers = {}) =>
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json', ...headers });

function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => {
      d += c;
      if (d.length > 2000) req.destroy();
    });
    req.on('end', () => {
      try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); }
    });
  });
}

http
  .createServer(async (req, res) => {
    const url = (req.url || '/').split('?')[0];

    if (url === '/healthz') return send(res, 200, 'ok');

    if (url === '/hero.jpg') {
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'public', 'hero.jpg')), {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      });
    }

    if (url === '/api/login' && req.method === 'POST') {
      if (!configured()) return json(res, 500, { ok: false, error: 'ACCESS_CODE ist auf dem Server nicht gesetzt.' });
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      const f = fails.get(ip) || { n: 0, until: 0 };
      if (Date.now() < f.until) return json(res, 429, { ok: false, error: 'Zu viele Versuche. Bitte kurz warten.' });
      const { code } = await readBody(req);
      if (checkCode(code)) {
        fails.delete(ip);
        return json(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req) });
      }
      f.n++;
      if (f.n >= 5) { f.until = Date.now() + 30000; f.n = 0; }
      fails.set(ip, f);
      return json(res, 401, { ok: false, error: 'Falscher Zugangscode.' });
    }

    if (url === '/api/logout') return json(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, true) });

    if (url === '/' || url === '/index.html') return html(res, isAuthed(req) ? 'app.html' : 'welcome.html');

    send(res, 404, 'Nicht gefunden', { 'Content-Type': 'text/plain; charset=utf-8' });
  })
  .listen(PORT, () => console.log(`Smash Turnier läuft auf Port ${PORT}` + (configured() ? '' : ' – ACHTUNG: ACCESS_CODE fehlt!')));
