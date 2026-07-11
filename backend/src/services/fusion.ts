/**
 * Rank fusion (M10, RAG D8). Reciprocal Rank Fusion (RRF) combines the semantic and keyword result
 * lists by RANK rather than by comparing incomparable score scales — replacing the old
 * `similarity * 0.3` fudge factor, which mixed cosine scores with keyword scores that don't share a
 * range. A similarity floor first drops near-noise semantic matches.
 *
 * RRF(d) = Σ_lists 1 / (k + rank_list(d)), with the conventional k = 60. Higher = better.
 */

const RRF_K = 60;

/** Drop items whose score is below `floor` (use on the semantic list before fusion). */
export const applyFloor = <T>(items: T[], scoreOf: (t: T) => number, floor: number): T[] =>
  items.filter((it) => scoreOf(it) >= floor);

export interface FusedResult<T> {
  item: T;
  score: number;
}

/**
 * Fuse several ranked lists (each already ordered best-first) into one ranking by RRF. The first
 * time an id is seen, that item object is kept; later duplicates only add to its fused score.
 */
export const reciprocalRankFusion = <T>(
  lists: T[][],
  idOf: (t: T) => string,
  k: number = RRF_K,
): FusedResult<T>[] => {
  const scores = new Map<string, number>();
  const items = new Map<string, T>();

  for (const list of lists) {
    list.forEach((item, rank) => {
      const id = idOf(item);
      if (!items.has(id)) items.set(id, item);
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    });
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ item: items.get(id) as T, score }))
    .sort((a, b) => b.score - a.score);
};
