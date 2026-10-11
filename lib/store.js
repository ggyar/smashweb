// Speicher ohne Datenbank: alle Räume liegen im Arbeitsspeicher des Host-Geräts
// und werden zusätzlich in eine JSON-Datei geschrieben (data/rooms.json), damit ein Neustart nichts verliert.
const fs = require('fs');
const path = require('path');

// DATA_FILE='' schaltet das Speichern auf Platte aus (z. B. für Tests)
const file = () => (process.env.DATA_FILE !== undefined ? process.env.DATA_FILE : path.join(__dirname, '..', 'data', 'rooms.json'));
const rooms = new Map();
let timer = null;

function load() {
  rooms.clear();
  const f = file();
  if (!f || !fs.existsSync(f)) return 0;
  try {
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    Object.keys(data.rooms || {}).forEach((code) => rooms.set(code, data.rooms[code]));
  } catch (e) {
    console.error('Gespeicherte Turniere konnten nicht gelesen werden:', e.message);
    try { fs.copyFileSync(f, f + '.defekt'); } catch (_) { /* ignorieren */ }
  }
  return rooms.size;
}

function flush() {
  clearTimeout(timer); timer = null;
  const f = file();
  if (!f) return;
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ rooms: Object.fromEntries(rooms) }));
    fs.renameSync(tmp, f); // atomar: nie eine halbe Datei
  } catch (e) {
    console.error('Speichern fehlgeschlagen:', e.message);
  }
}

// Speichern leicht verzögert bündeln
function persist() {
  if (!file()) return;
  clearTimeout(timer);
  timer = setTimeout(flush, 400);
  if (timer.unref) timer.unref();
}

['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, () => { flush(); process.exit(0); }));
process.on('exit', () => { if (timer) flush(); });

module.exports = { rooms, load, flush, persist };
