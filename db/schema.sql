-- Story Bytes prototype schema
-- Requires: PostgreSQL 15+, pgcrypto (for gen_random_uuid), pgvector (for embeddings)

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- Core entities
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS stories (
    story_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id     TEXT UNIQUE,
    title           TEXT NOT NULL,
    authors         TEXT[] DEFAULT '{}',
    language        TEXT,
    content_type    TEXT NOT NULL DEFAULT 'novel'
                    CHECK (content_type IN ('novel', 'comic', 'manga')),
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
    asset_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id            UUID REFERENCES stories(story_id) ON DELETE CASCADE,
    href                TEXT UNIQUE,
    media_type          TEXT,
    sha256              BYTEA,
    binary_data         BYTEA,                     -- optional if using direct DB storage
    storage_url         TEXT,                      -- set when binary stored externally
    width               INT,
    height              INT,
    ocr_text            TEXT,
    visual_description  TEXT,                      -- Phase 3: Gemini vision description
    visual_tags         JSONB DEFAULT '{}',        -- Phase 3: {"characters_visual": [], "setting": "", ...}
    enriched_metadata   JSONB DEFAULT '{}',        -- Phase 3: post-ingestion enrichment with full story context
    metadata            JSONB DEFAULT '{}',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
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
    vector          vector(768),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS block_embeddings (
    block_id        UUID REFERENCES chapter_blocks(block_id) ON DELETE CASCADE,
    model           TEXT NOT NULL,
    dimensions      INT NOT NULL,
    vector          vector(768),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (block_id, model)
);

CREATE INDEX IF NOT EXISTS idx_block_embeddings_model
    ON block_embeddings (model);

CREATE INDEX IF NOT EXISTS idx_block_embeddings_vector
    ON block_embeddings USING hnsw (vector vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_chapter_embeddings_vector
    ON chapter_embeddings USING hnsw (vector vector_cosine_ops);

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
    vector          vector(768),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (knowledge_id, model)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_story
    ON external_knowledge (story_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_vector
    ON knowledge_embeddings USING hnsw (vector vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Asset Embeddings (Phase 3: Image Intelligence)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS asset_embeddings (
    asset_id        UUID REFERENCES assets(asset_id) ON DELETE CASCADE,
    model           TEXT NOT NULL,
    dimensions      INT NOT NULL,
    vector          vector(768),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (asset_id, model)
);

CREATE INDEX IF NOT EXISTS idx_asset_embeddings_vector
    ON asset_embeddings USING hnsw (vector vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Chapter Summaries (Phase 4: Cached summarization)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chapter_summaries (
    summary_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id        UUID NOT NULL REFERENCES stories(story_id) ON DELETE CASCADE,
    up_to_chapter   INT NOT NULL,
    summary_text    TEXT NOT NULL,
    model           TEXT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (story_id, up_to_chapter, model)
);

-- ---------------------------------------------------------------------------
-- Full-text search support (Phase 4: Hybrid search)
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_blocks_text_fts
    ON chapter_blocks USING gin (to_tsvector('english', COALESCE(text_content, '')));

-- ---------------------------------------------------------------------------
-- Reading Progress (Phase 5)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reading_progress (
    user_id             UUID NOT NULL,
    story_id            UUID NOT NULL REFERENCES stories(story_id) ON DELETE CASCADE,
    last_chapter_order  INT NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, story_id)
);


