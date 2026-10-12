-- Schema v4 — rebuild-plan 13.1 (stage 10, timetable import).
-- Both columns are nullable; existing rows keep their meaning.

ALTER TABLE activity ADD COLUMN kind TEXT;        -- NULL = normal; 'schedule' = timetable group (top level only)
ALTER TABLE plan     ADD COLUMN skip_dates TEXT;  -- skipped dates 'YYYY-MM-DD,YYYY-MM-DD' (e.g. holidays), NULL = none
