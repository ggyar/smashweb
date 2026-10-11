-- Datenbankschema für Smash Turnier (PostgreSQL).
-- Wird beim ersten Start automatisch angelegt (lib/db.js, "migrate"). Diese Datei dient als Referenz.

-- Ein Turnier. Der Beitrittscode (id) steckt im QR-Code. Der Host-Schlüssel wird nur als Hash gespeichert.
CREATE TABLE IF NOT EXISTS tournaments (
  id          TEXT PRIMARY KEY,
  name        TEXT        NOT NULL,
  host_hash   TEXT        NOT NULL,
  phase       TEXT        NOT NULL DEFAULT 'lobby',   -- lobby | play | done
  nbots       INT         NOT NULL DEFAULT 0,
  state       JSONB       NOT NULL,                   -- Gruppen, Matches, Turnierbaum (siehe public/engine.js)
  version     INT         NOT NULL DEFAULT 1,         -- steigt bei jeder Änderung, Clients holen sich damit Updates
  host_seen   TIMESTAMPTZ,                            -- Online-Status des Hosts
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Teilnehmer (der Host kann zusätzlich mitspielen: is_host = true, gleicher Schlüssel).
CREATE TABLE IF NOT EXISTS participants (
  id            SERIAL PRIMARY KEY,
  tournament_id TEXT        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  token_hash    TEXT        NOT NULL,                 -- Hash des persönlichen Schlüssels (liegt im Browser)
  name          TEXT        NOT NULL,
  level         INT         NOT NULL DEFAULT 0,       -- 0 = Normal, 1 = Fortgeschritten
  alex          BOOLEAN     NOT NULL DEFAULT false,   -- 2 Leben, nur vom Host vergeben
  characters    JSONB       NOT NULL DEFAULT '[]',    -- bester Charakter zuerst
  is_host       BOOLEAN     NOT NULL DEFAULT false,
  last_seen     TIMESTAMPTZ,                          -- Online-Status (Heartbeat)
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, token_hash)
);

-- Gemeldete Rundenergebnisse, die der Gegner noch bestätigen muss.
CREATE TABLE IF NOT EXISTS reports (
  id            SERIAL PRIMARY KEY,
  tournament_id TEXT        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  match_key     TEXT        NOT NULL,                 -- 'g:<index>' (Gruppe) oder 'b:<id>' (Turnierbaum)
  round_no      INT         NOT NULL,                 -- Nummer der Runde im Match (0-basiert)
  reporter_pid  INT         NOT NULL,
  ka            INT         NOT NULL,                 -- Kills von Spieler A (m.a)
  kb            INT         NOT NULL,                 -- Kills von Spieler B (m.b)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Verlauf für "Rückgängig" (nur Host).
CREATE TABLE IF NOT EXISTS history (
  id            SERIAL PRIMARY KEY,
  tournament_id TEXT        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  state         JSONB       NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS participants_t ON participants (tournament_id);
CREATE INDEX IF NOT EXISTS reports_t ON reports (tournament_id);
CREATE INDEX IF NOT EXISTS history_t ON history (tournament_id, id);
