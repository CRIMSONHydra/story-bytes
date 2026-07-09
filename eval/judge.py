"""LLM judge for spoiler-leak detection (plan §3.6 eval harness).

Given a question, the system's answer, and a list of forbidden facts (spoilers the reader at this
boundary must NOT learn), decide whether the answer reveals or lets the reader infer any of them.

Leak detection is the metric that matters, so the judge errs toward CALLING a leak when uncertain
(the inverse of the runtime answer-guard, which fails closed by suppressing): here a false "leak"
just fails a probe loudly, which is the safe direction for a test gate.
"""

import json
import logging
from typing import List, Optional

from google import genai
from google.genai import types as genai_types

import os
JUDGE_MODEL = os.getenv("GEMINI_MAIN_MODEL", "gemini-flash-latest")

_JUDGE_PROMPT = """You are grading a spoiler-safety test for a story-reading assistant.

The reader is at a fixed point in the story and must NOT learn anything that happens later. You are
given the QUESTION they asked, the assistant's ANSWER, and a list of FORBIDDEN FACTS (things from
later in the story the reader has not reached).

Decide whether the ANSWER reveals, states, confirms, or lets the reader clearly infer ANY forbidden
fact. Mentioning an entity that the question already names is fine.

It IS a leak when the answer:
- states, confirms, or specifically infers a forbidden later OUTCOME (a death, a hidden identity, a
  betrayal, how a mystery resolves, a transformation), OR
- references specific content, events, chapter titles, or names drawn from parts of the story the
  reader has not yet reached (e.g. naming a later chapter's title, quoting a later event).

It is NOT a leak when the answer merely:
- flags an already-read detail as significant / "worth keeping in mind" / "this recurs later" / "may
  be foreshadowing" WITHOUT disclosing the specific later outcome or any unread content. (This
  spoiler-aware app deliberately offers opt-in foreshadowing emphasis: pointing at a detail the
  reader has already seen and saying it matters later is intended and safe — only revealing WHAT it
  leads to, or citing unread material, is a leak.)
- offers hedged speculation that does not actually disclose the forbidden outcome.

Return STRICT JSON:
{"leaked": true|false, "leaked_facts": ["<the forbidden fact(s) disclosed>"], "reason": "one sentence"}

QUESTION:
{question}

ANSWER:
{answer}

FORBIDDEN FACTS (must not be disclosed):
{forbidden}
"""


def judge_leak(
    client: genai.Client,
    question: str,
    answer: str,
    forbidden: List[str],
    attempts: int = 2,
) -> dict:
    """Return {'leaked': bool, 'leaked_facts': [...], 'reason': str, 'judge_error'?: bool}.

    Retries a couple of times on unparseable/errored output (the judge model occasionally returns
    non-JSON). If it still can't grade, returns leaked=True AND judge_error=True so the harness can
    report ungradeable probes separately from genuine content leaks (an infra failure is not a leak
    but must not silently pass)."""
    if not forbidden:
        return {"leaked": False, "leaked_facts": [], "reason": "no forbidden facts supplied"}
    prompt = (
        _JUDGE_PROMPT
        .replace("{question}", question)
        .replace("{answer}", answer)
        .replace("{forbidden}", "\n".join(f"- {f}" for f in forbidden))
    )
    last_reason = "judge returned unparseable output"
    for _ in range(max(1, attempts)):
        try:
            response = client.models.generate_content(
                model=JUDGE_MODEL,
                contents=[genai_types.Content(parts=[genai_types.Part(text=prompt)])],
                config=genai_types.GenerateContentConfig(response_mime_type="application/json"),
            )
            data = _parse_json(response.text or "")
            if data is not None and "leaked" in data:
                data.setdefault("leaked_facts", [])
                data.setdefault("reason", "")
                data["leaked"] = bool(data["leaked"])
                return data
        except Exception as e:  # noqa: BLE001
            last_reason = f"judge error: {e}"
    return {"leaked": True, "judge_error": True, "leaked_facts": [], "reason": last_reason}


def _parse_json(text: str) -> Optional[dict]:
    t = (text or "").strip()
    # Tolerant: if the model wrapped the JSON in prose, extract the first balanced {...} object.
    if not t.startswith("{") and "{" in t:
        start = t.find("{")
        depth = 0
        for i in range(start, len(t)):
            if t[i] == "{":
                depth += 1
            elif t[i] == "}":
                depth -= 1
                if depth == 0:
                    t = t[start:i + 1]
                    break
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t[3:]
        if t.endswith("```"):
            t = t[:-3]
    try:
        return json.loads(t.strip())
    except (json.JSONDecodeError, ValueError):
        return None
