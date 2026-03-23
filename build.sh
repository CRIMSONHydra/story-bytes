#!/usr/bin/env bash
# Build Story Bytes.
# Usage: ./build.sh [--dev]
#   --dev   Install deps and compile TypeScript (no Docker)
#   (default) Build Docker image

set -euo pipefail
cd "$(dirname "$0")"

if [[ "${1:-}" == "--dev" ]]; then
  echo "Building in dev mode..."
  pnpm install
  pnpm build
  echo "Dev build complete."
else
  echo "Building Docker image..."
  docker build -t story-bytes .
  echo "Docker image 'story-bytes' built successfully."
fi
