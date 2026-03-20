# CLAUDE.md — Story Bytes Development Guide

## Project Overview

Story Bytes is a full-stack RAG (Retrieval-Augmented Generation) application for spoiler-aware AI-powered story reading. Users read novels/comics chapter-by-chapter and chat with an AI that only references content up to their current chapter. Supports three chat modes: recall, foreshadowing analysis, and theory discussion.

## Monorepo Structure

```
story-bytes/
├── backend/           # Express 5 + TypeScript API
│   ├── src/
│   │   ├── controllers/   # HTTP request handlers (chat, chapters, stories, summary, assets, progress)
│   │   ├── services/      # Business logic (rag, llm, db, search)
│   │   ├── db/            # PostgreSQL connection pool
│   │   ├── config/        # Environment validation (Zod) — loads .env from project root
│   │   ├── __tests__/     # Vitest test suites (8 tests)
│   │   ├── app.ts         # Express app factory
│   │   ├── routes.ts      # API route definitions
│   │   └── server.ts      # Entry point with graceful shutdown
│   ├── eslint.config.js   # Flat ESLint config
│   ├── vitest.config.ts   # Test runner config
│   └── tsconfig.json      # Strict TS (ES2022)
├── frontend/          # React 19 + Vite (rolldown-vite) SPA
│   ├── src/
│   │   ├── pages/         # Route-level components (StoryList, Reader)
│   │   ├── components/    # Reusable UI (ChatInterface, ComicViewer)
│   │   ├── App.tsx        # Root with React Router
│   │   └── main.tsx       # React entry point
│   ├── eslint.config.js   # Flat ESLint config
│   ├── tsconfig.json      # References tsconfig.app.json + tsconfig.node.json
│   └── vite.config.ts     # Vite build config
├── ingestion/         # Python data pipelines
│   ├── epub/              # EPUB extraction (extract_epub.py)
│   ├── comic/             # CBZ/CBR extraction (extract_comic.py, ocr.py)
│   ├── load_to_db.py      # Unified DB loader with embedding generation
│   └── enrich_images.py   # Post-ingestion image enrichment with story context
├── db/                # PostgreSQL schema + migrations (pgvector)
│   ├── schema.sql         # Full schema (13 tables)
│   └── migrations/        # 001-005 migration scripts
├── scripts/           # Utility scripts (wsl_setup.sh)
├── run.sh             # Start both dev servers with hot reload
├── package.json       # Root pnpm workspace orchestrator
└── pnpm-workspace.yaml
```

## Tech Stack

- **Package manager:** pnpm 10+ (monorepo workspaces)
- **Backend:** Express 5, TypeScript 5.9, Node.js 20+, Zod validation
- **Frontend:** React 19, TypeScript 5.9, Vite (rolldown-vite 7.2), React Router 7
- **Database:** PostgreSQL 18+ on port 5433, with pgvector 0.8+ (HNSW cosine similarity)
- **LLM:** Google Gemini 2.5 Flash via @google/genai SDK
- **Embeddings:** Gemini `gemini-embedding-001` (768-dim vectors via `output_dimensionality`)
- **Testing:** Vitest 4 + Supertest (backend, 8 tests)
- **Linting:** ESLint 9 flat config + typescript-eslint + eslint-config-prettier (backend), react-hooks + react-refresh plugins (frontend)
- **Styling:** Vanilla CSS only — **NO Tailwind CSS**
- **Ingestion:** Python 3.12+ (psycopg2, google-genai, ebooklib, BeautifulSoup4, rarfile, pytesseract, Pillow)
- **Image serving:** JSZip for extracting images from EPUB archives on demand

## Commands

```bash
# Install
pnpm install

# Development (both servers)
./run.sh                   # Starts backend + frontend with hot reload

# Development (individual)
pnpm dev:backend           # tsx watch (http://localhost:5001)
pnpm dev:frontend          # Vite dev server (http://localhost:5173)

# Build
pnpm build                 # Build backend + frontend

# Lint
pnpm lint                  # Lint backend + frontend

# Test
pnpm test                  # Run backend Vitest suite (8 tests)

# Individual workspace commands
pnpm --filter backend <script>
pnpm --filter frontend <script>

# Python ingestion
uv run python ingestion/epub/extract_epub.py dataset/<folder> -o processed -v
uv run python ingestion/comic/extract_comic.py <archive> -o processed -v --ocr
uv run python ingestion/load_to_db.py processed/<file>.json [--tag-images]
uv run python ingestion/enrich_images.py --all
```

## Database

- PostgreSQL runs on **port 5433** (configured in `.env` as `DB_PORT=5433`)
- Schema defined in `db/schema.sql`, migrations in `db/migrations/` (001-005)
- 13 tables: `stories`, `chapters`, `chapter_blocks`, `chapter_sources`, `assets`, `chapter_embeddings`, `block_embeddings`, `asset_embeddings`, `annotations`, `external_knowledge`, `knowledge_embeddings`, `chapter_summaries`, `reading_progress`
- Vector search uses HNSW indexes on `block_embeddings`, `asset_embeddings`, and `knowledge_embeddings`
- Front-matter chapters (ToC, credits, etc.) are filtered from API responses
- Apply schema: `PGPASSWORD=1234321 psql -h localhost -p 5433 -U postgres -d postgres -f db/schema.sql`
- Ingest data: `uv run python ingestion/load_to_db.py processed/<file>.json`

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (includes DB status) |
| GET | `/api/stories` | List all stories |
| GET | `/api/stories/:id` | Get story by ID |
| GET | `/api/stories/:storyId/chapters` | Get chapters (front-matter filtered) |
| GET | `/api/chapters/:id` | Get chapter with content blocks |
| POST | `/api/chat` | RAG Q&A (modes: recall, foreshadowing, theory) |
| POST | `/api/stories/:storyId/summarize` | Chapter-aware summarization |
| GET | `/api/assets/:assetId/image` | Serve asset image by ID |
| GET | `/api/stories/:storyId/image?path=...` | Serve image from EPUB archive |
| GET | `/api/stories/:storyId/progress` | Get reading progress |
| PUT | `/api/stories/:storyId/progress` | Update reading progress |

## Environment Variables

Required in `.env` at project root:

```
DB_HOST=localhost
DB_PORT=5433
DB_USER=postgres
DB_PASSWORD=1234321
DB_NAME=postgres
GEMINI_API_KEY=...
GOOGLE_SEARCH_API_KEY=...
GOOGLE_CX=...
```

---

## Development Rules

### Styling — No Tailwind

**Do NOT use Tailwind CSS, utility-class frameworks, or CSS-in-JS libraries.** This project uses vanilla CSS files. All styling must be written as plain CSS in `.css` files. Use semantic class names and standard CSS features (custom properties, flexbox, grid, media queries).

### Type Safety — Check After Every Change

After every code change, run the TypeScript compiler to verify type correctness before considering the work done:

- Backend: `pnpm --filter backend build` (runs `tsc --project tsconfig.json`)
- Frontend: `pnpm --filter frontend build` (runs `tsc -b && vite build`)

**Fix all type errors before moving on.** Do not use `@ts-ignore`, `@ts-expect-error`, or `any` to silence type issues — resolve them properly.

### Testing — Comprehensive Coverage After Every Feature

After implementing any feature or bug fix, write and run comprehensive tests:

1. **Write tests** that cover:
   - The happy path
   - All edge cases (empty inputs, missing data, boundary values, malformed input)
   - Error scenarios (network failures, invalid state, missing dependencies)
   - Integration points (API request/response contracts, database interactions)
2. **Run tests:** `pnpm test`
3. **All tests must pass** before the work is considered complete.
4. **Test location:** Backend tests go in `backend/src/__tests__/` using Vitest + Supertest.
5. Frontend tests: when a frontend testing framework is added, follow the same comprehensive coverage standard.

### Linting — Zero Warnings Policy

**Never ignore lint warnings or errors.** Fix every single one.

- Run `pnpm lint` after changes and resolve all issues.
- Do not disable ESLint rules inline (`eslint-disable`) unless there is a genuinely unavoidable reason — and document why in a comment.
- Treat warnings as errors. If ESLint warns about something, fix it.

### Single Responsibility and Open/Closed Principles

- **Single Responsibility:** Each file, function, and component should have one clear reason to exist. Controllers handle HTTP. Services handle business logic. Components handle UI rendering.
- **Open/Closed:** Design modules to be extensible without modifying existing code. Use composition and parameterization to add behavior rather than rewriting existing logic.

### File Size Limit — 1000 Line Maximum

**No frontend or backend source file (TypeScript/TSX) may exceed 1000 lines.** Data files, schemas, and generated files are exempt.

When a file approaches or exceeds 1000 lines:

1. **Extract** logical units into their own files (helper functions, sub-components, types, constants).
2. **Reduce** the original file to under 800 lines.
3. **Organize** extracted code by domain/responsibility, not arbitrarily.

### Documentation — Keep READMEs and Roadmap Updated

After every change, update the relevant documentation to reflect the current state:

- **`CLAUDE.md`** — this file, development guide and rules
- **`README.md`** — project overview, setup instructions, tech stack
- **`ROADMAP.md`** — mark completed items, add new planned work

### General Code Quality

- Prefer explicit over implicit — name things clearly.
- Keep functions short and focused. If a function does more than one thing, split it.
- Use early returns to reduce nesting.
- Handle errors at system boundaries (user input, API responses, database results). Don't add redundant validation for internal calls.
- Write self-documenting code. Only add comments when the "why" isn't obvious from the code.
