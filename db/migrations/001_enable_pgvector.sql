-- Migration 001: Enable pgvector and migrate embedding columns
-- This migrates from FLOAT8[] arrays to native pgvector vector(768) type
-- and adds HNSW indexes for fast similarity search.
--
-- IMPORTANT: This migration drops and re-creates embedding tables.
-- Existing embeddings (generated with all-MiniLM-L6-v2, 384-dim) are incompatible
-- with the new text-embedding-004 (768-dim) model, so they must be regenerated.
-- Re-run ingestion after applying this migration.

BEGIN;

-- 1. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Drop old embedding data (incompatible dimensions/model)
TRUNCATE block_embeddings, chapter_embeddings, knowledge_embeddings;

-- 3. Migrate column types from FLOAT8[] to vector(768)
ALTER TABLE chapter_embeddings
    ALTER COLUMN vector TYPE vector(768) USING NULL;

ALTER TABLE block_embeddings
    ALTER COLUMN vector TYPE vector(768) USING NULL;

ALTER TABLE knowledge_embeddings
    ALTER COLUMN vector TYPE vector(768) USING NULL;

-- 4. Add HNSW indexes for cosine similarity search
CREATE INDEX IF NOT EXISTS idx_block_embeddings_vector
    ON block_embeddings USING hnsw (vector vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_chapter_embeddings_vector
    ON chapter_embeddings USING hnsw (vector vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_vector
    ON knowledge_embeddings USING hnsw (vector vector_cosine_ops);

COMMIT;
