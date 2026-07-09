/**
 * Centralized Gemini model IDs (plan §11).
 *
 * Kept in one place so a model swap is a one-line, env-overridable change — prompted by Google
 * retiring gemini-2.5-flash and gemini-2.5-flash-lite (both now 404). The `-latest` aliases track
 * the current flash / flash-lite tier and survive future retirements; override via env to pin an
 * explicit version. Embeddings stay on gemini-embedding-001 (still active); note that the DB
 * embedding TAG (block_embeddings.model, see EMBEDDING_MODEL_TAG in llm.ts) is a separate value that
 * must match stored vectors and is NOT this call-time model id.
 */

/** Main reasoning model: chat, summaries, structured generation, image tagging/enrichment. */
export const MAIN_MODEL = process.env.GEMINI_MAIN_MODEL || 'gemini-flash-latest';

/** Cheap/fast model: answer-guard, rewrite/judge, other JSON helpers. */
export const LITE_MODEL = process.env.GEMINI_LITE_MODEL || 'gemini-flash-lite-latest';

/** Embedding model (768-dim). */
export const EMBEDDING_MODEL_ID = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
