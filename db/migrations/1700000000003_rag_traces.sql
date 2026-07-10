-- Up Migration
-- M9: RAG trace log for debugging + the eval retrieval suite. Written fire-and-forget per chat turn.
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

-- Down Migration
DROP TABLE IF EXISTS rag_traces;
