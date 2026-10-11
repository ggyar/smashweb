/* Smash Turnier – Browser-App. Die Rechte prüft immer der Server (das Host-Gerät); hier wird nur angezeigt und abgeschickt. */
const E = window.Engine;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let code = null, V = null, S = null, tab = 'lobby', notFound = false, conn = true, timer = null, dirty = false, firstLoad = true;
const ENT = {}, OPEN = {};
const BN = { W: 'Winners', L: 'Losers', A: 'Amateur', F: 'Großes Finale' }, BI = { W: '👑', L: '⚔️', A: '🌱', F: '🔥' };

/* ---------- Sitzungen (liegen nur im Browser) ---------- */
const SK = 'smash_sessions_v2';
const sessions = () => { try { return JSON.parse(localStorage.getItem(SK)) || {}; } catch (e) { return {}; } };
function setSess(c, o) { try { const s = sessions(); if (o) s[c] = o; else delete s[c]; localStorage.setItem(SK, JSON.stringify(s)); } catch (e) { /* ignorieren */ } }
const token = () => (sessions()[code] || {}).token || '';

/* ---------- Server-Verbindung ---------- */
// Bevorzugt: Live-Verbindung per socket.io (Push statt Abfragen, sofortiger Online-Status). Fallback: normales HTTP.
let socket = null, live = false, ONLINE = 0;
function initSocket() {
  if (typeof io === 'undefined') return;
  socket = io({ transports: ['websocket', 'polling'] });
  socket.on('connect', () => { live = true; conn = true; watchRoom(); if (code) poll(true); else render(true); });
  socket.on('disconnect', () => { live = false; render(true); });
  socket.on('changed', () => { if (code) poll(true); });
  socket.on('online', (n) => { ONLINE = n; render(true); });
}
// meldet dem Server, in welchem Raum und mit welchem Schlüssel wir gerade sitzen
function watchRoom() { if (socket && live && code) socket.emit('watch', { code, token: token() }); }
function viaSocket(path, opt, tk) {
  return new Promise((resolve) => {
    const [pp, qs] = ('/api' + path).split('?');
    const t = setTimeout(() => resolve({ ok: false, status: 0, error: 'Keine Verbindung zum Server.' }), 10000);
    socket.emit('api', { method: opt.body ? 'POST' : 'GET', path: pp, query: Object.fromEntries(new URLSearchParams(qs || '')), body: opt.body, token: tk }, (out) => {
      clearTimeout(t);
      const j = (out && out.json) || { ok: false, error: 'Serverfehler' };
      j.status = out ? out.status : 0;
      if (j.status >= 400 && !j.error) j.error = 'Fehler ' + j.status;
      resolve(j);
    });
  });
}
async function api(path, opt = {}) {
  const tk = opt.token !== undefined ? opt.token : token();
  if (socket && live) return viaSocket(path, opt, tk);
  const h = { 'Content-Type': 'application/json' };
  if (tk) h.Authorization = 'Bearer ' + tk;
  try {
    const r = await fetch('/api' + path, { method: opt.body ? 'POST' : 'GET', headers: h, body: opt.body ? JSON.stringify(opt.body) : undefined });
    const j = await r.json().catch(() => ({ ok: false, error: 'Serverfehler' }));
    j.status = r.status;
    if (!r.ok && !j.error) j.error = 'Fehler ' + r.status;
    return j;
  } catch (e) { return { ok: false, status: 0, error: 'Keine Verbindung zum Server.' }; }
}
function toast(msg, isErr) {
  const t = $('toast');
  t.innerHTML = `<div class="${isErr ? 'err' : ''}">${esc(msg)}</div>`;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.innerHTML = ''; }, 3500);
}
// Aktionen laufen nacheinander (Warteschlange), damit schnelle Klicks nicht verloren gehen
let chain = Promise.resolve();
const doAct = (body) => { const p = chain.then(() => runAct(body)); chain = p.catch(() => {}); return p; };
async function runAct(body) {
  const r = await api(`/t/${code}/act`, { body });
  if (!r.ok) { toast(r.error || 'Das hat nicht geklappt.', true); await poll(true); return false; }
  if (r.deleted) { setSess(code, null); go('/'); return true; }
  await poll(true);
  return true;
}

/* ---------- Navigation & Polling ---------- */
function go(path) { history.pushState({}, '', path); route(); }
window.addEventListener('popstate', route);
function route() {
  clearTimeout(timer); V = null; S = null; notFound = false; firstLoad = true;
  const m = location.pathname.match(/^\/t\/([A-Za-z0-9]+)/);
  code = m ? m[1].toUpperCase() : null;
  if (code) {
    const hm = location.hash.match(/host=([0-9a-f]{20,})/);
    if (hm) { setSess(code, { token: hm[1], role: 'host' }); history.replaceState({}, '', '/t/' + code); }
    render(); watchRoom(); poll(true);
  } else { render(); }
}
async function poll(force) {
  if (!code) return;
  clearTimeout(timer);
  const c = code, q = (!force && V) ? `?v=${V.v}&ph=${encodeURIComponent(V.ph)}` : '';
  const r = await api(`/t/${c}/state${q}`);
  if (c !== code) return;
  if (r.status === 404) { notFound = true; V = null; S = null; render(); return; }
  conn = r.ok;
  if (r.ok && !r.same) {
    const prev = V;
    if (sessions()[c] && r.me.role === 'viewer') { setSess(c, null); toast('Du bist in diesem Turnier nicht mehr angemeldet.', true); }
    if (firstLoad) { tab = r.t.phase === 'lobby' ? 'lobby' : 'bracket'; firstLoad = false; }
    else if (prev && prev.t.phase === 'lobby' && r.t.phase !== 'lobby') tab = 'bracket';
    else if (prev && prev.t.phase !== 'lobby' && r.t.phase === 'lobby') tab = 'lobby';
    V = r; S = r.S;
    typing() ? (dirty = true) : render();
  } else if (!r.ok) render(true);
  timer = setTimeout(() => poll(false), live ? 20000 : document.hidden ? 8000 : 3000); // mit Live-Verbindung nur zur Sicherheit
}
const typing = () => { const a = document.activeElement; return !!a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && $('app').contains(a); };
document.addEventListener('focusout', () => setTimeout(() => { if (dirty && !typing()) { dirty = false; render(); } }, 150));
document.addEventListener('visibilitychange', () => { if (!document.hidden && code) poll(true); });

/* ---------- Hilfen ---------- */
const P = (i) => S.players[i];
const isHost = () => !!V && V.me.role === 'host';
const myIdx = () => (V && V.me.pid != null ? S.players.findIndex((p) => p.pid === V.me.pid) : -1);
const onlineSet = () => new Set((V ? V.parts : []).filter((p) => p.online).map((p) => p.pid));
// Adresse, unter der Freunde dieses Gerät im WLAN erreichen (am Host-Gerät steht im Browser nur "localhost")
let INFO = null, baseIdx = 0;
const isLocalHost = () => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const baseUrl = () => (isLocalHost() && INFO && INFO.bases.length ? INFO.bases[Math.min(baseIdx, INFO.bases.length - 1)] : location.origin);
const joinUrl = () => baseUrl() + '/t/' + code;
async function loadInfo() { const r = await api('/info', { token: '' }); if (r.ok) { INFO = r; render(); } }
const tags = (p) => (p.alex ? '<span class="b r">2 Leben</span>' : '') + (p.adv ? '<span class="b p">Profi</span>' : '');
function avp(p,z,n){
 if(p.bot)return `<span class="av bot" style="width:${z}px;height:${z}px;font-size:${z*.55}px">🤖</span>`;
 const c=p.ch&&p.ch[0];const ik=NK[c];if(ik&&IC[ik])return `<span class="av" style="width:${z}px;height:${z}px;background:url(${IC[ik]}) center/86% no-repeat,linear-gradient(135deg,#3a4080,#1c1f45)"></span>`;let xy=CS[c];
 if(c&&!xy){let h=0;for(const ch of c)h=(h*31+ch.charCodeAt(0))%360;const ini=c.split(/[\s.&\/-]+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase();
  return `<span class="av bot" style="width:${z}px;height:${z}px;font-size:${z*.38}px;font-weight:900;background:linear-gradient(135deg,hsl(${h} 70% 50%),hsl(${(h+50)%360} 70% 35%))">${esc(ini)}</span>`}
 if(!xy)xy=SPR[n%SPR.length];const k=z/130;
 return `<span class="av" style="width:${z}px;height:${z}px;background-size:${1000*k}px;background-position:${z/2-xy[0]*k}px ${z/2-xy[1]*k}px"></span>`}
const av = (i, z) => avp(P(i), z, P(i).id);
const dot = (on) => `<span class="dot ${on ? 'on' : ''}"></span>`;
function nm(i) { const p = P(i); const on = p.pid != null && onlineSet().has(p.pid); return `<span class="who">${av(i, 30)}<span>${p.bot ? '' : dot(on)}${esc(p.name)}${tags(p)}</span></span>`; }
function big(i) { const p = P(i); const on = p.pid != null && onlineSet().has(p.pid); return `<div class="pl">${av(i, 64)}<div>${p.bot ? '' : dot(on)}${esc(p.name)}</div><div>${tags(p)}</div>${p.ch.length ? `<div class="ch">${esc(p.ch.slice(0, 4).join(' › '))}</div>` : ''}</div>`; }
const copy = async (txt) => { try { await navigator.clipboard.writeText(txt); toast('Kopiert ✔'); } catch (e) { prompt('Zum Kopieren markieren:', txt); } };
function qrSvg(url) { try { const q = qrcode(0, 'M'); q.addData(url); q.make(); return q.createSvgTag({ scalable: true, cellSize: 4, margin: 3 }); } catch (e) { return '<div class="q">QR-Code konnte nicht erzeugt werden.</div>'; } }
const roleName = () => ({ host: '👑 Host', player: '🎮 Teilnehmer', viewer: '👀 Zuschauer' }[V.me.role]);

/* ---------- Startseite ---------- */
function vHome() {
  const ss = sessions(), ids = Object.keys(ss), canHost = !!(INFO && INFO.canCreate);
  return (canHost ? `<div class="card"><h2 style="margin-top:0">🎮 Turnier hosten</h2>
   <div class="hint" style="margin-top:0">Du startest das Turnier und hast alle Rechte. Freunde treten per QR-Code bei.</div>
   <div class="field"><label>Name des Turniers</label><input id="hname" class="full" maxlength="40" placeholder="z. B. Smash-Abend"></div>
   ${INFO.needsPassword ? '<div class="field"><label>Host-Passwort</label><input id="hpw" class="full" type="password" autocomplete="off" placeholder="Passwort des Servers"></div>' : ''}
   <button class="btn full" onclick="createT()">Turnier erstellen</button></div>`
    : INFO ? '<div class="card"><h2 style="margin-top:0">👋 Hallo!</h2><div class="hint" style="margin-top:0">Turniere werden am Host-Gerät erstellt. Scanne den QR-Code des Hosts mit der Handy-Kamera oder gib unten den Code ein.</div></div>' : '')
  + `<div class="card"><h2 style="margin-top:0">🔑 Turnier beitreten</h2>
   <div class="hint" style="margin-top:0">Scanne den QR-Code des Hosts mit der Handy-Kamera – oder gib den Code hier ein.</div>
   <div class="field"><label>Turnier-Code</label><input id="jcode" class="full" maxlength="8" autocapitalize="characters" autocomplete="off" placeholder="ABC123" style="text-transform:uppercase;letter-spacing:.2em;text-align:center;font-weight:800" onkeydown="if(event.key==='Enter')joinByCode()"></div>
   <button class="btn full" onclick="joinByCode()">Weiter</button></div>
  ${ids.length ? `<div class="card"><div class="h" style="font-size:12px;font-weight:800;color:var(--mut);text-transform:uppercase">Meine Turniere</div>${ids.map((c) => `<button class="sess" onclick="go('/t/${c}')"><b>${esc(ss[c].tname || c)}</b><small>${ss[c].role === 'host' ? '👑 Host' : '🎮 Teilnehmer'} · ${c}</small></button>`).join('')}</div>` : ''}`;
}
async function createT() {
  const name = $('hname').value.trim();
  const pw = $('hpw') ? $('hpw').value : '';
  const r = await api('/t', { body: { name, password: pw }, token: '' });
  if (!r.ok) return toast(r.error, true);
  setSess(r.code, { token: r.token, role: 'host', tname: name || 'Smash Turnier' });
  go('/t/' + r.code);
}
function joinByCode() {
  const c = $('jcode').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length < 4) return toast('Bitte gib den Code ein.', true);
  go('/t/' + c);
}

/* ---------- Lobby ---------- */
function cntText() {
  const n = V.parts.length + (S.nbots || 0);
  if (n < 3) return n + ' Teilnehmer – mindestens 3 nötig (Bots zählen mit).';
  if (n > 24) return n + ' Teilnehmer – der feste Turnierbaum ist für maximal 24 ausgelegt.';
  const z = E.plan(n);
  return n + ' Teilnehmer → ' + z.length + ' Gruppen (' + [...new Set(z)].sort().join(' / ') + ' Spieler)';
}
function qrCard() {
  return `<div class="card center"><div class="h" style="font-size:12px;font-weight:800;color:var(--mut);text-transform:uppercase">Zum Beitreten scannen</div>
   <div class="qrbox">${qrSvg(joinUrl())}</div>
   <div class="code">${esc(code)}</div>
   <div class="hint" style="margin:0 0 6px;word-break:break-all">${esc(joinUrl())}</div>
   ${netInfo()}
   <div class="row"><button onclick="copy(joinUrl())">🔗 Link kopieren</button>${navigator.share ? '<button onclick="shareT()">📤 Teilen</button>' : ''}</div></div>`;
}
function netInfo() {
  if (!isLocalHost() || !INFO) return '';
  if (!INFO.bases.length) return '<div class="hint" style="color:#ff9bb0">⚠️ Dieses Gerät ist mit keinem Netzwerk verbunden. Verbinde es mit dem WLAN, damit Freunde beitreten können.</div>';
  if (INFO.bases.length < 2) return '';
  return `<div class="field"><label>Netzwerk (falls der QR-Code nicht klappt)</label><select class="full" onchange="baseIdx=+this.value;render()">${INFO.bases.map((b, i) => `<option value="${i}" ${i === baseIdx ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></div>`;
}
const shareT = () => navigator.share({ title: 'Smash Turnier', text: 'Tritt meinem Smash-Turnier bei!', url: joinUrl() }).catch(() => {});
function joinCard() {
  return `<div class="card"><h2 style="margin-top:0">🎮 Beitreten</h2>
   <div class="field"><label>Spielername</label><input id="jname" class="full" maxlength="24" placeholder="Dein Name" autocomplete="nickname"></div>
   <div class="field"><label>Erfahrung</label><select id="jlevel" class="full"><option value="0">Normal</option><option value="1">Fortgeschritten (Profi-Regeln)</option></select></div>
   <button class="btn full" onclick="joinT()">Beitreten</button></div>`;
}
async function joinT() {
  const name = $('jname').value.trim();
  if (!name) return toast('Bitte gib deinen Namen ein.', true);
  const r = await api(`/t/${code}/join`, { body: { name, level: +$('jlevel').value }, token: '' });
  if (!r.ok) return toast(r.error, true);
  setSess(code, { token: r.token, role: 'player', pid: r.pid, tname: V ? V.t.name : code });
  toast('Willkommen, ' + name + '! 🎉');
  watchRoom(); poll(true);
}
function partsCard() {
  const host = isHost(), lobby = S.phase === 'lobby';
  const rows = V.parts.map((p) => `<div class="prow">${avp({ ch: p.ch }, 44, p.pid)}<div><b>${dot(p.online)}${esc(p.name)}</b>${p.isHost ? '<span class="b">Host</span>' : ''}${tags({ alex: p.alex, adv: p.level > 0 || p.alex })}${p.ch.length ? `<div class="ch">${esc(p.ch.slice(0, 5).join(' › '))}</div>` : ''}</div>
    ${host ? `<button class="mini ${p.alex ? 'on' : ''}" title="Alex-Regel: nur 2 Leben" onclick="setAlex(${p.pid},${!p.alex})">Alex</button>${lobby && !p.isHost ? `<button class="mini" onclick="kick(${p.pid})">✕</button>` : ''}` : ''}</div>`).join('');
  return `<div class="card"><h2 style="margin:0 0 4px">👥 Teilnehmer <span class="pill">${V.parts.length}${S.nbots ? ' + ' + S.nbots + ' 🤖' : ''}</span></h2>
   <div class="hint" style="margin:0 0 4px">${dot(V.hostOnline)}Host ${V.hostOnline ? 'online' : 'offline'}  ·  <span class="dot on"></span>online</div>
   ${rows || '<div class="q" style="padding:10px 0">Noch niemand beigetreten – scanne den QR-Code!</div>'}</div>`;
}
function profileCard() {
  const p = V.parts.find((x) => x.pid === V.me.pid);
  if (!p) return '';
  return `<div class="card"><h2 style="margin-top:0">🧑‍🎤 Mein Profil</h2>
   <div class="field"><label>Spielername</label><input class="full" maxlength="24" value="${esc(p.name)}" onchange="setProfile({name:this.value})"></div>
   <div class="field"><label>Erfahrung</label><select class="full" onchange="setProfile({level:+this.value})"><option value="0" ${p.level === 0 ? 'selected' : ''}>Normal</option><option value="1" ${p.level > 0 ? 'selected' : ''}>Fortgeschritten (Profi-Regeln)</option></select></div>
   ${p.alex ? '<div class="hint">☠️ Der Host hat dir die Alex-Regel gegeben: nur 2 Leben pro Spiel.</div>' : ''}
   <div class="hint">${p.level > 0 || p.alex ? 'Deine Charaktere (bester zuerst):' : 'Charaktere (optional, bester zuerst) – der erste ist dein Icon:'}</div>
   ${p.ch.map((c, k) => `<div class="rk" style="padding:3px 0"><i style="width:26px;font-size:14px">${k + 1}.</i><span style="flex:1">${esc(c)}</span><button class="mv" onclick="moveChar(${k})">↑</button> <button class="mv" onclick="delChar(${k})">✕</button></div>`).join('')}
   <select class="full" style="margin-top:6px" onchange="addChar(this.value);this.value=''"><option value="">+ Charakter hinzufügen …</option>${E.ROSTER.filter((c) => !p.ch.includes(c)).map((c) => `<option>${esc(c)}</option>`).join('')}</select></div>`;
}
const myPart = () => V.parts.find((x) => x.pid === V.me.pid);
const setProfile = (o) => doAct({ type: 'profile', ...o });
// sofort lokal anzeigen, dann speichern (der nächste Poll korrigiert bei Fehlern)
const setChars = (c) => { myPart().ch = c; render(); return setProfile({ ch: c }); };
const addChar = (c) => c ? setChars([...myPart().ch, c]) : null;
const delChar = (k) => { const c = [...myPart().ch]; c.splice(k, 1); return setChars(c); };
const moveChar = (k) => { if (k < 1) return null; const c = [...myPart().ch]; [c[k - 1], c[k]] = [c[k], c[k - 1]]; return setChars(c); };
const setAlex = (pid, on) => doAct({ type: 'alex', pid, on });
const kick = (pid) => { if (confirm('Teilnehmer entfernen?')) doAct({ type: 'kick', pid }); };

function hostCard() {
  const lobby = S.phase === 'lobby', playing = V.parts.some((p) => p.isHost);
  return `<div class="card"><h2 style="margin-top:0">👑 Host-Bereich</h2>
   <div class="field"><label>Name des Turniers</label><input class="full" maxlength="40" value="${esc(V.t.name)}" onchange="doAct({type:'rename',name:this.value})"></div>
   ${lobby ? `<div class="field"><label>Bots zum Auffüllen</label><input class="full" type="number" min="0" max="24" value="${S.nbots || 0}" onchange="doAct({type:'bots',n:this.value})"></div>
   <div class="hint" id="cnt">${esc(cntText())}</div>
   ${playing ? '<button class="btn sec full" onclick="hostPlay(false)">Ich spiele nicht mit</button>' : `<div class="field"><label>Ich spiele auch mit</label><input id="hpname" class="full" maxlength="24" placeholder="Dein Spielername"></div><button class="btn sec full" onclick="hostPlay(true)">Als Spieler eintragen</button>`}
   <button class="btn full" onclick="doAct({type:'start'})">🎲 Gruppen auslosen & Turnier starten</button>`
    : `<button class="btn sec full" onclick="if(confirm('Turnier zurücksetzen? Die Teilnehmer bleiben, alle Ergebnisse werden gelöscht (mit „Zurück“ holst du sie wieder).'))doAct({type:'reset'})">⟲ Turnier zurücksetzen</button>`}
   <button class="btn sec full" onclick="copy(baseUrl()+'/t/'+code+'#host='+token())">🔐 Host-Link kopieren (für zweites Gerät)</button>
   <div class="hint">Mit dem Host-Link kannst du das Turnier auch auf einem anderen Gerät leiten. Gib ihn niemandem weiter.</div>
   <button class="btn danger full" onclick="if(confirm('Turnier endgültig löschen?'))doAct({type:'delete'})">🗑 Turnier löschen</button></div>`;
}
function hostPlay(on) {
  if (on) { const n = $('hpname').value.trim(); if (!n) return toast('Bitte gib deinen Spielernamen ein.', true); doAct({ type: 'hostPlay', on: true, name: n }); } else doAct({ type: 'hostPlay', on: false });
}
function vLobby() {
  let h = S.phase === 'lobby' ? qrCard() : `<div class="card center"><div class="h" style="font-size:12px;font-weight:800;color:var(--mut);text-transform:uppercase">Turnier-Code</div><div class="code">${esc(code)}</div></div>`;
  if (V.me.role === 'viewer') h += S.phase === 'lobby' ? joinCard() : '<div class="card">👀 Das Turnier läuft schon – du schaust zu. Alle Tabs unten sind für dich sichtbar.</div>';
  h += partsCard();
  if (V.me.pid != null) h += profileCard();
  if (isHost()) h += hostCard();
  return h;
}

/* ---------- Ergebnisse: Runde melden / bestätigen ---------- */
const gKey = (k, i) => k + ':' + i;
function ent(key, side, v) { ENT[key] = ENT[key] || { ka: 0, kb: 0 }; ENT[key][side ? 'kb' : 'ka'] = +v; }
function gameUI(k, i, m) {
  const key = gKey(k, i), e = ENT[key] || { ka: 0, kb: 0 }, pa = P(m.a), pb = P(m.b), host = isHost();
  const rows = m.games.map((q, j) => `<div class="gl">Runde ${j + 1}: ${esc(pa.name)} <b>${q.ka}</b> : <b>${q.kb}</b> ${esc(pb.name)} <span class="q">→ ${esc((E.gw(S, q, m.a, m.b) ? pb : pa).name)}</span></div>`).join('');
  if (!E.playable(S, k, i)) return rows;
  const rep = V.reports.find((r) => r.key === key), mi = myIdx(), mine = mi === m.a || mi === m.b;
  const oppHuman = mine && P(mi === m.a ? m.b : m.a).pid != null;
  let ui = '';
  if (rep) {
    const rp = S.players.find((p) => p.pid === rep.by), mineRep = rep.by === V.me.pid;
    const winner = E.gw(S, { ka: rep.ka, kb: rep.kb }, m.a, m.b) ? pb : pa;
    const judge = host || (mine && !mineRep);
    ui = `<div class="pend">⏳ <b>${esc(rp ? rp.name : '?')}</b> meldet Runde ${rep.round + 1}: ${esc(pa.name)} <b>${rep.ka}</b> : <b>${rep.kb}</b> ${esc(pb.name)} → <b>${esc(winner.name)}</b> gewinnt.
     ${judge ? `<div class="row"><button onclick="answer('confirm',${rep.id})">✔ Stimmt, bestätigen</button><button style="background:var(--card2);box-shadow:none" onclick="answer('reject',${rep.id})">✖ Falsch</button></div>`
      : mineRep ? `<div class="hint">Warte auf die Bestätigung deines Gegners.</div><div class="row"><button style="background:var(--card2);box-shadow:none" onclick="answer('reject',${rep.id})">Meldung zurückziehen</button></div>`
      : '<div class="hint">Wartet auf Bestätigung durch den Gegner.</div>'}</div>`;
  } else if (host || (mine && oppHuman)) {
    const sel = (side, v, max) => `<select onchange="ent('${key}',${side},this.value)">${Array.from({ length: max + 1 }, (_, n) => `<option ${n === v ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
    ui = `<div class="ge"><label>Kills ${esc(pa.name)}${sel(0, e.ka, E.stocks(S, m.b))}</label><label>Kills ${esc(pb.name)}${sel(1, e.kb, E.stocks(S, m.a))}</label>
      <button onclick="sendRound('${k}','${i}')">${host ? '+ Runde' : 'Melden'}</button></div>
      ${host ? '' : '<div class="hint">Dein Gegner muss das Ergebnis danach bestätigen.</div>'}`;
  } else if (mine) ui = '<div class="hint">Gegen Bots trägt der Host das Ergebnis ein.</div>';
  const del = host && m.games.length ? `<button class="mv" style="margin-top:8px" onclick="hostDel('${k}','${i}')">↩ letzte Runde löschen</button>` : '';
  return rows + ui + del;
}
async function sendRound(k, i) {
  const key = gKey(k, i), e = ENT[key] || { ka: 0, kb: 0 };
  if (await doAct({ type: isHost() ? 'add' : 'report', k, i, ka: e.ka, kb: e.kb })) delete ENT[key];
}
const hostDel = (k, i) => doAct({ type: 'del', k, i });
const answer = (type, rid) => doAct({ type, rid });
const pendingForMe = () => {
  if (!V || S.phase === 'lobby') return [];
  const mi = myIdx();
  return V.reports.filter((r) => { if (r.by === V.me.pid) return false; if (isHost()) return true; const [k, i] = r.key.split(':'), m = E.find(S, k, i); return !!m && mi >= 0 && (mi === m.a || mi === m.b); });
};
function showPending() {
  const r = pendingForMe()[0]; if (!r) return;
  const [k, i] = r.key.split(':');
  tab = k === 'g' ? 'groups' : 'bracket'; if (k === 'g') OPEN['g' + i] = true;
  render(); window.scrollTo(0, 0);
}

/* ---------- Gruppen ---------- */
function vGroups() {
  if (S.phase === 'lobby') return '<div class="card">Das Turnier ist noch nicht gestartet.</div>';
  const host = isHost(), mi = myIdx();
  return S.groups.map((ids, g) => {
    const st = E.stand(S, g), gm = S.gm.map((m, i) => [m, i]).filter(([m]) => m.g == g), lock = !!S.lock[g];
    const tie = !lock && gm.every(([m]) => E.isDone(S, m)) && E.hasTie(st);
    return `<div class="card"><h2 style="margin:0 0 8px">Gruppe <span class="pill" style="font-size:15px">${E.GL[g]}</span> <span class="pill">${lock ? '✔ fest' : ids.length + ' Spieler'}</span></h2>
    <table><tr><th></th><th>Name</th><th class="n">Siege</th><th class="n">Runden</th><th class="n">Kills</th><th></th></tr>
    ${st.map((x, i) => `<tr class="${i == 0 ? 'top' : ''}"><td><span class="pos p${i + 1}">${i + 1}</span></td><td>${nm(x.id)}</td><td class="n">${x.w}</td><td class="n">${x.d > 0 ? '+' : ''}${x.d}</td><td class="n">${x.k}</td><td>${tie && host ? `<button class="mv" onclick="doAct({type:'mv',g:${g},id:${x.id}})">↑</button>` : ''}</td></tr>`).join('')}</table>
    ${tie ? (host ? `<div class="hint">Gleichstand – Reihenfolge per ↑ festlegen (z. B. Stichkampf) und bestätigen.</div><button class="btn full" onclick="doAct({type:'conf',g:${g}})">Reihenfolge bestätigen</button>` : '<div class="hint">Gleichstand – der Host legt die Reihenfolge fest.</div>') : ''}
    ${gm.map(([m, i]) => {
      const [x, y] = E.tally(S, m), k = 'g' + i, pend = V.reports.some((r) => r.key === 'g:' + i), mine = mi === m.a || mi === m.b;
      return `<details class="gd" ${OPEN[k] || (pend && mine) ? 'open' : ''} ontoggle="OPEN['${k}']=this.open"><summary>${mine ? '<span class="mine-tag">⭐ </span>' : ''}${esc(P(m.a).name)} <b>${x} : ${y}</b> ${esc(P(m.b).name)} ${E.isDone(S, m) ? '✔' : ''}${pend ? ' ⏳' : ''}</summary>${gameUI('g', i, m)}</details>`;
    }).join('')}</div>`;
  }).join('') + '<div class="hint">Match antippen, Runde für Runde die Kills eintragen (Bo3). Teilnehmer melden – der Gegner bestätigt. Ist eine Gruppe fertig, stehen ihre Plätze im Turnierbaum fest.</div>';
}

/* ---------- Turnierbaum ---------- */
const pn = (x, s) => E.isP(x) ? esc(P(x).name) : x === -1 ? '<i>Freilos</i>' : `<span class="q">${esc(s.t == 'g' ? s.r + '. Gruppe ' + E.GL[s.g] : (s.t == 'w' ? 'Sieger ' : 'Verlierer ') + E.LBL[s.m])}</span>`;
function mcard(m) {
  const a = P(m.a), b = P(m.b), adv = a.adv || b.adv, [x, y] = E.tally(S, m), mi = myIdx(), mine = mi === m.a || mi === m.b;
  return `<div class="card ${m.br} ${mine ? 'mine' : ''}"><div style="display:flex;justify-content:space-between;margin-bottom:10px;gap:6px"><span class="pill ${m.br}">${esc(E.LBL[m.id])}</span>${mine ? '<span class="mine-tag">⭐ DEIN MATCH</span>' : ''}<span class="pill">Best of ${m.bo}</span></div>
   <div class="vs">${big(m.a)}<b>${x}:${y}</b>${big(m.b)}</div>
   ${adv ? '<div class="hint">🚫 Gegner bannt 1 Charakter fürs ganze Match · jeder Charakter nur 1× pro Match' + ((a.alex || b.alex) ? ' · ☠️ Alex springt zu Beginn jedes Spiels einmal in den Abgrund (Gegner braucht nur 2 Kills)' : '') + '</div>' : ''}
   ${gameUI('b', m.id, m)}</div>`;
}
function vBracket() {
  if (S.phase === 'lobby') return '<div class="card">Das Turnier ist noch nicht gestartet.</div>';
  const mi = myIdx();
  const rd = E.DEF.filter((d) => { const M = S.m[d.id]; return !M.done && !M.skip && E.isP(M.a) && E.isP(M.b); }).map((d) => S.m[d.id]);
  rd.sort((p, q) => ((mi === q.a || mi === q.b) ? 1 : 0) - ((mi === p.a || mi === p.b) ? 1 : 0));
  let h = `<h2>▶ Jetzt spielbar <span class="pill">${rd.length}</span></h2>` + (rd.length ? rd.map(mcard).join('') : '<div class="card q">Gerade ist kein Match spielbar – spielt weitere Gruppenmatches.</div>');
  for (const b of ['W', 'L', 'A', 'F']) {
    h += `<h2>${BI[b]} ${b == 'F' ? 'Großes Finale' : BN[b] + '-Bracket'}</h2><div class="card">`; let last = '';
    E.DEF.filter((d) => d.br == b && !S.m[d.id].skip).forEach((d) => {
      const M = S.m[d.id], [x, y] = E.tally(S, M), my = mi >= 0 && (mi === M.a || mi === M.b);
      if (d.rd != last) { h += `<div class="h" style="margin-top:10px">${d.rd}</div>`; last = d.rd; }
      h += `<div class="mrow ${M.done ? 'dn' : E.isP(M.a) && E.isP(M.b) ? 'rdy' : ''} ${my ? 'mymatch' : ''}"><span>${M.done && M.w === M.a ? '✔ ' : ''}${pn(M.a, d.a)}</span><b>${M.done ? (M.auto ? '–' : x + ':' + y) : 'vs'}</b><span>${pn(M.b, d.b)}${M.done && M.w === M.b ? ' ✔' : ''}</span><span class="pill">Bo${d.bo}</span></div>`;
    });
    h += '</div>';
  }
  return h;
}

/* ---------- Ränge ---------- */
function vStats() {
  const t = S.players.map((p) => ({ id: p.id, k: 0, d: 0, g: 0 }));
  [...S.gm, ...Object.values(S.m)].forEach((m) => m.games.forEach((q) => { t[m.a].k += q.ka; t[m.a].d += q.kb; t[m.b].k += q.kb; t[m.b].d += q.ka; t[m.a].g++; t[m.b].g++; }));
  const r = t.filter((x) => x.g).sort((x, y) => y.k - x.k || x.d - y.d);
  if (!r.length) return '';
  return `<h2>⚔️ Kill-Statistik</h2><div class="card"><table><tr><th>Spieler</th><th class="n">Kills</th><th class="n">Tode</th><th class="n">K/D</th></tr>${r.map((x) => `<tr><td>${nm(x.id)}</td><td class="n">${x.k}</td><td class="n">${x.d}</td><td class="n">${x.d ? (x.k / x.d).toFixed(2) : x.k}</td></tr>`).join('')}</table></div>`;
}
function vRank() {
  if (S.phase === 'lobby') return '<div class="card">Das Turnier ist noch nicht gestartet.</div>';
  const T = E.tiers(S), fin = S.phase == 'done';
  const pc = (k, c) => T[k] && T[k][1][0] != null ? `<div class="pl ${c}"><div style="font-size:26px">${['🥇', '🥈', '🥉'][k]}</div>${av(T[k][1][0], c == 'p1' ? 84 : 64)}<div>${esc(P(T[k][1][0]).name)}</div></div>` : '<div></div>';
  return `<h2>🏆 ${fin ? 'Endplatzierung' : 'Zwischenstand (bereits ausgeschieden)'}</h2>` + (fin ? `<div class="pod">${pc(1, 'p2')}${pc(0, 'p1')}${pc(2, 'p3')}</div>` : '')
    + `<div class="card">${T.filter((t, i) => !fin || i > 2).map(([t, a]) => `<div class="rk"><i style="font-size:13px;width:60px">${t}</i><span>${a.map((i) => nm(i)).join('<br>')}</span></div>`).join('') || '<div class="q">Noch niemand ausgeschieden.</div>'}</div>` + vStats();
}

/* ---------- Rahmen ---------- */
function renderHero() {
  if (!code || !V) { $('hero').innerHTML = `<div class="hero ${code ? '' : 'big'}"><div class="tools">${code ? '<button onclick="go(\'/\')">🏠 Start</button>' : ''}</div><h1>SMASH <b>TURNIER</b></h1><small>Super Smash Bros. Ultimate${live && ONLINE ? ' · <span class="conn" style="color:var(--ok)">● ' + ONLINE + ' online</span>' : ''}</small></div>`; return; }
  $('hero').innerHTML = `<div class="hero"><div class="tools"><button onclick="go('/')">🏠</button>${isHost() ? '<button onclick="doAct({type:\'undo\'})">↩ Zurück</button>' : ''}</div>
   <h1>SMASH <b>TURNIER</b></h1><small>${esc(V.t.name)} · <b>${esc(code)}</b> · ${roleName()} · <span class="conn" style="color:${conn ? 'var(--ok)' : '#ff6b86'}">● ${conn ? (live ? 'live' : 'verbunden') : 'offline'}${live && ONLINE ? ' · ' + ONLINE + ' online' : ''}</span></small></div>`;
}
function renderTabs() {
  if (!code || !V) { $('tabs').style.display = 'none'; return; }
  $('tabs').style.display = '';
  $('tabs').innerHTML = [['lobby', '👥', 'Lobby'], ['groups', '🎯', 'Gruppen'], ['bracket', '⚔️', 'Turnier'], ['rank', '🏆', 'Ränge']]
    .map(([k, e, t]) => `<button class="${tab == k ? 'on' : ''}" onclick="tab='${k}';scrollTo(0,0);render()"><span>${e}</span>${t}</button>`).join('');
}
function render(connOnly) {
  renderHero();
  if (connOnly) return;
  renderTabs();
  let h;
  if (!code) h = vHome();
  else if (notFound) h = '<div class="card center"><h2 style="margin-top:0">😕 Turnier nicht gefunden</h2><div class="hint">Prüfe den Code oder frage den Host nach einem neuen QR-Code. Läuft das Programm auf dem Host-Gerät noch, und bist du im selben WLAN?</div><button class="btn full" onclick="go(\'/\')">Zur Startseite</button></div>';
  else if (!V) h = '<div class="card center">Lade Turnier …</div>';
  else {
    const n = pendingForMe().length;
    h = (n ? `<div class="banner"><span>⚠️ ${n} Ergebnis${n > 1 ? 'se' : ''} ${isHost() ? 'warten auf Bestätigung' : 'warten auf deine Bestätigung'}</span><button onclick="showPending()">Ansehen</button></div>` : '')
      + ({ lobby: vLobby, groups: vGroups, bracket: vBracket, rank: vRank }[tab] || vLobby)();
    if (V.me.role !== 'viewer') { const s = sessions()[code]; if (s && V.t.name !== s.tname) setSess(code, { ...s, tname: V.t.name, role: V.me.role }); }
  }
  const keep = {};
  ['jname', 'jlevel', 'hpname', 'hname', 'jcode'].forEach((id) => { const e = $(id); if (e && e.value) keep[id] = e.value; });
  $('app').innerHTML = h;
  Object.keys(keep).forEach((id) => { const e = $(id); if (e) e.value = keep[id]; });
}

/* Beim Start: Hash-Login (Host-Link) auswerten und loslegen */
initSocket();
loadInfo();
route();
