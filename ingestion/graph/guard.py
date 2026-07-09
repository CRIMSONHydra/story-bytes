"""Payoff-leak guard (plan §2.14.4, extraction-time use).

Checks that a spoiler-free emphasis hint does NOT entail any fact from the payoff summary.
This is the offline (Python) counterpart of the TS answerGuard payoff-leak mode; both share the
same contract so their verdicts are comparable.

Fails CLOSED: if the model errors or returns malformed output, treat as a leak (safer to drop the
hint than to risk revealing a spoiler).
"""

import json
import logging
from typing import Optional

from google import genai
from google.genai import types as genai_types

GUARD_MODEL = "gemini-2.5-flash-lite"

_GUARD_PROMPT = """You are a spoiler-safety guard. You are given a SETUP HINT that will be shown to a
reader, and a PAYOFF (a future spoiler the reader must NOT learn yet).

Decide whether the HINT reveals, states, strongly implies, or lets the reader infer any specific fact
from the PAYOFF. Naming the same entity that already appears in the setup is fine; revealing what
HAPPENS in the payoff (an outcome, identity, death, betrayal, twist) is a leak.

Return STRICT JSON: {"leaks": true|false, "reason": "short"}.

HINT (shown to reader):
{hint}

PAYOFF (must stay hidden):
{payoff}
"""


def check_payoff_leak(client: genai.Client, hint: str, payoff_summary: str) -> bool:
    """Return True if the hint leaks the payoff (or if the check fails — fail closed)."""
    prompt = _GUARD_PROMPT.replace("{hint}", hint).replace("{payoff}", payoff_summary)
    try:
        response = client.models.generate_content(
            model=GUARD_MODEL,
            contents=[genai_types.Content(parts=[genai_types.Part(text=prompt)])],
            config=genai_types.GenerateContentConfig(response_mime_type="application/json"),
        )
        data = _parse_json(response.text or "")
        if data is None or "leaks" not in data:
            logging.warning("Guard returned unparseable output; failing closed (treating as leak).")
            return True
        return bool(data["leaks"])
    except Exception as e:  # noqa: BLE001 - fail closed on any error
        logging.warning(f"Payoff-leak guard error ({e}); failing closed (treating as leak).")
        return True


def _parse_json(text: str) -> Optional[dict]:
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t[3:]
        if t.endswith("```"):
            t = t[:-3]
    try:
        return json.loads(t.strip())
    except (json.JSONDecodeError, ValueError):
        return None
