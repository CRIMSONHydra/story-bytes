#!/usr/bin/env bash
# Story Bytes — WSL Setup Script
#
# The project lives on the Windows filesystem and is accessed via /mnt/e.
# Run this script from anywhere — it will cd to the correct path.
#
# Usage:
#   bash /mnt/e/repos/story-bytes/scripts/wsl_setup.sh
#
# This script:
# 1. Installs PostgreSQL 18 + pgvector inside WSL
# 2. Applies the database migration
# 3. Re-ingests all processed volumes with correct Gemini embeddings
#
# Prerequisites:
#   - uv installed (curl -LsSf https://astral.sh/uv/install.sh | sh)
#   - .env file with GEMINI_API_KEY

set -euo pipefail

# ── Project root ──
# Works from either a WSL clone or the Windows mount
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"
echo "=== Story Bytes WSL Setup ==="
echo "Working directory: $PROJECT_DIR"

# ── 0. Symlink data dirs if running from a fresh WSL clone ─────────────
WINDOWS_DATA="/mnt/e/repos/story-bytes"

if [ ! -e "$PROJECT_DIR/dataset" ] && [ -d "$WINDOWS_DATA/dataset" ]; then
  echo "Symlinking dataset/ from Windows filesystem..."
  ln -s "$WINDOWS_DATA/dataset" "$PROJECT_DIR/dataset"
fi

if [ ! -e "$PROJECT_DIR/processed" ] && [ -d "$WINDOWS_DATA/processed" ]; then
  echo "Symlinking processed/ from Windows filesystem..."
  ln -s "$WINDOWS_DATA/processed" "$PROJECT_DIR/processed"
fi

if [ ! -f "$PROJECT_DIR/.env" ] && [ -f "$WINDOWS_DATA/.env" ]; then
  echo "Copying .env from Windows filesystem..."
  cp "$WINDOWS_DATA/.env" "$PROJECT_DIR/.env"
fi

# ── 1. Install pgvector extension into Windows PostgreSQL ──────────────
echo ""
echo "── Step 1: Install pgvector ──"

# Check if pgvector is already available
PG_AVAILABLE=$( PGPASSWORD="${DB_PASSWORD:-1234321}" psql \
  -h "${DB_HOST:-localhost}" -p "${DB_PORT:-5433}" \
  -U "${DB_USER:-postgres}" -d "${DB_NAME:-postgres}" \
  -tAc "SELECT count(*) FROM pg_available_extensions WHERE name='vector'" 2>/dev/null || echo "0" )

if [ "$PG_AVAILABLE" = "1" ]; then
  echo "pgvector already available — skipping build."
else
  echo "pgvector not found. Building from source..."

  # Need build tools
  sudo apt-get update -qq
  sudo apt-get install -y -qq build-essential git postgresql-server-dev-18 2>/dev/null || {
    echo ""
    echo "NOTE: postgresql-server-dev-18 not found in apt."
    echo "You may need to add the PostgreSQL apt repo first:"
    echo ""
    echo "  sudo sh -c 'echo \"deb http://apt.postgresql.org/pub/repos/apt \$(lsb_release -cs)-pgdg main\" > /etc/apt/sources.list.d/pgdg.list'"
    echo "  wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -"
    echo "  sudo apt-get update"
    echo "  sudo apt-get install postgresql-server-dev-18"
    echo ""
    echo "Then re-run this script."
    exit 1
  }

  cd /tmp
  rm -rf pgvector
  git clone --branch v0.8.2 https://github.com/pgvector/pgvector.git
  cd pgvector
  make
  sudo make install
  cd -
  echo "pgvector built and installed."
fi

# ── 2. Apply database migration ───────────────────────────────────────
echo ""
echo "── Step 2: Apply migration (pgvector + vector(768) + HNSW indexes) ──"

# Source .env from the project directory
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a; source "$PROJECT_DIR/.env"; set +a
fi

PGPASSWORD="${DB_PASSWORD:-1234321}" psql \
  -h "${DB_HOST:-localhost}" -p "${DB_PORT:-5433}" \
  -U "${DB_USER:-postgres}" -d "${DB_NAME:-postgres}" \
  -f db/migrations/001_enable_pgvector.sql

echo "Migration applied!"

# Verify
PGPASSWORD="${DB_PASSWORD:-1234321}" psql \
  -h "${DB_HOST:-localhost}" -p "${DB_PORT:-5433}" \
  -U "${DB_USER:-postgres}" -d "${DB_NAME:-postgres}" \
  -c "SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';"

# ── 3. Set up Python environment ──────────────────────────────────────
echo ""
echo "── Step 3: Set up Python environment ──"

if ! command -v uv &>/dev/null; then
  echo "Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

uv venv --python 3.13 2>/dev/null || uv venv --python 3.12
uv pip install -r ingestion/requirements.txt

# ── 4. Re-ingest all processed volumes ────────────────────────────────
echo ""
echo "── Step 4: Re-ingest volumes with Gemini gemini-embedding-001 ──"

if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "ERROR: GEMINI_API_KEY not set in .env — cannot generate embeddings."
  echo "Set it and re-run: uv run python ingestion/load_to_db.py processed/<file>.json"
  exit 1
fi

VOLUME_COUNT=0
for json_file in processed/*.json; do
  if [ -f "$json_file" ]; then
    echo ""
    echo "Ingesting: $json_file"
    uv run python ingestion/load_to_db.py "$json_file"
    VOLUME_COUNT=$((VOLUME_COUNT + 1))
  fi
done

if [ "$VOLUME_COUNT" -eq 0 ]; then
  echo "No JSON files found in processed/. Run extraction first:"
  echo "  uv run python ingestion/epub/extract_epub.py dataset/<book> -o processed -v"
else
  echo ""
  echo "=== Done! Ingested $VOLUME_COUNT volume(s) with 768-dim Gemini embeddings. ==="
fi

# ── 5. Verify ─────────────────────────────────────────────────────────
echo ""
echo "── Verification ──"
PGPASSWORD="${DB_PASSWORD:-1234321}" psql \
  -h "${DB_HOST:-localhost}" -p "${DB_PORT:-5433}" \
  -U "${DB_USER:-postgres}" -d "${DB_NAME:-postgres}" \
  -c "SELECT
        (SELECT count(*) FROM stories) as stories,
        (SELECT count(*) FROM chapters) as chapters,
        (SELECT count(*) FROM chapter_blocks) as blocks,
        (SELECT count(*) FROM block_embeddings) as embeddings,
        (SELECT count(*) FROM block_embeddings WHERE model = 'gemini-embedding-001') as correct_model;"
