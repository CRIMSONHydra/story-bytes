"""Centralized Gemini model IDs for ingestion (plan §11).

Mirrors backend/src/config/models.ts. Kept in one place so a model swap is a one-line,
env-overridable change — prompted by Google retiring gemini-2.5-flash / gemini-2.5-flash-lite
(both now 404). The `-latest` aliases track the current tier and survive future retirements.
"""

import os

# Main reasoning model: per-chapter graph extraction, foreshadow linking, image tagging/enrichment.
GRAPH_MODEL = os.getenv("GEMINI_MAIN_MODEL", "gemini-flash-latest")
IMAGE_MODEL = os.getenv("GEMINI_MAIN_MODEL", "gemini-flash-latest")

# Cheap/fast model: payoff-leak guard and other JSON helpers.
GUARD_MODEL = os.getenv("GEMINI_LITE_MODEL", "gemini-flash-lite-latest")

# Embedding model (768-dim), still active.
EMBEDDING_MODEL = os.getenv("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001")
