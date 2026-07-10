-- Up Migration
-- Migrate all embedding stores from gemini-embedding-001 (768-dim, task_type) to
-- gemini-embedding-2 (1536-dim MRL, in-prompt task instruction, auto-normalized). 1536 is a
-- recommended MRL size and stays under pgvector's 2000-dim HNSW ceiling.
--
-- The *_embeddings tables hold derived vectors only (source text lives in chapter_blocks / assets /
-- external_knowledge), so this drops every stored vector and re-embeds from source via
-- `ingestion/backfill_embeddings.py` / `load_to_db.py`. pgvector cannot change a column's
-- dimensionality while an HNSW index exists or while rows are present, so the order is fixed:
-- drop indexes -> delete rows -> ALTER TYPE -> recreate indexes.

DROP INDEX IF EXISTS idx_block_embeddings_vector;
DROP INDEX IF EXISTS idx_chapter_embeddings_vector;
DROP INDEX IF EXISTS idx_asset_embeddings_vector;
DROP INDEX IF EXISTS idx_knowledge_embeddings_vector;

DELETE FROM block_embeddings;
DELETE FROM chapter_embeddings;
DELETE FROM asset_embeddings;
DELETE FROM knowledge_embeddings;

ALTER TABLE block_embeddings     ALTER COLUMN vector TYPE vector(1536);
ALTER TABLE chapter_embeddings   ALTER COLUMN vector TYPE vector(1536);
ALTER TABLE asset_embeddings     ALTER COLUMN vector TYPE vector(1536);
ALTER TABLE knowledge_embeddings ALTER COLUMN vector TYPE vector(1536);

CREATE INDEX IF NOT EXISTS idx_block_embeddings_vector
    ON block_embeddings USING hnsw (vector vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_chapter_embeddings_vector
    ON chapter_embeddings USING hnsw (vector vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_asset_embeddings_vector
    ON asset_embeddings USING hnsw (vector vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_vector
    ON knowledge_embeddings USING hnsw (vector vector_cosine_ops);

-- Down Migration
-- Reverse to 768-dim. Vectors are again dropped (the 1536-dim data cannot be down-cast); re-run the
-- legacy embedding pipeline to repopulate.
DROP INDEX IF EXISTS idx_block_embeddings_vector;
DROP INDEX IF EXISTS idx_chapter_embeddings_vector;
DROP INDEX IF EXISTS idx_asset_embeddings_vector;
DROP INDEX IF EXISTS idx_knowledge_embeddings_vector;

DELETE FROM block_embeddings;
DELETE FROM chapter_embeddings;
DELETE FROM asset_embeddings;
DELETE FROM knowledge_embeddings;

ALTER TABLE block_embeddings     ALTER COLUMN vector TYPE vector(768);
ALTER TABLE chapter_embeddings   ALTER COLUMN vector TYPE vector(768);
ALTER TABLE asset_embeddings     ALTER COLUMN vector TYPE vector(768);
ALTER TABLE knowledge_embeddings ALTER COLUMN vector TYPE vector(768);

CREATE INDEX IF NOT EXISTS idx_block_embeddings_vector
    ON block_embeddings USING hnsw (vector vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_chapter_embeddings_vector
    ON chapter_embeddings USING hnsw (vector vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_asset_embeddings_vector
    ON asset_embeddings USING hnsw (vector vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_vector
    ON knowledge_embeddings USING hnsw (vector vector_cosine_ops);
