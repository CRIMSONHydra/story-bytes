---
description: Carefully resolve Git merge conflicts in the working tree. Delegates to the merge-conflict-resolver agent, which detects intentional branch deviations (feature flags, A/B variants, disabled features) and ALWAYS asks the user before overwriting them. Also runs an Alembic chain check when backend/ was touched (dual-head state is a silent post-merge bug that Git does not flag).
---

You are about to run the **/resolve-conflicts** workflow.

## Step 1 — Probe what needs resolving

Two distinct post-merge problems can exist; check both:

```bash
# (a) Git-level conflicts in the working tree
git diff --name-only --diff-filter=U

# (b) Alembic dual-head state — silent, NOT raised as a Git conflict, but breaks `pnpm migrate`
(cd backend && uv run alembic heads | wc -l)
```

`--diff-filter=U` captures every unmerged path regardless of conflict combo (`UU`, `AU`, `UA`, `DU`, `UD`, `AA`, `DD`).

**Decide whether to proceed:**
- If (a) has output OR (b) prints >1 → proceed to Step 2.
- If (a) is empty AND (b) prints exactly 1 → say "No merge conflicts and Alembic chain is single-head — nothing to resolve" and stop.

## Step 2 — Delegate to merge-conflict-resolver

Spawn the `merge-conflict-resolver` agent with this prompt:

> "Resolve all merge conflicts currently in the working tree. Follow the agent's full workflow: map conflicts, detect branch-intent flags, categorize each hunk, present the plan, ask the user about FLAGGED items via AskUserQuestion, then apply resolutions. Do NOT auto-resolve any FLAGGED item without explicit user approval. Run type-check on touched files after resolving. Finally run Step 7 (Alembic chain check) unconditionally if anything under backend/ was touched on this branch — re-parent any dual-head migration linearly per project rules; never create a merge revision."

## Step 3 — Surface the agent's report

Pass the agent's final summary back verbatim. Do not paraphrase — the user needs to see the exact decisions taken.

## Step 4 — Do NOT commit

Even after resolution, do NOT run `git commit`. The user will inspect and commit themselves (per the project's "no auto-commit" rule in CLAUDE.md).

## Important

- Trust the agent. Don't second-guess its FLAGGED categorization — the agent's whole job is to preserve branch intent.
- If the agent asks the user a question via AskUserQuestion, wait for the answer and pass it back so the agent can continue.
