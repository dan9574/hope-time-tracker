-- Schema v3 — rebuild-plan 12.2 (stage 7, sync).
-- `dirty` = this row has a local change the server has not acknowledged yet.
--   Every local write sets it to 1; a successful push (with `updated_ms` unchanged since) or a pulled
--   row sets it to 0. Existing rows start dirty, so the first sign-in uploads everything.
-- Never exported to JSON.

ALTER TABLE activity ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
ALTER TABLE session  ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
ALTER TABLE plan     ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
ALTER TABLE journal  ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
ALTER TABLE day      ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;

CREATE INDEX activity_dirty ON activity (dirty) WHERE dirty = 1;
CREATE INDEX session_dirty  ON session  (dirty) WHERE dirty = 1;
CREATE INDEX plan_dirty     ON plan     (dirty) WHERE dirty = 1;
CREATE INDEX journal_dirty  ON journal  (dirty) WHERE dirty = 1;
CREATE INDEX day_dirty      ON day      (dirty) WHERE dirty = 1;
