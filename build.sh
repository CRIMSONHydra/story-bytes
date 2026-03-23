#!/usr/bin/env bash
# Build Story Bytes.
# Usage: ./build.sh [--dev]
#   --dev   Install deps and compile TypeScript (no Docker)
#   (default) Build Docker images via docker compose

set -euo pipefail
cd "$(dirname "$0")"

if [[ "${1:-}" == "--dev" ]]; then
  echo "Building in dev mode..."
  pnpm install
  pnpm build
  echo "Dev build complete."
else
  echo "Building Docker images..."
  docker compose build
  echo "Docker images built successfully."
fi
