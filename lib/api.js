// API-Logik des Host-Geräts. Alle Berechtigungen werden HIER geprüft, nie im Browser.
// Der Zustand liegt im Arbeitsspeicher (lib/store.js) – keine externe Datenbank nötig.
// Node arbeitet eine Anfrage nach der anderen ab, deshalb sind die Aktionen automatisch atomar.
const crypto = require('crypto');
const os = require('os');
const E = require('../public/engine.js');
const store = require('./store');

const ONLINE_MS = 20000;            // so lange gilt jemand nach dem letzten Heartbeat als online
const MAX_PARTICIPANTS = E.MAX_PLAYERS;
const KEEP_DAYS = 14;               // alte, unbenutzte Turniere werden aufgeräumt
const rooms = store.rooms;

const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const newToken = () => crypto.randomBytes(24).toString('hex');
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne verwechselbare Zeichen (0/O, 1/I)
const newCode = () => Array.from(crypto.randomBytes(6), (b) => ALPH[b % ALPH.length]).join('');

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg, status = 400) => { throw new HttpError(status, msg); };

const cleanName = (s, max = 24) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanChars = (a) => [...new Set((Array.isArray(a) ? a : []).filter((c) => E.ROSTER.includes(c)))].slice(0, 15);
const cleanLevel = (x) => (Number(x) === 1 ? 1 : 0);
const safeId = (s) => (typeof s === 'string' || typeof s === 'number') && /^[A-Za-z0-9-]{1,10}$/.test(String(s)) ? String(s) : bad('Ungültiges Match.');
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ---------- einfache Bremse gegen Durchprobieren ---------- */
const buckets = new Map();
function limit(key, max, ms) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now > b.t) { b = { n: 0, t: now + ms }; buckets.set(key, b); }
  if (++b.n > max) bad('Zu viele Anfragen – bitte kurz warten.', 429);
  if (buckets.size > 2000) for (const [k, v] of buckets) if (now > v.t) buckets.delete(k);
}

/* ---------- Netzwerk: unter welcher Adresse erreichen Freunde dieses Gerät? ---------- */
function lanBases() {
  if (process.env.PUBLIC_URL) return [process.env.PUBLIC_URL.replace(/\/+$/, '')];
  const port = process.env.PORT || 3000, out = [];
  const rank = (ip) => (/^192\.168\./.test(ip) ? 0 : /^10\./.test(ip) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : /^169\.254\./.test(ip) ? 9 : 5);
  Object.entries(os.networkInterfaces()).forEach(([name, list]) => (list || []).forEach((a) => {
    if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push({ ip: a.address, name, r: rank(a.address) });
  }));
  return out.sort((x, y) => x.r - y.r).map((a) => `http://${a.ip}:${port}`);
}
function ownAddresses() {
  const s = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
  Object.values(os.networkInterfaces()).forEach((l) => (l || []).forEach((a) => { s.add(a.address); s.add('::ffff:' + a.address); }));
  return s;
}
const isLocalAddress = (addr) => ownAddresses().has(String(addr || ''));
// Erstellen darf: das Host-Gerät selbst – oder (z. B. auf Render) jeder, der das Host-Passwort kennt, wenn ALLOW_REMOTE_CREATE=1 gesetzt ist
const canCreate = (local) => !!local || process.env.ALLOW_REMOTE_CREATE === '1';
const needsPassword = (local) => !local && process.env.ALLOW_REMOTE_CREATE === '1' && !!process.env.HOST_PASSWORD;
const samePw = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());

/* ---------- Raum / Identität ---------- */
function getRoom(code) {
  const r = rooms.get(code);
  if (!r) bad('Turnier nicht gefunden.', 404);
  return r;
}
function whoami(r, token) {
  if (!token) return { role: 'viewer', pid: null };
  const h = sha(token), p = r.parts.find((x) => x.tokenHash === h);
  return { role: h === r.hostHash ? 'host' : p ? 'player' : 'viewer', pid: p ? p.id : null };
}
// Aktuelle Profile (Name, Charaktere …) in die Spielerliste des Turniers übernehmen
function mergeProfiles(S, parts) {
  S.players.forEach((pl) => {
    if (pl.pid == null) return;
    const p = parts.find((x) => x.id === pl.pid);
    if (!p) return;
    pl.name = p.name; pl.alex = !!p.alex; pl.adv = p.level > 0 || !!p.alex; pl.ch = [...p.characters];
  });
}
/* ---------- Live-Verbindungen (socket.io): wer ist gerade verbunden? ---------- */
const live = new Map(); // Raumcode -> Map('host' | 'p<pid>' -> Anzahl offener Verbindungen)
// delta = +1 (verbunden) / -1 (getrennt). Gibt true zurück, wenn der Token zu einem Raum-Mitglied gehört.
function presence(code, token, delta) {
  const r = rooms.get(code);
  if (!r) return false;
  const me = whoami(r, token), keys = [];
  if (me.role === 'host') keys.push('host');
  if (me.pid != null) keys.push('p' + me.pid);
  if (!keys.length) return false;
  let m = live.get(code);
  if (!m) { m = new Map(); live.set(code, m); }
  keys.forEach((k) => {
    const n = Math.max(0, (m.get(k) || 0) + delta);
    m.set(k, n);
    if (n === 0 && delta < 0) { // Verbindung weg -> sofort offline (statt 20 s zu warten)
      if (k === 'host') r.hostSeen = null; else { const p = r.parts.find((x) => 'p' + x.id === k); if (p) p.lastSeen = null; }
    }
  });
  return true;
}
const roomCodeOf = (path) => { const m = String(path || '').match(/^\/api\/t\/([A-Za-z0-9]{4,12})\//); return m ? m[1].toUpperCase() : null; };

function bump(r) { r.version++; r.updatedAt = Date.now(); store.persist(); }

/* ---------- Sicht für den Browser ---------- */
function buildView(r, me) {
  const S = clone(r.S);
  mergeProfiles(S, r.parts);
  const now = Date.now();
  const lv = live.get(r.id) || new Map();
  const on = (t, key) => (lv.get(key) || 0) > 0 || (!!t && now - t < ONLINE_MS);
  const parts = r.parts.map((p) => ({ pid: p.id, name: p.name, level: p.level, alex: !!p.alex, ch: [...p.characters], isHost: !!p.isHost, online: on(p.lastSeen, 'p' + p.id) }));
  const hostOnline = on(r.hostSeen, 'host');
  const ph = parts.filter((p) => p.online).map((p) => p.pid).join(',') + '|' + (hostOnline ? 1 : 0);
  return {
    ok: true, v: r.version, ph,
    t: { code: r.id, name: r.name, phase: S.phase, nbots: S.nbots || 0 },
    me, parts, hostOnline, S,
    reports: r.reports.map((x) => ({ id: x.id, key: x.key, round: x.round, by: x.by, ka: x.ka, kb: x.kb })),
  };
}

/* ---------- Endpunkte ---------- */
function info(local) {
  return { ok: true, canCreate: canCreate(local), needsPassword: needsPassword(local), bases: lanBases() };
}

function createRoom(body, ip, local) {
  if (!canCreate(local)) bad('Turniere können nur am Host-Gerät erstellt werden. Scanne den QR-Code des Hosts, um beizutreten.', 403);
  if (needsPassword(local) && !samePw(body.password || '', process.env.HOST_PASSWORD)) { limit('pw:' + ip, 8, 600e3); bad('Falsches Host-Passwort.', 403); }
  limit('create:' + ip, 30, 3600e3);
  const name = cleanName(body.name, 40) || 'Smash Turnier';
  const token = newToken();
  const old = Date.now() - KEEP_DAYS * 86400e3;
  for (const [c, r] of rooms) if (r.updatedAt < old) rooms.delete(c);
  let code;
  do { code = newCode(); } while (rooms.has(code));
  rooms.set(code, {
    id: code, name, hostHash: sha(token), hostSeen: null, version: 1, createdAt: Date.now(), updatedAt: Date.now(),
    S: E.newState(0), parts: [], nextPid: 1, reports: [], nextRid: 1, history: [],
  });
  store.persist();
  return { ok: true, code, token };
}

function getState(code, query, token) {
  const r = getRoom(code), me = whoami(r, token), now = Date.now();
  if (me.role === 'host') r.hostSeen = now;                       // Heartbeat = Online-Status
  if (me.pid) r.parts.find((p) => p.id === me.pid).lastSeen = now;
  const view = buildView(r, me);
  if (query && String(query.v) === String(view.v) && query.ph === view.ph) return { ok: true, same: true, v: view.v, ph: view.ph };
  return view;
}

function joinRoom(code, body, ip) {
  limit('join:' + ip, 60, 600e3);
  const r = getRoom(code);
  if (r.S.phase !== 'lobby') bad('Das Turnier läuft schon – du kannst nur zuschauen.', 403);
  if (r.parts.length >= MAX_PARTICIPANTS) bad('Das Turnier ist voll (maximal ' + MAX_PARTICIPANTS + ' Spieler).', 403);
  const name = cleanName(body.name);
  if (!name) bad('Bitte gib einen Spielernamen an.');
  if (r.parts.some((p) => p.name.toLowerCase() === name.toLowerCase())) bad('Dieser Name ist schon vergeben.', 409);
  const token = newToken(), pid = r.nextPid++;
  r.parts.push({ id: pid, tokenHash: sha(token), name, level: cleanLevel(body.level), alex: false, characters: cleanChars(body.ch), isHost: false, lastSeen: null, joinedAt: Date.now() });
  bump(r);
  return { ok: true, token, pid };
}

function act(code, body, token, ip) {
  limit('act:' + ip, 600, 60e3);
  const r = getRoom(code), me = whoami(r, token);
  if (me.role === 'viewer') bad('Dafür bist du in diesem Turnier nicht angemeldet.', 403);
  const host = me.role === 'host';
  const onlyHost = () => { if (!host) bad('Das darf nur der Host.', 403); };
  const S = clone(r.S);                 // Arbeitskopie: bei einem Fehler bleibt der echte Zustand unverändert
  mergeProfiles(S, r.parts);
  const before = JSON.stringify(r.S);
  const commit = () => { r.S = S; bump(r); };
  const pushHist = () => { r.history.push(before); if (r.history.length > 60) r.history.shift(); };
  // führt eine Engine-Aktion aus; nur bei Erfolg wird gespeichert und der Verlauf ergänzt
  const mutate = (fn) => { const err = fn(); if (err) bad(err); pushHist(); commit(); };
  const myIdx = () => S.players.findIndex((p) => p.pid != null && p.pid === me.pid);
  const keyOf = (k, i) => k + ':' + i;
  const matchArgs = () => [body.k === 'g' ? 'g' : body.k === 'b' ? 'b' : bad('Ungültiges Match.'), safeId(body.i)];
  const partRow = (pid) => r.parts.find((p) => p.id === pid);
  const dropReports = (key) => { r.reports = key ? r.reports.filter((x) => x.key !== key) : []; };
  const ok = { ok: true };

  switch (body.type) {
    /* ---------- Teilnehmer: eigenes Profil ---------- */
    case 'profile': {
      if (!me.pid) bad('Du spielst in diesem Turnier nicht mit.', 403);
      const p = partRow(me.pid);
      const name = body.name !== undefined ? cleanName(body.name) : p.name;
      if (!name) bad('Der Name darf nicht leer sein.');
      if (r.parts.some((x) => x.id !== p.id && x.name.toLowerCase() === name.toLowerCase())) bad('Dieser Name ist schon vergeben.', 409);
      p.name = name;
      if (body.level !== undefined) p.level = cleanLevel(body.level);
      if (body.ch !== undefined) p.characters = cleanChars(body.ch);
      mergeProfiles(S, r.parts);
      commit();
      return ok;
    }

    /* ---------- Teilnehmer: Ergebnis melden / bestätigen ---------- */
    case 'report': {
      const [k, i] = matchArgs();
      const m = E.playable(S, k, i);
      if (!m) bad('Dieses Match ist gerade nicht spielbar.');
      const mi = myIdx();
      if (mi < 0 || (mi !== m.a && mi !== m.b)) bad('Du kannst nur Ergebnisse deiner eigenen Matches melden.', 403);
      const opp = mi === m.a ? m.b : m.a;
      if (S.players[opp].pid == null) bad('Gegen Bots trägt der Host das Ergebnis ein.', 403);
      const err = E.checkRound(S, m, Number(body.ka), Number(body.kb));
      if (err) bad(err);
      const key = keyOf(k, i);
      if (r.reports.some((x) => x.key === key)) bad('Für dieses Match wartet schon ein Ergebnis auf Bestätigung.', 409);
      r.reports.push({ id: r.nextRid++, key, round: m.games.length, by: me.pid, ka: Number(body.ka), kb: Number(body.kb) });
      bump(r);
      return ok;
    }
    case 'confirm':
    case 'reject': {
      const rep = r.reports.find((x) => x.id === Number(body.rid));
      if (!rep) bad('Diese Meldung gibt es nicht mehr.', 404);
      const [k, i] = rep.key.split(':');
      const m = E.find(S, k, i), mi = myIdx();
      const inMatch = !!m && mi >= 0 && (mi === m.a || mi === m.b);
      const isReporter = me.pid != null && me.pid === rep.by;
      if (body.type === 'confirm') {
        if (!host && !(inMatch && !isReporter)) bad('Nur der Gegner (oder der Host) kann das Ergebnis bestätigen.', 403);
        const pm = E.playable(S, k, i);
        if (!pm || rep.round !== pm.games.length) { dropReports(rep.key); bump(r); bad('Die Meldung ist veraltet und wurde entfernt.', 409); }
        mutate(() => E.addGame(S, k, i, rep.ka, rep.kb));
        dropReports(rep.key);
      } else {
        if (!host && !inMatch) bad('Das darfst du nicht.', 403);
        dropReports(rep.key);
        bump(r);
      }
      return ok;
    }

    /* ---------- Nur Host ---------- */
    case 'rename': {
      onlyHost();
      const name = cleanName(body.name, 40);
      if (!name) bad('Der Turniername darf nicht leer sein.');
      r.name = name; bump(r);
      return ok;
    }
    case 'hostPlay': {
      onlyHost();
      if (S.phase !== 'lobby') bad('Das geht nur, solange das Turnier noch nicht gestartet ist.');
      const own = r.parts.find((p) => p.tokenHash === r.hostHash);
      if (body.on && !own) {
        if (r.parts.length >= MAX_PARTICIPANTS) bad('Das Turnier ist voll.');
        const name = cleanName(body.name) || 'Host';
        if (r.parts.some((p) => p.name.toLowerCase() === name.toLowerCase())) bad('Dieser Name ist schon vergeben.', 409);
        r.parts.push({ id: r.nextPid++, tokenHash: r.hostHash, name, level: cleanLevel(body.level), alex: false, characters: cleanChars(body.ch), isHost: true, lastSeen: Date.now(), joinedAt: Date.now() });
      } else if (!body.on && own) {
        r.parts = r.parts.filter((p) => p !== own);
      }
      bump(r);
      return ok;
    }
    case 'kick': {
      onlyHost();
      if (S.phase !== 'lobby') bad('Während des Turniers kann niemand entfernt werden.');
      const p = partRow(Number(body.pid));
      if (!p) bad('Teilnehmer nicht gefunden.', 404);
      r.parts = r.parts.filter((x) => x !== p);
      bump(r);
      return ok;
    }
    case 'alex': {
      onlyHost();
      const p = partRow(Number(body.pid));
      if (!p) bad('Teilnehmer nicht gefunden.', 404);
      p.alex = !!body.on;
      mergeProfiles(S, r.parts);
      commit();
      return ok;
    }
    case 'bots': {
      onlyHost();
      if (S.phase !== 'lobby') bad('Bots lassen sich nur vor dem Start ändern.');
      S.nbots = Math.max(0, Math.min(E.MAX_PLAYERS, Math.floor(Number(body.n)) || 0));
      commit();
      return ok;
    }
    case 'start': {
      onlyHost();
      if (S.phase !== 'lobby') bad('Das Turnier läuft bereits.');
      mutate(() => E.start(S, r.parts.map((p) => ({ pid: p.id, name: p.name, adv: p.level > 0, alex: !!p.alex, ch: [...p.characters] }))));
      dropReports();
      return ok;
    }
    case 'reset': {
      onlyHost();
      pushHist();
      Object.assign(S, E.newState(S.nbots)); // Teilnehmer bleiben, alles andere wird geleert
      dropReports();
      commit();
      return ok;
    }
    case 'undo': {
      onlyHost();
      if (!r.history.length) bad('Nichts zum Rückgängigmachen.');
      const prev = JSON.parse(r.history.pop());
      mergeProfiles(prev, r.parts);
      r.S = prev;
      dropReports();
      bump(r);
      return ok;
    }
    case 'delete': {
      onlyHost();
      rooms.delete(code);
      store.persist();
      return { ok: true, deleted: true };
    }
    case 'add': {
      onlyHost();
      const [k, i] = matchArgs();
      mutate(() => E.addGame(S, k, i, Number(body.ka), Number(body.kb)));
      dropReports(keyOf(k, i));
      return ok;
    }
    case 'del': {
      onlyHost();
      const [k, i] = matchArgs();
      mutate(() => E.delGame(S, k, i));
      dropReports(keyOf(k, i));
      return ok;
    }
    case 'mv': { onlyHost(); mutate(() => E.moveUp(S, Number(body.g), Number(body.id))); return ok; }
    case 'conf': { onlyHost(); mutate(() => E.confirmGroup(S, Number(body.g))); return ok; }
    default:
      bad('Unbekannte Aktion.');
  }
}

/* ---------- Router ---------- */
const reply = (status, json) => ({ status, json });

// { method, path, query, body, headers, ip, local } -> { status, json }
// (wird sowohl vom HTTP-Server als auch von der socket.io-Verbindung aufgerufen)
// local = Anfrage kommt vom Host-Gerät selbst (nur dort lassen sich Turniere erstellen)
async function handle({ method, path, query = {}, body = {}, headers = {}, ip = '', local = false }) {
  try {
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
    body = body || {};
    const p = String(path || '').replace(/\/+$/, '');
    const auth = String(headers.authorization || headers.Authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';

    if (method === 'GET' && p === '/api/health') return reply(200, { ok: true });
    if (method === 'GET' && p === '/api/info') return reply(200, info(local));
    if (method === 'POST' && p === '/api/t') return reply(200, createRoom(body, ip, local));
    const m = p.match(/^\/api\/t\/([A-Za-z0-9]{4,12})\/(state|join|act)$/);
    if (m) {
      const code = m[1].toUpperCase();
      if (m[2] === 'state' && method === 'GET') return reply(200, getState(code, query, token));
      if (m[2] === 'join' && method === 'POST') return reply(200, joinRoom(code, body, ip));
      if (m[2] === 'act' && method === 'POST') return reply(200, act(code, body, token, ip));
    }
    return reply(404, { ok: false, error: 'Nicht gefunden.' });
  } catch (e) {
    if (e instanceof HttpError) return reply(e.status, { ok: false, error: e.message });
    console.error('API-Fehler:', e);
    return reply(500, { ok: false, error: 'Serverfehler. Bitte versuche es gleich noch einmal.' });
  }
}

module.exports = { handle, isLocalAddress, lanBases, presence, roomCodeOf };
