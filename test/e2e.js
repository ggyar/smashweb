// Ende-zu-Ende-Test gegen die API (Speicher ohne Datenbank). Start: node test/e2e.js
process.env.DATA_FILE = '';
const { handle } = require('../lib/api');
const E = require('../public/engine.js');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ FAIL:', m); } else console.log('  ✓', m); };
let ipn = 0;
const call = (method, path, body, token, query) => handle({ method, path, body, query, headers: token ? { authorization: 'Bearer ' + token } : {}, ip: 'ip' + (ipn++ % 50), local: true });
const act = (code, tk, body) => call('POST', `/api/t/${code}/act`, body, tk);
const state = (code, tk, q) => call('GET', `/api/t/${code}/state`, null, tk, q);

(async () => {
  console.log('Anlegen & Beitreten');
  let r = await call('POST', '/api/t', { name: 'Testturnier' });
  ok(r.status === 200 && r.json.code && r.json.token, 'Turnier angelegt, Code ' + r.json.code);
  const code = r.json.code, host = r.json.token;
  const players = [];
  for (let i = 0; i < 7; i++) {
    const j = await call('POST', `/api/t/${code}/join`, { name: 'Spieler' + i, level: i % 3 === 0 ? 1 : 0 });
    ok(j.status === 200, 'Spieler' + i + ' beigetreten'); players.push({ tk: j.json.token, pid: j.json.pid, name: 'Spieler' + i });
  }
  r = await call('POST', `/api/t/${code}/join`, { name: 'spieler0' });
  ok(r.status === 409, 'doppelter Name abgelehnt');

  console.log('Rechte in der Lobby');
  ok((await act(code, players[0].tk, { type: 'start' })).status === 403, 'Teilnehmer darf NICHT starten');
  ok((await act(code, players[0].tk, { type: 'bots', n: 3 })).status === 403, 'Teilnehmer darf keine Bots setzen');
  ok((await act(code, players[0].tk, { type: 'alex', pid: players[1].pid, on: true })).status === 403, 'Teilnehmer darf kein Alex vergeben');
  ok((await act(code, players[0].tk, { type: 'kick', pid: players[1].pid })).status === 403, 'Teilnehmer darf niemanden entfernen');
  ok((await act(code, players[0].tk, { type: 'reset' })).status === 403, 'Teilnehmer darf nicht zurücksetzen');
  ok((await act(code, players[0].tk, { type: 'undo' })).status === 403, 'Teilnehmer darf kein Undo');
  ok((await act(code, players[0].tk, { type: 'delete' })).status === 403, 'Teilnehmer darf Turnier nicht löschen');
  ok((await act(code, 'falscher', { type: 'start' })).status === 403, 'Fremder/Zuschauer darf nichts');
  ok((await act(code, '', { type: 'profile', name: 'X' })).status === 403, 'Zuschauer darf kein Profil ändern');
  r = await act(code, players[2].tk, { type: 'profile', name: 'Neuer Name', level: 1, ch: ['Mario', 'Fox', 'Quatsch', 'Mario'] });
  ok(r.status === 200, 'Teilnehmer ändert eigenes Profil');
  let v = (await state(code, players[2].tk)).json;
  const me2 = v.parts.find((p) => p.pid === players[2].pid);
  ok(me2.name === 'Neuer Name' && me2.level === 1 && me2.ch.join() === 'Mario,Fox', 'Profil gespeichert, ungültige/doppelte Charaktere gefiltert');
  ok(v.me.role === 'player' && v.me.pid === players[2].pid, 'Rolle "player"');
  ok((await state(code, host)).json.me.role === 'host', 'Rolle "host"');
  ok((await state(code, '')).json.me.role === 'viewer', 'Rolle "viewer"');
  ok(!JSON.stringify(v).includes('token_hash') && !JSON.stringify(v).includes('host_hash'), 'keine Schlüssel-Hashes in der Antwort');

  console.log('Online-Status & Polling');
  r = (await state(code, host)).json;
  ok(r.hostOnline === true, 'Host ist online');
  ok(r.parts.find((p) => p.pid === players[2].pid).online === true, 'Teilnehmer, der gepollt hat, ist online');
  ok(r.parts.find((p) => p.pid === players[5].pid).online === false, 'Teilnehmer ohne Heartbeat ist offline');
  const same = (await state(code, host, { v: r.v, ph: r.ph })).json;
  ok(same.same === true, 'unveränderter Stand -> "same"');

  console.log('Host spielt mit, Bots, Alex');
  r = await act(code, host, { type: 'hostPlay', on: true, name: 'Hostie', level: 1 });
  ok(r.status === 200, 'Host spielt mit');
  v = (await state(code, host)).json;
  const hostPid = v.me.pid;
  ok(hostPid && v.parts.find((p) => p.isHost), 'Host hat eine Teilnehmer-Zeile');
  ok((await act(code, host, { type: 'alex', pid: players[3].pid, on: true })).status === 200, 'Host vergibt Alex');
  ok((await act(code, host, { type: 'bots', n: 2 })).status === 200, 'Host setzt 2 Bots');
  ok((await act(code, host, { type: 'start' })).status === 200, 'Host startet (7+1+2 = 10 Spieler)');
  v = (await state(code, host)).json;
  ok(v.t.phase === 'play' && v.S.groups.length === 4, 'Gruppenphase läuft, 4 Gruppen');
  ok(v.S.players.find((p) => p.alex) && v.S.players.filter((p) => p.bot).length === 2, 'Alex-Flag und 2 Bots im Turnier');
  r = await call('POST', `/api/t/${code}/join`, { name: 'Zuspät' });
  ok(r.status === 403, 'Beitritt nach Start nicht möglich');
  ok((await act(code, players[0].tk, { type: 'profile', ch: ['Link'] })).status === 200, 'Charakter nach Start änderbar');

  console.log('Ergebnis melden + Bestätigung durch Gegner');
  const idxOf = (pid) => v.S.players.findIndex((p) => p.pid === pid);
  const tokOf = (pid) => pid === hostPid ? host : players.find((p) => p.pid === pid).tk;
  const gm = v.S.gm.map((m, i) => ({ m, i })).find(({ m }) => v.S.players[m.a].pid && v.S.players[m.b].pid && v.S.players[m.a].pid !== hostPid && v.S.players[m.b].pid !== hostPid);
  const A = v.S.players[gm.m.a], B = v.S.players[gm.m.b];
  const stA = A.alex ? 2 : 3, stB = B.alex ? 2 : 3;
  const outsider = players.find((p) => p.pid !== A.pid && p.pid !== B.pid);
  ok(!!gm, 'Match ohne Host gefunden');
  ok((await act(code, outsider.tk, { type: 'report', k: 'g', i: String(gm.i), ka: stB, kb: 0 })).status === 403, 'Unbeteiligter darf kein Ergebnis melden');
  ok((await act(code, tokOf(A.pid), { type: 'report', k: 'g', i: String(gm.i), ka: 1, kb: 1 })).status === 400, 'unklares Ergebnis wird abgelehnt');
  ok((await act(code, tokOf(A.pid), { type: 'report', k: 'g', i: String(gm.i), ka: 9, kb: 0 })).status === 400, 'unmögliche Kills abgelehnt');
  r = await act(code, tokOf(A.pid), { type: 'report', k: 'g', i: String(gm.i), ka: stB, kb: 1 });
  ok(r.status === 200, 'A meldet Runde 1 (A gewinnt)');
  v = (await state(code, host)).json;
  ok(v.reports.length === 1 && v.S.gm[gm.i].games.length === 0, 'Meldung ist ausstehend, Ergebnis noch NICHT eingetragen');
  const rid = v.reports[0].id;
  ok((await act(code, tokOf(A.pid), { type: 'confirm', rid })).status === 403, 'Melder kann sich nicht selbst bestätigen');
  ok((await act(code, outsider.tk, { type: 'confirm', rid })).status === 403, 'Unbeteiligter kann nicht bestätigen');
  ok((await act(code, outsider.tk, { type: 'reject', rid })).status === 403, 'Unbeteiligter kann nicht ablehnen');
  ok((await act(code, tokOf(B.pid), { type: 'report', k: 'g', i: String(gm.i), ka: 0, kb: stA })).status === 409, 'zweite Meldung für dasselbe Match blockiert');
  ok((await act(code, tokOf(B.pid), { type: 'reject', rid })).status === 200, 'Gegner lehnt ab');
  v = (await state(code, host)).json;
  ok(v.reports.length === 0 && v.S.gm[gm.i].games.length === 0, 'abgelehnte Meldung entfernt, nichts eingetragen');
  await act(code, tokOf(A.pid), { type: 'report', k: 'g', i: String(gm.i), ka: stB, kb: 1 });
  v = (await state(code, host)).json;
  ok((await act(code, tokOf(B.pid), { type: 'confirm', rid: v.reports[0].id })).status === 200, 'Gegner bestätigt');
  v = (await state(code, host)).json;
  ok(v.S.gm[gm.i].games.length === 1 && v.reports.length === 0, 'Runde eingetragen, Meldung weg');
  ok((await act(code, tokOf(A.pid), { type: 'del', k: 'g', i: String(gm.i) })).status === 403, 'Teilnehmer darf Runde nicht löschen');
  ok((await act(code, tokOf(A.pid), { type: 'add', k: 'g', i: String(gm.i), ka: stB, kb: 0 })).status === 403, 'Teilnehmer darf nicht direkt eintragen');
  const bm = v.S.gm.findIndex((m) => v.S.players[m.a].bot || v.S.players[m.b].bot);
  const bmm = v.S.gm[bm]; const human = v.S.players[bmm.a].bot ? v.S.players[bmm.b] : v.S.players[bmm.a];
  ok((await act(code, tokOf(human.pid), { type: 'report', k: 'g', i: String(bm), ka: 0, kb: 0 })).status === 400 || true, '(Bot-Match)');
  r = await act(code, tokOf(human.pid), { type: 'report', k: 'g', i: String(bm), ka: 3, kb: 0 });
  ok(r.status === 403 || r.status === 400, 'gegen Bots kein Melden durch Teilnehmer (' + r.json.error + ')');

  console.log('Undo (Host)');
  ok((await act(code, host, { type: 'undo' })).status === 200, 'Host macht Bestätigung rückgängig');
  v = (await state(code, host)).json;
  ok(v.S.gm[gm.i].games.length === 0, 'Runde wieder weg');

  console.log('Komplettes Turnier durchspielen (gemischt: Teilnehmer melden/bestätigen, Host trägt Bot-Matches ein)');
  const rnd = (m, S) => { const a = Math.random() < .5, sa = S.players[m.a].alex ? 2 : 3, sb = S.players[m.b].alex ? 2 : 3; return a ? { ka: sb, kb: Math.floor(Math.random() * sa) } : { ka: Math.floor(Math.random() * sb), kb: sa }; };
  let n = 0;
  while (n++ < 600) {
    v = (await state(code, host)).json;
    if (v.t.phase === 'done') break;
    const opts = [];
    v.S.gm.forEach((m, i) => { if (!v.S.lock[m.g] && !E.isDone(v.S, m)) opts.push(['g', String(i), m]); });
    E.DEF.forEach((d) => { const M = v.S.m[d.id]; if (!M.done && !M.skip && E.isP(M.a) && E.isP(M.b)) opts.push(['b', d.id, M]); });
    if (!opts.length) {
      // evtl. Gleichstand in einer Gruppe -> Host bestätigt Reihenfolge
      const g = v.S.groups.findIndex((_, gi) => !v.S.lock[gi]);
      if (g >= 0) { const rr = await act(code, host, { type: 'conf', g }); if (rr.status === 200) continue; }
      ok(false, 'festgefahren'); break;
    }
    const [k, i, m] = opts[Math.random() * opts.length | 0];
    const q = rnd(m, v.S), pa = v.S.players[m.a], pb = v.S.players[m.b];
    if (pa.pid && pb.pid && Math.random() < .8) {
      const rep = await act(code, tokOf(pa.pid), { type: 'report', k, i, ...q });
      if (rep.status !== 200) { ok(false, 'Meldung fehlgeschlagen ' + rep.json.error); break; }
      const rs = (await state(code, host)).json.reports;
      const conf = await act(code, tokOf(pb.pid), { type: 'confirm', rid: rs[0].id });
      if (conf.status !== 200) { ok(false, 'Bestätigung fehlgeschlagen ' + conf.json.error); break; }
    } else {
      const rr = await act(code, host, { type: 'add', k, i, ...q });
      if (rr.status !== 200) { ok(false, 'Host-Eintrag fehlgeschlagen ' + rr.json.error); break; }
    }
  }
  v = (await state(code, host)).json;
  ok(v.t.phase === 'done', 'Turnier beendet (Phase done)');
  const T = E.tiers(v.S);
  ok(T.reduce((a, t) => a + t[1].length, 0) === 10 && new Set(T.flatMap((t) => t[1])).size === 10, 'Alle 10 Spieler haben genau eine Platzierung');
  ok(v.reports.length === 0, 'keine offenen Meldungen am Ende');

  console.log('Reset & Löschen');
  ok((await act(code, host, { type: 'reset' })).status === 200, 'Host setzt zurück');
  v = (await state(code, host)).json;
  ok(v.t.phase === 'lobby' && v.parts.length === 8, 'zurück in der Lobby, Teilnehmer bleiben');
  ok((await act(code, host, { type: 'undo' })).status === 200 && (await state(code, host)).json.t.phase === 'done', 'Undo nach Reset stellt das Turnier wieder her');
  ok((await act(code, host, { type: 'delete' })).json.deleted === true, 'Host löscht Turnier');
  ok((await state(code, host)).status === 404, 'danach 404');

  console.log('Raum nur am Host-Gerät erstellbar');
  const remote = await handle({ method: 'POST', path: '/api/t', body: { name: 'Fremd' }, headers: {}, ip: 'x', local: false });
  ok(remote.status === 403, 'Von einem anderen Gerät (nicht Host-Gerät) lässt sich KEIN Turnier erstellen');
  const inf = (await handle({ method: 'GET', path: '/api/info', headers: {}, ip: 'x', local: false })).json;
  ok(inf.canCreate === false && Array.isArray(inf.bases), '/api/info: Gast darf nicht erstellen, liefert LAN-Adressen');
  ok((await handle({ method: 'GET', path: '/api/info', headers: {}, ip: 'x', local: true })).json.canCreate === true, '/api/info: Host-Gerät darf erstellen');
  const cj = (await call('POST', '/api/t', { name: 'Gast-Beitritt' })).json;
  const gj = await handle({ method: 'POST', path: `/api/t/${cj.code}/join`, body: { name: 'Gast' }, headers: {}, ip: 'g1', local: false });
  ok(gj.status === 200, 'Ein Gast (anderes Gerät) kann trotzdem beitreten');

  console.log('Host-Passwort (Betrieb auf Render)');
  process.env.ALLOW_REMOTE_CREATE = '1'; process.env.HOST_PASSWORD = 'geheim';
  const rem = (b) => handle({ method: 'POST', path: '/api/t', body: b, headers: {}, ip: 'pw' + Math.random(), local: false });
  ok((await rem({ name: 'X' })).status === 403, 'Ohne Passwort kein Turnier (Fremder)');
  ok((await rem({ name: 'X', password: 'falsch' })).status === 403, 'Falsches Passwort abgelehnt');
  ok((await rem({ name: 'X', password: 'geheim' })).status === 200, 'Richtiges Passwort: Turnier wird erstellt');
  ok((await handle({ method: 'GET', path: '/api/info', headers: {}, ip: 'x', local: false })).json.needsPassword === true, '/api/info meldet "Passwort nötig"');
  delete process.env.ALLOW_REMOTE_CREATE; delete process.env.HOST_PASSWORD;
  ok((await rem({ name: 'X' })).status === 403, 'Ohne ALLOW_REMOTE_CREATE bleibt Erstellen gesperrt');

  console.log('Speichern auf Platte (Neustart)');
  const fs = require('fs'), os = require('os'), pth = require('path'), store = require('../lib/store');
  const tmp = pth.join(os.tmpdir(), 'smash-test-' + Date.now() + '.json');
  process.env.DATA_FILE = tmp;
  const cp = (await call('POST', '/api/t', { name: 'Neustart' })).json;
  const jp = (await call('POST', `/api/t/${cp.code}/join`, { name: 'Bleibt' })).json;
  store.flush();
  ok(fs.existsSync(tmp), 'Datei geschrieben');
  const loaded = store.load();
  ok(loaded >= 1 && (await state(cp.code, jp.token)).json.me.role === 'player', 'Nach "Neustart" sind Turnier und Teilnehmer-Schlüssel noch da');
  ok((await state(cp.code, cp.token)).json.me.role === 'host', 'Host-Schlüssel gilt weiter');
  fs.unlinkSync(tmp); process.env.DATA_FILE = '';

  console.log('Verschiedene Teilnehmerzahlen starten (3, 5, 24)');
  for (const N of [3, 5, 24]) {
    const c2 = (await call('POST', '/api/t', { name: 'T' + N })).json;
    for (let i = 0; i < N; i++) await call('POST', `/api/t/${c2.code}/join`, { name: 'P' + i });
    const s = await act(c2.code, c2.token, { type: 'start' });
    const vv = (await state(c2.code, c2.token)).json;
    ok(s.status === 200 && vv.S.players.length === N, N + ' Spieler -> ' + vv.S.groups.map((g) => g.length).join('/'));
  }
  const c3 = (await call('POST', '/api/t', { name: 'zu klein' })).json;
  await call('POST', `/api/t/${c3.code}/join`, { name: 'Einzel' });
  ok((await act(c3.code, c3.token, { type: 'start' })).status === 400, 'weniger als 3 Spieler -> Start abgelehnt');
  const c4 = (await call('POST', '/api/t', { name: 'voll' })).json;
  let last; for (let i = 0; i < 25; i++) last = await call('POST', `/api/t/${c4.code}/join`, { name: 'V' + i });
  ok(last.status === 403, 'Spieler Nr. 25 wird abgelehnt (fester Baum für 24)');

  {
  console.log('Gleichzeitige Zugriffe');
    const c5 = (await call('POST', '/api/t', { name: 'parallel' })).json;
    const res = await Promise.all(Array.from({ length: 30 }, (_, i) => call('POST', `/api/t/${c5.code}/join`, { name: 'Par' + i })));
    const okN = res.filter((x) => x.status === 200).length;
    ok(okN === 24, '30 gleichzeitige Beitritte -> genau 24 Plätze vergeben (' + okN + ')');
    const st5 = (await state(c5.code, c5.token)).json;
    ok(new Set(st5.parts.map((p) => p.name)).size === st5.parts.length && st5.parts.length === 24, 'keine doppelten Teilnehmer');
    const ver = st5.v;
    await Promise.all(Array.from({ length: 10 }, (_, i) => act(c5.code, c5.token, { type: 'bots', n: i })));
    ok((await state(c5.code, c5.token)).json.v === ver + 10, '10 gleichzeitige Host-Aktionen -> Version +10 (nichts verloren)');
  }

  console.log(fails ? `\n${fails} FEHLER` : '\nALLE TESTS BESTANDEN');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('Testabbruch:', e); process.exit(2); });
