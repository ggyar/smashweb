// API-Logik – wird von server.js (Render) und api/[...slug].js (Vercel) gemeinsam genutzt.
// Alle Berechtigungen werden HIER geprüft, nie im Browser.
const crypto = require('crypto');
const E = require('../public/engine.js');
const db = require('./db');

const ONLINE_MS = 20000; // so lange gilt jemand nach dem letzten Heartbeat als online
const BEAT_MS = 5000;    // Heartbeat wird höchstens alle 5 s geschrieben
const MAX_PARTICIPANTS = E.MAX_PLAYERS;

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

/* ---------- einfache Bremse gegen Missbrauch (pro Instanz) ---------- */
const buckets = new Map();
function limit(key, max, ms) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now > b.t) { b = { n: 0, t: now + ms }; buckets.set(key, b); }
  if (++b.n > max) bad('Zu viele Anfragen – bitte kurz warten.', 429);
  if (buckets.size > 5000) for (const [k, v] of buckets) if (now > v.t) buckets.delete(k);
}

/* ---------- Laden / Identität ---------- */
async function load(c, code, lock) {
  const r = await c.query('SELECT * FROM tournaments WHERE id=$1' + (lock ? db.lockClause : ''), [code]);
  if (!r.rows.length) bad('Turnier nicht gefunden.', 404);
  return r.rows[0];
}
const loadParts = async (c, code) => (await c.query('SELECT * FROM participants WHERE tournament_id=$1 ORDER BY id', [code])).rows;
const loadReports = async (c, code) => (await c.query('SELECT * FROM reports WHERE tournament_id=$1 ORDER BY id', [code])).rows;

function whoami(t, ps, token) {
  if (!token) return { role: 'viewer', pid: null };
  const h = sha(token), p = ps.find((x) => x.token_hash === h);
  return { role: h === t.host_hash ? 'host' : p ? 'player' : 'viewer', pid: p ? p.id : null };
}

// Aktuelle Profile (Name, Charaktere …) in die Spielerliste des Turniers übernehmen
function mergeProfiles(S, ps) {
  S.players.forEach((pl) => {
    if (pl.pid == null) return;
    const p = ps.find((x) => x.id === pl.pid);
    if (!p) return;
    pl.name = p.name; pl.alex = !!p.alex; pl.adv = p.level > 0 || !!p.alex; pl.ch = db.json(p.characters) || [];
  });
}

/* ---------- Schreiben ---------- */
async function pushHistory(c, code, before) {
  await c.query('INSERT INTO history (tournament_id, state) VALUES ($1,$2::jsonb)', [code, before]);
  const old = await c.query('SELECT id FROM history WHERE tournament_id=$1 ORDER BY id DESC LIMIT 100 OFFSET 60', [code]);
  if (old.rows.length) await c.query('DELETE FROM history WHERE id IN (' + old.rows.map((r) => Number(r.id)).join(',') + ')');
}
async function save(c, t, S) {
  await c.query('UPDATE tournaments SET state=$2::jsonb, phase=$3, nbots=$4, version=version+1, updated_at=$5 WHERE id=$1',
    [t.id, JSON.stringify(S), S.phase, S.nbots || 0, new Date()]);
}
const dropReports = (c, code, key) => key
  ? c.query('DELETE FROM reports WHERE tournament_id=$1 AND match_key=$2', [code, key])
  : c.query('DELETE FROM reports WHERE tournament_id=$1', [code]);

/* ---------- Sicht für den Browser ---------- */
function buildView(t, ps, reps, me) {
  const S = db.json(t.state);
  mergeProfiles(S, ps);
  const now = Date.now();
  const on = (d) => !!d && now - new Date(d).getTime() < ONLINE_MS;
  const parts = ps.map((p) => ({ pid: p.id, name: p.name, level: p.level, alex: !!p.alex, ch: db.json(p.characters) || [], isHost: !!p.is_host, online: on(p.last_seen) }));
  const hostOnline = on(t.host_seen);
  const ph = parts.filter((p) => p.online).map((p) => p.pid).join(',') + '|' + (hostOnline ? 1 : 0);
  return {
    ok: true, v: t.version, ph,
    t: { code: t.id, name: t.name, phase: t.phase, nbots: t.nbots },
    me: { role: me.role, pid: me.pid },
    parts, hostOnline, S,
    reports: reps.map((r) => ({ id: r.id, key: r.match_key, round: r.round_no, by: r.reporter_pid, ka: r.ka, kb: r.kb })),
  };
}

/* ---------- Endpunkte ---------- */
async function createTournament(body, ip) {
  limit('create:' + ip, 15, 3600e3);
  const name = cleanName(body.name, 40) || 'Smash Turnier';
  const token = newToken();
  try { await db.query('DELETE FROM tournaments WHERE updated_at < $1', [new Date(Date.now() - 30 * 86400e3)]); } catch (_) { /* Aufräumen ist optional */ }
  for (let i = 0; i < 8; i++) {
    const code = newCode();
    try {
      await db.query('INSERT INTO tournaments (id, name, host_hash, state) VALUES ($1,$2,$3,$4::jsonb)', [code, name, sha(token), JSON.stringify(E.newState(0))]);
      return { ok: true, code, token };
    } catch (e) {
      if (!/unique|duplicate|23505/i.test(String(e.code) + e.message)) throw e;
    }
  }
  bad('Konnte keinen freien Code erzeugen.', 500);
}

async function getState(code, query, token) {
  const r = await db.query('SELECT * FROM tournaments WHERE id=$1', [code]);
  if (!r.rows.length) bad('Turnier nicht gefunden.', 404);
  const t = r.rows[0];
  const ps = (await db.query('SELECT * FROM participants WHERE tournament_id=$1 ORDER BY id', [code])).rows;
  const me = whoami(t, ps, token);
  // Heartbeat = Online-Status
  const now = new Date(), cut = new Date(now.getTime() - BEAT_MS);
  if (me.role === 'host') {
    if (!t.host_seen || new Date(t.host_seen) < cut) await db.query('UPDATE tournaments SET host_seen=$2 WHERE id=$1', [code, now]);
    t.host_seen = now;
  }
  if (me.pid) {
    const p = ps.find((x) => x.id === me.pid);
    if (!p.last_seen || new Date(p.last_seen) < cut) await db.query('UPDATE participants SET last_seen=$2 WHERE id=$1', [p.id, now]);
    p.last_seen = now;
  }
  const reps = (await db.query('SELECT * FROM reports WHERE tournament_id=$1 ORDER BY id', [code])).rows;
  const view = buildView(t, ps, reps, me);
  if (query && String(query.v) === String(view.v) && query.ph === view.ph) return { ok: true, same: true, v: view.v, ph: view.ph };
  return view;
}

async function joinTournament(code, body, ip) {
  limit('join:' + ip, 40, 600e3);
  return db.tx(async (c) => {
    const t = await load(c, code, true);
    if (t.phase !== 'lobby') bad('Das Turnier läuft schon – du kannst nur zuschauen.', 403);
    const ps = await loadParts(c, code);
    if (ps.length >= MAX_PARTICIPANTS) bad('Das Turnier ist voll (maximal ' + MAX_PARTICIPANTS + ' Spieler).', 403);
    const name = cleanName(body.name);
    if (!name) bad('Bitte gib einen Spielernamen an.');
    if (ps.some((p) => p.name.toLowerCase() === name.toLowerCase())) bad('Dieser Name ist schon vergeben.', 409);
    const token = newToken();
    const r = await c.query('INSERT INTO participants (tournament_id, token_hash, name, level, characters) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING id',
      [code, sha(token), name, cleanLevel(body.level), JSON.stringify(cleanChars(body.ch))]);
    await c.query('UPDATE tournaments SET version=version+1, updated_at=$2 WHERE id=$1', [code, new Date()]);
    return { ok: true, token, pid: r.rows[0].id };
  });
}

async function act(code, body, token, ip) {
  limit('act:' + ip, 300, 60e3);
  return db.tx(async (c) => {
    const t = await load(c, code, true);
    let ps = await loadParts(c, code);
    const me = whoami(t, ps, token);
    if (me.role === 'viewer') bad('Dafür bist du in diesem Turnier nicht angemeldet.', 403);
    const host = me.role === 'host';
    const onlyHost = () => { if (!host) bad('Das darf nur der Host.', 403); };
    const S = db.json(t.state);
    mergeProfiles(S, ps);
    const before = JSON.stringify(S);
    const snap = () => pushHistory(c, code, before);
    const myIdx = () => S.players.findIndex((p) => p.pid != null && p.pid === me.pid);
    const keyOf = (k, i) => k + ':' + i;
    const matchArgs = () => {
      const k = body.k === 'g' ? 'g' : body.k === 'b' ? 'b' : bad('Ungültiges Match.');
      return [k, safeId(body.i)];
    };
    const partRow = (pid) => ps.find((p) => p.id === pid);
    let result = { ok: true };

    switch (body.type) {
      /* ---------- Teilnehmer: eigenes Profil ---------- */
      case 'profile': {
        if (!me.pid) bad('Du spielst in diesem Turnier nicht mit.', 403);
        const p = partRow(me.pid);
        const name = body.name !== undefined ? cleanName(body.name) : p.name;
        if (!name) bad('Der Name darf nicht leer sein.');
        if (ps.some((x) => x.id !== p.id && x.name.toLowerCase() === name.toLowerCase())) bad('Dieser Name ist schon vergeben.', 409);
        const level = body.level !== undefined ? cleanLevel(body.level) : p.level;
        const chars = body.ch !== undefined ? cleanChars(body.ch) : (db.json(p.characters) || []);
        await c.query('UPDATE participants SET name=$2, level=$3, characters=$4::jsonb WHERE id=$1', [p.id, name, level, JSON.stringify(chars)]);
        Object.assign(p, { name, level, characters: chars });
        mergeProfiles(S, ps);
        await save(c, t, S);
        break;
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
        const ex = await c.query('SELECT id FROM reports WHERE tournament_id=$1 AND match_key=$2', [code, key]);
        if (ex.rows.length) bad('Für dieses Match wartet schon ein Ergebnis auf Bestätigung.', 409);
        await c.query('INSERT INTO reports (tournament_id, match_key, round_no, reporter_pid, ka, kb) VALUES ($1,$2,$3,$4,$5,$6)',
          [code, key, m.games.length, me.pid, Number(body.ka), Number(body.kb)]);
        await c.query('UPDATE tournaments SET version=version+1, updated_at=$2 WHERE id=$1', [code, new Date()]);
        return result;
      }
      case 'confirm':
      case 'reject': {
        const r = (await c.query('SELECT * FROM reports WHERE id=$1 AND tournament_id=$2', [Number(body.rid) || 0, code])).rows[0];
        if (!r) bad('Diese Meldung gibt es nicht mehr.', 404);
        const [k, i] = r.match_key.split(':');
        const m = E.find(S, k, i);
        const mi = myIdx();
        const inMatch = !!m && mi >= 0 && (mi === m.a || mi === m.b);
        const isReporter = me.pid != null && me.pid === r.reporter_pid;
        if (body.type === 'confirm') {
          if (!host && !(inMatch && !isReporter)) bad('Nur der Gegner (oder der Host) kann das Ergebnis bestätigen.', 403);
          const pm = E.playable(S, k, i);
          if (!pm || r.round_no !== pm.games.length) { await dropReports(c, code, r.match_key); await c.query('UPDATE tournaments SET version=version+1 WHERE id=$1', [code]); bad('Die Meldung ist veraltet und wurde entfernt.', 409); }
          await snap();
          const err = E.addGame(S, k, i, r.ka, r.kb);
          if (err) bad(err);
          await dropReports(c, code, r.match_key);
          await save(c, t, S);
        } else {
          if (!host && !inMatch) bad('Das darfst du nicht.', 403);
          await dropReports(c, code, r.match_key);
          await c.query('UPDATE tournaments SET version=version+1, updated_at=$2 WHERE id=$1', [code, new Date()]);
        }
        return result;
      }

      /* ---------- Nur Host ---------- */
      case 'rename': {
        onlyHost();
        const name = cleanName(body.name, 40);
        if (!name) bad('Der Turniername darf nicht leer sein.');
        await c.query('UPDATE tournaments SET name=$2, version=version+1, updated_at=$3 WHERE id=$1', [code, name, new Date()]);
        return result;
      }
      case 'hostPlay': {
        onlyHost();
        if (S.phase !== 'lobby') bad('Das geht nur, solange das Turnier noch nicht gestartet ist.');
        const own = ps.find((p) => p.token_hash === t.host_hash);
        if (body.on && !own) {
          if (ps.length >= MAX_PARTICIPANTS) bad('Das Turnier ist voll.');
          const name = cleanName(body.name) || 'Host';
          if (ps.some((p) => p.name.toLowerCase() === name.toLowerCase())) bad('Dieser Name ist schon vergeben.', 409);
          await c.query('INSERT INTO participants (tournament_id, token_hash, name, level, characters, is_host) VALUES ($1,$2,$3,$4,$5::jsonb,true)',
            [code, t.host_hash, name, cleanLevel(body.level), JSON.stringify(cleanChars(body.ch))]);
        } else if (!body.on && own) {
          await c.query('DELETE FROM participants WHERE id=$1', [own.id]);
        }
        await c.query('UPDATE tournaments SET version=version+1, updated_at=$2 WHERE id=$1', [code, new Date()]);
        return result;
      }
      case 'kick': {
        onlyHost();
        if (S.phase !== 'lobby') bad('Während des Turniers kann niemand entfernt werden.');
        const p = partRow(Number(body.pid));
        if (!p) bad('Teilnehmer nicht gefunden.', 404);
        await c.query('DELETE FROM participants WHERE id=$1', [p.id]);
        await c.query('UPDATE tournaments SET version=version+1, updated_at=$2 WHERE id=$1', [code, new Date()]);
        return result;
      }
      case 'alex': {
        onlyHost();
        const p = partRow(Number(body.pid));
        if (!p) bad('Teilnehmer nicht gefunden.', 404);
        await c.query('UPDATE participants SET alex=$2 WHERE id=$1', [p.id, !!body.on]);
        p.alex = !!body.on;
        mergeProfiles(S, ps);
        await save(c, t, S);
        break;
      }
      case 'bots': {
        onlyHost();
        if (S.phase !== 'lobby') bad('Bots lassen sich nur vor dem Start ändern.');
        S.nbots = Math.max(0, Math.min(E.MAX_PLAYERS, Math.floor(Number(body.n)) || 0));
        await save(c, t, S);
        break;
      }
      case 'start': {
        onlyHost();
        if (S.phase !== 'lobby') bad('Das Turnier läuft bereits.');
        await snap();
        const err = E.start(S, ps.map((p) => ({ pid: p.id, name: p.name, adv: p.level > 0, alex: !!p.alex, ch: db.json(p.characters) || [] })));
        if (err) bad(err);
        await dropReports(c, code);
        await save(c, t, S);
        break;
      }
      case 'reset': {
        onlyHost();
        await snap();
        const fresh = E.newState(S.nbots);
        await dropReports(c, code);
        await save(c, t, fresh);
        break;
      }
      case 'undo': {
        onlyHost();
        const h = (await c.query('SELECT id, state FROM history WHERE tournament_id=$1 ORDER BY id DESC LIMIT 1', [code])).rows[0];
        if (!h) bad('Nichts zum Rückgängigmachen.');
        const prev = db.json(h.state);
        await c.query('DELETE FROM history WHERE id=$1', [h.id]);
        mergeProfiles(prev, ps);
        await dropReports(c, code);
        await save(c, t, prev);
        break;
      }
      case 'delete': {
        onlyHost();
        await c.query('DELETE FROM tournaments WHERE id=$1', [code]);
        return { ok: true, deleted: true };
      }
      case 'add': {
        onlyHost();
        const [k, i] = matchArgs();
        await snap();
        const err = E.addGame(S, k, i, Number(body.ka), Number(body.kb));
        if (err) bad(err);
        await dropReports(c, code, keyOf(k, i));
        await save(c, t, S);
        break;
      }
      case 'del': {
        onlyHost();
        const [k, i] = matchArgs();
        await snap();
        const err = E.delGame(S, k, i);
        if (err) bad(err);
        await dropReports(c, code, keyOf(k, i));
        await save(c, t, S);
        break;
      }
      case 'mv': {
        onlyHost();
        await snap();
        const err = E.moveUp(S, Number(body.g), Number(body.id));
        if (err) bad(err);
        await save(c, t, S);
        break;
      }
      case 'conf': {
        onlyHost();
        await snap();
        const err = E.confirmGroup(S, Number(body.g));
        if (err) bad(err);
        await save(c, t, S);
        break;
      }
      default:
        bad('Unbekannte Aktion.');
    }
    return result;
  });
}

/* ---------- Router ---------- */
const reply = (status, json) => ({ status, json });

async function handle({ method, path, query = {}, body = {}, headers = {}, ip = '' }) {
  try {
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
    body = body || {};
    const p = String(path || '').replace(/\/+$/, '');
    const auth = String(headers.authorization || headers.Authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';

    if (method === 'GET' && p === '/api/health') { await db.query('SELECT 1'); return reply(200, { ok: true }); }
    if (method === 'POST' && p === '/api/t') return reply(200, await createTournament(body, ip));
    const m = p.match(/^\/api\/t\/([A-Za-z0-9]{4,12})\/(state|join|act)$/);
    if (m) {
      const code = m[1].toUpperCase();
      if (m[2] === 'state' && method === 'GET') return reply(200, await getState(code, query, token));
      if (m[2] === 'join' && method === 'POST') return reply(200, await joinTournament(code, body, ip));
      if (m[2] === 'act' && method === 'POST') return reply(200, await act(code, body, token, ip));
    }
    return reply(404, { ok: false, error: 'Nicht gefunden.' });
  } catch (e) {
    if (e instanceof HttpError) return reply(e.status, { ok: false, error: e.message });
    if (e && e.code === 'NO_DB') return reply(503, { ok: false, error: 'Die Datenbank ist nicht eingerichtet (DATABASE_URL fehlt).' });
    console.error('API-Fehler:', e);
    return reply(500, { ok: false, error: 'Serverfehler. Bitte versuche es gleich noch einmal.' });
  }
}

module.exports = { handle };
