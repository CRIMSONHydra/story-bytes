"""Tests for ingestion/graph/link_foreshadow.py build_link — validation + hint/guard flow.

Gemini is never called: generate_hint and the payoff-leak guard are monkeypatched so the
spoiler-safety logic (guard fail-closed, regeneration, blocked fallback) is tested in isolation.
"""

from unittest.mock import MagicMock

import pytest

from ingestion.graph import link_foreshadow as lf


@pytest.fixture
def client():
    return MagicMock()


class TestBuildLinkValidation:
    def test_rejects_payoff_not_after_setup(self, client, monkeypatch):
        monkeypatch.setattr(lf, "generate_hint", lambda c, s: "hint")
        monkeypatch.setattr(lf.guard, "check_payoff_leak", lambda c, h, p: False)
        raw = {"setup_chapter": 5, "payoff_chapter": 5, "setup_summary": "s", "payoff_summary": "p"}
        assert lf.build_link(client, raw) is None
        raw["payoff_chapter"] = 3
        assert lf.build_link(client, raw) is None

    def test_rejects_missing_summaries(self, client, monkeypatch):
        monkeypatch.setattr(lf, "generate_hint", lambda c, s: "hint")
        monkeypatch.setattr(lf.guard, "check_payoff_leak", lambda c, h, p: False)
        assert lf.build_link(client, {"setup_chapter": 1, "payoff_chapter": 4, "setup_summary": "", "payoff_summary": "p"}) is None
        assert lf.build_link(client, {"setup_chapter": 1, "payoff_chapter": 4, "setup_summary": "s", "payoff_summary": ""}) is None

    def test_rejects_non_integer_chapters(self, client, monkeypatch):
        monkeypatch.setattr(lf, "generate_hint", lambda c, s: "hint")
        monkeypatch.setattr(lf.guard, "check_payoff_leak", lambda c, h, p: False)
        assert lf.build_link(client, {"setup_chapter": "x", "payoff_chapter": 4, "setup_summary": "s", "payoff_summary": "p"}) is None


class TestBuildLinkGuardFlow:
    RAW = {"setup_chapter": 6, "payoff_chapter": 40, "setup_summary": "A locked door in the cellar.",
           "payoff_summary": "The door hides the villain's lair.", "significance": "major", "confidence": 0.9}

    def test_clean_hint_passes(self, client, monkeypatch):
        monkeypatch.setattr(lf, "generate_hint", lambda c, s: "An odd locked door, easy to overlook.")
        monkeypatch.setattr(lf.guard, "check_payoff_leak", lambda c, h, p: False)
        link = lf.build_link(client, self.RAW)
        assert link is not None
        assert link["guard_status"] == "clean"
        assert link["emphasis_hint"] == "An odd locked door, easy to overlook."
        assert link["setup_chapter_order"] == 6 and link["payoff_chapter_order"] == 40
        assert link["significance"] == "major"
        # The payoff summary is stored (server-side) but the hint must not equal it.
        assert link["payoff_summary"] == "The door hides the villain's lair."

    def test_leaky_hint_regenerated_to_flagged(self, client, monkeypatch):
        hints = iter(["The door hides the villain's lair!", "Just an odd locked door."])
        monkeypatch.setattr(lf, "generate_hint", lambda c, s: next(hints))
        # First hint leaks, second is clean.
        leaks = iter([True, False])
        monkeypatch.setattr(lf.guard, "check_payoff_leak", lambda c, h, p: next(leaks))
        link = lf.build_link(client, self.RAW)
        assert link["guard_status"] == "flagged"
        assert link["emphasis_hint"] == "Just an odd locked door."

    def test_persistently_leaky_hint_blocked_with_generic_fallback(self, client, monkeypatch):
        monkeypatch.setattr(lf, "generate_hint", lambda c, s: "The villain lives behind it!")
        monkeypatch.setattr(lf.guard, "check_payoff_leak", lambda c, h, p: True)  # always leaks
        link = lf.build_link(client, self.RAW)
        assert link["guard_status"] == "blocked"
        assert link["emphasis_hint"] == lf.GENERIC_HINT

    def test_no_hint_generated_blocks(self, client, monkeypatch):
        monkeypatch.setattr(lf, "generate_hint", lambda c, s: None)
        monkeypatch.setattr(lf.guard, "check_payoff_leak", lambda c, h, p: False)
        link = lf.build_link(client, self.RAW)
        assert link["guard_status"] == "blocked"
        assert link["emphasis_hint"] == lf.GENERIC_HINT
