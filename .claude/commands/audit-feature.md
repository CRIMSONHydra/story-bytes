---
description: Run a parallel multi-agent audit of the current branch diff against main. Spawns reuse-scout, schema-guard, query-perf-reviewer, swr-invalidation-checker, and ui-fidelity-checker on the changed files and consolidates findings into a single checklist. This is the official "before declaring done" gate.
---

You are about to run the **/audit-feature** workflow. Follow these steps exactly.

## Step 0 — Acquire the cross-window concurrency lock

Multiple Claude windows can be open against the same repo. The audit fanout spawns 5 sub-agents in parallel — running it twice in parallel from two windows costs 10x tokens for no extra signal. Acquire a session-identified lock before spawning anything:

```bash
SID="${CLAUDE_SESSION_ID:-$$}"
LOCK_STATUS=$(bash .claude/lib/session-lock.sh status audit-feature)
if ! bash .claude/lib/session-lock.sh acquire audit-feature "$SID" --note "fanout" 2>&1; then
  echo "→ Another Claude window is already running /audit-feature (${LOCK_STATUS}). Deferring this run."
  echo "  When the other window finishes, its marker will be fresh — your next Stop will treat this gate as clean."
  exit 0
fi
trap 'bash .claude/lib/session-lock.sh release audit-feature "$SID"' EXIT
```

The lock has a 15-minute TTL — if the holding window crashed, the lock auto-expires and the next acquire steals it. Pass `$SID` through to the marker writer in Step 5 (`--session "$SID"`) so the Stop hook can apply the 60-second permissive downgrade to other windows.

If acquire fails, **do NOT** spawn any sub-agent and do NOT print any other content — just the deferral note above. The other window's clean marker will satisfy this session's Stop hook automatically.

## Step 1 — Identify scope

### Step 1.a — Compute the scope (session-scoped by default)

```bash
SESSION_SCOPE=$(bash .claude/lib/compute-session-scope.sh)                     # files THIS window edited
FULL_BRANCH_FILES=$(bash .claude/lib/compute-qa-scope.sh)                      # full branch diff (for context)

# Did the user (or the main agent) ask for a full-branch audit?
WIDEN=0
case "${ARGUMENTS:-}" in
  *full[-_\ ]branch*|*branch[-_\ ]wide*|*all[-_\ ]files*|*audit[-_\ ]everything*|*whole[-_\ ]branch*) WIDEN=1 ;;
esac

if [ "$WIDEN" -eq 1 ]; then
  SCOPE_FILES=$(bash .claude/lib/compute-incremental-scope.sh audit-feature --full-branch)
  SCOPE_LABEL="full-branch (user requested)"
  SCOPE_MODE="full-branch"
else
  SCOPE_FILES=$(bash .claude/lib/compute-incremental-scope.sh audit-feature --session-scope)
  SCOPE_LABEL="session-scoped (this window)"
  SCOPE_MODE="session"
fi

git status --short
```

By default `/audit-feature` audits **only the files this Claude window has edited in the current session** — the per-session ledger written by [`.claude/hooks/record-session-touch.js`](../hooks/record-session-touch.js) after every successful `Write` / `Edit` / `MultiEdit`. Files touched by other windows, or pre-existing branch work the user did not author in this window, are **not** audited unless the run is widened (see Step 1.a.bis).

`compute-incremental-scope.sh audit-feature --session-scope` returns the intersection of (a) the branch diff vs `origin/main`, (b) files whose `git hash-object` differs from the snapshot in `.claude/.validated/audit-feature.json`, and (c) the current window's session ledger. `--full-branch` skips intersection (c). The helper falls back to the branch-wide incremental scope when the session ledger is missing — but the auto-detect in this block keeps the labeling honest.

The full-branch helper compares against `origin/main` (not local `main`), best-effort `git fetch`s first, and matches GitHub's PR-diff view. **Do not** call `git diff main...HEAD` directly — local `main` may be stale and over-report scope. See [`~/.claude/plans/when-we-merge-main-hidden-liskov.md`](../../.claude/plans/when-we-merge-main-hidden-liskov.md) for the rationale.

**If `$SCOPE_FILES` is empty AND `$FULL_BRANCH_FILES` is non-empty**, the previous audit marker is still valid for every file in scope. Say:

> No code changes in this window since the last clean `/audit-feature` (marker still valid for N branch files; session ledger has K files all already audited). Re-stamping marker timestamp and exiting.

…then jump straight to Step 5 to refresh the marker's `ts` and stop. Do NOT spawn agents.

### Step 1.a.bis — Main-agent decision point (empty session ledger, dirty branch)

If `$SESSION_SCOPE` is empty AND `$FULL_BRANCH_FILES` is non-empty AND `$WIDEN` is 0, the window has not edited anything but the branch is dirty from prior work. **Default: do not flag unrelated files.** Announce:

> No files edited in this window; skipping audit of the N pre-existing branch files (unrelated to this session). Refreshing marker timestamp.

…then jump to Step 5 to refresh the marker and stop.

**Override (main-agent judgement, on the same turn).** Re-run with `--full-branch` if any of:

- The user's request explicitly references a broader review ("audit the branch", "review everything", "before merging").
- The change is cross-cutting in nature (shared-atom edit, schema change with unaudited downstream consumers, a recent `Merge branch 'main'` whose interleaving needs verification).
- A prior turn's findings made the agent flag remaining branch state as a known concern.

When the agent overrides, announce the widening explicitly: *"Widening to full-branch audit because <reason>."*

### Step 1.b — Detect a recent main-merge → widened-scope prompt

```bash
RECENT_MERGE=$(git log origin/main..HEAD --merges --first-parent \
                 --grep="Merge branch 'main'" --format=%H -n 1)
```

- **`$RECENT_MERGE` empty** → proceed with `narrow`. No prompt.
- **`$RECENT_MERGE` non-empty** → `AskUserQuestion` ONCE with two options:
  - **Narrow** (default if merge is >24 h old) — branch-authored only, matches PR diff.
  - **Widened** (default if merge is ≤24 h old) — also includes files brought in by the merge; surfaces post-merge compatibility / migration interleaving / shared-atom drift. Use `bash .claude/lib/compute-incremental-scope.sh audit-feature --mode widened` for the incremental scope and pass `--mode widened` to the marker writer in Step 5.

  Pass the chosen mode through to each spawned subagent in Step 2.

### Step 1.c — Partition the (incremental) scope

Build two file lists from `$SCOPE_FILES` (incremental — already narrowed in Step 1.a):
- `FRONTEND_FILES` = lines starting with `frontend/`
- `BACKEND_FILES` = lines starting with `backend/`

If both lists are empty but `$FULL_BRANCH_FILES` is also empty, say "No changes vs origin/main — nothing to audit" and stop. (The empty-incremental-but-non-empty-full case is already handled in Step 1.a's early-exit.)

## Step 2 — Spawn audit agents in parallel (incremental-scope-gated)

When you spawn the subagents below, tell each one the scope mode (`$SCOPE_LABEL` — `session-scoped (this window)` or `full-branch (user requested)`) so its findings can be tagged. Findings on files **outside** the announced scope must NOT be raised unless the agent is explicitly running in `full-branch` mode.

Compute scope sizes to decide which agents are worth spawning:

```bash
FE_COUNT=$(printf '%s\n' "$FRONTEND_FILES" | sed '/^$/d' | wc -l)
BE_COUNT=$(printf '%s\n' "$BACKEND_FILES" | sed '/^$/d' | wc -l)
```

Spawn the agents below in parallel via the Agent tool, but skip any whose scope is empty OR whose triggers don't fire. **Small incremental scopes (≤3 files on one side) intentionally spawn the minimum subset — spawning all 5 on a typo fix burns tokens for zero signal.**

1. **reuse-scout** — spawn whenever a new file was added in the diff (`git diff --name-only --diff-filter=A`). Prompt: "Audit new files in `<list of new files only>`. For each, check whether an existing implementation already covers it. Return REUSE / EXTEND / NO MATCH OK per file."

2. **schema-guard** — only spawn if `BACKEND_FILES` includes anything under `backend/app/models/` or `backend/alembic/versions/`. Prompt: "Audit new models/migrations in `<list>`. For each, check `docs/SCHEMA_REUSE.md` and the existing models — could this use an existing table or column instead? Remember the schema mirrors the Visio JS API + ShapeSheet sections — most 'new tables' are actually rows of an existing entity."

3. **query-perf-reviewer** — only spawn if `BACKEND_FILES` is non-empty AND includes a file under `backend/app/services/` or `backend/app/api/` (model-only diffs don't need a query audit). Prompt: "Review backend changes in `<list>`. Calibrate per the agent's RL context banner: flag N+1 on growing-table cascades, missing eager loading on document→pages→shapes→shape_data_items, missing indexes on growing tables, and blocking I/O in async. DO NOT flag pagination on bounded catalog tables, missing caching on once-per-session reads, or composite-index gaps on the single-user document list."

4. **swr-invalidation-checker** — only spawn if `FRONTEND_FILES` includes any file containing `mutationFetcher`. Prompt: "Audit SWR cache invalidation in `<list>`. Every `mutationFetcher` call must be followed by the correct `mutate(...)`. Watch for tab-specific list keys (DIAGRAM_ENDPOINTS.list('all'|'recent'|'shared'|'favourites')) where one mutation affects multiple tabs."

5. **ui-fidelity-checker** — only spawn if `FRONTEND_FILES` is non-empty. Prompt: "Audit frontend changes in `<list>` for hardcoded data, inline SVGs (must move to components/icons), raw `<img>` (must be `next/image`), and convention bypass (direct fetch, inline /api/ strings, inline static styles where a CSS Module class should be, hardcoded hexes that should be `var(--token)`, stray Tailwind utility classes). Skip memoization findings — perf at the rendering layer is not a real RL risk."

## Step 2.5 — Status block while agents run

The 5 subagents stay **foreground** (this command's orchestration needs the consolidated report and waits for all of them), but they're long-running by definition. Per the *Long-Running Processes* protocol in `CLAUDE.md`:

- Record each spawned agent's `agent_id` in the in-flight registry as it returns from the parallel Agent call batch.
- If any user-visible response is emitted during the wait window (rare — typically only on retries or partial timeouts), it must include the `## In-flight` block listing each subagent with its kind, started, elapsed, latest activity (via `TaskOutput`), and 🟢 running / ✅ done / 🔴 errored status.
- Once all 5 return, remove their entries from the registry and proceed to Step 3.

## Step 3 — Consolidate findings

Once all agents return, produce a single report in this shape:

```text
# /audit-feature report — branch `<branch>` vs `main`

## Summary
- Files audited: N frontend, M backend
- Total findings: X (HIGH: a, MEDIUM: b, ADVISORY: c)

## Findings by category

### Reuse opportunities
<reuse-scout findings>

### Schema reuse
<schema-guard findings>

### Query performance
<query-perf-reviewer findings>

### SWR cache invalidation
<swr-invalidation-checker findings>

### UI fidelity
<ui-fidelity-checker findings>

## Next steps
- [ ] Fix every HIGH finding (production hazard)
- [ ] Decide on each MEDIUM finding
- [ ] Re-run /audit-feature once fixes are in
```

## Step 4 — Handoff per the project-wide protocol

Pass the consolidated report through the **CLAUDE.md > Subagent Verdict Handoff (MANDATORY)** protocol. **Do not stop the turn with un-actioned items.** Specifically:

- **HIGH findings** → `CONFIRM each`. Surface every HIGH finding via `AskUserQuestion` with options `Apply this fix`, `Skip (record as known)`, `Custom`. Apply chosen fixes in the same turn.
- **MEDIUM findings** → `CONFIRM batched`. One multi-question with a sub-question per finding.
- **ADVISORY findings** → `ADVISORY`. Surface in the response. No question, no edit.

After the user's decisions land, apply chosen fixes inline (or delegate to the relevant agent — e.g. a CONFIRMED reuse-scout EXTEND verdict goes back to the main-agent edit loop).

## Step 5 — Write the audit-feature marker (incremental schema)

If every spawned agent returned cleanly (no `🔴 errored` rows in the consolidated report) — OR if Step 1.a's early-exit fired (no incremental files since last clean audit) — OR if Step 1.a.bis's empty-session early-exit fired — refresh `.claude/.validated/audit-feature.json` via the shared marker writer.

Note: the marker writer always snapshots the **full** branch into `validated_files`, regardless of whether this run was session-scoped or full-branch. Session-scoping narrows what is *audited*, not what is recorded as the post-run baseline — that way a later widened run can still tell which branch files have shifted since.

```bash
bash .claude/lib/write-incremental-marker.sh audit-feature \
  "audit-feature (<short-note — e.g. 'all HIGH/MEDIUM findings addressed' OR 'no incremental files; marker refreshed'>)" \
  --mode "${SCOPE_MODE:-session}" \
  --session "${CLAUDE_SESSION_ID:-$$}"
```

The `--session` flag persists `written_by_session` into the marker so other Claude windows on the same branch see "this gate was just written by sess-X" and avoid duplicate re-runs (see *Multi-window concurrency* in `CLAUDE.md`).

The writer records (full schema in [`.claude/lib/write-incremental-marker.sh`](../lib/write-incremental-marker.sh)):
- `state_hash` — sha256 of the filtered `git status --short` (single source of truth via [`.claude/lib/code-state-hash.sh`](../lib/code-state-hash.sh)). The Stop hook uses this for the coarse "any code edits since this gate?" check.
- `ts`, `command` — timestamp + audit-trail note.
- `head_sha` — `git rev-parse HEAD` at write time.
- `validated_files` — map of `<path> → git hash-object` for every file in the **full** branch scope at write time. The next `/audit-feature` run reads this map and emits only files whose content hash has changed (via `compute-incremental-scope.sh`).

> The writer resolves the marker dir from `git rev-parse --show-toplevel`, so a previous `cd frontend/` or `cd backend/` in the same Bash invocation can't silently drop the marker into a nested `.claude/...` (a footgun we already had to clean up).

(The Stop hook compares this marker's `state_hash` against a fresh hash at session end — any code edit after this point still forces a re-run, but the re-run scopes incrementally rather than re-auditing every file on the branch.)

## Important

- Run agents in **parallel** (single message, multiple `Agent` calls).
- Skip agents whose scope is empty — don't burn tokens on no-op runs.
- Do NOT call `pnpm type-check` / `mypy` here — those are separate verification steps. This audit is about higher-level patterns.
- If any agent times out or fails, surface that in the report — don't pretend the audit was complete.
