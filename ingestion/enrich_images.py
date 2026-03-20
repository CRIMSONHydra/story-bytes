"""Phase 3 Pass 2: Post-ingestion image enrichment with full story context.

After all chapters are loaded, this script re-analyzes each image asset
with surrounding text context and a character list to resolve visual
descriptions ("red-haired girl") into named characters ("Eris Boreas Greyrat").

Usage:
    uv run python ingestion/enrich_images.py --story-id <uuid>
    uv run python ingestion/enrich_images.py --all
"""

import argparse
import json
import logging
import math
import os
import time
from typing import Dict, Any, List, Optional

import psycopg2
from psycopg2.extras import Json, RealDictCursor
from google import genai
from google.genai import types as genai_types
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

# Rate limiting configuration
ENRICHMENT_DELAY = 2.0            # seconds between individual enrichment calls
ENRICHMENT_BATCH_SIZE = 5         # images per batch before longer pause
ENRICHMENT_BATCH_PAUSE = 3.0      # seconds between enrichment batches
BACKOFF_BASE_DELAY = 5.0          # base delay for exponential backoff
BACKOFF_MAX_RETRIES = 3           # max retries on rate-limit errors


def _format_duration(seconds: float) -> str:
    """Format a duration in seconds to a human-readable string."""
    if seconds < 60:
        return f"{seconds:.1f}s"
    minutes = int(seconds // 60)
    secs = seconds % 60
    return f"{minutes}m {secs:.0f}s"


def _retry_with_backoff(fn, description: str = "API call", max_retries: int = BACKOFF_MAX_RETRIES, base_delay: float = BACKOFF_BASE_DELAY):
    """Call fn(), retrying on rate-limit errors with exponential backoff."""
    for attempt in range(max_retries + 1):
        try:
            return fn()
        except Exception as e:
            err_str = str(e).lower()
            is_rate_limit = "429" in err_str or "resource" in err_str or "quota" in err_str or "rate" in err_str
            if attempt == max_retries or not is_rate_limit:
                raise
            delay = base_delay * (3 ** attempt)
            logging.warning(f"Rate limited during {description}. Waiting {delay:.0f}s before retry (attempt {attempt + 1}/{max_retries})...")
            time.sleep(delay)

DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "postgres")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "postgres")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

ENRICHMENT_PROMPT = """You are analyzing an image from a story. You have:
1. The image itself
2. Surrounding text context (before and after in the chapter)
3. A list of known characters from the story

Based on ALL of this information, return a JSON object with:
- "characters": Array of full character names identified in the image
- "location": Specific location name from the story
- "scene": Brief description of the scene
- "plot_significance": One sentence on why this scene matters to the story

If you can't determine a field with confidence, use null.
Return ONLY valid JSON, no markdown formatting.

SURROUNDING TEXT:
{context}

KNOWN CHARACTERS:
{characters}
"""


def get_db_connection():
    return psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=DB_USER, password=DB_PASSWORD,
    )


def get_story_characters(cursor, story_id: str) -> List[str]:
    """Extract a rough character list from aggregated chapter text.

    Uses a simple heuristic: find capitalized multi-word names that appear
    frequently. In production, you'd maintain a proper characters table.
    """
    cursor.execute(
        "SELECT aggregated_text FROM chapters WHERE story_id = %s ORDER BY chapter_order",
        (story_id,),
    )
    all_text = " ".join(row[0] or "" for row in cursor.fetchall())

    # Simple heuristic: extract capitalized word sequences (2-4 words)
    import re
    name_pattern = re.compile(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b")
    candidates: Dict[str, int] = {}
    for match in name_pattern.finditer(all_text):
        name = match.group(1)
        # Filter out common non-names
        if name.split()[0] in ("The", "This", "That", "When", "After", "Before", "Chapter"):
            continue
        candidates[name] = candidates.get(name, 0) + 1

    # Return names appearing 3+ times, sorted by frequency
    return [name for name, count in sorted(candidates.items(), key=lambda x: -x[1]) if count >= 3][:50]


def get_surrounding_text(cursor, story_id: str, href: str) -> str:
    """Get text blocks surrounding an image in its chapter."""
    cursor.execute(
        """
        SELECT cb2.text_content
        FROM chapter_blocks cb1
        JOIN chapters c ON cb1.chapter_id = c.chapter_id
        JOIN chapter_blocks cb2 ON cb2.chapter_id = cb1.chapter_id
        WHERE c.story_id = %s
          AND cb1.image_src = %s
          AND cb2.block_type = 'text'
          AND cb2.text_content IS NOT NULL
          AND ABS(cb2.block_index - cb1.block_index) <= 3
        ORDER BY cb2.block_index
        LIMIT 6
        """,
        (story_id, href),
    )
    return "\n".join(row[0] for row in cursor.fetchall())


def get_assets_to_enrich(cursor, story_id: str) -> List[Dict[str, Any]]:
    """Get assets that have visual_description but no enriched_metadata."""
    cursor.execute(
        """
        SELECT asset_id, href, visual_description, visual_tags
        FROM assets
        WHERE story_id = %s
          AND visual_description IS NOT NULL
          AND (enriched_metadata IS NULL OR enriched_metadata = '{}')
        ORDER BY href
        """,
        (story_id,),
    )
    return [
        {"asset_id": r[0], "href": r[1], "visual_description": r[2], "visual_tags": r[3]}
        for r in cursor.fetchall()
    ]


def enrich_image(
    client: genai.Client,
    image_path: Optional[str],
    visual_description: str,
    context: str,
    characters: List[str],
) -> Optional[Dict[str, Any]]:
    """Use Gemini to enrich an image with full story context."""
    prompt = ENRICHMENT_PROMPT.format(
        context=context or "(no surrounding text found)",
        characters=", ".join(characters[:30]) if characters else "(no character list available)",
    )

    parts = []

    # Include the image if we can find it on disk
    if image_path:
        from pathlib import Path
        p = Path(image_path)
        if not p.exists():
            for prefix in ("processed", "dataset"):
                candidate = Path(prefix) / image_path
                if candidate.exists():
                    p = candidate
                    break

        if p.exists():
            ext = p.suffix.lower()
            mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
                    "gif": "image/gif", "webp": "image/webp"}.get(ext.lstrip("."), "image/jpeg")
            parts.append(
                genai_types.Part(
                    inline_data=genai_types.Blob(mime_type=mime, data=p.read_bytes())
                )
            )

    # Always include the text prompt (even without image, the visual description + context helps)
    if not parts:
        prompt = f"Based on this visual description: \"{visual_description}\"\n\n" + prompt

    parts.append(genai_types.Part(text=prompt))

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[genai_types.Content(parts=parts)],
        )
        text = (response.text or "").strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
        return json.loads(text.strip())
    except Exception as e:
        logging.warning(f"Enrichment failed: {e}")
        return None


def enrich_story(story_id: str, client: genai.Client):
    """Enrich all un-enriched assets for a story."""
    conn = get_db_connection()
    try:
        with conn:
            with conn.cursor() as cursor:
                characters = get_story_characters(cursor, story_id)
                logging.info(f"Found {len(characters)} candidate character names")

                assets = get_assets_to_enrich(cursor, story_id)
                asset_total = len(assets)
                if asset_total == 0:
                    logging.info("No assets to enrich — skipping.")
                    return

                num_batches = math.ceil(asset_total / ENRICHMENT_BATCH_SIZE)
                logging.info(f"Enriching {asset_total} assets in {num_batches} batches of {ENRICHMENT_BATCH_SIZE}...")

                enriched_count = 0
                failed_count = 0
                start_time = time.time()

                for batch_idx in range(0, asset_total, ENRICHMENT_BATCH_SIZE):
                    batch = assets[batch_idx:batch_idx + ENRICHMENT_BATCH_SIZE]
                    batch_num = batch_idx // ENRICHMENT_BATCH_SIZE + 1

                    for i, asset in enumerate(batch):
                        global_idx = batch_idx + i
                        item_start = time.time()
                        context = get_surrounding_text(cursor, story_id, asset["href"])

                        try:
                            enriched = _retry_with_backoff(
                                lambda a=asset, ctx=context: enrich_image(
                                    client, a["href"], a["visual_description"] or "", ctx, characters,
                                ),
                                description=f"enrichment ({asset['href']})",
                            )
                        except Exception as e:
                            logging.error(f"  [{global_idx + 1}/{asset_total}] Error: {asset['href']}: {e}")
                            enriched = None

                        item_elapsed = time.time() - item_start

                        if enriched:
                            cursor.execute(
                                """
                                UPDATE assets
                                SET enriched_metadata = %s, updated_at = NOW()
                                WHERE asset_id = %s
                                """,
                                (Json(enriched), asset["asset_id"]),
                            )
                            enriched_count += 1
                            # Calculate ETA
                            total_elapsed = time.time() - start_time
                            done = global_idx + 1
                            avg_per_item = total_elapsed / done
                            remaining = avg_per_item * (asset_total - done)
                            logging.info(f"  [{done}/{asset_total}] Enriched: {asset['href']} ({_format_duration(item_elapsed)}, ~{_format_duration(remaining)} remaining)")
                        else:
                            failed_count += 1
                            logging.warning(f"  [{global_idx + 1}/{asset_total}] Failed: {asset['href']}")

                        time.sleep(ENRICHMENT_DELAY)

                    logging.info(f"  Batch {batch_num}/{num_batches} complete ({min(batch_idx + ENRICHMENT_BATCH_SIZE, asset_total)}/{asset_total} assets)")

                    if batch_idx + ENRICHMENT_BATCH_SIZE < asset_total:
                        logging.info(f"  Pausing {ENRICHMENT_BATCH_PAUSE:.0f}s between batches...")
                        time.sleep(ENRICHMENT_BATCH_PAUSE)

        total_elapsed = time.time() - start_time
        logging.info(f"Enrichment complete: {enriched_count} enriched, {failed_count} failed ({_format_duration(total_elapsed)})")
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="Enrich image assets with full story context.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--story-id", type=str, help="UUID of the story to enrich.")
    group.add_argument("--all", action="store_true", help="Enrich all stories.")
    args = parser.parse_args()

    if not GEMINI_API_KEY:
        logging.error("GEMINI_API_KEY not set — cannot enrich images.")
        return

    client = genai.Client(api_key=GEMINI_API_KEY)

    if args.all:
        conn = get_db_connection()
        try:
            with conn.cursor() as cursor:
                cursor.execute("SELECT story_id, title FROM stories ORDER BY title")
                stories = cursor.fetchall()
        finally:
            conn.close()

        for story_id, title in stories:
            logging.info(f"\n=== Enriching: {title} ({story_id}) ===")
            enrich_story(str(story_id), client)
    else:
        enrich_story(args.story_id, client)


if __name__ == "__main__":
    main()
