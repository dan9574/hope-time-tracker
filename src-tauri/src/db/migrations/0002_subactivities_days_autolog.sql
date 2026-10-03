-- Schema v2 — rebuild-plan 10.0 (stage 6.5). Every column is nullable or defaulted, so v1 data and
-- older hope/1 export files stay valid.

-- C. Sub-activities: one level only. A child's color always follows its parent.
ALTER TABLE activity ADD COLUMN parent_id TEXT;            -- NULL = top level
CREATE INDEX activity_parent ON activity (parent_id);

-- F. Sessions generated from a plan, and plan options.
ALTER TABLE session ADD COLUMN plan_id TEXT;               -- non-NULL = logged automatically from this plan
CREATE INDEX session_plan ON session (plan_id);
ALTER TABLE plan ADD COLUMN auto_log INTEGER NOT NULL DEFAULT 1;   -- log a session when the plan's time passes
ALTER TABLE plan ADD COLUMN until TEXT;                    -- last day (inclusive) of a recurring plan; NULL = forever

-- E. Each day's actual wake-up / bedtime.
CREATE TABLE day (
  date           TEXT PRIMARY KEY NOT NULL,                -- local date of the wake-up, 'YYYY-MM-DD'
  wake_ms        INTEGER,                                  -- NULL = use the default from Settings
  sleep_ms       INTEGER,                                  -- NULL = still awake / use the default
  utc_offset_min INTEGER NOT NULL,                         -- time zone of that day, for showing history in local time
  updated_ms     INTEGER NOT NULL,
  deleted_ms     INTEGER,
  device_id      TEXT NOT NULL
);
CREATE INDEX day_updated ON day (updated_ms);
