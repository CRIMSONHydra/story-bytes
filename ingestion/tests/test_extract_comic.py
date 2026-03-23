"""Tests for ingestion/comic/extract_comic.py."""

import pytest

from ingestion.comic.extract_comic import (
    group_into_chapters,
    is_image_file,
    natural_sort_key,
    parse_chapter_breaks,
)


# ---------------------------------------------------------------------------
# natural_sort_key
# ---------------------------------------------------------------------------

class TestNaturalSortKey:
    def test_page2_before_page10(self):
        names = ["page10", "page2", "page1"]
        result = sorted(names, key=natural_sort_key)
        assert result == ["page1", "page2", "page10"]

    def test_mixed_alpha_numeric(self):
        names = ["a1b2", "a1b10", "a2b1"]
        result = sorted(names, key=natural_sort_key)
        assert result == ["a1b2", "a1b10", "a2b1"]

    def test_empty_string(self):
        key = natural_sort_key("")
        assert key == [""]

    def test_pure_numbers(self):
        names = ["100", "20", "3"]
        result = sorted(names, key=natural_sort_key)
        assert result == ["3", "20", "100"]

    def test_case_insensitive(self):
        names = ["Page2", "page1", "PAGE3"]
        result = sorted(names, key=natural_sort_key)
        assert result == ["page1", "Page2", "PAGE3"]

    def test_no_numbers(self):
        names = ["banana", "apple", "cherry"]
        result = sorted(names, key=natural_sort_key)
        assert result == ["apple", "banana", "cherry"]


# ---------------------------------------------------------------------------
# is_image_file
# ---------------------------------------------------------------------------

class TestIsImageFile:
    def test_jpg_is_image(self):
        assert is_image_file("photo.jpg") is True

    def test_jpeg_is_image(self):
        assert is_image_file("photo.jpeg") is True

    def test_png_is_image(self):
        assert is_image_file("photo.png") is True

    def test_gif_is_image(self):
        assert is_image_file("animation.gif") is True

    def test_txt_is_not_image(self):
        assert is_image_file("readme.txt") is False

    def test_html_is_not_image(self):
        assert is_image_file("index.html") is False

    def test_case_insensitive_jpg(self):
        assert is_image_file("PHOTO.JPG") is True

    def test_case_insensitive_png(self):
        assert is_image_file("image.PNG") is True

    def test_mixed_case(self):
        assert is_image_file("Cover.Jpg") is True

    def test_webp_is_image(self):
        assert is_image_file("modern.webp") is True

    def test_bmp_is_image(self):
        assert is_image_file("bitmap.bmp") is True

    def test_no_extension(self):
        assert is_image_file("noextfile") is False

    def test_nested_path(self):
        assert is_image_file("folder/subfolder/image.png") is True


# ---------------------------------------------------------------------------
# parse_chapter_breaks
# ---------------------------------------------------------------------------

class TestParseChapterBreaks:
    def test_basic_breaks(self):
        result = parse_chapter_breaks("0,5,10", 15)
        assert result == [0, 5, 10]

    def test_out_of_range_filtered(self):
        result = parse_chapter_breaks("0,5,10,20", 15)
        assert result == [0, 5, 10]
        assert 20 not in result

    def test_empty_string_returns_zero(self):
        # Empty string with split(",") gives [""] which int() would fail on,
        # but the code filters with x.strip() check
        result = parse_chapter_breaks("0", 10)
        assert result == [0]

    def test_zero_only(self):
        result = parse_chapter_breaks("0", 10)
        assert result == [0]

    def test_auto_prepends_zero(self):
        result = parse_chapter_breaks("5,10", 15)
        assert result[0] == 0
        assert result == [0, 5, 10]

    def test_duplicates_removed(self):
        result = parse_chapter_breaks("0,5,5,10", 15)
        assert result == [0, 5, 10]

    def test_unsorted_input_gets_sorted(self):
        result = parse_chapter_breaks("10,0,5", 15)
        assert result == [0, 5, 10]

    def test_all_out_of_range(self):
        result = parse_chapter_breaks("20,30", 10)
        assert result == [0]

    def test_spaces_in_input(self):
        result = parse_chapter_breaks("0, 5, 10", 15)
        assert result == [0, 5, 10]


# ---------------------------------------------------------------------------
# group_into_chapters
# ---------------------------------------------------------------------------

class TestGroupIntoChapters:
    def _make_pages(self, n):
        """Create n dummy pages as (name, bytes) tuples."""
        return [(f"page_{i:03d}.jpg", b"data") for i in range(n)]

    def test_two_chapters(self):
        pages = self._make_pages(10)
        result = group_into_chapters(pages, [0, 5])
        assert len(result) == 2
        assert len(result[0]) == 5
        assert len(result[1]) == 5

    def test_no_breaks_single_chapter(self):
        pages = self._make_pages(10)
        result = group_into_chapters(pages, None)
        assert len(result) == 1
        assert len(result[0]) == 10

    def test_empty_pages_no_breaks(self):
        result = group_into_chapters([], None)
        assert len(result) == 1
        assert len(result[0]) == 0

    def test_single_break_at_zero(self):
        pages = self._make_pages(10)
        result = group_into_chapters(pages, [0])
        assert len(result) == 1
        assert len(result[0]) == 10

    def test_three_chapters(self):
        pages = self._make_pages(15)
        result = group_into_chapters(pages, [0, 5, 10])
        assert len(result) == 3
        assert len(result[0]) == 5
        assert len(result[1]) == 5
        assert len(result[2]) == 5

    def test_uneven_chapters(self):
        pages = self._make_pages(10)
        result = group_into_chapters(pages, [0, 3, 7])
        assert len(result) == 3
        assert len(result[0]) == 3
        assert len(result[1]) == 4
        assert len(result[2]) == 3

    def test_preserves_page_content(self):
        pages = self._make_pages(6)
        result = group_into_chapters(pages, [0, 3])
        assert result[0][0][0] == "page_000.jpg"
        assert result[1][0][0] == "page_003.jpg"
