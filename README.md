# Smash Turnier

Turnier-App für Super Smash Bros. Ultimate (Gruppenphase, fester Turnierbaum mit Winners-, Losers- und Amateur-Bracket, Kill-Statistik). Beim Öffnen erscheint ein Willkommensbildschirm, die App selbst wird erst nach Eingabe des Zugangscodes ausgeliefert.

## Aufbau

| Datei | Zweck |
|---|---|
| `views/welcome.html` | Willkommensbildschirm mit Zugangscode-Eingabe |
| `views/app.html` | Die Turnier-App (wird nur mit gültigem Cookie ausgeliefert) |
| `server.js` | Server für **Render** (und lokal) |
| `api/*.js` | Serverless-Funktionen für **Vercel** |
| `lib/auth.js` | Gemeinsame Prüfung von Code und Cookie |
| `public/hero.jpg` | Titelbild (öffentlich) |
| `render.yaml`, `vercel.json` | Deploy-Konfiguration |

## Umgebungsvariablen

- `ACCESS_CODE` – **Pflicht.** Der Zugangscode für deine Freunde (Groß-/Kleinschreibung egal).
- `SESSION_SECRET` – optional, ein langer Zufallstext zum Signieren des Login-Cookies. Auf Render wird er automatisch erzeugt.

Wenn du `ACCESS_CODE` später änderst, werden alle bestehenden Logins ungültig.

## Deploy auf Render

1. Auf [render.com](https://render.com) einloggen → **New → Blueprint** → Repo `smashweb` wählen.
2. Beim Anlegen fragt Render nach `ACCESS_CODE` → Code eintragen.
3. **Apply**. Nach ca. 1–2 Minuten ist die Seite unter `https://smashweb.onrender.com` (oder ähnlich) erreichbar.

Alternativ ohne Blueprint: **New → Web Service**, Build Command leer lassen, Start Command `node server.js`, Variable `ACCESS_CODE` setzen.

Hinweis: Im kostenlosen Render-Tarif schläft der Dienst nach Inaktivität ein, der erste Aufruf dauert dann ~30–60 Sekunden. Öffne die Seite also kurz vor dem Turnier.

## Deploy auf Vercel

1. Auf [vercel.com](https://vercel.com) → **Add New → Project** → Repo `smashweb` importieren.
2. Framework Preset: **Other**. Build- und Output-Einstellungen unverändert lassen (kommen aus `vercel.json`).
3. Unter **Environment Variables** `ACCESS_CODE` (und optional `SESSION_SECRET`) eintragen.
4. **Deploy**.

## Lokal testen

```bash
ACCESS_CODE=smash2026 node server.js
# → http://localhost:3000
```

## Gut zu wissen

- Der Turnierstand wird im Browser des jeweiligen Geräts gespeichert (`localStorage`). Es gibt **keinen gemeinsamen Live-Stand**: Wer das Turnier bedient, sollte ein Gerät nutzen. Die anderen können die Seite zum Ansehen nicht live synchron nutzen. Dafür bräuchte es eine Datenbank.
- Der Zugangscode ist ein einfacher Schutz für den Freundeskreis, keine Hochsicherheit. Nutze keinen Code, den du anderswo als Passwort verwendest.
