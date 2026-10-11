// Live-Verbindung per socket.io (Vorbild: RAJ/Knockout-Server).
// - Befehle laufen über denselben Code wie die HTTP-API (handle), nur eben über die offene Verbindung
// - Der Server schickt "changed" an alle im Raum, sobald sich etwas ändert -> kein ständiges Nachfragen
// - Wer die Verbindung verliert, gilt sofort als offline
// Ist socket.io nicht installiert, läuft die App automatisch weiter mit HTTP-Abfragen.
const { handle, isLocalAddress, presence, roomCodeOf } = require('./api');

function attach(server) {
  let Server;
  try { ({ Server } = require('socket.io')); } catch (_) { return null; }
  const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 20000 });
  const changed = (code) => io.to(code).emit('changed');
  const mutating = (method, path) => method === 'POST' && /^\/api\/t(\/|$)/.test(path);
  let online = 0;

  io.on('connection', (socket) => {
    online++; io.emit('online', online);
    const local = isLocalAddress(socket.handshake.address);
    const ip = socket.handshake.address || '';

    // Client sagt, welchen Raum er beobachtet (und mit welchem Schlüssel er dort sitzt)
    socket.on('watch', (msg, cb) => {
      const code = String((msg && msg.code) || '').toUpperCase();
      if (!/^[A-Z0-9]{4,12}$/.test(code)) return typeof cb === 'function' && cb({ ok: false });
      if (socket.data.code) { presence(socket.data.code, socket.data.token, -1); socket.leave(socket.data.code); changed(socket.data.code); }
      socket.data.code = code; socket.data.token = String((msg && msg.token) || '');
      socket.join(code);
      presence(code, socket.data.token, +1);
      changed(code);
      if (typeof cb === 'function') cb({ ok: true });
    });

    // Befehle: dieselbe API wie per HTTP
    socket.on('api', async (req, cb) => {
      if (typeof cb !== 'function' || !req || typeof req.path !== 'string') return;
      const method = req.method === 'POST' ? 'POST' : 'GET';
      const token = String(req.token || '');
      const out = await handle({ method, path: req.path, query: req.query || {}, body: req.body || {}, headers: token ? { authorization: 'Bearer ' + token } : {}, ip, local });
      cb(out);
      if (out.status < 400 && mutating(method, req.path)) { const c = roomCodeOf(req.path); if (c) changed(c); }
    });

    socket.on('disconnect', () => {
      online = Math.max(0, online - 1); io.emit('online', online);
      const { code, token } = socket.data || {};
      if (code) { presence(code, token, -1); changed(code); }
    });
  });

  return { io, notify: changed, mutating };
}

module.exports = { attach };
