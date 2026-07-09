#!/usr/bin/env bash
# .claude/lib/compute-incremental-scope.sh
#
# Computes the file list that an incremental /audit-feature or /qa run should
# operate on: files that exist in the current branch scope AND have changed
# since the last successful gate run for the given marker.
#
# Falls back to the full branch scope when:
#   • The marker file does not exist.
#   • The marker is unreadable / malformed.
#   • The marker is old-schema (no `validated_files` field) — written by a
#     pre-incremental-scope /qa or /audit-feature run.
#
# Why this exists:
#   Previously both gates re-checked the full branch diff vs origin/main on
#   every run. After a single-file fix, /qa would still spin up Playwright
#   for every page on the branch and the audit agents would still re-read
#   every component. By snapshotting (file → git hash-object) in the marker
#   we can narrow the next run to "what actually changed since we last said
#   PASS for this gate." The Stop-hook's coarse `state_hash` check still
#   forces re-runs on any code edit; this helper just narrows that re-run.
#
# Usage:
#   bash .claude/lib/compute-incremental-scope.sh <gate-name>                  # auto (session-scope when ledger exists, else full branch)
#   bash .claude/lib/compute-incremental-scope.sh <gate-name> --mode narrow
#   bash .claude/lib/compute-incremental-scope.sh <gate-name> --mode widened
#   bash .claude/lib/compute-incremental-scope.sh <gate-name> --session-scope  # force session intersect
#   bash .claude/lib/compute-incremental-scope.sh <gate-name> --full-branch    # skip session intersect
#
#   <gate-name> is one of: audit-feature, qa
#
# Session scoping (default behaviour when neither flag is supplied):
#   /audit-feature and /qa default to "only what THIS window edited" — files
#   tracked in .claude/.session-scope/<session_id>.json (written by
#   record-session-touch.js after every Write/Edit/MultiEdit). If a ledger
#   for the current $CLAUDE_SESSION_ID exists, this helper intersects the
#   incremental scope with it; if the ledger is missing, falls back to the
#   pre-session-scope behaviour (full branch incremental). Pass --full-branch
#   to force the legacy behaviour even when a ledger exists.
#
# Output: file paths, one per line, on stdout. No status messages on stdout —
# warnings go to stderr only so the output is safe to consume in a pipeline.
#
# Exit code: always 0 (best-effort, never blocks a gate).

set -u

gate="${1:-}"
[ $# -gt 0 ] && shift
mode="narrow"
scope_kind="auto"  # auto | session | full
while [ $# -gt 0 ]; do
  case "$1" in
    --mode)
      if [ $# -ge 2 ]; then mode="$2"; shift 2; else shift; fi
      ;;
    --mode=*) mode="${1#--mode=}"; shift ;;
    --session-scope) scope_kind="session"; shift ;;
    --full-branch)   scope_kind="full";    shift ;;
    *) shift ;;
  esac
done

if [ -z "$gate" ]; then
  echo "compute-incremental-scope.sh: missing <gate-name> arg (audit-feature|qa)" >&2
  exit 0
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
marker="$repo_root/.claude/.validated/${gate}.json"

# Compute full branch scope first — every incremental result is a subset of this.
# Use a temp variable + PIPESTATUS to detect compute-qa-scope.sh failures
# independently of sed (which is last in the pipeline and almost never fails,
# so `$?` / `if !` on the whole pipeline would only reflect sed's exit code).
full_scope="$(bash "$repo_root/.claude/lib/compute-qa-scope.sh" --mode "$mode" 2>/dev/null | sed '/^$/d')"
_scope_status=("${PIPESTATUS[@]}")
if [ "${_scope_status[0]}" -ne 0 ]; then
  # compute-qa-scope.sh failed; treat as empty scope so the passthrough below
  # emits nothing and the gate falls back to full-scope behaviour.
  full_scope=""
fi

# Resolve the session ledger (may be empty if no session id / no ledger file).
session_id="${CLAUDE_SESSION_ID:-}"
session_files=""
session_ledger=""
if [ -n "$session_id" ]; then
  session_ledger="$repo_root/.claude/.session-scope/${session_id}.json"
  if [ -f "$session_ledger" ]; then
    session_files="$(bash "$repo_root/.claude/lib/compute-session-scope.sh" --session "$session_id" 2>/dev/null | sed '/^$/d')"
  fi
fi

# Decide effective scope kind. `auto` = session if a ledger exists, else full.
effective_scope_kind="$scope_kind"
if [ "$effective_scope_kind" = "auto" ]; then
  if [ -n "$session_files" ] || { [ -n "$session_ledger" ] && [ -f "$session_ledger" ]; }; then
    effective_scope_kind="session"
  else
    effective_scope_kind="full"
  fi
fi

if [ ! -f "$marker" ] || [ -z "$full_scope" ]; then
  # No marker (first run) or empty scope — passthrough, but still honour
  # session-scope intersection so a fresh window isn't blamed for unrelated
  # branch work.
  if [ "$effective_scope_kind" = "session" ]; then
    SESSION_FILES="$session_files" FULL_SCOPE="$full_scope" python3 - <<'PY' 2>/dev/null || printf '%s\n' "$full_scope"
import os
allowed = {l for l in os.environ.get("SESSION_FILES", "").splitlines() if l.strip()}
full = [l for l in os.environ.get("FULL_SCOPE", "").splitlines() if l.strip()]
for f in full:
    if f in allowed:
        print(f)
PY
  else
    printf '%s\n' "$full_scope"
  fi
  exit 0
fi

if ! command -v python3 >/dev/null 2>&1; then
  # No python3 available — fall back to full scope rather than crash the gate.
  printf '%s\n' "$full_scope"
  exit 0
fi

FULL_SCOPE="$full_scope" \
MARKER="$marker" \
REPO_ROOT="$repo_root" \
SESSION_FILES="$session_files" \
EFFECTIVE_SCOPE_KIND="$effective_scope_kind" \
python3 - <<'PY'
import json, os, subprocess, sys

marker_path = os.environ["MARKER"]
repo_root = os.environ["REPO_ROOT"]
full = [l for l in os.environ.get("FULL_SCOPE", "").splitlines() if l.strip()]
session_allowed = {l for l in os.environ.get("SESSION_FILES", "").splitlines() if l.strip()}
effective = os.environ.get("EFFECTIVE_SCOPE_KIND", "full")

def emit(paths):
    if effective == "session":
        for p in paths:
            if p in session_allowed:
                print(p)
    else:
        for p in paths:
            print(p)

try:
    with open(marker_path, "r") as fp:
        marker = json.load(fp)
except Exception:
    emit(full); sys.exit(0)

validated = marker.get("validated_files")
if not isinstance(validated, dict):
    # Old-schema marker — no per-file map. Fall back to full scope.
    emit(full); sys.exit(0)

deltas = []
for f in full:
    try:
        cur = subprocess.check_output(
            ["git", "hash-object", "--", f],
            stderr=subprocess.DEVNULL,
            cwd=repo_root,
        ).decode().strip()
    except subprocess.CalledProcessError:
        cur = None
    # `cur is None` means the file doesn't exist on disk. If the marker recorded
    # None for this path too, the file was already deleted at marker time — no
    # change since. Anything else is a delta.
    if validated.get(f, "__missing__") != cur:
        deltas.append(f)

emit(deltas)
PY
