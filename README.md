# Smash Turnier

Turnier-App für Super Smash Bros. Ultimate **für den Freundeskreis – ohne Internet-Hosting und ohne Datenbank**.
Dein Gerät (Laptop/PC) ist der Server. Freunde im **selben WLAN** treten per **QR-Code** bei, und alle sehen den Stand **live**.

## Starten (Host-Gerät)

1. Einmalig [Node.js](https://nodejs.org) installieren (Version 18 oder neuer). Die Start-Skripte installieren beim ersten Mal automatisch `socket.io` (`npm install`).
2. Projekt starten:
   - **Windows:** Doppelklick auf `start.bat`
   - **Mac:** Doppelklick auf `start.command`
   - oder in jedem Terminal: `npm install --omit=dev && node server.js`
3. Der Browser öffnet sich auf `http://localhost:3000`. Dort **„Turnier erstellen“**. In der Lobby erscheint der **QR-Code**.
4. Freunde scannen ihn mit der Handy-Kamera (gleiches WLAN!), tragen ihren Namen ein – fertig.

Das Host-Gerät muss während des Turniers laufen und im WLAN bleiben. Beenden mit `Strg+C`.

> **Wichtig:** Öffne das Turnier am Host-Gerät immer über `http://localhost:3000` (nicht über die WLAN-Adresse). Nur dort lassen sich Turniere erstellen, und dort liegt dein Host-Schlüssel.

## So läuft ein Turnier

1. **Host:** erstellt das Turnier, stellt bei Bedarf Bots ein, vergibt die Alex-Regel (2 Leben) und startet. Gruppen werden ausgelost, danach läuft der feste Turnierbaum (Winners / Losers / Amateur / Großes Finale).
2. **Teilnehmer:** pflegen ihr Profil (Name, Erfahrung, Charakterliste – der erste Charakter ist das Icon).
3. **Ergebnisse:** Ein Teilnehmer meldet nach jeder Runde die Kills, der **Gegner bestätigt** (oder lehnt ab) – erst dann zählt die Runde. Gegen Bots und bei Korrekturen trägt der Host ein.

### Wer darf was? (wird vom Host-Gerät geprüft)

| Aktion | Host | Teilnehmer | Zuschauer |
|---|:-:|:-:|:-:|
| Turnier erstellen (nur am Host-Gerät) | ✔ | – | – |
| Starten / zurücksetzen / löschen | ✔ | – | – |
| Bots, Alex-Regel, Teilnehmer entfernen | ✔ | – | – |
| Gruppen-Gleichstand entscheiden | ✔ | – | – |
| Ergebnisse direkt eintragen, Runde löschen, „Zurück“ (Undo) | ✔ | – | – |
| Eigenen Namen, Erfahrung, Charaktere ändern | ✔ (wenn er mitspielt) | ✔ | – |
| Ergebnis eines **eigenen** Matches melden | ✔ | ✔ | – |
| Ergebnis des Gegners **bestätigen/ablehnen** | ✔ (immer) | ✔ (nur eigener Gegner) | – |
| Alles ansehen | ✔ | ✔ | ✔ |

Wer nach dem Start über den QR-Code kommt, ist Zuschauer. Teilnehmer erkennt das Host-Gerät an einem persönlichen Schlüssel, der nur in deren Browser liegt. Der Host kann selbst mitspielen und das Turnier per **Host-Link** (Host-Bereich) auf einem zweiten Gerät leiten.

**Live-Verbindung (wie beim RAJ-Quiz):** Per socket.io hält jedes Handy eine offene Verbindung zum Host. Änderungen erscheinen sofort bei allen, wer die Verbindung verliert, ist sofort offline (grüner Punkt weg), und in der Startansicht steht, wie viele gerade online sind. Ohne socket.io fällt die App automatisch auf Abfragen alle 3 Sekunden zurück.

## Nicht öffentlich

Es gibt kein Hosting im Internet. Die App ist nur für Geräte im selben WLAN erreichbar und der Beitritt läuft über den zufälligen Raum-Code (im QR-Code). Es werden keine Daten an Dritte geschickt.

## Speicherung

Alles liegt im Arbeitsspeicher des Host-Geräts und wird zusätzlich in `data/rooms.json` gesichert. Wenn das Programm abstürzt oder neu gestartet wird, sind Turnier, Teilnehmer und Ergebnisse wieder da. Zum Löschen: Turnier im Host-Bereich löschen oder die Datei entfernen. Turniere ohne Aktivität werden nach 14 Tagen aufgeräumt.

## Wenn Freunde nicht beitreten können

- **Gleiches WLAN?** Alle Geräte müssen im selben Netzwerk sein.
- **Windows-Firewall:** Beim ersten Start fragt Windows, ob Node.js im Netzwerk kommunizieren darf. **Zulassen** (für „Privat“).
- **Gäste-WLAN / Router mit „Client-Isolation“:** Dort sehen sich Geräte nicht. Lösung: Hotspot am Handy anschalten; Laptop und Freunde verbinden sich damit.
- **Mehrere Netzwerke am Host-Gerät** (z. B. VPN, Ethernet + WLAN): In der Lobby lässt sich unter „Netzwerk“ die richtige Adresse für den QR-Code wählen.
- Anderer Port: `PORT=3001 node server.js` (Windows: `set PORT=3001 && node server.js`).

Ausnahmen für Fortgeschrittene (Umgebungsvariablen): `PUBLIC_URL` (feste Adresse im QR-Code), `ALLOW_REMOTE_CREATE=1` (Turniere auch von anderen Geräten erstellen), `DATA_FILE` (anderer Speicherort, leer = nicht speichern).

## Tests

```bash
npm install     # nur für die Tests (jsdom)
npm test
```

`test/e2e.js` prüft die API (Rechte, Bestätigungsfluss, Online-Status, Speichern/Neustart, komplettes Turnier), `test/ui.js` simuliert mehrere Browser (Host, Teilnehmer, Zuschauer).

## Aufbau

| Pfad | Zweck |
|---|---|
| `server.js` | Server auf dem Host-Gerät |
| `lib/api.js` | Regeln und Rechteprüfung |
| `lib/store.js` | Speicher (RAM + `data/rooms.json`) |
| `public/` | Oberfläche: `index.html`, `app.js`, `style.css`, `qr.js` (QR-Generator), `icons.js` |
| `public/engine.js` | Turnierregeln (Gruppen, fester Baum, Kill-Logik) – läuft im Server und im Browser |

## Gut zu wissen

- Maximal 24 Spieler (Teilnehmer + Bots), weil der Turnierbaum fest für 24 ausgelegt ist. Weitere Personen können zuschauen.
- Die Verbindung im WLAN ist unverschlüsselt (http). Für ein Freunde-Turnier ist das in Ordnung. „Link kopieren“ funktioniert deshalb am Handy manchmal nur über ein Eingabefenster zum Markieren.
- Wer seinen Browser-Speicher löscht, verliert seine Teilnehmer-Identität. Der Host kann ihn in der Lobby entfernen, danach tritt er neu bei (nach dem Start nicht mehr).


## Optional: auf Render betreiben (wie RAJ)

`render.yaml` liegt bei. Auf Render als Web Service anlegen, `HOST_PASSWORD` setzen: Turniere erstellen geht dann nur mit diesem Passwort (Feld erscheint auf der Startseite). `ALLOW_REMOTE_CREATE=1` ist dort bereits gesetzt, der QR-Code nutzt die Render-Adresse. Achtung: Es gibt keine Datenbank, nach Neustart oder Schlafmodus des kostenlosen Tarifs sind die Turniere weg. Für den Abend am besten das Host-Gerät im WLAN nutzen.
