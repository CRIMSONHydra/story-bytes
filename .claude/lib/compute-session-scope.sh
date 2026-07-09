#!/usr/bin/env bash
# .claude/lib/compute-session-scope.sh
#
# Prints the list of repo-relative file paths the current Claude window
# (session) has edited via Write / Edit / MultiEdit. Source of truth:
#   .claude/.session-scope/<session_id>.json   (written by record-session-touch.js)
#
# Used by /audit-feature and /qa to default their scope to "only what THIS
# window edited" — files touched by other windows or pre-existing branch
# work are not audited unless the caller explicitly widens the scope.
#
# Usage:
#   bash .claude/lib/compute-session-scope.sh                       # uses $CLAUDE_SESSION_ID
#   bash .claude/lib/compute-session-scope.sh --session <sid>       # explicit session id
#
# Side effect: deletes any session ledger whose `last_touched` is older than
# SESSION_SCOPE_TTL_DAYS (default 7). Cheap, bounded — keeps the folder small.
#
# Output: one path per line on stdout. Status / warnings on stderr.
#
# Exit code: always 0 (best-effort, never blocks a gate).

set -u

session_id="${CLAUDE_SESSION_ID:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --session)
      if [ $# -ge 2 ]; then session_id="$2"; shift 2; else shift; fi
      ;;
    --session=*) session_id="${1#--session=}"; shift ;;
    *) shift ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
scope_dir="$repo_root/.claude/.session-scope"
ttl_days="${SESSION_SCOPE_TTL_DAYS:-7}"

# Best-effort TTL sweep — never blocks the caller.
if [ -d "$scope_dir" ] && command -v python3 >/dev/null 2>&1; then
  SCOPE_DIR="$scope_dir" TTL_DAYS="$ttl_days" python3 - <<'PY' 2>/dev/null || true
import json, os, time
scope_dir = os.environ["SCOPE_DIR"]
ttl_days = int(os.environ.get("TTL_DAYS", "7"))
cutoff = time.time() - ttl_days * 86400
try:
    entries = os.listdir(scope_dir)
except FileNotFoundError:
    raise SystemExit(0)
for name in entries:
    if not name.endswith(".json"):
        continue
    path = os.path.join(scope_dir, name)
    try:
        with open(path) as fp:
            data = json.load(fp)
    except Exception:
        # Malformed — fall back to mtime check.
        try:
            if os.path.getmtime(path) < cutoff:
                os.unlink(path)
        except OSError:
            pass
        continue
    ts_str = data.get("last_touched") or data.get("started_at") or ""
    try:
        # Parse ISO-8601 with trailing Z as UTC-aware to avoid local-TZ drift.
        import datetime
        _norm = ts_str.replace("Z", "+00:00")
        ts = datetime.datetime.fromisoformat(_norm).timestamp()
    except Exception:
        ts = os.path.getmtime(path)
    if ts < cutoff:
        try:
            os.unlink(path)
        except OSError:
            pass
PY
fi

if [ -z "$session_id" ]; then
  # No session id; nothing to print.
  exit 0
fi

ledger="$scope_dir/${session_id}.json"
if [ ! -f "$ledger" ]; then
  exit 0
fi

if ! command -v python3 >/dev/null 2>&1; then
  exit 0
fi

LEDGER="$ledger" python3 - <<'PY'
import json, os, sys
try:
    with open(os.environ["LEDGER"]) as fp:
        data = json.load(fp)
except Exception:
    sys.exit(0)
files = data.get("files") or []
for f in files:
    if isinstance(f, str) and f:
        print(f)
PY
