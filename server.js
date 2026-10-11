// Smash Turnier – läuft auf dem Host-Gerät (Laptop/PC) im eigenen WLAN. Start: node server.js
// Keine Datenbank, keine externen Pakete: Räume liegen im Speicher und in data/rooms.json.
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const store = require('./lib/store');
const { handle, isLocalAddress, lanBases } = require('./lib/api');

const PORT = Number(process.env.PORT) || 3000;
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
    e = { raw, gz: /\.(html|js|css|json|svg)$/.test(file) ? zlib.gzipSync(raw) : null };
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

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url || '/', 'http://localhost');
    const p = decodeURIComponent(u.pathname);

    if (p.startsWith('/api/')) {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const out = await handle({
        method: req.method, path: p, query: Object.fromEntries(u.searchParams), body, headers: req.headers,
        ip: req.socket.remoteAddress || '', local: isLocalAddress(req.socket.remoteAddress),
      });
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
});

function openBrowser(url) {
  try {
    const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    const c = spawn(cmd, args, { stdio: 'ignore', detached: true });
    c.on('error', () => {}); c.unref();
  } catch (_) { /* Browser einfach selbst öffnen */ }
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\nPort ${PORT} ist schon belegt (läuft das Turnier-Programm vielleicht schon?).\nAnderen Port nehmen:  PORT=3001 node server.js\n`);
  else console.error(e);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  const n = store.load();
  const bases = lanBases();
  console.log('\n  🎮  SMASH TURNIER läuft!' + (n ? `  (${n} gespeicherte${n === 1 ? 's' : ''} Turnier${n === 1 ? '' : 'e'} geladen)` : ''));
  console.log('\n  Am HOST-GERÄT (hier) öffnen:   http://localhost:' + PORT);
  if (bases.length) console.log('  Freunde im selben WLAN:         ' + bases.join('   ') + '   (per QR-Code in der Lobby)');
  else console.log('  ⚠️  Kein Netzwerk gefunden – verbinde dieses Gerät mit dem WLAN, damit Freunde beitreten können.');
  console.log('\n  Beenden mit Strg+C.\n');
  if (process.env.NO_OPEN !== '1' && !process.argv.includes('--no-open')) openBrowser('http://localhost:' + PORT);
});
