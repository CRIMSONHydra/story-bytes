"""Tests for the M3 stdout JSONL event contract in load_to_db (Platform F6).

The backend pythonRunner reads structured events off STDOUT (progress/usage/result) instead of
scraping log text, so the shape of `emit_event` output is a contract worth locking down.
"""

import json

from ingestion.load_to_db import emit_event


class TestEmitEvent:
    def test_emits_valid_jsonl_on_stdout(self, capsys):
        emit_event("progress", stage="loading", chapters=3, blocks=42)
        out = capsys.readouterr().out.strip()
        assert json.loads(out) == {"event": "progress", "stage": "loading", "chapters": 3, "blocks": 42}

    def test_result_event_carries_story_id(self, capsys):
        emit_event("result", status="ok", story_id="abc-123", title="T", chapters=3, blocks=10)
        obj = json.loads(capsys.readouterr().out.strip())
        assert obj["event"] == "result"
        assert obj["story_id"] == "abc-123"
        assert obj["status"] == "ok"

    def test_one_json_object_per_line(self, capsys):
        emit_event("progress", i=1)
        emit_event("result", status="ok")
        lines = [ln for ln in capsys.readouterr().out.splitlines() if ln.strip()]
        assert len(lines) == 2
        assert [json.loads(ln)["event"] for ln in lines] == ["progress", "result"]

    def test_nothing_written_to_stderr(self, capsys):
        # Human logs go to stderr; events go ONLY to stdout. emit_event must not touch stderr.
        emit_event("progress", stage="x")
        assert capsys.readouterr().err == ""
