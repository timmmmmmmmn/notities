-- Labels (JSON-lijst met namen), kleur, archief en herinnering per notitie.
ALTER TABLE notes ADD COLUMN labels TEXT NOT NULL DEFAULT '[]';
ALTER TABLE notes ADD COLUMN color TEXT NOT NULL DEFAULT '';
ALTER TABLE notes ADD COLUMN archived_at INTEGER;
ALTER TABLE notes ADD COLUMN remind_at INTEGER;

-- Eerdere versies: hooguit één per kwartier per notitie, de laatste 50 blijven bewaard.
CREATE TABLE note_versions (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id  TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  title    TEXT NOT NULL,
  body     TEXT NOT NULL,
  kind     TEXT NOT NULL,
  saved_at INTEGER NOT NULL
);
CREATE INDEX idx_versions_note ON note_versions(note_id, saved_at);
