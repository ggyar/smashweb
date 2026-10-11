// Server für Render (und lokal): node server.js
// Liefert die statische App aus public/ und die API aus lib/api.js.
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { handle } = require('./lib/api');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json',
};
const cache = new Map(); // Datei -> { raw, gz }

function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 20000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch (_) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function serveFile(req, res, file) {
  let e = cache.get(file);
  if (!e) {
    const raw = fs.readFileSync(file);
    const ext = path.extname(file);
    e = { raw, gz: /\.(html|js|css|json|svg)$/.test(ext) ? zlib.gzipSync(raw) : null };
    cache.set(file, e);
  }
  const ext = path.extname(file);
  const h = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': ext === '.jpg' ? 'public, max-age=86400' : 'no-cache' };
  if (e.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    h['Content-Encoding'] = 'gzip'; h.Vary = 'Accept-Encoding';
    res.writeHead(200, h); return res.end(e.gz);
  }
  res.writeHead(200, h); res.end(e.raw);
}

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url || '/', 'http://localhost');
    const p = decodeURIComponent(u.pathname);

    if (p === '/healthz') { res.writeHead(200); return res.end('ok'); }

    if (p.startsWith('/api/')) {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      const out = await handle({ method: req.method, path: p, query: Object.fromEntries(u.searchParams), body, headers: req.headers, ip });
      res.writeHead(out.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(out.json));
    }

    if (p === '/' || /^\/t\/[A-Za-z0-9]+\/?$/.test(p)) return serveFile(req, res, path.join(PUB, 'index.html'));

    const file = path.join(PUB, p);
    if (file.startsWith(PUB + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return serveFile(req, res, file);

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Nicht gefunden');
  } catch (e) {
    console.error(e);
    res.writeHead(500); res.end('Serverfehler');
  }
}).listen(PORT, () => console.log('Smash Turnier läuft auf Port ' + PORT + (process.env.DATABASE_URL ? '' : ' – ACHTUNG: DATABASE_URL fehlt!')));
