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
    series_title    TEXT,
    epub_path       TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stories_series_title ON stories(series_title);

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
    story_id            UUID NOT NULL REFERENCES stories(story_id) ON DELETE CASCADE,
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
    vector          vector(1536),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS block_embeddings (
    block_id        UUID REFERENCES chapter_blocks(block_id) ON DELETE CASCADE,
    model           TEXT NOT NULL,
    dimensions      INT NOT NULL,
    vector          vector(1536),
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
-- Users / profiles (M4). Mirrors migration 1700000000005.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
    user_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name  TEXT NOT NULL,
    avatar_color  TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO users (user_id, display_name, avatar_color)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Reader', '#6c8cff')
ON CONFLICT (user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Annotations (user notes, QA spans, spoiler tags, etc.)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS annotations (
    annotation_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id        UUID NOT NULL REFERENCES stories(story_id) ON DELETE CASCADE,
    chapter_id      UUID REFERENCES chapters(chapter_id) ON DELETE CASCADE,
    block_id        UUID REFERENCES chapter_blocks(block_id) ON DELETE SET NULL,
    user_id         UUID REFERENCES users(user_id) ON DELETE SET NULL,
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
    story_id        UUID NOT NULL REFERENCES stories(story_id) ON DELETE CASCADE,
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
    vector          vector(1536),
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
    vector          vector(1536),
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
    user_id             UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    story_id            UUID NOT NULL REFERENCES stories(story_id) ON DELETE CASCADE,
    last_chapter_order  INT NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, story_id)
);

-- NOTE: This file is the first-boot bootstrap + drift reference. Since the improvement-plan work,
-- all schema changes go through db/migrations/ (node-pg-migrate, timestamp-named). The sections below
-- mirror migrations 1700000000001 (spoiler hardening) and 1700000000002 (knowledge graph) so a fresh
-- database created from this file matches a migrated one. See docs/IMPROVEMENT_PLAN.md §2.1.

-- ---------------------------------------------------------------------------
-- Spoiler hardening (migration 1700000000001)
-- ---------------------------------------------------------------------------

ALTER TABLE stories ADD COLUMN IF NOT EXISTS volume_number INT;
ALTER TABLE assets  ADD COLUMN IF NOT EXISTS first_chapter_order INT;
ALTER TABLE assets  ADD COLUMN IF NOT EXISTS is_cover BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_chapters_story_order ON chapters (story_id, chapter_order);

-- ---------------------------------------------------------------------------
-- Knowledge graph + foreshadowing (migration 1700000000002)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS kg_entities (
    entity_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id             UUID NOT NULL REFERENCES stories(story_id) ON DELETE CASCADE,
    entity_type          TEXT NOT NULL CHECK (entity_type IN ('character','faction','location','item','concept')),
    canonical_name       TEXT NOT NULL,
    description          TEXT,
    first_chapter_order  INT  NOT NULL,
    metadata             JSONB NOT NULL DEFAULT '{}',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (story_id, entity_type, canonical_name)
);
CREATE INDEX IF NOT EXISTS idx_kg_entities_story_chapter ON kg_entities (story_id, first_chapter_order);

CREATE TABLE IF NOT EXISTS kg_entity_aliases (
    alias_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id            UUID NOT NULL REFERENCES kg_entities(entity_id) ON DELETE CASCADE,
    alias                TEXT NOT NULL,
    first_chapter_order  INT  NOT NULL,
    UNIQUE (entity_id, alias)
);
CREATE INDEX IF NOT EXISTS idx_kg_aliases_alias ON kg_entity_aliases (LOWER(alias));

CREATE TABLE IF NOT EXISTS kg_entity_states (
    state_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id      UUID NOT NULL REFERENCES kg_entities(entity_id) ON DELETE CASCADE,
    chapter_order  INT  NOT NULL,
    description    TEXT NOT NULL,
    status         TEXT,
    UNIQUE (entity_id, chapter_order)
);

CREATE TABLE IF NOT EXISTS kg_relationships (
    rel_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id            UUID NOT NULL REFERENCES stories(story_id) ON DELETE CASCADE,
    source_entity_id    UUID NOT NULL REFERENCES kg_entities(entity_id) ON DELETE CASCADE,
    target_entity_id    UUID NOT NULL REFERENCES kg_entities(entity_id) ON DELETE CASCADE,
    rel_type            TEXT NOT NULL,
    description         TEXT,
    valid_from_chapter  INT  NOT NULL,
    valid_to_chapter    INT,
    metadata            JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (source_entity_id <> target_entity_id),
    CHECK (valid_to_chapter IS NULL OR valid_to_chapter >= valid_from_chapter)
);
CREATE INDEX IF NOT EXISTS idx_kg_rels_source ON kg_relationships (source_entity_id, valid_from_chapter);
CREATE INDEX IF NOT EXISTS idx_kg_rels_target ON kg_relationships (target_entity_id, valid_from_chapter);
CREATE INDEX IF NOT EXISTS idx_kg_rels_story  ON kg_relationships (story_id, valid_from_chapter);

CREATE TABLE IF NOT EXISTS kg_events (
    event_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id       UUID NOT NULL REFERENCES stories(story_id) ON DELETE CASCADE,
    chapter_order  INT  NOT NULL,
    title          TEXT NOT NULL,
    description    TEXT,
    event_type     TEXT,
    metadata       JSONB NOT NULL DEFAULT '{}',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kg_events_story_chapter ON kg_events (story_id, chapter_order);

CREATE TABLE IF NOT EXISTS kg_event_participants (
    event_id   UUID NOT NULL REFERENCES kg_events(event_id) ON DELETE CASCADE,
    entity_id  UUID NOT NULL REFERENCES kg_entities(entity_id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'participant',
    PRIMARY KEY (event_id, entity_id, role)
);

CREATE TABLE IF NOT EXISTS kg_plot_threads (
    thread_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id             UUID NOT NULL REFERENCES stories(story_id) ON DELETE CASCADE,
    name                 TEXT NOT NULL,
    description          TEXT,
    first_chapter_order  INT NOT NULL,
    UNIQUE (story_id, name)
);

CREATE TABLE IF NOT EXISTS kg_thread_beats (
    beat_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id      UUID NOT NULL REFERENCES kg_plot_threads(thread_id) ON DELETE CASCADE,
    chapter_order  INT  NOT NULL,
    beat_kind      TEXT NOT NULL CHECK (beat_kind IN ('setup','development','foreshadowing','payoff','resolution')),
    description    TEXT NOT NULL,
    block_id       UUID REFERENCES chapter_blocks(block_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_kg_beats_thread_chapter ON kg_thread_beats (thread_id, chapter_order);

CREATE TABLE IF NOT EXISTS kg_foreshadow_links (
    link_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id             UUID NOT NULL REFERENCES stories(story_id) ON DELETE CASCADE,
    thread_id            UUID REFERENCES kg_plot_threads(thread_id) ON DELETE SET NULL,
    setup_chapter_order  INT  NOT NULL,
    payoff_chapter_order INT  NOT NULL,
    setup_block_id       UUID REFERENCES chapter_blocks(block_id) ON DELETE SET NULL,
    setup_summary        TEXT NOT NULL,
    emphasis_hint        TEXT NOT NULL,
    payoff_summary       TEXT NOT NULL,
    significance         TEXT NOT NULL DEFAULT 'notable' CHECK (significance IN ('minor','notable','major')),
    confidence           REAL,
    extraction_model     TEXT NOT NULL,
    guard_status         TEXT NOT NULL DEFAULT 'clean' CHECK (guard_status IN ('clean','flagged','blocked')),
    prompt_version       INT NOT NULL DEFAULT 1,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (payoff_chapter_order > setup_chapter_order)
);
CREATE INDEX IF NOT EXISTS idx_foreshadow_window
    ON kg_foreshadow_links (story_id, setup_chapter_order, payoff_chapter_order);

CREATE TABLE IF NOT EXISTS kg_evidence (
    evidence_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_type   TEXT NOT NULL CHECK (subject_type IN ('entity','relationship','event','state','beat')),
    subject_id     UUID NOT NULL,
    story_id       UUID NOT NULL REFERENCES stories(story_id) ON DELETE CASCADE,
    chapter_order  INT  NOT NULL,
    block_id       UUID REFERENCES chapter_blocks(block_id) ON DELETE SET NULL,
    quote          TEXT
);
CREATE INDEX IF NOT EXISTS idx_kg_evidence_subject ON kg_evidence (subject_type, subject_id);

CREATE TABLE IF NOT EXISTS kg_entity_links (
    entity_a    UUID NOT NULL REFERENCES kg_entities(entity_id) ON DELETE CASCADE,
    entity_b    UUID NOT NULL REFERENCES kg_entities(entity_id) ON DELETE CASCADE,
    link_type   TEXT NOT NULL DEFAULT 'same_as' CHECK (link_type IN ('same_as')),
    confidence  REAL,
    PRIMARY KEY (entity_a, entity_b),
    CHECK (entity_a < entity_b)
);

CREATE TABLE IF NOT EXISTS kg_extraction_runs (
    run_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id        UUID NOT NULL REFERENCES stories(story_id) ON DELETE CASCADE,
    chapter_order   INT  NOT NULL,
    phase           TEXT NOT NULL DEFAULT 'graph' CHECK (phase IN ('graph','foreshadow')),
    model           TEXT NOT NULL,
    prompt_version  INT  NOT NULL DEFAULT 1,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed')),
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at     TIMESTAMPTZ,
    UNIQUE (story_id, chapter_order, phase, prompt_version)
);



-- ---------------------------------------------------------------------------
-- RAG traces (M9)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rag_traces (
    trace_id             UUID PRIMARY KEY,
    story_id             UUID REFERENCES stories(story_id) ON DELETE SET NULL,
    mode                 TEXT,
    boundary_chapter     INT,
    query                TEXT NOT NULL,
    answer               TEXT,
    confidence           TEXT,
    source_count         INT,
    insufficient_context BOOLEAN,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rag_traces_created ON rag_traces (created_at);

-- ---------------------------------------------------------------------------
-- Async jobs (migration 1700000000006). pg-boss owns the pgboss.* queue schema;
-- these mirror the app-level polling/dedup surface.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ingest_jobs (
    job_id          TEXT PRIMARY KEY,
    source_sha256   TEXT,
    filename        TEXT,
    series_title    TEXT,
    status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'active', 'completed', 'failed', 'cancelled')),
    story_id        UUID REFERENCES stories(story_id) ON DELETE SET NULL,
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ingest_jobs_sha ON ingest_jobs (source_sha256);
CREATE INDEX IF NOT EXISTS idx_ingest_jobs_created ON ingest_jobs (created_at DESC);

CREATE TABLE IF NOT EXISTS job_events (
    event_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      TEXT NOT NULL,
    queue       TEXT,
    event       TEXT NOT NULL,
    stage       TEXT,
    message     TEXT,
    payload     JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events (job_id, created_at);

-- ---------------------------------------------------------------------------
-- LLM usage accounting (migration 1700000000007). Cost is computed at read time.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS llm_usage (
    usage_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    context       TEXT NOT NULL,
    model         TEXT NOT NULL,
    input_tokens  INT NOT NULL DEFAULT 0,
    output_tokens INT NOT NULL DEFAULT 0,
    story_id      UUID REFERENCES stories(story_id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_llm_usage_created ON llm_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_usage_model ON llm_usage (model);
