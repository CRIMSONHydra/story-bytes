-- Up Migration
-- M6: LLM usage accounting. Store raw token counts per call (fire-and-forget); dollar cost is
-- computed at READ time from a pricing table in code, so re-pricing (or a model swap) never requires
-- a backfill. `context` labels the call site (chat / summary / embedding / graph_extract / ...).

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

-- Down Migration
DROP TABLE IF EXISTS llm_usage;
