# Smash Turnier

Online-Turnier-App für Super Smash Bros. Ultimate: **ein Host, beliebig viele Teilnehmer** (bis 24 – so viele passen in den festen Turnierbaum). Beitritt per **QR-Code**, alle sehen den Stand **live**.

## So funktioniert's

1. **Host:** Startseite → „Turnier erstellen“. In der Lobby erscheint ein **QR-Code** (und ein Link/Code zum Teilen).
2. **Teilnehmer:** QR-Code mit der Handy-Kamera scannen (oder Code auf der Startseite eingeben), Namen eintragen → „Beitreten“. Danach lässt sich das eigene Profil bearbeiten: Name, Erfahrung (Normal/Fortgeschritten) und Charakterliste (bester zuerst; der erste ist das Icon).
3. **Host** stellt bei Bedarf Bots ein, vergibt die Alex-Regel (2 Leben) und startet das Turnier: Gruppen werden ausgelost, danach läuft der feste Turnierbaum (Winners / Losers / Amateur / Großes Finale).
4. **Ergebnisse:** Ein Teilnehmer meldet nach jeder Runde die Kills. Der **Gegner bestätigt** (oder lehnt ab) – erst dann zählt die Runde. Gegen Bots und bei Korrekturen trägt der Host ein.

### Wer darf was? (wird auf dem Server geprüft)

| Aktion | Host | Teilnehmer | Zuschauer |
|---|:-:|:-:|:-:|
| Turnier starten / zurücksetzen / löschen | ✔ | – | – |
| Bots, Alex-Regel, Teilnehmer entfernen | ✔ | – | – |
| Gruppen-Gleichstand entscheiden | ✔ | – | – |
| Ergebnisse direkt eintragen, Runde löschen, „Zurück“ (Undo) | ✔ | – | – |
| Eigenen Namen, Erfahrung, Charaktere ändern | ✔ (wenn er mitspielt) | ✔ | – |
| Ergebnis eines **eigenen** Matches melden | ✔ | ✔ | – |
| Ergebnis des Gegners **bestätigen/ablehnen** | ✔ (immer) | ✔ (nur eigener Gegner) | – |
| Alles ansehen | ✔ | ✔ | ✔ |

Wer nach dem Start über den Link kommt, ist Zuschauer. Teilnehmer erkennt der Server an einem persönlichen Schlüssel, der nur im Browser liegt (in der Datenbank steht nur ein Hash).

Der Host kann selbst mitspielen („Ich spiele auch mit“) und das Turnier mit dem **Host-Link** (Host-Bereich) auf einem zweiten Gerät leiten.

## Datenbank

PostgreSQL. Die Tabellen werden beim ersten Start automatisch angelegt (Schema: [`db/schema.sql`](db/schema.sql)):

- `tournaments` – Turnier, Phase, Turnierbaum-Zustand (JSONB), Versionsnummer, Host-Online-Status
- `participants` – Teilnehmer mit Profil, Charakteren und `last_seen` (= **Online-Status**)
- `reports` – gemeldete Runden, die der Gegner noch bestätigen muss
- `history` – Verlauf für „Zurück“ (Undo)

**Online-Status:** Jeder offene Browser fragt alle 3 s den Stand ab („Heartbeat“); wer in den letzten 20 s aktiv war, hat einen grünen Punkt. Änderungen erscheinen bei allen innerhalb weniger Sekunden. Turniere ohne Aktivität werden nach 30 Tagen gelöscht.

### Kostenlose Datenbank (empfohlen: Neon)

1. Auf [neon.tech](https://neon.tech) anmelden → neues Projekt.
2. **Connection string** kopieren (`postgresql://…?sslmode=require`). Das ist deine `DATABASE_URL`.

(Jeder andere Postgres geht auch, z. B. Supabase oder Render Postgres. Beachte: Render-Postgres im Free-Tarif läuft nach 30 Tagen ab.)

## Deploy auf Render

1. [render.com](https://render.com) → **New → Blueprint** → Repo `smashweb` wählen.
2. `DATABASE_URL` eintragen → **Apply**.

Im Free-Tarif schläft der Dienst nach Inaktivität ein; der erste Aufruf dauert dann ~1 Minute. Öffne die Seite vor dem Turnier einmal kurz.

## Deploy auf Vercel

1. [vercel.com](https://vercel.com) → **Add New → Project** → Repo importieren, Framework **Other**.
2. Unter **Environment Variables** `DATABASE_URL` eintragen → **Deploy**.

## Lokal starten

```bash
npm install
DATABASE_URL=postgresql://… node server.js   # → http://localhost:3000
```

Zum Ausprobieren ohne eigene Datenbank gibt es einen In-Memory-Modus (`DATABASE_URL=memory`, Daten weg beim Neustart, nur für Entwicklung).

## Tests

```bash
npm test                                      # In-Memory-Datenbank
DATABASE_URL=postgresql://… npm test          # gegen echtes Postgres (inkl. Test gleichzeitiger Zugriffe)
```

`test/e2e.js` prüft die API (Rechte, Bestätigungsfluss, Online-Status, komplettes Turnier mit gemischten Eingaben), `test/ui.js` simuliert mehrere Browser (Host, Teilnehmer, Zuschauer).

## Aufbau

| Pfad | Zweck |
|---|---|
| `public/` | App im Browser: `index.html`, `app.js`, `style.css`, `qr.js` (QR-Generator), `icons.js`, `engine.js` |
| `public/engine.js` | Turnierregeln (Gruppen, fester Baum, Kill-Logik) – läuft im Server **und** im Browser |
| `lib/api.js` | API mit allen Rechteprüfungen |
| `lib/db.js`, `lib/schema.js` | Datenbankzugriff / Schema |
| `server.js` | Server für Render und lokal |
| `api/[...slug].js` | Serverless-Funktion für Vercel |

## Gut zu wissen

- Maximal 24 Spieler (Teilnehmer + Bots), weil der Turnierbaum fest für 24 ausgelegt ist. Weitere Personen können zuschauen.
- Wer seinen Browser-Speicher löscht, verliert seine Teilnehmer-Identität. Dann kann der Host ihn in der Lobby entfernen, und er tritt neu bei (nach dem Start nicht mehr möglich). Der Host sichert sich mit dem Host-Link ab.
- Der Beitrittscode ist 6-stellig und zufällig. Wer ihn (oder den QR-Code) kennt, kann beitreten, solange das Turnier in der Lobby ist.
