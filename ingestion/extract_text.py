"""Extract plain-text / Markdown into the processed-JSON shape (M13).

Splits on Markdown headings (`#`/`##`/`###`) or `Chapter N` / `Prologue` / `Epilogue` lines; if none
are found the whole file becomes one chapter. `--single-chapter` forces one chapter (paste/append).
Output matches the EPUB/comic extractors so `load_to_db.py` consumes it unchanged.

Usage:
    uv run --project ingestion python ingestion/extract_text.py book.md -o processed -v
    uv run --project ingestion python ingestion/extract_text.py note.txt -o out --single-chapter --title "Chapter 12"
"""

import argparse
import json
import logging
import re
import sys
from pathlib import Path
from typing import List, Tuple

_HEADING = re.compile(r"^\s{0,3}#{1,3}\s+(.*\S)\s*$")
_CHAPTER = re.compile(r"^\s*(chapter\s+[\w\d]+.*|prologue|epilogue|interlude)\s*$", re.IGNORECASE)


def split_chapters(text: str) -> List[Tuple[str, str]]:
    """Return [(title, body), ...] split on heading / chapter lines. Empty bodies are dropped."""
    chapters: List[Tuple[str, str]] = []
    cur_title: str = ""
    cur_lines: List[str] = []

    def flush() -> None:
        body = "\n".join(cur_lines).strip()
        if body:
            chapters.append((cur_title, body))

    for line in text.splitlines():
        heading = _HEADING.match(line)
        if heading:
            flush()
            cur_title, cur_lines[:] = heading.group(1).strip(), []
        elif _CHAPTER.match(line):
            flush()
            cur_title, cur_lines[:] = line.strip(), []
        else:
            cur_lines.append(line)
    flush()
    return chapters


def build_chapters(text: str, title_hint: str, single: bool) -> List[dict]:
    pairs = [(title_hint, text.strip())] if single else (split_chapters(text) or [(title_hint, text.strip())])
    pairs = [(t, b) for (t, b) in pairs if b.strip()]
    single_chapter = len(pairs) == 1
    return [
        {
            # A lone untitled chapter (a headingless file) takes the story title, not "Chapter 1".
            "title": title or (title_hint if single_chapter else f"Chapter {i + 1}"),
            "order": i,
            "content": [{"type": "text", "text": body}],
            "text": body,
            "raw_html": [],
        }
        for i, (title, body) in enumerate(pairs)
    ]


def main() -> None:
    ap = argparse.ArgumentParser(description="Extract .txt/.md into the processed JSON shape.")
    ap.add_argument("input", type=Path)
    ap.add_argument("-o", "--output", type=Path, default=Path("processed"))
    ap.add_argument("--single-chapter", action="store_true", help="Treat the whole file as one chapter.")
    ap.add_argument("--title", default=None, help="Story (or single-chapter) title override.")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(message)s", stream=sys.stderr)

    text = args.input.read_text(encoding="utf-8", errors="replace")
    stem = args.input.stem
    title = args.title or re.sub(r"[_-]+", " ", stem).strip() or stem
    data = {
        "title": title, "authors": [], "identifier": stem, "language": "en",
        "content_type": "novel", "chapters": build_chapters(text, title, args.single_chapter),
    }
    args.output.mkdir(parents=True, exist_ok=True)
    out_path = args.output / f"{stem}.json"
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    logging.info(f"Wrote {out_path} ({len(data['chapters'])} chapters)")


if __name__ == "__main__":
    main()
