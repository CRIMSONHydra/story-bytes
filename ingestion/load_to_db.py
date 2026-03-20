import argparse
import json
import logging
import os
import time
from pathlib import Path
from typing import List, Dict, Any

import psycopg2
from psycopg2.extras import Json
from google import genai
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

# Embedding model configuration
EMBEDDING_MODEL = "text-embedding-004"
EMBEDDING_DIMENSIONS = 768
EMBEDDING_BATCH_SIZE = 100  # Gemini supports batching

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

def insert_story(cursor, story_data: Dict[str, Any]) -> str:
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
            SET title = %s, authors = %s, language = %s, updated_at = NOW()
            WHERE story_id = %s
            """,
            (
                story_data.get("title"),
                story_data.get("authors", []),
                story_data.get("language"),
                story_id
            )
        )
        return story_id

    logging.info(f"Inserting new story: {story_data.get('title')}")
    cursor.execute(
        """
        INSERT INTO stories (external_id, title, authors, language)
        VALUES (%s, %s, %s, %s)
        RETURNING story_id
        """,
        (
            external_id,
            story_data.get("title"),
            story_data.get("authors", []),
            story_data.get("language")
        )
    )
    return cursor.fetchone()[0]

def generate_embeddings_batch(client: genai.Client, texts: List[str]) -> List[List[float]]:
    """Generate embeddings for a batch of texts using Gemini text-embedding-004."""
    response = client.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=texts,
    )
    return [e.values for e in response.embeddings]


def insert_chapters(cursor, story_id: str, chapters: List[Dict[str, Any]], client: genai.Client | None):
    """Insert chapters and blocks, generating embeddings via Gemini API."""
    logging.info(f"Processing {len(chapters)} chapters...")

    # Clear existing chapters for this story to avoid duplicates/conflicts on re-run
    cursor.execute("DELETE FROM chapters WHERE story_id = %s", (story_id,))

    # Collect all text blocks first, insert chapters/blocks, then batch-embed
    pending_embeddings: List[Dict[str, Any]] = []  # [{block_id, text}]

    for chapter in chapters:
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
        blocks = chapter.get("content", [])
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

    # Generate embeddings in batches
    if not client:
        logging.warning("No Gemini client — skipping embedding generation")
        return

    total = len(pending_embeddings)
    logging.info(f"Generating embeddings for {total} text blocks...")

    for i in range(0, total, EMBEDDING_BATCH_SIZE):
        batch = pending_embeddings[i:i + EMBEDDING_BATCH_SIZE]
        texts = [item["text"] for item in batch]

        try:
            embeddings = generate_embeddings_batch(client, texts)
        except Exception as e:
            logging.error(f"Embedding batch {i // EMBEDDING_BATCH_SIZE + 1} failed: {e}")
            # Retry with smaller sub-batches on failure
            for item in batch:
                try:
                    single = generate_embeddings_batch(client, [item["text"]])
                    cursor.execute(
                        """
                        INSERT INTO block_embeddings (block_id, model, dimensions, vector)
                        VALUES (%s, %s, %s, %s)
                        """,
                        (item["block_id"], EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, str(single[0]))
                    )
                except Exception as inner_e:
                    logging.error(f"Skipping block {item['block_id']}: {inner_e}")
            continue

        for item, emb in zip(batch, embeddings):
            cursor.execute(
                """
                INSERT INTO block_embeddings (block_id, model, dimensions, vector)
                VALUES (%s, %s, %s, %s)
                """,
                (item["block_id"], EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, str(emb))
            )

        logging.info(f"  Embedded {min(i + EMBEDDING_BATCH_SIZE, total)}/{total} blocks")

        # Rate limiting: Gemini has quotas, small delay between batches
        if i + EMBEDDING_BATCH_SIZE < total:
            time.sleep(0.5)

def main():
    parser = argparse.ArgumentParser(description="Load processed JSON into Postgres.")
    parser.add_argument("input", type=Path, help="Path to processed JSON file.")
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
                story_id = insert_story(cursor, data)
                insert_chapters(cursor, story_id, data.get("chapters", []), client)
        logging.info("Successfully loaded story into database.")
    finally:
        conn.close()

if __name__ == "__main__":
    main()
