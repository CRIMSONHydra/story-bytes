/**
 * Chapter-management service tests (M13): paste-append embeds only the new chapter's chunks and
 * invalidates summaries; delete reports the annotation count; cost estimate is pure.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/pool', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  checkDatabase: vi.fn(),
  closePool: vi.fn(),
}));
vi.mock('../services/llm', async (orig) => ({
  ...(await orig<typeof import('../services/llm')>()),
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));

import { pool } from '../db/pool';
import * as llm from '../services/llm';
import { appendChapter, deleteChapterWithCount, estimateAppendCost } from '../services/chapters';

const mockQuery = vi.mocked(pool.query);

// Route each query to a canned result by matching its SQL text.
const smartMock = (overrides: Record<string, unknown> = {}) => {
  mockQuery.mockImplementation((sql: unknown) => {
    const s = String(sql);
    if (s.includes('MAX(chapter_order)')) return Promise.resolve({ rows: [{ next: 12 }] } as never);
    if (s.includes('INSERT INTO chapters')) return Promise.resolve({ rows: [{ chapter_id: 'ch-new' }] } as never);
    if (s.includes('INSERT INTO chapter_blocks')) return Promise.resolve({ rows: [{ block_id: 'blk' }] } as never);
    return Promise.resolve({ rows: [], rowCount: 1 } as never);
  });
  Object.assign(mockQuery, overrides);
};

describe('estimateAppendCost', () => {
  it('estimates tokens (~chars/4) and a non-negative cost', () => {
    const est = estimateAppendCost('some pasted chapter text that is long enough to count');
    expect(est.chunks).toBe(1);
    expect(est.estimatedTokens).toBeGreaterThan(0);
    expect(est.estimatedCostUsd).toBeGreaterThanOrEqual(0);
  });

  it('drops trivially short chunks', () => {
    expect(estimateAppendCost('hi').chunks).toBe(0);
  });
});

describe('appendChapter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('appends at max+1, embeds each chunk, and invalidates summaries', async () => {
    smartMock();
    const result = await appendChapter('story-1', 'New Chapter', 'A'.repeat(50));

    expect(result).toMatchObject({ chapterId: 'ch-new', order: 12, blocks: 1 });
    expect(llm.generateEmbedding).toHaveBeenCalledTimes(1);
    expect(llm.generateEmbedding).toHaveBeenCalledWith(expect.any(String), 'document');
    const sqls = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('INSERT INTO block_embeddings'))).toBe(true);
    expect(sqls.some((s) => s.includes('DELETE FROM chapter_summaries'))).toBe(true);
  });
});

describe('deleteChapterWithCount', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the attached annotation count on delete', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ story_id: 's1', annotation_count: '3' }] } as never) // lookup
      .mockResolvedValueOnce({ rowCount: 1 } as never)   // delete chapter
      .mockResolvedValueOnce({ rowCount: 1 } as never);  // invalidate summaries
    const result = await deleteChapterWithCount('ch1');
    expect(result).toEqual({ annotationCount: 3 });
  });

  it('returns null for an unknown chapter', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    expect(await deleteChapterWithCount('nope')).toBeNull();
  });
});
