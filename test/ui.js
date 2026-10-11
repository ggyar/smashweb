// UI-Rauchtest: mehrere "Browser" (jsdom) gegen die echte API-Logik. Start: node test/ui.js
process.env.DATA_FILE = '';
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const { handle } = require('../lib/api');
const PUB = path.join(__dirname, '..', 'public');
const scripts = ['engine.js', 'icons.js', 'qr.js', 'app.js'].map((f) => fs.readFileSync(path.join(PUB, f), 'utf8'));
const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8').replace(/<script[^>]*><\/script>/g, '');
let fails = 0, n = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ FAIL:', m); } else console.log('  ✓', m); };

function browser(url, local = true) {
  const dom = new JSDOM(html, { url: 'http://localhost' + url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const errors = [];
  w.addEventListener('error', (e) => errors.push(e.message));
  w.setTimeout = () => 0; // kein automatisches Polling im Test
  w.alert = () => {}; w.confirm = () => true; w.prompt = () => '';
  const ip = 'b' + (n++);
  w.fetch = async (u, o = {}) => {
    const x = new URL(u, 'http://localhost');
    const out = await handle({ method: o.method || 'GET', path: x.pathname, query: Object.fromEntries(x.searchParams), body: o.body ? JSON.parse(o.body) : {}, headers: o.headers || {}, ip, local });
    return { ok: out.status < 400, status: out.status, json: async () => out.json };
  };
  w.eval('"use strict"; undefined');
  w.eval(scripts.join('\n;\n') + '\n;window.__ev = (c) => eval(c);');
  return {
    w, errors,
    ev: (c) => w.__ev(c),
    app: () => w.document.getElementById('app').innerHTML,
    hero: () => w.document.getElementById('hero').innerHTML,
    set: (id, v) => { w.document.getElementById(id).value = v; },
    poll: () => w.__ev('poll(true)'),
  };
}

(async () => {
  console.log('Startseite');
  const A = browser('/'); await A.ev('loadInfo()');
  ok(/Turnier hosten/.test(A.app()) && /Turnier beitreten/.test(A.app()), 'Startseite zeigt Hosten + Beitreten');
  A.set('hname', 'UI-Turnier');
  await A.ev('createT()'); await A.poll();
  const code = A.w.location.pathname.split('/')[2];
  ok(/^[A-Z0-9]{6}$/.test(code), 'Host landet auf /t/' + code);
  ok(/<svg[^>]*viewBox/.test(A.app()) && A.app().includes(code), 'Lobby zeigt QR-Code (SVG) und Code');
  ok(A.app().includes('Host-Bereich') && /Gruppen auslosen/.test(A.app()), 'Host sieht Host-Bereich mit Start-Button');
  ok(A.hero().includes('Host'), 'Kopfzeile zeigt Rolle Host');

  const G = browser('/', false); await G.ev('loadInfo()');
  ok(!/Turnier hosten/.test(G.app()) && /Turnier beitreten/.test(G.app()), 'Gast-Gerät: kein "Turnier hosten", nur Beitreten');

  console.log('Teilnehmer treten per Link bei');
  const names = ['Bea', 'Chris', 'Dana'];
  const B = [];
  for (const nme of names) {
    const b = browser('/t/' + code, false);
    await b.poll();
    ok(/Beitreten/.test(b.app()) && !/Host-Bereich/.test(b.app()), nme + ': sieht Beitritts-Formular, KEINEN Host-Bereich');
    b.set('jname', nme); await b.ev('joinT()'); await b.poll();
    ok(b.app().includes('Mein Profil') && b.hero().includes('Teilnehmer'), nme + ': ist beigetreten, Rolle Teilnehmer');
    B.push(b);
  }
  B[0].ev("addChar('Mario')"); await B[0].ev("addChar('Fox')");
  await A.poll();
  ok(A.app().includes('Bea') && A.app().includes('Chris') && A.app().includes('Dana'), 'Host sieht alle 3 Teilnehmer live');
  ok(A.app().includes('Mario › Fox'), 'Host sieht die Charakterliste von Bea');
  ok(/class="dot on"/.test(A.app()), 'Online-Punkt sichtbar');
  ok(!B[1].app().includes('Host-Bereich') && !B[1].app().includes('Alex</button>'), 'Teilnehmer sieht keine Host-Buttons (Alex/Kick/Start)');

  console.log('Start durch Host');
  await A.ev("doAct({type:'start'})");
  ok(A.ev('S.phase') === 'play', 'Turnier gestartet');
  await B[0].poll(); await B[1].poll(); await B[2].poll();
  ok(B[0].ev("tab") === 'bracket', 'Teilnehmer wird automatisch zum Turnier-Tab geschaltet');
  ok(/Jetzt spielbar/.test(B[0].app()), 'Turnierbaum-Ansicht rendert');

  console.log('Ergebnis melden / bestätigen');
  const idxBea = B[0].ev("myIdx()"), idxChris = B[1].ev("myIdx()");
  const mi = B[0].ev(`S.gm.findIndex(m => (m.a===${idxBea}&&m.b===${idxChris})||(m.b===${idxBea}&&m.a===${idxChris}))`);
  ok(mi >= 0, 'Match Bea–Chris gefunden (#' + mi + ')');
  const m = B[0].ev(`JSON.stringify(S.gm[${mi}])`);
  const aIsBea = JSON.parse(m).a === idxBea;
  await B[0].ev("tab='groups';render()");
  ok(/Kills Bea/.test(B[0].app().replace(/<[^>]+>/g, ' ')) || B[0].app().includes('Melden'), 'Bea sieht ihr Melde-Formular');
  B[0].ev(`ent('g:${mi}',${aIsBea ? 0 : 1},3)`); B[0].ev(`ent('g:${mi}',${aIsBea ? 1 : 0},1)`);
  await B[0].ev(`sendRound('g','${mi}')`);
  await B[1].poll(); await B[2].poll(); await A.poll();
  await B[1].ev("tab='groups';render()"); await B[2].ev("tab='groups';render()"); await A.ev("tab='groups';render()");
  ok(/warten auf deine Bestätigung/.test(B[1].app()), 'Chris sieht Banner "wartet auf deine Bestätigung"');
  ok(B[1].app().includes('Stimmt, bestätigen'), 'Chris hat Bestätigen-Button');
  ok(!B[0].app().includes('Stimmt, bestätigen') && B[0].app().includes('Warte auf die Bestätigung'), 'Bea (Melderin) kann nicht selbst bestätigen');
  ok(!/warten auf deine Bestätigung/.test(B[2].app()) && !B[2].app().includes('Stimmt, bestätigen'), 'Dana (Unbeteiligte) hat keinen Bestätigen-Button');
  ok(A.app().includes('Stimmt, bestätigen'), 'Host kann bestätigen');
  await B[1].ev(`answer('confirm', V.reports[0].id)`);
  await A.poll();
  ok(A.ev(`S.gm[${mi}].games.length`) === 1 && A.ev('V.reports.length') === 0, 'Nach Bestätigung ist die Runde eingetragen');

  console.log('Anzeige für Zuschauer');
  const Z = browser('/t/' + code, false); await Z.poll(); await Z.ev("tab='lobby';render()");
  ok(/schaust zu/.test(Z.app()) && Z.hero().includes('Zuschauer'), 'Zuschauer sieht Hinweis und Rolle');
  await Z.ev("tab='groups';render()");
  ok(!Z.app().includes('Melden') && !Z.app().includes('+ Runde'), 'Zuschauer hat keine Eingabefelder');
  await Z.ev("tab='rank';render()");
  ok(Z.app().includes('Zwischenstand') || Z.app().includes('Endplatzierung'), 'Ränge-Tab rendert');

  console.log('Unbekannter Code');
  const X = browser('/t/ZZZZZZ'); await X.poll();
  ok(/nicht gefunden/.test(X.app()), 'Fehlerseite bei falschem Code');

  const all = [A, ...B, Z, X], errs = all.flatMap((b) => b.errors);
  ok(errs.length === 0, 'keine JavaScript-Fehler im Browser' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  console.log(fails ? `\n${fails} FEHLER` : '\nALLE UI-TESTS BESTANDEN');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('Testabbruch:', e); process.exit(2); });
