"""Tests for ingestion/enrich_images.py."""

import time
from unittest.mock import MagicMock, patch

import pytest

from ingestion.enrich_images import (
    _format_duration,
    _retry_with_backoff,
    get_story_characters,
)


# ---------------------------------------------------------------------------
# _format_duration
# ---------------------------------------------------------------------------

class TestFormatDuration:
    def test_seconds_only(self):
        assert _format_duration(30.5) == "30.5s"

    def test_minutes_and_seconds(self):
        assert _format_duration(90) == "1m 30s"

    def test_zero(self):
        assert _format_duration(0) == "0.0s"

    def test_under_one_second(self):
        assert _format_duration(0.3) == "0.3s"

    def test_exactly_60(self):
        assert _format_duration(60) == "1m 0s"


# ---------------------------------------------------------------------------
# _retry_with_backoff
# ---------------------------------------------------------------------------

class TestRetryWithBackoff:
    def test_succeeds_on_first_try(self):
        fn = MagicMock(return_value="success")
        result = _retry_with_backoff(fn, description="test", max_retries=3, base_delay=0.01)
        assert result == "success"
        assert fn.call_count == 1

    @patch("ingestion.enrich_images.time.sleep")
    def test_retries_on_rate_limit_then_succeeds(self, mock_sleep):
        fn = MagicMock()
        fn.side_effect = [
            Exception("Error 429: rate limit exceeded"),
            "success after retry",
        ]
        result = _retry_with_backoff(fn, description="test", max_retries=3, base_delay=0.01)
        assert result == "success after retry"
        assert fn.call_count == 2
        mock_sleep.assert_called_once()

    @patch("ingestion.enrich_images.time.sleep")
    def test_raises_after_max_retries(self, mock_sleep):
        fn = MagicMock()
        fn.side_effect = Exception("Error 429: quota exceeded")

        with pytest.raises(Exception, match="quota exceeded"):
            _retry_with_backoff(fn, description="test", max_retries=2, base_delay=0.01)

        # Initial attempt + 2 retries = 3 calls
        assert fn.call_count == 3
        assert mock_sleep.call_count == 2

    def test_non_rate_limit_error_not_retried(self):
        fn = MagicMock()
        fn.side_effect = ValueError("some other error")

        with pytest.raises(ValueError, match="some other error"):
            _retry_with_backoff(fn, description="test", max_retries=3, base_delay=0.01)

        assert fn.call_count == 1

    @patch("ingestion.enrich_images.time.sleep")
    def test_exponential_backoff_delays(self, mock_sleep):
        fn = MagicMock()
        fn.side_effect = [
            Exception("429 rate limited"),
            Exception("429 rate limited"),
            "finally works",
        ]
        base = 0.1
        _retry_with_backoff(fn, description="test", max_retries=3, base_delay=base)

        assert mock_sleep.call_count == 2
        # First retry: base * 3^0 = 0.1
        # Second retry: base * 3^1 = 0.3
        delays = [c[0][0] for c in mock_sleep.call_args_list]
        assert abs(delays[0] - base * (3 ** 0)) < 0.001
        assert abs(delays[1] - base * (3 ** 1)) < 0.001

    @patch("ingestion.enrich_images.time.sleep")
    def test_resource_error_triggers_retry(self, mock_sleep):
        fn = MagicMock()
        fn.side_effect = [
            Exception("resource exhausted"),
            "ok",
        ]
        result = _retry_with_backoff(fn, description="test", max_retries=2, base_delay=0.01)
        assert result == "ok"
        assert fn.call_count == 2


# ---------------------------------------------------------------------------
# get_story_characters
# ---------------------------------------------------------------------------

class TestGetStoryCharacters:
    def test_extracts_capitalized_names(self):
        cursor = MagicMock()
        # Simulate rows with aggregated_text containing character names
        text = (
            "Rudeus Greyrat went to the market. "
            "Paul Greyrat was training. "
            "Rudeus Greyrat studied magic. "
            "Rudeus Greyrat met Sylphiette. "
            "Roxy Migurdia was his teacher. "
            "Roxy Migurdia taught well. "
            "Roxy Migurdia smiled. "
        )
        cursor.fetchall.return_value = [(text,)]

        result = get_story_characters(cursor, "story-uuid-123")

        # Rudeus Greyrat appears 3 times, Roxy Migurdia 3 times
        assert "Rudeus Greyrat" in result
        assert "Roxy Migurdia" in result

    def test_filters_common_non_names(self):
        cursor = MagicMock()
        text = (
            "The Beginning was interesting. "
            "The Beginning started well. "
            "The Beginning ended. "
            "Chapter One was long. "
            "Chapter One was fun. "
            "Chapter One was short. "
            "John Smith appeared. "
            "John Smith spoke. "
            "John Smith left. "
        )
        cursor.fetchall.return_value = [(text,)]

        result = get_story_characters(cursor, "story-uuid")

        assert "John Smith" in result
        # "The Beginning" should be filtered out
        assert "The Beginning" not in result
        # "Chapter One" should be filtered out
        assert "Chapter One" not in result

    def test_empty_text_returns_empty(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [("",)]

        result = get_story_characters(cursor, "story-uuid")
        assert result == []

    def test_no_rows_returns_empty(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = []

        result = get_story_characters(cursor, "story-uuid")
        assert result == []

    def test_names_below_threshold_excluded(self):
        cursor = MagicMock()
        # "Rare Character" appears only twice (below 3 threshold)
        text = (
            "Rare Character spoke. "
            "Rare Character left. "
            "Common Name appeared. "
            "Common Name spoke. "
            "Common Name left. "
        )
        cursor.fetchall.return_value = [(text,)]

        result = get_story_characters(cursor, "story-uuid")

        assert "Common Name" in result
        assert "Rare Character" not in result

    def test_limits_to_50_characters(self):
        cursor = MagicMock()
        # Create 60 unique names each appearing 3+ times
        names = [f"Character Name{i:02d}" for i in range(60)]
        text_parts = []
        for name in names:
            for _ in range(4):
                text_parts.append(f"{name} did something.")
        cursor.fetchall.return_value = [(" ".join(text_parts),)]

        result = get_story_characters(cursor, "story-uuid")
        assert len(result) <= 50

    def test_handles_none_text_rows(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [(None,), ("John Smith appeared. John Smith spoke. John Smith left.",)]

        result = get_story_characters(cursor, "story-uuid")
        assert "John Smith" in result

    def test_sorted_by_frequency(self):
        cursor = MagicMock()
        text = (
            "Rare Name spoke. Rare Name left. Rare Name went. "
            "Common Name appeared. Common Name spoke. Common Name left. "
            "Common Name smiled. Common Name ran. "
        )
        cursor.fetchall.return_value = [(text,)]

        result = get_story_characters(cursor, "story-uuid")
        # Common Name (5 occurrences) should come before Rare Name (3)
        if "Common Name" in result and "Rare Name" in result:
            assert result.index("Common Name") < result.index("Rare Name")
