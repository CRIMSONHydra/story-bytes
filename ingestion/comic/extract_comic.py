"""Extract comic archives (CBZ/CBR) into the same JSON format as EPUB extraction.

CBZ files are ZIP archives of page images. CBR files are RAR archives.
Pages are sorted numerically, grouped into chapters, and optionally OCR'd.

Output JSON structure (matches EPUB extraction):
{
    "title": "Comic Title",
    "authors": [],
    "identifier": "filename-stem",
    "language": null,
    "content_type": "comic",
    "chapters": [
        {
            "title": "Chapter 1",
            "order": 0,
            "sources": ["page_001.jpg", ...],
            "source_ids": ["page_001.jpg", ...],
            "content": [
                {"type": "image", "src": "page_001.jpg", "alt": null},
                {"type": "text", "text": "OCR'd text..."}  // if OCR enabled
            ],
            "text": "aggregated OCR text",
            "raw_html": []
        }
    ]
}
"""

import argparse
import json
import logging
import re
import zipfile
from io import BytesIO
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

logger = logging.getLogger(__name__)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".webp"}


def natural_sort_key(name: str) -> List:
    """Sort key that handles numeric parts naturally (page2 < page10)."""
    return [
        int(part) if part.isdigit() else part.lower()
        for part in re.split(r"(\d+)", name)
    ]


def is_image_file(name: str) -> bool:
    """Check if a filename has an image extension."""
    return Path(name).suffix.lower() in IMAGE_EXTENSIONS


def extract_zip_pages(archive_path: Path) -> List[Tuple[str, bytes]]:
    """Extract image pages from a CBZ (ZIP) archive."""
    pages: List[Tuple[str, bytes]] = []
    with zipfile.ZipFile(archive_path, "r") as zf:
        image_names = sorted(
            [n for n in zf.namelist() if is_image_file(n) and not n.startswith("__MACOSX")],
            key=natural_sort_key,
        )
        for name in image_names:
            pages.append((name, zf.read(name)))
    return pages


def extract_rar_pages(archive_path: Path) -> List[Tuple[str, bytes]]:
    """Extract image pages from a CBR (RAR) archive."""
    try:
        import rarfile
    except ImportError:
        raise ImportError(
            "rarfile package required for CBR support. "
            "Install with: pip install rarfile\n"
            "Also requires unrar binary: sudo apt install unrar"
        )

    pages: List[Tuple[str, bytes]] = []
    with rarfile.RarFile(str(archive_path), "r") as rf:
        image_names = sorted(
            [n for n in rf.namelist() if is_image_file(n)],
            key=natural_sort_key,
        )
        for name in image_names:
            pages.append((name, rf.read(name)))
    return pages


def extract_pages(archive_path: Path) -> List[Tuple[str, bytes]]:
    """Extract pages from either CBZ or CBR archive."""
    suffix = archive_path.suffix.lower()
    if suffix == ".cbz":
        return extract_zip_pages(archive_path)
    elif suffix == ".cbr":
        return extract_rar_pages(archive_path)
    else:
        raise ValueError(f"Unsupported archive format: {suffix} (expected .cbz or .cbr)")


def parse_chapter_breaks(breaks_str: str, total_pages: int) -> List[int]:
    """Parse comma-separated page indices into chapter break points.

    Each number is the 0-based index of the first page of a new chapter.
    Always starts with 0 if not explicitly provided.
    """
    indices = sorted(set(int(x.strip()) for x in breaks_str.split(",") if x.strip()))
    if not indices or indices[0] != 0:
        indices.insert(0, 0)
    # Filter out indices beyond total pages
    return [i for i in indices if i < total_pages]


def group_into_chapters(
    pages: List[Tuple[str, bytes]],
    chapter_breaks: Optional[List[int]] = None,
) -> List[List[Tuple[str, bytes]]]:
    """Group pages into chapters based on break points.

    If no breaks provided, all pages form a single chapter.
    """
    if not chapter_breaks or len(chapter_breaks) <= 1:
        return [pages]

    chapters: List[List[Tuple[str, bytes]]] = []
    for i, start in enumerate(chapter_breaks):
        end = chapter_breaks[i + 1] if i + 1 < len(chapter_breaks) else len(pages)
        chapters.append(pages[start:end])
    return chapters


def build_chapter_data(
    chapter_pages: List[Tuple[str, bytes]],
    chapter_order: int,
    title: Optional[str] = None,
    ocr_lang: str = "eng",
    enable_ocr: bool = False,
    manga_ocr: bool = False,
) -> Dict:
    """Build a chapter dict matching the EPUB extraction JSON format."""
    content_blocks: List[Dict] = []
    source_names: List[str] = []
    ocr_texts: List[str] = []

    for page_name, page_data in chapter_pages:
        source_names.append(page_name)

        # Image block
        content_blocks.append({
            "type": "image",
            "src": page_name,
            "alt": None,
        })

        # OCR text block (if enabled)
        if enable_ocr:
            text = _run_ocr(page_data, lang=ocr_lang, manga=manga_ocr)
            if text:
                content_blocks.append({"type": "text", "text": text})
                ocr_texts.append(text)

    aggregated_text = "\n\n".join(ocr_texts).strip()
    chapter_title = title or f"Chapter {chapter_order + 1}"

    return {
        "title": chapter_title,
        "order": chapter_order,
        "sources": source_names,
        "source_ids": source_names,
        "content": content_blocks,
        "text": aggregated_text,
        "raw_html": [],
    }


def _run_ocr(image_data: bytes, lang: str = "eng", manga: bool = False) -> Optional[str]:
    """Run OCR on image bytes, returns None if OCR unavailable."""
    try:
        from ingestion.comic.ocr import ocr_image_bytes

        return ocr_image_bytes(image_data, lang=lang, manga=manga)
    except ImportError:
        # Fallback: try direct import when running as script
        try:
            from ocr import ocr_image_bytes

            return ocr_image_bytes(image_data, lang=lang, manga=manga)
        except ImportError:
            logger.warning("OCR module not available — skipping text extraction")
            return None


def process_comic(
    archive_path: Path,
    output_dir: Path,
    chapter_breaks: Optional[List[int]] = None,
    ocr_lang: str = "eng",
    enable_ocr: bool = False,
    manga_ocr: bool = False,
    content_type: str = "comic",
) -> Path:
    """Process a comic archive into the standard JSON format.

    Args:
        archive_path: Path to CBZ/CBR file.
        output_dir: Directory for output JSON.
        chapter_breaks: Optional list of page indices marking chapter starts.
        ocr_lang: Tesseract language code for OCR.
        enable_ocr: Whether to run OCR on pages.
        manga_ocr: Use manga-ocr instead of Tesseract.
        content_type: 'comic' or 'manga'.

    Returns:
        Path to the output JSON file.
    """
    logger.info("Processing %s", archive_path)

    pages = extract_pages(archive_path)
    logger.info("Extracted %d pages from %s", len(pages), archive_path.name)

    if not pages:
        raise ValueError(f"No image pages found in {archive_path}")

    chapter_groups = group_into_chapters(pages, chapter_breaks)
    logger.info("Organized into %d chapter(s)", len(chapter_groups))

    chapters = []
    for i, chapter_pages in enumerate(chapter_groups):
        chapter = build_chapter_data(
            chapter_pages,
            chapter_order=i,
            ocr_lang=ocr_lang,
            enable_ocr=enable_ocr,
            manga_ocr=manga_ocr,
        )
        chapters.append(chapter)
        logger.info(
            "  Chapter %d: %d pages, %d content blocks",
            i + 1,
            len(chapter_pages),
            len(chapter["content"]),
        )

    data = {
        "title": archive_path.stem,
        "authors": [],
        "identifier": archive_path.stem,
        "language": None,
        "content_type": content_type,
        "chapters": chapters,
    }

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{archive_path.stem}.json"
    output_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("Saved %s", output_path)
    return output_path


def iter_archives(path: Path) -> Iterable[Path]:
    """Yield comic archive files from a path (file or directory)."""
    if path.is_file() and path.suffix.lower() in {".cbz", ".cbr"}:
        yield path
    elif path.is_dir():
        for ext in ("*.cbz", "*.cbr"):
            yield from sorted(path.rglob(ext))
    else:
        raise FileNotFoundError(f"No comic archives found at {path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract comic archives (CBZ/CBR) into JSON for ingestion."
    )
    parser.add_argument(
        "input",
        type=Path,
        help="Path to a CBZ/CBR file or directory containing comic archives.",
    )
    parser.add_argument(
        "-o", "--output",
        type=Path,
        default=Path("processed"),
        help="Directory where extracted JSON files will be saved.",
    )
    parser.add_argument(
        "--chapter-breaks",
        type=str,
        default=None,
        help="Comma-separated 0-based page indices marking chapter starts (e.g. '0,24,50').",
    )
    parser.add_argument(
        "--ocr",
        action="store_true",
        help="Enable OCR text extraction from page images.",
    )
    parser.add_argument(
        "--ocr-lang",
        type=str,
        default="eng",
        help="Tesseract language code for OCR (default: eng).",
    )
    parser.add_argument(
        "--manga",
        action="store_true",
        help="Use manga-ocr for Japanese text (implies --ocr).",
    )
    parser.add_argument(
        "--content-type",
        choices=["comic", "manga"],
        default="comic",
        help="Content type tag for the story (default: comic).",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Enable verbose logging.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(level=level, format="%(asctime)s [%(levelname)s] %(message)s")

    chapter_breaks = None
    if args.chapter_breaks:
        # We'll compute breaks per-archive after extracting pages
        chapter_breaks_str = args.chapter_breaks

    enable_ocr = args.ocr or args.manga

    for archive in iter_archives(args.input):
        try:
            pages = extract_pages(archive)
            breaks = None
            if args.chapter_breaks:
                breaks = parse_chapter_breaks(args.chapter_breaks, len(pages))

            process_comic(
                archive,
                args.output,
                chapter_breaks=breaks,
                ocr_lang=args.ocr_lang,
                enable_ocr=enable_ocr,
                manga_ocr=args.manga,
                content_type=args.content_type,
            )
        except Exception:
            logger.exception("Failed to process %s", archive)


if __name__ == "__main__":
    main()
