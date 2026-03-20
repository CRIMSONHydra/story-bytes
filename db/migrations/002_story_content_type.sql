-- Migration 002: Add content_type to stories table
-- Supports: 'novel' (default), 'comic', 'manga'

BEGIN;

ALTER TABLE stories
    ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'novel'
    CHECK (content_type IN ('novel', 'comic', 'manga'));

COMMIT;
