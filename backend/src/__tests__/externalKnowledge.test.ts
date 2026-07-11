/**
 * External-knowledge retrieval (M18): the query must DEFAULT-DENY — only chunks with a concrete
 * max_chapter_order ≤ boundary are eligible; NULL (unclassified) chunks are never returned.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/pool', () => ({ pool: { query: vi.fn().mockResolvedValue({ rows: [] }) }, checkDatabase: vi.fn(), closePool: vi.fn() }));

import { pool } from '../db/pool';
import { findSimilarExternalKnowledge } from '../services/db';

const mockQuery = vi.mocked(pool.query);

describe('findSimilarExternalKnowledge', () => {
  afterEach(() => vi.restoreAllMocks());

  it('filters by NOT NULL max_chapter_order <= boundary (default-deny) and passes the boundary', async () => {
    await findSimilarExternalKnowledge([0.1, 0.2], 'story-1', 7);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toContain('ek.max_chapter_order IS NOT NULL');
    expect(String(sql)).toContain('ek.max_chapter_order <= $3');
    expect(params).toEqual(['[0.1,0.2]', 'story-1', 7, 3]);
  });

  it('returns [] (not a throw) when the DB errors', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    expect(await findSimilarExternalKnowledge([0.1], 'story-1', 5)).toEqual([]);
  });
});
