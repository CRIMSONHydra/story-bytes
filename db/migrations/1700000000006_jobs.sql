-- Up Migration
-- M5: async ingestion via pg-boss. pg-boss manages its own `pgboss.*` schema for the actual queue;
-- these two app-level tables give us a stable surface to poll/list without reaching into pgboss:
--   ingest_jobs  — one row per ingest request (status + resulting story_id + source hash for dedup)
--   job_events   — the append-only progress/stage stream a client polls while a job runs

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

-- Dedup lookup: find a prior in-flight/successful ingest of the same file bytes.
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

-- Down Migration
DROP TABLE IF EXISTS job_events;
DROP TABLE IF EXISTS ingest_jobs;
