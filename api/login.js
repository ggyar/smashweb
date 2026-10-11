// Vercel: Zugangscode prüfen und Cookie setzen
const { cookieHeader, checkCode, configured } = require('../lib/auth');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  if (!configured()) return res.status(500).json({ ok: false, error: 'ACCESS_CODE ist auf dem Server nicht gesetzt.' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (checkCode(body && body.code)) {
    res.setHeader('Set-Cookie', cookieHeader(req));
    return res.status(200).json({ ok: true });
  }
  // kleine Bremse gegen Durchprobieren
  await new Promise((r) => setTimeout(r, 800));
  return res.status(401).json({ ok: false, error: 'Falscher Zugangscode.' });
};
