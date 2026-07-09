#!/usr/bin/env bash
# .claude/scripts/extract-last-agent-state.sh
#
# Stall-recovery helper. Given a sub-agent JSONL transcript, prints the last
# few meaningful events so the main agent can recover the in-flight analysis
# of a stalled / errored sub-agent WITHOUT Reading the full transcript (which
# would overflow context).
#
# Use this when a backgrounded Agent returns with <status>failed</status>
# (typically "Agent stalled: no progress for Xs"). The output gives you
# enough context to either:
#   (a) finish the work directly in the main turn,
#   (b) re-spawn a fresh agent with the partial findings pre-loaded,
#   (c) surface the extracted analysis to the user.
#
# Usage:
#   bash .claude/scripts/extract-last-agent-state.sh <transcript-path> [n-events]
#
# Emits to stdout (≤ 4 KB total, designed to fit in a single tool result):
#   === LAST <n> EVENTS ===
#   [N] 🔧 tool=<name>  args=<short-arg-preview>
#   [N+1] 💬 <text excerpt, up to 600 chars>
#   ...
#   === FINAL RESULT (if any) ===
#   <result.subtype>: <result.result, up to 800 chars>

set -u
TRANSCRIPT="${1:?usage: $0 <transcript-path> [n-events]}"
N_EVENTS="${2:-6}"

if [ ! -e "$TRANSCRIPT" ]; then
  echo "ERROR: transcript not found: $TRANSCRIPT" >&2
  exit 1
fi

python3 -u - "$TRANSCRIPT" "$N_EVENTS" <<'PYEOF'
import json, sys

path = sys.argv[1]
n_events = int(sys.argv[2])

events = []
result_event = None
with open(path, "r", encoding="utf-8", errors="replace") as f:
    for raw in f:
        raw = raw.strip()
        if not raw:
            continue
        try:
            ev = json.loads(raw)
        except Exception:
            continue
        t = ev.get("type")
        if t == "result":
            result_event = ev
            continue
        if t != "assistant":
            continue
        msg = ev.get("message", {})
        for c in msg.get("content", []) or []:
            ctype = c.get("type")
            if ctype == "text":
                text = (c.get("text") or "").strip()
                if text:
                    events.append(("text", text))
            elif ctype == "tool_use":
                name = c.get("name", "?")
                inp = c.get("input", {}) or {}
                # Pick the most informative arg field per tool.
                preview = ""
                for k in ("command", "description", "file_path", "old_string",
                         "new_string", "pattern", "path", "prompt", "query",
                         "content"):
                    v = inp.get(k)
                    if v:
                        preview = f"{k}={str(v)[:200]}"
                        break
                if not preview:
                    preview = json.dumps(inp)[:200]
                events.append(("tool", f"{name}  {preview}"))

tail = events[-n_events:] if events else []
print(f"=== LAST {len(tail)} EVENTS (of {len(events)} total) ===")
for i, (kind, body) in enumerate(tail, start=max(1, len(events) - len(tail) + 1)):
    if kind == "tool":
        line = f"[{i}] 🔧 {body}"
    else:
        excerpt = body if len(body) <= 600 else body[:600] + "…"
        line = f"[{i}] 💬 {excerpt}"
    # Hard cap each line at 800 chars defensively.
    print(line[:800])

if result_event is not None:
    print()
    print("=== FINAL RESULT ===")
    subtype = result_event.get("subtype") or result_event.get("result_type") or "?"
    body = result_event.get("result") or result_event.get("error") or ""
    if isinstance(body, (dict, list)):
        body = json.dumps(body)
    body = str(body)
    if len(body) > 800:
        body = body[:800] + "…"
    print(f"{subtype}: {body}")
PYEOF
