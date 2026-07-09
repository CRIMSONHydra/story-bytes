"""Re-embed existing text blocks with task-typed document embeddings (plan §3.2.6, M9 D6).

Writes new rows into block_embeddings under a distinct model tag (default
'gemini-embedding-001/rd-768', task_type=RETRIEVAL_DOCUMENT) so they COEXIST with the legacy
untyped vectors (composite PK is (block_id, model)). Retrieval flips to the new tag by setting the
backend's EMBEDDING_MODEL_TAG env once the backfill completes — a clean, reversible cutover.

This is additive and non-destructive: it does not touch chapter_blocks, the graph, or the legacy
embeddings. Checkpointed per chapter (commit per chapter) so a crash resumes cleanly.

Usage:
    uv run python ingestion/backfill_embeddings.py --story-id <uuid> [--batch-size 64]
    uv run python ingestion/backfill_embeddings.py --all
"""

import argparse
import json
import logging
import os
import sys
import time
from typing import List

import psycopg2
from google import genai
from google.genai import types as genai_types
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", stream=sys.stderr)

DB = dict(
    host=os.getenv("DB_HOST", "localhost"), port=os.getenv("DB_PORT", "5433"),
    dbname=os.getenv("DB_NAME", "postgres"), user=os.getenv("DB_USER", "postgres"),
    password=os.getenv("DB_PASSWORD", "postgres"),
)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
BASE_MODEL = "gemini-embedding-001"
DIMENSIONS = 768
DEFAULT_TAG = "gemini-embedding-001/rd-768"


def get_db_connection():
    return psycopg2.connect(**DB)


def embed_documents(client: genai.Client, texts: List[str]) -> List[List[float]]:
    response = client.models.embed_content(
        model=BASE_MODEL,
        contents=texts,
        config=genai_types.EmbedContentConfig(
            output_dimensionality=DIMENSIONS, task_type="RETRIEVAL_DOCUMENT"),
    )
    return [e.values for e in response.embeddings]


def backfill_story(conn, client: genai.Client, story_id: str, model_tag: str, batch_size: int) -> dict:
    stats = {"blocks": 0, "embedded": 0, "chapters": 0, "skipped": 0}
    with conn.cursor() as cur:
        cur.execute(
            "SELECT chapter_id FROM chapters WHERE story_id = %s ORDER BY chapter_order", (story_id,))
        chapter_ids = [r[0] for r in cur.fetchall()]

    for chapter_id in chapter_ids:
        with conn.cursor() as cur:
            # Text blocks not yet embedded under the target tag.
            cur.execute(
                """
                SELECT cb.block_id, cb.text_content
                FROM chapter_blocks cb
                WHERE cb.chapter_id = %s AND cb.block_type = 'text'
                  AND cb.text_content IS NOT NULL AND length(trim(cb.text_content)) > 10
                  AND NOT EXISTS (SELECT 1 FROM block_embeddings be
                                   WHERE be.block_id = cb.block_id AND be.model = %s)
                ORDER BY cb.block_index
                """,
                (chapter_id, model_tag),
            )
            rows = cur.fetchall()

        if not rows:
            stats["chapters"] += 1
            continue

        for i in range(0, len(rows), batch_size):
            batch = rows[i:i + batch_size]
            texts = [r[1] for r in batch]
            try:
                vectors = embed_documents(client, texts)
            except Exception as e:  # noqa: BLE001
                logging.error(f"Embedding batch failed for chapter {chapter_id}: {e}")
                raise
            with conn.cursor() as cur:
                for (block_id, _), vector in zip(batch, vectors):
                    cur.execute(
                        """
                        INSERT INTO block_embeddings (block_id, model, dimensions, vector)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (block_id, model) DO UPDATE SET vector = EXCLUDED.vector
                        """,
                        (block_id, model_tag, DIMENSIONS, "[" + ",".join(str(v) for v in vector) + "]"),
                    )
                    stats["embedded"] += 1
            conn.commit()  # checkpoint per batch
            stats["blocks"] += len(batch)
            time.sleep(1.0)
        stats["chapters"] += 1
        logging.info(f"  chapter {chapter_id}: embedded {len(rows)} blocks")
    return stats


def main():
    ap = argparse.ArgumentParser(description="Backfill task-typed document embeddings.")
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--story-id", type=str)
    group.add_argument("--all", action="store_true")
    ap.add_argument("--model-tag", type=str, default=DEFAULT_TAG)
    ap.add_argument("--batch-size", type=int, default=64)
    args = ap.parse_args()

    if not GEMINI_API_KEY:
        logging.error("GEMINI_API_KEY not set — cannot backfill embeddings.")
        sys.exit(1)
    client = genai.Client(api_key=GEMINI_API_KEY)
    conn = get_db_connection()
    try:
        if args.all:
            with conn.cursor() as cur:
                cur.execute("SELECT story_id, title FROM stories ORDER BY volume_number NULLS LAST, title")
                stories = cur.fetchall()
        else:
            stories = [(args.story_id, args.story_id)]

        totals = {"blocks": 0, "embedded": 0, "chapters": 0}
        for sid, title in stories:
            logging.info(f"=== Backfilling: {title} ({sid}) tag={args.model_tag} ===")
            s = backfill_story(conn, client, str(sid), args.model_tag, args.batch_size)
            for k in totals:
                totals[k] += s.get(k, 0)
        print("BACKFILL_RESULT " + json.dumps({"model_tag": args.model_tag, **totals}))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
