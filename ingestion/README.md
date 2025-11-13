# Ingestion Pipelines (Python)

This directory contains Python tooling used to transform source media into structured story data.

Current modules:

- `epub/` – EPUB parsing utilities (text + image extraction) built with `ebooklib`, `BeautifulSoup`, and friends.
- `ocr/` – (planned) OCR pipelines for comic panels and images.
- `embeddings/` – (planned) embedding generation and RAG preparation.

## Environment

- Python 3.12 managed via [`uv`](https://github.com/astral-sh/uv) (as per local dev environment).
- Dependencies installed inside `.venv` (see project root instructions).

## Running the EPUB extractor

```bash
uv run python ingestion/epub/extract_epub.py dataset/Jobless\\ reincarnation -o processed -v
```

Outputs JSON documents under `processed/` with chapter-aligned content blocks, images, and provenance metadata.

Future tasks will extend this pipeline to:

- push extracted data into PostgreSQL (`db/schema.sql`);
- perform OCR over panel images;
- compute embeddings and cache them in pgvector / local vector store.

