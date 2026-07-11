# Story Bytes

Local-first toolkit for reading novels (EPUB) and comics (CBZ/CBR) with a **spoiler-aware** AI companion. Ingest a story, embed it with Gemini, and chat, summarize, or get a catch-me-up recap — the assistant only ever references content up to your current chapter, so it never spoils what's ahead.

### Key capabilities

- **Spoiler-safe RAG chat** — three modes (recall, foreshadowing analysis, theory), grounded answers with citations, a confidence signal, and a fail-closed spoiler guard. Retrieval is bounded server-side by your reading position.
- **Catch-me-up recap** — a "story so far" up to chapter N, with opt-in, spoiler-safe foreshadowing emphasis (setup + a vetted hint; the payoff is never revealed).
- **Chapter-versioned knowledge graph** — entities, relationships, events, and plot threads, all gated so an unrevealed entity is a 404, not a leak. Browsable in an interactive graph UI.
- **Multi-profile** — local reader profiles; reading progress and chat scope follow the selected profile.
- **Async self-serve ingestion** — upload an EPUB/CBZ/CBR/**TXT/MD/PDF**; the pipeline (extract → embed → tag/enrich images) runs in the background with live progress. Manage chapters (rename, reorder, front-matter, paste-append) with a pre-flight cost estimate.
- **Character cast + AI portraits** — spoiler-safe generated portraits (Nano-Banana) built only from appearance facts revealed up to your chapter; cached, capped, private.
- **Fan theories** — paste a theory; it's classified so only parts about chapters you've read can ever surface in theory-mode chat (default-deny). Internet fetching is intentionally not shipped (ToS) — paste covers it.
- **Operable** — structured error envelope + request ids, pino logging, admin auth, rate limits, and read-time LLM cost accounting.

## Quick Start (Docker)

```bash
cp .env.example .env    # Add your API keys
./build.sh              # Build Docker images
./run.sh                # Start app + DB → http://localhost
```

Or pull the pre-built image from Docker Hub:

```bash
docker pull naverdo/story-bytes:latest
```

## Quick Start (Dev)

```bash
pnpm install
./run.sh --dev          # Hot reload → http://localhost:5173
```

## Architecture

```
┌─────────────────────────────────┐
│  docker compose                 │
│                                 │
│  ┌──────────┐   ┌───────────┐  │
│  │ db       │   │ app       │  │
│  │ PG 18 +  │◄──│ nginx :80 │  │
│  │ pgvector │   │ express   │  │
│  └──────────┘   │ python    │  │
│                 └───────────┘  │
└─────────────────────────────────┘
```

- **Prod:** `docker compose up` — nginx on port 80, PostgreSQL in container
- **Dev:** `./run.sh --dev` — backend :5001 + frontend :5173, local PostgreSQL

## Tech Stack

| Concern            | Choice                                                      |
|--------------------|-------------------------------------------------------------|
| Backend API        | Express 5 + TypeScript (Node 20+)                           |
| Frontend           | React 19 + TypeScript via Vite (Rolldown)                   |
| Data Pipelines     | Python 3.12+ (managed via `uv`, `pyproject.toml` + `uv.lock`)|
| Database           | PostgreSQL 18+ with `pgvector`; migrations via node-pg-migrate |
| Embeddings         | Google Gemini `gemini-embedding-2` (1536-dim MRL)           |
| LLM                | Google Gemini `gemini-flash-lite-latest` (demo default; override via env) |
| Vector Search      | pgvector HNSW cosine similarity                             |
| Async jobs         | pg-boss (background ingestion/enrichment)                   |
| Logging / limits   | pino + pino-http, express-rate-limit                        |
| Container          | Docker Compose (app + DB)                                   |
| CI/CD              | GitHub Actions (lint · build · migrate · tests · smoke)     |

## Repo Layout

```
backend/          Express API (TypeScript)
frontend/         React + Vite client
ingestion/        Python pipelines (EPUB parsing, comic OCR, embeddings)
db/               SQL schema & migrations
docker/           nginx, supervisor, start script
dataset/          Source EPUBs/comics (git-ignored)
processed/        JSON output from ingestion (git-ignored)
```

## Prerequisites

### Docker (recommended)

| Tool | Version | Purpose |
|------|---------|---------|
| Docker | 24+ | Container runtime |
| Docker Compose | v2+ | Multi-container orchestration |

### Local Development

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20+ | Backend API & frontend build |
| [pnpm](https://pnpm.io/) | 10+ | Package management |
| Python | 3.12+ | Data ingestion pipelines |
| [uv](https://github.com/astral-sh/uv) | latest | Python package/venv manager |
| PostgreSQL | 18+ | Primary database (local dev only) |
| pgvector | 0.8+ | Vector similarity search extension |

### API Keys (in `.env`)

| Key | Source | Purpose |
|-----|--------|---------|
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) | Embeddings + LLM generation |
| `GOOGLE_SEARCH_API_KEY` | [Google Cloud Console](https://console.cloud.google.com/) | Web search for external knowledge |
| `GOOGLE_CX` | [Programmable Search](https://programmablesearchengine.google.com/) | Custom search engine ID |
| `ADMIN_TOKEN` _(optional)_ | you choose | If set, `/api/admin/*` requires `Authorization: Bearer <token>` (unset ⇒ open, with a boot warning) |

Optional model/logging overrides (`GEMINI_MAIN_MODEL`, `GEMINI_EMBEDDING_DIMS`, `LOG_LEVEL`, …) are documented in `.env.example`.

## Getting Started

### Option A: Docker (recommended)

```bash
# 1. Set up environment
cp .env.example .env
# Edit .env with your API keys

# 2. Build and run
./build.sh    # Builds Docker images
./run.sh      # Starts app + DB → http://localhost

# 3. Ingest content via admin page
# Navigate to http://localhost → Admin tab → Upload EPUB/CBZ
```

### Option B: Local Development

```bash
# 1. Environment
cp .env.example .env
# Edit .env — set DB_PORT=5433, API keys

# 2. Install dependencies
pnpm install
uv sync --project ingestion          # installs the locked Python env

# 3. Database — apply migrations (node-pg-migrate)
sudo service postgresql start
cd backend && DATABASE_URL=postgresql://postgres:1234321@localhost:5433/postgres pnpm migrate:up && cd ..

# 4. Run with hot reload
./run.sh --dev
# Backend: http://localhost:5001
# Frontend: http://localhost:5173
```

`db/schema.sql` is the first-boot bootstrap + drift reference; ongoing changes live in `db/migrations/`.

### Ingest Content

The simplest path is the **Admin page** (http://localhost → Admin): upload an EPUB/CBZ/CBR and watch
the async job progress. Or run the pipeline steps directly under the locked project env:

```bash
uv run --project ingestion python ingestion/epub/extract_epub.py dataset/<book_folder> -o processed -v
uv run --project ingestion python ingestion/load_to_db.py processed/<filename>.json --tag-images
uv run --project ingestion python ingestion/enrich_images.py --all
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (includes DB status) |
| GET | `/api/stories` | List all stories |
| GET | `/api/stories/:id` | Get story by ID |
| GET | `/api/stories/:storyId/chapters` | Get chapters (filters front-matter) |
| GET | `/api/chapters/:id` | Get chapter with content blocks |
| POST | `/api/chat` | RAG-powered Q&A (spoiler-aware; recall/foreshadowing/theory) |
| POST | `/api/stories/:storyId/summarize` | Generate chapter summary |
| GET | `/api/stories/:storyId/recap` | Catch-me-up recap (`?upToChapter=N&foreshadow=1`) |
| GET | `/api/stories/:storyId/graph` · `/entities/:id` · `/threads` | Spoiler-gated knowledge graph (M15) |
| GET/POST | `/api/stories/:id/cast` · `/entities/:id/image` · `/generated-images/:id` | Cast + spoiler-safe AI portraits (M17) |
| POST/GET | `/api/stories/:id/theories` · `/api/theories/:id` | Fan-theory submit (async classify) + poll (M19) |
| GET/POST | `/api/stories/:id/chapters/manage` · `/api/chapters/:id` | Chapter management + paste-append (M13) |
| GET | `/api/assets/:assetId/image` · `/api/stories/:storyId/image?path=...` | Serve images |
| GET/PUT | `/api/stories/:storyId/progress` | Reading progress (per profile) |
| GET | `/api/stories/:storyId/series-chapters` · `/api/series` | Cross-volume / series listing |
| GET/POST/PUT/DELETE | `/api/users`, `/api/users/:id` | Profiles CRUD (M4) |
| POST | `/api/admin/ingest` | **Async** upload → `202 {jobId}` (M5) |
| GET | `/api/jobs/:jobId` | Ingest job status + progress events (M5) |
| GET | `/api/admin/stories` · `/api/admin/jobs` · `/api/admin/usage` | Admin: stories · jobs · LLM cost |
| DELETE | `/api/admin/stories/:storyId` | Admin: delete story |

`/api/admin/*` requires `Authorization: Bearer $ADMIN_TOKEN` when `ADMIN_TOKEN` is set. All errors use a
single envelope: `{ error: { code, message, details?, requestId } }`.

## Scripts

| Script | Description |
|--------|-------------|
| `./build.sh` | Build Docker images |
| `./build.sh --dev` | Install deps + compile TypeScript locally |
| `./run.sh` | Run via Docker Compose (port 80) |
| `./run.sh --dev` | Run dev servers with hot reload |

## Development

### Running Tests

```bash
pnpm test                                              # backend (150) + frontend (39) via pnpm -r
uv run --project ingestion python -m pytest ingestion/tests/ -v   # Python tests
pnpm lint                                              # Lint both packages (zero-warning policy)
pnpm build                                             # Type-check + build both
```

Backend tests use Vitest + Supertest (`backend/src/__tests__/`); frontend uses Vitest + React Testing
Library + jsdom (`*.test.tsx` beside the code).

### CI/CD

GitHub Actions runs on every push/PR:
1. Lint → Build → apply migrations → unit tests (backend + frontend) → Python tests (`uv sync --locked`)
2. **smoke** — `docker compose up` and assert the image boots migrated (`/health` db:ok, `X-API-Version`,
   `/api/stories` 200, admin-without-token 401, 404 envelope)
3. On master merge (gated on test + smoke): Docker build + push to Docker Hub
