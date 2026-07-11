/**
 * Centralized Gemini model IDs (plan §11).
 *
 * Kept in one place so a model swap is a one-line, env-overridable change — prompted by Google
 * retiring gemini-2.5-flash and gemini-2.5-flash-lite (both now 404). The `-latest` aliases track
 * the current flash / flash-lite tier and survive future retirements; override via env to pin an
 * explicit version. Embeddings run on gemini-embedding-2; note that the DB embedding TAG
 * (block_embeddings.model, see EMBEDDING_MODEL_TAG in llm.ts) is a separate value that must match
 * stored vectors and is NOT this call-time model id.
 */

/**
 * Main reasoning model: chat, summaries, structured generation, image tagging/enrichment.
 * DEMO-STAGE DEFAULT: flash-lite (full flash is too expensive at demo volume). Override with
 * GEMINI_MAIN_MODEL=gemini-flash-latest to restore the stronger tier once past the demo.
 */
export const MAIN_MODEL = process.env.GEMINI_MAIN_MODEL || 'gemini-flash-lite-latest';

/** Cheap/fast model: answer-guard, rewrite/judge, other JSON helpers. */
export const LITE_MODEL = process.env.GEMINI_LITE_MODEL || 'gemini-flash-lite-latest';

/**
 * Embedding model. Migrated to gemini-embedding-2 (MRL, multimodal, 8192-token input, better MTEB):
 * it has NO task_type param — task instructions go IN the input text (see llm.ts) — and it
 * auto-normalizes truncated (non-3072) dimensions, so cosine works directly at 1536.
 */
export const EMBEDDING_MODEL_ID = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2';

/** Output dimensionality (MRL). 1536 is a recommended size, HNSW-indexable (<=2000), auto-normalized. */
export const EMBEDDING_DIMENSIONS = Number(process.env.GEMINI_EMBEDDING_DIMS || 1536);

/**
 * Image generation (M17). Nano-Banana (gemini-2.5-flash-image) via generateContent image output.
 * Live generation is gated + capped: IMAGE_GEN_ENABLED (default on), IMAGE_GEN_DAILY_CAP images/day.
 * Generated character images are private (served from disk; no public sharing) per the IP posture.
 */
export const IMAGE_GEN_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
export const IMAGE_GEN_ENABLED = (process.env.IMAGE_GEN_ENABLED || 'true') !== 'false';
export const IMAGE_GEN_DAILY_CAP = Number(process.env.IMAGE_GEN_DAILY_CAP || 25);
