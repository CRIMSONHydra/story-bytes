#!/usr/bin/env bash
# .claude/lib/code-state-hash.sh
#
# Prints a stable SHA-256 hash of the current "code state" — i.e. `git status
# --short` filtered to only the lines that actually represent code changes.
# Doc-only (`docs/`, `*.md`), `.claude/`-only, `.github/`-only, and a couple
# of root metadata files (.gitignore / .dockerignore) are excluded so they
# don't invalidate the audit-feature / qa markers in `.claude/.validated/`.
#
# This is the **single source of truth** for the hash used by:
#   • `.claude/hooks/stop-validation-gate.js`   (gateFresh check)
#   • The /qa and /audit-feature slash commands (when they write markers)
#   • `.claude/scripts/refresh-validation-markers.sh` (fallback writer)
#
# Keep the filter list in sync with `scopeIsDirty()` in
# `.claude/hooks/stop-validation-gate.js`.
#
# Usage:
#   bash .claude/lib/code-state-hash.sh                # hash of code state
#
# Output: a 64-char hex sha256, no newline. Empty string on failure.

set -uo pipefail

git status --short 2>/dev/null | awk '
  {
    # git status --short format: "XY path" (X = staged, Y = unstaged).
    line = $0
    # Strip the 3-char status prefix to get the path; handle rename "A -> B".
    path = substr(line, 4)
    n = split(path, parts, " -> ")
    path = parts[n]
    # Skip non-code paths. KEEP THIS LIST IN SYNC with scopeIsDirty() in
    # .claude/hooks/stop-validation-gate.js — divergence will cause the
    # Stop-hook hash to disagree with the slash-command marker hash.
    if (path ~ /^docs\//)              next
    if (path ~ /(^|\/)\.claude\//)     next
    if (path ~ /^\.github\//)          next
    # Runtime data files (demo SQLite DB + generated schema dump) are rewritten
    # by the running dev server, not by code edits — exclude so they do not
    # churn the validation hash. KEEP IN SYNC with scopeIsDirty() in
    # .claude/hooks/stop-validation-gate.js.
    if (path ~ /^backend\/data\//)     next
    if (path ~ /^scripts\//)           next
    if (path ~ /^grader\//)            next
    if (path ~ /^mcp\//)               next
    if (path ~ /^docker\//)            next
    if (path ~ /\.md$/)                next
    if (path ~ /^\.gitignore$/)        next
    if (path ~ /^\.dockerignore$/)     next
    print line
  }
' | {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | cut -d" " -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | cut -d" " -f1
  else
    echo "code-state-hash.sh: neither sha256sum nor shasum found" >&2
    exit 1
  fi
} | tr -d "\n"
