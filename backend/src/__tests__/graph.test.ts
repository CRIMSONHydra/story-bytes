/**
 * Knowledge-graph service tests — focus on the spoiler-safety invariants (plan §2.14):
 *  - foreshadowing selection uses the live window (setup <= N < payoff)
 *  - the reader-facing query NEVER projects the payoff_summary column
 *  - cast / threads / events are all bounded by the chapter boundary
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/pool', () => ({
  pool: { query: vi.fn() },
  checkDatabase: vi.fn(),
  closePool: vi.fn(),
}));

import { pool } from '../db/pool';
import {
  getForeshadowLinks,
  getLivePayoffSummaries,
  getMainCast,
  getOpenThreads,
  getLastEvent,
} from '../services/graph';

const mockQuery = vi.mocked(pool.query);

describe('graph service — foreshadowing spoiler safety', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('getForeshadowLinks selects only setup + hint for the live window, never the payoff', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ setup_chapter_order: 6, setup_summary: 'A locked cellar door.', emphasis_hint: 'An odd detail, easy to overlook.' }],
    } as never);

    const links = await getForeshadowLinks('story-1', 12);

    const sql = mockQuery.mock.calls[0][0] as string;
    // The emphasizability window: setup already read, payoff still ahead.
    expect(sql).toContain('setup_chapter_order <= $2');
    expect(sql).toContain('payoff_chapter_order > $2');
    // CRITICAL: the reader-facing projection must never include the payoff column.
    expect(sql).not.toContain('payoff_summary');
    // Significance is used for ordering but not returned (magnitude is gatekept).
    expect(sql).toContain('significance');
    expect(mockQuery.mock.calls[0][1]).toEqual(['story-1', 12, 5]);

    expect(links).toEqual([
      { setupChapter: 6, setupSummary: 'A locked cellar door.', hint: 'An odd detail, easy to overlook.' },
    ]);
    // The returned shape carries no payoff / significance fields.
    expect(Object.keys(links[0]).sort()).toEqual(['hint', 'setupChapter', 'setupSummary']);
  });

  it('getLivePayoffSummaries (server-side only) DOES read payoff_summary for the guard', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ payoff_summary: 'The door hides the lair.' }] } as never);
    const payoffs = await getLivePayoffSummaries('story-1', 12);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('payoff_summary');
    expect(sql).toContain('setup_chapter_order <= $2');
    expect(sql).toContain('payoff_chapter_order > $2');
    expect(payoffs).toEqual(['The door hides the lair.']);
  });

  it('getMainCast bounds by the chapter boundary', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    await getMainCast('story-1', 10);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('first_chapter_order <= $2');
    expect(mockQuery.mock.calls[0][1]).toEqual(['story-1', 10, 6]);
  });

  it('getOpenThreads only returns threads whose latest visible beat is not resolved', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    await getOpenThreads('story-1', 10);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('chapter_order <= $2');
    expect(sql).toContain("NOT IN ('payoff', 'resolution')");
  });

  it('getLastEvent bounds by the chapter boundary and returns null when none', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    const ev = await getLastEvent('story-1', 10);
    expect(ev).toBeNull();
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('chapter_order <= $2');
  });
});
