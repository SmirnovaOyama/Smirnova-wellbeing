-- The owner name in the page title is edited from the dashboard and has to
-- survive a redeploy, so it lives in the database rather than in an env var —
-- an env var can only be changed by editing config and restarting the worker.
--
-- Deliberately a generic key/value table: later settings can be added without
-- a migration each. SITE_OWNER stays supported as the fallback for a database
-- that has no row yet.

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
