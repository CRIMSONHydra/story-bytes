"""Tests for the M13 .txt/.md chapter splitter."""

from ingestion.extract_text import split_chapters, build_chapters


class TestSplitChapters:
    def test_splits_on_markdown_headings(self):
        text = "# Prologue\n\nA man died.\n\n## Chapter 1\n\nHe woke as a baby."
        chapters = split_chapters(text)
        assert [t for t, _ in chapters] == ["Prologue", "Chapter 1"]
        assert "A man died." in chapters[0][1]

    def test_splits_on_chapter_lines(self):
        text = "Chapter One\n\nThe start.\n\nChapter Two\n\nThe middle."
        titles = [t for t, _ in split_chapters(text)]
        assert titles == ["Chapter One", "Chapter Two"]

    def test_no_headings_yields_one_chapter_titled_from_hint(self):
        # A headingless file becomes one chapter that takes the story title.
        chapters = build_chapters("Just some prose with no headings at all.", "My Book", single=False)
        assert len(chapters) == 1
        assert chapters[0]["title"] == "My Book"

    def test_drops_empty_sections_between_real_chapters(self):
        text = "# A\n\nbody a\n\n# Empty\n\n# B\n\nbody b"
        titles = [t for t, _ in split_chapters(text)]
        assert titles == ["A", "B"]  # the body-less "Empty" heading is dropped


class TestBuildChapters:
    def test_single_chapter_mode(self):
        chapters = build_chapters("# Not a split here\n\nbody", "Chapter 12", single=True)
        assert len(chapters) == 1
        assert chapters[0]["order"] == 0
        assert chapters[0]["content"][0]["type"] == "text"

    def test_single_chapter_uses_hint_title(self):
        chapters = build_chapters("plain body no heading", "The Book", single=False)
        assert len(chapters) == 1 and chapters[0]["title"] == "The Book"
