#!/bin/bash
# Doppelklick-Start für macOS (Linux: ./start.command)
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js fehlt. Bitte von https://nodejs.org installieren und danach nochmal starten."
  read -n 1 -s -r -p "Taste drücken zum Beenden …"; exit 1
fi
[ -d node_modules ] || { echo "Installiere Pakete (einmalig) …"; npm install --omit=dev; }
node server.js
