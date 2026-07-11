-- Up Migration
-- M18: external-knowledge (fan theories) subsystem v1. Reworks external_knowledge into a spoiler-safe
-- chunk table: `max_chapter_order` is the LATEST chapter a chunk may be shown at (NULL = default-deny,
-- never shown), `content_sha256` dedups re-pastes, `document_id` links chunks to their source doc.
-- `theory_submissions` tracks a paste through the async classify pipeline (M19). Legacy rows (written
-- by the removed raw-CSE path) are wiped — they have no spoiler scope and are unsafe to surface.

CREATE TABLE IF NOT EXISTS knowledge_documents (
    document_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id        UUID NOT NULL REFERENCES stories(story_id) ON DELETE CASCADE,
    title           TEXT,
    source_url      TEXT,
    content_sha256  TEXT,
    submitted_by    UUID REFERENCES users(user_id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_docs_story ON knowledge_documents (story_id);

-- Wipe legacy unclassified rows (no spoiler scope) before adding the safety columns.
DELETE FROM external_knowledge;

ALTER TABLE external_knowledge ADD COLUMN IF NOT EXISTS max_chapter_order INT;   -- NULL = default-deny
ALTER TABLE external_knowledge ADD COLUMN IF NOT EXISTS content_sha256 TEXT;
ALTER TABLE external_knowledge ADD COLUMN IF NOT EXISTS document_id UUID
    REFERENCES knowledge_documents(document_id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_external_knowledge_scope
    ON external_knowledge (story_id, max_chapter_order);
CREATE UNIQUE INDEX IF NOT EXISTS uq_external_knowledge_sha
    ON external_knowledge (story_id, content_sha256);

CREATE TABLE IF NOT EXISTS theory_submissions (
    submission_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id        UUID NOT NULL REFERENCES stories(story_id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(user_id) ON DELETE SET NULL,
    source_url      TEXT,
    status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'active', 'completed', 'failed')),
    document_id     UUID REFERENCES knowledge_documents(document_id) ON DELETE SET NULL,
    chunks_kept     INT,
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_theory_submissions_story ON theory_submissions (story_id, created_at DESC);

-- Down Migration
DROP TABLE IF EXISTS theory_submissions;
DROP INDEX IF EXISTS uq_external_knowledge_sha;
DROP INDEX IF EXISTS idx_external_knowledge_scope;
ALTER TABLE external_knowledge DROP COLUMN IF EXISTS document_id;
ALTER TABLE external_knowledge DROP COLUMN IF EXISTS content_sha256;
ALTER TABLE external_knowledge DROP COLUMN IF EXISTS max_chapter_order;
DROP TABLE IF EXISTS knowledge_documents;
