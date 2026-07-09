"""Prompts and structured-output contracts for knowledge-graph + foreshadowing extraction.

PROMPT_VERSION is stored on kg_extraction_runs / kg_foreshadow_links so that bumping a
prompt invalidates prior runs and lets --rebuild re-extract deterministically.
"""

import os

PROMPT_VERSION = 1

# Centralized via the GEMINI_MAIN_MODEL env var (see ingestion/models.py). gemini-2.5-flash was
# retired (404). DEMO-STAGE DEFAULT: flash-lite (cost); set GEMINI_MAIN_MODEL=gemini-flash-latest
# to restore the stronger tier post-demo.
GRAPH_MODEL = os.getenv("GEMINI_MAIN_MODEL", "gemini-flash-lite-latest")

# ---------------------------------------------------------------------------
# Per-chapter graph extraction (chapter-local: only sees text up to this chapter)
# ---------------------------------------------------------------------------

GRAPH_SYSTEM = (
    "You extract a chapter-versioned knowledge graph from a single chapter of a story. "
    "You are given the running list of entities already known from EARLIER chapters (the digest) "
    "and the text of the CURRENT chapter. Extract only what THIS chapter reveals. "
    "Return STRICT JSON, no markdown."
)

GRAPH_INSTRUCTIONS = """Return a JSON object with these keys:

"entities": array of objects, one per character/faction/location/item/concept that appears or is
  meaningfully referenced in this chapter:
  - "name": the clearest name used for it in this chapter
  - "type": one of "character","faction","location","item","concept"
  - "known_entity": if this is an entity ALREADY in the digest, its canonical name from the digest; else null
  - "new_aliases": array of alternate names/epithets used for it in THIS chapter (e.g. "the Superd warrior")
  - "description": one spoiler-safe sentence describing it as understood at this point
  - "state_change": {"description": "...", "status": "alive|dead|missing|unknown|..."} if this chapter
    changes its status/situation, else null

"relationships": array of directed relationships asserted or changed in this chapter:
  - "source_name", "target_name": entity names (use names that appear in "entities")
  - "rel_type": a lowercase verb phrase, e.g. "ally_of","enemy_of","parent_of","member_of","located_in","loves","serves"
  - "description": one short sentence
  - "change": "new" (first established here), "ended" (this relationship stops here), or "unchanged" (reaffirmed)

"events": array of notable events happening in this chapter:
  - "title": short label
  - "type": e.g. "battle","revelation","death","journey","meeting","discovery"
  - "description": one or two sentences
  - "participant_names": array of entity names involved

"thread_beats": array of plot-thread beats. A thread is a through-line that spans chapters
  (a mystery, a goal, a prophecy, a relationship arc). For each beat this chapter contributes:
  - "thread": a stable short name for the thread (reuse the same wording across chapters)
  - "kind": one of "setup" (a seed/hook is planted), "development","foreshadowing" (an ominous or
    oddly-specific hint whose meaning is not yet clear), "payoff" (a seed is cashed in), "resolution"
  - "description": one sentence describing the beat AS IT APPEARS in this chapter (do not explain
    what it will later mean)

Only include entities/relationships/events/beats actually supported by this chapter's text.
If the chapter is front-matter or has no narrative content, return empty arrays."""


def build_graph_prompt(chapter_title: str, chapter_order: int, digest: str, chapter_text: str) -> str:
    return (
        f"{GRAPH_INSTRUCTIONS}\n\n"
        f"KNOWN ENTITIES SO FAR (from earlier chapters):\n{digest or '(none yet)'}\n\n"
        f"CURRENT CHAPTER {chapter_order}: {chapter_title}\n"
        f"----------------------------------------\n{chapter_text}\n"
        f"----------------------------------------\n"
        f"Return the JSON now."
    )


# ---------------------------------------------------------------------------
# Book-level foreshadowing linking (deliberately sees the WHOLE book — offline only)
# ---------------------------------------------------------------------------

FORESHADOW_SYSTEM = (
    "You identify foreshadowing in a story: early details ('setups') that are cashed in by later "
    "events ('payoffs'). You are given the full list of plot-thread beats with chapter numbers. "
    "This is an OFFLINE analysis with full-book access. Return STRICT JSON, no markdown."
)

FORESHADOW_INSTRUCTIONS = """Given the plot-thread beats below (each with a chapter number), find
foreshadowing LINKS: a setup/foreshadowing beat at an EARLIER chapter that is paid off or resolved at
a LATER chapter. Only create a link when the payoff chapter is strictly greater than the setup chapter.

Return a JSON object: {"links": [ ... ]} where each link is:
  - "setup_chapter": integer, the chapter where the seed/hint is planted
  - "payoff_chapter": integer, the LATER chapter where it is cashed in (must be > setup_chapter)
  - "setup_summary": one sentence describing ONLY the setup as it appeared, using only information a
    reader who has read up to the setup chapter would already know. Do NOT mention the payoff.
  - "payoff_summary": one sentence describing what the setup leads to / how it pays off (this is the
    spoiler; it will be stored but never shown to a reader who has not reached the payoff chapter)
  - "significance": "minor","notable", or "major" — how important the payoff is to the story
  - "confidence": 0.0-1.0, how confident you are this is genuine foreshadowing (not a coincidence)
  - "thread": the exact plot-thread name (from the beats above) this foreshadowing belongs to, or null
    if it spans no single named thread

Be conservative: only report links you are reasonably confident are intentional foreshadowing.
Prefer fewer, high-quality links. Return {"links": []} if none."""


def build_foreshadow_prompt(beats_text: str) -> str:
    return (
        f"{FORESHADOW_INSTRUCTIONS}\n\n"
        f"PLOT-THREAD BEATS (chapter: thread — kind — description):\n{beats_text}\n\n"
        f"Return the JSON now."
    )


# ---------------------------------------------------------------------------
# Constrained emphasis-hint generation (sees ONLY the setup — never the payoff)
# ---------------------------------------------------------------------------

HINT_SYSTEM = (
    "You write a single subtle sentence telling a reader why a detail they have already read is worth "
    "keeping in mind. You must NOT reveal or hint at what it leads to."
)

HINT_INSTRUCTIONS = """You are given ONLY a setup detail from a story that a reader has already read.
Write ONE sentence (max ~25 words) that gently flags this detail as worth remembering, using ONLY
information contained in the setup itself.

HARD RULES:
- Do NOT reveal, name, describe, or allude to anything that happens later or what this leads to.
- Do NOT say "this foreshadows", "this sets up", "this leads to", "later", "will become", or similar.
- Frame it as "worth keeping in mind" / "an odd detail" / "easy to overlook" — a nudge, not an explanation.
- Do NOT invent facts not present in the setup.

Return a JSON object: {"hint": "your one sentence"}.

SETUP DETAIL (all the reader knows):
{setup}
"""


def build_hint_prompt(setup_summary: str) -> str:
    return HINT_INSTRUCTIONS.replace("{setup}", setup_summary)
