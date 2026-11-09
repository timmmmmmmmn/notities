-- Delen: één volgorde-teller voor alle notities (in plaats van per gebruiker), zodat een apparaat
-- ook wijzigingen in andermans gedeelde notities ziet. De teller begint boven alle bestaande nummers.
CREATE TABLE counter (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  n  INTEGER NOT NULL
);
INSERT INTO counter (id, n) SELECT 1, COALESCE(MAX(seq), 0) FROM notes;

-- Met wie een notitie gedeeld is. De persoonlijke velden (vastpinnen, labels, kleur, archief,
-- herinnering) staan per ontvanger hier, zodat iedereen zijn eigen ordening houdt.
CREATE TABLE note_shares (
  note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_write   INTEGER NOT NULL DEFAULT 1,
  pinned      INTEGER NOT NULL DEFAULT 0,
  labels      TEXT NOT NULL DEFAULT '[]',
  color       TEXT NOT NULL DEFAULT '',
  archived_at INTEGER,
  remind_at   INTEGER,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (note_id, user_id)
);
CREATE INDEX idx_note_shares_user ON note_shares(user_id);

-- Delen gestopt: de apparaten van de ontvanger moeten de notitie dan weghalen.
CREATE TABLE share_removals (
  note_id TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seq     INTEGER NOT NULL
);
CREATE INDEX idx_share_removals ON share_removals(user_id, seq);
