---
description: Quick pre-flight before writing new code. Spawns reuse-scout (always) and schema-guard (if the intent involves data storage) against a stated feature description, returning a REUSE / EXTEND / BUILD NEW verdict before any file is created.
---

You are about to run the **/before-write** workflow. The user is about to write new code and wants to know if it can reuse / extend existing implementations first.

## Step 1 — Capture intent

The user's `$ARGUMENTS` will describe what they want to build (e.g., "a card that shows a document's title, owner avatar, and last-opened date," "a service that returns the stencils used by a template," "a hook to track which page tab is currently active").

If `$ARGUMENTS` is empty, ask the user one question: "What are you about to build? (1-2 sentences)" — then proceed.

## Step 2 — Decide which agents to spawn

Always: `reuse-scout`.

Also spawn `schema-guard` if the intent involves any of:
- "store," "save," "track," "record," "log," "persist," "history," "audit"
- "table," "model," "migration," "column," "schema"
- A new feature that will need backend data (most "I want to build X" requests for the Editor / Start / Templates surfaces).

## Step 3 — Spawn in parallel

Single message, parallel `Agent` calls:

1. **reuse-scout** prompt:
   > "The user is about to build: `<intent>`. Run the full reuse scan — check `frontend/components/common/`, `frontend/lib/`, `frontend/hooks/`, `backend/app/services/`, `frontend/api/endpoints.ts`, `frontend/components/icons/` (default `index.tsx` plus grouped files), and the relevant docs. Return verdict (REUSE / EXTEND / NO MATCH) per your agent definition."

2. **schema-guard** prompt (if applicable):
   > "The user is about to build: `<intent>`. Run the full schema reuse scan — check `docs/SCHEMA_REUSE.md`, `backend/app/models/`, and recent Alembic migrations. Remember the schema mirrors the Visio JS API + ShapeSheet sections. Return verdict (REUSE / EXTEND / NEW TABLE) per your agent definition."

## Step 4 — Present verdict

```text
# /before-write verdict — "<intent>"

## Reuse Scout
<verdict + exact import paths>

## Schema Guard
<verdict + exact table refs>   (omit section if not spawned)

## Recommended path forward
- [ ] Concrete action 1
- [ ] Concrete action 2

## Files you should open / read before writing
- `frontend/components/common/<X>/<X>.tsx`
- `backend/app/models/<file>.py`
```

## Step 5 — Stop

Do NOT start writing. Hand the verdict back. The user (or a follow-up turn) does the actual implementation with this context in mind.

## Important

- Be fast. This is a pre-flight check, not a deep audit.
- If both agents say "REUSE" / "EXTEND," push back on writing new code.
- If both say "NO MATCH / NEW TABLE," confirm the justification is strong (e.g., truly new Visio object, not just "I didn't look hard enough").
