// Vercel: Startseite – zeigt Willkommensbildschirm oder die App (je nach Cookie)
const { isAuthed, view } = require('../lib/auth');

module.exports = (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(view(isAuthed(req) ? 'app.html' : 'welcome.html'));
};
