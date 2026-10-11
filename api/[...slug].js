// Vercel: eine Serverless-Funktion für die gesamte API (/api/...)
const { handle } = require('../lib/api');

module.exports = async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const out = await handle({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body: req.body, headers: req.headers, ip });
  res.setHeader('Cache-Control', 'no-store');
  res.status(out.status).json(out.json);
};
