"""Tests for the M-Backfill appearance-fact parser."""

from ingestion.graph.extract_appearance import parse_appearance_facts


class TestParseAppearanceFacts:
    def test_accepts_valid_facts(self):
        raw = '[{"chapter_order": 2, "fact_type": "hair", "value": "brown"}, {"chapter_order": 3, "fact_type": "eyes", "value": "green"}]'
        assert parse_appearance_facts(raw, max_chapter=10) == [(2, "hair", "brown"), (3, "eyes", "green")]

    def test_drops_facts_beyond_boundary(self):
        raw = '[{"chapter_order": 20, "fact_type": "hair", "value": "brown"}]'
        assert parse_appearance_facts(raw, max_chapter=10) == []

    def test_drops_unknown_fact_type(self):
        raw = '[{"chapter_order": 1, "fact_type": "mood", "value": "angry"}]'
        assert parse_appearance_facts(raw, max_chapter=10) == []

    def test_drops_empty_value(self):
        raw = '[{"chapter_order": 1, "fact_type": "hair", "value": "   "}]'
        assert parse_appearance_facts(raw, max_chapter=10) == []

    def test_non_json_returns_empty(self):
        assert parse_appearance_facts("no json here", 10) == []

    def test_tolerates_surrounding_prose(self):
        raw = 'Sure: [{"chapter_order": 1, "fact_type": "build", "value": "tall"}] end'
        assert parse_appearance_facts(raw, 10) == [(1, "build", "tall")]
