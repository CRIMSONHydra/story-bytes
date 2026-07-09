"""Tests for ingestion/graph/merge.py — pure alias-normalization and entity-matching logic."""

from ingestion.graph.merge import (
    EntityIndex,
    choose_canonical,
    is_antonym,
    name_variants,
    normalize_name,
)


class TestNormalizeName:
    def test_lowercases_and_strips_punctuation(self):
        assert normalize_name("Aldric!") == "aldric"

    def test_strips_leading_article(self):
        assert normalize_name("The Count") == "count"

    def test_strips_leading_honorifics(self):
        assert normalize_name("Lord Aldric") == "aldric"
        assert normalize_name("Sir Ruijerd") == "ruijerd"

    def test_strips_stacked_article_and_honorific(self):
        assert normalize_name("The Lord Aldric") == "aldric"

    def test_preserves_multiword_names(self):
        assert normalize_name("Ruijerd Superdia") == "ruijerd superdia"

    def test_empty(self):
        assert normalize_name("") == ""
        assert normalize_name("   ") == ""


class TestNameVariants:
    def test_single_name(self):
        assert name_variants("Eris") == ["eris"]

    def test_multi_word_includes_first_and_last(self):
        variants = name_variants("Eris Boreas Greyrat")
        assert "eris boreas greyrat" in variants
        assert "greyrat" in variants   # surname
        assert "eris" in variants      # given name


class TestEntityIndex:
    def test_exact_match(self):
        idx = EntityIndex()
        idx.add("Ruijerd Superdia", ["Dead End"])
        assert idx.resolve("Ruijerd Superdia") == "Ruijerd Superdia"

    def test_alias_match(self):
        idx = EntityIndex()
        idx.add("Ruijerd Superdia", ["Dead End", "the Superd warrior"])
        assert idx.resolve("Dead End") == "Ruijerd Superdia"
        assert idx.resolve("The Superd Warrior") == "Ruijerd Superdia"

    def test_surname_fallback(self):
        idx = EntityIndex()
        idx.add("Eris Boreas Greyrat")
        assert idx.resolve("Eris") == "Eris Boreas Greyrat"

    def test_llm_known_entity_hint(self):
        idx = EntityIndex()
        idx.add("Rudeus Greyrat")
        # A brand-new surface form the index can't match lexically, but the LLM says it's Rudeus.
        assert idx.resolve("the boy", llm_known_entity="Rudeus Greyrat") == "Rudeus Greyrat"

    def test_unknown_returns_none(self):
        idx = EntityIndex()
        idx.add("Rudeus Greyrat")
        assert idx.resolve("Orsted") is None

    def test_honorific_insensitive_match(self):
        idx = EntityIndex()
        idx.add("Aldric")
        assert idx.resolve("Lord Aldric") == "Aldric"


class TestChooseCanonical:
    def test_prefers_longer_more_specific(self):
        assert choose_canonical("Eris", "Eris Boreas Greyrat") == "Eris Boreas Greyrat"
        assert choose_canonical("Eris Boreas Greyrat", "Eris") == "Eris Boreas Greyrat"

    def test_none_existing(self):
        assert choose_canonical(None, "Eris") == "Eris"


class TestIsAntonym:
    def test_ally_enemy(self):
        assert is_antonym("ally_of", "enemy_of")
        assert is_antonym("enemy_of", "ally_of")

    def test_case_insensitive(self):
        assert is_antonym("Ally_Of", "ENEMY_OF")

    def test_non_antonyms(self):
        assert not is_antonym("ally_of", "parent_of")
        assert not is_antonym("ally_of", "ally_of")
