# Story Bytes Roadmap

## Vision

A local-first story knowledge base that ingests novels and comics, maintains a vector-indexed content store, and provides an LLM-powered assistant that can answer questions, generate summaries, and surface relevant images -- all while respecting a user-specified spoiler boundary.

---

## Current Architecture

```
dataset/*.epub
    |  (Python: extract_epub.py)
    v
processed/*.json
    |  (Python: load_to_db.py + embeddings)
    v
PostgreSQL (stories, chapters, blocks, embeddings, assets, annotations, external_knowledge)
    |
    v
Express 5 API (TypeScript)
    |-- GET  /api/stories, /api/chapters/:id
    |-- POST /api/chat  -->  RAG: embed query -> vector search -> Gemini 2.5 Flash
    v
React 19 SPA (Vite)
    |-- StoryList page
    |-- Reader page + ChatInterface sidebar
```

### What Works

| Component | Status | Details |
|---|---|---|
| EPUB extraction | Working | Text + images, TOC-spine mapping, raw HTML preserved |
| Database schema | Working | 10 tables with constraints, indexes, CASCADE deletes |
| Backend API | Working | Stories, chapters, chat endpoints; Zod validation |
| Frontend | Working | Story list, chapter reader, chat sidebar |
| Web search | Working | Google Custom Search for external knowledge (theories, wiki) |
| Spoiler filtering | Designed | `findSimilarBlocks` filters by `chapter_order <= currentChapter` |

### Known Bugs

**CRITICAL -- Embedding Model Mismatch (RAG is non-functional):**

| Layer | Model | Dimensions | Stored as |
|---|---|---|---|
| Ingestion (`load_to_db.py`) | `all-MiniLM-L6-v2` | 384 | `model='all-MiniLM-L6-v2'` |
| Backend (`llm.ts` + `db.ts`) | `text-embedding-004` | 768 | Filters `WHERE model='text-embedding-004'` |

The vector search query never matches any stored embeddings. Even if it did, comparing 384-dim and 768-dim vectors would produce garbage results. **RAG returns empty context on every query.**

**Other issues:**

- pgvector extension commented out in `schema.sql` -- using `FLOAT8[]` arrays without HNSW indexes
- The `<=>` cosine distance operator in `db.ts` requires pgvector to be enabled
- No integration tests for the RAG pipeline

---

## Phase 1: Foundation Fixes ✅ COMPLETE

> Priority: **CRITICAL** -- nothing else works until this is fixed.

### 1.1 Enable pgvector

- Uncomment `CREATE EXTENSION IF NOT EXISTS vector` in `db/schema.sql`
- Ensure pgvector is installed in local PostgreSQL

### 1.2 Migrate embedding storage

- Change `FLOAT8[]` to native `vector(768)` for:
  - `block_embeddings.vector`
  - `chapter_embeddings.vector`
  - `knowledge_embeddings.vector`
- Create migration: `db/migrations/001_enable_pgvector.sql`

### 1.3 Add HNSW indexes

```sql
CREATE INDEX idx_block_embeddings_vector
  ON block_embeddings USING hnsw (vector vector_cosine_ops);

CREATE INDEX idx_knowledge_embeddings_vector
  ON knowledge_embeddings USING hnsw (vector vector_cosine_ops);
```

### 1.4 Unify embedding model

- Switch `ingestion/load_to_db.py` from `all-MiniLM-L6-v2` to Gemini `text-embedding-004`
- Remove `sentence-transformers` dependency, use Google GenAI API with batching
- Re-ingest all 5 processed volumes with correct 768-dim embeddings

### 1.5 Verify and test

- Confirm `backend/src/services/db.ts` queries work against pgvector `vector(768)` columns
- Add `backend/src/__tests__/rag.test.ts`: verify `findSimilarBlocks` returns results, spoiler filtering works

### Files

- `db/schema.sql` -- enable extension, migrate types, add indexes
- `db/migrations/001_enable_pgvector.sql` -- migration script
- `ingestion/load_to_db.py` -- switch embedding model
- `backend/src/__tests__/rag.test.ts` -- new integration test

---

## Phase 2: CBZ/CBR Comic Ingestion ✅ COMPLETE

> Extend ingestion to support image-based comics alongside EPUB novels.

### 2.1 Comic archive parser

- New `ingestion/comic/extract_comic.py`
- CBZ: Python `zipfile` stdlib (ZIP of images)
- CBR: `rarfile` package (RAR of images)
- Sort pages numerically, output same JSON structure as EPUB extraction

### 2.2 Chapter detection

- **Default**: Each archive file = one chapter
- **Optional**: User-provided chapter boundary config via CLI (`--chapter-breaks 0,24,50,...`)
- Future: Auto-detect chapter separator pages

### 2.3 OCR pipeline

- New `ingestion/comic/ocr.py`
- Primary: Tesseract via `pytesseract` (local, free)
- Preprocessing: Grayscale + thresholding for cleaner results
- Manga: `manga-ocr` package for Japanese text
- Output: Text blocks alongside image blocks per page

### 2.4 Schema changes

- Add `content_type TEXT CHECK (content_type IN ('novel', 'comic', 'manga'))` to `stories` table
- Migration: `db/migrations/002_story_content_type.sql`

### 2.5 Unified loader

- Extend `ingestion/load_to_db.py` with `--format epub|cbz|cbr` flag
- Both extraction pipelines produce identical JSON structure
- DB loading code stays unified

### Files

- `ingestion/comic/extract_comic.py` -- new comic parser
- `ingestion/comic/ocr.py` -- new OCR pipeline
- `ingestion/load_to_db.py` -- extend with format flag
- `db/schema.sql` + `db/migrations/002_story_content_type.sql`

---

## Phase 3: Image Intelligence Pipeline ✅ COMPLETE

> Multi-pass image analysis to map images to characters, locations, and scenes.

### Pass 1 -- Ingest-time basic tagging

During ingestion, use Gemini vision (multimodal) to generate basic metadata for each image:

- **What**: Raw visual description, detected elements (appearance, setting, mood, action)
- **Store in `assets` table**:
  - `visual_description TEXT` -- "A red-haired girl sparring with a tall dark-skinned woman in a grassy field"
  - `visual_tags JSONB` -- `{"characters_visual": ["red-haired girl", "tall dark-skinned woman"], "setting": "grassy field", "mood": "intense", "action": "sparring"}`
- **Image embeddings**: Embed the visual description text with `text-embedding-004`, store in new `asset_embeddings` table with HNSW index
- At this stage, the model doesn't know character names -- only visual features

### Pass 2 -- Post-ingestion enrichment

After all chapters are loaded, run an enrichment script with full story context:

- New script: `ingestion/enrich_images.py`
- For each image, provide the VLLM with:
  - The image itself
  - Surrounding text blocks (before/after in chapter)
  - Character list built from the full story text
  - Chapter context and title
- **Update `assets.enriched_metadata JSONB`**:
  - `{"characters": ["Eris Boreas Greyrat", "Ghislaine Dedoldia"], "location": "Fittoa Region - Boreas estate grounds", "scene": "sword training", "plot_significance": "establishes Eris's combat development arc"}`
- This resolves "red-haired girl" to "Eris Boreas Greyrat"

### Pass 3 -- Query-time image selection

When the RAG pipeline retrieves text context, also surface relevant images:

- `backend/src/services/db.ts`: New `findRelevantImages(embedding, storyId, currentChapter)` -- vector search against `asset_embeddings` with spoiler filtering
- `backend/src/services/rag.ts`: Retrieve candidate images, include their enriched metadata in the LLM prompt, let the LLM judge which images to include
- Response shape changes from `string` to `{ answer, sources, images }`
- Images returned with asset IDs for frontend to fetch and display

### Schema additions

```sql
-- On assets table
ALTER TABLE assets ADD COLUMN visual_description TEXT;
ALTER TABLE assets ADD COLUMN visual_tags JSONB DEFAULT '{}';
ALTER TABLE assets ADD COLUMN enriched_metadata JSONB DEFAULT '{}';

-- New table
CREATE TABLE asset_embeddings (
  asset_id    UUID REFERENCES assets(asset_id) ON DELETE CASCADE,
  model       TEXT NOT NULL,
  dimensions  INT NOT NULL,
  vector      vector(768),
  PRIMARY KEY (asset_id, model)
);
CREATE INDEX idx_asset_embeddings_vector
  ON asset_embeddings USING hnsw (vector vector_cosine_ops);
```

### Files

- `ingestion/load_to_db.py` -- add Pass 1 image tagging during load
- `ingestion/enrich_images.py` -- new post-ingestion enrichment script
- `backend/src/services/db.ts` -- add `findRelevantImages`
- `backend/src/services/rag.ts` -- integrate image retrieval + LLM judging
- `db/schema.sql` + `db/migrations/003_image_intelligence.sql`

---

## Phase 4: Enhanced RAG and Spoiler-Free Intelligence ✅ COMPLETE

> Smarter retrieval, summarization, and foreshadowing awareness.

### 4.1 Foreshadowing prompt engineering

Modify the system prompt in `backend/src/services/rag.ts` to handle foreshadowing queries:

- Detect foreshadowing intent (keywords: "hint", "foreshadow", "what could X mean")
- Instruct LLM: examine provided context for recurring symbols, oddly specific statements, unexplained events
- Use hedging language ("This could be setting up...", "The author may be hinting at...")
- Never confirm actual future plot points, even from training data
- Add `mode` parameter to chat request: `'recall' | 'foreshadowing' | 'theory'`

### 4.2 Chapter-aware summarization

- New endpoint: `POST /api/stories/:storyId/summarize` with `{ upToChapter: number }`
- Fetch all `chapters.aggregated_text` where `chapter_order <= upToChapter`
- For long stories: Recursive summarization (summarize chunks, then summarize summaries)
- Include relevant images from Phase 3 in summary output
- Cache in new table: `chapter_summaries(story_id, up_to_chapter, summary_text, model, created_at)`

### 4.3 Hybrid search (keyword + semantic)

- Add PostgreSQL full-text search alongside vector search
- `findBlocksByKeyword(query, storyId, currentChapter)` using `ts_vector` / `ts_query`
- Combined scoring: `0.7 * semantic_similarity + 0.3 * keyword_relevance`
- GIN index on `chapter_blocks.text_content`
- Migration: `db/migrations/004_fulltext_search.sql`

### 4.4 Content-type-aware chunking

- For prose: Re-chunk long blocks at sentence boundaries (~200-400 tokens per chunk)
- For comics: Keep page-level granularity, combine OCR text from adjacent panels

### Files

- `backend/src/services/rag.ts` -- foreshadowing prompts, image-aware responses
- `backend/src/controllers/summary.ts` -- new summarization controller
- `backend/src/routes.ts` -- add summary route
- `backend/src/services/db.ts` -- hybrid search queries
- `db/migrations/004_fulltext_search.sql`

---

## Phase 5: Frontend and UX ✅ COMPLETE

> Make the application pleasant for reading and querying.

### 5.1 Spoiler cutoff selector

- Chapter picker in `ChatInterface.tsx` -- lets users override the auto-detected chapter
- Use case: "I've read ahead to chapter 15 but re-reading chapter 3 -- use 15 as spoiler limit"

### 5.2 Comic reader mode

- New `frontend/src/components/ComicViewer.tsx`
- Full-page image viewer with arrow key / swipe navigation
- Fit-to-width / fit-to-height toggle, zoom + pan
- Detect mode from story `content_type`

### 5.3 Image-aware chat responses

- **Inline images**: Images embedded in chat response where the LLM deemed relevant
- **Gallery view**: Expandable panel showing all relevant images for a response
- New backend endpoint: `GET /api/assets/:assetId/image` to serve stored images
- Add `react-markdown` for formatted responses with image support

### 5.4 Source citations

- RAG responses include `sources: [{ chapterOrder, blockId, title }]`
- Rendered as clickable links navigating to the referenced chapter/block

### 5.5 Story progress tracking

- New table: `reading_progress(user_id, story_id, last_chapter_order, updated_at)`
- Endpoint: `PUT /api/stories/:storyId/progress`
- "Continue Reading" button on story list

### 5.6 Responsive layout

- Mobile breakpoints: collapse sidebar to bottom sheet
- Keyboard navigation (arrow keys for chapters)

### Files

- `frontend/src/components/ChatInterface.tsx` -- spoiler selector, image display, citations
- `frontend/src/components/ComicViewer.tsx` -- new comic reader
- `frontend/src/pages/Reader.tsx` -- comic mode detection, keyboard nav
- `frontend/src/pages/StoryList.tsx` -- progress tracking UI
- `backend/src/controllers/assets.ts` -- new image serving endpoint

---

## Phase 6: Advanced Features

> Deep intelligence for serious readers.

### 6.1 Character knowledge graphs

- Tables: `characters`, `character_relationships`
- Extraction: Gemini analyzes chapter text + Phase 3's enriched image metadata
- Query integration: Character context pulled into RAG prompts
- Frontend: D3.js / vis.js network graph visualization

### 6.2 Plot thread tracking

- Table: `plot_threads(thread_id, story_id, title, status, started_chapter, resolved_chapter)`
- LLM-assisted extraction of narrative threads
- Frontend: Timeline visualization

### 6.3 Multi-volume / series support

- Table: `series(series_id, title)` + `stories.series_id`, `stories.volume_number`
- Cross-volume search up to current reading position
- Updated routing: `/series/:seriesId/volume/:vol/chapter/:order`

### 6.4 Annotations integrated with RAG

- Backend CRUD endpoints for the existing `annotations` table
- Text selection annotation popup in reader
- Annotation embeddings included in semantic search

---

## Phase Dependencies

```
Phase 1 (Fix embeddings)
  |
  +---> Phase 2 (Comic ingestion) ---> Phase 3 (Image intelligence)
  |                                       |
  |                                       +---> Phase 4 (Enhanced RAG)
  |                                       |        |
  +---> Phase 5 (Frontend) <-------------/--------/
          |
          +---> Phase 6 (Advanced features)
```

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Embedding model | Gemini `gemini-embedding-001` (768-dim) | Consistency between ingest and query; `text-embedding-004` was retired |
| Vector store | pgvector in PostgreSQL | Single database, HNSW indexes, sufficient for this scale |
| Image analysis | Gemini vision (multimodal) | Same API/billing as text; strong visual understanding |
| Foreshadowing | LLM prompt engineering at query time | Simpler than ingest-time tagging; more flexible |
| Image metadata | Multi-pass (basic -> enriched -> judged) | Ingest-time model lacks context; enrichment with full story resolves ambiguity |
| Image display | Inline in chat + expandable gallery | Best of both worlds for different use cases |
