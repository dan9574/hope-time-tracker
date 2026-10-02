-- Schema v1 — rebuild-plan 3.1.
-- Every syncable table carries the three sync columns:
--   updated_ms  last write wins
--   deleted_ms  soft delete, NULL = alive
--   device_id   device that made the last write
-- Times are Unix epoch milliseconds; dates are 'YYYY-MM-DD'; clock times are 'HH:MM' (local).
-- No FOREIGN KEY constraints: sync may deliver rows out of order (e.g. a session before its activity).

CREATE TABLE activity (
  id          TEXT PRIMARY KEY NOT NULL,          -- UUID v4
  name        TEXT NOT NULL,
  color       TEXT NOT NULL CHECK (color IN ('blue','green','orange','pink','purple','teal','yellow','gray')),
  symbol      TEXT,                               -- SF Symbol style name
  sort        INTEGER NOT NULL DEFAULT 0,
  archived_at INTEGER,
  updated_ms  INTEGER NOT NULL,
  deleted_ms  INTEGER,
  device_id   TEXT NOT NULL
);

CREATE TABLE session (
  id           TEXT PRIMARY KEY NOT NULL,
  activity_id  TEXT NOT NULL,
  start_ms     INTEGER NOT NULL,
  end_ms       INTEGER,                           -- NULL = running
  note         TEXT,
  continues_id TEXT,                              -- session this one resumes after a pause
  updated_ms   INTEGER NOT NULL,
  deleted_ms   INTEGER,
  device_id    TEXT NOT NULL,
  CHECK (end_ms IS NULL OR end_ms >= start_ms)
);
CREATE INDEX session_start ON session (start_ms);
CREATE INDEX session_activity ON session (activity_id);
CREATE INDEX session_running ON session (end_ms) WHERE end_ms IS NULL;

CREATE TABLE plan (
  id          TEXT PRIMARY KEY NOT NULL,
  activity_id TEXT NOT NULL,
  date        TEXT NOT NULL,                      -- the day for one-off plans; first effective day for recurring ones
  start_hm    TEXT NOT NULL,
  end_hm      TEXT NOT NULL,
  rule        TEXT,                               -- NULL = one-off, 'weekly:1,3,5' = weekly
  updated_ms  INTEGER NOT NULL,
  deleted_ms  INTEGER,
  device_id   TEXT NOT NULL
);
CREATE INDEX plan_date ON plan (date);

CREATE TABLE journal (
  id         TEXT PRIMARY KEY NOT NULL,
  date       TEXT NOT NULL,
  text       TEXT NOT NULL,
  updated_ms INTEGER NOT NULL,
  deleted_ms INTEGER,
  device_id  TEXT NOT NULL
);
CREATE INDEX journal_date ON journal (date);

-- Local to this device; never synced.
CREATE TABLE setting (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE INDEX activity_updated ON activity (updated_ms);
CREATE INDEX session_updated ON session (updated_ms);
CREATE INDEX plan_updated ON plan (updated_ms);
CREATE INDEX journal_updated ON journal (updated_ms);
