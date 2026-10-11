// Test der Live-Verbindung mit echtem Server und echten socket.io-Clients. Start: node test/socket.js
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const PORT = 3900 + Math.floor(Math.random() * 90);
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ FAIL:', m); } else console.log('  ✓', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL_ = 'http://localhost:' + PORT;

const connect = () => new Promise((res, rej) => { const s = io(URL_, { transports: ['websocket'], reconnection: false }); s.on('connect', () => res(s)); s.on('connect_error', rej); });
const api = (s, method, path, body, token) => new Promise((res) => s.emit('api', { method, path, body, query: {}, token }, res));
const waitEvent = (s, ev, ms = 2000) => new Promise((res) => { const t = setTimeout(() => res(false), ms); s.once(ev, (...a) => { clearTimeout(t); res(a.length ? a : true); }); });

(async () => {
  const srv = spawn(process.execPath, ['server.js'], { cwd: __dirname + '/..', env: { ...process.env, PORT, NO_OPEN: '1', DATA_FILE: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
  try {
    for (let i = 0; i < 40 && !/socket\.io aktiv/.test(log); i++) await sleep(100);
    ok(/socket\.io aktiv/.test(log), 'Server läuft mit aktiver Live-Verbindung');
    const page = await fetch(URL_ + '/socket.io/socket.io.js'); const txt = await page.text();
    ok(page.status === 200 && txt.length > 1000, 'Client-Bibliothek wird vom Server ausgeliefert (/socket.io/socket.io.js)');

    console.log('Verbinden & Raum erstellen (Host-Gerät)');
    const A = await connect();
    const cnt = waitEvent(A, 'online');
    const B = await connect(); const C = await connect(); const D = await connect();
    const c = await cnt; ok(c && c[0] >= 1, 'Online-Zähler wird gepusht (' + (c && c[0]) + ')');
    const cr = (await api(A, 'POST', '/api/t', { name: 'Live' })).json || (await api(A, 'POST', '/api/t', { name: 'Live' }));
    const code = cr.code, host = cr.token;
    ok(!!code, 'Raum über die Live-Verbindung erstellt: ' + code);
    await new Promise((r) => A.emit('watch', { code, token: host }, r));

    console.log('Push-Updates beim Beitritt');
    const gotChange = waitEvent(A, 'changed');
    const jb = (await api(B, 'POST', `/api/t/${code}/join`, { name: 'Bea' })).json;
    await new Promise((r) => B.emit('watch', { code, token: jb.token }, r));
    ok(!!(await gotChange), 'Host bekommt SOFORT "changed", wenn jemand beitritt');
    let st = (await api(A, 'GET', `/api/t/${code}/state`, null, host)).json;
    ok(st.parts.length === 1 && st.parts[0].online === true, 'Bea ist online (Live-Verbindung)');

    const jc = (await api(C, 'POST', `/api/t/${code}/join`, { name: 'Chris' })).json;
    await new Promise((r) => C.emit('watch', { code, token: jc.token }, r));
    const jd = (await api(D, 'POST', `/api/t/${code}/join`, { name: 'Dana' })).json;
    await new Promise((r) => D.emit('watch', { code, token: jd.token }, r));

    console.log('Sofort offline bei Verbindungsabbruch');
    const gone = waitEvent(A, 'changed');
    D.disconnect();
    ok(!!(await gone), 'Host wird informiert, wenn Dana die Verbindung verliert');
    st = (await api(A, 'GET', `/api/t/${code}/state`, null, host)).json;
    ok(st.parts.find((p) => p.name === 'Dana').online === false, 'Dana steht sofort auf offline (nicht erst nach 20 s)');
    ok(st.parts.find((p) => p.name === 'Bea').online === true, 'Bea bleibt online');

    console.log('Rechte über die Live-Verbindung');
    const bad = await api(B, 'POST', `/api/t/${code}/act`, { type: 'start' }, jb.token);
    ok(bad.status === 403, 'Teilnehmer darf nicht starten (403)');
    ok((await api(B, 'POST', `/api/t/${code}/act`, { type: 'start' }, 'gefälscht')).status === 403, 'Gefälschter Schlüssel hat keine Rechte');
    ok((await api(A, 'POST', `/api/t/${code}/act`, { type: 'bots', n: 0 }, host)).status === 200, 'Host darf Bots setzen');
    ok((await api(A, 'POST', `/api/t/${code}/act`, { type: 'start' }, host)).status === 200, 'Host startet das Turnier');

    console.log('Ergebnis melden/bestätigen live');
    st = (await api(A, 'GET', `/api/t/${code}/state`, null, host)).json;
    const idx = (name) => st.S.players.findIndex((p) => p.name === name);
    const ib = idx('Bea'), ic = idx('Chris');
    const mi = st.S.gm.findIndex((m) => (m.a === ib && m.b === ic) || (m.a === ic && m.b === ib));
    const m = st.S.gm[mi], beaIsA = m.a === ib;
    const pushed = waitEvent(C, 'changed');
    const rep = await api(B, 'POST', `/api/t/${code}/act`, { type: 'report', k: 'g', i: String(mi), ka: beaIsA ? 3 : 0, kb: beaIsA ? 0 : 3 }, jb.token);
    ok(rep.status === 200, 'Bea meldet Runde');
    ok(!!(await pushed), 'Chris sieht die Meldung sofort (Push)');
    st = (await api(C, 'GET', `/api/t/${code}/state`, null, jc.token)).json;
    ok(st.reports.length === 1, 'Meldung wartet auf Bestätigung');
    ok((await api(B, 'POST', `/api/t/${code}/act`, { type: 'confirm', rid: st.reports[0].id }, jb.token)).status === 403, 'Melderin kann sich nicht selbst bestätigen');
    ok((await api(C, 'POST', `/api/t/${code}/act`, { type: 'confirm', rid: st.reports[0].id }, jc.token)).status === 200, 'Chris bestätigt');
    st = (await api(A, 'GET', `/api/t/${code}/state`, null, host)).json;
    ok(st.S.gm[mi].games.length === 1, 'Runde ist eingetragen');

    console.log('HTTP und Live gemischt');
    const pushed2 = waitEvent(B, 'changed');
    const r = await fetch(`${URL_}/api/t/${code}/act`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + host }, body: JSON.stringify({ type: 'rename', name: 'Per HTTP umbenannt' }) });
    ok(r.status === 200, 'HTTP-Befehl funktioniert weiter (Fallback)');
    ok(!!(await pushed2), 'Live-Clients werden auch bei HTTP-Änderungen benachrichtigt');
    st = (await api(B, 'GET', `/api/t/${code}/state`, null, jb.token)).json;
    ok(st.t.name === 'Per HTTP umbenannt', 'Änderung kommt bei Bea an');

    [A, B, C].forEach((s) => s.disconnect());
  } finally { srv.kill(); }
  console.log(fails ? `\n${fails} FEHLER` : '\nALLE LIVE-TESTS BESTANDEN');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('Testabbruch:', e); process.exit(2); });
