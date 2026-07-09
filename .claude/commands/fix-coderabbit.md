---
description: Apply CodeRabbit (or other automated reviewer) suggestions on the current branch's PR. Accepts a PR number to fetch comments via `gh`, or accepts pasted comments inline. Delegates to the coderabbit-fixer agent, which applies SAFE fixes automatically, surfaces STRUCTURAL ones for user decision, and ALWAYS asks before touching branch-intent regions (feature flags, A/B variants).
---

You are about to run the **/fix-coderabbit** workflow.

## Step 1 — Determine input mode

`$ARGUMENTS` is one of:

- **A PR number** (e.g., `123` or `#123`) — Mode B: fetch comments.
- **Pasted comment text** (multi-line markdown/JSON starting with `CodeRabbit said:` or similar) — Mode A: use directly.
- **Empty** — Ask the user once: "Paste the CodeRabbit comments or give me a PR number." Wait for response.

## Step 2 — Group by target file, dispatch in parallel (backgrounded)

> **Scope baseline note:** this dispatcher takes its scope from CR's PR-diff (GitHub-side, against `origin/main`) — NOT from a local `git diff`. It is unaffected by the local-baseline scoping policy in [`qa.md`](qa.md) / [`audit-feature.md`](audit-feature.md). See [`~/.claude/plans/when-we-merge-main-hidden-liskov.md`](../../.claude/plans/when-we-merge-main-hidden-liskov.md) for the full picture.

### Step 2.0 — Mode B: pull both layers of CR comments

CR posts comments in **two** GitHub locations, and the dispatcher must pull both or it will silently drop fixable items:

1. **Inline review threads** — anchored to specific file/line in the diff. Pulled via the GraphQL `reviewThreads` query (filter `isResolved=false && isOutdated=false`). These carry a `databaseId` and are repliable.
2. **Review summary bodies** — the cover-letter posted with each `CHANGES_REQUESTED` review (`GET /repos/<owner>/<repo>/pulls/<n>/reviews`, then read `.body` of each review submitted by `coderabbitai[bot]` with `state == "CHANGES_REQUESTED"`). Two sections inside the body need parsing:
   - **`<details><summary>⚠️ Outside diff range comments (N)</summary>`** — comments on lines that aren't in the diff hunk (often Major-severity findings GitHub can't post inline). Format: `<details><summary>path/to/file.ext (N)</summary>` ➜ ``` `line-range`: <severity> ``` ➜ body.
   - **`<details><summary>🧹 Nitpick comments (N)</summary>`** — CR's lower-confidence band. Same nested format.

Each item in either section has a parseable `{file, lineRange, severity, body}` record. These items **do NOT have a `comment_databaseId`** — they live inside the review body, not as standalone PR comments — so they get dispatched in Mode A style (no reply-posting).

Drip-fed exception: a `Duplicate comments (N)` section repeats already-posted inline threads — skip it (the inline thread is the canonical surface).

### Step 2.1 — Parse and group

Parse `$ARGUMENTS` (or, in Mode B, the union of inline-thread comments + parsed review-body sections) into individual `{file, line, suggestion, comment_databaseId?}` records. **Group by `file`**. For each distinct target file:

- **No in-flight `coderabbit-fixer` for that file** → spawn a new `coderabbit-fixer` instance with `run_in_background: true`. Add an entry to the in-flight CR-fixer registry (`target_file → agent_id`).
- **An in-flight fixer already owns that file** → forward this comment to that instance via `SendMessage` with the comment text. The receiving fixer accepts it per its "Concurrency model" (see `.claude/agents/coderabbit-fixer.md`).

Use parallel Agent calls in a single message when spawning multiple new fixers for different files — they execute concurrently. **Each `Agent(... run_in_background: true)` call MUST be paired in the same parallel batch with a `Bash("bash .claude/scripts/agent-progress-monitor.sh <output_file>", run_in_background: true)` so the user gets live progress as the fixer works.** N fixers → 2 N tool calls in the same message (N Agent + N Bash-monitor). This is non-optional — without the Monitor pairing the user sees a silent ~10-minute wait, and stalled fixers go undiagnosed. See [`CLAUDE.md` *Long-Running Processes > Live progress tracking*](../../CLAUDE.md) for the full rule and [`CLAUDE.md` *Stall recovery protocol*](../../CLAUDE.md) for what to do when the harness reports a stalled agent.

Per-fixer prompt:

**For Mode B (PR-derived, single file scope):**
> "Apply CodeRabbit comments from PR #<n> targeting the file `<path>`. The dispatcher has already (1) fetched inline threads via the GraphQL `reviewThreads` query and filtered out resolved/outdated, (2) fetched cover-letter review bodies via `GET /repos/<owner>/<repo>/pulls/<n>/reviews` and parsed `Outside diff range comments` + `Nitpick comments` sections, and (3) merged both into a single per-file list, each item carrying a `comment_databaseId` if it came from an inline thread or `null` if from a review body. The filtered subset for this file is: <subset>. Follow your full workflow: categorize SAFE / STRUCTURAL / FLAGGED / AMBIGUOUS, present the plan, apply SAFE fixes, ask via AskUserQuestion for STRUCTURAL and FLAGGED items. Accept additional same-file comments via SendMessage. **For items with a non-null `comment_databaseId`, post a one-line reply on the originating PR thread only after the outcome is final and verification state is known: run type-check + lint on the affected scope before posting any success (`Applied`) replies — post the success template only if checks pass; post the failure template (per Step 7 in `coderabbit-fixer.md`) otherwise.** Use `gh api -X POST /repos/<owner>/<repo>/pulls/<n>/comments/<databaseId>/replies` with the template matching the outcome. Items with a `null` databaseId (cover-letter origin) get no reply — they don't have a thread to address. Track replies as `R/T` (posted/total) where T counts only the items with a databaseId. Do NOT commit. Do NOT mark threads resolved (reviewer's call)."

**For Mode A (pasted, single file scope):**
> "Apply the following CodeRabbit suggestions targeting `<path>`: <subset-of-comments>. Follow your full workflow: categorize SAFE / STRUCTURAL / FLAGGED / AMBIGUOUS, present the plan, apply SAFE fixes, ask via AskUserQuestion for STRUCTURAL and FLAGGED items. Accept additional same-file comments via SendMessage. Run type-check + lint on the affected scope after the quiet-window ends. **No reply-posting in Mode A** — pasted comments don't carry a `comment_databaseId`. Do NOT commit."

If a comment's target file can't be parsed, dispatch it as `unknown-<n>` (the fixer will treat that as a single-comment run).

## Step 3 — Announce the dispatch

Emit one short line per spawn / forward:

- Spawning coderabbit-fixer `#N` (background) for `<file>` — `<count>` comment(s).
- Forwarding 1 CR comment to in-flight fixer `#M` owning `<file>`.

Do NOT wait. The main agent immediately returns control to the user (with the `## In-flight` status block — see `CLAUDE.md` > *Long-Running Processes*).

## Step 4 — Status reporting

Every subsequent turn while any CR fixer is alive must include the `## In-flight` block listing each fixer with its target file, elapsed time, **latest activity** (refresh via `TaskOutput`), and — for Mode B fixers — the running `replies posted: N/M` counter so the user can watch the GitHub round-trip progress. Example row:

```text
| 3 | agent | 10:44:11 | 00:07 | (coderabbit-fixer #3) HomeView.tsx — 2/4 SAFE applied · replies 2/4 | 🟢 running |
```

On completion, fixers surface their final report once with `✅ done` and drop from the registry next turn — the final report carries the full `Replies posted: R/T — F failed` summary (and a `Reply posting (failures)` section if any). On error, `🔴 errored` plus the error excerpt — the main agent surfaces it for user attention.

## Step 5 — Do NOT commit

Even after fixes are applied, do NOT run `git commit`. The user reviews and commits themselves (per CLAUDE.md's no-auto-commit rule).

## Important

- **Branch-intent guardrail is non-negotiable.** If a fixer flags a region, the main agent waits for the user's answer (the fixer routes its `AskUserQuestion` through the main agent) — never auto-apply.
- **Drip-fed pattern.** When the user pastes additional CR comments after `/fix-coderabbit` has already dispatched, the **`UserPromptSubmit` CodeRabbit hook** auto-fires and the main agent re-runs the group-by-file dispatch — no need to re-invoke `/fix-coderabbit`.
- **Security / correctness issues** still pause if the fix touches a flagged region.
