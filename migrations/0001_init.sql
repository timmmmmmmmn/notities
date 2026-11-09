-- Gebruikers. De eerste gebruiker wordt automatisch beheerder en is direct actief;
-- alle volgende accounts staan op 'pending' tot een beheerder ze goedkeurt.
-- note_seq loopt op bij elke wijziging aan een notitie (voor de synchronisatie).
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled')),
  is_admin      INTEGER NOT NULL DEFAULT 0,
  note_seq      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

-- Inlogsessies (token wordt alleen gehasht opgeslagen).
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Notities. Het id maakt het apparaat zelf aan, zodat je ook offline nieuwe notities kunt maken.
-- kind 'lijst': elke regel in body is "[ ] tekst" of "[x] tekst".
-- deleted_at gezet = in de prullenbak; purged = definitief weg (rij blijft als markering voor sync).
CREATE TABLE notes (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  kind       TEXT NOT NULL DEFAULT 'tekst' CHECK (kind IN ('tekst', 'lijst')),
  pinned     INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  purged     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  rev        INTEGER NOT NULL DEFAULT 1,
  seq        INTEGER NOT NULL
);
CREATE INDEX idx_notes_sync ON notes(user_id, seq);

-- Eenvoudige rate limiting voor inloggen en registreren.
CREATE TABLE attempts (
  key TEXT NOT NULL,
  at  INTEGER NOT NULL
);
CREATE INDEX idx_attempts ON attempts(key, at);
