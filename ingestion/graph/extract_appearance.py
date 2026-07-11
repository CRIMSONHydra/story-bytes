"""Appearance-fact extraction (M16 population, run by M-Backfill).

Per character entity, mine chapter-versioned VISUAL traits (hair/eyes/build/attire/age/distinguishing)
from its evidence quotes + description and store them in `entity_appearance_facts`, tagged with the
chapter each is established. These feed `buildCanon` (backend) → the spoiler-safe image prompt.

Usage:
    uv run --project ingestion python ingestion/graph/extract_appearance.py --story-id <uuid> [-v]
    uv run --project ingestion python ingestion/graph/extract_appearance.py --all [-v]
"""

import argparse
import json
import logging
import os
import re
import sys
from pathlib import Path
from typing import List, Optional, Tuple

import psycopg2
from google import genai
from google.genai import types as genai_types
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from ingestion.models import GRAPH_MODEL  # noqa: E402

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", stream=sys.stderr)

_ALLOWED = {"hair", "eyes", "build", "attire", "age", "distinguishing", "height", "skin"}

_PROMPT = """Extract STABLE, physically VISIBLE appearance traits for the character below, using ONLY
the quotes/description provided. Do NOT invent or infer beyond the text. Tag each trait with the
EARLIEST chapter (from the quotes) it is established.

Return STRICT JSON: [{{"chapter_order": <int>, "fact_type": <one of hair|eyes|build|attire|age|distinguishing|height|skin>, "value": "<short phrase>"}}]
Return [] if the text states no visible appearance details."""


def parse_appearance_facts(raw: str, max_chapter: int) -> List[Tuple[int, str, str]]:
    """Pure, tolerant parse of the extractor JSON → validated (chapter, fact_type, value) tuples."""
    try:
        match = re.search(r"\[.*\]", raw, re.S)
        items = json.loads(match.group(0)) if match else []
    except (ValueError, AttributeError):
        return []
    facts: List[Tuple[int, str, str]] = []
    for it in items if isinstance(items, list) else []:
        if not isinstance(it, dict):
            continue
        ch, ft, val = it.get("chapter_order"), it.get("fact_type"), it.get("value")
        if not isinstance(ch, int) or isinstance(ch, bool) or ch < 0 or ch > max_chapter:
            continue
        if ft not in _ALLOWED or not isinstance(val, str) or not val.strip():
            continue
        facts.append((ch, ft, val.strip()[:200]))
    return facts


def _entities(cur, story_id: str):
    cur.execute(
        """SELECT entity_id, canonical_name, COALESCE(description, ''), first_chapter_order
           FROM kg_entities WHERE story_id = %s AND entity_type = 'character' ORDER BY first_chapter_order""",
        (story_id,),
    )
    return cur.fetchall()


def _quotes(cur, entity_id: str) -> List[Tuple[int, str]]:
    cur.execute(
        """SELECT chapter_order, quote FROM kg_evidence
           WHERE subject_type = 'entity' AND subject_id = %s ORDER BY chapter_order LIMIT 12""",
        (entity_id,),
    )
    return [(r[0], r[1]) for r in cur.fetchall()]


def extract_for_story(conn, client, story_id: str, max_chapter: int) -> dict:
    total_facts = 0
    with conn.cursor() as cur:
        entities = _entities(cur, story_id)
    for entity_id, name, description, first_ch in entities:
        with conn.cursor() as cur:
            quotes = _quotes(cur, entity_id)
        context = f"Character: {name}\nFirst appears: chapter {first_ch}\nDescription: {description}\n"
        context += "Quotes:\n" + "\n".join(f"[ch {c}] {q}" for c, q in quotes) if quotes else ""
        try:
            resp = client.models.generate_content(
                model=GRAPH_MODEL, contents=_PROMPT + "\n\n" + context,
                config=genai_types.GenerateContentConfig(response_mime_type="application/json"),
            )
            facts = parse_appearance_facts(resp.text or "", max_chapter)
        except Exception as e:  # noqa: BLE001
            logging.warning(f"Appearance extraction failed for {name}: {e}")
            facts = []
        if not facts:
            continue
        with conn.cursor() as cur:
            for ch, ft, val in facts:
                cur.execute(
                    """INSERT INTO entity_appearance_facts (entity_id, chapter_order, fact_type, value)
                       VALUES (%s, %s, %s, %s) ON CONFLICT (entity_id, chapter_order, fact_type) DO NOTHING""",
                    (entity_id, max(ch, first_ch), ft, val),
                )
        conn.commit()
        total_facts += len(facts)
        logging.info(f"  {name}: {len(facts)} appearance facts")
    return {"entities": len(entities), "facts": total_facts}


def _db():
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"), port=os.getenv("DB_PORT", "5432"),
        dbname=os.getenv("DB_NAME", "postgres"), user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", "postgres"),
    )


def _max_chapter(cur, story_id: str) -> int:
    cur.execute("SELECT COALESCE(MAX(chapter_order), 0) FROM chapters WHERE story_id = %s", (story_id,))
    return cur.fetchone()[0]


def main() -> None:
    ap = argparse.ArgumentParser(description="Extract per-entity appearance facts.")
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--story-id", type=str)
    group.add_argument("--all", action="store_true")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    conn = _db()
    try:
        if args.all:
            with conn.cursor() as cur:
                cur.execute("SELECT story_id FROM stories")
                story_ids: List[str] = [str(r[0]) for r in cur.fetchall()]
        else:
            story_ids = [args.story_id]
        for sid in story_ids:
            with conn.cursor() as cur:
                mc = _max_chapter(cur, sid)
            result = extract_for_story(conn, client, sid, mc)
            print(json.dumps({"event": "result", "story_id": sid, **result}), flush=True)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
