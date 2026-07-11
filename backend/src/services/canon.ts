/**
 * Character canon (M16) — the spoiler-safe visual "truth" about an entity at a chapter boundary.
 * `buildCanon` slices appearance facts to those revealed at or before the boundary and supersedes
 * older facts of the same type (latest chapter wins), then hashes the result. The `canonHash` is the
 * cache key for `generated_images`: an unchanged canon reuses the cached render; new facts (a later
 * chapter) change the hash and trigger a fresh render. Post-boundary facts NEVER enter the canon, so
 * a generated portrait can't leak a future appearance.
 */

import { createHash } from 'crypto';
import { pool } from '../db/pool';

export interface AppearanceFact {
  chapterOrder: number;
  factType: string;
  value: string;
}

export interface Canon {
  facts: { factType: string; value: string }[];
  canonHash: string;
}

/** Slice ≤ boundary, supersede by latest chapter per fact_type, and hash (order-independent). */
export const buildCanon = (facts: AppearanceFact[], boundary: number): Canon => {
  const latest = new Map<string, AppearanceFact>();
  for (const f of facts) {
    if (f.chapterOrder > boundary) continue; // post-boundary trait — never in the canon
    const prev = latest.get(f.factType);
    if (!prev || f.chapterOrder >= prev.chapterOrder) latest.set(f.factType, f);
  }
  const sorted = [...latest.values()]
    .sort((a, b) => a.factType.localeCompare(b.factType))
    .map((f) => ({ factType: f.factType, value: f.value }));
  const canonHash = createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 16);
  return { facts: sorted, canonHash };
};

/** Read an entity's appearance facts and build its canon at the boundary. */
export const getEntityCanon = async (entityId: string, boundary: number): Promise<Canon> => {
  const { rows } = await pool.query<{ chapter_order: number; fact_type: string; value: string }>(
    `SELECT chapter_order, fact_type, value FROM entity_appearance_facts
     WHERE entity_id = $1 AND chapter_order <= $2 ORDER BY chapter_order`,
    [entityId, boundary],
  );
  return buildCanon(
    rows.map((r) => ({ chapterOrder: r.chapter_order, factType: r.fact_type, value: r.value })),
    boundary,
  );
};
