/**
 * Chapter-management service tests (M13): paste-append embeds only the new chapter's chunks inside a
 * transaction (rolls back on embedding failure), delete reports the annotation count, cost estimate
 * is pure.
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
const mockConnect = vi.mocked(pool.connect);

/** A transaction client whose query() returns canned results keyed by SQL text. */
const makeClient = () => {
  const query = vi.fn((sql: unknown) => {
    const s = String(sql);
    if (s.includes('INSERT INTO chapters')) return Promise.resolve({ rows: [{ chapter_id: 'ch-new', chapter_order: 12 }] });
    if (s.includes('INSERT INTO chapter_blocks')) return Promise.resolve({ rows: [{ block_id: 'blk' }] });
    return Promise.resolve({ rows: [], rowCount: 1 });
  });
  return { query, release: vi.fn() };
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

  it('appends at max+1 (atomic), embeds each chunk, invalidates summaries, and commits', async () => {
    const client = makeClient();
    mockConnect.mockResolvedValue(client as never);

    const result = await appendChapter('story-1', 'New Chapter', 'A'.repeat(50));

    expect(result).toMatchObject({ chapterId: 'ch-new', order: 12, blocks: 1 });
    expect(llm.generateEmbedding).toHaveBeenCalledTimes(1);
    expect(llm.generateEmbedding).toHaveBeenCalledWith(expect.any(String), 'document');
    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls).toContain('BEGIN');
    expect(sqls.some((s) => s.includes('INSERT INTO block_embeddings'))).toBe(true);
    expect(sqls.some((s) => s.includes('DELETE FROM chapter_summaries'))).toBe(true);
    expect(sqls).toContain('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('rolls back (no COMMIT) when an embedding fails mid-loop', async () => {
    const client = makeClient();
    mockConnect.mockResolvedValue(client as never);
    vi.mocked(llm.generateEmbedding).mockRejectedValueOnce(new Error('Embedding API down'));

    await expect(appendChapter('story-1', 'Fail', 'A'.repeat(50))).rejects.toThrow('Embedding API down');
    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });
});

describe('deleteChapterWithCount', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the attached annotation count on delete', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ story_id: 's1', annotation_count: '3' }] } as never)
      .mockResolvedValueOnce({ rowCount: 1 } as never)
      .mockResolvedValueOnce({ rowCount: 1 } as never);
    expect(await deleteChapterWithCount('ch1')).toEqual({ annotationCount: 3 });
  });

  it('returns null for an unknown chapter', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    expect(await deleteChapterWithCount('nope')).toBeNull();
  });
});
