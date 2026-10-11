// Vercel: Abmelden
const { cookieHeader } = require('../lib/auth');

module.exports = (req, res) => {
  res.setHeader('Set-Cookie', cookieHeader(req, true));
  res.status(200).json({ ok: true });
};
