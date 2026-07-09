-- Migration 004: Full-text Search + Chapter Summaries (Phase 4)
-- Adds GIN index for hybrid keyword+semantic search and summary cache table.

BEGIN;

-- GIN index for full-text search on chapter blocks
CREATE INDEX IF NOT EXISTS idx_blocks_text_fts
    ON chapter_blocks USING gin (to_tsvector('english', COALESCE(text_content, '')));

-- Cached chapter summaries
CREATE TABLE IF NOT EXISTS chapter_summaries (
    summary_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id        UUID NOT NULL REFERENCES stories(story_id) ON DELETE CASCADE,
    up_to_chapter   INT NOT NULL,
    summary_text    TEXT NOT NULL,
    model           TEXT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (story_id, up_to_chapter, model)
);

COMMIT;
