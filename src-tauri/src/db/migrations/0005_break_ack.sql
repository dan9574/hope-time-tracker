-- Schema v5 — rebuild-plan 15.1 (stage 12, break reminder).
-- Nullable; existing rows keep their meaning.

ALTER TABLE session ADD COLUMN break_ack_ms INTEGER;  -- when the user last chose "Keep Going" on a break reminder, NULL = never
