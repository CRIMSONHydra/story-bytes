"""Extract a PDF into the processed-JSON shape (M13), using pdfplumber (MIT — not AGPL PyMuPDF).

Pulls text per page, joins it, and reuses `extract_text.build_chapters` for chapter splitting so
`.pdf` behaves like `.txt/.md`. Scanned/image-only PDFs yield little text (no OCR here).

Usage:
    uv run --project ingestion python ingestion/extract_pdf.py book.pdf -o processed -v
"""

import argparse
import json
import logging
import re
import sys
from pathlib import Path

try:  # dual import: package (pytest / -m) vs standalone (ingestion/ on sys.path)
    from ingestion.extract_text import build_chapters
except ImportError:  # pragma: no cover
    from extract_text import build_chapters


def main() -> None:
    ap = argparse.ArgumentParser(description="Extract a PDF into the processed JSON shape.")
    ap.add_argument("input", type=Path)
    ap.add_argument("-o", "--output", type=Path, default=Path("processed"))
    ap.add_argument("--single-chapter", action="store_true", help="Treat the whole PDF as one chapter.")
    ap.add_argument("--title", default=None, help="Story title override.")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(message)s", stream=sys.stderr)

    import pdfplumber  # local import so the module loads even if the dep is missing until installed

    with pdfplumber.open(str(args.input)) as pdf:
        pages = [page.extract_text() or "" for page in pdf.pages]
    text = "\n\n".join(pages).strip()
    if not text:
        logging.warning("No extractable text (scanned/image-only PDF?) — output will be empty.")

    stem = args.input.stem
    title = args.title or re.sub(r"[_-]+", " ", stem).strip() or stem
    data = {
        "title": title, "authors": [], "identifier": stem, "language": "en",
        "content_type": "novel", "chapters": build_chapters(text, title, args.single_chapter),
    }
    args.output.mkdir(parents=True, exist_ok=True)
    out_path = args.output / f"{stem}.json"
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    logging.info(f"Wrote {out_path} ({len(data['chapters'])} chapters, {len(pages)} pages)")


if __name__ == "__main__":
    main()
