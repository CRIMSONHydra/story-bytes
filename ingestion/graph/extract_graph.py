"""Per-chapter knowledge-graph extraction (plan §2.3, M14).

Processes a story chapter-by-chapter in order. Each chapter sees only its own text plus a digest
of entities known from EARLIER chapters (chapter-local — good spoiler hygiene). Writes entities,
aliases, states, relationships, events, and plot-thread beats, one transaction per chapter, with
resume via kg_extraction_runs.

Usage:
    uv run python ingestion/graph/extract_graph.py --story-id <uuid> [--from-chapter N] [--rebuild] [-v]
    uv run python ingestion/graph/extract_graph.py --all
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

# Allow running both as a module (uv run -m) and as a bare script.
try:
    from . import prompts, writer
    from .merge import EntityIndex
except ImportError:  # pragma: no cover - script execution fallback
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from graph import prompts, writer  # type: ignore
    from graph.merge import EntityIndex  # type: ignore

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", stream=sys.stderr)

DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5433")
DB_NAME = os.getenv("DB_NAME", "postgres")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "postgres")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

CALL_DELAY = 2.0
MAX_CHUNK_CHARS = 30000

FRONT_MATTER_PATTERNS = [
    "table of contents", "copyright", "credits", "title page", "newsletter", "cover",
]


def get_db_connection():
    return psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)


def is_front_matter(title: Optional[str]) -> bool:
    t = (title or "").lower()
    return any(p in t for p in FRONT_MATTER_PATTERNS)


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


def _retry(fn, description: str, max_retries: int = 3, base_delay: float = 5.0):
    for attempt in range(max_retries + 1):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001
            err = str(e).lower()
            is_rate = any(k in err for k in ("429", "resource", "quota", "rate"))
            if attempt == max_retries or not is_rate:
                raise
            delay = base_delay * (3 ** attempt)
            logging.warning(f"Rate limited during {description}; waiting {delay:.0f}s (attempt {attempt+1})")
            time.sleep(delay)


def build_digest(index: EntityIndex, cursor, story_id: str, max_entities: int = 150) -> str:
    """A compact list of already-known entities to seed the chapter prompt."""
    cursor.execute(
        """
        SELECT e.canonical_name, e.entity_type,
               COALESCE(array_agg(DISTINCT a.alias) FILTER (WHERE a.alias IS NOT NULL), '{}')
        FROM kg_entities e
        LEFT JOIN kg_entity_aliases a ON a.entity_id = e.entity_id
        WHERE e.story_id = %s
        GROUP BY e.canonical_name, e.entity_type
        ORDER BY e.canonical_name
        LIMIT %s
        """,
        (story_id, max_entities),
    )
    lines = []
    for name, etype, aliases in cursor.fetchall():
        alias_str = f" (aka {', '.join(aliases)})" if aliases else ""
        lines.append(f"- {name} [{etype}]{alias_str}")
    return "\n".join(lines)


def extract_chapter(client: genai.Client, title: str, order: int, digest: str, text: str) -> Optional[Dict[str, Any]]:
    prompt = prompts.build_graph_prompt(title, order, digest, text[:MAX_CHUNK_CHARS])

    def _call():
        return client.models.generate_content(
            model=prompts.GRAPH_MODEL,
            contents=[genai_types.Content(parts=[genai_types.Part(text=prompt)])],
            config=genai_types.GenerateContentConfig(
                system_instruction=prompts.GRAPH_SYSTEM,
                response_mime_type="application/json",
            ),
        )

    response = _retry(_call, f"graph extraction ch{order}")
    return _parse_json(response.text or "")


def write_chapter_graph(cursor, story_id: str, order: int, data: Dict[str, Any]) -> Dict[str, int]:
    index, name_to_id = writer.load_entity_index(cursor, story_id)
    counts = {"entities": 0, "relationships": 0, "events": 0, "beats": 0}

    # Entities first (so relationships/events can resolve names to ids).
    resolved: Dict[str, str] = {}  # extracted name -> entity_id
    for ent in data.get("entities", []) or []:
        name = (ent.get("name") or "").strip()
        if not name:
            continue
        canonical = index.resolve(name, ent.get("known_entity"))
        canonical = canonical or name
        entity_id = name_to_id.get(canonical)
        if entity_id is None:
            entity_id = writer.upsert_entity(
                cursor, story_id, canonical, (ent.get("type") or "character"),
                ent.get("description"), order,
            )
            name_to_id[canonical] = entity_id
            index.add(canonical)
        resolved[name] = entity_id
        # Aliases: the mention name itself (if different) + explicit new_aliases.
        aliases = list(ent.get("new_aliases") or [])
        if name != canonical:
            aliases.append(name)
        writer.add_aliases(cursor, entity_id, aliases, order)
        index.add(canonical, aliases)
        sc = ent.get("state_change")
        if isinstance(sc, dict) and sc.get("description"):
            writer.add_state(cursor, entity_id, order, sc["description"], sc.get("status"))
        counts["entities"] += 1

    def resolve_id(nm: str) -> Optional[str]:
        nm = (nm or "").strip()
        if nm in resolved:
            return resolved[nm]
        canonical = index.resolve(nm)
        return name_to_id.get(canonical) if canonical else None

    for rel in data.get("relationships", []) or []:
        sid = resolve_id(rel.get("source_name", ""))
        tid = resolve_id(rel.get("target_name", ""))
        if sid and tid and sid != tid:
            writer.add_relationship(
                cursor, story_id, sid, tid, (rel.get("rel_type") or "related_to").strip().lower(),
                rel.get("description"), (rel.get("change") or "new").lower(), order,
            )
            counts["relationships"] += 1

    for ev in data.get("events", []) or []:
        title = (ev.get("title") or "").strip()
        if not title:
            continue
        pids = [resolve_id(n) for n in (ev.get("participant_names") or [])]
        pids = [p for p in pids if p]
        writer.add_event(cursor, story_id, order, title, ev.get("type"), ev.get("description"), pids)
        counts["events"] += 1

    for beat in data.get("thread_beats", []) or []:
        thread = (beat.get("thread") or "").strip()
        desc = (beat.get("description") or "").strip()
        if not thread or not desc:
            continue
        thread_id = writer.upsert_thread(cursor, story_id, thread, order)
        writer.add_thread_beat(cursor, thread_id, order, (beat.get("kind") or "development").lower(), desc)
        counts["beats"] += 1

    return counts


def extract_story(story_id: str, client: genai.Client, from_chapter: int = 0, rebuild: bool = False) -> Dict[str, Any]:
    conn = get_db_connection()
    totals = {"entities": 0, "relationships": 0, "events": 0, "beats": 0, "chapters": 0, "skipped": 0}
    try:
        with conn.cursor() as cur:
            if rebuild:
                cur.execute("DELETE FROM kg_extraction_runs WHERE story_id = %s AND phase = 'graph'", (story_id,))
                # Entity/edge/etc rows cascade-clear via a full graph wipe on rebuild.
                for tbl in ("kg_foreshadow_links", "kg_thread_beats", "kg_plot_threads", "kg_events",
                            "kg_relationships", "kg_entity_states", "kg_entity_aliases", "kg_entities"):
                    if tbl == "kg_thread_beats":
                        cur.execute("DELETE FROM kg_thread_beats WHERE thread_id IN "
                                    "(SELECT thread_id FROM kg_plot_threads WHERE story_id = %s)", (story_id,))
                    elif tbl in ("kg_entity_states", "kg_entity_aliases"):
                        cur.execute(f"DELETE FROM {tbl} WHERE entity_id IN "
                                    f"(SELECT entity_id FROM kg_entities WHERE story_id = %s)", (story_id,))
                    else:
                        cur.execute(f"DELETE FROM {tbl} WHERE story_id = %s", (story_id,))
                conn.commit()

            cur.execute(
                "SELECT chapter_order, title, aggregated_text FROM chapters "
                "WHERE story_id = %s AND chapter_order >= %s ORDER BY chapter_order",
                (story_id, from_chapter),
            )
            chapters = cur.fetchall()

        for order, title, text in chapters:
            if is_front_matter(title) or not (text or "").strip():
                totals["skipped"] += 1
                continue
            with conn.cursor() as cur:
                if not rebuild and writer.run_already_succeeded(cur, story_id, order, "graph", prompts.PROMPT_VERSION):
                    totals["skipped"] += 1
                    continue
                digest = build_digest(EntityIndex(), cur, story_id)
            try:
                data = extract_chapter(client, title or f"Chapter {order}", order, digest, text)
                if data is None:
                    raise ValueError("unparseable extraction output")
                with conn.cursor() as cur:
                    counts = write_chapter_graph(cur, story_id, order, data)
                    writer.mark_run(cur, story_id, order, "graph", prompts.GRAPH_MODEL, prompts.PROMPT_VERSION, "succeeded")
                conn.commit()
                for k in counts:
                    totals[k] += counts[k]
                totals["chapters"] += 1
                logging.info(f"  ch{order}: +{counts['entities']}e +{counts['relationships']}r "
                             f"+{counts['events']}ev +{counts['beats']}b — {title}")
            except Exception as e:  # noqa: BLE001
                conn.rollback()
                with conn.cursor() as cur:
                    writer.mark_run(cur, story_id, order, "graph", prompts.GRAPH_MODEL, prompts.PROMPT_VERSION,
                                    "failed", str(e)[:500])
                conn.commit()
                logging.error(f"  ch{order} failed: {e}")
            time.sleep(CALL_DELAY)
    finally:
        conn.close()
    return totals


def main():
    parser = argparse.ArgumentParser(description="Extract a chapter-versioned knowledge graph.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--story-id", type=str)
    group.add_argument("--all", action="store_true")
    parser.add_argument("--from-chapter", type=int, default=0)
    parser.add_argument("--rebuild", action="store_true")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
    if not GEMINI_API_KEY:
        logging.error("GEMINI_API_KEY not set — cannot extract graph.")
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
        results = {}
        for sid, title in stories:
            logging.info(f"=== Graph extraction: {title} ({sid}) ===")
            results[str(sid)] = extract_story(str(sid), client, args.from_chapter, args.rebuild)
        print("GRAPH_RESULT " + json.dumps({"stories": results}))
    else:
        totals = extract_story(args.story_id, client, args.from_chapter, args.rebuild)
        logging.info(f"Done: {totals}")
        print("GRAPH_RESULT " + json.dumps({"story_id": args.story_id, **totals}))


if __name__ == "__main__":
    main()
