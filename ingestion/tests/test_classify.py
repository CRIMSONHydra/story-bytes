"""Tests for the M18 spoiler classifier's pure default-deny parse."""

from ingestion.external.classify import parse_classification


class TestParseClassification:
    def test_accepts_a_bounded_high_confidence_chapter(self):
        assert parse_classification('{"max_chapter_order": 4, "confidence": 0.9}', num_chapters=10) == 4

    def test_null_denies(self):
        assert parse_classification('{"max_chapter_order": null, "confidence": 0.9}', 10) is None

    def test_low_confidence_denies(self):
        assert parse_classification('{"max_chapter_order": 3, "confidence": 0.3}', 10) is None

    def test_beyond_final_chapter_denies(self):
        assert parse_classification('{"max_chapter_order": 12, "confidence": 0.9}', num_chapters=10) is None

    def test_non_json_denies(self):
        assert parse_classification('the model rambled without json', 10) is None

    def test_boolean_is_not_an_int_chapter(self):
        assert parse_classification('{"max_chapter_order": true, "confidence": 0.9}', 10) is None

    def test_tolerates_surrounding_prose(self):
        assert parse_classification('Here you go: {"max_chapter_order": 2, "confidence": 0.8} done', 10) == 2
