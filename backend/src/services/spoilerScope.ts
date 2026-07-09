/**
 * Server-resolved spoiler scope (plan §2.9).
 *
 * Every boundary-bounded surface (chat, recap, graph, foreshadowing) resolves the reader's
 * spoiler boundary here rather than trusting a raw client parameter. Resolution order:
 *   explicit requestedChapter  ->  reading_progress.last_chapter_order  ->  0.
 * NULL/absent NEVER means "everything" — the default is the front of the book (0), so a forgotten
 * parameter fails safe. Prior volumes are ordered by volume_number (not lexicographic title), so
 * "Vol. 10" sorts after "Vol. 2".
 */

import { pool } from '../db/pool';

export const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';

export interface SpoilerScope {
  storyId: string;
  /** Prior volumes in the same series (by volume_number), fully readable. */
  priorVolumeIds: string[];
  /** Current-volume boundary; content with chapter_order <= this is visible. Never undefined. */
  maxChapterOrder: number;
  /** Stable cache/trace key, e.g. "story:<uuid>:ch:12". */
  boundaryKey: string;
}

/**
 * Resolve the spoiler boundary for a reader.
 * @param storyId the current volume
 * @param requestedChapter explicit boundary from the client (optional)
 * @param userId reader identity (falls back to the default single-user id)
 * @param peekAhead when true, an explicit requestedChapter is honored even if it exceeds progress
 *   (the deliberate "peek ahead" opt-in); otherwise the resolved boundary is the max of request and 0.
 */
export const resolveSpoilerScope = async (
  storyId: string,
  requestedChapter: number | undefined,
  userId: string = DEFAULT_USER_ID,
): Promise<SpoilerScope> => {
  let maxChapterOrder: number;

  if (typeof requestedChapter === 'number' && requestedChapter >= 0) {
    maxChapterOrder = requestedChapter;
  } else {
    const progress = await pool.query(
      'SELECT last_chapter_order FROM reading_progress WHERE user_id = $1 AND story_id = $2',
      [userId, storyId],
    );
    maxChapterOrder = progress.rows[0]?.last_chapter_order ?? 0;
  }

  const priorVolumeIds = await getPriorVolumeIds(storyId);

  return {
    storyId,
    priorVolumeIds,
    maxChapterOrder,
    boundaryKey: `story:${storyId}:ch:${maxChapterOrder}`,
  };
};

/**
 * Story ids of volumes in the same series that come strictly before this one, ordered by
 * volume_number (NULLs last, then title). These are fully readable regardless of chapter boundary.
 */
export const getPriorVolumeIds = async (storyId: string): Promise<string[]> => {
  const result = await pool.query(
    `WITH ordered AS (
       SELECT s2.story_id,
              ROW_NUMBER() OVER (ORDER BY COALESCE(s2.volume_number, 9999), s2.title) AS rn
       FROM stories s1
       JOIN stories s2 ON s2.series_title = s1.series_title AND s1.series_title IS NOT NULL
       WHERE s1.story_id = $1
     )
     SELECT story_id FROM ordered
     WHERE rn < (SELECT rn FROM ordered WHERE story_id = $1)`,
    [storyId],
  );
  return result.rows.map((r: { story_id: string }) => r.story_id);
};
