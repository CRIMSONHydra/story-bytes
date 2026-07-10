"""Centralized Gemini model IDs for ingestion (plan §11).

Mirrors backend/src/config/models.ts. Kept in one place so a model swap is a one-line,
env-overridable change — prompted by Google retiring gemini-2.5-flash / gemini-2.5-flash-lite
(both now 404). The `-latest` aliases track the current tier and survive future retirements.
"""

import os

# Main reasoning model: per-chapter graph extraction, foreshadow linking, image tagging/enrichment.
# DEMO-STAGE DEFAULT: flash-lite (full flash is too costly at demo volume). Set
# GEMINI_MAIN_MODEL=gemini-flash-latest to restore the stronger tier post-demo.
GRAPH_MODEL = os.getenv("GEMINI_MAIN_MODEL", "gemini-flash-lite-latest")
IMAGE_MODEL = os.getenv("GEMINI_MAIN_MODEL", "gemini-flash-lite-latest")

# Cheap/fast model: payoff-leak guard and other JSON helpers.
GUARD_MODEL = os.getenv("GEMINI_LITE_MODEL", "gemini-flash-lite-latest")

# Embedding: gemini-embedding-2 (MRL, multimodal, 8192-token input, auto-normalized at truncated
# dims). No task_type param — task instructions go in the input text. Must match the backend
# (backend/src/config/models.ts + EMBEDDING_MODEL_TAG in llm.ts).
EMBEDDING_MODEL = os.getenv("GEMINI_EMBEDDING_MODEL", "gemini-embedding-2")
EMBEDDING_DIMENSIONS = int(os.getenv("GEMINI_EMBEDDING_DIMS", "1536"))
# Retrieval matches block_embeddings.model on this tag; keep in sync with backend EMBEDDING_MODEL_TAG.
EMBEDDING_MODEL_TAG = os.getenv("EMBEDDING_MODEL_TAG", f"{EMBEDDING_MODEL}/{EMBEDDING_DIMENSIONS}")


def embedding_input(text: str, kind: str = "document") -> str:
    """gemini-embedding-2 in-prompt task instruction (query vs document)."""
    return f"task: search result | query: {text}" if kind == "query" else f"text: {text}"
