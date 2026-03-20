#!/usr/bin/env bash
# Start both backend and frontend dev servers with hot reload.
# Press Ctrl+C to stop both.

cd "$(dirname "$0")"

trap 'trap - INT TERM; kill -- -$$; exit' INT TERM

echo "Starting backend (http://localhost:5001)..."
pnpm --filter backend dev &

echo "Starting frontend (http://localhost:5173)..."
pnpm --filter frontend dev &

wait
