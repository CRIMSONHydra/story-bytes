#!/usr/bin/env bash
# Run Story Bytes.
# Usage: ./run.sh [--dev]
#   --dev   Run backend + frontend dev servers with hot reload (uses local DB)
#   (default) Run via docker compose (app + DB containers, port 80)

cd "$(dirname "$0")"

if [[ "${1:-}" == "--dev" ]]; then
  trap 'trap - INT TERM; kill -- -$$; exit' INT TERM

  echo "Starting backend (http://localhost:5001)..."
  pnpm --filter backend dev &

  echo "Starting frontend (http://localhost:5173)..."
  pnpm --filter frontend dev &

  wait
else
  echo "Starting Story Bytes (http://localhost)..."
  docker compose up
fi
