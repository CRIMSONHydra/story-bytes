-- Story Bytes prototype schema
-- Requires: PostgreSQL 15+, pgcrypto (for gen_random_uuid), pgvector (for embeddings)

CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- Core entities
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS stories (
    story_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id     TEXT UNIQUE,
    title           TEXT NOT NULL,
    authors         TEXT[] DEFAULT '{}',
    language        TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chapters (
    chapter_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id        UUID NOT NULL REFERENCES stories(story_id) ON DELETE CASCADE,
    chapter_order   INT NOT NULL,
    title           TEXT,
    aggregated_text TEXT,
    raw_html        JSONB DEFAULT '[]',
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chapters_story_order
    ON chapters (story_id, chapter_order);

-- ---------------------------------------------------------------------------
-- Chapter structure and provenance
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chapter_blocks (
    block_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chapter_id      UUID NOT NULL REFERENCES chapters(chapter_id) ON DELETE CASCADE,
    block_index     INT NOT NULL,
    block_type      TEXT NOT NULL CHECK (block_type IN ('text', 'image')),
    text_content    TEXT,
    image_src       TEXT,
    image_alt       TEXT,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blocks_chapter_order
    ON chapter_blocks (chapter_id, block_index);

CREATE TABLE IF NOT EXISTS chapter_sources (
    source_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chapter_id      UUID NOT NULL REFERENCES chapters(chapter_id) ON DELETE CASCADE,
    spine_id        TEXT,
    href            TEXT,
    position        INT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sources_chapter_position
    ON chapter_sources (chapter_id, position);

-- ---------------------------------------------------------------------------
-- Assets (images or other referenced media)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS assets (
    asset_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id        UUID REFERENCES stories(story_id) ON DELETE CASCADE,
    href            TEXT UNIQUE,
    media_type      TEXT,
    sha256          BYTEA,
    binary_data     BYTEA,                     -- optional if using direct DB storage
    storage_url     TEXT,                      -- set when binary stored externally
    width           INT,
    height          INT,
    ocr_text        TEXT,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assets_story
    ON assets (story_id);

-- ---------------------------------------------------------------------------
-- Embeddings (chapter-level and block-level)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chapter_embeddings (
    chapter_id      UUID PRIMARY KEY REFERENCES chapters(chapter_id) ON DELETE CASCADE,
    model           TEXT NOT NULL,
    dimensions      INT NOT NULL,
    vector          FLOAT8[],
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS block_embeddings (
    block_id        UUID REFERENCES chapter_blocks(block_id) ON DELETE CASCADE,
    model           TEXT NOT NULL,
    dimensions      INT NOT NULL,
    vector          FLOAT8[],
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (block_id, model)
);

CREATE INDEX IF NOT EXISTS idx_block_embeddings_model
    ON block_embeddings (model);

-- ---------------------------------------------------------------------------
-- Annotations (user notes, QA spans, spoiler tags, etc.)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS annotations (
    annotation_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id        UUID NOT NULL REFERENCES stories(story_id) ON DELETE CASCADE,
    chapter_id      UUID REFERENCES chapters(chapter_id) ON DELETE CASCADE,
    block_id        UUID REFERENCES chapter_blocks(block_id) ON DELETE SET NULL,
    user_id         UUID,
    tag             TEXT,
    note            TEXT,
    start_char      INT,
    end_char        INT,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_annotations_story
    ON annotations (story_id);

-- ---------------------------------------------------------------------------
-- Utility views (optional)
-- ---------------------------------------------------------------------------



-- ---------------------------------------------------------------------------
-- External Knowledge (Web Search Results)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS external_knowledge (
    knowledge_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id        UUID REFERENCES stories(story_id) ON DELETE CASCADE,
    content         TEXT NOT NULL,
    source_url      TEXT,
    knowledge_type  TEXT CHECK (knowledge_type IN ('fact', 'theory', 'speculation')),
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_embeddings (
    knowledge_id    UUID REFERENCES external_knowledge(knowledge_id) ON DELETE CASCADE,
    model           TEXT NOT NULL,
    dimensions      INT NOT NULL,
    vector          FLOAT8[],
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (knowledge_id, model)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_story
    ON external_knowledge (story_id);



