"""OCR pipeline for comic page images.

Extracts text from comic/manga page images using Tesseract OCR.
Includes preprocessing (grayscale + threshold) for cleaner results.
"""

import logging
from io import BytesIO
from pathlib import Path
from typing import Optional

from PIL import Image, ImageFilter, ImageOps

logger = logging.getLogger(__name__)

# Supported image extensions
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".webp"}


def preprocess_for_ocr(image: Image.Image) -> Image.Image:
    """Convert to grayscale, sharpen, and apply adaptive thresholding."""
    gray = ImageOps.grayscale(image)
    sharpened = gray.filter(ImageFilter.SHARPEN)
    # Simple binarization threshold for cleaner OCR
    return sharpened.point(lambda px: 255 if px > 180 else 0)


def ocr_image(
    image: Image.Image,
    lang: str = "eng",
    manga: bool = False,
) -> Optional[str]:
    """Run OCR on a PIL Image and return extracted text.

    Args:
        image: PIL Image to OCR.
        lang: Tesseract language code (e.g. "eng", "jpn").
        manga: If True, attempt to use manga-ocr for Japanese text.

    Returns:
        Extracted text or None if no text found / OCR unavailable.
    """
    if manga:
        return _ocr_manga(image)

    return _ocr_tesseract(image, lang)


def _ocr_tesseract(image: Image.Image, lang: str = "eng") -> Optional[str]:
    """OCR using Tesseract via pytesseract."""
    try:
        import pytesseract
    except ImportError:
        logger.warning(
            "pytesseract not installed — skipping OCR. "
            "Install with: pip install pytesseract"
        )
        return None

    processed = preprocess_for_ocr(image)
    try:
        text = pytesseract.image_to_string(processed, lang=lang).strip()
        return text if text else None
    except Exception:
        logger.exception("Tesseract OCR failed")
        return None


def _ocr_manga(image: Image.Image) -> Optional[str]:
    """OCR using manga-ocr for Japanese manga text."""
    try:
        from manga_ocr import MangaOcr
    except ImportError:
        logger.warning(
            "manga-ocr not installed — falling back to Tesseract with lang=jpn. "
            "Install with: pip install manga-ocr"
        )
        return _ocr_tesseract(image, lang="jpn")

    try:
        mocr = MangaOcr()
        text = mocr(image).strip()
        return text if text else None
    except Exception:
        logger.exception("manga-ocr failed")
        return None


def ocr_image_bytes(
    data: bytes,
    lang: str = "eng",
    manga: bool = False,
) -> Optional[str]:
    """Convenience wrapper that accepts raw image bytes."""
    image = Image.open(BytesIO(data))
    return ocr_image(image, lang=lang, manga=manga)


def ocr_image_file(
    path: Path,
    lang: str = "eng",
    manga: bool = False,
) -> Optional[str]:
    """Convenience wrapper that accepts a file path."""
    image = Image.open(path)
    return ocr_image(image, lang=lang, manga=manga)
