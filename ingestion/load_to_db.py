import argparse
import json
import logging
import math
import os
import time
from pathlib import Path
from typing import List, Dict, Any, Optional

import psycopg2
from psycopg2.extras import Json
from google import genai
from google.genai import types as genai_types
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

# Embedding model configuration
EMBEDDING_MODEL = "gemini-embedding-001"
EMBEDDING_DIMENSIONS = 768
EMBEDDING_BATCH_SIZE = 100  # Gemini supports batching

# Rate limiting configuration
EMBEDDING_BATCH_DELAY = 1.5       # seconds between embedding batches
EMBEDDING_RETRY_DELAY = 0.5       # seconds between individual embedding retries
IMAGE_TAG_DELAY = 2.0             # seconds between image tagging calls
IMAGE_TAG_BATCH_SIZE = 5          # images per batch before longer pause
IMAGE_TAG_BATCH_PAUSE = 3.0       # seconds between image tagging batches
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

# Database connection
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "postgres")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "postgres")

# Gemini API
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    logging.warning("GEMINI_API_KEY not set — embeddings will be skipped")

def get_db_connection():
    try:
        conn = psycopg2.connect(
            host=DB_HOST,
            port=DB_PORT,
            dbname=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD
        )
        return conn
    except Exception as e:
        logging.error(f"Error connecting to database: {e}")
        raise

def load_json_data(file_path: Path) -> Dict[str, Any]:
    with open(file_path, 'r', encoding='utf-8') as f:
        return json.load(f)

def resolve_content_type(story_data: Dict[str, Any], cli_format: str | None) -> str:
    """Determine content_type from CLI --format flag or JSON data."""
    if cli_format in ("cbz", "cbr", "comic"):
        return "comic"
    if cli_format == "manga":
        return "manga"
    # Fall back to content_type in JSON (set by extract_comic.py)
    ct = story_data.get("content_type")
    if ct in ("comic", "manga"):
        return ct
    return "novel"


def insert_story(cursor, story_data: Dict[str, Any], content_type: str = "novel") -> str:
    """Insert story and return story_id."""
    # Check if story exists by external_id (using identifier as external_id)
    external_id = story_data.get("identifier")

    cursor.execute(
        "SELECT story_id FROM stories WHERE external_id = %s",
        (external_id,)
    )
    existing = cursor.fetchone()
    if existing:
        logging.info(f"Story {external_id} already exists. Updating...")
        story_id = existing[0]
        cursor.execute(
            """
            UPDATE stories
            SET title = %s, authors = %s, language = %s,
                content_type = %s, updated_at = NOW()
            WHERE story_id = %s
            """,
            (
                story_data.get("title"),
                story_data.get("authors", []),
                story_data.get("language"),
                content_type,
                story_id
            )
        )
        return story_id

    logging.info(f"Inserting new story: {story_data.get('title')}")
    cursor.execute(
        """
        INSERT INTO stories (external_id, title, authors, language, content_type)
        VALUES (%s, %s, %s, %s, %s)
        RETURNING story_id
        """,
        (
            external_id,
            story_data.get("title"),
            story_data.get("authors", []),
            story_data.get("language"),
            content_type
        )
    )
    return cursor.fetchone()[0]

def generate_embeddings_batch(client: genai.Client, texts: List[str]) -> List[List[float]]:
    """Generate embeddings for a batch of texts using Gemini embedding model."""
    response = client.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=texts,
        config=genai_types.EmbedContentConfig(output_dimensionality=EMBEDDING_DIMENSIONS),
    )
    return [e.values for e in response.embeddings]


IMAGE_TAG_PROMPT = """Analyze this image from a story/comic and return a JSON object with:
- "description": A concise visual description (1-2 sentences)
- "characters_visual": Array of character visual descriptions (e.g. "red-haired girl", "tall bearded man")
- "setting": Brief setting/location description
- "mood": One word for the mood (e.g. "tense", "peaceful", "comedic")
- "action": Brief description of what's happening

Return ONLY valid JSON, no markdown formatting."""


def tag_image_with_vision(
    client: genai.Client,
    image_data: bytes,
    media_type: str = "image/jpeg",
) -> Optional[Dict[str, Any]]:
    """Use Gemini vision to generate visual tags for an image."""
    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                genai_types.Content(
                    parts=[
                        genai_types.Part(
                            inline_data=genai_types.Blob(
                                mime_type=media_type,
                                data=image_data,
                            )
                        ),
                        genai_types.Part(text=IMAGE_TAG_PROMPT),
                    ]
                )
            ],
        )
        text = response.text or ""
        # Strip markdown code fences if present
        text = text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
        return json.loads(text)
    except Exception as e:
        logging.warning(f"Image tagging failed: {e}")
        return None


def upsert_asset_with_tags(
    cursor,
    story_id: str,
    href: str,
    visual_description: str,
    visual_tags: Dict[str, Any],
    client: genai.Client | None,
) -> Optional[str]:
    """Insert or update an asset record with visual tags, and embed the description."""
    cursor.execute(
        """
        INSERT INTO assets (story_id, href, visual_description, visual_tags)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (href) DO UPDATE
            SET visual_description = EXCLUDED.visual_description,
                visual_tags = EXCLUDED.visual_tags,
                updated_at = NOW()
        RETURNING asset_id
        """,
        (story_id, href, visual_description, Json(visual_tags)),
    )
    asset_id = cursor.fetchone()[0]

    # Embed the visual description for image retrieval
    if client and visual_description:
        try:
            embs = generate_embeddings_batch(client, [visual_description])
            cursor.execute(
                """
                INSERT INTO asset_embeddings (asset_id, model, dimensions, vector)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (asset_id, model) DO UPDATE SET vector = EXCLUDED.vector
                """,
                (asset_id, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, str(embs[0])),
            )
        except Exception as e:
            logging.warning(f"Asset embedding failed for {href}: {e}")

    return asset_id


def insert_chapters(cursor, story_id: str, chapters: List[Dict[str, Any]], client: genai.Client | None, tag_images: bool = False):
    """Insert chapters and blocks, generating embeddings via Gemini API."""
    chapter_count = len(chapters)
    total_blocks = sum(len(ch.get("content", [])) for ch in chapters)
    total_images = sum(1 for ch in chapters for b in ch.get("content", []) if b.get("type") == "image")
    logging.info(f"Processing {chapter_count} chapters ({total_blocks} blocks, {total_images} images)...")

    ingest_start = time.time()

    # Clear existing chapters for this story to avoid duplicates/conflicts on re-run
    cursor.execute("DELETE FROM chapters WHERE story_id = %s", (story_id,))

    # Collect all text blocks first, insert chapters/blocks, then batch-embed
    pending_embeddings: List[Dict[str, Any]] = []  # [{block_id, text}]
    pending_image_tags: List[Dict[str, Any]] = []  # [{image_src, image_data, media_type}]

    for ch_idx, chapter in enumerate(chapters):
        blocks = chapter.get("content", [])
        ch_images = sum(1 for b in blocks if b.get("type") == "image")
        logging.info(f"  [{ch_idx + 1}/{chapter_count}] Chapter \"{chapter.get('title', 'Untitled')}\" ({len(blocks)} blocks, {ch_images} images)")

        cursor.execute(
            """
            INSERT INTO chapters (story_id, chapter_order, title, aggregated_text, raw_html, metadata)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING chapter_id
            """,
            (
                story_id,
                chapter.get("order"),
                chapter.get("title"),
                chapter.get("text"),
                Json(chapter.get("raw_html", [])),
                Json({})
            )
        )
        chapter_id = cursor.fetchone()[0]

        # Insert Blocks
        for idx, block in enumerate(blocks):
            block_type = block.get("type")
            text_content = block.get("text")
            image_src = block.get("src")
            image_alt = block.get("alt")

            cursor.execute(
                """
                INSERT INTO chapter_blocks (chapter_id, block_index, block_type, text_content, image_src, image_alt)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING block_id
                """,
                (
                    chapter_id,
                    idx,
                    block_type,
                    text_content,
                    image_src,
                    image_alt
                )
            )
            block_id = cursor.fetchone()[0]

            # Queue text blocks for batch embedding
            if block_type == 'text' and text_content and len(text_content.strip()) > 10:
                pending_embeddings.append({"block_id": block_id, "text": text_content})

            # Queue images for batched tagging
            if tag_images and block_type == 'image' and image_src and client:
                image_path = _resolve_image_path(image_src)
                if image_path and image_path.exists():
                    pending_image_tags.append({
                        "image_src": image_src,
                        "image_data": image_path.read_bytes(),
                        "media_type": _guess_media_type(image_path),
                        "story_id": story_id,
                    })

    insert_elapsed = time.time() - ingest_start
    logging.info(f"Chapter/block insertion complete ({_format_duration(insert_elapsed)})")

    # --- Phase: Tag images in batches ---
    if pending_image_tags and client:
        images_tagged = 0
        images_failed = 0
        img_total = len(pending_image_tags)
        img_batches = math.ceil(img_total / IMAGE_TAG_BATCH_SIZE)
        logging.info(f"Tagging {img_total} images in {img_batches} batches of {IMAGE_TAG_BATCH_SIZE}...")
        tag_start = time.time()

        for batch_idx in range(0, img_total, IMAGE_TAG_BATCH_SIZE):
            batch = pending_image_tags[batch_idx:batch_idx + IMAGE_TAG_BATCH_SIZE]
            batch_num = batch_idx // IMAGE_TAG_BATCH_SIZE + 1

            for img_item in batch:
                tags = _retry_with_backoff(
                    lambda item=img_item: tag_image_with_vision(client, item["image_data"], item["media_type"]),
                    description=f"image tagging ({img_item['image_src']})",
                )
                if tags:
                    desc = tags.get("description", "")
                    upsert_asset_with_tags(cursor, img_item["story_id"], img_item["image_src"], desc, tags, client)
                    images_tagged += 1
                else:
                    images_failed += 1
                time.sleep(IMAGE_TAG_DELAY)

            done = min(batch_idx + IMAGE_TAG_BATCH_SIZE, img_total)
            elapsed = time.time() - tag_start
            logging.info(f"  Image tagging batch {batch_num}/{img_batches} complete ({done}/{img_total} images, {_format_duration(elapsed)} elapsed)")

            if batch_idx + IMAGE_TAG_BATCH_SIZE < img_total:
                logging.info(f"  Pausing {IMAGE_TAG_BATCH_PAUSE:.0f}s between image batches...")
                time.sleep(IMAGE_TAG_BATCH_PAUSE)

        tag_elapsed = time.time() - tag_start
        logging.info(f"Image tagging complete: {images_tagged} tagged, {images_failed} failed ({_format_duration(tag_elapsed)})")

    # --- Phase: Generate embeddings in batches ---
    if not client:
        logging.warning("No Gemini client — skipping embedding generation")
        total_elapsed = time.time() - ingest_start
        logging.info(f"Ingestion complete in {_format_duration(total_elapsed)} (no embeddings)")
        return

    total = len(pending_embeddings)
    num_batches = math.ceil(total / EMBEDDING_BATCH_SIZE)
    logging.info(f"Generating embeddings for {total} text blocks in {num_batches} batches...")
    embed_start = time.time()
    embedded_count = 0
    skipped_count = 0

    for i in range(0, total, EMBEDDING_BATCH_SIZE):
        batch = pending_embeddings[i:i + EMBEDDING_BATCH_SIZE]
        texts = [item["text"] for item in batch]
        batch_num = i // EMBEDDING_BATCH_SIZE + 1

        try:
            embeddings = _retry_with_backoff(
                lambda t=texts: generate_embeddings_batch(client, t),
                description=f"embedding batch {batch_num}/{num_batches}",
            )
        except Exception as e:
            logging.error(f"Embedding batch {batch_num}/{num_batches} failed: {e}")
            logging.info(f"  Retrying {len(batch)} blocks individually...")
            for item in batch:
                try:
                    single = _retry_with_backoff(
                        lambda t=item["text"]: generate_embeddings_batch(client, [t]),
                        description=f"individual embedding (block {item['block_id']})",
                    )
                    cursor.execute(
                        """
                        INSERT INTO block_embeddings (block_id, model, dimensions, vector)
                        VALUES (%s, %s, %s, %s)
                        """,
                        (item["block_id"], EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, str(single[0]))
                    )
                    embedded_count += 1
                except Exception as inner_e:
                    logging.error(f"  Skipping block {item['block_id']}: {inner_e}")
                    skipped_count += 1
                time.sleep(EMBEDDING_RETRY_DELAY)
            continue

        for item, emb in zip(batch, embeddings):
            cursor.execute(
                """
                INSERT INTO block_embeddings (block_id, model, dimensions, vector)
                VALUES (%s, %s, %s, %s)
                """,
                (item["block_id"], EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, str(emb))
            )
        embedded_count += len(batch)

        elapsed = time.time() - embed_start
        logging.info(f"  Embedded {min(i + EMBEDDING_BATCH_SIZE, total)}/{total} blocks (batch {batch_num}/{num_batches}, {_format_duration(elapsed)} elapsed)")

        if i + EMBEDDING_BATCH_SIZE < total:
            time.sleep(EMBEDDING_BATCH_DELAY)

    embed_elapsed = time.time() - embed_start
    total_elapsed = time.time() - ingest_start
    logging.info(f"Embedding complete: {embedded_count} embedded, {skipped_count} skipped ({_format_duration(embed_elapsed)})")
    logging.info(f"Total ingestion time: {_format_duration(total_elapsed)}")

def _resolve_image_path(image_src: str) -> Optional[Path]:
    """Attempt to resolve an image source path to a local file."""
    # Try relative to CWD and common locations
    candidates = [
        Path(image_src),
        Path("processed") / image_src,
        Path("dataset") / image_src,
    ]
    for p in candidates:
        if p.exists():
            return p
    return None


def _guess_media_type(path: Path) -> str:
    """Guess MIME type from file extension."""
    ext = path.suffix.lower()
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
    }.get(ext, "image/jpeg")


def main():
    parser = argparse.ArgumentParser(description="Load processed JSON into Postgres.")
    parser.add_argument("input", type=Path, help="Path to processed JSON file.")
    parser.add_argument(
        "--format",
        choices=["epub", "cbz", "cbr", "comic", "manga"],
        default=None,
        help="Source format hint — sets content_type on the story (default: auto-detect from JSON).",
    )
    parser.add_argument(
        "--tag-images",
        action="store_true",
        help="Enable Phase 3 image tagging with Gemini vision during ingestion.",
    )
    args = parser.parse_args()

    if not args.input.exists():
        logging.error(f"File not found: {args.input}")
        return

    # Initialize Gemini client for embeddings
    client = None
    if GEMINI_API_KEY:
        logging.info(f"Initializing Gemini embedding model ({EMBEDDING_MODEL})...")
        client = genai.Client(api_key=GEMINI_API_KEY)
    else:
        logging.warning("No GEMINI_API_KEY — blocks will be inserted without embeddings")

    conn = get_db_connection()
    try:
        with conn:
            with conn.cursor() as cursor:
                data = load_json_data(args.input)
                content_type = resolve_content_type(data, args.format)

                chapters = data.get("chapters", [])
                total_blocks = sum(len(ch.get("content", [])) for ch in chapters)
                logging.info("=" * 60)
                logging.info(f"Story: {data.get('title', 'Unknown')}")
                logging.info(f"Authors: {', '.join(data.get('authors', ['Unknown']))}")
                logging.info(f"Content type: {content_type}")
                logging.info(f"Chapters: {len(chapters)}, Blocks: {total_blocks}")
                logging.info(f"Image tagging: {'enabled' if args.tag_images else 'disabled'}")
                logging.info("=" * 60)

                story_id = insert_story(cursor, data, content_type)
                insert_chapters(cursor, story_id, chapters, client, tag_images=args.tag_images)
        logging.info("Successfully loaded story into database.")
    finally:
        conn.close()

if __name__ == "__main__":
    main()
