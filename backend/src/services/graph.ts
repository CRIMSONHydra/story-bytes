/**
 * Knowledge-graph read service (plan §2.14, M15).
 *
 * All queries are spoiler-gated by chapter_order. The foreshadowing query is the delicate one:
 * it returns ONLY the already-read setup and the pre-vetted hint for links in the live window
 * (setup_chapter_order <= N < payoff_chapter_order). The payoff_summary column is NEVER selected
 * here, so a payoff can never reach a reader-facing response by construction.
 *
 * Magnitude (significance) is used only for ranking and is deliberately NOT returned to the client
 * (revealing "a MAJOR thing is set up here" is itself a mild spoiler — plan §2.14.5).
 */

import { pool } from '../db/pool';

export interface CastMember {
  entityId: string;
  name: string;
  entityType: string;
  latestState: string | null;
}

export interface OpenThread {
  name: string;
  latestBeat: string;
}

export interface LastEvent {
  chapterOrder: number;
  title: string;
  description: string;
}

export interface ForeshadowItem {
  setupChapter: number;
  setupSummary: string;
  hint: string;
}

/** Does this story have any extracted graph data at all? Drives empty-state UX. */
export const storyHasGraph = async (storyId: string): Promise<boolean> => {
  const result = await pool.query('SELECT 1 FROM kg_entities WHERE story_id = $1 LIMIT 1', [storyId]);
  return (result.rowCount ?? 0) > 0;
};

/**
 * Top cast visible at the boundary, ranked by relationship degree then recency of first appearance.
 * latestState is the most recent state at or before the boundary.
 */
export const getMainCast = async (
  storyId: string,
  maxChapterOrder: number,
  limit = 6,
): Promise<CastMember[]> => {
  const result = await pool.query(
    `
    SELECT e.entity_id, e.canonical_name, e.entity_type,
      (SELECT s.description FROM kg_entity_states s
        WHERE s.entity_id = e.entity_id AND s.chapter_order <= $2
        ORDER BY s.chapter_order DESC LIMIT 1) AS latest_state,
      (SELECT COUNT(*) FROM kg_relationships r
        WHERE (r.source_entity_id = e.entity_id OR r.target_entity_id = e.entity_id)
          AND r.valid_from_chapter <= $2) AS degree
    FROM kg_entities e
    WHERE e.story_id = $1
      AND e.entity_type = 'character'
      AND e.first_chapter_order <= $2
    ORDER BY degree DESC, e.first_chapter_order DESC
    LIMIT $3
    `,
    [storyId, maxChapterOrder, limit],
  );
  return result.rows.map((r: {
    entity_id: string; canonical_name: string; entity_type: string; latest_state: string | null;
  }) => ({
    entityId: r.entity_id,
    name: r.canonical_name,
    entityType: r.entity_type,
    latestState: r.latest_state,
  }));
};

/**
 * Threads whose latest visible beat (<= boundary) is NOT a payoff/resolution — i.e. still open.
 */
export const getOpenThreads = async (
  storyId: string,
  maxChapterOrder: number,
  limit = 6,
): Promise<OpenThread[]> => {
  const result = await pool.query(
    `
    WITH latest AS (
      SELECT DISTINCT ON (t.thread_id) t.name, b.beat_kind, b.description
      FROM kg_plot_threads t
      JOIN kg_thread_beats b ON b.thread_id = t.thread_id
      WHERE t.story_id = $1 AND b.chapter_order <= $2
      ORDER BY t.thread_id, b.chapter_order DESC
    )
    SELECT name, description FROM latest
    WHERE beat_kind NOT IN ('payoff', 'resolution')
    LIMIT $3
    `,
    [storyId, maxChapterOrder, limit],
  );
  return result.rows.map((r: { name: string; description: string }) => ({
    name: r.name,
    latestBeat: r.description,
  }));
};

/** Most recent event at or before the boundary. */
export const getLastEvent = async (
  storyId: string,
  maxChapterOrder: number,
): Promise<LastEvent | null> => {
  const result = await pool.query(
    `SELECT chapter_order, title, description
     FROM kg_events
     WHERE story_id = $1 AND chapter_order <= $2
     ORDER BY chapter_order DESC, created_at DESC
     LIMIT 1`,
    [storyId, maxChapterOrder],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { chapterOrder: row.chapter_order, title: row.title, description: row.description ?? '' };
};

/**
 * Live foreshadowing links for a reader at the boundary: setup already read, payoff still ahead.
 *
 * SELECTS ONLY setup + hint. payoff_summary is intentionally never in the projection. Ranked by
 * significance (major > notable > minor) then recency, capped — but significance is not returned.
 */
export const getForeshadowLinks = async (
  storyId: string,
  maxChapterOrder: number,
  limit = 5,
): Promise<ForeshadowItem[]> => {
  const result = await pool.query(
    `
    SELECT setup_chapter_order, setup_summary, emphasis_hint
    FROM kg_foreshadow_links
    WHERE story_id = $1
      AND setup_chapter_order <= $2
      AND payoff_chapter_order > $2
    ORDER BY
      CASE significance WHEN 'major' THEN 0 WHEN 'notable' THEN 1 ELSE 2 END,
      setup_chapter_order DESC
    LIMIT $3
    `,
    [storyId, maxChapterOrder, limit],
  );
  return result.rows.map((r: {
    setup_chapter_order: number; setup_summary: string; emphasis_hint: string;
  }) => ({
    setupChapter: r.setup_chapter_order,
    setupSummary: r.setup_summary,
    hint: r.emphasis_hint,
  }));
};

/**
 * Server-side only: the payoff summaries of the currently-live links, for the answer-guard to check
 * generated prose against (foreshadowing chat mode). NEVER returned to a client.
 */
export const getLivePayoffSummaries = async (
  storyId: string,
  maxChapterOrder: number,
  limit = 20,
): Promise<string[]> => {
  const result = await pool.query(
    `SELECT payoff_summary FROM kg_foreshadow_links
     WHERE story_id = $1 AND setup_chapter_order <= $2 AND payoff_chapter_order > $2
     LIMIT $3`,
    [storyId, maxChapterOrder, limit],
  );
  return result.rows.map((r: { payoff_summary: string }) => r.payoff_summary);
};
