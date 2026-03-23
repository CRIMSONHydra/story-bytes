#!/usr/bin/env bash
# Run Story Bytes.
# Usage: ./run.sh [--dev]
#   --dev   Run backend + frontend dev servers with hot reload
#   (default) Run Docker container

cd "$(dirname "$0")"

if [[ "${1:-}" == "--dev" ]]; then
  trap 'trap - INT TERM; kill -- -$$; exit' INT TERM

  echo "Starting backend (http://localhost:5001)..."
  pnpm --filter backend dev &

  echo "Starting frontend (http://localhost:5173)..."
  pnpm --filter frontend dev &

  wait
else
  if ! docker image inspect story-bytes >/dev/null 2>&1; then
    echo "Docker image not found. Run ./build.sh first."
    exit 1
  fi

  echo "Starting Story Bytes (http://localhost:5001)..."
  docker run --rm -it \
    --env-file .env \
    -p 5001:5001 \
    -v "$(pwd)/dataset:/app/dataset" \
    -v "$(pwd)/processed:/app/processed" \
    story-bytes
fi
