# Story Bytes — Improvement Plan & Execution Guide

> **Status:** Draft plan, not yet started. **Audience:** the implementing agent (Opus) and the maintainer.
> **How this was produced:** six subsystem maps + six pillar designs (each web-verified) + three adversarial
> critics (conflict/completeness/sequencing). The full detail lives in
> [`docs/improvement-plan/pillar-designs-and-maps.md`](improvement-plan/pillar-designs-and-maps.md) — this file is the
> reconciled, dependency-ordered execution plan that supersedes any conflicting instruction in the pillar designs.

---

## 0. How to use this document

1. Read §1 (vision) and §2 (the binding architecture decisions) first. **The pillar designs contradict each other in
   ~12 places; §2 is the tie-breaker and always wins.**
2. Execute milestones in §5 top-to-bottom. Each milestone is 1–4 focused PRs. Do not start a milestone before its
   listed prerequisites are merged.
3. For the depth of any milestone (schema DDL, prompts, API bodies), open the referenced pillar design section in
   `docs/improvement-plan/pillar-designs-and-maps.md`. Line ranges are given per pillar in §9.
4. Before each PR: obey the repo rules in `CLAUDE.md` — `pnpm --filter backend build` and
   `pnpm --filter frontend build` must be clean, `pnpm lint` zero-warnings, `pnpm test` (and `uv run pytest` for
   Python) written and passing, 1000-line file cap, vanilla CSS only, and update `CLAUDE.md`/`README.md`/`ROADMAP.md`.
5. Stop at the human-review checkpoints in §6 — several are destructive or outward-facing and are the maintainer's
   call, not yours.

---

## 1. Vision (what we are building toward)

Story Bytes lets a reader of an **obscure** novel/comic/manga — the kind with no wiki, no Google results, no active
subreddit — self-ingest chapters and then ask questions **without being spoiled past their current chapter**. The
headline job is *catching up*: "I've been away eight months, I'm on Volume 4 Chapter 12 — who is this character again,
and what was I doing?"

Five directions the maintainer asked for:

1. **Self-serve, incremental ingestion** (EPUB/CBZ/CBR today; add PDF/txt/paste) with visible progress.
2. **Spoiler-safe RAG** that answers from the reader's own text and never leaks — not from later chapters, not from
   the LLM's training data, not from the web.
3. **Internet theories** (Reddit/forums/wikis) as spoiler-tagged, attributed external knowledge.
4. **A chapter-versioned knowledge graph** (characters, aliases, relationships, events, plot threads) that itself
   respects the spoiler boundary.
5. **Image understanding + generation** — recreate characters/scenery/items as described *up to* the current chapter.

**Constraints (hard):** local-first, hobby-scale, single PostgreSQL 18 + pgvector (port 5433), Gemini only
(`gemini-flash-latest` / `-flash-lite-latest` / `gemini-embedding-2` / a Nano-Banana image model), pnpm monorepo, Express 5 +
TS backend, React 19 + Vite frontend, **vanilla CSS (no Tailwind)**, Python 3.12 ingestion via `uv`, Vitest backend
tests, zero lint warnings, 1000-line file cap. Current branch `feat/docker-compose-cicd` already adds docker-compose +
nginx + supervisor + CI + a seed dump. ROADMAP phases 1–5 are complete; phase 6 (graph/threads/annotations) is not
started.

---

## 2. Binding architecture decisions (the reconciliations — these override the pillar designs)

The six pillars were designed independently and collide. These decisions are final; every milestone assumes them.

### 2.1 One migration scheme — adopt `node-pg-migrate` with timestamp filenames, first

Five pillars each wrote `db/migrations/008_*.sql`; three wrote `009`. **Do not renumber** — switch to
`node-pg-migrate` (v8, `--migration-file-language sql`, keeps plain SQL) with `<epoch_ms>_<name>.sql` filenames. The
collision dissolves: there is no shared integer left to fight over, and the timestamp order *encodes the dependency
DAG*. Convert `001–007` into one idempotent `..._baseline.sql` (byte-equivalent to today's `schema.sql ∪ 001–007`),
run migrations at container boot before supervisord, and demote `db/schema.sql` to a first-boot bootstrap + drift
reference. **No pillar may write a `00X_*.sql` file.** *(Owner: Platform. This is the single most unblocking decision.)*

### 2.2 One entity foundation — `kg_entities` + `kg_entity_aliases` (Knowledge Graph owns it)

Three pillars invented an entity table (image-gen `story_entities`, spoiler-RAG `story_entities` with per-alias reveal,
KG `kg_entities` + `kg_entity_aliases`). **KG's is the strict superset** — a separate alias table with per-alias
`first_chapter_order` is exactly spoiler-RAG's need, and `kg_entity_states` is exactly image-gen's supersession need.
Decision:

- The shared registry is **`kg_entities` + `kg_entity_aliases`**, delivered as an *early "entity foundation"
  milestone* (M14), not buried in the full graph feature.
- `entity_type` CHECK = `character | faction | location | item | concept` (normalize spoiler-RAG's `place` →
  `location`); the reveal-gate column is `first_chapter_order` everywhere (drop image-gen's `first_mention_chapter_order`).
- Image-gen **drops** `story_entities`; its `entity_appearance_facts` (kept — visual traits ≠ narrative status) and
  `generated_images` FK to `kg_entities(entity_id)`.
- Spoiler-RAG **drops** `story_entities`/`alias_first_chapters` and `extract_entities.py`; its query-time alias
  expansion reads `kg_entity_aliases WHERE first_chapter_order <= boundary`.

### 2.3 One per-chapter extraction pass (Knowledge Graph hosts it)

Three pillars each run a per-chapter Gemini pass over every book (`extract_entities.py`, `extract_graph.py`,
`extract_canon.py`) — ~3× the cost and three merge/resume machineries, unacceptable at hobby scale for a large obscure
library. **Unify into `ingestion/graph/extract_graph.py`**: extend its structured-output schema with image-gen's
`appearance_facts[]` per entity. Spoiler-RAG's extractor is deleted (entities+aliases ⊂ graph output); image-gen's
comic `assets.enriched_metadata` mining stays as an add-on step inside the shared pipeline. If one maximal prompt hurts
quality, split into **two calls in one chapter loop** sharing entity IDs and one `kg_extraction_runs` ledger — still one
pipeline, one traversal. *(Owner: KG; image-gen contributes the appearance-facts branch.)*

### 2.4 One job queue — `pg-boss` (Platform owns it)

Ingestion hand-rolled `ingest_jobs`; Theories and Platform both chose pg-boss. **pg-boss wins** (single-DB, gives
retries/backoff/cron/graceful-drain for free; cron is needed by theory-refresh and enrichment sweeps). Platform owns
`backend/src/jobs/` and the `JobType` registry. Ingestion keeps only its *domain value* — the incremental loader, the
JSONL progress contract, cost estimation, chapter management — **running inside pg-boss handlers**. Ingestion's
`ingest_jobs` and `ingest_job_events` tables are dropped in favor of pg-boss + a small append-only `job_events`
progress table. Ship the in-process worker by default; keep a supervisor `[program:worker] ROLE=worker` flag as the
escape hatch for OCR-heavy load.

### 2.5 One external-knowledge subsystem (Internet-Theories owns it), scoped down for v1

Theories (full provenance model + ingest-time spoiler classification) and spoiler-RAG (`knowledge_screenings` +
content-embedding + dedup) both rewrite `external_knowledge`. **Theories' model is the backbone**; spoiler-RAG's
overlapping fixes (content-not-query embedding, `content_sha256` dedup, conditional search) fold into it. **Keep** from
spoiler-RAG: the *rewrite-to-scrubbed-paraphrase* refinement (Theories has no such path) as an optional theory-mode
layer, and the **answer-guard** (output-side groundedness backstop, kept regardless — see 2.9). **Scope down for v1**
(completeness critic): ship **user-paste → classify → spoiler-safe attributed retrieval** only. *Defer* the source
registry, daily refresh cron, Reddit OAuth fetcher, CSE discovery-enqueue, and Batch-API bulk classification until a
popular-story user actually needs them — for the obscure target audience they are dead weight.

### 2.6 One usage table — `llm_usage` (Platform owns it)

Ingestion's `gemini_usage` and Platform's `llm_usage` are the same concern. Platform's is the superset
(source enum, user/story/request attribution, `thoughts_tokens`, metadata, **no cost column** — compute dollars at read
time from `backend/src/services/pricing.ts`). Both Node and Python insert into it. Ingestion's *estimate-stage*
projection stays ingest-specific but reads the one `pricing.ts`.

### 2.7 One frontend API layer (Platform owns it, pulled early)

`frontend/src/api/client.ts` + `frontend/src/api/types.ts` were claimed by ingestion, spoiler-RAG, and Platform.
Platform's is the superset (parses the error envelope, attaches `x-user-id`, `AbortSignal`). Build once, **early**,
because ingestion's job UX and spoiler-RAG's chat UI both block on it. Consumers add their own types
(`IngestJob`, `AdminChapter`, …). Standardize the path as `frontend/src/api/types.ts`.

### 2.8 `rag.ts` / `db.ts` decomposition lands before anyone else edits them

Spoiler-RAG splits the 367-line `rag.ts` → `services/rag/*` and `db.ts` → `services/db/*` with re-export shims (zero
behavior change). KG, Theories, and image-gen all edit `rag.ts`. **The decomposition must merge first**, or three
pillars conflict-merge a monolith. After the split, KG's graph arm and Theories' external-knowledge rewrite land as
*modules under `services/rag/`*, not edits to one file.

### 2.9 Spoiler enforcement is server-side and uniform (`resolveSpoilerScope` as shared middleware)

Today only `/api/chat` would clamp the boundary to `reading_progress`. Every new boundary-bounded surface (graph,
entities, generated-images, knowledge, recap) must go through the **same** `resolveSpoilerScope` semantics:
explicit `upToChapter` → `reading_progress.last_chapter_order` → **0** (never "everything"; NULL = default-deny).
Promote it to shared middleware. "Peek ahead" is an explicit request flag, not the absence of a clamp. Additional
leak vectors to close (completeness critic):
- **Entity search/autocomplete** (`?q=`) must match only aliases with `first_chapter_order <= boundary` — otherwise
  typing a not-yet-revealed alias confirms an identity.
- **`latestImage`** on entity lists must be the latest image with `up_to_chapter <= boundary`, not globally latest.
- **Groundedness ⊨ spoiler-safety:** the answer-guard (a Flash-Lite groundedness check on the final answer vs the
  chapter-capped context) is the backstop against training-data leakage on popular series. Fail **closed** for recall.

### 2.10 Shared low-level schema fixes — build once

| Fix | Owner migration | Consumers |
|---|---|---|
| `stories.volume_number` + `getStoriesInSeries` ordering (`COALESCE(volume_number,9999), title`) | spoiler-RAG (early) | KG/Theories/image-gen cross-volume "prior volumes" scoping |
| `uq_chapters_story_order UNIQUE(story_id, chapter_order)` | ingestion (`IF NOT EXISTS`, spoiler-RAG assumes it) | spoiler math, incremental diff |
| assets: drop global `href` unique → `UNIQUE(story_id, href)`; add `first_chapter_order` + `is_cover` | one coordinated "assets hardening" migration (ingestion owns href, spoiler-RAG owns anchoring) | image-gen reference images, `findRelevantImages` |
| `is_front_matter` column + shared `FRONT_MATTER_PATTERNS` Python constant | ingestion | spoiler-RAG + all three extraction consumers (read the column/constant, stop re-implementing ILIKE) |
| `chapter_micro_summaries` (per-chapter) + populate the empty `chapter_embeddings` | spoiler-RAG | Theories classifier timeline **consumes these**, must NOT write into cumulative `chapter_summaries` |
| `backfill_embeddings.py` (one script) | spoiler-RAG | ingestion's `embed_backfill` job invokes it |
| Embedding in-prompt task instruction (`task: search result \| query:` / `text:`) + model-tag coexistence (`gemini-embedding-2/1536`) + `EMBEDDING_MODEL_TAG` cutover | spoiler-RAG | Theories embeds chunks via the shared helper |
| Block re-chunking (>1600 chars → ~1200 + 1-paragraph overlap) **in the loader** | spoiler-RAG | ingestion's diff `content_hash` computed *after* chunking |
| `services/archiveImages.ts` (Node, serve-time JSZip/CBZ byte resolution) | image-gen | `controllers/assets.ts`, image-gen `referenceImages.ts` |
| `enrich_images.py` reads `kg_entities` instead of the regex heuristic | KG | replaces spoiler-RAG's duplicate swap |

### 2.11 Job-progress transport: polling baseline, SSE optional

Platform's `GET /api/jobs/:jobId` 2s-polling is the baseline (build once, reads `job_events`). Ingestion may layer SSE
(`Last-Event-ID`, `X-Accel-Buffering: no`) on the *same* table for upload progress; `useJobProgress` degrades to
polling. Standardize the generic path `/api/jobs/:jobId` (+ a `job_type` filter); ingestion's `/api/ingest/jobs`
namespace collapses into it.

### 2.12 The "Recap" surface — the missing PRIMARY use case (new, small, high-leverage)

Every ingredient of "catch me up to chapter N" exists (cumulative summary, micro-summaries, entity latest-states, open
threads, cast portraits) but is scattered across four pages owned by four pillars, so **nobody built the recap
itself** — the #1 user story is an unowned side-effect. Add one thin composition layer:

- `GET /api/stories/:storyId/recap?upToChapter=N` — composes, all already chapter-bounded: **Story so far** (cumulative
  summary) · **Since you were last here** (last ~3 read chapters' micro-summaries) · **Where you left off** (last
  chapter + latest event) · **Main cast right now** (top entities by degree/recency + latest state + latest in-boundary
  portrait) · **Open questions** (unresolved threads) · **Threads worth keeping an eye on** (opt-in foreshadowing
  emphasis — see §2.14; off by default) · *(optional)* **What fans discussed** (top spoiler-safe theory chunks).
- `frontend/src/pages/RecapPage.tsx` — route `/story/:id/recap?upTo=N`, the primary **"Continue"** action from the
  story list and Reader header; the reader-facing hub linking to Cast/Graph/Theories.
- Story list gains "Last read: ch 34 · 8 months ago → **Recap & continue**". Sections render only when their data
  exists (graceful when graph/theories are absent — obscure-story cold-start still works from the reader's own text).

This composes existing pillar outputs; sequence it after RAG summaries (M10) and, for the cast section, after KG
states (M15) — but ship a text-only version (summary + micro-summaries + last event) as soon as M10 lands.

### 2.13 Scope discipline — cut/defer for hobby scale (completeness critic)

**Cut/defer in v1:** Theories registry+refresh+Reddit+Batch+CSE (paste-only, 2.5); graph embedding-linking +
LLM-adjudication + `kg_entity_embeddings` HNSW (lexical alias match + the LLM `known_entity` digest suffice for
few-hundred-node graphs — add the embedding arm only if wrong-merges appear); per-story eval golden sets (keep the
harness for the seed stories as a regression gate, don't require golden sets per ingested book); the listwise reranker
(feature-flag **off** by default, enable only if eval shows lift); comic reference-image consistency (ship text-prompt
novel generation first). **Kept and promoted (see 2.14):** plot-threads/beats are NOT deferred — they are the substrate
for the foreshadowing-aware recap, a first-class feature. **Known limitation to state, not silently accept:**
comics/manga are second-class everywhere (chunking/extraction assume prose; OCR quality caps recall) — call it out; do
not over-invest yet.

### 2.14 Foreshadowing-aware recap — identification needs the future, output must not leak it

This is the subtlest spoiler problem in the product and it **partially inverts the system's core invariant**. A good
recap should not just summarize what happened — it should gently flag *"this odd detail you read in chapter 6 is worth
keeping in mind"* when that detail is a planted seed that pays off later. But **to know a past detail is foreshadowing,
the model must know what it pays off — which is future, spoiler content.** The resolution is to split the two
operations that the naive "model only sees ≤ N" rule conflates:

- **Identification** (which past setup pays off later) happens **offline, at extraction time**, when we legitimately
  have the whole book — never in a reader-facing request.
- **Surfacing** happens **online**, through a structural gate that only ever emits the already-read *setup*, plus a
  pre-vetted spoiler-free hint. The payoff never enters a reader-facing prompt or response.

Because the hint is generated and leak-checked against the payoff **at extraction time** and then stored, the recap
path never needs the payoff in context at all — so the structural guarantee ("everything the generator sees at request
time is ≤ N and proven safe") is preserved exactly as everywhere else. Future knowledge influences only *selection*,
which happens offline.

#### 2.14.1 The emphasizability window

A foreshadow link has a `setup_chapter_order S` and a `payoff_chapter_order P` (with `P > S` always). For a reader at
boundary `N`:

| Condition | Meaning | Action |
|---|---|---|
| `S <= N < P` | planted, not yet paid off — **live foreshadowing** | **emphasizable** — surface setup + hint |
| `P <= N` | reader has already seen the payoff | not foreshadowing anymore; at most a safe "recall: this paid off in ch P" |
| `S > N` | reader hasn't even read the setup | invisible entirely |

The sweet spot `S <= N < P` is the only case that gets flagged. This window is computed with the same
`resolveSpoilerScope` boundary as everything else (2.9), so cross-volume prior-volume rules apply uniformly.

#### 2.14.2 Schema — `kg_foreshadow_links` (part of the KG migration, M14)

```sql
CREATE TABLE IF NOT EXISTS kg_foreshadow_links (
  link_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id             UUID NOT NULL REFERENCES stories(story_id) ON DELETE CASCADE,
  thread_id            UUID REFERENCES kg_plot_threads(thread_id) ON DELETE SET NULL,
  setup_chapter_order  INT  NOT NULL,          -- reader-visible when <= N
  payoff_chapter_order INT  NOT NULL,          -- SPOILER: never emitted to a reader at N < this
  setup_block_id       UUID REFERENCES chapter_blocks(block_id) ON DELETE SET NULL,  -- anchor to the exact read passage
  setup_summary        TEXT NOT NULL,          -- describes ONLY the setup, in already-read terms
  emphasis_hint        TEXT NOT NULL,          -- pre-vetted "why keep an eye on this" — contains NO payoff content
  payoff_summary       TEXT NOT NULL,          -- describes the payoff; ACCESS-GATED, never selected when payoff > N
  significance         TEXT NOT NULL CHECK (significance IN ('minor','notable','major')),  -- magnitude; itself gatekept
  confidence           REAL,
  extraction_model     TEXT NOT NULL,
  guard_status         TEXT NOT NULL DEFAULT 'clean'
                         CHECK (guard_status IN ('clean','flagged','blocked')),  -- extraction-time leak check verdict
  prompt_version       INT NOT NULL DEFAULT 1,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (payoff_chapter_order > setup_chapter_order)
);
CREATE INDEX IF NOT EXISTS idx_foreshadow_window
  ON kg_foreshadow_links (story_id, setup_chapter_order, payoff_chapter_order);
```

`setup_summary`, `emphasis_hint`, `guard_status` are the only columns a reader-facing query is ever allowed to select
for a *live* link; `payoff_summary` and (see 2.14.5) `significance` are server-side-only for live links.

#### 2.14.3 Offline extraction — the book-level linking pass

The per-chapter pass (2.3, KG `extract_graph.py`) already emits `kg_thread_beats` with
`beat_kind ∈ (setup, development, foreshadowing, payoff, resolution)`. Per-chapter extraction cannot reliably know at
chapter S that a seed pays off at chapter P > S, so add a **second, book-level linking pass**
(`ingestion/graph/link_foreshadow.py`) that runs after per-chapter extraction (and incrementally as later chapters
arrive):

1. Load all thread beats (and salient events) for the story, grouped by thread, ordered by chapter.
2. For each thread, ask Gemini to pair early `setup`/`foreshadowing` beats with the later `payoff`/`resolution` beat(s)
   they resolve, returning `{setup_chapter, payoff_chapter, setup_summary, payoff_summary, significance, confidence}`.
   This is where full-book knowledge is used — legitimately, offline.
3. **Generate `emphasis_hint` under a hard constraint:** a separate, tightly-scoped Gemini call given *only* the setup
   passage/summary (never the payoff): *"Explain in one sentence why this detail is worth remembering, using only what
   is stated in the setup. Do NOT reveal, name, hint at, or allude to anything that happens later. Frame it as 'worth
   keeping in mind,' never 'this leads to / sets up / foreshadows X.'"*
4. **Extraction-time leak guard (reuses the answer-guard machinery, 2.14.4):** verify `emphasis_hint` does NOT entail
   any fact in `payoff_summary`. `clean` → store as-is. `flagged` → one regeneration. `blocked` (still leaks) → discard
   the model hint and store a generic fallback (`"This detail recurs later — worth remembering."`) with
   `guard_status='blocked'`.
5. Idempotent + incremental: keyed by `(story_id, thread, setup_chapter, payoff_chapter, prompt_version)`; re-running
   after chapter 51 arrives discovers only new payoffs. Runs as a queued job step after graph extraction.

#### 2.14.4 Online surfacing (recap + foreshadowing chat mode)

- **Selection query:** `WHERE story_id = $s AND setup_chapter_order <= $N AND payoff_chapter_order > $N AND guard_status <> 'blocked'`
  (blocked links fall back to the generic hint, or are omitted — configurable), ordered by `significance DESC,
  setup_chapter_order DESC`, capped to top-K (see density cap, 2.14.5). **Only `setup_summary` + `emphasis_hint` are
  selected.** `payoff_summary` is never in the row set for a live link.
- **Recap:** a distinct, calibrated section — *"Threads worth keeping an eye on"* — showing the setup (with a "jump to
  chapter" anchor) + the vetted hint. Never the payoff.
- **Foreshadowing chat mode:** the existing mode gains these live links as an extra context block (setup + hint only),
  replacing the current "hope a foreshadowing-ish paragraph lands in the top-8" luck with grounded, pre-identified
  seeds. The mode's system prompt keeps the existing "never confirm future plot points" rule — now backstopped
  structurally because the payoff was never in context.
- **Answer-guard extension (M10b):** when the recap/chat generates prose *around* these links, the guard additionally
  checks the generated text against the `payoff_summary` of every surfaced link (server-side, not sent to the client)
  and **fails closed** — drops the emphasis rather than risk a leak. This catches the model reconstructing the payoff
  from the setup + its own training data on a popular series.

#### 2.14.5 The meta-spoiler problem (flagging itself is mild information) — controls

Flagging a detail as foreshadowing tells the reader "this pays off later" — information they wouldn't otherwise have.
That is the *intended* feature, but it must be calibrated so it stays "subtle emphasis" and never becomes a tell:

1. **Opt-in lens.** Foreshadowing emphasis is a toggle (`?foreshadow=1` / a "Highlight foreshadowing" switch), **off by
   default** in a plain recap. A reader who wants a pure spoiler-clean recap gets zero hints. (Mirrors the app's
   existing explicit `foreshadowing` chat mode — you ask for it.)
2. **Magnitude is gatekept.** `significance` itself leaks ("a MAJOR thing is set up here" tells the reader a big twist
   is coming). By default the surfaced phrasing is **uniform** ("worth keeping in mind") regardless of stored
   significance; significance is used only for **ranking/selection** offline. An optional "intensity" setting can let a
   reader opt into stronger signalling, but the default reveals neither magnitude nor kind.
3. **Density cap.** Flagging everything defeats subtlety and raises meta-spoiler load; cap to top-K per recap
   (default ~3–5) by `significance × recency`. Log when links are dropped (no silent truncation).
4. **No nature/target leak.** The hint may say a detail is worth remembering; it may **not** say *what kind* of payoff
   (death? betrayal? reveal?) or *which entity* it concerns beyond what the setup itself already names. This is exactly
   what the extraction-time constraint + guard enforce.

#### 2.14.6 Where it lands in the milestones

- **M14 (KG schema + extraction):** add `kg_foreshadow_links` to the migration; add the book-level
  `link_foreshadow.py` pass + the constrained `emphasis_hint` generation.
- **M10b (answer-guard):** add the payoff-leak-check mode used both at extraction time (2.14.3 step 4) and at
  recap/chat generation time (2.14.4).
- **M15 (KG service + RAG wiring):** `getForeshadowLinks(scope)` in `services/graph.ts`; wire live links into
  foreshadowing chat mode; graph-leak red-team extended to assert zero `payoff_chapter > N` content ever reaches
  context or response.
- **Recap (2.12):** the text Recap (M10) ships without foreshadowing; the **foreshadowing section is added when M15
  lands** (it needs thread beats + links). Endpoint gains `?foreshadow=1`; page gains the toggle.
- **Incremental:** appending a later chapter re-runs `link_foreshadow.py`; a link whose payoff becomes `<= N` for a
  reader simply drops out of the emphasizable window automatically (no data change needed — it's a query predicate).

#### 2.14.7 DONE criteria (add to M14/M15/M10b acceptance)

- Extraction: on the labeled seed story, `emphasis_hint` for every stored link passes the leak guard (no `payoff_summary`
  fact entailed); `guard_status` distribution reported.
- Surfacing red-team: for a reader at boundary N, **no response or prompt on any recap/foreshadowing path ever contains a
  fact whose only source is a chapter `> N`** — asserted structurally (payoff columns never selected for live links) and
  by an adversarial probe set ("what does the ominous locked door in ch 6 lead to?" at N=6 must emphasize the door
  without answering).
- Meta-spoiler: with the lens **off**, recap output is byte-identical to the non-foreshadowing recap; with it on,
  surfaced phrasing does not vary by stored `significance` at the default intensity.

#### 2.14.8 Eval-driven hardening (findings from the M7 harness, implemented)

The M7 spoiler-leak eval (`eval/`, §10-adjacent) exercises the live API with data-driven foreshadow probes (from
`kg_foreshadow_links`) + adversarial training-data probes, graded by an LLM judge. Building it surfaced four real
leak classes that unit tests and the runtime guard missed — all now fixed and re-verified at **0/13 leaks**:

1. **Foreshadowing chat volunteered a future chapter title** from training data and inferred the payoff. Fix: the
   foreshadowing system prompt now forbids naming any chapter/title/event past the reader, forbids saying what a setup
   "leads to" (flag it, don't resolve it), and forbids training-data use.
2. **Theory mode fabricated "wiki/Reddit" citations** and stated later-series facts when no real sources existed
   (the obscure-story cold-start case). Fix: theory prompt forbids inventing/attributing absent sources and
   training-data plot; when EXTERNAL KNOWLEDGE is empty it says so.
3. **Theory mode injected raw, unclassified Google-CSE snippets** into the prompt — the plan's own #1 leak vector
   (§3.6). Interim fix applied now: CSE-into-prompt path removed and the junk `insertExternalKnowledge` write-path
   deleted (it was storing spoilers as "knowledge"). The real fix remains the Theories pillar (M18) — spoiler-classified
   external content. Theory mode is spoiler-safe-but-thin until then.
4. **A weak adjacent-chapter foreshadow link telegraphed its payoff.** Fix: `MIN_FORESHADOW_GAP = 2` (kept in sync in
   `backend/src/services/graph.ts` and `ingestion/graph/link_foreshadow.py`) — genuine foreshadowing must span
   distance; adjacent "links" are plot progression, not foreshadowing.

**Residual risk (documented, not hidden):** the foreshadowing *chat* surface is free-generation and shows occasional
temp-0 variance on borderline inferences; the **recap** foreshadowing surface (pre-vetted setup + hint, no generation)
is structurally 0-leak across every run and is the recommended path. The eval harness exits non-zero on any leak, so it
is usable as a CI gate (nightly, per §3.6).

---

## 3. What's broken today (verified first-hand, must be fixed early)

- **Ingestion enrichment is silently dead for every web upload.** `ingestion/load_to_db.py` only calls
  `logging.info(...)` (stderr) and **never prints the story_id to stdout**, yet `backend/src/controllers/admin.ts`
  scrapes it with `/Story\s+([0-9a-f-]{36})/i`. The regex never matches → Pass-2 enrichment never runs. Fixing the
  Python→Node contract (structured `RESULT {json}` / JSONL on stdout) is a foundational prerequisite (M3).
- **Re-ingest is destructive.** `load_to_db.py:251` does `DELETE FROM chapters WHERE story_id=…` on every run,
  re-embedding everything and destroying chapter-scoped annotations. No `UNIQUE(story_id, chapter_order)`. Blocks
  incremental "add chapter 51" (M11).
- **Ingestion is a synchronous 3-subprocess HTTP request** (up to 10-min), no job tracking, no dedup (M5/M12).
- **Spoiler leaks in RAG:** raw Google-CSE snippets are pasted into the prompt with no spoiler classification
  (`rag.ts:200-217`); `findSimilarExternalKnowledge` has no chapter gate; `external_knowledge` stores the *query*
  embedding as content; image lookups bypass the filter on NULL `chapter_order`; volumes sort lexicographically
  (Vol 10 < Vol 2). Fixed in M8 + M18.
- **Brittle intent detection:** substring matching means "is he *mean* to her?" triggers foreshadowing mode and
  "summary of chapter 3's fight" triggers a whole-series recap (`rag.ts:46-66`). Replaced by one rewrite call in M10.
- **No global error handler, no structured logs, DB errors silently return `[]`, RAG errors return a 200 apology**
  (invisible failures). Fixed in M1.
- **`chapter_embeddings` exists in the schema but is never populated** — repurposed for micro-summaries in M10.
- **Unpinned Python deps** (`requirements.txt`, no `pyproject.toml`/`uv.lock`); `pip install` vs `uv run` can diverge
  (M3). **No compose smoke test** — CI never proves the image boots migrated (M6).

---

## 4. Track overview

| Track | Pillar | Delivers |
|---|---|---|
| **Foundation** | Platform & Quality | migrations tooling, users/profiles, pg-boss queue, error/log spine, admin token + rate limits, `llm_usage`, api/client, frontend test framework, CI smoke |
| **RAG** (walking skeleton) | Spoiler-Safe RAG Quality | eval harness, spoiler hardening, decomposition, rewrite/RRF/rerank, micro-summaries, answer-guard, citations |
| **Ingestion** | Self-Serve Ingestion | incremental diff/append loader, async jobs, chapter management, PDF/txt/paste, cost estimation |
| **Entities+KG** | Knowledge Graph | shared entity foundation, unified extraction, graph service + reader API + GraphRAG wiring + graph UI |
| **Image** | Image Recreation | visual-canon, generation service, Cast page |
| **Internet** | Internet Theories | paste→classify→attributed retrieval (v1); registry/refresh/Reddit deferred |
| **Recap** | (new, cross-cutting) | the catch-up composition endpoint + page |

---

## 5. Milestone plan (execute in order; parallel tracks noted)

**Universal DONE gate for every milestone:** backend + frontend typecheck clean; `pnpm lint` zero warnings;
`pnpm test` (+ `uv run pytest` for Python) written and green; docs (`CLAUDE.md`/`README.md`/`ROADMAP.md`) updated; no
file over 1000 lines; vanilla CSS only.

### Phase A — Foundation (critical-path root)

**M1 — Repo baseline + error/log/security spine** · *Platform F1–F3* · prereq: none · ✅ **DONE**
(`middleware/errors.ts` envelope + `asyncHandler`; pino `services/logger.ts` + `httpLogger` request ids;
`no-console` enforced; `X-API-Version`; `GET /config` removed; `middleware/adminAuth.ts`;
`middleware/rateLimits.ts` chat 20/min · ingest 6/hr · api 300/min; `env.validateAtBoot()`. Tests:
`middleware.test.ts` covers the envelope per class + 401 + 429. Backend 79 tests green.)
Merge the current `feat/docker-compose-cicd` branch as the baseline everything diffs against. Add
`middleware/errors.ts` (`ApiError`, `{error:{code,message,details?,requestId?}}` envelope, 404 + Zod + multer + bad-UUID
mapping — fixes multer HTML errors and raw-stderr leaks), `services/logger.ts` (pino + `pino-http` with request IDs,
redaction), replace all `console.*`, enable ESLint `no-console`, `X-API-Version` header middleware, remove `GET /config`.
Add `middleware/adminAuth.ts` (optional `ADMIN_TOKEN`, `timingSafeEqual`, 401), `middleware/rateLimits.ts`
(chat 20/min, ingest 6/hr, api 300/min), `env.validateAtBoot()`.
*DONE+:* error-envelope tests per class; 401 without token; 429 after N chat calls.

**M2 — Migration tooling + idempotent baseline** · *Platform F4* · prereq: M1 · **collision-dissolver (2.1)**
Add `node-pg-migrate` (dev-dep, `-j sql`). Write `..._baseline.sql` = idempotent superset of `schema.sql ∪ 001–007`;
move `001–007` to `db/migrations/legacy/`. `docker/start.sh` runs `migrate up` (with DB wait) before supervisord.
Demote `db/schema.sql` to first-boot bootstrap + drift reference.
*DONE+:* baseline idempotent on empty **and** existing DB; `schema_migrations` populated; **CI drift check green (make
it mandatory, not optional).* → **Human checkpoint #1.**

**M3 — Python runtime contract + packaging** · *Platform F6* · prereq: M1 · parallel with M2 · ✅ **DONE**
(`load_to_db.py` emits JSONL `progress`/`result` events on STDOUT — `emit_event()` — with all logs on
STDERR; `backend/src/services/pythonRunner.ts` streams+parses them, bounded stderr tail + timeout;
`admin.ts` reads `story_id` from the `result` event and the fragile regex is **deleted**;
`ingestion/pyproject.toml` + committed `uv.lock`; Dockerfile uses `uv sync --locked`; scripts run via
`uv run --project ingestion python`. Tests: `pythonRunner.test.ts` (5) + `test_load_to_db_events.py`
(4). `requirements*.txt` kept as legacy shims until the M6 CI overhaul.)
Add the structured stdout contract to `load_to_db.py`: a JSONL event stream on **stdout** (`progress`/`usage`/`result`
events) with all human logs on **stderr** — this is the terminal `RESULT {json}` line *and* streamed progress, built
once so M11 extends rather than rewrites. Extract `pythonRunner.ts` from `admin.ts` (JSONL-aware, bounded buffers,
per-stage timeout). Create `ingestion/pyproject.toml` + committed `uv.lock` (pinned); Dockerfile switches to pinned
`uv` + `uv sync --locked`; run scripts via `uv run --project ingestion`.
*DONE+:* pytest asserts the RESULT/event shapes; `admin.ts` story_id regex deleted.

**M4 — Users/profiles + frontend API client + test framework** · *Platform F5, F10* · prereq: M2 · **(2.7, 2.9)** · ✅ **DONE**
(migration `..._users`: users table, seeded default, orphan adoption before FKs; `services/users.ts` +
`controllers/users.ts` CRUD; `middleware/identity.ts` x-user-id → `req.userId`; frontend `api/client.ts`
[envelope + x-user-id + AbortSignal] + `api/user.ts` store + `ProfilePicker`; Vitest + RTL + jsdom,
root `pnpm test` = `pnpm -r`; 5 seed FE suites. Backend 97 / FE 21 at landing.)
`users` table + FK on `reading_progress`/`annotations` (seed `DEFAULT_USER_ID`, adopt orphan UUIDs first),
`controllers/users.ts` CRUD, `middleware/identity.ts` (validate `x-user-id`: absent→default, malformed→400,
unknown→404). Frontend `ProfilePicker.tsx` + `user.ts` (localStorage, auto-select seeded profile). Build the shared
`frontend/src/api/client.ts` + `api/types.ts` (envelope parsing, `x-user-id`, `AbortSignal`) and dedup per-file types.
Add Vitest + React Testing Library (`jsdom`); root `test` runs `pnpm -r`.
*DONE+:* profile CRUD + identity edge cases; api-client envelope/header tests; the 5 seed frontend suites; CLAUDE.md
drops the "when a framework is added" caveat.

**M5 — Background jobs (pg-boss) + async ingest + job API** · *Platform F7–F8* · prereq: M2, M3, M4 · **(2.4, 2.11)** · ✅ **DONE**
(migration `..._jobs`: `ingest_jobs` + `job_events`; `jobs/{queue,types,progress,handlers/*}`; pg-boss
serial workers [localConcurrency 1], graceful drain; `POST /api/admin/ingest` → **202 {jobId}** with
sha256 dedup, inline pipeline deleted; `GET /api/jobs/:jobId` + `/api/admin/jobs` + cancel; enrichment
runs as a follow-on job; nginx timeout 600s→120s; AdminPage submit→poll→checklist. Verified pg-boss
starts against live Postgres.)
`backend/src/jobs/{queue,types,progress,pythonRunner}.ts` + `handlers/{ingest,enrichStory}.ts`; `job_events` table.
`POST /api/admin/ingest` → **202 {jobId}** (stage upload to durable dir, dedup by `source_sha256`, enqueue); the old
inline 3-step pipeline + regex deleted. `GET /api/jobs/:jobId` (polling), cancel, `GET /api/admin/jobs`. Concurrency 1
for ingest/enrich (also serializes the same-story DB race); `retryLimit: 1`; graceful drain in `server.ts`; drop nginx
timeout to 120s. Frontend AdminPage: submit→poll→stage checklist, jobId persisted.
*DONE+:* mocked-boss unit tests + one real-Postgres handler happy-path; enrichment now actually runs on upload.
→ **Human checkpoint #2.**

**M6 — Cost tracking + CI smoke + docs** · *Platform F9, F11, F12* · prereq: M4, M5 · **(2.6)** · ✅ **DONE**
(migration `..._llm_usage`; `services/pricing.ts` [read-time $] + `services/usage.ts` [fire-and-forget];
`llm.ts` records usageMetadata with a context label; `load_to_db.py` records ingest-embedding usage;
`GET /api/admin/usage` + admin usage table; CI Python on `uv sync --locked`, unit step runs
backend+frontend, new **smoke** job [compose up → assert /health db:ok, X-API-Version, stories 200,
admin 401, 404 envelope] gating the docker push. Verified live: chat call priced correctly.)
`llm_usage` table + `services/usage.ts` (fire-and-forget) + `services/pricing.ts` (tokens→$ at read time);
`llm.ts` gains `usageContext`; Python scripts insert too. `GET /api/admin/usage` + admin usage table.
CI: pnpm caching, `uv sync --locked` + pytest, frontend tests, **`smoke` job** (`docker compose up`, assert `/health`
200 `db:ok`, `/api/stories` 200, admin-without-token 401, `X-API-Version` present), docker push gated on smoke.
*DONE+:* smoke job green — the proof the image boots migrated and talks to the DB.

### Phase B — RAG walking skeleton (delivers the catch-up experience; parallel with A after M2)

**M7 — Eval harness** · *RAG D1* · prereq: a running stack (starts at M1)
Top-level `eval/` (uv-run, hits the HTTP API): `run_eval.py`, `judge.py`, golden `qa.yaml` + `spoiler_probes.yaml` +
`retrieval.yaml` for the two seed stories (~30 each). Metrics: **spoiler-leak rate (target 0, hard gate)**, point
coverage, faithfulness, recall@8, citation precision, latency, $/query. Baseline the *current* pipeline first so every
later change is measured.

**M8 — Spoiler hardening + decomposition + LLM plumbing** · *RAG D2–D4* · prereq: M2, M7 · **(2.8, 2.9, 2.10)**
`resolveSpoilerScope` (server-resolved, NULL=deny) as shared middleware; migration for `volume_number` +
`getStoriesInSeries` ordering + assets `first_chapter_order`/`is_cover` + `uq_chapters_story_order` (the
spoiler-critical set of 2.10). Split `rag.ts`→`services/rag/*` and `db.ts`→`services/db/*` with re-export shims (zero
behavior change). `llm.ts`: `systemInstruction`, `responseSchema` helper, model param, `taskType` on embeddings. Fix
the `DISTINCT ON` image-ordering and cross-volume image bugs.
*DONE+:* SpoilerScope resolution matrix (incl. >9 volumes); **new Postgres-backed SQL integration tests for the spoiler
predicates**; eval spoiler-probe leak rate 0; decomposition provably behavior-neutral. → **Human checkpoint #3** (two
behavior changes: no-`storyId` chat loses retrieval; omitted `currentChapter` → progress/0).

**M9 — Citations/confidence/traces + chunking & re-embed** · *RAG D5–D6 (+ ingestion C12)* · prereq: M8, M4
Structured-output generation → validated citations (drop hallucinated labels), `confidence`, `insufficient_context`;
`rag_traces` table; **502 (not 200-apology)** on pipeline failure; frontend confidence badge + snippet tooltips.
Loader-side block re-chunking (>1600→~1200 + overlap), `backfill_embeddings.py`, `EMBEDDING_MODEL_TAG` cutover; re-embed
seed stories with the `text:` document instruction (migrated to `gemini-embedding-2/1536`, see §11).
*DONE+:* citation-validation tests; eval no-regression; seed dump regenerated. → **Human checkpoint #4** (approve
re-embedding + regenerating `db/seed.dump`).

**M10 — Retrieval quality ladder** · *RAG D7–D9* · prereq: M9 · ✅ **DONE (core)**
(`rewrite.ts`: one Flash-Lite call → standalone query + sub-queries + entity mentions + intent, replacing
the substring `detectSummaryIntent`/`detectForeshadowingIntent` hacks, fail-open; `fusion.ts` RRF +
configurable similarity floor, replacing the `*0.3` score fudge; `contextBuilder.ts` budgeted labeled
assembly (citations index the budget-trimmed set, so a dropped block can't be cited); `history` in the
chat contract → follow-up pronoun resolution. **Deferred** (additive, noted): `chapter_micro_summaries`
retrieval tier, ±1 neighbor expansion, reranker flag — Recap already ships on `chapter_summaries`.
120 backend tests; eval 0-leak held.)

Original scope:
`rewrite.ts` (one Flash-Lite call: standalone query + ≤3 sub-queries + entity mentions + intent — replaces the
substring intent hacks); `fusion.ts` RRF (replaces `*0.3`) + similarity floor; `chapter_micro_summaries` populating the
empty `chapter_embeddings` (the summary retrieval tier); `contextBuilder.ts` budgeted assembly + ±1 neighbor expansion;
`history` in the chat contract; reranker **behind a flag, off by default**.
*DONE+:* eval point coverage +≥15 pts, recall@8 +≥20 pts on multi-hop/alias subsets, p95 ≤ 8s.
**➡ Ship the text-only Recap (2.12) here** (summary + micro-summaries + last event), wired as the story-list "Continue".

**M10b — Answer guard + eval CI** · *RAG D12–D13* · prereq: M10 · **(2.14.4)**
`answerGuard.ts` (Flash-Lite groundedness check, revise/block loop, fail-closed for recall — the training-data-leak
backstop); **add the payoff-leak-check mode (2.14)** — a variant that checks generated text against a supplied set of
`payoff_summary` strings (used both offline by the foreshadow extractor and online by the recap/foreshadowing paths),
fail-closed. Guard verdict in response + frontend note; nightly eval GitHub Action (leak-rate hard gate).
*DONE+:* answer-guard spoiler-probe leak rate 0; payoff-leak-check drops emphasis when the generated prose entails any
supplied payoff fact (unit-tested with a known setup/payoff fixture).

### Phase C — Feature pillars (parallelizable after their prereqs)

**M11 — Incremental loader + ingestion schema + JSONL** · *Ingestion C1–C3* · prereq: M2, M3, M8
`content_hash`/`is_front_matter`/`source_sha256` + `(story_id, href)` assets unique (the ingest set of 2.10, using
`IF NOT EXISTS` on the shared chapter constraint); `--mode diff|append|replace` with per-chapter transactions +
hash-skip; `ON CONFLICT (external_id)` story upsert; `--extract-images`/`--images-dir` so tagging works on uploads.
Diff `content_hash` computed **after** the loader chunking from M9.
*DONE+:* re-ingest of an unchanged EPUB reports `skipped == chapter_count` and **$0.00**; crash-retry idempotent.

**M12 — Async ingest on pg-boss + upload UX** · *Ingestion C4–C6* · prereq: M5, M4, M11
Ingest pipeline runs inside pg-boss handlers (series re-enrich = N queued jobs, not an inline loop); optional SSE
progress on `job_events`; `UploadPanel`/`JobsPanel` with live stage/progress, cancel, survives navigation.

**M13 — Chapter management + append/paste + formats + cost** · *Ingestion C7–C11* · prereq: M12, M6 · ✅ **DONE**
(`services/chapters.ts` + `chapterAdmin` controller: rename / front-matter toggle / delete (+annotation
count) / reorder (two-phase to dodge the unique order constraint) / **paste-append** (chunks + embeds
only the new chapter via a TS mirror of `split_into_chunks`, invalidates `chapter_summaries`) + a
read-time **cost estimate** from `pricing.ts`. `extract_text.py` (.txt/.md, `--single-chapter`) +
`extract_pdf.py` (pdfplumber, MIT) wired into the ingest job + upload filter (ALLOWED_EXT +.txt/.md/.pdf).
`ChapterManager.tsx` (rename / toggle / delete-with-count / up-down reorder / paste-append + estimate),
linked from Admin. Verified live: appending 1 chapter embedded only its block (global usage delta +1,
chapters 1–2 not re-embedded). Backend 128 / FE 33 / Python 182 tests. drag-reorder → up/down buttons.)

Original scope:
`ChapterManager.tsx` (rename, front-matter toggle, delete-with-annotation-count, drag reorder → invalidate
`chapter_summaries` + `chapter_micro_summaries`); `POST /api/stories/:id/chapters` paste/append via
`extract_text.py --single-chapter`; `extract_text.py` (.txt/.md) + `extract_pdf.py` (pdfplumber, MIT — not AGPL
PyMuPDF); re-enrich/re-embed triggers; estimate-then-confirm cost gate reading `pricing.ts`.
*DONE+:* appending one chapter to a 50-chapter book embeds **only that chapter's blocks** (assert via `llm_usage`
deltas). *(Web-serial URL fetch is NOT shipped — RoyalRoad ToS; paste covers the need. See §6/§7.)*

**M14 — Shared entity foundation + unified extraction** · *KG E1–E3* · prereq: M2, M5, M8 · **(2.2, 2.3)**
Migration `kg_entities` + `kg_entity_aliases` (+ `kg_entity_states`, relationships, events, threads, evidence, links,
`kg_extraction_runs` — the full KG schema, but the *entity+alias* subset is what unblocks others). `ingestion/graph/`
(`prompts.py`, `merge.py` pure alias-merge, `writer.py` per-chapter transactions, `extract_graph.py` with resume +
`--rebuild`/`--from-chapter`) — the **single** per-chapter pass, its schema extended with image-gen's
`appearance_facts[]`. **Defer** the embedding-similarity entity-linking arm + `kg_entity_embeddings` HNSW (2.13);
lexical + LLM `known_entity` digest first. **Foreshadowing (2.14):** add `kg_foreshadow_links` to the migration and
`ingestion/graph/link_foreshadow.py` (the book-level linking pass + constrained `emphasis_hint` generation + the
extraction-time payoff-leak guard from M10b).
*DONE+:* ≥0.85 entity recall, **zero wrong-merges** of distinct characters on a labeled seed set; per-alias
`first_chapter_order` correct; **every stored `emphasis_hint` passes the payoff-leak guard (2.14.7)**. → **Human
checkpoint #5** (plain tables not Apache AGE; this is THE shared entity table; volume_number handling).

**M15 — KG service + reader API + GraphRAG wiring + graph UI** · *KG E4–E10* · prereq: M14, M8
`services/graph.ts` (`linkEntities`, `getEgoNetwork` recursive-CTE with temporal predicates, `getOpenThreads`,
`getStoryGraph`, `getVisibleAliases`); reader endpoints (`upToChapter` **required**, entity-404-when-unrevealed);
GraphRAG as a `services/rag/graphContext.ts` arm (alias keyword expansion + KNOWLEDGE GRAPH prompt section + OPEN PLOT
THREADS for foreshadowing) — a no-op when the story has no graph; `sourceType:'graph'` on sources. Frontend
`GraphPage` + `StoryGraph` (vis-network, canvas — no CSS-framework coupling) + `EntityPanel` + spoiler slider
(debounced, AbortController). `enrich_images.py` swapped to read `kg_entities`. **Foreshadowing (2.14):**
`getForeshadowLinks(scope)` in `services/graph.ts` (selects only `setup_summary`+`emphasis_hint` for the live window
`setup<=N<payoff`, never payoff columns); wire live links into foreshadowing chat mode (setup+hint context block).
*DONE+:* spoiler-visibility matrix (entity/alias/ended-relationship hidden past boundary); **graph leak red-team = 0**
post-boundary facts in injected context, **including the foreshadow red-team of 2.14.7** (payoff-chapter content never
reaches context/response; lens-off recap byte-identical to non-foreshadowing). → **Human checkpoint #6.**
**➡ Upgrade Recap** with "Main cast right now" + "Open questions" + the opt-in "Threads worth keeping an eye on" (2.14)
sections here.

**M16 — Image entities/canon (on shared entities) + archive helper** · *Image A1–A4* · prereq: M14, M5, M8 · ✅ **DONE**
(migration `..._image_canon`: `entity_appearance_facts` + `generated_images` FK'd to `kg_entities`;
`services/canon.ts` `buildCanon` slices facts ≤ boundary + supersedes by latest chapter + hashes
[post-boundary traits never enter the canon]; `services/archiveImages.ts` shared EPUB/CBZ extractor,
`assets.ts` consumes it. Appearance-facts LLM population folds into M-Backfill; M17 falls back to a
generic prompt when facts are absent. 5 canon tests.)

Original scope:
`services/archiveImages.ts` (shared JSZip/EPUB+CBZ helper; `controllers/assets.ts` consumes it). `entity_appearance_facts`
+ `generated_images` tables FK'd to `kg_entities`. Fold canon extraction into the M14 pass (appearance-facts branch;
comic `enriched_metadata` mining add-on). `canon.ts` (slice ≤ boundary + supersession + `canonHash`). **Rewrite** the
image-gen §3.4 "lazy fallback" (VAGUE — see §7): entities now pre-exist, so the fallback triggers only when facts are
absent-but-entity-present; give it a bounded timeout inside the request.

**M17 — Image generation service + Cast UI** · *Image A5–A9* · prereq: M16, M4, M5 · ✅ **DONE**
(`promptBuilder.ts` pure + spoiler-structural: the prompt is built from the canon ONLY — no name, no
free-text description — so a post-boundary trait can't reach the model; `generator.ts` live
`gemini-2.5-flash-image` via `@google/genai` (bounded retry); `imageGen.ts` cache→cap→gate state
machine (one image per (entity, canon_hash); IMAGE_GEN_DAILY_CAP/day; IMAGE_GEN_ENABLED), disk-served
private images; endpoints `GET /cast`, `POST /entities/:id/image` (admin, upToChapter required,
unrevealed→404), `GET /generated-images/:id`; `CastPage` grid + generate + lightbox, linked from the
story list. **Verified live:** a real 1.3 MB portrait generated on flash-lite-image, cache hit on
re-request, stored prompt carried no name/description/post-boundary trait. Golden prompt test + state-
machine tests (spoiler-gate/cache/cap/generate/fail). Deferred: comic `referenceImages.ts`.
→ **Human checkpoint #7 answered** (model = gemini-2.5-flash-image, ~25/day cap, private/no-share).)

Original scope:
`promptBuilder.ts` (pure, spoiler-safety structural — post-boundary facts never enter the prompt), `referenceImages.ts`
(comics; visible-alias-scoped panel selection), `generator.ts` (Nano-Banana via `@google/genai`; blocked/429-retry/cap/
cache/force state machine; **bound retries so worst-case < 120s nginx timeout**, or queue it). `generated_images` served
from disk, cached on `(entity_id, canon_hash)`. `CastPage` + `EntityCard` + lightbox; Reader Chat|Cast tab.
*DONE+:* promptBuilder golden slice tests assert on the stored `prompt` column (post-boundary traits never present);
daily cap enforced; cost ≤ configured cap. → **Human checkpoint #7** (`@google/genai` pin supports `generateContent`
image output — 2.5-flash-image dies 2026-10-02, Imagen 4 dies 2026-08-17; IP/likeness = no public sharing).

**M18 — External-knowledge subsystem v1 (paste → classify)** · *Internet B1–B4 (scoped)* · prereq: M2, M5, M9 · **(2.5)** · ✅ **DONE**
(migration `..._external_knowledge`: external_knowledge reworked to a spoiler-safe chunk table
[`max_chapter_order` NULL=default-deny, `content_sha256` dedup, `document_id`] + `knowledge_documents`
+ `theory_submissions`; legacy rows wiped; unsafe `insertExternalKnowledge` write path deleted. Retrieval
`findSimilarExternalKnowledge` DEFAULT-DENIES [NOT NULL max_chapter_order <= boundary]. `ingestion/external/`
classify.py [LLM, pure `parse_classification` denies null/low-conf/beyond-final] + pipeline.py [per-
paragraph chunk → dedup → classify → embed → insert, only safe chunks]. Verified live: safe paragraph
kept [ch5], future-spoiler paragraph denied. → **Human checkpoint #8**: internet-fetch stays deferred,
paste-only.)
Migration: `external_knowledge` reworked into the chunk table (+ provenance + `spoiler_scope`/`max_chapter_order` +
`content_sha256` dedup) + `knowledge_documents` + `theory_submissions`; wipe legacy junk rows; delete the
query-embedding write path. `ingestion/external/` (`normalize.py`, `chunker.py`, `fetch_generic.py` for paste,
`classify.py`, `dedup.py`, `pipeline.py --mode url`). **Classifier consumes `chapter_micro_summaries` from M10** as its
timeline reference (NOT cumulative `chapter_summaries` — see §7); default-deny, confidence floor, flair-can-only-tighten.
*DONE+:* classifier **false-safe rate < 2%** on a hand-labeled eval set; NULL-chapter default-deny SQL branch tested.
→ **Human checkpoint #8** (classifier gate).

**M19 — Theory jobs/retrieval/UI (v1)** · *Internet B5, B8, B9 (subset)* · prereq: M18, M8, M5, M4 · ✅ **DONE**
(pg-boss `theory-submission` worker runs the classify pipeline; `POST /stories/:id/theories` → 202 +
poll `GET /theories/:id`; `services/theories.ts`; theory-mode chat now returns spoiler-filtered
`externalSources` with [E#] attribution [CSE path already gone]; `TheorySubmit` component + external-
source pills in `ChatInterface`. Verified live E2E: submit → classified [ch5] → theory chat at boundary
20 surfaced it as an external source. Backend 148 / FE 39 tests.)
pg-boss `theory:submission` handler + submission endpoints + polling; `services/knowledge.ts findExternalKnowledge`
(spoiler-filtered), theory-mode `[En]` attribution + cited-only `externalSources`, CSE snippet path deleted;
`TheorySubmit.tsx` + external-source pills; empty-state ("no fan theories yet — paste a thread"). Optional
spoiler-RAG rewrite-to-scrubbed-paraphrase layer.
*DONE+:* E2E submit→ready→theory-question with **all `externalSources` satisfying the spoiler invariant**.
*Deferred to a later milestone (2.5/2.13): `fetch_fandom.py`, `fetch_reddit.py`, source registry + admin UI, refresh
cron, Batch-API. Gate any internet-fetching behind* **human checkpoint #8** *(Reddit Responsible-Builder ToS / ML-train
ban; Fandom CC-BY-SA).*

**M-Backfill — "Bring an existing story up to the current feature set"** · prereq: M14, M16, M10 · **(completeness)** · ✅ **DONE**
(pg-boss `backfill` job [jobs/handlers/backfill.ts] runs graph → foreshadow → appearance extraction in
dependency order for a story, tracked via ingest_jobs + job_events [GET /api/jobs/:id]; `POST
/api/admin/stories/:id/backfill` → 202; AdminPage "Backfill" button per story. `extract_appearance.py`
[the M16-deferred appearance-fact LLM extractor; pure `parse_appearance_facts` validates type/boundary]
populates entity_appearance_facts → real canon → real Cast portraits. Verified live: 23 seed characters
→ 16 chapter-versioned appearance facts. Deferred: chapter_micro_summaries + RETRIEVAL_DOCUMENT re-embed
fold in once the micro-summaries tier lands [M10]. Seed-dump SEED_DEMO reconciliation remains a human
decision [§7].)
One admin action / queued job type that runs the consolidated extraction + micro-summaries + `RETRIEVAL_DOCUMENT`
re-embed **in dependency order** for an existing story (entities → appearance facts → states/relationships/events →
micro-summaries → re-embed). Without this, the seed dump and any existing library show an empty Cast page, blank graph,
and no Recap until 4 manual `--all` sweeps are run. Add empty states to Cast/Graph/Recap/Theory that either kick off
this backfill or say "pending". Reconcile the seed-dump conflict (RAG wants to regenerate it; Platform wants
`SEED_DEMO=1` gating) — **human decision**, see §7.

---

## 6. Human-review checkpoints (stop here — maintainer's call)

1. **After M2:** baseline migration exactly reproduces `schema.sql ∪ 001–007` (CI drift check mandatory).
2. **After M5:** confirm pg-boss replaces ingestion's hand-rolled queue; retry/concurrency semantics.
3. **After M8:** eval leak rate 0; accept the two behavior changes (no-storyId chat, currentChapter default).
4. **After M9:** approve re-embedding + regenerating `db/seed.dump`.
5. **Before M14:** plain relational tables (not Apache AGE — it *is* PG18-compatible now but not worth the custom
   image); `kg_entities`+`kg_entity_aliases` is THE shared entity table; series/volume handling.
6. **Before M15 graph-arm merge:** graph-context leak red-team = 0.
7. **Before M17 first live generation:** `@google/genai` pin + model choice (churn dates above); IP/likeness stance.
8. **Before M18 classifier gate AND before any internet-fetching (M19+):** classifier false-safe budget; Reddit ToS +
   Fandom licensing.

Plus two ingestion behavior decisions surfaced at M11/M13: diff-mode orphan chapters (keep-and-report vs delete); and
reorder blast radius (it shifts every reader's `reading_progress` meaning and wipes summary caches).

---

## 7. Design steps that were too vague — resolve before implementing

1. **Image-gen "lazy fallback" canon extraction (M16).** After 2.2/2.3, `extract_canon.py` no longer *discovers*
   entities. Rewrite the fallback: trigger = entity exists but has zero appearance facts; bounded timeout inside the
   request; must not contend with the batch pipeline for quota. *(Original: pillar-designs line ~949.)*
2. **Theories classifier timeline (M18).** It must consume RAG's per-chapter `chapter_micro_summaries` (M10), NOT the
   cumulative `chapter_summaries` (which it would corrupt). Specify the LLM's `latest_event_referenced` → concrete
   `max_chapter_order` mapping explicitly — that mapping *is* the spoiler guarantee. *(Original: line ~1161.)*
3. **Job API transport (M5/M12).** Decided in 2.11: polling baseline, optional SSE for ingest — choose at M5, don't
   discover at M12.
4. **Archive-image materialization (M16 vs M11).** Serve-time (Node `archiveImages.ts`) and ingest-time (Python
   `--extract-images`) are both legitimate but must share JSZip/CBZ path conventions; the Node helper is the owner.
5. **Seed-dump fate (M-Backfill).** RAG regenerates it; Platform wants to delete it and gate demo data behind
   `SEED_DEMO=1`. Pick one.

---

## 8. Shared-infrastructure ownership (build once)

| Component | Owner milestone | Consumers |
|---|---|---|
| node-pg-migrate + baseline + timestamp naming | M2 | ALL (dissolves migration collisions) |
| `users` + `identity.ts` | M4 | all user-scoped columns |
| pg-boss queue + `job_events` + `/api/jobs/:id` | M5 | ingestion, theories, KG-extract, image-canon |
| `llm_usage` + `usage.ts` + `pricing.ts` | M6 | all Gemini callers, ingest estimates |
| error envelope + adminAuth + rate limits + `validateAtBoot` | M1 | all controllers, all `/api/admin/*`, all env vars |
| `api/client.ts` + `api/types.ts` | M4 | every frontend surface |
| `volume_number` + series ordering | M8 | KG/theories/image cross-volume scoping |
| `rag.ts`/`db.ts` decomposition | M8 | KG graph arm, theories external-knowledge module |
| embedding in-prompt task instruction + `backfill_embeddings.py` + `EMBEDDING_MODEL_TAG` (`gemini-embedding-2/1536`) | M9 | theories chunk embeddings, ingest `embed_backfill` |
| block re-chunking (loader) | M9 | ingestion diff `content_hash` |
| `chapter_micro_summaries` + `chapter_embeddings` populate | M10 | theories classifier timeline, Recap |
| answer-guard | M10b | all chat modes |
| `kg_entities` + `kg_entity_aliases` + one extraction pass | M14 | image appearance-facts, RAG alias expansion, enrich_images |
| external-knowledge subsystem | M18 | RAG theory retrieval |
| assets hardening (`(story_id,href)` unique + anchoring) | M8 (anchoring) / M11 (href) | image reference images, findRelevantImages |
| `is_front_matter` + shared `FRONT_MATTER_PATTERNS` | M11 | RAG + all extraction consumers |
| `services/archiveImages.ts` | M16 | assets controller, image reference images |
| Recap composition endpoint + page | M10 (text) → M15 (cast) | story list, Reader header (reader hub) |

---

## 9. Reference — full pillar designs

All six designs (with schema DDL, prompts, API bodies, web-verified library/model facts, and per-pillar risk lists)
plus the six subsystem maps are in
[`docs/improvement-plan/pillar-designs-and-maps.md`](improvement-plan/pillar-designs-and-maps.md):

| Section | Lines |
|---|---|
| Subsystem maps (RAG, frontend, schema, ingestion, API/admin, infra) | 1–805 |
| Image Recreation | 806–1027 |
| Internet Theories | 1028–1320 |
| Self-Serve Ingestion | 1321–1595 |
| Spoiler-Safe RAG Quality | 1596–1966 |
| Knowledge Graph | 1967–2372 |
| Platform & Quality | 2373–2738 |

When a milestone cites a pillar PR (e.g. "RAG D8", "Platform F7", "KG E3"), the numbering matches that pillar's own
"Implementation checklist" section in the reference file.

---

## 10. Suggested first slice (walking skeleton)

Ship the **catch-up/recap experience** end-to-end with only Foundation + RAG: **M1 → M2 → M3 → M4 → M7 → M8 → M9 →
M10 (+ text Recap) → M10b**. This is the product's headline user story and needs none of the four heavy pillars — the
"story so far" + recent-chapter micro-summaries *are* the recap, spoiler hardening makes it safe, the eval harness
proves it, and it de-risks the whole Foundation spine under real feature pressure. RAG is synchronous, so M8→M10b run
largely in parallel with Platform M5/M6. Image, Internet, KG, and full incremental Ingestion are strictly additive
afterward.

---

## 11. Model selection & pricing (evaluated 2026-07, verify at implementation time)

The app uses `gemini-flash-lite-latest` for **both** the main and lite tiers (see the demo-stage note
below), `gemini-embedding-2` (1536-dim MRL) for embeddings, and keeps the eval judge on
`gemini-flash-latest` for grading reliability. Verified pricing from
[ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing):

| Model | $/1M in | $/1M out | vs. what we use |
|---|---|---|---|
| `gemini-2.5-flash` (retired) | 0.30 | 2.50 | former baseline (now 404) |
| `gemini-2.5-flash-lite` (retired) | 0.10 | 0.40 | former baseline (now 404) |
| `gemini-embedding-001` (superseded) | 0.15 | — | former baseline |
| `gemini-3.5-flash` | 1.50 | 9.00 | ~5× / 3.6× pricier |
| `gemini-3.1-flash-lite` | 0.25 | 1.50 | cheaper than 2.5-flash on output; ~2.5× the 2.5-flash-lite |
| `gemini-3.1-pro-preview` | 2.00 | 12.00 | premium |
| `gemini-embedding-2` (current) | 0.20 | — | +$0.05/1M vs 001; newer, MRL, multimodal |
| `gemini-2.0-flash` | — | — | **shut down 2026-06-01 (unused here)** |

**UPDATE (2026-07, forced): `gemini-2.5-flash` AND `gemini-2.5-flash-lite` were retired (both now
404 at the API).** This broke every runtime LLM call. Migrated to the `-latest` aliases
(`gemini-flash-latest`, `gemini-flash-lite-latest`), which track the current tier and **survive
future retirements** (the whole reason this bit us). Model IDs are now centralized + env-overridable:
`backend/src/config/models.ts` (`MAIN_MODEL`/`LITE_MODEL`/`EMBEDDING_MODEL_ID`/`EMBEDDING_DIMENSIONS`)
and `ingestion/models.py`, with every caller reading the same `GEMINI_MAIN_MODEL` /
`GEMINI_LITE_MODEL` / `GEMINI_EMBEDDING_MODEL` / `GEMINI_EMBEDDING_DIMS` env vars — so a swap is one
env change, no code edit.

**UPDATE (2026-07, done): migrated embeddings `gemini-embedding-001` (768-dim, `task_type`) →
`gemini-embedding-2` (1536-dim MRL).** embedding-2 has **no `task_type` param** — the task
instruction is prepended to the input text instead (`buildEmbeddingInput`/`embedding_input`: queries
use `task: search result | query: …`, documents use `text: …`) — and it **auto-normalizes** truncated
MRL dimensions (verified: L2 norm 1.0000 at 1536 vs 0.69 for 001 at the same truncation), so cosine
works directly with no manual normalization. Chose **1536** dims: a recommended MRL size, higher
fidelity than the legacy 768, and still under pgvector's 2000-dim HNSW ceiling (3072 would need
`halfvec`). Migration `1700000000004_embedding_2.sql` drops the HNSW indexes, empties the
`*_embeddings` tables, `ALTER`s the vector columns `768→1536`, and rebuilds the indexes; the retrieval
tag moved `gemini-embedding-001` → `gemini-embedding-2/1536` (encodes model+dims, so old/new vectors
never mix). Seed re-embedded via `backfill_embeddings.py` (111/111 blocks); eval re-run at 0 content
leaks. Cost delta is +$0.05/1M on embeddings only (input-side, tiny) — earned by better retrieval and
future multimodal/8192-token headroom.

**Finding:** there is **no free like-for-like upgrade** — the pinned Gemini 3.x text tier costs 2–5×
the (now-dead) 2.5 tier. So:

1. **Default to the `-latest` flash/flash-lite aliases** (done). They stay on the cheapest current
   tier and don't 404 on the next retirement. Pin an explicit version via env only if reproducibility
   matters more than resilience.

   **DEMO-STAGE (2026-07, done): the MAIN tier is temporarily set to `gemini-flash-lite-latest` too**
   (chat/summarize/extraction/enrich all run on flash-lite) because full flash was too expensive at
   demo volume. This is a one-line default in `backend/src/config/models.ts` + `ingestion/models.py`
   (and mirrored in `graph/prompts.py`, `load_to_db.py`, `enrich_images.py`); restore the stronger
   tier post-demo with `GEMINI_MAIN_MODEL=gemini-flash-latest`. The eval **judge** is deliberately
   left on `gemini-flash-latest` (`GEMINI_JUDGE_MODEL` overrides it alone) — it's an offline grader
   with no demo-runtime cost and it is the spoiler safety net, so it must not be weakened.
2. **Model IDs are centralized** (done) — swapping is now an env var, eval-gated.
3. **Embeddings migrated to `gemini-embedding-2` (done)** — see the UPDATE above. Folded into the
   M9 D6 backfill + tag-cutover machinery that was already built.
4. **Optional, eval-gated text-tier upgrades** (measure with the M7 harness before switching):
   `gemini-3.1-flash-lite` for the main tier (better model, cheaper output than 2.5-flash, but pricier
   than 2.5-flash-lite for the guard/judge lite work — so cost impact is mixed).
5. Image generation already targets the current Nano-Banana tier (image-gen pillar, §M16/M17).

Non-goal: chasing the newest model for its own name — the eval harness (spoiler-leak + answer
quality) is the gate for any model change, since a pricier model must earn its cost.
