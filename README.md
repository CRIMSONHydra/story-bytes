# Story Bytes

Local-first toolkit for building a story knowledge base with chapter summaries, Q&A, and multimodal context. Ingest novels (EPUB) and comics (CBZ/CBR), embed content with Gemini, and chat with an AI assistant that respects spoiler boundaries.

## Quick Start (Docker)

```bash
cp .env.example .env    # Add your API keys
./build.sh              # Build Docker images
./run.sh                # Start app + DB → http://localhost
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
| Data Pipelines     | Python 3.12+ (managed via `uv`)                             |
| Database           | PostgreSQL 18+ with `pgvector` extension                    |
| Embeddings         | Google Gemini `gemini-embedding-001` (768-dim)              |
| LLM                | Google Gemini 2.5 Flash                                     |
| Vector Search      | pgvector HNSW cosine similarity                             |
| Container          | Docker Compose (app + DB)                                   |
| CI/CD              | GitHub Actions                                              |

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
uv venv --python 3.12
uv pip install -r ingestion/requirements.txt

# 3. Database
sudo service postgresql start
PGPASSWORD=1234321 psql -h localhost -p 5433 -U postgres -d postgres -f db/schema.sql

# 4. Run with hot reload
./run.sh --dev
# Backend: http://localhost:5001
# Frontend: http://localhost:5173
```

### Ingest Content (CLI)

```bash
# Extract EPUB to JSON
uv run python ingestion/epub/extract_epub.py dataset/<book_folder> -o processed -v

# Load into database with image tagging
uv run python ingestion/load_to_db.py processed/<filename>.json --tag-images

# Enrich image metadata with story context
uv run python ingestion/enrich_images.py --all
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (includes DB status) |
| GET | `/api/stories` | List all stories |
| GET | `/api/stories/:id` | Get story by ID |
| GET | `/api/stories/:storyId/chapters` | Get chapters (filters front-matter) |
| GET | `/api/chapters/:id` | Get chapter with content blocks |
| POST | `/api/chat` | RAG-powered Q&A (spoiler-aware) |
| POST | `/api/stories/:storyId/summarize` | Generate chapter summary |
| GET | `/api/assets/:assetId/image` | Serve asset image |
| GET | `/api/stories/:storyId/image?path=...` | Serve image from EPUB |
| GET | `/api/stories/:storyId/progress` | Get reading progress |
| PUT | `/api/stories/:storyId/progress` | Update reading progress |
| GET | `/api/stories/:storyId/series-chapters` | Cross-volume chapter list |
| GET | `/api/series` | List distinct series |
| GET | `/api/admin/stories` | Admin: stories with counts |
| DELETE | `/api/admin/stories/:storyId` | Admin: delete story |
| POST | `/api/admin/ingest` | Admin: upload and ingest file |

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
pnpm test                              # 49 backend tests
uv run pytest ingestion/tests/ -v      # 133 Python tests
pnpm lint                              # Lint both packages
pnpm build                             # Type-check + build
```

### CI/CD

GitHub Actions runs on every push/PR to master:
1. Lint → Build → Backend tests → Python tests
2. On master merge: Docker build + push to Docker Hub
