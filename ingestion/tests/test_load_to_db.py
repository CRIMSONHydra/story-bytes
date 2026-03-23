"""Tests for ingestion/load_to_db.py."""

import json
from pathlib import Path
from unittest.mock import MagicMock, call

import pytest

from ingestion.load_to_db import (
    _format_duration,
    _guess_media_type,
    compute_series_title,
    insert_story,
    load_json_data,
    resolve_content_type,
)


# ---------------------------------------------------------------------------
# resolve_content_type
# ---------------------------------------------------------------------------

class TestResolveContentType:
    def test_cli_cbz_returns_comic(self):
        assert resolve_content_type({}, "cbz") == "comic"

    def test_cli_cbr_returns_comic(self):
        assert resolve_content_type({}, "cbr") == "comic"

    def test_cli_comic_returns_comic(self):
        assert resolve_content_type({}, "comic") == "comic"

    def test_cli_manga_returns_manga(self):
        assert resolve_content_type({}, "manga") == "manga"

    def test_cli_none_json_has_comic(self):
        data = {"content_type": "comic"}
        assert resolve_content_type(data, None) == "comic"

    def test_cli_none_json_has_manga(self):
        data = {"content_type": "manga"}
        assert resolve_content_type(data, None) == "manga"

    def test_cli_none_json_no_content_type(self):
        assert resolve_content_type({}, None) == "novel"

    def test_cli_epub_returns_novel(self):
        assert resolve_content_type({}, "epub") == "novel"

    def test_cli_none_json_has_novel(self):
        # "novel" is not in ("comic", "manga"), so falls through to default
        data = {"content_type": "novel"}
        assert resolve_content_type(data, None) == "novel"

    def test_cli_none_json_unknown_content_type(self):
        data = {"content_type": "audiobook"}
        assert resolve_content_type(data, None) == "novel"


# ---------------------------------------------------------------------------
# compute_series_title
# ---------------------------------------------------------------------------

class TestComputeSeriesTitle:
    def test_volume_with_dash(self):
        assert compute_series_title("Mushoku Tensei - Volume 01") == "Mushoku Tensei"

    def test_vol_dot_with_number(self):
        result = compute_series_title("Mushoku Tensei: Jobless Reincarnation Vol. 3")
        assert result == "Mushoku Tensei: Jobless Reincarnation"

    def test_volume_with_parenthetical(self):
        result = compute_series_title("Title - Volume 01 (Author)")
        assert result == "Title"

    def test_no_volume_suffix(self):
        assert compute_series_title("Short Title") == "Short Title"

    def test_vol_without_dot(self):
        assert compute_series_title("Title Vol 2") == "Title"

    def test_empty_string(self):
        assert compute_series_title("") == ""

    def test_volume_uppercase(self):
        result = compute_series_title("My Book VOLUME 5")
        assert result == "My Book"

    def test_dash_separator_normalized_to_colon(self):
        result = compute_series_title("Series - Subseries")
        assert result == "Series: Subseries"

    def test_em_dash_separator(self):
        result = compute_series_title("Series \u2014 Volume 1")
        assert result == "Series"

    def test_en_dash_separator(self):
        result = compute_series_title("Series \u2013 Volume 2")
        assert result == "Series"


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

    def test_large_value(self):
        assert _format_duration(3661) == "61m 1s"

    def test_fractional_minutes(self):
        result = _format_duration(90.7)
        assert result == "1m 31s"


# ---------------------------------------------------------------------------
# _guess_media_type
# ---------------------------------------------------------------------------

class TestGuessMediaType:
    def test_jpg(self):
        assert _guess_media_type(Path("photo.jpg")) == "image/jpeg"

    def test_jpeg(self):
        assert _guess_media_type(Path("photo.jpeg")) == "image/jpeg"

    def test_png(self):
        assert _guess_media_type(Path("image.png")) == "image/png"

    def test_gif(self):
        assert _guess_media_type(Path("anim.gif")) == "image/gif"

    def test_webp(self):
        assert _guess_media_type(Path("modern.webp")) == "image/webp"

    def test_bmp(self):
        assert _guess_media_type(Path("old.bmp")) == "image/bmp"

    def test_unknown_defaults_to_jpeg(self):
        assert _guess_media_type(Path("file.xyz")) == "image/jpeg"

    def test_no_extension_defaults_to_jpeg(self):
        assert _guess_media_type(Path("noext")) == "image/jpeg"


# ---------------------------------------------------------------------------
# load_json_data
# ---------------------------------------------------------------------------

class TestLoadJsonData:
    def test_loads_valid_json(self, tmp_path):
        data = {"title": "Test Story", "chapters": []}
        json_file = tmp_path / "test.json"
        json_file.write_text(json.dumps(data), encoding="utf-8")

        result = load_json_data(json_file)
        assert result == data

    def test_loads_unicode_content(self, tmp_path):
        data = {"title": "\u6a5f\u52d5\u6226\u58eb\u30ac\u30f3\u30c0\u30e0", "authors": ["\u5bcc\u91ce\u7531\u60a0\u5b63"]}
        json_file = tmp_path / "unicode.json"
        json_file.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

        result = load_json_data(json_file)
        assert result["title"] == "\u6a5f\u52d5\u6226\u58eb\u30ac\u30f3\u30c0\u30e0"

    def test_loads_nested_structure(self, tmp_path):
        data = {
            "title": "Book",
            "chapters": [
                {
                    "title": "Ch1",
                    "content": [{"type": "text", "text": "Hello"}],
                }
            ],
        }
        json_file = tmp_path / "nested.json"
        json_file.write_text(json.dumps(data), encoding="utf-8")

        result = load_json_data(json_file)
        assert result["chapters"][0]["content"][0]["text"] == "Hello"

    def test_file_not_found_raises(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            load_json_data(tmp_path / "nonexistent.json")


# ---------------------------------------------------------------------------
# insert_story
# ---------------------------------------------------------------------------

class TestInsertStory:
    def _make_cursor(self, existing_story_id=None):
        """Create a mock cursor that simulates DB behavior."""
        cursor = MagicMock()
        if existing_story_id:
            cursor.fetchone.side_effect = [(existing_story_id,), None]
        else:
            cursor.fetchone.side_effect = [None, ("new-uuid-123",)]
        return cursor

    def test_inserts_new_story(self):
        cursor = self._make_cursor(existing_story_id=None)
        story_data = {
            "identifier": "isbn-12345",
            "title": "Test Novel",
            "authors": ["Author A"],
            "language": "en",
        }

        result = insert_story(cursor, story_data, content_type="novel", epub_path="/path/to/book.epub")

        assert result == "new-uuid-123"
        # Should have called SELECT to check existence, then INSERT
        assert cursor.execute.call_count == 2
        # Verify the INSERT call contains correct params
        insert_call = cursor.execute.call_args_list[1]
        sql = insert_call[0][0]
        assert "INSERT INTO stories" in sql
        params = insert_call[0][1]
        assert params[0] == "isbn-12345"  # external_id
        assert params[1] == "Test Novel"  # title
        assert params[4] == "novel"  # content_type

    def test_updates_existing_story(self):
        cursor = self._make_cursor(existing_story_id="existing-uuid-456")
        story_data = {
            "identifier": "isbn-12345",
            "title": "Updated Novel",
            "authors": ["Author B"],
            "language": "en",
        }

        result = insert_story(cursor, story_data, content_type="comic")

        assert result == "existing-uuid-456"
        # Should have called SELECT then UPDATE
        assert cursor.execute.call_count == 2
        update_call = cursor.execute.call_args_list[1]
        sql = update_call[0][0]
        assert "UPDATE stories" in sql
        params = update_call[0][1]
        assert params[0] == "Updated Novel"  # title
        assert params[3] == "comic"  # content_type

    def test_uses_series_title_override(self):
        cursor = self._make_cursor(existing_story_id="existing-uuid")
        story_data = {
            "identifier": "id-1",
            "title": "My Book - Volume 1",
            "authors": [],
            "language": None,
        }

        insert_story(
            cursor, story_data,
            content_type="novel",
            series_title_override="Custom Series",
        )

        update_call = cursor.execute.call_args_list[1]
        params = update_call[0][1]
        # series_title should be the override, not computed
        assert params[4] == "Custom Series"

    def test_computes_series_title_when_no_override(self):
        cursor = self._make_cursor(existing_story_id=None)
        story_data = {
            "identifier": "id-2",
            "title": "My Book - Volume 1",
            "authors": [],
            "language": None,
        }

        insert_story(cursor, story_data, content_type="novel")

        insert_call = cursor.execute.call_args_list[1]
        params = insert_call[0][1]
        # series_title should be computed from title
        assert params[5] == "My Book"

    def test_handles_missing_optional_fields(self):
        cursor = self._make_cursor(existing_story_id=None)
        story_data = {"identifier": "minimal-id"}

        result = insert_story(cursor, story_data, content_type="novel")
        assert result == "new-uuid-123"

        insert_call = cursor.execute.call_args_list[1]
        params = insert_call[0][1]
        assert params[1] is None  # title
        assert params[2] == []    # authors (default)
