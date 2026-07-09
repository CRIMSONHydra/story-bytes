#!/usr/bin/env bash
# .claude/scripts/refresh-validation-markers.sh
#
# Runs the frontend + backend gate suites and refreshes the
# `.claude/.validated/{frontend,backend}.json` markers. Intended as a
# fallback when the PostToolUse(Bash) hook misfires (e.g. sub-agent bash
# interleaving, or a command shape the regex doesn't match).
#
# Why this exists:
#   The Stop hook (`stop-validation-gate.js`) blocks if the markers are stale
#   or missing. The markers are normally auto-written by
#   `write-validation-marker.js` when a gate command runs cleanly. If the hook
#   doesn't fire for any reason — but the gates DID pass — this wrapper
#   captures the actual gate output and feeds it back through the hook script
#   so the marker is written from real results, not fabricated input.
#
# Lives under `.claude/` so the whole validation ecosystem (hooks + this
# fallback) ships as one self-contained unit when copied to another project.
#
# Usage:
#   bash .claude/scripts/refresh-validation-markers.sh           # both gates
#   bash .claude/scripts/refresh-validation-markers.sh frontend  # frontend only
#   bash .claude/scripts/refresh-validation-markers.sh backend   # backend only
#
# Exit codes:
#   0 — all requested gates passed and markers refreshed
#   1 — a gate failed (no marker written for that gate)

set -u

# This script lives at `<repo>/.claude/scripts/`; the hook is its sibling.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$CLAUDE_DIR/.." && pwd)"
HOOK="$CLAUDE_DIR/hooks/write-validation-marker.js"

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 is required for JSON escaping but not found in PATH" >&2
  exit 1
fi

run_frontend_gate() {
  cd "$REPO_ROOT/frontend" || return 1
  local out
  out=$(pnpm type-check 2>&1 && pnpm lint 2>&1)
  local rc=$?
  if [ $rc -ne 0 ]; then
    echo "❌ frontend gate failed (exit $rc):"
    echo "$out"
    return 1
  fi
  # Feed the actual gate command + actual stdout to the hook.
  printf '%s' "$(
    cat <<EOF
{"tool_input":{"command":"cd frontend && pnpm type-check && pnpm lint"},"tool_response":{"stdout":$(printf '%s' "$out" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))'),"stderr":"","exit_code":0}}
EOF
  )" | node "$HOOK"
  echo "✓ frontend gate passed; marker refreshed."
}

run_backend_gate() {
  cd "$REPO_ROOT/backend" || return 1
  local out
  out=$(uv run mypy app 2>&1 && ../scripts/lint.sh 2>&1)
  local rc=$?
  if [ $rc -ne 0 ]; then
    echo "❌ backend gate failed (exit $rc):"
    echo "$out"
    return 1
  fi
  printf '%s' "$(
    cat <<EOF
{"tool_input":{"command":"cd backend && uv run mypy app && ../scripts/lint.sh"},"tool_response":{"stdout":$(printf '%s' "$out" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))'),"stderr":"","exit_code":0}}
EOF
  )" | node "$HOOK"
  echo "✓ backend gate passed; marker refreshed."
}

scope="${1:-both}"
case "$scope" in
  frontend) run_frontend_gate ;;
  backend)  run_backend_gate ;;
  both|"")  run_frontend_gate && run_backend_gate ;;
  *)
    echo "usage: $0 [frontend|backend|both]" >&2
    exit 2
    ;;
esac
