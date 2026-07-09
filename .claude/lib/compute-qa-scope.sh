#!/usr/bin/env bash
# .claude/lib/compute-qa-scope.sh
# Shared scope-computation helper for /qa, /audit-feature, qa-engineer,
# query-perf-reviewer's standalone-diff fallback, and any future gate-runner
# that needs "what files changed on this branch vs main."
#
# Why this exists:
#   - Every gate-runner used to invoke `git diff --name-only main...HEAD`.
#   - Three-dot is correct math (merge-base-aware) BUT it computes against the
#     LOCAL `main` ref. GitHub's PR view computes against `origin/main`. When
#     local `main` is behind `origin/main`, every commit on origin/main that
#     was merged into the branch appears as "branch-only" — falsely inflating
#     the scope. This helper uses `origin/main` so the scope matches GitHub.
#   - Optional `widened` mode adds files brought in by the most recent
#     `Merge branch 'main'` commit (the hidden-Liskov flow described in
#     ~/.claude/plans/when-we-merge-main-hidden-liskov.md).
#
# Usage:
#   bash .claude/lib/compute-qa-scope.sh                         # narrow (default)
#   bash .claude/lib/compute-qa-scope.sh --mode narrow           # explicit narrow
#   bash .claude/lib/compute-qa-scope.sh --mode widened          # post-merge widened
#
# Output: file paths, one per line, on stdout. No status messages on stdout —
# warnings go to stderr only so the output is safe to consume in a pipeline.

set -u

mode="narrow"
while [ $# -gt 0 ]; do
  case "$1" in
    --mode)
      if [ $# -ge 2 ]; then
        mode="$2"
        shift 2
      else
        mode="narrow"
        shift
      fi
      ;;
    --mode=*) mode="${1#--mode=}"; shift ;;
    *) shift ;;
  esac
done

# Best-effort refresh so origin/main matches what GitHub serves.
# Never blocks the gate: a failed fetch (offline, missing remote, auth) is
# silently tolerated and we use whatever origin/main ref is currently cached.
git fetch --quiet origin main 2>/dev/null || true

narrow() {
  git diff --name-only origin/main...HEAD
}

widened() {
  # Find the most recent merge of main onto this branch.
  local merge
  merge=$(git log origin/main..HEAD --merges --first-parent \
            --grep="Merge branch 'main'" --format=%H -n 1 2>/dev/null)
  if [ -z "$merge" ]; then
    # No main-merge present — widened is equivalent to narrow.
    narrow
    return
  fi
  # The merge commit has two parents:
  #   ^1 = branch tip just before the merge
  #   ^2 = main tip at merge time
  # Their merge-base = the last commit shared by branch and main before merging.
  # Diffing from that pre-merge-base to HEAD captures branch work AND the
  # files main brought in via this merge.
  local pre
  pre=$(git merge-base "${merge}^1" "${merge}^2" 2>/dev/null)
  if [ -z "$pre" ]; then
    narrow
    return
  fi
  git diff --name-only "${pre}..HEAD"
}

case "$mode" in
  widened) widened ;;
  narrow|*) narrow ;;
esac
