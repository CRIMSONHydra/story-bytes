"""Spoiler classifier for external-knowledge chunks (M18). DEFAULT-DENY.

For a fan-theory chunk, decides the EARLIEST chapter a reader must have finished for the chunk to
reveal nothing new (= the highest chapter its content corresponds to). That value is stored as
`max_chapter_order` and the reader-facing query shows a chunk only when `boundary >= max_chapter_order`.
Anything future-facing, unbounded, or low-confidence classifies as None → NULL → never shown.
"""

import json
import logging
import re
from typing import List, Optional, Tuple

from google.genai import types as genai_types

_PROMPT = """You gate fan-theory / discussion text for a SPOILER-AWARE reader. You are given a CHUNK
of fan discussion and the story's CHAPTER LIST (order: title). Decide the EARLIEST chapter a reader
must have finished for this chunk to reveal NOTHING they haven't already read — i.e. the highest
chapter whose content the chunk corresponds to.

Return STRICT JSON: {{"max_chapter_order": <int or null>, "confidence": <0..1>}}
Rules (bias to HIDE — a false-hide is fine, a false-show is a spoiler leak):
- Concrete chunk grounded in specific chapters -> max_chapter_order = that latest chapter.
- Chunk speculates about the FUTURE, references content beyond the final chapter ({num_chapters}),
  is vague/unbounded, or you are unsure -> null.
"""


def parse_classification(raw: str, num_chapters: int, floor: float = 0.6) -> Optional[int]:
    """Pure, tolerant parse of the classifier JSON → a safe max_chapter_order or None (deny)."""
    try:
        match = re.search(r"\{.*\}", raw, re.S)
        obj = json.loads(match.group(0)) if match else {}
    except (ValueError, AttributeError):
        return None
    mc = obj.get("max_chapter_order")
    conf = obj.get("confidence", 0)
    if not isinstance(mc, int) or isinstance(mc, bool):
        return None                                  # null / non-int -> deny
    if not isinstance(conf, (int, float)) or conf < floor:
        return None                                  # below confidence floor -> deny
    if mc < 0 or mc > num_chapters:
        return None                                  # beyond the final chapter -> deny
    return mc


def classify_chunk(client, model: str, chunk: str, chapters: List[Tuple[int, str]]) -> Optional[int]:
    """LLM-classify one chunk. Returns a bounded max_chapter_order or None (deny on any error)."""
    num_chapters = max((o for o, _ in chapters), default=0)
    chapter_list = "\n".join(f"{o}: {t}" for o, t in chapters)
    prompt = _PROMPT.format(num_chapters=num_chapters) + f"\n\nCHAPTER LIST:\n{chapter_list}\n\nCHUNK:\n{chunk}"
    try:
        resp = client.models.generate_content(
            model=model, contents=prompt,
            config=genai_types.GenerateContentConfig(response_mime_type="application/json"),
        )
        return parse_classification(resp.text or "", num_chapters)
    except Exception as e:  # noqa: BLE001 - any failure is a DENY, never a leak
        logging.warning(f"Classification failed (denying chunk): {e}")
        return None
