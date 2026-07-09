-- Up Migration
-- M14 (plan §2.2, §2.3, §2.14): the chapter-versioned knowledge graph — the single shared entity
-- foundation (kg_entities + kg_entity_aliases), the narrative graph, and the foreshadowing links that
-- power the spoiler-safe recap. Every node/alias/edge/fact carries the chapter at which it becomes known.

-- Nodes. Scoped per story (volume); cross-volume identity via kg_entity_links.
CREATE TABLE IF NOT EXISTS kg_entities (
  entity_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id             UUID NOT NULL REFERENCES stories(story_id) ON DELETE CASCADE,
  entity_type          TEXT NOT NULL CHECK (entity_type IN ('character','faction','location','item','concept')),
  canonical_name       TEXT NOT NULL,
  description          TEXT,                     -- spoiler-safe: as known at first appearance
  first_chapter_order  INT  NOT NULL,            -- spoiler key: hidden before this chapter
  metadata             JSONB NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (story_id, entity_type, canonical_name)
);
CREATE INDEX IF NOT EXISTS idx_kg_entities_story_chapter ON kg_entities (story_id, first_chapter_order);

-- Aliases are chapter-versioned facts ("the masked knight" = Aldric is itself a spoiler).
CREATE TABLE IF NOT EXISTS kg_entity_aliases (
  alias_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id            UUID NOT NULL REFERENCES kg_entities(entity_id) ON DELETE CASCADE,
  alias                TEXT NOT NULL,
  first_chapter_order  INT  NOT NULL,
  UNIQUE (entity_id, alias)
);
CREATE INDEX IF NOT EXISTS idx_kg_aliases_alias ON kg_entity_aliases (LOWER(alias));

-- Point-in-time entity facts; the visible state at chapter N is the row with MAX(chapter_order) <= N.
CREATE TABLE IF NOT EXISTS kg_entity_states (
  state_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id      UUID NOT NULL REFERENCES kg_entities(entity_id) ON DELETE CASCADE,
  chapter_order  INT  NOT NULL,
  description    TEXT NOT NULL,
  status         TEXT,
  UNIQUE (entity_id, chapter_order)
);

-- Temporal, directed edges. Ally->traitor = close old edge (valid_to), open new one.
CREATE TABLE IF NOT EXISTS kg_relationships (
  rel_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id            UUID NOT NULL REFERENCES stories(story_id) ON DELETE CASCADE,
  source_entity_id    UUID NOT NULL REFERENCES kg_entities(entity_id) ON DELETE CASCADE,
  target_entity_id    UUID NOT NULL REFERENCES kg_entities(entity_id) ON DELETE CASCADE,
  rel_type            TEXT NOT NULL,
  description         TEXT,
  valid_from_chapter  INT  NOT NULL,
  valid_to_chapter    INT,                       -- NULL = still true; the END itself is a spoiler
  metadata            JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source_entity_id <> target_entity_id),
  CHECK (valid_to_chapter IS NULL OR valid_to_chapter >= valid_from_chapter)
);
CREATE INDEX IF NOT EXISTS idx_kg_rels_source ON kg_relationships (source_entity_id, valid_from_chapter);
CREATE INDEX IF NOT EXISTS idx_kg_rels_target ON kg_relationships (target_entity_id, valid_from_chapter);
CREATE INDEX IF NOT EXISTS idx_kg_rels_story  ON kg_relationships (story_id, valid_from_chapter);

-- Events (things that happen at a chapter) + participants.
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

-- Plot threads + beats (substrate for foreshadowing).
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

-- Foreshadowing links (plan §2.14). A setup planted at setup_chapter_order pays off at
-- payoff_chapter_order. Emphasizable for a reader at N iff setup <= N < payoff.
-- setup_summary + emphasis_hint are reader-safe (pre-vetted). payoff_summary is server-side only
-- and MUST NEVER be selected for a live link (payoff > reader boundary).
CREATE TABLE IF NOT EXISTS kg_foreshadow_links (
  link_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id             UUID NOT NULL REFERENCES stories(story_id) ON DELETE CASCADE,
  thread_id            UUID REFERENCES kg_plot_threads(thread_id) ON DELETE SET NULL,
  setup_chapter_order  INT  NOT NULL,            -- reader-visible when <= N
  payoff_chapter_order INT  NOT NULL,            -- SPOILER: never emitted to a reader at N < this
  setup_block_id       UUID REFERENCES chapter_blocks(block_id) ON DELETE SET NULL,
  setup_summary        TEXT NOT NULL,            -- describes ONLY the setup, in already-read terms
  emphasis_hint        TEXT NOT NULL,            -- pre-vetted "why keep an eye on this" — NO payoff content
  payoff_summary       TEXT NOT NULL,            -- ACCESS-GATED; never selected when payoff > N
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

-- Provenance: quote + block anchor. block_id is SET NULL so the graph survives chapter re-ingest.
CREATE TABLE IF NOT EXISTS kg_evidence (
  evidence_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type   TEXT NOT NULL CHECK (subject_type IN ('entity','relationship','event','state','beat')),
  subject_id     UUID NOT NULL,                  -- polymorphic, app-enforced
  story_id       UUID NOT NULL REFERENCES stories(story_id) ON DELETE CASCADE,
  chapter_order  INT  NOT NULL,
  block_id       UUID REFERENCES chapter_blocks(block_id) ON DELETE SET NULL,
  quote          TEXT
);
CREATE INDEX IF NOT EXISTS idx_kg_evidence_subject ON kg_evidence (subject_type, subject_id);

-- Cross-volume identity (Rudeus in Vol 1 == Rudeus in Vol 4).
CREATE TABLE IF NOT EXISTS kg_entity_links (
  entity_a    UUID NOT NULL REFERENCES kg_entities(entity_id) ON DELETE CASCADE,
  entity_b    UUID NOT NULL REFERENCES kg_entities(entity_id) ON DELETE CASCADE,
  link_type   TEXT NOT NULL DEFAULT 'same_as' CHECK (link_type IN ('same_as')),
  confidence  REAL,
  PRIMARY KEY (entity_a, entity_b),
  CHECK (entity_a < entity_b)
);

-- Extraction bookkeeping: idempotency, resume, incremental updates.
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

-- Down Migration
DROP TABLE IF EXISTS kg_extraction_runs;
DROP TABLE IF EXISTS kg_entity_links;
DROP TABLE IF EXISTS kg_evidence;
DROP TABLE IF EXISTS kg_foreshadow_links;
DROP TABLE IF EXISTS kg_thread_beats;
DROP TABLE IF EXISTS kg_plot_threads;
DROP TABLE IF EXISTS kg_event_participants;
DROP TABLE IF EXISTS kg_events;
DROP TABLE IF EXISTS kg_relationships;
DROP TABLE IF EXISTS kg_entity_states;
DROP TABLE IF EXISTS kg_entity_aliases;
DROP TABLE IF EXISTS kg_entities;
