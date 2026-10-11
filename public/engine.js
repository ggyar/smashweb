/* Turnier-Engine – wird vom Server (Regelprüfung) UND vom Browser (Anzeige) benutzt.
   Alle Funktionen arbeiten auf einem reinen JSON-Zustand S und verändern ihn direkt. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const ROSTER = "Mario,Donkey Kong,Link,Samus,Dark Samus,Yoshi,Kirby,Fox,Pikachu,Luigi,Ness,Captain Falcon,Jigglypuff,Peach,Daisy,Bowser,Ice Climbers,Sheik,Zelda,Dr. Mario,Pichu,Falco,Marth,Lucina,Young Link,Ganondorf,Mewtwo,Roy,Chrom,Mr. Game & Watch,Meta Knight,Pit,Dark Pit,Zero Suit Samus,Wario,Snake,Ike,Pokémon Trainer,Diddy Kong,Lucas,Sonic,King Dedede,Olimar,Lucario,R.O.B.,Toon Link,Wolf,Villager,Mega Man,Wii Fit Trainer,Rosalina & Luma,Little Mac,Greninja,Mii Brawler,Mii Swordfighter,Mii Gunner,Palutena,Pac-Man,Robin,Shulk,Bowser Jr.,Duck Hunt,Ryu,Ken,Cloud,Corrin,Bayonetta,Inkling,Ridley,Simon,Richter,King K. Rool,Isabelle,Incineroar,Piranha Plant,Joker,Hero,Banjo & Kazooie,Terry,Byleth,Min Min,Steve,Sephiroth,Pyra/Mythra,Kazuya,Sora".split(',');
  const GL = 'ABCDEFGH', BN2 = { W: 'Winners', L: 'Losers', A: 'Amateur', F: 'Finale' }, LBL = {};
  const MAX_PLAYERS = 24;

  const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const isP = (x) => x != null && x >= 0;
  const need = (bo) => (bo >> 1) + 1;
  const stocks = (S, i) => (S.players[i].alex ? 2 : 3);

  function plan(N) {
    const g = Math.min(8, Math.ceil(N / 3)), b = Math.floor(N / g), r = N % g;
    return Array.from({ length: g }, (_, i) => b + (i < r ? 1 : 0));
  }

  const newState = (nbots) => ({ phase: 'lobby', nbots: nbots || 0, players: [], groups: [], gm: [], ord: [], lock: [], rank: [], m: {} });

  /* ---------- Runden / Matches ---------- */
  function gw(S, q, a, b) {
    const ra = q.ka >= stocks(S, b), rb = q.kb >= stocks(S, a);
    if (ra && !rb) return 0;
    if (rb && !ra) return 1;
    if (!ra && !rb && q.ka != q.kb) return q.ka > q.kb ? 0 : 1;
    return -1;
  }
  function tally(S, m) {
    let x = 0, y = 0;
    m.games.forEach((q) => { const w = gw(S, q, m.a, m.b); if (w == 0) x++; else if (w == 1) y++; });
    return [x, y];
  }
  function isDone(S, m) { const [x, y] = tally(S, m), n = need(m.bo || 3); return x >= n || y >= n; }

  /* ---------- Gruppen ---------- */
  function stand(S, g) {
    const r = S.groups[g].map((id) => ({ id, w: 0, d: 0, k: 0, kd: 0 }));
    S.gm.forEach((m) => {
      if (m.g != g) return;
      const A = r.find((x) => x.id == m.a), B = r.find((x) => x.id == m.b), [x, y] = tally(S, m);
      m.games.forEach((q) => { A.k += q.ka; B.k += q.kb; A.kd += q.ka - q.kb; B.kd += q.kb - q.ka; });
      A.d += x - y; B.d += y - x;
      if (x >= 2) A.w++; else if (y >= 2) B.w++;
    });
    const o = S.ord[g];
    return r.sort((p, q) => q.w - p.w || q.d - p.d || q.kd - p.kd || q.k - p.k || o.indexOf(p.id) - o.indexOf(q.id));
  }
  const hasTie = (st) => st.some((x, i) => i && x.w == st[i - 1].w && x.d == st[i - 1].d && x.kd == st[i - 1].kd && x.k == st[i - 1].k);
  function lockG(S, g) { S.lock[g] = 1; S.rank[g] = stand(S, g).map((x) => x.id); }

  /* ---------- Fester Turnierbaum ---------- */
  const DEF = (() => {
    const D = [], add = (id, br, rd, a, b, bo) => D.push({ id, br, rd, a, b, bo });
    const g = (r, x) => ({ t: 'g', r, g: x }), w = (m) => ({ t: 'w', m }), l = (m) => ({ t: 'l', m });
    for (let i = 0; i < 4; i++) add('WQ' + (i + 1), 'W', 'Viertelfinale', g(1, 2 * i), g(1, 2 * i + 1), 5);
    add('WS1', 'W', 'Halbfinale', w('WQ1'), w('WQ2'), 5); add('WS2', 'W', 'Halbfinale', w('WQ3'), w('WQ4'), 5); add('WF', 'W', 'Finale', w('WS1'), w('WS2'), 5);
    for (let i = 0; i < 4; i++) add('L1-' + (i + 1), 'L', '1. Runde', g(2, 2 * i), g(2, 2 * i + 1), 3);
    [['L2-1', 'L1-1', 'WQ3'], ['L2-2', 'L1-2', 'WQ4'], ['L2-3', 'L1-3', 'WQ1'], ['L2-4', 'L1-4', 'WQ2']].forEach(([i, x, y]) => add(i, 'L', '2. Runde', w(x), l(y), 3));
    add('L3-1', 'L', '3. Runde', w('L2-1'), w('L2-2'), 3); add('L3-2', 'L', '3. Runde', w('L2-3'), w('L2-4'), 3);
    add('LQ1', 'L', 'Viertelfinale', w('L3-1'), l('WS1'), 5); add('LQ2', 'L', 'Viertelfinale', w('L3-2'), l('WS2'), 5);
    add('LS', 'L', 'Halbfinale', w('LQ1'), w('LQ2'), 5); add('LF', 'L', 'Finale', w('LS'), l('WF'), 5);
    for (let i = 0; i < 4; i++) add('A1-' + (i + 1), 'A', '1. Runde', g(3, 2 * i), g(3, 2 * i + 1), 3);
    [['A2-1', 'A1-1', 'L1-3'], ['A2-2', 'A1-2', 'L1-4'], ['A2-3', 'A1-3', 'L1-1'], ['A2-4', 'A1-4', 'L1-2']].forEach(([i, x, y]) => add(i, 'A', '2. Runde', w(x), l(y), 3));
    [['A3-1', 'A2-1', 'L2-2'], ['A3-2', 'A2-2', 'L2-1'], ['A3-3', 'A2-3', 'L2-4'], ['A3-4', 'A2-4', 'L2-3']].forEach(([i, x, y]) => add(i, 'A', '3. Runde', w(x), l(y), 3));
    add('A4-1', 'A', '4. Runde', w('A3-1'), w('A3-2'), 3); add('A4-2', 'A', '4. Runde', w('A3-3'), w('A3-4'), 3);
    add('A5-1', 'A', '5. Runde', w('A4-1'), l('L3-2'), 3); add('A5-2', 'A', '5. Runde', w('A4-2'), l('L3-1'), 3);
    add('A6-1', 'A', '6. Runde', w('A5-1'), l('LQ1'), 3); add('A6-2', 'A', '6. Runde', w('A5-2'), l('LQ2'), 3);
    add('AQ', 'A', 'Viertelfinale', w('A6-1'), w('A6-2'), 5); add('AS', 'A', 'Halbfinale', w('AQ'), l('LS'), 5); add('AF', 'A', 'Finale', w('AS'), l('LF'), 5);
    add('GF1', 'F', 'Match 1', w('WF'), w('LF'), 7); add('GF2', 'F', 'Match 2 (Reset)', w('WF'), w('LF'), 7);
    const c = {}, ix = {};
    D.forEach((d) => c[d.br + d.rd] = (c[d.br + d.rd] || 0) + 1);
    D.forEach((d) => { const k = d.br + d.rd; ix[k] = (ix[k] || 0) + 1; LBL[d.id] = BN2[d.br] + ' ' + d.rd + (c[k] > 1 ? ' ' + ix[k] : ''); });
    return D;
  })();

  function slot(S, s) {
    if (s.t == 'g') {
      if (s.g >= S.groups.length) return -1;
      if (!S.lock[s.g]) return null;
      const v = S.rank[s.g][s.r - 1];
      return v === undefined ? -1 : v;
    }
    const M = S.m[s.m];
    if (!M.done) return null;
    return s.t == 'w' ? M.w : M.l;
  }

  function sync(S) {
    S.groups.forEach((_, g) => {
      if (S.lock[g]) return;
      if (S.gm.filter((m) => m.g == g).every((m) => isDone(S, m)) && !hasTie(stand(S, g))) lockG(S, g);
    });
    let ch = true;
    while (ch) {
      ch = false;
      for (const d of DEF) {
        const M = S.m[d.id];
        if (M.done || M.skip) continue;
        if (d.id == 'GF2') { const G = S.m.GF1; if (!G.done) continue; if (G.auto || G.w == slot(S, d.a)) { M.skip = 1; ch = true; continue; } }
        const a = slot(S, d.a), b = slot(S, d.b);
        if (a === null || b === null) continue;
        if (a === -1 || b === -1) { M.done = 1; M.auto = 1; M.w = a === -1 ? b : a; M.l = -1; ch = true; }
      }
    }
    DEF.forEach((d) => { const M = S.m[d.id]; M.a = slot(S, d.a); M.b = slot(S, d.b); });
    S.phase = (S.m.GF1.done && (S.m.GF2.skip || S.m.GF2.done) && S.m.AF.done) ? 'done' : 'play';
  }

  /* ---------- Start (Auslosung) ---------- */
  // plist: [{pid,name,adv,alex,ch}] – Bots kommen aus S.nbots dazu
  function start(S, plist) {
    const ps = plist.map((p) => ({ pid: p.pid, name: p.name, adv: !!(p.adv || p.alex), alex: !!p.alex, ch: p.ch || [], bot: false }));
    for (let i = 1; i <= (S.nbots || 0); i++) ps.push({ pid: null, name: 'Bot ' + i, adv: false, alex: false, ch: [], bot: true });
    if (ps.length < 3) return 'Mindestens 3 Teilnehmer nötig (Bots zählen mit).';
    if (ps.length > MAX_PLAYERS) return 'Der feste Turnierbaum ist für maximal ' + MAX_PLAYERS + ' Teilnehmer ausgelegt.';
    ps.forEach((p, k) => { p.id = k; });
    const Z = plan(ps.length), G = Z.map(() => []);
    const order = [...shuffle(ps.filter((p) => p.bot)), ...shuffle(ps.filter((p) => !p.bot && p.adv)), ...shuffle(ps.filter((p) => !p.bot && !p.adv))];
    order.forEach((p) => {
      let best = 0, bs = 1e9;
      shuffle([...G.keys()]).forEach((g) => {
        if (G[g].length >= Z[g]) return;
        const sc = G[g].length * 10 + (p.adv ? G[g].filter((x) => x.adv).length * 3 : 0) + (p.bot ? G[g].filter((x) => x.bot).length * 20 : 0);
        if (sc < bs) { bs = sc; best = g; }
      });
      G[best].push(p);
    });
    S.players = ps;
    S.groups = G.map((g) => g.map((p) => p.id));
    S.ord = S.groups.map((g) => [...g]);
    S.gm = []; S.lock = []; S.rank = []; S.m = {};
    S.groups.forEach((g, gi) => { for (let x = 0; x < g.length; x++) for (let y = x + 1; y < g.length; y++) S.gm.push({ g: gi, a: g[x], b: g[y], games: [] }); });
    DEF.forEach((d) => { S.m[d.id] = { id: d.id, br: d.br, games: [], w: null, l: null, done: 0, bo: d.bo }; });
    sync(S);
    return null;
  }

  /* ---------- Aktionen auf Matches ---------- */
  function find(S, k, i) {
    if (k == 'g') return S.gm[+i] || null;
    if (k == 'b') return S.m[i] || null;
    return null;
  }
  // Gibt das Match zurück, wenn dort gerade eine Runde eingetragen werden darf
  function playable(S, k, i) {
    if (S.phase != 'play') return null;
    const m = find(S, k, i);
    if (!m) return null;
    if (k == 'g') return (!S.lock[m.g] && !isDone(S, m)) ? m : null;
    return (!m.done && !m.skip && isP(m.a) && isP(m.b)) ? m : null;
  }
  function checkRound(S, m, ka, kb) {
    if (!Number.isInteger(ka) || !Number.isInteger(kb) || ka < 0 || kb < 0) return 'Ungültige Kills.';
    if (ka > stocks(S, m.b) || kb > stocks(S, m.a)) return 'Zu viele Kills: Der Gegner hat nur ' + (ka > stocks(S, m.b) ? stocks(S, m.b) : stocks(S, m.a)) + ' Leben.';
    if (gw(S, { ka, kb }, m.a, m.b) < 0) return 'Unklar, wer die Runde gewonnen hat (3 Kills gegen normale Spieler, 2 gegen Alex).';
    return null;
  }
  function addGame(S, k, i, ka, kb) {
    const m = playable(S, k, i);
    if (!m) return 'Dieses Match ist gerade nicht spielbar.';
    const err = checkRound(S, m, ka, kb);
    if (err) return err;
    m.games.push({ ka, kb });
    if (k == 'b') { const [x, y] = tally(S, m), n = need(m.bo || 3); if (x >= n || y >= n) finish(S, m, x >= n ? 0 : 1); }
    sync(S);
    return null;
  }
  function delGame(S, k, i) {
    const m = playable(S, k, i);
    if (!m || !m.games.length) return 'Keine Runde zum Löschen.';
    m.games.pop(); sync(S);
    return null;
  }
  function finish(S, m, side) { m.w = side ? m.b : m.a; m.l = side ? m.a : m.b; m.done = 1; }
  function moveUp(S, g, id) {
    if (S.phase != 'play' || !S.groups[g] || S.lock[g]) return 'Gruppe ist bereits festgelegt.';
    const o = S.ord[g], i = o.indexOf(id);
    if (i < 1) return 'Nicht verschiebbar.';
    [o[i - 1], o[i]] = [o[i], o[i - 1]];
    return null;
  }
  function confirmGroup(S, g) {
    if (S.phase != 'play' || !S.groups[g] || S.lock[g]) return 'Gruppe ist bereits festgelegt.';
    if (!S.gm.filter((m) => m.g == g).every((m) => isDone(S, m))) return 'Noch nicht alle Gruppenmatches gespielt.';
    lockG(S, g); sync(S);
    return null;
  }

  /* ---------- Platzierungen ---------- */
  function tiers(S) {
    const L = (id) => S.m[id].done ? [S.m[id].l] : [], W = (id) => S.m[id].done ? [S.m[id].w] : [];
    const fin = S.phase == 'done', f = S.m.GF2.done ? S.m.GF2 : S.m.GF1;
    return [['1.', fin ? [f.w] : []], ['2.', fin ? [f.l] : []], ['3.', W('AF')], ['4.', L('AF')], ['5.', L('AS')], ['6.', L('AQ')],
      ['7./8.', [...L('A6-1'), ...L('A6-2')]], ['9./10.', [...L('A5-1'), ...L('A5-2')]], ['11./12.', [...L('A4-1'), ...L('A4-2')]],
      ['13.–16.', [1, 2, 3, 4].flatMap((i) => L('A3-' + i))], ['17.–20.', [1, 2, 3, 4].flatMap((i) => L('A2-' + i))], ['21.–24.', [1, 2, 3, 4].flatMap((i) => L('A1-' + i))]]
      .map(([t, a]) => [t, a.filter(isP)]).filter((t) => t[1].length);
  }

  return { ROSTER, GL, BN2, LBL, DEF, MAX_PLAYERS, shuffle, isP, need, stocks, plan, newState, gw, tally, isDone, stand, hasTie, lockG, slot, sync, start, find, playable, checkRound, addGame, delGame, moveUp, confirmGroup, tiers };
});
