-- Migration 003: Image Intelligence Pipeline (Phase 3)
-- Adds visual description columns to assets and creates asset_embeddings table.

BEGIN;

-- Add image analysis columns to assets
ALTER TABLE assets ADD COLUMN IF NOT EXISTS visual_description TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS visual_tags JSONB DEFAULT '{}';
ALTER TABLE assets ADD COLUMN IF NOT EXISTS enriched_metadata JSONB DEFAULT '{}';

-- Asset embeddings for image-based vector search
CREATE TABLE IF NOT EXISTS asset_embeddings (
    asset_id    UUID REFERENCES assets(asset_id) ON DELETE CASCADE,
    model       TEXT NOT NULL,
    dimensions  INT NOT NULL,
    vector      vector(768),
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (asset_id, model)
);

CREATE INDEX IF NOT EXISTS idx_asset_embeddings_vector
    ON asset_embeddings USING hnsw (vector vector_cosine_ops);

COMMIT;
