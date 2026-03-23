"""Tests for ingestion/comic/ocr.py."""

import io
from unittest.mock import MagicMock, patch

import pytest
from PIL import Image

from ingestion.comic.ocr import (
    ocr_image_bytes,
    preprocess_for_ocr,
    _ocr_tesseract,
)


# ---------------------------------------------------------------------------
# preprocess_for_ocr
# ---------------------------------------------------------------------------

class TestPreprocessForOcr:
    def test_output_is_grayscale(self):
        img = Image.new("RGB", (50, 50), color=(128, 64, 200))
        result = preprocess_for_ocr(img)
        assert result.mode == "L"

    def test_size_preserved(self):
        img = Image.new("RGB", (100, 75), color=(0, 0, 0))
        result = preprocess_for_ocr(img)
        assert result.size == (100, 75)

    def test_already_grayscale(self):
        img = Image.new("L", (30, 30), color=128)
        result = preprocess_for_ocr(img)
        assert result.mode == "L"
        assert result.size == (30, 30)

    def test_output_is_binarized(self):
        """Pixel values should be either 0 or 255 after thresholding."""
        img = Image.new("RGB", (20, 20), color=(100, 100, 100))
        result = preprocess_for_ocr(img)
        pixels = list(result.get_flattened_data())
        assert all(p in (0, 255) for p in pixels)

    def test_rgba_input(self):
        img = Image.new("RGBA", (40, 40), color=(255, 0, 0, 128))
        result = preprocess_for_ocr(img)
        assert result.mode == "L"
        assert result.size == (40, 40)


# ---------------------------------------------------------------------------
# _ocr_tesseract (mocked)
# ---------------------------------------------------------------------------

class TestOcrTesseract:
    @patch("ingestion.comic.ocr.pytesseract", create=True)
    def test_returns_extracted_text(self, mock_pytesseract):
        mock_module = MagicMock()
        mock_module.image_to_string.return_value = "Hello world"

        with patch.dict("sys.modules", {"pytesseract": mock_module}):
            with patch("ingestion.comic.ocr.preprocess_for_ocr") as mock_preprocess:
                mock_preprocess.return_value = Image.new("L", (10, 10))
                # Re-import to pick up the mock
                import importlib
                import ingestion.comic.ocr as ocr_module
                importlib.reload(ocr_module)

                img = Image.new("RGB", (10, 10))
                result = ocr_module._ocr_tesseract(img, lang="eng")
                assert result == "Hello world"

    @patch.dict("sys.modules", {"pytesseract": None})
    def test_returns_none_when_pytesseract_missing(self):
        """When pytesseract import fails, should return None."""
        import importlib
        import ingestion.comic.ocr as ocr_module
        importlib.reload(ocr_module)

        img = Image.new("RGB", (10, 10))
        result = ocr_module._ocr_tesseract(img)
        assert result is None


# ---------------------------------------------------------------------------
# ocr_image_bytes
# ---------------------------------------------------------------------------

class TestOcrImageBytes:
    def test_with_tiny_png(self):
        """Create a 10x10 white PNG and verify ocr_image_bytes processes it."""
        img = Image.new("RGB", (10, 10), color=(255, 255, 255))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        image_bytes = buf.getvalue()

        with patch("ingestion.comic.ocr.ocr_image") as mock_ocr:
            mock_ocr.return_value = "test text"
            result = ocr_image_bytes(image_bytes, lang="eng", manga=False)
            assert result == "test text"
            # Verify ocr_image was called with a PIL Image
            call_args = mock_ocr.call_args
            assert isinstance(call_args[0][0], Image.Image)
            assert call_args[1]["lang"] == "eng"
            assert call_args[1]["manga"] is False

    def test_with_jpeg_bytes(self):
        """Test with JPEG format bytes."""
        img = Image.new("RGB", (10, 10), color=(0, 0, 0))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        image_bytes = buf.getvalue()

        with patch("ingestion.comic.ocr.ocr_image") as mock_ocr:
            mock_ocr.return_value = None
            result = ocr_image_bytes(image_bytes)
            assert result is None
            mock_ocr.assert_called_once()
