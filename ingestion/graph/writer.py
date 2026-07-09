"""Database writes for graph + foreshadowing extraction (psycopg2).

Transactions are managed by the caller, one per chapter (extract_graph.py) — a crash mid-book
leaves already-committed chapters intact and the run is resumable via kg_extraction_runs.
"""

import logging
from typing import Any, Dict, List, Optional, Tuple

from .merge import EntityIndex, choose_canonical, is_antonym, normalize_name

VALID_ENTITY_TYPES = {"character", "faction", "location", "item", "concept"}
VALID_BEAT_KINDS = {"setup", "development", "foreshadowing", "payoff", "resolution"}


def load_entity_index(cursor, story_id: str) -> Tuple[EntityIndex, Dict[str, str]]:
    """Build an EntityIndex from entities already written for this story, plus a map
    canonical_name -> entity_id for FK wiring."""
    index = EntityIndex()
    name_to_id: Dict[str, str] = {}
    cursor.execute(
        "SELECT entity_id, canonical_name FROM kg_entities WHERE story_id = %s",
        (story_id,),
    )
    rows = cursor.fetchall()
    for entity_id, canonical in rows:
        name_to_id[canonical] = str(entity_id)
    # Attach aliases.
    if rows:
        cursor.execute(
            """SELECT e.canonical_name, a.alias
               FROM kg_entities e JOIN kg_entity_aliases a ON a.entity_id = e.entity_id
               WHERE e.story_id = %s""",
            (story_id,),
        )
        alias_map: Dict[str, List[str]] = {}
        for canonical, alias in cursor.fetchall():
            alias_map.setdefault(canonical, []).append(alias)
        for canonical in name_to_id:
            index.add(canonical, alias_map.get(canonical, []))
    return index, name_to_id


def upsert_entity(
    cursor,
    story_id: str,
    canonical_name: str,
    entity_type: str,
    description: Optional[str],
    chapter_order: int,
) -> str:
    """Insert or fetch an entity; keep the earliest first_chapter_order. Returns entity_id."""
    if entity_type not in VALID_ENTITY_TYPES:
        entity_type = "character"
    cursor.execute(
        """
        INSERT INTO kg_entities (story_id, entity_type, canonical_name, description, first_chapter_order)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (story_id, entity_type, canonical_name) DO UPDATE
          SET first_chapter_order = LEAST(kg_entities.first_chapter_order, EXCLUDED.first_chapter_order),
              description = COALESCE(kg_entities.description, EXCLUDED.description),
              updated_at = NOW()
        RETURNING entity_id
        """,
        (story_id, entity_type, canonical_name, description, chapter_order),
    )
    return str(cursor.fetchone()[0])


def add_aliases(cursor, entity_id: str, aliases: List[str], chapter_order: int) -> None:
    for alias in aliases:
        alias = (alias or "").strip()
        if not alias:
            continue
        cursor.execute(
            """
            INSERT INTO kg_entity_aliases (entity_id, alias, first_chapter_order)
            VALUES (%s, %s, %s)
            ON CONFLICT (entity_id, alias) DO UPDATE
              SET first_chapter_order = LEAST(kg_entity_aliases.first_chapter_order, EXCLUDED.first_chapter_order)
            """,
            (entity_id, alias, chapter_order),
        )


def add_state(cursor, entity_id: str, chapter_order: int, description: str, status: Optional[str]) -> None:
    cursor.execute(
        """
        INSERT INTO kg_entity_states (entity_id, chapter_order, description, status)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (entity_id, chapter_order) DO UPDATE
          SET description = EXCLUDED.description, status = EXCLUDED.status
        """,
        (entity_id, chapter_order, description, status),
    )


def add_relationship(
    cursor,
    story_id: str,
    source_id: str,
    target_id: str,
    rel_type: str,
    description: Optional[str],
    change: str,
    chapter_order: int,
) -> None:
    """Insert / update a temporal edge. 'ended' or an antonym of an open edge closes the old one."""
    if source_id == target_id:
        return
    # Find an open edge between the same ordered pair.
    cursor.execute(
        """SELECT rel_id, rel_type FROM kg_relationships
           WHERE story_id = %s AND source_entity_id = %s AND target_entity_id = %s
             AND valid_to_chapter IS NULL""",
        (story_id, source_id, target_id),
    )
    open_edges = cursor.fetchall()

    if change == "ended":
        for rel_id, _ in open_edges:
            cursor.execute(
                "UPDATE kg_relationships SET valid_to_chapter = %s WHERE rel_id = %s",
                (chapter_order, rel_id),
            )
        return

    if change == "unchanged":
        # Nothing structural to add; keep the existing edge (evidence handled elsewhere).
        if open_edges:
            return

    # change == "new" (or unchanged with no existing edge): close any contradictory open edge, then insert.
    for rel_id, existing_type in open_edges:
        if existing_type == rel_type:
            return  # identical open edge already exists
        if is_antonym(existing_type, rel_type):
            cursor.execute(
                "UPDATE kg_relationships SET valid_to_chapter = %s WHERE rel_id = %s",
                (chapter_order, rel_id),
            )
    cursor.execute(
        """
        INSERT INTO kg_relationships
          (story_id, source_entity_id, target_entity_id, rel_type, description, valid_from_chapter)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (story_id, source_id, target_id, rel_type, description, chapter_order),
    )


def add_event(
    cursor,
    story_id: str,
    chapter_order: int,
    title: str,
    event_type: Optional[str],
    description: Optional[str],
    participant_ids: List[str],
) -> None:
    cursor.execute(
        """
        INSERT INTO kg_events (story_id, chapter_order, title, event_type, description)
        VALUES (%s, %s, %s, %s, %s) RETURNING event_id
        """,
        (story_id, chapter_order, title, event_type, description),
    )
    event_id = cursor.fetchone()[0]
    for pid in participant_ids:
        cursor.execute(
            """INSERT INTO kg_event_participants (event_id, entity_id, role)
               VALUES (%s, %s, 'participant') ON CONFLICT DO NOTHING""",
            (event_id, pid),
        )


def upsert_thread(cursor, story_id: str, name: str, chapter_order: int) -> str:
    cursor.execute(
        """
        INSERT INTO kg_plot_threads (story_id, name, first_chapter_order)
        VALUES (%s, %s, %s)
        ON CONFLICT (story_id, name) DO UPDATE
          SET first_chapter_order = LEAST(kg_plot_threads.first_chapter_order, EXCLUDED.first_chapter_order)
        RETURNING thread_id
        """,
        (story_id, name, chapter_order),
    )
    return str(cursor.fetchone()[0])


def add_thread_beat(cursor, thread_id: str, chapter_order: int, beat_kind: str, description: str) -> None:
    if beat_kind not in VALID_BEAT_KINDS:
        beat_kind = "development"
    cursor.execute(
        """
        INSERT INTO kg_thread_beats (thread_id, chapter_order, beat_kind, description)
        VALUES (%s, %s, %s, %s)
        """,
        (thread_id, chapter_order, beat_kind, description),
    )


# ---------------------------------------------------------------------------
# Extraction-run bookkeeping (idempotency / resume)
# ---------------------------------------------------------------------------

def run_already_succeeded(cursor, story_id: str, chapter_order: int, phase: str, prompt_version: int) -> bool:
    cursor.execute(
        """SELECT 1 FROM kg_extraction_runs
           WHERE story_id = %s AND chapter_order = %s AND phase = %s AND prompt_version = %s
             AND status = 'succeeded'""",
        (story_id, chapter_order, phase, prompt_version),
    )
    return cursor.fetchone() is not None


def mark_run(cursor, story_id: str, chapter_order: int, phase: str, model: str, prompt_version: int,
             status: str, error: Optional[str] = None) -> None:
    cursor.execute(
        """
        INSERT INTO kg_extraction_runs (story_id, chapter_order, phase, model, prompt_version, status, error, finished_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, CASE WHEN %s IN ('succeeded','failed') THEN NOW() ELSE NULL END)
        ON CONFLICT (story_id, chapter_order, phase, prompt_version) DO UPDATE
          SET status = EXCLUDED.status, error = EXCLUDED.error, model = EXCLUDED.model,
              finished_at = EXCLUDED.finished_at
        """,
        (story_id, chapter_order, phase, model, prompt_version, status, error, status),
    )


# ---------------------------------------------------------------------------
# Foreshadowing links
# ---------------------------------------------------------------------------

def load_thread_beats(cursor, story_id: str) -> List[Dict[str, Any]]:
    cursor.execute(
        """
        SELECT t.name, b.chapter_order, b.beat_kind, b.description
        FROM kg_thread_beats b
        JOIN kg_plot_threads t ON t.thread_id = b.thread_id
        WHERE t.story_id = %s
        ORDER BY b.chapter_order, t.name
        """,
        (story_id,),
    )
    return [
        {"thread": r[0], "chapter_order": r[1], "beat_kind": r[2], "description": r[3]}
        for r in cursor.fetchall()
    ]


def clear_foreshadow_links(cursor, story_id: str, prompt_version: int) -> None:
    cursor.execute(
        "DELETE FROM kg_foreshadow_links WHERE story_id = %s AND prompt_version = %s",
        (story_id, prompt_version),
    )


def find_thread_id(cursor, story_id: str, thread_name: Optional[str]) -> Optional[str]:
    if not thread_name:
        return None
    cursor.execute(
        "SELECT thread_id FROM kg_plot_threads WHERE story_id = %s AND name = %s",
        (story_id, thread_name),
    )
    row = cursor.fetchone()
    return str(row[0]) if row else None


def insert_foreshadow_link(cursor, story_id: str, link: Dict[str, Any]) -> None:
    cursor.execute(
        """
        INSERT INTO kg_foreshadow_links
          (story_id, thread_id, setup_chapter_order, payoff_chapter_order,
           setup_summary, emphasis_hint, payoff_summary, significance, confidence,
           extraction_model, guard_status, prompt_version)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            story_id,
            link.get("thread_id"),
            link["setup_chapter_order"],
            link["payoff_chapter_order"],
            link["setup_summary"],
            link["emphasis_hint"],
            link["payoff_summary"],
            link.get("significance", "notable"),
            link.get("confidence"),
            link["extraction_model"],
            link.get("guard_status", "clean"),
            link.get("prompt_version", 1),
        ),
    )
