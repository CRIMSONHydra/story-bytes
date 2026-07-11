"""External-knowledge paste pipeline (M18/M19). Chunk → dedup → classify (spoiler scope) → embed →
insert. Only chunks that classify to a concrete, bounded max_chapter_order are stored; denied chunks
are dropped (never embedded). Emits the M3 JSONL event contract on stdout so the pg-boss theory job
(M19) can stream progress. Internet fetching is intentionally out of scope — paste only.

Usage:
    uv run --project ingestion python ingestion/external/pipeline.py \
        --story-id <uuid> --file theory.txt [--source-url URL] [--user-id <uuid>] [--submission-id <uuid>]
"""

import argparse
import hashlib
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

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # project root (for ingestion.*)
from ingestion.load_to_db import split_into_chunks  # noqa: E402
from ingestion.models import (  # noqa: E402
    EMBEDDING_MODEL, EMBEDDING_MODEL_TAG, EMBEDDING_DIMENSIONS, GUARD_MODEL, embedding_input,
)
from ingestion.external.classify import classify_chunk  # noqa: E402

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", stream=sys.stderr)


def emit(event: str, **fields) -> None:
    print(json.dumps({"event": event, **fields}), flush=True)


def _db():
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"), port=os.getenv("DB_PORT", "5432"),
        dbname=os.getenv("DB_NAME", "postgres"), user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", "postgres"),
    )


def _chapters(cur, story_id: str) -> List[Tuple[int, str]]:
    cur.execute("SELECT chapter_order, COALESCE(title, '') FROM chapters WHERE story_id = %s ORDER BY chapter_order",
                (story_id,))
    return [(r[0], r[1]) for r in cur.fetchall()]


def run_pipeline(conn, client, story_id: str, text: str, source_url: Optional[str], user_id: Optional[str]) -> dict:
    with conn.cursor() as cur:
        chapters = _chapters(cur, story_id)
        emit("progress", stage="classify", chapters=len(chapters))

        cur.execute(
            """INSERT INTO knowledge_documents (story_id, source_url, submitted_by, content_sha256)
               VALUES (%s, %s, %s, %s) RETURNING document_id""",
            (story_id, source_url, user_id, hashlib.sha256(text.encode()).hexdigest()),
        )
        document_id = cur.fetchone()[0]

        # Chunk per PARAGRAPH first (then split any over-long one) so a spoiler paragraph doesn't
        # force a safe paragraph in the same block to be denied — finer granularity = more kept.
        paragraphs = [p for p in re.split(r"\n\s*\n", text) if p.strip()]
        chunks = [c for para in (paragraphs or [text]) for c in split_into_chunks(para)]
        kept = 0
        denied = 0
        for chunk in chunks:
            body = chunk.strip()
            if len(body) < 20:
                continue
            sha = hashlib.sha256(f"{story_id}:{body}".encode()).hexdigest()
            cur.execute("SELECT 1 FROM external_knowledge WHERE story_id = %s AND content_sha256 = %s", (story_id, sha))
            if cur.fetchone():
                continue  # dedup

            max_chapter = classify_chunk(client, GUARD_MODEL, body, chapters)
            if max_chapter is None:
                denied += 1  # DEFAULT-DENY: not stored, not embedded
                continue

            resp = client.models.embed_content(
                model=EMBEDDING_MODEL, contents=[embedding_input(body, "document")],
                config=genai_types.EmbedContentConfig(output_dimensionality=EMBEDDING_DIMENSIONS),
            )
            vector = "[" + ",".join(str(v) for v in resp.embeddings[0].values) + "]"

            cur.execute(
                """INSERT INTO external_knowledge
                   (story_id, content, source_url, knowledge_type, max_chapter_order, content_sha256, document_id)
                   VALUES (%s, %s, %s, 'theory', %s, %s, %s) RETURNING knowledge_id""",
                (story_id, body, source_url, max_chapter, sha, document_id),
            )
            knowledge_id = cur.fetchone()[0]
            cur.execute(
                """INSERT INTO knowledge_embeddings (knowledge_id, model, dimensions, vector)
                   VALUES (%s, %s, %s, %s)""",
                (knowledge_id, EMBEDDING_MODEL_TAG, EMBEDDING_DIMENSIONS, vector),
            )
            kept += 1

        conn.commit()
        emit("progress", stage="done", kept=kept, denied=denied)
        return {"document_id": str(document_id), "kept": kept, "denied": denied, "chunks": len(chunks)}


def main() -> None:
    ap = argparse.ArgumentParser(description="Classify + ingest pasted external knowledge (spoiler-safe).")
    ap.add_argument("--story-id", required=True)
    ap.add_argument("--file", required=True, type=Path)
    ap.add_argument("--source-url", default=None)
    ap.add_argument("--user-id", default=None)
    ap.add_argument("--submission-id", default=None)
    args = ap.parse_args()

    text = args.file.read_text(encoding="utf-8", errors="replace")
    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    conn = _db()
    try:
        if args.submission_id:
            with conn.cursor() as cur:
                cur.execute("UPDATE theory_submissions SET status='active', updated_at=NOW() WHERE submission_id=%s",
                            (args.submission_id,))
            conn.commit()
        result = run_pipeline(conn, client, args.story_id, text, args.source_url, args.user_id)
        if args.submission_id:
            with conn.cursor() as cur:
                cur.execute(
                    """UPDATE theory_submissions SET status='completed', document_id=%s, chunks_kept=%s, updated_at=NOW()
                       WHERE submission_id=%s""",
                    (result["document_id"], result["kept"], args.submission_id),
                )
            conn.commit()
        emit("result", status="ok", **result)
    except Exception as e:  # noqa: BLE001
        conn.rollback()
        if args.submission_id:
            with conn.cursor() as cur:
                cur.execute("UPDATE theory_submissions SET status='failed', error=%s, updated_at=NOW() WHERE submission_id=%s",
                            (str(e)[:500], args.submission_id))
            conn.commit()
        emit("result", status="error", error=str(e)[:500])
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
