-- A check-in can now be text only: such a row carries a note and no grade, so
-- `tier` becomes nullable. SQLite cannot relax NOT NULL or widen a CHECK in
-- place, so the table is rebuilt and every existing row is copied across
-- unchanged — nothing is graded or ungraded by this migration.

CREATE TABLE entries_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  metric_id TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  tier TEXT CHECK (tier IS NULL OR tier IN ('A', 'B', 'C', 'D', 'E', 'F')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Without a grade the note is the entire record, so a row that has neither
  -- would render as a blank line in the log. Reject it at the storage layer.
  CHECK (tier IS NOT NULL OR (note IS NOT NULL AND trim(note) <> ''))
);

INSERT INTO entries_v3 (id, metric_id, date, time, tier, note, created_at, updated_at)
SELECT id, metric_id, date, time, tier, note, created_at, updated_at FROM entries;

DROP TABLE entries;

ALTER TABLE entries_v3 RENAME TO entries;

CREATE INDEX idx_entries_metric_date ON entries (metric_id, date, time);
