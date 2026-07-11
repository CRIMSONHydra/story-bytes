-- Up Migration
-- M16: image entities/canon. `entity_appearance_facts` are chapter-versioned visual traits (hair,
-- eyes, attire…) mined from the graph pass; a character's "canon" at chapter N is the set of facts
-- revealed at or before N (later facts supersede earlier ones of the same type). `generated_images`
-- caches one rendered image per (entity, canon_hash) so re-rendering an unchanged canon is free.

CREATE TABLE IF NOT EXISTS entity_appearance_facts (
    fact_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id      UUID NOT NULL REFERENCES kg_entities(entity_id) ON DELETE CASCADE,
    chapter_order  INT NOT NULL,                 -- chapter this trait is first established (boundary key)
    fact_type      TEXT NOT NULL,                -- e.g. hair, eyes, build, attire, age, distinguishing
    value          TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (entity_id, chapter_order, fact_type)
);
CREATE INDEX IF NOT EXISTS idx_appearance_entity_chapter
    ON entity_appearance_facts (entity_id, chapter_order);

CREATE TABLE IF NOT EXISTS generated_images (
    image_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id    UUID NOT NULL REFERENCES kg_entities(entity_id) ON DELETE CASCADE,
    canon_hash   TEXT NOT NULL,                  -- hash of the ≤boundary appearance slice used
    file_path    TEXT,                           -- served from disk when status='ready'
    prompt       TEXT NOT NULL,                  -- exact prompt (spoiler-safety golden tests assert on it)
    model        TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'ready'
                 CHECK (status IN ('ready', 'blocked', 'failed')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (entity_id, canon_hash)
);
CREATE INDEX IF NOT EXISTS idx_generated_images_entity ON generated_images (entity_id);

-- Down Migration
DROP TABLE IF EXISTS generated_images;
DROP TABLE IF EXISTS entity_appearance_facts;
