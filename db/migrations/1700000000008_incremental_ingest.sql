-- Up Migration
-- M11: incremental ingestion. `content_hash` lets a re-ingest skip unchanged chapters (no re-embed →
-- $0), `is_front_matter` promotes the API's front-matter filtering into stored data, and the assets
-- (story_id, href) unique key makes image upserts idempotent across re-ingests.

ALTER TABLE chapters ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS is_front_matter BOOLEAN NOT NULL DEFAULT FALSE;

-- Idempotent image upsert target. (Seed data has no (story_id, href) duplicates; a unique index is
-- safe here and gives ON CONFLICT a target.)
CREATE UNIQUE INDEX IF NOT EXISTS uq_assets_story_href ON assets (story_id, href);

-- Down Migration
DROP INDEX IF EXISTS uq_assets_story_href;
ALTER TABLE chapters DROP COLUMN IF EXISTS is_front_matter;
ALTER TABLE chapters DROP COLUMN IF EXISTS content_hash;
