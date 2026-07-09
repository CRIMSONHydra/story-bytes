"""Pure functions for entity name normalization and alias merging.

Kept free of I/O so they are unit-testable without a DB or Gemini. The extractor
(extract_graph.py) uses these to decide whether a name the LLM returned refers to an
entity already known from earlier chapters.
"""

import re
from typing import Dict, Iterable, List, Optional, Tuple

# Honorifics / titles stripped before comparing names.
_HONORIFICS = {
    "mr", "mrs", "ms", "miss", "sir", "lord", "lady", "dame", "master", "mistress",
    "king", "queen", "prince", "princess", "duke", "duchess", "count", "countess",
    "st", "saint", "dr", "father", "mother", "brother", "sister", "captain", "general",
}

_PUNCT_RE = re.compile(r"[^\w\s]", re.UNICODE)
_WS_RE = re.compile(r"\s+")


def normalize_name(name: str) -> str:
    """Casefold, strip punctuation, drop leading honorifics, collapse whitespace.

    "The Lord Aldric!" -> "aldric";  "Ruijerd Superdia" -> "ruijerd superdia".
    """
    if not name:
        return ""
    lowered = _PUNCT_RE.sub(" ", name).casefold()
    tokens = [t for t in _WS_RE.split(lowered) if t]
    # Drop a leading article.
    if tokens and tokens[0] in ("the", "a", "an"):
        tokens = tokens[1:]
    # Drop leading honorifics (possibly several, e.g. "lord sir"), but never the last remaining
    # token — a title can BE the name ("the Count" = Edmond Dantès).
    while len(tokens) > 1 and tokens[0] in _HONORIFICS:
        tokens = tokens[1:]
    return " ".join(tokens)


def name_variants(name: str) -> List[str]:
    """Normalized forms worth matching on: the full normalized name plus its last token
    (surname/single-name) so "Eris" matches "Eris Boreas Greyrat"."""
    norm = normalize_name(name)
    if not norm:
        return []
    variants = [norm]
    tokens = norm.split()
    if len(tokens) > 1:
        variants.append(tokens[-1])   # surname / final name
        variants.append(tokens[0])    # given name
    return variants


class EntityIndex:
    """In-memory index of known entities for a story, keyed by normalized name/alias.

    Maps a normalized string -> canonical_name. Built from entities already written for
    earlier chapters; consulted to merge repeat mentions.
    """

    def __init__(self) -> None:
        self._by_norm: Dict[str, str] = {}
        self._canonical: Dict[str, str] = {}  # normalized canonical -> canonical display

    def add(self, canonical_name: str, aliases: Iterable[str] = ()) -> None:
        canon_norm = normalize_name(canonical_name)
        if canon_norm:
            self._canonical[canon_norm] = canonical_name
            self._by_norm.setdefault(canon_norm, canonical_name)
            for v in name_variants(canonical_name):
                self._by_norm.setdefault(v, canonical_name)
        for alias in aliases:
            for v in name_variants(alias):
                self._by_norm.setdefault(v, canonical_name)

    def resolve(self, name: str, llm_known_entity: Optional[str] = None) -> Optional[str]:
        """Return the canonical name this mention refers to, or None if it's new.

        Order: (a) exact normalized match on the full name; (b) the LLM's own
        known_entity hint (it saw the digest); (c) single-token (surname/given) match
        only when unambiguous.
        """
        norm = normalize_name(name)
        if norm and norm in self._by_norm:
            return self._by_norm[norm]
        if llm_known_entity:
            kn = normalize_name(llm_known_entity)
            if kn in self._canonical:
                return self._canonical[kn]
            if kn in self._by_norm:
                return self._by_norm[kn]
        # Single-token fallback: match on last-name/given-name only if exactly one candidate.
        tokens = norm.split()
        if len(tokens) > 1:
            for tok in (tokens[-1], tokens[0]):
                if tok in self._by_norm:
                    return self._by_norm[tok]
        return None

    def canonical_names(self) -> List[str]:
        return sorted(set(self._canonical.values()))


def choose_canonical(existing: Optional[str], candidate: str) -> str:
    """When merging, keep the longer (more specific) name as canonical."""
    if not existing:
        return candidate
    return existing if len(existing) >= len(candidate) else candidate


# Small curated antonym map: if a NEW relationship's type is the antonym of an existing
# open edge between the same pair, the old edge should be closed (valid_to = current chapter).
_ANTONYMS: List[Tuple[str, str]] = [
    ("ally_of", "enemy_of"),
    ("friend_of", "enemy_of"),
    ("member_of", "expelled_from"),
    ("serves", "betrays"),
    ("loves", "hates"),
    ("trusts", "distrusts"),
]


def is_antonym(rel_a: str, rel_b: str) -> bool:
    a, b = rel_a.strip().lower(), rel_b.strip().lower()
    for x, y in _ANTONYMS:
        if {a, b} == {x, y}:
            return True
    return False
