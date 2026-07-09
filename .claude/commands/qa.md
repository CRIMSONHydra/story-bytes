---
description: Run end-to-end functional QA on the current feature before declaring it done. Delegates to the qa-engineer agent, which exercises every endpoint touched in the diff (CRUD + error paths + OpenAPI docs), verifies frontend↔backend type contracts, drives the affected routes via the Playwright MCP (golden path + edge cases + console errors), runs a regression sweep across the primary routes, and reports BLOCKER / WARNING / PASS. This is functional verification, NOT static analysis (use /audit-feature for the static pass first).
---

You are about to run the **/qa** workflow. This is the LAST gate before a feature is declared shippable.

## Step 0 — Acquire the cross-window concurrency lock

`/qa` drives the Playwright MCP — a single-instance browser resource. Two windows running `/qa` simultaneously will fight for the browser, race on test fixtures (created-then-deleted diagrams), and emit overlapping curl traffic. Acquire a session lock before spawning the qa-engineer agent:

```bash
SID="${CLAUDE_SESSION_ID:-$$}"
LOCK_STATUS=$(bash .claude/lib/session-lock.sh status qa)
if ! bash .claude/lib/session-lock.sh acquire qa "$SID" --note "qa-engineer" 2>&1; then
  echo "→ Another Claude window is already running /qa (${LOCK_STATUS}). Deferring this run."
  echo "  When the other window finishes, its marker will be fresh — your next Stop will treat this gate as clean."
  exit 0
fi
trap 'bash .claude/lib/session-lock.sh release qa "$SID"' EXIT
```

The lock has a 30-minute TTL (Playwright + dev-server bringup is slow). If the holding window crashed, the next acquire auto-steals after the TTL.

If acquire fails, **do NOT** spawn qa-engineer and do NOT proceed to the steps below — just print the deferral note.

## When to run /qa (main-agent discretion)

`/qa` is now advisory in the Stop hook — the main agent decides when running it is worth the cost. Use this guideline:

**Run `/qa`** for feature-scale changes:
- New route (`frontend/app/<slug>/page.tsx` added) or new view (`frontend/views/<Name>View/`).
- New endpoint cluster (a new router or new endpoints on an existing router).
- New component family (a new `frontend/components/<feature>/` folder).
- Schema-touching change (new model, new migration, new column on a reusable model).
- Any change that touches more than 5 files under `frontend/views/` or `backend/app/api/`.

**Skip `/qa`** for small fixes:
- Single-file CSS-Module tweak.
- Single-line logic fix or typo / copy edit.
- Doc-only edit.
- Isolated bug fix on a route that doesn't share state with other routes.

If you skip `/qa`, the `qa.json` marker stays stale and the Stop hook will surface a one-line warning — that's expected; acknowledge it once and proceed.

## Step 1 — Capture intent

`$ARGUMENTS` is one of:

- **A short feature description** (e.g. `/qa diagram favouriting on the Start page`) — pass through to the agent verbatim.
- **A specific focus** like a route or endpoint (`/qa POST /api/diagrams`, `/qa /edit/1`) — pass through, agent will widen scope to the full diff anyway.
- **Empty** — agent will derive scope from the shared scope helper (see Step 2) and ask one clarifying question.

## Step 2 — Pre-flight probes

### Step 2.a — Scope baseline (session-scoped by default)

```bash
SESSION_SCOPE=$(bash .claude/lib/compute-session-scope.sh)                     # files THIS window edited
FULL_BRANCH_FILES=$(bash .claude/lib/compute-qa-scope.sh)                      # full branch (for context)
FULL_COUNT=$(printf "%s\n" "$FULL_BRANCH_FILES" | sed '/^$/d' | wc -l)

# Did the user (or the main agent) ask for a full-branch QA?
WIDEN=0
case "${ARGUMENTS:-}" in
  *full[-_\ ]branch*|*branch[-_\ ]wide*|*all[-_\ ]files*|*audit[-_\ ]everything*|*whole[-_\ ]branch*) WIDEN=1 ;;
esac

if [ "$WIDEN" -eq 1 ]; then
  SCOPE_FILES=$(bash .claude/lib/compute-incremental-scope.sh qa --full-branch)
  QA_SCOPE_MODE="full-branch"
else
  SCOPE_FILES=$(bash .claude/lib/compute-incremental-scope.sh qa --session-scope)
  QA_SCOPE_MODE="session"
fi
SCOPE_COUNT=$(printf "%s\n" "$SCOPE_FILES" | sed '/^$/d' | wc -l)
```

By default `/qa` exercises **only the routes / endpoints implicated by files this window edited in the current session** — the ledger written by [`.claude/hooks/record-session-touch.js`](../hooks/record-session-touch.js). Files touched by other windows, or pre-existing branch work the user did not author here, are NOT re-tested unless the run is widened. The regression sweep in Step 5 of [`qa-engineer.md`](../agents/qa-engineer.md) still covers the primary routes (`/`, `/recent`, `/shared`, `/favourites`, `/templates`, `/edit/<id>`) regardless of scope — that's the safety net for "didn't I just break something unrelated."

The full-branch helper compares against `origin/main` (not local `main`), best-effort `git fetch`s first, and matches GitHub's PR-diff view byte-for-byte. **Do not** call `git diff main...HEAD` directly — local `main` may be stale and over-report scope. See [`~/.claude/plans/when-we-merge-main-hidden-liskov.md`](../../.claude/plans/when-we-merge-main-hidden-liskov.md) for why.

**If `$SCOPE_COUNT` is 0 AND `$FULL_COUNT` is non-zero**, the previous `/qa` marker is still valid for everything this window touched. Say:

> No code changes in this window since the last clean `/qa` run (marker still valid for $FULL_COUNT branch files). Refreshing marker timestamp and reporting ✅ READY TO SHIP.

…then skip Step 4 entirely and jump to Step 5's "READY TO SHIP" path to refresh the marker.

### Step 2.a.bis — Main-agent decision point (empty session ledger, dirty branch)

If `$SESSION_SCOPE` is empty AND `$FULL_COUNT` is non-zero AND `$WIDEN` is 0, the window has not edited anything but the branch is dirty from prior work. **Default: do not re-QA unrelated files.** Announce:

> No files edited in this window; skipping QA of the $FULL_COUNT pre-existing branch files (unrelated to this session). Refreshing marker timestamp and reporting ✅ READY TO SHIP.

…then jump to Step 5's "READY TO SHIP" path.

**Override (main-agent judgement, on the same turn).** Re-run with `--full-branch` if the user explicitly asked for a branch-wide QA, OR if the main agent judges the change is cross-cutting (shared-atom edit, schema change with unaudited downstream consumers, post-`Merge branch 'main'`). Announce the widening explicitly: *"Widening to full-branch QA because <reason>."*

### Step 2.b — Detect a recent main-merge → widened-scope prompt

```bash
RECENT_MERGE=$(git log origin/main..HEAD --merges --first-parent \
                 --grep="Merge branch 'main'" --format=%H -n 1)
```

- **`$RECENT_MERGE` empty** → proceed with `narrow` scope. No prompt.
- **`$RECENT_MERGE` non-empty** → `AskUserQuestion` ONCE with two options:
  - **Narrow** (default if merge is >24 h old) — branch-authored files only, fast, matches PR diff. `bash .claude/lib/compute-incremental-scope.sh qa --mode narrow`.
  - **Widened** (default if merge is ≤24 h old — likely fresh integration) — also includes files brought in by the merge, surfaces post-merge compatibility / migration-interleaving / shared-atom-drift bugs. `bash .claude/lib/compute-incremental-scope.sh qa --mode widened`.

  Pass the chosen mode through to `qa-engineer` in the Step 4 prompt as `--scope-mode narrow` or `--scope-mode widened`, and pass the same `--mode` to the marker writer in Step 5.

### Step 2.c — Server health probe (informational only — DO NOT abort)

```bash
# Just a quick visibility check — the qa-engineer agent's Step 0 will do the real bringup.
curl -s -o /dev/null -w "frontend=%{http_code} " http://localhost:3000
curl -s -o /dev/null -w "backend=%{http_code}\n"  http://localhost:8000/api/health
```

If either is not 200/3xx, **do NOT stop**. Inform the user once:

> Dev servers aren't running — `qa-engineer` will auto-spawn them via `./run.sh --dev` (Step 0.b) and proceed once both health endpoints return 200. This adds ~10–30 s of warm-up time; the QA report will note it.

…then continue to Step 3. The auto-bringup is part of the qa-engineer agent's workflow (see [`.claude/agents/qa-engineer.md`](../agents/qa-engineer.md) Step 0.b) and follows the *Long-Running Processes* protocol — the spawned bash is backgrounded and surfaced in the `## In-flight` block.

## Step 3 — (Optional) Static pass first

If `$SCOPE_COUNT` is non-trivial AND the user has NOT already run `/audit-feature` in this session, suggest it:

> Heads up: you haven't run `/audit-feature` for the current diff yet. The static pass catches different issues (reuse, N+1, hardcoded data) than `/qa` does (functional behavior). Want me to run `/audit-feature` first, or proceed straight to `/qa`?

If the user says proceed, continue. If they want the static pass first, run `/audit-feature` and surface its report before continuing.

## Step 4 — Delegate to qa-engineer (backgrounded)

Spawn the `qa-engineer` agent with **`run_in_background: true`** and this prompt:

> "Run end-to-end functional QA on the current branch.
>
> Feature description: `<from $ARGUMENTS or 'inferred from diff'>`
>
> Scope mode: `$QA_SCOPE_MODE` (one of `session` — only files THIS window edited in the current session; or `full-branch` — every changed file on the branch). When `session`, drive Playwright only on routes derived from `$SESSION_SCOPE`; when `full-branch`, walk every changed view. Use `bash .claude/lib/compute-incremental-scope.sh qa --session-scope` (or `--full-branch`) and `bash .claude/lib/compute-session-scope.sh` to read the ledger. The regression sweep in your Step 5 still covers the primary routes regardless of scope — that is the safety net for cross-route regressions you can't see from the diff.
>
> Follow your full workflow: Step 0 (auto-bring-up dev servers if missing — never abort, follow Step 0.b's backgrounded `./run.sh --dev` + 90 s health-poll path), Step 1 (scope — use the incremental helper output), Step 2 (backend functional QA — full CRUD lifecycle + error paths + OpenAPI docs), Step 3 (frontend↔backend type contracts), Step 4 (frontend functional QA via Playwright MCP — golden path + empty/loading/error edge cases + console errors), Step 5 (regression sweep across /, /recent, /shared, /favourites, /templates, /edit/<id>), Step 6 (verify type-check + lint + mypy + ruff), Step 7 (strict-format report with BLOCKER / WARNING / PASS + final verdict).
>
> Do NOT write or modify code. Do NOT commit. Re-run-safe: clean up any test fixtures you create via the API. Log meaningful one-line progress markers so the main agent can surface your latest activity via `TaskOutput` in its `## In-flight` block."

Record the returned `agent_id` in the in-flight registry. The main agent stays free to handle other user requests while QA runs.

## Step 5 — Handoff per the project-wide protocol

Pass the qa-engineer's report through **CLAUDE.md > Subagent Verdict Handoff (MANDATORY)**. **Do not stop the turn with un-actioned blockers.**

If **❌ NOT READY TO SHIP**:
- Every BLOCKER → `CONFIRM` (per blocker). Surface each via `AskUserQuestion` with options `Fix now`, `Defer (record as known issue)`, `Custom`.
- Every WARNING → `CONFIRM` (batched). One multi-question with a sub-question per warning.
- Apply chosen `Fix now` items in the same turn. After the fixes land, **re-run `/qa`** in the same turn — the gate is not satisfied until qa-engineer returns READY TO SHIP.
- Coverage gaps → `ADVISORY`. Surface for the user's awareness.

If **✅ READY TO SHIP** (or the Step 2.a early-exit fired with no incremental files):
- Verdict is `AUTO-EXECUTE`. The main agent declares the feature functionally complete.
- Write the qa marker via the shared writer:
  ```bash
  bash .claude/lib/write-incremental-marker.sh qa \
    "qa (<short-note — e.g. 'READY TO SHIP, 0 blockers' OR 'no incremental files; marker refreshed'>)" \
    --mode "${QA_SCOPE_MODE:-session}" \
    --session "${CLAUDE_SESSION_ID:-$$}"
  ```

  The `--session` flag persists `written_by_session` into the marker so other Claude windows see "qa was just written by sess-X" and skip a duplicate run (see *Multi-window concurrency* in `CLAUDE.md`).

  The writer records `state_hash` + `ts` + `command` + `head_sha` + `validated_files` (a `<path> → git hash-object` map for every file in the **full** branch scope). The next `/qa` run reads this map via `compute-incremental-scope.sh` and only re-tests files whose content hash has changed. Schema lives in [`.claude/lib/write-incremental-marker.sh`](../lib/write-incremental-marker.sh). The writer resolves the marker dir from `git rev-parse --show-toplevel`, so a previous `cd frontend/` or `cd backend/` in the same Bash invocation can't drop the marker into a nested `.claude/...` path.
- Remind the user that committing and pushing are still their call (per CLAUDE.md's no-auto-commit rule).

## Important

- **Functional, not stylistic.** `/qa` cares whether the feature WORKS. Naming nitpicks and dead-code removal belong in `/audit-feature` or code review.
- **The agent will use the Playwright MCP.** If the MCP isn't connected (no `mcp__playwright__*` tools available), the agent's report will say so under "Coverage gaps." That's still a useful run — just not a complete one.
- **Do NOT commit.** Even on green, the user commits themselves (per `CLAUDE.md` Git Workflow rule).
- **Re-run safe.** `/qa` is designed to be run repeatedly during the fix → verify cycle.
