-- Migration 005: Reading Progress (Phase 5)
-- Tracks the user's last read chapter per story.

BEGIN;

CREATE TABLE IF NOT EXISTS reading_progress (
    user_id             UUID NOT NULL,
    story_id            UUID NOT NULL REFERENCES stories(story_id) ON DELETE CASCADE,
    last_chapter_order  INT NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, story_id)
);

COMMIT;
