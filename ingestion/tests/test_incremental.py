"""Tests for the M11 incremental-ingest decision logic (content hashing + per-mode action)."""

from ingestion.load_to_db import chapter_content_hash, decide_chapter_action


def _chapter(title="Ch 1", text="hello world", blocks=None):
    return {"order": 1, "title": title, "text": text, "content": blocks or [{"type": "text", "text": text}]}


class TestChapterContentHash:
    def test_stable_for_identical_content(self):
        assert chapter_content_hash(_chapter()) == chapter_content_hash(_chapter())

    def test_changes_when_text_changes(self):
        assert chapter_content_hash(_chapter(text="a")) != chapter_content_hash(_chapter(text="b"))

    def test_changes_when_title_changes(self):
        assert chapter_content_hash(_chapter(title="A")) != chapter_content_hash(_chapter(title="B"))

    def test_changes_when_a_block_changes(self):
        c1 = _chapter(blocks=[{"type": "text", "text": "x"}])
        c2 = _chapter(blocks=[{"type": "text", "text": "x"}, {"type": "image", "src": "p.jpg"}])
        assert chapter_content_hash(c1) != chapter_content_hash(c2)


class TestDecideChapterAction:
    def test_replace_always_writes(self):
        assert decide_chapter_action("h", "h", "replace") == "write"
        assert decide_chapter_action(None, "h", "replace") == "write"

    def test_append_only_new_chapters(self):
        assert decide_chapter_action(None, "h", "append") == "write"   # not present → new
        assert decide_chapter_action("h", "h2", "append") == "skip"    # present → never touch

    def test_diff_skips_unchanged_writes_changed_and_new(self):
        assert decide_chapter_action(None, "h", "diff") == "write"     # new
        assert decide_chapter_action("h", "h", "diff") == "skip"       # unchanged
        assert decide_chapter_action("h", "h2", "diff") == "write"     # changed
