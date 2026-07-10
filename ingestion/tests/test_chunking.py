"""Tests for load_to_db.split_into_chunks (M9 D6 block re-chunking)."""

from itertools import pairwise

from ingestion.load_to_db import split_into_chunks


class TestSplitIntoChunks:
    def test_short_block_unchanged(self):
        text = "A short paragraph."
        assert split_into_chunks(text) == [text]

    def test_empty_unchanged(self):
        assert split_into_chunks("") == [""]

    def test_single_long_paragraph_not_split_midway(self):
        # One paragraph over target but with no paragraph breaks -> kept whole.
        text = "x" * 5000
        assert split_into_chunks(text) == [text]

    def test_splits_on_paragraph_boundaries_with_overlap(self):
        paras = [f"Paragraph {i} " + "y" * 500 for i in range(10)]
        text = "\n\n".join(paras)
        chunks = split_into_chunks(text, max_chars=1600, target_chars=1200)
        assert len(chunks) > 1
        # Every chunk is composed of whole paragraphs (never a mid-paragraph cut).
        for chunk in chunks:
            for piece in chunk.split("\n\n"):
                assert piece in paras
        # One-paragraph overlap: the last paragraph of a chunk starts the next.
        for a, b in pairwise(chunks):
            assert a.split("\n\n")[-1] == b.split("\n\n")[0]

    def test_all_paragraphs_preserved(self):
        paras = [f"P{i} " + "z" * 400 for i in range(8)]
        text = "\n\n".join(paras)
        chunks = split_into_chunks(text, max_chars=1000, target_chars=800)
        seen = set()
        for chunk in chunks:
            seen.update(chunk.split("\n\n"))
        assert seen == set(paras)
