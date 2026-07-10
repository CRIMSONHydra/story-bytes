/**
 * Chapter management (M13). Rename / front-matter toggle / delete (with annotation count) / reorder,
 * plus paste-append: chunk + embed ONLY the new chapter (so appending to a 50-chapter book costs
 * one chapter's embeddings, not a re-ingest). Any mutation that changes chapter content or order
 * invalidates the story's cached summaries so recap/summarize regenerate.
 */

import { createHash } from 'crypto';

import { pool } from '../db/pool';
import { generateEmbedding, EMBEDDING_MODEL_TAG } from './llm';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL_ID } from '../config/models';
import { costFor } from './pricing';
import { splitIntoChunks } from './chunk';

export interface AdminChapter {
  chapterId: string;
  order: number;
  title: string | null;
  isFrontMatter: boolean;
  blockCount: number;
}

const vectorLiteral = (v: number[]): string => `[${v.join(',')}]`;

/** Drop cached summaries for a story (called after any content/order mutation). */
const invalidateSummaries = async (storyId: string): Promise<void> => {
  await pool.query('DELETE FROM chapter_summaries WHERE story_id = $1', [storyId]);
};

/** All chapters (incl. front-matter) with block counts, for the management UI. */
export const listChaptersForAdmin = async (storyId: string): Promise<AdminChapter[]> => {
  const { rows } = await pool.query<{
    chapter_id: string; chapter_order: number; title: string | null;
    is_front_matter: boolean; block_count: string;
  }>(
    `SELECT c.chapter_id, c.chapter_order, c.title, c.is_front_matter,
            COUNT(b.block_id) AS block_count
     FROM chapters c LEFT JOIN chapter_blocks b ON b.chapter_id = c.chapter_id
     WHERE c.story_id = $1
     GROUP BY c.chapter_id ORDER BY c.chapter_order`,
    [storyId],
  );
  return rows.map((r) => ({
    chapterId: r.chapter_id, order: r.chapter_order, title: r.title,
    isFrontMatter: r.is_front_matter, blockCount: Number(r.block_count),
  }));
};

export const updateChapter = async (
  chapterId: string,
  fields: { title?: string; isFrontMatter?: boolean },
): Promise<AdminChapter | null> => {
  const { rows } = await pool.query<{ story_id: string }>(
    `UPDATE chapters
     SET title = COALESCE($2, title),
         is_front_matter = COALESCE($3, is_front_matter),
         updated_at = NOW()
     WHERE chapter_id = $1
     RETURNING story_id`,
    [chapterId, fields.title ?? null, fields.isFrontMatter ?? null],
  );
  if (!rows[0]) return null;
  const list = await listChaptersForAdmin(rows[0].story_id);
  return list.find((c) => c.chapterId === chapterId) ?? null;
};

/** Delete a chapter; returns how many annotations were attached (for a confirm prompt) or null. */
export const deleteChapterWithCount = async (
  chapterId: string,
): Promise<{ annotationCount: number } | null> => {
  const { rows } = await pool.query<{ story_id: string; annotation_count: string }>(
    `SELECT c.story_id, (SELECT COUNT(*) FROM annotations a WHERE a.chapter_id = c.chapter_id) AS annotation_count
     FROM chapters c WHERE c.chapter_id = $1`,
    [chapterId],
  );
  if (!rows[0]) return null;
  await pool.query('DELETE FROM chapters WHERE chapter_id = $1', [chapterId]);
  await invalidateSummaries(rows[0].story_id);
  return { annotationCount: Number(rows[0].annotation_count) };
};

/** Set chapter_order to match the given id order (0-based → 1..n). Two-phase to dodge the
 * unique (story_id, chapter_order) constraint mid-update. */
export const reorderChapters = async (storyId: string, orderedIds: string[]): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Phase 1: park at negative orders so no two rows collide during the shuffle.
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query(
        'UPDATE chapters SET chapter_order = $1 WHERE chapter_id = $2 AND story_id = $3',
        [-(i + 1), orderedIds[i], storyId],
      );
    }
    // Phase 2: settle at the final 1..n ordering.
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query(
        'UPDATE chapters SET chapter_order = $1, updated_at = NOW() WHERE chapter_id = $2 AND story_id = $3',
        [i + 1, orderedIds[i], storyId],
      );
    }
    await client.query('DELETE FROM chapter_summaries WHERE story_id = $1', [storyId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export interface AppendResult {
  chapterId: string;
  order: number;
  blocks: number;
}

/** Append a pasted chapter: chunk + embed only this chapter, then invalidate summaries. */
export const appendChapter = async (
  storyId: string,
  title: string,
  text: string,
  isFrontMatter = false,
): Promise<AppendResult> => {
  const orderRow = await pool.query<{ next: number }>(
    'SELECT COALESCE(MAX(chapter_order), 0) + 1 AS next FROM chapters WHERE story_id = $1',
    [storyId],
  );
  const order = Number(orderRow.rows[0].next);
  const contentHash = createHash('sha256').update(`${title}\n${text}`).digest('hex');

  const chapterRow = await pool.query<{ chapter_id: string }>(
    `INSERT INTO chapters (story_id, chapter_order, title, aggregated_text, content_hash, is_front_matter)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING chapter_id`,
    [storyId, order, title, text, contentHash, isFrontMatter],
  );
  const chapterId = chapterRow.rows[0].chapter_id;

  const chunks = splitIntoChunks(text);
  let blockIndex = 0;
  for (const chunk of chunks) {
    const blockRow = await pool.query<{ block_id: string }>(
      `INSERT INTO chapter_blocks (chapter_id, block_index, block_type, text_content)
       VALUES ($1, $2, 'text', $3) RETURNING block_id`,
      [chapterId, blockIndex++, chunk],
    );
    if (chunk.trim().length > 10) {
      const vector = await generateEmbedding(chunk, 'document'); // records embedding usage
      await pool.query(
        `INSERT INTO block_embeddings (block_id, model, dimensions, vector)
         VALUES ($1, $2, $3, $4::vector)
         ON CONFLICT (block_id, model) DO UPDATE SET vector = EXCLUDED.vector`,
        [blockRow.rows[0].block_id, EMBEDDING_MODEL_TAG, EMBEDDING_DIMENSIONS, vectorLiteral(vector)],
      );
    }
  }

  await invalidateSummaries(storyId);
  return { chapterId, order, blocks: chunks.length };
};

/** Read-time cost estimate for pasting `text` (embedding only), from pricing.ts. */
export const estimateAppendCost = (text: string): {
  chunks: number; estimatedTokens: number; estimatedCostUsd: number;
} => {
  const chunks = splitIntoChunks(text).filter((c) => c.trim().length > 10);
  const estimatedTokens = chunks.reduce((sum, c) => sum + Math.ceil(c.length / 4), 0);
  return {
    chunks: chunks.length,
    estimatedTokens,
    estimatedCostUsd: Number(costFor(EMBEDDING_MODEL_ID, estimatedTokens, 0).toFixed(6)),
  };
};
