"""Book-level foreshadowing linking (plan §2.14, M14).

Runs AFTER per-chapter graph extraction. Deliberately uses full-book access (all plot-thread beats)
to pair early setups with later payoffs — this is the one place future knowledge is legitimately
used, because it happens offline and never in a reader-facing request.

For each candidate link it then:
  1. generates a spoiler-free emphasis_hint from the SETUP ONLY (never the payoff),
  2. runs the payoff-leak guard (guard.py) on that hint vs the payoff,
  3. stores clean/flagged/blocked accordingly. Blocked links keep a generic fallback hint.

Only links whose payoff chapter > setup chapter are stored; the emphasizability window
(setup <= reader_chapter < payoff) is applied later at query time.

Usage:
    uv run python ingestion/graph/link_foreshadow.py --story-id <uuid> [--rebuild] [-v]
    uv run python ingestion/graph/link_foreshadow.py --all
"""

import argparse
import json
import logging
import os
import sys
import time
from typing import Any, Dict, List, Optional

import psycopg2
from google import genai
from google.genai import types as genai_types
from dotenv import load_dotenv

try:
    from . import prompts, writer, guard
except ImportError:  # pragma: no cover
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from graph import prompts, writer, guard  # type: ignore

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", stream=sys.stderr)

DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5433")
DB_NAME = os.getenv("DB_NAME", "postgres")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "postgres")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

CALL_DELAY = 1.5
GENERIC_HINT = "This detail recurs later — worth keeping in mind."


def get_db_connection():
    return psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)


def _parse_json(text: str) -> Optional[dict]:
    t = (text or "").strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t[3:]
        if t.endswith("```"):
            t = t[:-3]
    try:
        return json.loads(t.strip())
    except (json.JSONDecodeError, ValueError):
        return None


def format_beats(beats: List[Dict[str, Any]]) -> str:
    return "\n".join(
        f"ch{b['chapter_order']}: {b['thread']} — {b['beat_kind']} — {b['description']}"
        for b in beats
    )


def generate_links(client: genai.Client, beats: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    prompt = prompts.build_foreshadow_prompt(format_beats(beats))
    response = client.models.generate_content(
        model=prompts.GRAPH_MODEL,
        contents=[genai_types.Content(parts=[genai_types.Part(text=prompt)])],
        config=genai_types.GenerateContentConfig(
            system_instruction=prompts.FORESHADOW_SYSTEM,
            response_mime_type="application/json",
        ),
    )
    data = _parse_json(response.text or "")
    if not data or not isinstance(data.get("links"), list):
        return []
    return data["links"]


def generate_hint(client: genai.Client, setup_summary: str) -> Optional[str]:
    """Generate an emphasis hint from the SETUP ONLY. The payoff is never in this prompt."""
    prompt = prompts.build_hint_prompt(setup_summary)
    response = client.models.generate_content(
        model=prompts.GRAPH_MODEL,
        contents=[genai_types.Content(parts=[genai_types.Part(text=prompt)])],
        config=genai_types.GenerateContentConfig(
            system_instruction=prompts.HINT_SYSTEM,
            response_mime_type="application/json",
        ),
    )
    data = _parse_json(response.text or "")
    if data and isinstance(data.get("hint"), str) and data["hint"].strip():
        return data["hint"].strip()
    return None


def build_link(client: genai.Client, raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Validate a raw link, generate + guard its hint. Returns a row dict or None if invalid."""
    try:
        setup_ch = int(raw["setup_chapter"])
        payoff_ch = int(raw["payoff_chapter"])
    except (KeyError, TypeError, ValueError):
        return None
    if payoff_ch <= setup_ch:
        return None
    setup_summary = (raw.get("setup_summary") or "").strip()
    payoff_summary = (raw.get("payoff_summary") or "").strip()
    if not setup_summary or not payoff_summary:
        return None
    significance = raw.get("significance", "notable")
    if significance not in ("minor", "notable", "major"):
        significance = "notable"

    # Generate the hint from setup only, then guard it against the payoff.
    hint = generate_hint(client, setup_summary)
    guard_status = "clean"
    if not hint:
        hint, guard_status = GENERIC_HINT, "blocked"
    else:
        leaked = guard.check_payoff_leak(client, hint, payoff_summary)
        if leaked:
            # One regeneration attempt.
            time.sleep(CALL_DELAY)
            retry = generate_hint(client, setup_summary)
            if retry and not guard.check_payoff_leak(client, retry, payoff_summary):
                hint, guard_status = retry, "flagged"
            else:
                hint, guard_status = GENERIC_HINT, "blocked"

    return {
        "setup_chapter_order": setup_ch,
        "payoff_chapter_order": payoff_ch,
        "setup_summary": setup_summary,
        "emphasis_hint": hint,
        "payoff_summary": payoff_summary,
        "significance": significance,
        "confidence": raw.get("confidence"),
        "extraction_model": prompts.GRAPH_MODEL,
        "guard_status": guard_status,
        "prompt_version": prompts.PROMPT_VERSION,
    }


def link_story(story_id: str, client: genai.Client, rebuild: bool = False) -> Dict[str, Any]:
    conn = get_db_connection()
    stats = {"candidates": 0, "stored": 0, "clean": 0, "flagged": 0, "blocked": 0}
    try:
        with conn.cursor() as cur:
            beats = writer.load_thread_beats(cur, story_id)
        if len(beats) < 2:
            logging.info("Not enough thread beats to link — skipping.")
            print("FORESHADOW_RESULT " + json.dumps({"story_id": story_id, **stats}))
            return stats

        raw_links = generate_links(client, beats)
        stats["candidates"] = len(raw_links)
        time.sleep(CALL_DELAY)

        # Re-linking is idempotent: always replace this story's links for the current prompt version
        # (there is no natural unique key on a link, so clear-then-insert avoids duplicate rows on
        # re-runs). --rebuild additionally re-extracts the graph upstream.
        with conn.cursor() as cur:
            writer.clear_foreshadow_links(cur, story_id, prompts.PROMPT_VERSION)
        conn.commit()

        for raw in raw_links:
            link = build_link(client, raw)
            time.sleep(CALL_DELAY)
            if not link:
                continue
            with conn.cursor() as cur:
                link["thread_id"] = writer.find_thread_id(cur, story_id, raw.get("thread"))
                writer.insert_foreshadow_link(cur, story_id, link)
            conn.commit()
            stats["stored"] += 1
            stats[link["guard_status"]] += 1
            logging.info(f"  link ch{link['setup_chapter_order']}->ch{link['payoff_chapter_order']} "
                         f"[{link['significance']}/{link['guard_status']}]: {link['emphasis_hint']}")
    finally:
        conn.close()
    print("FORESHADOW_RESULT " + json.dumps({"story_id": story_id, **stats}))
    return stats


def main():
    parser = argparse.ArgumentParser(description="Link foreshadowing setups to payoffs (book-level).")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--story-id", type=str)
    group.add_argument("--all", action="store_true")
    parser.add_argument("--rebuild", action="store_true")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    if not GEMINI_API_KEY:
        logging.error("GEMINI_API_KEY not set — cannot link foreshadowing.")
        sys.exit(1)
    client = genai.Client(api_key=GEMINI_API_KEY)

    if args.all:
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT story_id, title FROM stories ORDER BY volume_number NULLS LAST, title")
                stories = cur.fetchall()
        finally:
            conn.close()
        for sid, title in stories:
            logging.info(f"=== Foreshadow linking: {title} ({sid}) ===")
            link_story(str(sid), client, args.rebuild)
    else:
        link_story(args.story_id, client, args.rebuild)


if __name__ == "__main__":
    main()
