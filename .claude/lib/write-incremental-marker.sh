#!/usr/bin/env bash
# .claude/lib/write-incremental-marker.sh
#
# Writes a validation marker at `.claude/.validated/<gate>.json` that records:
#   • state_hash        — sha256 of the filtered `git status --short` (single
#                         source of truth via code-state-hash.sh). The Stop
#                         hook compares this to a fresh hash to gate "stale?".
#   • ts                — ISO-8601 UTC timestamp of the write.
#   • command           — short note describing the gate invocation.
#   • head_sha          — `git rev-parse HEAD` at write time (for audit).
#   • validated_files   — map of `<file path> → git hash-object` for every
#                         file in the current branch scope. compute-incremental
#                         -scope.sh uses this to narrow the next run to files
#                         whose content hash differs.
#   • written_by_session — session id of the Claude window that wrote this
#                         marker. Read by the Stop hook's 60-second permissive
#                         downgrade to detect "another window just finished"
#                         scenarios. Empty when --session is not supplied
#                         (best-effort, never load-bearing).
#
# Resolves the marker dir from `git rev-parse --show-toplevel` so a previous
# `cd frontend/` or `cd backend/` in the same Bash invocation can't silently
# drop the marker into a nested `.claude/...` path (a footgun documented in
# CLAUDE.md > End-of-Scope Verification Loop).
#
# Usage:
#   bash .claude/lib/write-incremental-marker.sh <gate-name> [command-tail] [--mode narrow|widened] [--session <sid>]
#
#   <gate-name> is one of: audit-feature, qa
#
# Exit code: 0 on success, 1 on hard failure (missing args, no python3, etc.).

set -u

gate="${1:-}"
[ $# -gt 0 ] && shift

# Second positional (if present) is the command_tail. But the caller may skip
# it and go straight to flags, so only consume $2 if it isn't a flag.
command_tail=""
if [ $# -gt 0 ] && [ "${1#--}" = "$1" ]; then
  command_tail="$1"
  shift
fi

mode="narrow"
session_id="${CLAUDE_SESSION_ID:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --mode)
      if [ $# -ge 2 ]; then mode="$2"; shift 2; else shift; fi
      ;;
    --mode=*) mode="${1#--mode=}"; shift ;;
    --session)
      if [ $# -ge 2 ]; then session_id="$2"; shift 2; else shift; fi
      ;;
    --session=*) session_id="${1#--session=}"; shift ;;
    *) shift ;;
  esac
done

if [ -z "$gate" ]; then
  echo "write-incremental-marker.sh: missing <gate-name> arg" >&2
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "write-incremental-marker.sh: not inside a git repo" >&2
  exit 1
}

if ! command -v python3 >/dev/null 2>&1; then
  echo "write-incremental-marker.sh: python3 required for JSON building, not found" >&2
  exit 1
fi

marker_dir="$repo_root/.claude/.validated"
mkdir -p "$marker_dir"
marker="$marker_dir/${gate}.json"

# Hash form depends on which gate this marker is for:
#   • frontend / backend → scoped `git status --short -- <scope>/` hash,
#     because the Stop hook (stop-validation-gate.js > gateFresh) compares
#     against that exact form.
#   • audit-feature / qa → filtered code-state-hash (doc/.claude/.github carve-outs),
#     same form the Stop hook compares for those gates.
# Keeping these in sync with the Stop hook is load-bearing — a mismatch causes
# the hook to flag a freshly-written marker as stale forever.
if [ "$gate" = "frontend" ] || [ "$gate" = "backend" ]; then
  # Hash the raw `git status` stdout WITH its trailing newline — the Stop
  # hook (.claude/hooks/stop-validation-gate.js > gateFresh) captures the
  # raw execSync output (newline preserved) and sha256's it directly, so the
  # writer must match byte-for-byte. Piping git's stdout straight into shasum
  # keeps that newline; `printf '%s' "$var"` would strip it and the marker
  # would be flagged stale forever.
  state_hash="$(git -C "$repo_root" status --short -- "${gate}/" 2>/dev/null | shasum -a 256 | awk '{print $1}')"
else
  state_hash="$(bash "$repo_root/.claude/lib/code-state-hash.sh" 2>/dev/null || true)"
fi
if [ -z "$state_hash" ]; then
  echo "write-incremental-marker.sh: failed to compute state_hash" >&2
  exit 1
fi

head_sha="$(git rev-parse HEAD 2>/dev/null || true)"
full_scope="$(bash "$repo_root/.claude/lib/compute-qa-scope.sh" --mode "$mode" 2>/dev/null | sed '/^$/d')"
if [ -z "$full_scope" ]; then
  echo "write-incremental-marker.sh: warning: full_scope is empty" >&2
fi
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

FULL_SCOPE="$full_scope" \
STATE_HASH="$state_hash" \
HEAD_SHA="$head_sha" \
TS="$ts" \
CMD="$command_tail" \
MARKER="$marker" \
REPO_ROOT="$repo_root" \
SESSION_ID="$session_id" \
python3 - <<'PY'
import json, os, subprocess

repo_root = os.environ["REPO_ROOT"]
full = [l for l in os.environ.get("FULL_SCOPE", "").splitlines() if l.strip()]
validated = {}
for f in full:
    try:
        h = subprocess.check_output(
            ["git", "hash-object", "--", f],
            stderr=subprocess.DEVNULL,
            cwd=repo_root,
        ).decode().strip()
        validated[f] = h
    except subprocess.CalledProcessError:
        # Deleted file — record as null so the next run sees a mismatch and
        # re-includes it in incremental scope (agents must handle deletion).
        validated[f] = None

marker = {
    "state_hash": os.environ.get("STATE_HASH", ""),
    "ts": os.environ["TS"],
    "command": (os.environ.get("CMD", "") or "")[:200],
    "head_sha": os.environ.get("HEAD_SHA", ""),
    "written_by_session": os.environ.get("SESSION_ID", ""),
    "validated_files": validated,
}
with open(os.environ["MARKER"], "w") as fp:
    json.dump(marker, fp, indent=2)
    fp.write("\n")
PY
