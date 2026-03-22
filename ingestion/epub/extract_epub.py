import argparse
import json
import logging
import posixpath
import re
from pathlib import Path
from typing import Iterable, List, Optional, Sequence
from urllib.parse import urljoin

from bs4 import BeautifulSoup, NavigableString, Tag
from ebooklib import ITEM_DOCUMENT, ITEM_IMAGE, epub


def metadata_values(book: epub.EpubBook, namespace: str, name: str) -> List[str]:
    return [entry[0] for entry in book.get_metadata(namespace, name)]


def normalise_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def resolve_href(base: str, src: Optional[str]) -> Optional[str]:
    if not src:
        return None
    base_dir = posixpath.dirname(base)
    return posixpath.normpath(urljoin(f"{base_dir}/", src))


def flatten_toc(toc: Sequence) -> List[epub.Link]:
    items: List[epub.Link] = []

    def _walk(entries: Sequence) -> None:
        for entry in entries:
            if isinstance(entry, epub.Link):
                items.append(entry)
            elif isinstance(entry, (list, tuple)):
                _walk(entry)
            else:
                subitems = getattr(entry, "subitems", None)
                if subitems:
                    _walk(subitems)

    _walk(toc)
    return items


BLOCK_TAGS = frozenset({"p", "div", "section", "article", "blockquote", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr"})
SCENE_BREAK_RE = re.compile(r"^\s*(\*{3,}|[—–-]{3,}|#\s*#\s*#)\s*$")


def extract_blocks_from_html(item: epub.EpubHtml) -> List[dict]:
    soup = BeautifulSoup(item.get_content(), "lxml-xml")
    body = soup.body or soup
    blocks: List[dict] = []
    paragraphs: List[str] = []  # accumulates paragraphs within a text block
    buffer: List[str] = []  # accumulates words within a paragraph

    def flush_paragraph() -> None:
        if buffer:
            text = normalise_whitespace(" ".join(buffer))
            if text:
                # Detect scene breaks like *** or ---
                if SCENE_BREAK_RE.match(text):
                    flush_text()
                    blocks.append({"type": "text", "text": "***"})
                else:
                    paragraphs.append(text)
            buffer.clear()

    def flush_text() -> None:
        flush_paragraph()
        if paragraphs:
            blocks.append({"type": "text", "text": "\n\n".join(paragraphs)})
            paragraphs.clear()

    for node in body.descendants:
        if isinstance(node, NavigableString):
            if node.parent and node.parent.name and node.parent.name.lower() in {"script", "style"}:
                continue
            text = normalise_whitespace(str(node))
            if text:
                buffer.append(text)
        elif isinstance(node, Tag) and node.name:
            tag = node.name.lower()
            if tag == "img":
                flush_text()
                src = resolve_href(item.get_name(), node.get("src"))
                blocks.append(
                    {
                        "type": "image",
                        "src": src,
                        "alt": normalise_whitespace(node.get("alt", "")) or None,
                    }
                )
            elif tag == "hr":
                flush_text()
                blocks.append({"type": "text", "text": "***"})
            elif tag == "br":
                flush_paragraph()
            elif tag in BLOCK_TAGS:
                flush_paragraph()
    flush_text()
    return blocks


def aggregate_chapter_text(blocks: List[dict]) -> str:
    texts = [block["text"] for block in blocks if block.get("type") == "text" and block.get("text")]
    return "\n\n".join(texts).strip()


def infer_title_from_blocks(blocks: List[dict]) -> Optional[str]:
    for block in blocks:
        if block.get("type") == "text" and block.get("text"):
            return block["text"][:120]
    return None


def build_chapters(book: epub.EpubBook) -> List[dict]:
    spine_ids: List[str] = []
    for entry in book.spine:
        identifier = entry[0] if isinstance(entry, tuple) else entry
        if identifier and identifier != "nav":
            spine_ids.append(identifier)

    spine_items = [book.get_item_with_id(identifier) for identifier in spine_ids]
    spine_map = {item.get_id(): index for index, item in enumerate(spine_items) if item is not None}

    toc_links = flatten_toc(book.toc)
    toc_entries = []
    for link in toc_links:
        href = (link.href or "").split("#")[0]
        if not href:
            continue
        item = book.get_item_with_href(href)
        if not item:
            continue
        item_id = item.get_id()
        if item_id not in spine_map:
            continue
        toc_entries.append(
            {
                "title": link.title,
                "item": item,
                "spine_index": spine_map[item_id],
            }
        )

    toc_entries.sort(key=lambda entry: entry["spine_index"])

    chapters: List[dict] = []
    for idx, entry in enumerate(toc_entries):
        start = entry["spine_index"]
        end = toc_entries[idx + 1]["spine_index"] if idx + 1 < len(toc_entries) else len(spine_items)
        segment_items = [spine_items[i] for i in range(start, end) if spine_items[i] is not None]

        content_blocks: List[dict] = []
        source_ids: List[str] = []
        source_hrefs: List[str] = []
        raw_html_parts: List[str] = []

        for segment_item in segment_items:
            source_ids.append(segment_item.get_id())
            source_hrefs.append(segment_item.get_name())

            if segment_item.get_type() == ITEM_DOCUMENT:
                blocks = extract_blocks_from_html(segment_item)
                content_blocks.extend(blocks)
                raw_html_parts.append(segment_item.get_content().decode("utf-8", errors="ignore"))
            elif segment_item.get_type() == ITEM_IMAGE:
                content_blocks.append(
                    {"type": "image", "src": segment_item.get_name(), "alt": None}
                )

        chapter_text = aggregate_chapter_text(content_blocks)
        chapter_title = entry["title"] or infer_title_from_blocks(content_blocks)

        chapters.append(
            {
                "title": chapter_title,
                "order": idx,
                "sources": source_hrefs,
                "source_ids": source_ids,
                "content": content_blocks,
                "text": chapter_text,
                "raw_html": raw_html_parts,
            }
        )

    return chapters


def serialise_book(book: epub.EpubBook) -> dict:
    title_meta = metadata_values(book, "DC", "title")
    creator_meta = metadata_values(book, "DC", "creator")
    identifier_meta = metadata_values(book, "DC", "identifier")
    language_meta = metadata_values(book, "DC", "language")
    return {
        "title": title_meta[0] if title_meta else getattr(book, "title", None),
        "authors": creator_meta,
        "identifier": identifier_meta[0] if identifier_meta else getattr(book, "uid", None),
        "language": language_meta[0] if language_meta else None,
        "chapters": build_chapters(book),
    }


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def process_epub(epub_path: Path, output_dir: Path) -> Path:
    logging.info("Processing %s", epub_path)
    book = epub.read_epub(str(epub_path))
    data = serialise_book(book)
    output_path = ensure_dir(output_dir) / f"{epub_path.stem}.json"
    output_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    logging.info("Saved %s", output_path)
    return output_path


def iter_epubs(path: Path) -> Iterable[Path]:
    if path.is_file() and path.suffix.lower() == ".epub":
        yield path
    elif path.is_dir():
        yield from sorted(path.rglob("*.epub"))
    else:
        raise FileNotFoundError(f"No EPUB files found at {path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract text from EPUB files into JSON.")
    parser.add_argument("input", type=Path, help="Path to an EPUB file or directory containing EPUBs.")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("processed"),
        help="Directory where extracted JSON files will be saved.",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="Enable verbose logging.")
    return parser.parse_args()


def configure_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(level=level, format="%(asctime)s [%(levelname)s] %(message)s")


def main() -> None:
    args = parse_args()
    configure_logging(args.verbose)
    ensure_dir(args.output)
    for epub_file in iter_epubs(args.input):
        try:
            process_epub(epub_file, args.output)
        except Exception:
            logging.exception("Failed to process %s", epub_file)


if __name__ == "__main__":
    main()

