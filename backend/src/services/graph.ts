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
 * Minimum narrative gap (chapters) between a setup and its payoff for the link to be surfaced.
 * Adjacent-chapter "links" are usually just plot progression, not genuine foreshadowing, and
 * flagging them risks telegraphing the payoff (an obvious next-chapter consequence). Genuine
 * foreshadowing spans distance. See docs/IMPROVEMENT_PLAN.md §2.14.5 (meta-spoiler control).
 */
export const MIN_FORESHADOW_GAP = 2;

/**
 * Live foreshadowing links for a reader at the boundary: setup already read, payoff still ahead
 * by at least MIN_FORESHADOW_GAP chapters.
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
      AND payoff_chapter_order - setup_chapter_order >= $4
    ORDER BY
      CASE significance WHEN 'major' THEN 0 WHEN 'notable' THEN 1 ELSE 2 END,
      setup_chapter_order DESC
    LIMIT $3
    `,
    [storyId, maxChapterOrder, limit, MIN_FORESHADOW_GAP],
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
       AND payoff_chapter_order - setup_chapter_order >= $4
     LIMIT $3`,
    [storyId, maxChapterOrder, limit, MIN_FORESHADOW_GAP],
  );
  return result.rows.map((r: { payoff_summary: string }) => r.payoff_summary);
};

// ---------------------------------------------------------------------------
// M15 — graph reader queries (all spoiler-gated by chapter_order).
//
// Spoiler visibility (plan §3.2 KG): entity visible iff first_chapter_order <= N; an alias visible
// iff its own first_chapter_order <= N; a state = the latest with chapter_order <= N; a relationship
// visible iff valid_from_chapter <= N, with its END (valid_to_chapter) shown ONLY when it too is
// <= N (the end of a relationship is itself a spoiler). Scoped to the current story in v1
// (cross-volume identity via kg_entity_links is not yet populated).
// ---------------------------------------------------------------------------

export interface GraphEntity {
  entityId: string;
  entityType: string;
  name: string;
  aliases: string[];
  latestState: string | null;
  firstChapter: number;
  degree: number;
}

export interface GraphEdge {
  relId: string;
  sourceId: string;
  targetId: string;
  relType: string;
  description: string | null;
  sinceChapter: number;
  untilChapter: number | null;
}

export interface GraphData {
  entities: GraphEntity[];
  edges: GraphEdge[];
  generatedUpTo: number;
}

const VALID_ENTITY_TYPES = ['character', 'faction', 'location', 'item', 'concept'];

const mapEntity = (r: {
  entity_id: string; entity_type: string; canonical_name: string;
  aliases: string[] | null; latest_state: string | null; first_chapter_order: number; degree?: string | number;
}): GraphEntity => ({
  entityId: r.entity_id,
  entityType: r.entity_type,
  name: r.canonical_name,
  aliases: r.aliases ?? [],
  latestState: r.latest_state,
  firstChapter: r.first_chapter_order,
  degree: Number(r.degree ?? 0),
});

const ENTITY_SELECT = (boundaryParam: string) => `
  e.entity_id, e.entity_type, e.canonical_name, e.first_chapter_order,
  (SELECT COALESCE(array_agg(a.alias ORDER BY a.alias), '{}')
     FROM kg_entity_aliases a
     WHERE a.entity_id = e.entity_id AND a.first_chapter_order <= ${boundaryParam}) AS aliases,
  (SELECT s.description FROM kg_entity_states s
     WHERE s.entity_id = e.entity_id AND s.chapter_order <= ${boundaryParam}
     ORDER BY s.chapter_order DESC LIMIT 1) AS latest_state,
  (SELECT COUNT(*) FROM kg_relationships r
     WHERE (r.source_entity_id = e.entity_id OR r.target_entity_id = e.entity_id)
       AND r.valid_from_chapter <= ${boundaryParam}) AS degree`;

/** Full spoiler-safe graph slice for the browsable graph page. */
export const getStoryGraph = async (
  storyId: string,
  maxChapterOrder: number,
  types?: string[],
): Promise<GraphData> => {
  const typeFilter = types && types.length > 0
    ? types.filter((t) => VALID_ENTITY_TYPES.includes(t))
    : null;

  const entityResult = await pool.query(
    `SELECT ${ENTITY_SELECT('$2')}
     FROM kg_entities e
     WHERE e.story_id = $1 AND e.first_chapter_order <= $2
       AND ($3::text[] IS NULL OR e.entity_type = ANY($3))
     ORDER BY degree DESC, e.first_chapter_order`,
    [storyId, maxChapterOrder, typeFilter],
  );
  const entities = entityResult.rows.map(mapEntity);

  // Edges: both endpoints already visible, edge opened by the boundary; hide the end if it's ahead.
  const edgeResult = await pool.query(
    `SELECT r.rel_id, r.source_entity_id, r.target_entity_id, r.rel_type, r.description,
            r.valid_from_chapter AS since_chapter,
            CASE WHEN r.valid_to_chapter <= $2 THEN r.valid_to_chapter ELSE NULL END AS until_chapter
     FROM kg_relationships r
     JOIN kg_entities se ON se.entity_id = r.source_entity_id AND se.first_chapter_order <= $2
     JOIN kg_entities te ON te.entity_id = r.target_entity_id AND te.first_chapter_order <= $2
     WHERE r.story_id = $1 AND r.valid_from_chapter <= $2`,
    [storyId, maxChapterOrder],
  );
  const edges: GraphEdge[] = edgeResult.rows.map((r: {
    rel_id: string; source_entity_id: string; target_entity_id: string; rel_type: string;
    description: string | null; since_chapter: number; until_chapter: number | null;
  }) => ({
    relId: r.rel_id, sourceId: r.source_entity_id, targetId: r.target_entity_id,
    relType: r.rel_type, description: r.description,
    sinceChapter: r.since_chapter, untilChapter: r.until_chapter,
  }));

  return { entities, edges, generatedUpTo: maxChapterOrder };
};

/** Entity list / search for pickers. `q` matches only reader-visible aliases + canonical names. */
export const searchEntities = async (
  storyId: string,
  maxChapterOrder: number,
  q?: string,
  type?: string,
  limit = 30,
): Promise<GraphEntity[]> => {
  const like = q && q.trim() ? `%${q.trim().toLowerCase()}%` : null;
  const result = await pool.query(
    `SELECT ${ENTITY_SELECT('$2')}
     FROM kg_entities e
     WHERE e.story_id = $1 AND e.first_chapter_order <= $2
       AND ($4::text IS NULL OR e.entity_type = $4)
       AND ($3::text IS NULL
            OR LOWER(e.canonical_name) LIKE $3
            OR EXISTS (SELECT 1 FROM kg_entity_aliases a
                        WHERE a.entity_id = e.entity_id
                          AND a.first_chapter_order <= $2
                          AND LOWER(a.alias) LIKE $3))
     ORDER BY degree DESC, e.first_chapter_order
     LIMIT $5`,
    [storyId, maxChapterOrder, like, type ?? null, limit],
  );
  return result.rows.map(mapEntity);
};

export interface EntityDetail {
  entity: {
    entityId: string; entityType: string; name: string;
    aliases: string[]; description: string | null; firstChapter: number;
  };
  states: { chapter: number; description: string; status: string | null }[];
  edges: GraphEdge[];
  events: { eventId: string; chapter: number; title: string; eventType: string | null; role: string }[];
  evidence: { chapter: number; quote: string | null; blockId: string | null }[];
}

/** Full detail for one entity, or null if it does not exist / is not yet revealed at the boundary. */
export const getEntityDetail = async (
  entityId: string,
  maxChapterOrder: number,
): Promise<EntityDetail | null> => {
  const entRes = await pool.query(
    `SELECT entity_id, entity_type, canonical_name, description, first_chapter_order, story_id
     FROM kg_entities WHERE entity_id = $1`,
    [entityId],
  );
  const ent = entRes.rows[0];
  // Existence itself is a spoiler: 404 when the entity is not yet revealed at this boundary.
  if (!ent || ent.first_chapter_order > maxChapterOrder) return null;

  const [aliasRes, stateRes, edgeRes, eventRes, evidRes] = await Promise.all([
    pool.query(
      `SELECT alias FROM kg_entity_aliases WHERE entity_id = $1 AND first_chapter_order <= $2 ORDER BY alias`,
      [entityId, maxChapterOrder]),
    pool.query(
      `SELECT chapter_order, description, status FROM kg_entity_states
       WHERE entity_id = $1 AND chapter_order <= $2 ORDER BY chapter_order`,
      [entityId, maxChapterOrder]),
    pool.query(
      `SELECT r.rel_id, r.source_entity_id, r.target_entity_id, r.rel_type, r.description,
              r.valid_from_chapter AS since_chapter,
              CASE WHEN r.valid_to_chapter <= $2 THEN r.valid_to_chapter ELSE NULL END AS until_chapter
       FROM kg_relationships r
       WHERE (r.source_entity_id = $1 OR r.target_entity_id = $1) AND r.valid_from_chapter <= $2`,
      [entityId, maxChapterOrder]),
    pool.query(
      `SELECT ev.event_id, ev.chapter_order, ev.title, ev.event_type, p.role
       FROM kg_event_participants p JOIN kg_events ev ON ev.event_id = p.event_id
       WHERE p.entity_id = $1 AND ev.chapter_order <= $2 ORDER BY ev.chapter_order`,
      [entityId, maxChapterOrder]),
    pool.query(
      `SELECT chapter_order, quote, block_id FROM kg_evidence
       WHERE subject_type = 'entity' AND subject_id = $1 AND chapter_order <= $2 ORDER BY chapter_order`,
      [entityId, maxChapterOrder]),
  ]);

  return {
    entity: {
      entityId: ent.entity_id, entityType: ent.entity_type, name: ent.canonical_name,
      aliases: aliasRes.rows.map((a: { alias: string }) => a.alias),
      description: ent.description, firstChapter: ent.first_chapter_order,
    },
    states: stateRes.rows.map((s: { chapter_order: number; description: string; status: string | null }) =>
      ({ chapter: s.chapter_order, description: s.description, status: s.status })),
    edges: edgeRes.rows.map((r: {
      rel_id: string; source_entity_id: string; target_entity_id: string; rel_type: string;
      description: string | null; since_chapter: number; until_chapter: number | null;
    }) => ({
      relId: r.rel_id, sourceId: r.source_entity_id, targetId: r.target_entity_id, relType: r.rel_type,
      description: r.description, sinceChapter: r.since_chapter, untilChapter: r.until_chapter,
    })),
    events: eventRes.rows.map((e: {
      event_id: string; chapter_order: number; title: string; event_type: string | null; role: string;
    }) => ({ eventId: e.event_id, chapter: e.chapter_order, title: e.title, eventType: e.event_type, role: e.role })),
    evidence: evidRes.rows.map((e: { chapter_order: number; quote: string | null; block_id: string | null }) =>
      ({ chapter: e.chapter_order, quote: e.quote, blockId: e.block_id })),
  };
};

export interface ThreadStatus {
  threadId: string;
  name: string;
  status: 'open' | 'resolved';
  beats: { kind: string; chapter: number; description: string }[];
}

/** All threads with beats visible at the boundary, each marked open/resolved as of N. */
export const getThreadsWithStatus = async (
  storyId: string,
  maxChapterOrder: number,
): Promise<ThreadStatus[]> => {
  const result = await pool.query(
    `SELECT t.thread_id, t.name, b.beat_kind, b.chapter_order, b.description
     FROM kg_plot_threads t
     JOIN kg_thread_beats b ON b.thread_id = t.thread_id
     WHERE t.story_id = $1 AND t.first_chapter_order <= $2 AND b.chapter_order <= $2
     ORDER BY t.name, b.chapter_order`,
    [storyId, maxChapterOrder],
  );
  const byThread = new Map<string, ThreadStatus>();
  for (const r of result.rows as {
    thread_id: string; name: string; beat_kind: string; chapter_order: number; description: string;
  }[]) {
    let t = byThread.get(r.thread_id);
    if (!t) {
      t = { threadId: r.thread_id, name: r.name, status: 'open', beats: [] };
      byThread.set(r.thread_id, t);
    }
    t.beats.push({ kind: r.beat_kind, chapter: r.chapter_order, description: r.description });
  }
  // A thread is resolved iff its latest visible beat is a payoff/resolution.
  for (const t of byThread.values()) {
    const last = t.beats[t.beats.length - 1];
    t.status = last && (last.kind === 'payoff' || last.kind === 'resolution') ? 'resolved' : 'open';
  }
  return [...byThread.values()];
};

/**
 * Map of reader-visible alias/canonical (lowercased) -> entityId, for query-time alias expansion.
 * Only aliases revealed at or before the boundary are included (knowing "the masked knight is X"
 * may itself be a spoiler).
 */
export const getVisibleAliases = async (
  storyId: string,
  maxChapterOrder: number,
): Promise<Map<string, string>> => {
  const result = await pool.query(
    `SELECT e.entity_id, e.canonical_name AS name, NULL::text AS alias, e.first_chapter_order AS fc
       FROM kg_entities e WHERE e.story_id = $1 AND e.first_chapter_order <= $2
     UNION ALL
     SELECT a.entity_id, NULL AS name, a.alias, a.first_chapter_order AS fc
       FROM kg_entity_aliases a JOIN kg_entities e ON e.entity_id = a.entity_id
       WHERE e.story_id = $1 AND e.first_chapter_order <= $2 AND a.first_chapter_order <= $2`,
    [storyId, maxChapterOrder],
  );
  const map = new Map<string, string>();
  for (const r of result.rows as { entity_id: string; name: string | null; alias: string | null }[]) {
    const key = (r.name ?? r.alias ?? '').trim().toLowerCase();
    if (key) map.set(key, r.entity_id);
  }
  return map;
};

export interface NamedEdge {
  sourceName: string;
  targetName: string;
  relType: string;
  description: string | null;
  sinceChapter: number;
  untilChapter: number | null;
}

/**
 * Depth-1 ego network for the given seed entities: their directly-visible relationships with
 * neighbor names resolved, for injecting into the RAG prompt as "known facts". Spoiler-gated:
 * edge visible iff valid_from <= N and both endpoints revealed; the END is hidden unless <= N.
 */
export const getEgoNetwork = async (
  entityIds: string[],
  storyId: string,
  maxChapterOrder: number,
  limit = 25,
): Promise<NamedEdge[]> => {
  if (entityIds.length === 0) return [];
  const result = await pool.query(
    `SELECT s.canonical_name AS source_name, t.canonical_name AS target_name,
            r.rel_type, r.description, r.valid_from_chapter AS since_chapter,
            CASE WHEN r.valid_to_chapter <= $2 THEN r.valid_to_chapter ELSE NULL END AS until_chapter
     FROM kg_relationships r
     JOIN kg_entities s ON s.entity_id = r.source_entity_id AND s.first_chapter_order <= $2
     JOIN kg_entities t ON t.entity_id = r.target_entity_id AND t.first_chapter_order <= $2
     WHERE r.story_id = $3 AND r.valid_from_chapter <= $2
       AND (r.source_entity_id = ANY($1::uuid[]) OR r.target_entity_id = ANY($1::uuid[]))
     ORDER BY r.valid_from_chapter
     LIMIT $4`,
    [entityIds, maxChapterOrder, storyId, limit],
  );
  return result.rows.map((r: {
    source_name: string; target_name: string; rel_type: string; description: string | null;
    since_chapter: number; until_chapter: number | null;
  }) => ({
    sourceName: r.source_name, targetName: r.target_name, relType: r.rel_type,
    description: r.description, sinceChapter: r.since_chapter, untilChapter: r.until_chapter,
  }));
};

/**
 * Entity-linking for GraphRAG: whole-word, case-insensitive scan of the query against the
 * reader-visible alias map. Returns the matched entities (deduped) as compact GraphEntity records.
 */
export const linkEntities = async (
  query: string,
  storyId: string,
  maxChapterOrder: number,
  limit = 6,
): Promise<GraphEntity[]> => {
  const aliasMap = await getVisibleAliases(storyId, maxChapterOrder);
  if (aliasMap.size === 0) return [];
  const q = ` ${query.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ')} `;
  const matchedIds = new Set<string>();
  for (const [alias, entityId] of aliasMap) {
    if (alias.length < 3) continue; // skip noise like "he", "it"
    if (q.includes(` ${alias} `)) matchedIds.add(entityId);
  }
  if (matchedIds.size === 0) return [];
  const ids = [...matchedIds].slice(0, limit);
  const result = await pool.query(
    `SELECT ${ENTITY_SELECT('$2')} FROM kg_entities e WHERE e.entity_id = ANY($1::uuid[]) AND e.first_chapter_order <= $2`,
    [ids, maxChapterOrder],
  );
  return result.rows.map(mapEntity);
};
