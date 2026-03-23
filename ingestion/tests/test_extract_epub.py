"""Tests for ingestion/epub/extract_epub.py."""

import pytest

from ingestion.epub.extract_epub import (
    aggregate_chapter_text,
    infer_title_from_blocks,
    normalise_whitespace,
    resolve_href,
)


# ---------------------------------------------------------------------------
# normalise_whitespace
# ---------------------------------------------------------------------------

class TestNormaliseWhitespace:
    def test_collapses_multiple_spaces(self):
        assert normalise_whitespace("hello   world") == "hello world"

    def test_collapses_newlines(self):
        assert normalise_whitespace("hello\n\nworld") == "hello world"

    def test_collapses_tabs_and_mixed(self):
        assert normalise_whitespace("hello\t  \n world") == "hello world"

    def test_strips_leading_and_trailing(self):
        assert normalise_whitespace("  hello  ") == "hello"

    def test_empty_string(self):
        assert normalise_whitespace("") == ""

    def test_already_clean(self):
        assert normalise_whitespace("hello world") == "hello world"

    def test_only_whitespace(self):
        assert normalise_whitespace("   \n\t  ") == ""

    def test_single_word(self):
        assert normalise_whitespace("hello") == "hello"


# ---------------------------------------------------------------------------
# resolve_href
# ---------------------------------------------------------------------------

class TestResolveHref:
    def test_relative_path_from_nested_base(self):
        result = resolve_href("OEBPS/Text/ch1.html", "Images/foo.jpg")
        # urljoin with base "OEBPS/Text/" + "Images/foo.jpg" => "OEBPS/Text/Images/foo.jpg"
        assert result == "OEBPS/Text/Images/foo.jpg"

    def test_relative_path_with_parent_traversal(self):
        result = resolve_href("OEBPS/Text/ch1.html", "../Images/foo.jpg")
        assert result == "OEBPS/Images/foo.jpg"

    def test_none_input_returns_none(self):
        assert resolve_href("OEBPS/Text/ch1.html", None) is None

    def test_empty_string_returns_none(self):
        assert resolve_href("OEBPS/Text/ch1.html", "") is None

    def test_absolute_path(self):
        result = resolve_href("OEBPS/Text/ch1.html", "/images/cover.jpg")
        assert result is not None
        assert "cover.jpg" in result

    def test_same_directory(self):
        result = resolve_href("OEBPS/Text/ch1.html", "ch2.html")
        assert result == "OEBPS/Text/ch2.html"


# ---------------------------------------------------------------------------
# aggregate_chapter_text
# ---------------------------------------------------------------------------

class TestAggregateChapterText:
    def test_joins_text_blocks(self):
        blocks = [
            {"type": "text", "text": "First paragraph."},
            {"type": "text", "text": "Second paragraph."},
        ]
        result = aggregate_chapter_text(blocks)
        assert result == "First paragraph.\n\nSecond paragraph."

    def test_skips_image_blocks(self):
        blocks = [
            {"type": "text", "text": "Before image."},
            {"type": "image", "src": "img.jpg", "alt": None},
            {"type": "text", "text": "After image."},
        ]
        result = aggregate_chapter_text(blocks)
        assert result == "Before image.\n\nAfter image."

    def test_empty_list(self):
        assert aggregate_chapter_text([]) == ""

    def test_skips_blocks_with_empty_text(self):
        blocks = [
            {"type": "text", "text": ""},
            {"type": "text", "text": "Real content."},
        ]
        result = aggregate_chapter_text(blocks)
        assert result == "Real content."

    def test_skips_blocks_missing_text_key(self):
        blocks = [
            {"type": "text"},
            {"type": "text", "text": "Has text."},
        ]
        result = aggregate_chapter_text(blocks)
        assert result == "Has text."

    def test_only_image_blocks(self):
        blocks = [
            {"type": "image", "src": "a.jpg"},
            {"type": "image", "src": "b.jpg"},
        ]
        assert aggregate_chapter_text(blocks) == ""


# ---------------------------------------------------------------------------
# infer_title_from_blocks
# ---------------------------------------------------------------------------

class TestInferTitleFromBlocks:
    def test_returns_first_text_block(self):
        blocks = [
            {"type": "text", "text": "Chapter 1: The Beginning"},
            {"type": "text", "text": "Once upon a time..."},
        ]
        assert infer_title_from_blocks(blocks) == "Chapter 1: The Beginning"

    def test_truncates_to_120_chars(self):
        long_text = "A" * 200
        blocks = [{"type": "text", "text": long_text}]
        result = infer_title_from_blocks(blocks)
        assert len(result) == 120
        assert result == "A" * 120

    def test_empty_blocks_returns_none(self):
        assert infer_title_from_blocks([]) is None

    def test_no_text_blocks_returns_none(self):
        blocks = [
            {"type": "image", "src": "cover.jpg"},
            {"type": "image", "src": "page1.jpg"},
        ]
        assert infer_title_from_blocks(blocks) is None

    def test_skips_empty_text_blocks(self):
        blocks = [
            {"type": "text", "text": ""},
            {"type": "text", "text": "Real Title"},
        ]
        assert infer_title_from_blocks(blocks) == "Real Title"

    def test_skips_blocks_without_text_key(self):
        blocks = [
            {"type": "text"},
            {"type": "text", "text": "Fallback Title"},
        ]
        assert infer_title_from_blocks(blocks) == "Fallback Title"
